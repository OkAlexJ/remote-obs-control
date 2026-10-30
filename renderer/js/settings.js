// ==================== Settings: which panels show, look, behavior ====================
const PANELS=[
  { id:'outputs',    name:'Stream & record buttons', desc:'Go Live, Record, Replay, Virtual Cam' },
  { id:'stats',      name:'Performance stats',       desc:'FPS, CPU, dropped frames, bitrate' },
  { id:'scenes',     name:'Scenes',                  desc:'Switch scenes, studio mode' },
  { id:'editor',     name:'Layout editor',           desc:'Live preview — drag & resize sources' },
  { id:'sources',    name:'Sources',                 desc:'Show/hide, lock, add sources' },
  { id:'mixer',      name:'Audio',                   desc:'Volume and mute for each input' },
  { id:'graph',      name:'Audio graph',             desc:'Levels over time' },
  { id:'soundboard', name:'Soundboard',              desc:'Play sounds through OBS' },
  { id:'macros',     name:'Macros',                  desc:'Many actions with one click' },
  { id:'tts',        name:'Text to speech',          desc:'Say anything on stream, incl. ASMR whisper' },
  { id:'captions',   name:'Troll captions',          desc:'Fake live captions under the streamer' },
  { id:'pranks',     name:'Fake notifications',      desc:'iPhone-style pop-ups on their stream' },
  { id:'twitch',     name:'Twitch',                  desc:'Watch, chat, viewer count' },
  { id:'log',        name:'Activity log',            desc:'History of what happened' }
];
const LAYOUT_PRESETS=[
  { id:'essentials', name:'Essentials', desc:'The everyday stuff', hidden:['graph','twitch','log'] },
  { id:'deck',       name:'Button deck', desc:'Big buttons, no editor', hidden:['stats','editor','sources','graph','twitch','log'] },
  { id:'everything', name:'Everything', desc:'Every panel', hidden:[] }
];
const DEFAULT_HIDDEN=LAYOUT_PRESETS[0].hidden;
const THEMES=[
  { id:'violet', name:'Violet', color:'#8b6cff' },
  { id:'ocean',  name:'Ocean',  color:'#2fb4ff' },
  { id:'sunset', name:'Sunset', color:'#ff7a59' },
  { id:'forest', name:'Forest', color:'#3fcf7a' },
  { id:'light',  name:'Light',  color:'#eef0f6' }
];

// ---- Per-profile layout ----
function getLayout(){
  const l=appStorageGet('layout', null);
  return { hidden:l&&Array.isArray(l.hidden)?l.hidden:DEFAULT_HIDDEN.slice(), collapsed:l&&Array.isArray(l.collapsed)?l.collapsed:[] };
}
function saveLayout(l){ appStorageSet('layout', l); applyLayout(); }
function isPanelShown(id){ return !getLayout().hidden.includes(id); }
// Shown and not collapsed — used to skip work (e.g. preview screenshots) for panels you can't see
function panelVisible(id){ const l=getLayout(); return !l.hidden.includes(id) && !l.collapsed.includes(id); }
function setPanelShown(id, on){
  const l=getLayout();
  l.hidden=l.hidden.filter(x=>x!==id);
  if(!on) l.hidden.push(id);
  saveLayout(l);
  if(!$('settingsBox').classList.contains('hidden')) renderSettings();
}
function toggleCollapsed(id){
  const l=getLayout();
  l.collapsed=l.collapsed.includes(id) ? l.collapsed.filter(x=>x!==id) : [...l.collapsed, id];
  saveLayout(l);
}

function applyLayout(){
  const l=getLayout();
  document.querySelectorAll('[data-panel]').forEach(el=>{
    const id=el.dataset.panel;
    el.classList.toggle('panel-off', l.hidden.includes(id));
    el.classList.toggle('collapsed', l.collapsed.includes(id));
  });
  // Containers disappear when everything in them is hidden, so the rest can use the space
  const allOff=ids=>ids.every(id=>l.hidden.includes(id));
  document.querySelector('.main-col').classList.toggle('panel-off', allOff(['editor','graph']));
  document.querySelector('.sidebar').classList.toggle('panel-off', allOff(['sources','mixer','tts','captions','pranks','twitch']));
  document.querySelector('.bottom-grid').classList.toggle('panel-off', allOff(['soundboard','macros']));
  $('outputsPanel').classList.toggle('stats-only', l.hidden.includes('outputs'));
  $('outputsPanel').classList.toggle('panel-off', allOff(['outputs','stats']));
  if(typeof renderStage==='function' && editingScene) requestAnimationFrame(()=>renderStage());
  if(typeof requestVizDraw==='function') requestVizDraw();
}

// Click a panel's title to collapse/expand it
document.addEventListener('click',e=>{
  const h=e.target.closest('[data-panel] > .panel-head > h2');
  if(!h || e.target.closest('button,select,input')) return;
  toggleCollapsed(h.closest('[data-panel]').dataset.panel);
});

// ---- Look ----
function shadeHex(hex,pct){
  const n=parseInt(hex.slice(1),16);
  const adj=c=>Math.max(0,Math.min(255,c+Math.round(255*pct/100)));
  return '#'+[adj(n>>16),adj((n>>8)&255),adj(n&255)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function applyLook(){
  const root=document.documentElement;
  root.setAttribute('data-theme', THEMES.some(t=>t.id===PREFS.theme)?PREFS.theme:'violet');
  if(/^#[0-9a-f]{6}$/i.test(PREFS.accent||'')){
    root.style.setProperty('--accent', PREFS.accent);
    root.style.setProperty('--accent-dark', shadeHex(PREFS.accent,-14));
    root.style.setProperty('--accent-soft', PREFS.accent+'40');
  } else ['--accent','--accent-dark','--accent-soft'].forEach(v=>root.style.removeProperty(v));
  root.style.setProperty('--tile', (parseInt(PREFS.tileSize,10)||110)+'px');
  document.body.classList.toggle('compact', PREFS.density==='compact');
  if(typeof requestVizDraw==='function') requestVizDraw();
}
function nextTheme(){
  const i=THEMES.findIndex(t=>t.id===PREFS.theme);
  const t=THEMES[(i+1)%THEMES.length];
  setPref('theme', t.id); applyLook();
  notify('Theme: '+t.name);
  if(!$('settingsBox').classList.contains('hidden')) renderSettings();
}

async function setPinned(on){
  setPref('pin', !!on);
  if(window.desktop) await window.desktop.win.setPin(!!on);
}
async function togglePin(){
  if(!window.desktop) return;
  await setPinned(!PREFS.pin);
  notify(PREFS.pin?'Window stays on top':'Window no longer on top');
  if(!$('settingsBox').classList.contains('hidden')) renderSettings();
}

// ---- Settings dialog ----
let settingsTab='layout';
function openSettings(tab){
  if(tab) settingsTab=tab;
  renderSettings();
  openModal('settingsBox','settingsBackdrop');
}
function renderSettings(){
  document.querySelectorAll('#settingsTabs button').forEach(b=>b.classList.toggle('active', b.dataset.tab===settingsTab));
  document.querySelectorAll('.settings-tab').forEach(t=>t.classList.toggle('hidden', t.dataset.tab!==settingsTab));
  const inProfile=!!currentProfileId;

  // Layout
  const l=getLayout();
  const presetRow=$('layoutPresets');
  presetRow.innerHTML='';
  LAYOUT_PRESETS.forEach(p=>{
    const b=document.createElement('button');
    b.type='button';
    const active=p.hidden.length===l.hidden.length && p.hidden.every(h=>l.hidden.includes(h));
    b.className='preset'+(active?' active':'');
    b.innerHTML=`<b>${escapeHtml(p.name)}</b><span>${escapeHtml(p.desc)}</span>`;
    b.disabled=!inProfile;
    b.addEventListener('click',()=>{ saveLayout({ hidden:p.hidden.slice(), collapsed:[] }); renderSettings(); });
    presetRow.appendChild(b);
  });
  const toggles=$('panelToggles');
  toggles.innerHTML='';
  PANELS.forEach(p=>{
    const row=document.createElement('label');
    row.className='switch-row';
    row.innerHTML=`<span><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.desc)}</small></span><input type="checkbox" class="switch" ${l.hidden.includes(p.id)?'':'checked'} ${inProfile?'':'disabled'}>`;
    row.querySelector('input').addEventListener('change',e=>setPanelShown(p.id, e.target.checked));
    toggles.appendChild(row);
  });

  // Look
  const themes=$('themeChoices');
  themes.innerHTML='';
  THEMES.forEach(t=>{
    const b=document.createElement('button');
    b.type='button';
    b.className='theme-choice'+(PREFS.theme===t.id?' active':'');
    b.innerHTML=`<span class="theme-dot" style="background:${t.color}"></span>${escapeHtml(t.name)}`;
    b.addEventListener('click',()=>{ setPref('theme',t.id); applyLook(); renderSettings(); });
    themes.appendChild(b);
  });
  $('accentPicker').value=PREFS.accent || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8b6cff';
  $('accentReset').disabled=!PREFS.accent;
  document.querySelectorAll('#densityChoices button').forEach(b=>b.classList.toggle('active', b.dataset.density===PREFS.density));
  $('tileSize').value=PREFS.tileSize;

  // Behavior
  $('optAutoConnect').checked=PREFS.autoConnect;
  $('optConfirmStream').checked=PREFS.confirmStream;
  $('optThumbs').checked=PREFS.thumbs;
  $('optToasts').checked=PREFS.toasts;
  $('optPin').checked=!!PREFS.pin;
  $('optPin').closest('.checkbox-row').classList.toggle('hidden', !window.desktop);
  $('optFps').value=PREFS.fps;
}

document.querySelectorAll('#settingsTabs button').forEach(b=>b.addEventListener('click',()=>{ settingsTab=b.dataset.tab; renderSettings(); }));
$('accentPicker').addEventListener('input',e=>{ setPref('accent', e.target.value); applyLook(); $('accentReset').disabled=false; });
$('accentReset').addEventListener('click',()=>{ setPref('accent',''); applyLook(); renderSettings(); });
document.querySelectorAll('#densityChoices button').forEach(b=>b.addEventListener('click',()=>{ setPref('density', b.dataset.density); applyLook(); renderSettings(); if(editingScene) renderStage(); }));
$('tileSize').addEventListener('input',e=>{ setPref('tileSize', parseInt(e.target.value,10)); applyLook(); });
$('optAutoConnect').addEventListener('change',e=>setPref('autoConnect', e.target.checked));
$('optConfirmStream').addEventListener('change',e=>setPref('confirmStream', e.target.checked));
$('optThumbs').addEventListener('change',e=>{
  setPref('thumbs', e.target.checked);
  document.body.classList.toggle('no-thumbs', !e.target.checked);
  if(e.target.checked && isConnected()) startThumbLoop(); else stopThumbLoop();
});
$('optToasts').addEventListener('change',e=>setPref('toasts', e.target.checked));
$('optPin').addEventListener('change',e=>setPinned(e.target.checked));
$('optFps').addEventListener('change',e=>setPref('fps', e.target.value));
$('settingsDone').addEventListener('click',()=>closeModal('settingsBox'));
$('settingsBackdrop').addEventListener('click',()=>closeModal('settingsBox'));
$('dockSettings').addEventListener('click',()=>openSettings());

// Startup
applyLook();
document.body.classList.toggle('no-thumbs', !PREFS.thumbs);
if(PREFS.pin && window.desktop) window.desktop.win.setPin(true);
