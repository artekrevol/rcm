document.documentElement.classList.add('js');
const toggle=document.querySelector('.menu-toggle'),nav=document.getElementById('site-nav');
if(toggle&&nav){
 const close=()=>{toggle.setAttribute('aria-expanded','false');nav.classList.remove('open');};
 toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));nav.classList.toggle('open',open);});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&nav.classList.contains('open')){close();toggle.focus();}});
 nav.addEventListener('click',e=>{if(e.target.closest('a'))close();});
 window.matchMedia('(min-width:1001px)').addEventListener('change',close);
}
