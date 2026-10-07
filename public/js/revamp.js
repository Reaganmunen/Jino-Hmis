/* revamp.js — decorative only: heading icons, button icons, date chip. */
(function(){
  var H=[[/schedule|appointment|availability|book/i,'cal'],[/quick/i,'bolt'],[/revenue|report/i,'chart'],[/attention|alert/i,'alert'],[/service|catalog/i,'list'],
   [/workload|staff/i,'users'],[/patient|profile|account|photo/i,'user'],[/bill|payment|due|history/i,'receipt'],[/stk|m-pesa|prompt/i,'phone'],
   [/inventory|item|stock|consumable|usage|restock/i,'box'],[/password/i,'lock'],[/prescription/i,'pill'],[/lab/i,'flask'],[/treatment|plan/i,'clip'],
   [/diagnos|tooth|charting|checkup/i,'tooth'],[/x-ray|files/i,'img'],[/certificate/i,'file'],[/upcoming/i,'clock'],[/add|new|register|open/i,'plus']];
  var B=[[/^\s*(add|new|register|create|open|book)/i,'plus'],[/send|stk/i,'phone'],[/record|pay/i,'receipt'],[/save|update/i,'list']];
  function pick(m,t){for(var i=0;i<m.length;i++)if(m[i][0].test(t))return m[i][1];return null;}
  function run(){
    document.querySelectorAll('.panel-head h2,.panel>h2').forEach(function(h){
      if(h.querySelector('.hd-ic'))return;var k=pick(H,h.textContent||'');if(!k)return;
      var s=document.createElement('span');s.className='hd-ic';s.setAttribute('aria-hidden','true');s.style.setProperty('--ic','var(--i-'+k+')');
      h.insertBefore(s,h.firstChild);
    });
    document.querySelectorAll('.btn').forEach(function(b){
      if(b.hasAttribute('data-ic')||b.querySelector('svg')||!b.textContent.trim())return;
      var k=pick(B,b.textContent);if(k){b.setAttribute('data-ic',k);b.style.setProperty('--ic','var(--i-'+k+')');}
    });
    var r=document.querySelector('.topbar-right');
    if(r&&!r.querySelector('.date-chip')){var d=document.createElement('span');d.className='date-chip';
      d.textContent=new Date().toLocaleDateString('en-KE',{weekday:'short',day:'numeric',month:'short',year:'numeric'});r.insertBefore(d,r.firstChild);}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();
