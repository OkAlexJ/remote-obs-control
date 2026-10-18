// ==================== Shared helpers ====================
const $ = id => document.getElementById(id);

// App-wide preferences (the same for every profile); edited in Settings
const PREF_DEFAULTS={ theme:'violet', accent:'', density:'comfortable', tileSize:110, autoConnect:true, confirmStream:true, thumbs:true, toasts:true, fps:'15' };
const PREFS=(()=>{ try{ return { ...PREF_DEFAULTS, ...JSON.parse(localStorage.getItem('prefs')||'{}') }; }catch(e){ return { ...PREF_DEFAULTS }; } })();
function setPref(key, value){
  PREFS[key]=value;
  try{ localStorage.setItem('prefs', JSON.stringify(PREFS)); }catch(e){}
}

function escapeHtml(s){ return String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function cssSafe(s){ return String(s ?? '').replace(/[^a-zA-Z0-9]/g,'_'); }
function uid(prefix){ return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
const sleep = ms => new Promise(r=>setTimeout(r, ms));
function isTyping(){
  const el=document.activeElement;
  if(!el) return false;
  const tag=el.tagName;
  return tag==='INPUT' || tag==='TEXTAREA' || tag==='SELECT' || el.isContentEditable;
}
function showBoxErr(id, msg){ const el=$(id); el.textContent=msg; el.classList.remove('hidden'); }
function hideBoxErr(id){ $(id).classList.add('hidden'); }

function formatDuration(ms){
  const s=Math.max(0, Math.floor(ms/1000));
  const h=Math.floor(s/3600), m=Math.floor(s/60)%60, sec=s%60;
  const p=n=>String(n).padStart(2,'0');
  return (h?h+':':'')+p(m)+':'+p(sec);
}

function readFileAsText(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(r.result);
    r.onerror=()=>reject(new Error('Could not read file.'));
    r.readAsText(file);
  });
}
function readFileAsDataURL(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(r.result);
    r.onerror=()=>reject(new Error('Could not read file.'));
    r.readAsDataURL(file);
  });
}
function toBase64HtmlUrl(htmlString){
  return 'data:text/html;charset=utf-8;base64,' + btoa(unescape(encodeURIComponent(htmlString)));
}

// ==================== Modal stack (Esc closes the topmost) ====================
const modalStack=[];
function openModal(id, backdropId, onClose){
  $(id).classList.remove('hidden');
  if(backdropId) $(backdropId).classList.remove('hidden');
  const existing=modalStack.findIndex(m=>m.id===id);
  if(existing>=0) modalStack.splice(existing,1);
  modalStack.push({ id, backdropId, onClose });
}
function closeModal(id){
  const idx=modalStack.findIndex(m=>m.id===id);
  const entry=idx>=0 ? modalStack.splice(idx,1)[0] : null;
  $(id).classList.add('hidden');
  const backdropId=entry ? entry.backdropId : null;
  if(backdropId) $(backdropId).classList.add('hidden');
  if(entry && entry.onClose) entry.onClose();
}
function isModalOpen(){ return modalStack.length>0; }
function closeTopModal(){
  const top=modalStack[modalStack.length-1];
  if(!top) return false;
  closeModal(top.id);
  return true;
}

// ==================== Dialogs (prompt/confirm/alert replacements) ====================
// Electron doesn't implement window.prompt(), so the old "+ Board" / rename buttons silently did nothing.
let dialogResolve=null;
function showDialog({ title, message='', input=null, okText='OK', cancelText='Cancel', danger=false, noCancel=false }){
  return new Promise(resolve=>{
    if(dialogResolve) dialogResolve(null);
    dialogResolve=resolve;
    $('dialogTitle').textContent=title||'';
    $('dialogMessage').textContent=message;
    $('dialogMessage').classList.toggle('hidden', !message);
    const inp=$('dialogInput');
    inp.classList.toggle('hidden', input===null);
    inp.value=input ?? '';
    $('dialogOk').textContent=okText;
    $('dialogOk').classList.toggle('danger', danger);
    $('dialogCancel').textContent=cancelText;
    $('dialogCancel').classList.toggle('hidden', noCancel);
    openModal('dialogBox','dialogBackdrop',()=>{ if(dialogResolve){ const r=dialogResolve; dialogResolve=null; r(null); } });
    setTimeout(()=>{ if(input!==null){ inp.focus(); inp.select(); } else $('dialogOk').focus(); }, 0);
  });
}
function finishDialog(value){
  const r=dialogResolve; dialogResolve=null;
  closeModal('dialogBox');
  if(r) r(value);
}
$('dialogOk').addEventListener('click',()=>finishDialog($('dialogInput').classList.contains('hidden') ? true : $('dialogInput').value));
$('dialogCancel').addEventListener('click',()=>finishDialog(null));
$('dialogBackdrop').addEventListener('click',()=>finishDialog(null));
$('dialogInput').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); $('dialogOk').click(); } });

async function askText(title, defaultValue='', message=''){
  const v=await showDialog({ title, message, input:defaultValue });
  return v===null ? null : String(v).trim();
}
async function askConfirm(title, message, okText='OK', danger=false){
  return !!(await showDialog({ title, message, okText, danger }));
}
function tellUser(title, message){ return showDialog({ title, message, noCancel:true }); }

// ==================== Right-click menu ====================
// items: [{label, run, danger}] or {sep:true}
function showContextMenu(x, y, items){
  hideContextMenu();
  const menu=document.createElement('div');
  menu.id='ctxMenu';
  menu.className='ctx-menu';
  items.forEach(it=>{
    if(it.sep){ const s=document.createElement('div'); s.className='ctx-sep'; menu.appendChild(s); return; }
    const b=document.createElement('button');
    b.type='button';
    b.className='ctx-item'+(it.danger?' danger':'');
    b.textContent=it.label;
    b.addEventListener('click',()=>{ hideContextMenu(); it.run(); });
    menu.appendChild(b);
  });
  document.body.appendChild(menu);
  const r=menu.getBoundingClientRect();
  menu.style.left=Math.min(x, window.innerWidth-r.width-8)+'px';
  menu.style.top=Math.min(y, window.innerHeight-r.height-8)+'px';
  setTimeout(()=>document.addEventListener('mousedown', ctxOutside, true), 0);
}
function ctxOutside(e){ const m=$('ctxMenu'); if(m && !m.contains(e.target)) hideContextMenu(); }
function hideContextMenu(){
  const m=$('ctxMenu'); if(m) m.remove();
  document.removeEventListener('mousedown', ctxOutside, true);
}
window.addEventListener('blur', hideContextMenu);
window.addEventListener('keydown', e=>{ if(e.key==='Escape' && $('ctxMenu')){ hideContextMenu(); e.stopImmediatePropagation(); } }, true);

// ==================== Toast notifications ====================
function notify(message, type){
  if(!PREFS.toasts && type!=='err') return; // errors always show
  const stack=$('toastStack');
  const el=document.createElement('div');
  el.className='toast'+(type?' '+type:'');
  el.textContent=message;
  stack.appendChild(el);
  while(stack.children.length>5) stack.firstChild.remove();
  setTimeout(()=>{
    el.classList.add('leaving');
    setTimeout(()=>el.remove(),200);
  },3200);
}

// ==================== App storage layer (profile-scoped) ====================
// Uses the Electron main process (disk-backed, per profile) when running as the desktop app;
// falls back to localStorage when opened as a plain web page. Writes are debounced, because the
// store can hold uploaded sounds and used to be rewritten in full on every log line / color tweak.
let currentProfileId=null;
let appStorageCache={};
let appStorageTimer=null;

async function appStorageLoad(){
  if(window.desktop){
    appStorageCache = await window.desktop.store.get(currentProfileId) || {};
  } else {
    try{ appStorageCache = JSON.parse(localStorage.getItem('obsControlStore_'+(currentProfileId||'default'))||'{}'); }
    catch(e){ appStorageCache={}; }
  }
}
function appStorageGet(key, fallback){
  return (key in appStorageCache) ? appStorageCache[key] : fallback;
}
function appStorageSet(key, value){
  appStorageCache[key]=value;
  clearTimeout(appStorageTimer);
  appStorageTimer=setTimeout(appStorageFlush, 400);
}
function appStorageFlush(){
  clearTimeout(appStorageTimer); appStorageTimer=null;
  if(!currentProfileId) return;
  if(window.desktop){
    window.desktop.store.set(currentProfileId, appStorageCache);
  } else {
    try{ localStorage.setItem('obsControlStore_'+(currentProfileId||'default'), JSON.stringify(appStorageCache)); }catch(e){}
  }
}
window.addEventListener('beforeunload', ()=>{ if(appStorageTimer) appStorageFlush(); });

// ==================== Activity log ====================
const ACTIVITY_LOG_MAX=200;

function logActivity(text){
  const log=appStorageGet('activityLog', []);
  log.unshift({ t: Date.now(), text });
  if(log.length>ACTIVITY_LOG_MAX) log.length=ACTIVITY_LOG_MAX;
  appStorageSet('activityLog', log);
  renderActivityLog();
}

function renderActivityLog(){
  const list=$('activityLogList');
  if(!list) return;
  const log=appStorageGet('activityLog', []);
  if(!log.length){ list.innerHTML='<div class="empty-note">Nothing yet.</div>'; return; }
  list.innerHTML='';
  const today=new Date().toDateString();
  log.forEach(entry=>{
    const row=document.createElement('div');
    row.className='log-row';
    const d=new Date(entry.t);
    const time=d.toLocaleTimeString([], {hour:'numeric', minute:'2-digit', second:'2-digit'});
    const day=d.toDateString()===today ? '' : d.toLocaleDateString([], {month:'short', day:'numeric'})+' ';
    row.innerHTML=`<span class="log-time">${escapeHtml(day+time)}</span><span>${escapeHtml(entry.text)}</span>`;
    list.appendChild(row);
  });
}

$('clearLogBtn').addEventListener('click',async()=>{
  if(!await askConfirm('Clear the activity log?', 'This removes every entry for this profile.', 'Clear', true)) return;
  appStorageSet('activityLog', []);
  renderActivityLog();
});

// Dropping a file anywhere outside a file input must not navigate the window away from the app
window.addEventListener('dragover', e=>{ if(!(e.target instanceof HTMLInputElement && e.target.type==='file')) e.preventDefault(); });
window.addEventListener('drop', e=>{ if(!(e.target instanceof HTMLInputElement && e.target.type==='file')) e.preventDefault(); });
