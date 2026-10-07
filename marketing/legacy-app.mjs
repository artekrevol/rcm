import https from 'node:https';

// Fixed destination: never derive an upstream from user input or a request header.
export const appOrigin = 'https://app.resolta.ai';
const hopByHop = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
function endToEnd(headers) {
  const blocked = new Set([...hopByHop, ...String(headers.connection || '').toLowerCase().split(',').map(x=>x.trim())]);
  return Object.fromEntries(Object.entries(headers).filter(([key])=>!blocked.has(key.toLowerCase())));
}
export function legacyAppPage(pathname) {
  return /^\/(auth|login|intake|admin|billing|dashboard|deals|claims|intelligence|rules|lead-analytics|cascade-demo)(\/|$)/.test(pathname);
}
export function forwardAppRequest(req, res, request = https.request) {
  const destination = new URL(appOrigin);
  // Assign path separately, so a protocol-relative request cannot change the host.
  const headers = endToEnd(req.headers);
  headers.host = destination.host;
  headers['x-forwarded-proto'] = 'https';
  delete headers['x-forwarded-host'];
  delete headers['x-forwarded-for'];
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Robots-Tag','noindex, nofollow');
  const upstream = request({protocol:'https:',hostname:destination.hostname,port:443,path:req.url,method:req.method,headers}, response=>{
    const responseHeaders=endToEnd(response.headers);
    responseHeaders['cache-control']='no-store';
    responseHeaders['x-robots-tag']='noindex, nofollow';
    res.writeHead(response.statusCode || 502,responseHeaders);
    response.pipe(res);
    response.on('error',()=>res.destroy());
  });
  upstream.setTimeout(30000,()=>upstream.destroy(new Error('Upstream timeout')));
  upstream.on('error',()=>{
    if(res.headersSent) return res.destroy();
    res.writeHead(502,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify({error:'Application temporarily unavailable. Please retry.'}));
  });
  req.on('aborted',()=>upstream.destroy());
  res.on('close',()=>{if(!res.writableFinished)upstream.destroy();});
  req.pipe(upstream);
}
