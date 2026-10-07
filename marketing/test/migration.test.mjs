import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createMarketingServer } from '../server.mjs';

async function listen(s) {await new Promise(r=>s.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${s.address().port}`;}
test('migration keeps old app links on the fixed app host and preserves API methods and bytes',async()=>{
  const received=[];
  const upstream=http.createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c;
    received.push({method:req.method,url:req.url,headers:req.headers,raw});
    res.writeHead(401,{'Content-Type':'application/json','Set-Cookie':'example=test; HttpOnly; Secure; SameSite=Lax'});
    res.end('{"error":"Not authenticated"}');
  });
  await listen(upstream);
  const server=createMarketingServer({LEGACY_APP_PROXY_ENABLED:'true',PUBLIC_RELEASE_APPROVED:'true',PUBLIC_ORIGIN:'https://www.resolta.ai'}, {
    appRequest:(options,callback)=>{
      assert.equal(options.hostname,'app.resolta.ai');assert.equal(options.protocol,'https:');assert.equal(options.port,443);
      return http.request({...options,protocol:'http:',hostname:'127.0.0.1',port:upstream.address().port},callback);
    }
  });
  const origin=await listen(server);
  try {
    const legacy=await fetch(origin+'/billing/claims/123?view=history',{redirect:'manual'});
    assert.equal(legacy.status,302);assert.equal(legacy.headers.get('location'),'https://app.resolta.ai/billing/claims/123?view=history');
    assert.equal((await fetch(origin+'/billing-risk-review/')).status,200);
    assert.equal((await fetch(origin+'/marketing-api/config')).status,200);
    const raw='{"synthetic":"exact bytes  ","count":1}\n';
    const response=await fetch(origin+'/api/callback/example?attempt=2',{method:'POST',headers:{'Content-Type':'application/json','x-synthetic-signature':'test-signature','x-forwarded-host':'untrusted.invalid'},body:raw});
    assert.equal(response.status,401);assert.equal(await response.text(),'{"error":"Not authenticated"}');
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
    assert.equal(received[0].method,'POST');assert.equal(received[0].url,'/api/callback/example?attempt=2');assert.equal(received[0].raw,raw);
    assert.equal(received[0].headers.host,'app.resolta.ai');assert.equal(received[0].headers['x-synthetic-signature'],'test-signature');assert.equal(received[0].headers['x-forwarded-host'],undefined);
    assert.equal((await fetch(origin+'/not-a-page')).status,404);
  } finally { await new Promise(r=>server.close(r));await new Promise(r=>upstream.close(r)); }
});
