import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,readdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMarketingServer,validateReview } from '../server.mjs';

const input={name:'Synthetic Test',email:'test@example.com',organization:'Example Test Agency',state:'TX',program:'VA_CCN',contactConsent:true,marketingConsent:false,website:''};
async function serve(env,fn){const s=createMarketingServer(env);await new Promise(r=>s.listen(0,'127.0.0.1',r));try{await fn(`http://127.0.0.1:${s.address().port}`);}finally{await new Promise(r=>s.close(r));}}
test('staging routes do not expose application APIs or indexing',async()=>serve({},async origin=>{
  for(const route of ['/','/home-care/','/platform/','/billing-risk-review/','/resources/','/pricing/']){const r=await fetch(origin+route);assert.equal(r.status,200);assert.match(r.headers.get('x-robots-tag'),/noindex/);assert.match(await r.text(),/Resolta/);}
  assert.equal((await fetch(origin+'/api/auth/me')).status,404);
  assert.equal((await fetch(origin+'/marketing-api/workflow-review',{method:'POST'})).status,503);
  assert.match(await (await fetch(origin+'/robots.txt')).text(),/Disallow: \//);
  assert.equal((await fetch(origin+'/server.mjs')).status,404);
}));
test('form rejects clinical payload extensions and invalid consent',()=>{
  assert.ok(validateReview(input));assert.equal(validateReview({...input,claimId:'not-allowed'}),null);assert.equal(validateReview({...input,contactConsent:false}),null);assert.equal(validateReview({...input,email:'invalid'}),null);assert.equal(validateReview({...input,name:'<script>'}),null);assert.equal(validateReview({...input,program:'unknown'}),null);
});
test('intake durably stores one record and deduplicates retry without claiming assessment completion',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'resolta-intake-'));
 try{await serve({REVIEW_STORAGE_DIR:dir,REVIEW_INTAKE_APPROVED:'true',REVIEW_PRIVACY_URL:'https://example.com/privacy'},async origin=>{
   const send=body=>fetch(origin+'/marketing-api/workflow-review',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':'abcdefghijklmnop'},body:JSON.stringify(body)});
   const first=await send(input);assert.equal(first.status,201);const a=await first.json();assert.ok(a.requestId);assert.doesNotMatch(a.message,/completed|guarantee/i);
   const second=await send(input);assert.equal(second.status,200);assert.equal((await second.json()).requestId,a.requestId);
   assert.equal((await send({...input,name:'Other'})).status,409);
   assert.equal((await readdir(dir)).length,1);
   const saved=JSON.parse(await readFile(path.join(dir,(await readdir(dir))[0]),'utf8'));assert.equal(saved.marketingConsent,false);assert.equal(saved.environment,'staging');
   assert.equal((await fetch(origin+'/marketing-api/workflow-review',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json','Idempotency-Key':'abcdefghijklmnop'},body:JSON.stringify(input)})).status,403);
 });}finally{await rm(dir,{recursive:true,force:true});}
});
test('approved public mode creates canonical sitemap only for real routes',async()=>serve({PUBLIC_RELEASE_APPROVED:'true',PUBLIC_ORIGIN:'https://www.example.com'},async origin=>{
 const home=await (await fetch(origin+'/')).text();assert.match(home,/<link rel="canonical" href="https:\/\/www.example.com\/">/);assert.doesNotMatch(home,/class="notice"/);
 const sitemap=await (await fetch(origin+'/sitemap.xml')).text();assert.match(sitemap,/home-care/);assert.doesNotMatch(sitemap,/customers|home-health|supported-payers/);
}));
test('storage failure never acknowledges a review request',async()=>serve({REVIEW_STORAGE_DIR:'/dev/null/resolta-test',REVIEW_INTAKE_APPROVED:'true',REVIEW_PRIVACY_URL:'https://example.com/privacy'},async origin=>{
 const r=await fetch(origin+'/marketing-api/workflow-review',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':'storagefailure001'},body:JSON.stringify(input)});
 assert.equal(r.status,500);const body=await r.json();assert.ok(body.error);assert.equal(body.requestId,undefined);
}));
