(function(){
  'use strict';

  var state = { rec:null, listening:false, mode:'manual', last:'', at:0 };
  var legacyRoute = window.svVoiceAI && typeof window.svVoiceAI.route === 'function' ? window.svVoiceAI.route : null;
  var lastAnalysis = null;

  function el(id){ return document.getElementById(id); }
  function norm(text){
    return String(text || '').toLowerCase()
      .replace(/[ăâàáäã]/g,'a').replace(/[îìíï]/g,'i')
      .replace(/[șş]/g,'s').replace(/[țţ]/g,'t')
      .replace(/[éèêë]/g,'e').replace(/[óòôö]/g,'o')
      .replace(/[úùûü]/g,'u').replace(/[^a-z0-9\s.,-]/g,' ')
      .replace(/\s+/g,' ').trim();
  }
  function transcript(text){ var box=el('transcript-display'); if(box) box.textContent=text || ''; }
  function feedback(text,type){
    var box=el('feedback-display');
    if(box){ box.textContent=text || ''; box.className=type || ''; box.dataset.type=type || ''; }
    if(typeof window.setFeedback === 'function' && window.setFeedback !== feedback){
      try{ window.setFeedback(text || '', type || ''); }catch(e){}
    }
  }
  function speak(text){
    if(!text || !window.speechSynthesis) return;
    try{
      window.speechSynthesis.cancel();
      var u=new SpeechSynthesisUtterance(text);
      u.lang=localStorage.getItem('sv_voice_lang') || 'ro-RO';
      u.rate=1.05;
      window.speechSynthesis.speak(u);
    }catch(e){}
  }
  function micState(on){
    var mic=el('mic-btn'), bars=el('audio-bars');
    if(mic){ mic.classList.toggle('listening', !!on); mic.textContent=on ? 'REC' : 'MIC'; }
    if(bars) bars.classList.toggle('active', !!on);
    updateCenter();
  }
  function qty(text){
    var n=norm(text), d=n.match(/\b(\d+(?:[.,]\d+)?)\b/);
    if(d) return Number(d[1].replace(',','.')) || 1;
    var w={un:1,unu:1,una:1,o:1,doi:2,doua:2,trei:3,patru:4,cinci:5,sase:6,sapte:7,opt:8,noua:9,zece:10,unsprezece:11,doisprezece:12,douazeci:20,treizeci:30,cincizeci:50,suta:100,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
    var parts=n.split(' ');
    for(var i=0;i<parts.length;i++) if(w[parts[i]] != null) return w[parts[i]];
    return 1;
  }
  function stock(){
    try{ if(window.svCommandBridge && Array.isArray(window.svCommandBridge.stock)) return window.svCommandBridge.stock; }catch(e){}
    try{ return JSON.parse(localStorage.getItem('sv_command_bridge_stock') || '[]') || []; }catch(e){ return []; }
  }
  function saveStock(){
    try{
      if(window.svCommandBridge && Array.isArray(window.svCommandBridge.stock)) {
        localStorage.setItem('sv_command_bridge_stock', JSON.stringify(window.svCommandBridge.stock));
      }
    }catch(e){}
    try{ if(typeof window.renderStock === 'function') window.renderStock(); }catch(e){}
    try{ if(typeof window.updateStats === 'function') window.updateStats(); }catch(e){}
  }
  function log(command,result,type){
    try{
      var logs=JSON.parse(localStorage.getItem('sv_command_bridge_log') || '[]') || [];
      logs.unshift({time:new Date().toLocaleString('ro-RO'),cmd:command,result:result,type:type || 'ok',user:'voice-engine',ts:new Date().toISOString()});
      localStorage.setItem('sv_command_bridge_log', JSON.stringify(logs.slice(0,300)));
    }catch(e){}
    try{ if(typeof window.renderLog === 'function') window.renderLog(); }catch(e){}
  }
  function client(text){
    var raw=String(text || '').trim(), n=norm(raw);
    var idx=n.search(/\b(a luat|a ridicat|a scos|a folosit|a consumat|a adus|a returnat|a predat)\b/);
    return idx > 1 ? raw.slice(0,idx).trim() : '';
  }
  function query(text){
    return norm(text)
      .replace(/\b(a luat|a ridicat|a scos|a folosit|a consumat|a adus|a returnat|a predat|adauga|adaug|pune|baga|scade|scoate|scot|ia|consuma|foloseste|retur|returneaza)\b/g,' ')
      .replace(/\b\d+(?:[.,]\d+)?\b/g,' ')
      .replace(/\b(buc|bucati|bucata|kg|kilograme|l|litri|ml|g|saci|sac|cutii|cutie|metri|m|role|rola|paleti|palet|de|din|la|pe|pentru|in|cu|si)\b/g,' ')
      .replace(/\s+/g,' ').trim();
  }
  function findProduct(text){
    var q=query(text);
    try{
      if(typeof window.findProduct === 'function'){
        var fp=window.findProduct(q,'') || window.findProduct(q.split(/\s+/),'');
        if(fp) return fp;
      }
    }catch(e){}
    var nq=norm(q), parts=nq.split(/\s+/).filter(function(x){return x.length>1;});
    var best=null, score=0;
    stock().forEach(function(p){
      var name=norm((p.name || '')+' '+(p.sku || '')+' '+(p.cat || ''));
      var s=name===nq?10:0;
      if(name.indexOf(nq)>=0 || nq.indexOf(name)>=0) s+=6;
      parts.forEach(function(part){ if(name.indexOf(part)>=0) s++; });
      if(s>score){ score=s; best=p; }
    });
    return score>0 ? best : null;
  }
  function op(text){
    var n=norm(text);
    if(/\b(adauga|adaug|pune|baga|primeste|receptie|intrare|plus|add|receive|restock)\b/.test(n)) return 'in';
    if(/\b(scade|scoate|scot|ia|luat|ridicat|consuma|consumat|foloseste|folosit|iesire|minus|remove|take|subtract|consume|use)\b/.test(n)) return 'out';
    return '';
  }
  function analyze(text){
    var n=norm(text), direction=op(text), type='necunoscut', product=query(text), person=client(text), amount=qty(text);
    if(/\b(pdf|raport pdf|genereaza pdf|export pdf)\b/.test(n)) { type='export_pdf'; product='Raport PDF'; }
    else if(/\b(excel|xlsx|xls|export excel|fisier excel)\b/.test(n)) { type='export_excel'; product='Fisier Excel'; }
    else if(/\b(csv|export csv)\b/.test(n)) { type='export_csv'; product='Fisier CSV'; }
    else if(/\b(setari|settings)\b/.test(n)) { type='setari'; product='Setari'; }
    else if(/\b(deschide )?(scule|santier|constructii|unelte)\b/.test(n)) { type='navigare_santier'; product='SCULE / Santier'; }
    else if(/\b(santier|scule|unealta|unelte|bormasina|flex|ciocan|nivela|ruleta|laser|ciment|beton|saci|retur|returnat|predat|adus)\b/.test(n)) { type='santier'; }
    else if(direction === 'in') type='intrare_stoc';
    else if(direction === 'out') type='iesire_stoc';
    return { raw:String(text||''), norm:n, type:type, op:direction || '-', person:person || '-', item:product || '-', qty:amount || 1, time:new Date().toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit',second:'2-digit'}) };
  }
  function history(){
    try{ return JSON.parse(localStorage.getItem('sv_voice_center_history') || '[]') || []; }catch(e){ return []; }
  }
  function pushHistory(item){
    var rows=history();
    rows.unshift(item);
    try{ localStorage.setItem('sv_voice_center_history', JSON.stringify(rows.slice(0,20))); }catch(e){}
    renderHistory();
  }
  function resultHistory(ok,message){
    if(!lastAnalysis) return;
    pushHistory({time:lastAnalysis.time, command:lastAnalysis.raw, type:lastAnalysis.type, person:lastAnalysis.person, item:lastAnalysis.item, qty:lastAnalysis.qty, ok:!!ok, result:message || (ok?'Executat':'Eroare')});
  }
  function injectCenterStyle(){
    if(el('sv-vcc-style')) return;
    var style=document.createElement('style');
    style.id='sv-vcc-style';
    style.textContent=[
      '.sv-vcc{margin:12px 20px 0;padding:12px;border:1px solid rgba(0,229,160,.22);border-radius:8px;background:linear-gradient(135deg,rgba(0,229,160,.08),rgba(77,159,255,.05)),rgba(13,17,23,.94);box-shadow:0 16px 42px rgba(0,0,0,.28)}',
      '.sv-vcc-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}',
      '.sv-vcc-title{font-family:Barlow Condensed,sans-serif;font-size:24px;font-weight:900;color:#e8ecf0;letter-spacing:0}',
      '.sv-vcc-title span{color:#00e5a0}.sv-vcc-sub{font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:1.7px;text-transform:uppercase;color:#7f91a8;margin-top:2px}',
      '.sv-vcc-grid{display:grid;grid-template-columns:1.15fr 1fr 1fr;gap:10px}.sv-vcc-card{min-height:86px;border:1px solid rgba(107,122,141,.18);border-radius:8px;background:rgba(17,20,24,.72);padding:10px;overflow:hidden}',
      '.sv-vcc-label{font-family:JetBrains Mono,monospace;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#7f91a8;margin-bottom:7px}.sv-vcc-value{font-size:15px;color:#e8ecf0;line-height:1.35}.sv-vcc-big{font-family:Barlow Condensed,sans-serif;font-weight:900;font-size:28px;color:#00e5a0;line-height:1}',
      '.sv-vcc-status{display:flex;align-items:center;gap:9px}.sv-vcc-dot{width:11px;height:11px;border-radius:50%;background:#6b7a8d}.sv-vcc-dot.on{background:#00e5a0;box-shadow:0 0 16px rgba(0,229,160,.8)}.sv-vcc-dot.err{background:#ff4757;box-shadow:0 0 16px rgba(255,71,87,.65)}',
      '.sv-vcc-actions{display:flex;gap:8px;flex-wrap:wrap}.sv-vcc-btn{height:36px;border:1px solid rgba(0,229,160,.62);border-radius:8px;background:#07110f;color:#00e5a0;font-family:JetBrains Mono,monospace;font-size:10px;font-weight:900;letter-spacing:1px;padding:0 12px;cursor:pointer}.sv-vcc-btn.warn{border-color:#ffa502;color:#ffa502;background:#151006}.sv-vcc-btn:hover{background:#00e5a0;color:#06110f}',
      '.sv-vcc-tests{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.sv-vcc-chip{border:1px solid rgba(107,122,141,.28);background:rgba(24,29,36,.7);color:#dce5ee;border-radius:999px;padding:7px 10px;font-size:12px;cursor:pointer}.sv-vcc-chip:hover{border-color:#00e5a0;color:#00e5a0}',
      '.sv-vcc-history{margin-top:10px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.sv-vcc-row{border:1px solid rgba(107,122,141,.16);border-radius:8px;background:rgba(24,29,36,.54);padding:8px 9px}.sv-vcc-row b{display:block;color:#e8ecf0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sv-vcc-row small{display:block;color:#7f91a8;margin-top:4px;font-size:10px}.sv-vcc-row.ok{border-color:rgba(0,229,160,.32)}.sv-vcc-row.err{border-color:rgba(255,71,87,.36)}',
      '@media(max-width:1100px){.sv-vcc-grid{grid-template-columns:1fr}.sv-vcc-history{grid-template-columns:1fr}.sv-vcc{margin:10px 12px 0}}'
    ].join('');
    document.head.appendChild(style);
  }
  function ensureCenter(){
    injectCenterStyle();
    if(el('sv-vcc')) return;
    var zone=document.querySelector('.voice-zone');
    if(!zone || !zone.parentNode) return;
    var panel=document.createElement('section');
    panel.id='sv-vcc';
    panel.className='sv-vcc';
    panel.innerHTML='<div class="sv-vcc-head"><div><div class="sv-vcc-title">Voice <span>Command Center</span></div><div class="sv-vcc-sub">audit live pentru microfon, interpretare si executie</div></div><div class="sv-vcc-actions"><button class="sv-vcc-btn" data-vcc-mic>MIC AI</button><button class="sv-vcc-btn warn" data-vcc-test>TESTEAZA</button><button class="sv-vcc-btn" data-vcc-focus>SCRIE</button></div></div><div class="sv-vcc-grid"><div class="sv-vcc-card"><div class="sv-vcc-label">Status microfon</div><div class="sv-vcc-status"><span id="sv-vcc-dot" class="sv-vcc-dot"></span><div><div id="sv-vcc-status" class="sv-vcc-big">Manual</div><div id="sv-vcc-engine" class="sv-vcc-value">Motor vocal incarcat</div></div></div></div><div class="sv-vcc-card"><div class="sv-vcc-label">Comanda auzita</div><div id="sv-vcc-heard" class="sv-vcc-value">Nicio comanda inca</div></div><div class="sv-vcc-card"><div class="sv-vcc-label">Interpretare AI</div><div id="sv-vcc-parse" class="sv-vcc-value">Astept comanda...</div></div></div><div class="sv-vcc-tests"><button class="sv-vcc-chip" data-vcc-command="George a luat bormasina">George a luat bormasina</button><button class="sv-vcc-chip" data-vcc-command="George a adus bormasina">George a adus bormasina</button><button class="sv-vcc-chip" data-vcc-command="adauga 10 suruburi m6">Adauga 10 suruburi M6</button><button class="sv-vcc-chip" data-vcc-command="scade 1 suruburi m6">Scade 1 suruburi M6</button><button class="sv-vcc-chip" data-vcc-command="export PDF">Export PDF</button><button class="sv-vcc-chip" data-vcc-command="deschide scule">Deschide scule</button></div><div id="sv-vcc-history" class="sv-vcc-history"></div>';
    zone.insertAdjacentElement('afterend',panel);
    panel.addEventListener('click',function(e){
      var cmd=e.target && e.target.getAttribute ? e.target.getAttribute('data-vcc-command') : null;
      if(cmd){ route(cmd); return; }
      if(e.target && e.target.closest('[data-vcc-mic]')) toggle();
      if(e.target && e.target.closest('[data-vcc-focus]')){ var input=el('manual-input'); if(input) input.focus(); }
      if(e.target && e.target.closest('[data-vcc-test]')){ var v=(el('manual-input')||{}).value || 'George a luat bormasina'; route(v); }
    });
  }
  function updateCenter(){
    ensureCenter();
    var dot=el('sv-vcc-dot'), status=el('sv-vcc-status'), engine=el('sv-vcc-engine'), heard=el('sv-vcc-heard'), parse=el('sv-vcc-parse');
    if(dot) dot.className='sv-vcc-dot '+(state.listening?'on':'');
    if(status) status.textContent=state.listening?'Asculta':'Manual';
    if(engine) engine.textContent='Versiune '+(window.StocVoceVoiceEngine ? window.StocVoceVoiceEngine.version : 'noua')+' / mod '+state.mode;
    var t=(el('transcript-display')||{}).textContent || '';
    if(heard) heard.textContent=t.trim() || 'Nicio comanda inca';
    var a=lastAnalysis || analyze(t);
    if(parse) parse.textContent='Tip: '+a.type+' | Persoana: '+a.person+' | Cant: '+a.qty+' | Obiect: '+a.item;
    renderHistory();
  }
  function renderHistory(){
    var box=el('sv-vcc-history'); if(!box) return;
    var rows=history().slice(0,6);
    if(!rows.length){ box.innerHTML='<div class="sv-vcc-row"><b>Nu exista istoric vocal</b><small>Ruleaza o comanda de test sau vorbeste la microfon.</small></div>'; return; }
    box.innerHTML=rows.map(function(r){ return '<div class="sv-vcc-row '+(r.ok?'ok':'err')+'"><b>'+String(r.command||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];})+'</b><small>'+r.time+' - '+r.type+' - '+(r.ok?'OK':'ERR')+' - '+String(r.result||'')+'</small></div>'; }).join('');
  }
  function action(text){
    var n=norm(text);
    if(/\b(deschide )?(scule|santier|constructii|unelte)\b/.test(n) && window.svSiteCommandCenter){
      if(typeof window.svSiteCommandCenter.open === 'function') window.svSiteCommandCenter.open();
      feedback('Am deschis SCULE / Santier.','ok'); return true;
    }
    if(/\b(pdf|raport pdf|genereaza pdf|export pdf)\b/.test(n)){ if(typeof window.generatePDF==='function') window.generatePDF(); else if(window.svVoiceAI && window.svVoiceAI.exportPdf) window.svVoiceAI.exportPdf(); return true; }
    if(/\b(excel|xlsx|xls|export excel|fisier excel)\b/.test(n)){ var f=['exportToExcel','exportFullExcel','exportCRMExcel']; for(var i=0;i<f.length;i++) if(typeof window[f[i]]==='function'){ window[f[i]](); return true; } if(window.svVoiceAI && window.svVoiceAI.exportExcel) window.svVoiceAI.exportExcel(); return true; }
    if(/\b(csv|export csv)\b/.test(n)){ if(typeof window.exportLog==='function') window.exportLog(); else if(window.svVoiceAI && window.svVoiceAI.exportCsv) window.svVoiceAI.exportCsv(); return true; }
    if(/\b(setari|settings)\b/.test(n)){ if(typeof window.openSettingsModal==='function') window.openSettingsModal(); else { var m=el('settings-modal'); if(m) m.style.display='flex'; } feedback('Am deschis setarile.','ok'); return true; }
    if(/\b(logout|iesire|deconectare)\b/.test(n)){ if(typeof window.doLogout==='function') window.doLogout(); return true; }
    return false;
  }
  function site(text){
    var n=norm(text);
    if(!window.svSiteCommandCenter || typeof window.svSiteCommandCenter.process !== 'function') return false;
    if(!/\b(santier|scule|unealta|unelte|bormasina|flex|ciocan|nivela|ruleta|laser|ciment|beton|saci|retur|returnat|predat|adus)\b/.test(n)) return false;
    try{ return !!window.svSiteCommandCenter.process(text); }catch(e){ console.warn('SCULE voice failed',e); return false; }
  }
  function stockCommand(text){
    var direction=op(text); if(!direction) return false;
    var product=findProduct(text), amount=qty(text), person=client(text);
    if(!product){ feedback('Nu am gasit produsul: '+query(text),'warn'); log(text,'Produs negasit','err'); return true; }
    if(direction==='out' && Number(product.qty || 0)<amount){ feedback('Stoc insuficient pentru '+product.name+'. Disponibil: '+(product.qty || 0),'err'); log(text,'Stoc insuficient','err'); return true; }
    try{ if(typeof window.executeOperation==='function'){ window.executeOperation(direction,product,amount,text,person || null); return true; } }catch(e){ console.warn('executeOperation failed',e); }
    var before=Number(product.qty || 0);
    product.qty=direction==='in' ? before+amount : before-amount;
    saveStock();
    var result=(direction==='in'?'IN +':'OUT -')+amount+' '+(product.unit || 'buc')+' - '+before+' -> '+product.qty;
    feedback('OK: '+product.name+' '+result,'ok'); log(text,result,direction==='in'?'in':'out'); speak('OK. Stoc '+product.qty+' '+(product.unit || 'buc')+'.');
    return true;
  }
  function route(text){
    var command=String(text || '').trim(); if(!command) return false;
    transcript(command);
    lastAnalysis=analyze(command);
    updateCenter();
    var n=norm(command), now=Date.now();
    if(state.last===n && now-state.at<900) return true;
    state.last=n; state.at=now;
    if(action(command)) { resultHistory(true,'Actiune executata'); updateCenter(); return true; }
    if(site(command)) { resultHistory(true,'Comanda santier executata'); updateCenter(); return true; }
    if(stockCommand(command)) { resultHistory(true,'Comanda stoc procesata'); updateCenter(); return true; }
    try{ if(legacyRoute && legacyRoute!==route){ legacyRoute(command); resultHistory(true,'Ruta veche executata'); updateCenter(); return true; } }catch(e){}
    feedback('Nu am inteles comanda. Exemple: adauga 10 suruburi m6, George a luat bormasina, export PDF.','warn');
    log(command,'Nerecunoscut','err');
    resultHistory(false,'Nerecunoscut');
    updateCenter();
    return false;
  }
  function manual(){ var input=el('manual-input'), value=input?input.value.trim():''; if(!value) return false; if(input) input.value=''; return route(value); }
  function stop(show){ if(state.rec){ try{ state.rec.onend=null; state.rec.abort(); }catch(e){} state.rec=null; } state.listening=false; micState(false); if(show!==false) feedback('Microfon oprit.','warn'); }
  function start(){
    var Speech=window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!Speech){ feedback('Browserul nu suporta vocea aici. Foloseste Chrome/Edge pe HTTPS si permite microfonul.','err'); return; }
    stop(false);
    var rec=new Speech(); state.rec=rec;
    rec.lang=localStorage.getItem('sv_voice_lang') || navigator.language || 'ro-RO';
    rec.continuous=state.mode==='continuous'; rec.interimResults=true; rec.maxAlternatives=3;
    rec.onstart=function(){ state.listening=true; micState(true); feedback('Ascult. Spune comanda completa.','ok'); };
    rec.onresult=function(ev){
      var finalText='', interim='';
      for(var i=ev.resultIndex;i<ev.results.length;i++){ var phrase=ev.results[i][0]?ev.results[i][0].transcript:''; if(ev.results[i].isFinal) finalText+=' '+phrase; else interim+=' '+phrase; }
      var heard=(finalText || interim).trim(); if(heard) transcript(heard);
      if(finalText.trim()){ route(finalText.trim()); if(state.mode!=='continuous') stop(false); }
    };
    rec.onerror=function(ev){ feedback('Eroare microfon: '+((ev && ev.error) || 'necunoscuta')+'. Verifica permisiunea microfonului.','err'); state.listening=false; micState(false); };
    rec.onend=function(){ state.listening=false; micState(false); if(state.mode==='continuous') setTimeout(function(){ if(state.mode==='continuous') start(); },800); };
    try{ rec.start(); }catch(e){ feedback('Nu pot porni microfonul: '+e.message,'err'); micState(false); }
  }
  function toggle(){ if(state.listening || state.rec) stop(true); else start(); }
  function setMode(mode){ state.mode=mode || 'manual'; document.querySelectorAll('.mode-btn').forEach(function(b){ b.classList.toggle('active',b.id==='btn-'+state.mode); }); if(state.mode==='manual') stop(false); else start(); }
  function bind(){
    ensureCenter();
    document.documentElement.setAttribute('data-stocvoce-voice-engine','2026-05-29.1');
    document.addEventListener('click',function(e){
      var manualBtn=e.target && e.target.closest ? e.target.closest('#manual-btn') : null;
      if(manualBtn){ e.preventDefault(); e.stopImmediatePropagation(); manual(); return; }
      var mic=e.target && e.target.closest ? e.target.closest('#mic-btn') : null;
      if(mic){ e.preventDefault(); e.stopImmediatePropagation(); toggle(); return; }
      var mode=e.target && e.target.closest ? e.target.closest('.mode-btn') : null;
      if(mode && mode.id){ e.preventDefault(); e.stopImmediatePropagation(); setMode(mode.id.replace('btn-','')); }
    },true);
    document.addEventListener('keydown',function(e){ if(e.key==='Enter' && e.target && e.target.id==='manual-input'){ e.preventDefault(); e.stopImmediatePropagation(); manual(); } },true);
    feedback('Motor vocal nou incarcat. Comenzile sunt pregatite.','ok');
    updateCenter();
    if(window.MutationObserver){
      var t=el('transcript-display'), f=el('feedback-display');
      if(t) new MutationObserver(updateCenter).observe(t,{childList:true,characterData:true,subtree:true});
      if(f) new MutationObserver(updateCenter).observe(f,{childList:true,characterData:true,subtree:true});
    }
    setInterval(updateCenter,2500);
  }
  window.StocVoceVoiceEngine={route:route,start:start,stop:stop,toggle:toggle,setMode:setMode,manual:manual,version:'2026-05-29.1'};
  window.dispatchVoiceCommand=route;
  window.processManual=manual;
  window.toggleMainMic=toggle;
  window.setMode=setMode;
  window.processCommand=route;
  window.svVoiceAI=window.svVoiceAI || {};
  window.svVoiceAI.route=route;
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind); else bind();
})();
