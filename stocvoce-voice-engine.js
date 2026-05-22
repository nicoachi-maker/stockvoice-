(function(){
  'use strict';

  var state = { rec:null, listening:false, mode:'manual', last:'', at:0 };
  var legacyRoute = window.svVoiceAI && typeof window.svVoiceAI.route === 'function' ? window.svVoiceAI.route : null;

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
    var n=norm(command), now=Date.now();
    if(state.last===n && now-state.at<900) return true;
    state.last=n; state.at=now;
    if(action(command)) return true;
    if(site(command)) return true;
    if(stockCommand(command)) return true;
    try{ if(legacyRoute && legacyRoute!==route){ legacyRoute(command); return true; } }catch(e){}
    feedback('Nu am inteles comanda. Exemple: adauga 10 suruburi m6, George a luat bormasina, export PDF.','warn');
    log(command,'Nerecunoscut','err');
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
  }
  window.StocVoceVoiceEngine={route:route,start:start,stop:stop,toggle:toggle,setMode:setMode,manual:manual,version:'2026-05-22.1'};
  window.dispatchVoiceCommand=route;
  window.processManual=manual;
  window.toggleMainMic=toggle;
  window.setMode=setMode;
  window.processCommand=route;
  window.svVoiceAI=window.svVoiceAI || {};
  window.svVoiceAI.route=route;
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind); else bind();
})();
