import http from 'node:http';
import { readFile, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const routes = JSON.parse(await readFile(path.join(root, 'routes.json'), 'utf8'));
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.txt':'text/plain; charset=utf-8' };
const allowedPrograms = new Set(['VA_CCN','Medicaid','Other_public_payer','Unsure']);

export function validateReview(body) {
  if (!body || Array.isArray(body) || typeof body !== 'object') return null;
  const allowed = new Set(['name','email','organization','state','program','contactConsent','marketingConsent','website']);
  if (Object.keys(body).some(key => !allowed.has(key))) return null;
  const clean = {};
  for (const [key, max] of [['name',100],['email',254],['organization',150],['state',40]]) {
    const value = body[key];
    if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f<>]/.test(value)) return null;
    clean[key] = value.trim();
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email) || !allowedPrograms.has(body.program) || body.contactConsent !== true || (body.website && body.website !== '') || typeof body.marketingConsent !== 'boolean') return null;
  return {...clean, program:body.program, contactConsent:true, marketingConsent:body.marketingConsent};
}

export function createMarketingServer(env = process.env) {
  const publicDir = path.join(root, 'public');
  const release = env.PUBLIC_RELEASE_APPROVED === 'true';
  let origin = null;
  try { const u = new URL(env.PUBLIC_ORIGIN); if (u.protocol === 'https:' && u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password) origin = u.origin; } catch {}
  let privacyURL = null;
  try { const u = new URL(env.REVIEW_PRIVACY_URL); if (u.protocol === 'https:' && !u.username && !u.password) privacyURL = u.href; } catch {}
  const intakeEnabled = Boolean(env.REVIEW_STORAGE_DIR && privacyURL && env.REVIEW_INTAKE_APPROVED === 'true');
  const indexable = release && Boolean(origin);
  const buckets = new Map();
  const pending = new Map();
  return http.createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('X-Robots-Tag',indexable ? 'index, follow' : 'noindex, nofollow');
    const send = (status,data) => {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    try {
      const url = new URL(req.url,'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname === '/healthz' && req.method === 'GET') return send(200,{status:'ok',service:'resolta-marketing'});
      if (pathname === '/api/config' && req.method === 'GET') return send(200,{intakeEnabled,privacyURL:intakeEnabled ? privacyURL : null,consentVersion:'review-request-v1'});
      if (pathname === '/api/workflow-review' && req.method === 'POST') {
        if (!intakeEnabled) return send(503,{error:'Review requests are not enabled in this staging environment.'});
        const requestOrigin = req.headers.origin;
        const expectedOrigin = origin || `http://${req.headers.host}`;
        if (requestOrigin !== expectedOrigin) return send(403,{error:'Please submit the form from this website.'});
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return send(415,{error:'Unsupported request format.'});
        const key = req.headers['idempotency-key'];
        if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(key)) return send(400,{error:'Please reload the form and try again.'});
        const ip = req.socket.remoteAddress || 'unknown';
        const now=Date.now();
        for (const [address,b] of buckets) if (b.expires < now) buckets.delete(address);
        const bucket=buckets.get(ip)||{count:0,expires:now+600000};
        if (++bucket.count > 20) {res.setHeader('Retry-After','600');return send(429,{error:'Too many requests. Please try again later.'});}
        buckets.set(ip,bucket);
        let raw='';
        for await (const chunk of req) {raw+=chunk;if(Buffer.byteLength(raw)>8192) return send(413,{error:'Request is too large.'});}
        let input;
        try {input=JSON.parse(raw);} catch {return send(400,{error:'Please check the form and try again.'});}
        const data=validateReview(input);
        if (!data) return send(400,{error:'Enter valid business contact information and review consent. Do not include patient or claim details.'});
        const digest=createHash('sha256').update(key).digest('hex');
        const payloadHash=createHash('sha256').update(JSON.stringify(data)).digest('hex');
        const destination=path.join(env.REVIEW_STORAGE_DIR,digest+'.json');
        const persist=async()=>{
          await mkdir(env.REVIEW_STORAGE_DIR,{recursive:true,mode:0o700});
          try {
            const existing=JSON.parse(await readFile(destination,'utf8'));
            return existing.payloadHash===payloadHash ? {status:200,id:existing.id} : {status:409};
          } catch(error) {if(error.code!=='ENOENT') throw error;}
          const record={id:randomUUID(),createdAt:new Date().toISOString(),consentVersion:'review-request-v1',environment:indexable?'public':'staging',payloadHash,...data};
          const file=await open(destination,'wx',0o600);
          try {await file.writeFile(JSON.stringify(record)+'\n');await file.sync();} finally {await file.close();}
          return {status:201,id:record.id};
        };
        // Serialize each key in this single-process server; duplicates return the persisted result.
        const previous=pending.get(digest)||Promise.resolve();
        const operation=previous.catch(()=>{}).then(persist);pending.set(digest,operation);
        let result;try{result=await operation;}finally{if(pending.get(digest)===operation)pending.delete(digest);}
        if(result.status===409) return send(409,{error:'This request changed after submission. Reload before submitting a new request.'});
        return send(result.status,{requestId:result.id,message:'Your workflow-review request was recorded. A reviewer will confirm scope before any claim data is shared.'});
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405,{error:'Method not allowed.'});
      if (pathname.startsWith('/api/')) return send(404,{error:'Not found.'});
      if (pathname === '/robots.txt') {res.setHeader('Content-Type','text/plain');return res.end(indexable?`User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`:'User-agent: *\nDisallow: /\n');}
      if (pathname === '/sitemap.xml') {res.setHeader('Content-Type','application/xml');return res.end('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+(indexable?routes.map(r=>`<url><loc>${origin}${r.path}</loc></url>`).join(''):'')+'</urlset>');}
      const normalized=pathname==='/'?'/':pathname.replace(/\/$/,'')+'/';
      const route=routes.find(r=>r.path===normalized);
      if(route && pathname!==normalized){res.writeHead(308,{Location:normalized});return res.end();}
      const relative=route ? path.join(normalized,'index.html') : pathname;
      const target=path.resolve(publicDir,'.'+relative);
      if (!target.startsWith(publicDir+path.sep) || !types[path.extname(target)]) return send(404,{error:'Not found.'});
      let data;try{data=await readFile(target);}catch(error){if(error.code==='ENOENT')return send(404,{error:'Not found.'});throw error;}
      if (route && indexable) {
        data=Buffer.from(data.toString().replace('<meta name="robots" content="noindex,nofollow">',`<meta name="robots" content="index,follow"><meta name="resolta-environment" content="public"><link rel="canonical" href="${origin}${route.path}">`).replace('<div class="notice">Staging review · launch copy and tools · customer outcomes and payer coverage are not asserted</div>',''));
      }
      res.writeHead(200,{'Content-Type':types[path.extname(target)],'Cache-Control':'no-cache'});
      res.end(req.method==='HEAD'?undefined:data);
    } catch {
      // Never log submitted business contact data or raw request bodies.
      if(!res.headersSent)send(500,{error:'We could not record the request. Please try again later.'});else res.end();
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createMarketingServer().listen(Number(process.env.PORT || 4173),process.env.HOST || '127.0.0.1',()=>console.log('Resolta marketing server ready'));
}
