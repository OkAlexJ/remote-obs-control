// ==================== Audio mixer + level meters + activity graph ====================
let audioInputs=[];   // [{ inputName, volumeDb, muted }]
const FADER_MIN_DB=-60;
const mulToDb = mul => mul>0 ? 20*Math.log10(mul) : -Infinity;
const dbToMeterPct = db => db<=FADER_MIN_DB ? 0 : Math.min(100, (db-FADER_MIN_DB)/(-FADER_MIN_DB)*100);
const fmtDb = db => (!isFinite(db) || db<=FADER_MIN_DB) ? '-∞ dB' : (db>0?'+':'')+db.toFixed(1)+' dB';

async function loadAudioInputs(){
  const il=await req('GetInputList');
  const list=$('audioList');
  if(!il || !il.inputs || !il.inputs.length){ list.innerHTML='<div class="empty-note">No inputs found.</div>'; audioInputs=[]; return; }
  const candidates=il.inputs.filter(i=>!isSbPlayerName(i.inputName));
  // In parallel — the old code asked OBS one input at a time, which was slow with many sources
  const results=await Promise.all(candidates.map(async inp=>{
    const [vol, mute]=await Promise.all([
      req('GetInputVolume',{inputName:inp.inputName}),
      req('GetInputMute',{inputName:inp.inputName})
    ]);
    if(!vol) return null;
    return { inputName:inp.inputName, volumeDb:vol.inputVolumeDb, muted: mute?mute.inputMuted:false };
  }));
  audioInputs=results.filter(Boolean);
  renderAudioMixer();
}
$('refreshAudioBtn').addEventListener('click', loadAudioInputs);

function renderAudioMixer(){
  const list=$('audioList');
  list.innerHTML='';
  if(!audioInputs.length){ list.innerHTML='<div class="empty-note">No audio-capable inputs found.</div>'; return; }
  audioInputs.forEach(inp=>{
    const row=document.createElement('div');
    row.className='aud-row';
    row.dataset.input=inp.inputName;
    const db=Math.max(FADER_MIN_DB, Math.min(0, inp.volumeDb));
    row.innerHTML=`
      <div class="aud-col">
        <div class="aud-top">
          <span class="aud-name" title="${escapeHtml(inp.inputName)}">${escapeHtml(inp.inputName)}</span>
          <span class="aud-db" data-role="db">${fmtDb(inp.volumeDb)}</span>
          <button class="toggle-btn ${vizSources.has(inp.inputName)?'':'off'}" data-role="viz" title="Show in Audio Activity graph">📊</button>
          <button class="toggle-btn ${inp.muted?'muted':''}" data-role="mute" title="Mute / unmute">${inp.muted?'🔇':'🔊'}</button>
        </div>
        <input type="range" min="${FADER_MIN_DB}" max="0" step="0.1" value="${db}" data-role="vol" title="Double-click to reset to 0 dB">
        <div class="meter-container"><div class="meter-bar" data-role="meter"></div><div class="meter-peak" data-role="peak"></div></div>
      </div>
    `;
    row.querySelector('[data-role=viz]').addEventListener('click',()=>{
      if(vizSources.has(inp.inputName)){ vizSources.delete(inp.inputName); vizHistory.delete(inp.inputName); }
      else { vizSources.add(inp.inputName); vizHistory.set(inp.inputName, []); }
      appStorageSet('vizSources',[...vizSources]);
      renderAudioMixer(); renderVizLegend(); requestVizDraw();
    });
    row.querySelector('[data-role=mute]').addEventListener('click',()=>setMute(inp, !inp.muted));
    const slider=row.querySelector('[data-role=vol]');
    let rafQ=false;
    const sendVol=()=>{ const v=parseFloat(slider.value); inp.volumeDb=v<=FADER_MIN_DB?-100:v; row.querySelector('[data-role=db]').textContent=fmtDb(inp.volumeDb); req('SetInputVolume',{inputName:inp.inputName,inputVolumeDb:inp.volumeDb}); };
    slider.addEventListener('input',()=>{
      inp.dragging=true;
      if(!rafQ){ rafQ=true; requestAnimationFrame(()=>{ rafQ=false; sendVol(); }); }
    });
    slider.addEventListener('change',()=>{ inp.dragging=false; sendVol(); });
    slider.addEventListener('dblclick',()=>{ slider.value=0; sendVol(); });
    list.appendChild(row);
    inp.el=row;
  });
}

async function setMute(inp, muted){
  const d=await sendRequest('SetInputMute',{inputName:inp.inputName,inputMuted:muted});
  if(!d.requestStatus.result){ notify('Could not change mute: '+reqError(d),'err'); return; }
  inp.muted=muted;
  updateMuteUI(inp);
  logActivity((muted?'Muted ':'Unmuted ')+inp.inputName);
}
function updateMuteUI(inp){
  if(!inp.el) return;
  const b=inp.el.querySelector('[data-role=mute]');
  b.classList.toggle('muted',inp.muted); b.textContent=inp.muted?'🔇':'🔊';
}

// ---- Live updates from OBS ----
obsOn('InputMuteStateChanged', d=>{
  const inp=audioInputs.find(i=>i.inputName===d.inputName);
  if(inp && inp.muted!==d.inputMuted){ inp.muted=d.inputMuted; updateMuteUI(inp); }
});
obsOn('InputVolumeChanged', d=>{
  const inp=audioInputs.find(i=>i.inputName===d.inputName);
  if(!inp || inp.dragging) return;
  inp.volumeDb=d.inputVolumeDb;
  if(inp.el){
    inp.el.querySelector('[data-role=vol]').value=Math.max(FADER_MIN_DB, Math.min(0, d.inputVolumeDb));
    inp.el.querySelector('[data-role=db]').textContent=fmtDb(d.inputVolumeDb);
  }
});
let audioReloadTimer=null;
const audioReloadSoon=()=>{ clearTimeout(audioReloadTimer); audioReloadTimer=setTimeout(loadAudioInputs, 200); };
obsOn('InputCreated', audioReloadSoon);
obsOn('InputRemoved', audioReloadSoon);
obsOn('InputNameChanged', d=>{
  if(vizSources.has(d.oldInputName)){ vizSources.delete(d.oldInputName); vizSources.add(d.inputName); appStorageSet('vizSources',[...vizSources]); }
  audioReloadSoon();
});

// Meters: obs-websocket sends levels for every input ~20 times a second
const peakHold=new Map(); // inputName -> { db, t }
obsOn('InputVolumeMeters', d=>{
  const now=performance.now();
  d.inputs.forEach(input=>{
    let mag=0, peak=0;
    (input.inputLevelsMul||[]).forEach(ch=>{ mag=Math.max(mag, ch[0]||0); peak=Math.max(peak, ch[1]||0); });
    const inp=audioInputs.find(i=>i.inputName===input.inputName);
    if(inp && inp.el){
      const peakDb=mulToDb(peak);
      const bar=inp.el.querySelector('[data-role=meter]');
      bar.style.width=dbToMeterPct(peakDb)+'%';
      bar.classList.toggle('clip', peakDb>-1);
      const held=peakHold.get(input.inputName);
      if(!held || peakDb>=held.db || now-held.t>1500) peakHold.set(input.inputName,{ db:peakDb, t:now });
      inp.el.querySelector('[data-role=peak]').style.left=dbToMeterPct(peakHold.get(input.inputName).db)+'%';
    }
    if(vizSources.has(input.inputName)){
      const hist=vizHistory.get(input.inputName) || [];
      hist.push(mag);
      if(hist.length>VIZ_MAX_POINTS) hist.shift();
      vizHistory.set(input.inputName, hist);
    }
  });
  if(vizSources.size) requestVizDraw();
});

// ==================== Audio activity graph ====================
const vizSources=new Set();
const vizHistory=new Map();
const vizColorOverrides=new Map();
const VIZ_MAX_POINTS=200;
const VIZ_COLORS=['#8b6cff','#3fbf6f','#e0b23f','#ff5c5c','#3fa7bf','#e05cff','#bfa03f','#5c7cff'];
let vizDrawQueued=false;
let vizStyle='line';

function vizColorFor(name){
  if(vizColorOverrides.has(name)) return vizColorOverrides.get(name);
  let hash=0; for(let i=0;i<name.length;i++) hash=(hash*31+name.charCodeAt(i))>>>0;
  return VIZ_COLORS[hash % VIZ_COLORS.length];
}
function setVizColor(name,color){
  vizColorOverrides.set(name,color);
  appStorageSet('vizColors', Object.fromEntries(vizColorOverrides));
  requestVizDraw();
}
function requestVizDraw(){
  if(vizDrawQueued) return;
  vizDrawQueued=true;
  requestAnimationFrame(()=>{ vizDrawQueued=false; drawViz(); });
}

// Size the canvas buffer to its on-screen size × devicePixelRatio (it used to be a fixed 900px stretched blurry)
function fitVizCanvas(){
  const canvas=$('audioVizCanvas');
  const dpr=window.devicePixelRatio||1;
  const w=Math.round(canvas.clientWidth*dpr), h=Math.round(canvas.clientHeight*dpr);
  if(w && h && (canvas.width!==w || canvas.height!==h)){ canvas.width=w; canvas.height=h; }
  return dpr;
}
new ResizeObserver(()=>requestVizDraw()).observe($('audioVizCanvas'));

function drawViz(){
  const canvas=$('audioVizCanvas');
  if(!canvas || !canvas.clientWidth) return;
  const dpr=fitVizCanvas();
  const ctx=canvas.getContext('2d');
  const w=canvas.width, h=canvas.height;
  const css=getComputedStyle(document.documentElement);
  const muted=css.getPropertyValue('--muted').trim()||'#888';
  const border=css.getPropertyValue('--border').trim()||'#333';
  ctx.clearRect(0,0,w,h);
  const names=[...vizSources];
  ctx.font=`${11*dpr}px Segoe UI, sans-serif`;
  if(!names.length){
    ctx.fillStyle=muted;
    ctx.fillText('Click 📊 on an input in the Audio Mixer to graph it here.', 10*dpr, h/2);
    return;
  }
  const bandH=h/names.length;
  names.forEach((name,idx)=>{
    const hist=vizHistory.get(name)||[];
    const color=vizColorFor(name);
    const top=idx*bandH;
    const pad=Math.min(4*dpr,bandH*0.08);
    const plotTop=top+pad, plotH=bandH-pad*2, plotBottom=plotTop+plotH;
    // Plot in dB so quiet sources are still visible
    const yFor=lvl=>plotBottom-(dbToMeterPct(mulToDb(lvl))/100)*plotH;
    const xFor=i=>(i/(VIZ_MAX_POINTS-1))*w;
    if(idx>0){ ctx.strokeStyle=border; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(0,top); ctx.lineTo(w,top); ctx.stroke(); }
    ctx.fillStyle=muted; ctx.fillText(name, 6*dpr, top+13*dpr);
    if(!hist.length) return;
    const offset=VIZ_MAX_POINTS-hist.length; // newest sample is always at the right edge
    if(vizStyle==='bars'){
      ctx.fillStyle=color+'aa';
      const slot=w/VIZ_MAX_POINTS;
      hist.forEach((lvl,i)=>{ const x=xFor(i+offset), y=yFor(lvl); ctx.fillRect(x,y,Math.max(1,slot-1),plotBottom-y); });
    } else if(vizStyle==='dots'){
      ctx.fillStyle=color;
      hist.forEach((lvl,i)=>{ ctx.beginPath(); ctx.arc(xFor(i+offset),yFor(lvl),2*dpr,0,Math.PI*2); ctx.fill(); });
    } else {
      ctx.strokeStyle=color; ctx.lineWidth=(vizStyle==='area'?1.5:2)*dpr;
      ctx.beginPath();
      hist.forEach((lvl,i)=>{ const x=xFor(i+offset), y=yFor(lvl); if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); });
      if(vizStyle==='area'){
        ctx.stroke();
        ctx.lineTo(w,plotBottom); ctx.lineTo(xFor(offset),plotBottom); ctx.closePath();
        ctx.fillStyle=color+'55'; ctx.fill();
      } else ctx.stroke();
    }
  });
}

function renderVizLegend(){
  const legend=$('audioVizLegend');
  legend.innerHTML='';
  if(!vizSources.size){ legend.innerHTML='<span>No inputs selected.</span>'; return; }
  vizSources.forEach(name=>{
    const span=document.createElement('span');
    span.className='viz-legend-item';
    const swatch=document.createElement('input');
    swatch.type='color';
    swatch.value=vizColorFor(name);
    swatch.title="Change this line's color";
    swatch.addEventListener('input',()=>setVizColor(name, swatch.value));
    const label=document.createElement('span');
    label.textContent=name;
    span.appendChild(swatch); span.appendChild(label);
    legend.appendChild(span);
  });
}

$('vizStyleSelect').addEventListener('change',()=>{ vizStyle=$('vizStyleSelect').value; appStorageSet('vizStyle',vizStyle); requestVizDraw(); });

function initAudioPrefs(){
  vizColorOverrides.clear(); vizSources.clear(); vizHistory.clear();
  const saved=appStorageGet('vizColors', null);
  if(saved) Object.entries(saved).forEach(([name,color])=>vizColorOverrides.set(name,color));
  appStorageGet('vizSources', []).forEach(n=>{ vizSources.add(n); vizHistory.set(n,[]); });
  vizStyle=appStorageGet('vizStyle','line');
  $('vizStyleSelect').value=vizStyle;
  renderVizLegend();
  requestVizDraw();
}
