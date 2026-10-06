(() => {
  const allowed=new Set(['commercial_page_view','asset_opened','methodology_view','assessment_form_started','assessment_request_submitted','assessment_request_failed','checklist_download','calculator_completed']);
  const path=location.pathname;
  function event(name,properties={}) {
    if(!allowed.has(name))return;
    // Deliberately local only. Connect an approved consent-aware analytics adapter later.
    const payload={event:name,page_path:path,environment:document.querySelector('meta[name="resolta-environment"]')?.content || 'staging',...properties};
    window.dispatchEvent(new CustomEvent('resolta:analytics',{detail:payload}));
  }
  event(path.startsWith('/methodology')?'methodology_view':path.startsWith('/resources')||path.startsWith('/tools')?'asset_opened':'commercial_page_view');
  document.querySelectorAll('[data-download]').forEach(a=>a.addEventListener('click',()=>event('checklist_download',{asset_id:a.dataset.download})));
  document.getElementById('cost')?.addEventListener('submit',()=>event('calculator_completed',{asset_id:'correction-cost'}));
  const form=document.getElementById('review-form');if(!form)return;
  const button=document.getElementById('review-submit'),result=document.getElementById('form-result');
  let enabled=false,busy=false,key=crypto.randomUUID().replaceAll('-',''),started=false;
  form.addEventListener('input',()=>{if(!started){started=true;event('assessment_form_started',{form_id:'workflow-review'});}});
  fetch('/api/config').then(r=>{if(!r.ok)throw Error();return r.json();}).then(config=>{
    enabled=config.intakeEnabled===true;button.disabled=!enabled;
    document.getElementById('intake-status').textContent=enabled?'Review requests are open. No claim-level data is requested here.':'Staging: requests are not being accepted yet. Use the downloadable preparation worksheet below.';
    if(enabled&&config.privacyURL){const a=document.createElement('a');a.href=config.privacyURL;a.textContent='Read the privacy notice';document.getElementById('privacy-link').append(a);}
  }).catch(()=>{document.getElementById('intake-status').textContent='Review requests are currently unavailable. Use the preparation worksheet below.';});
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(!enabled||busy)return;busy=true;button.disabled=true;result.textContent='Recording your request…';
    const f=new FormData(form);const data=Object.fromEntries(['name','email','organization','state','program','website'].map(k=>[k,String(f.get(k)||'')]));
    data.contactConsent=f.has('contactConsent');data.marketingConsent=f.has('marketingConsent');
    try{const r=await fetch('/api/workflow-review',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(data)});const response=await r.json();if(!r.ok)throw new Error(response.error||'Request could not be recorded.');result.textContent=response.message;event('assessment_request_submitted',{form_id:'workflow-review',request_id:response.requestId});form.reset();key=crypto.randomUUID().replaceAll('-','');}
    catch(error){result.textContent=error.message;event('assessment_request_failed',{reason_code:'submission_error'});}
    finally{busy=false;button.disabled=!enabled;}
  });
})();
