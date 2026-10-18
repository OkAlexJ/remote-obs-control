// ==================== Soundboard ====================
const SB_POOL_SIZE=16; // max sounds that can genuinely overlap at once
const SB_PLAYER_PREFIX='Soundboard Player ';
const SB_MAX_FILE_MB=10;
$('sbPoolSizeNote').textContent=SB_POOL_SIZE;

let sbState={ boards:[], buttons:{}, sounds:{} };
let sbActiveBoardId=null;
let sbEditingButtonId=null; // null = creating new
let sbSoundMode='existing';
let sbPendingUpload=null;   // {name, dataUrl, duration} staged from file input until Save
let sbPoolByScene={};       // sceneName -> [{sourceName, buttonId}]
let sbPoolCursorByScene={};
let sbPlayingButtons=new Map(); // buttonId -> timeout id (or true for loops)
let sbPreviewAudio=null;
let sbDragId=null;

function sbLoadState(){
  const saved=appStorageGet('soundboard', null);
  sbState=saved && saved.boards ? saved : { boards:[], buttons:{}, sounds:{} };
  sbState.buttons=sbState.buttons||{}; sbState.sounds=sbState.sounds||{};
  if(!sbState.boards.length) sbState.boards=[{ id:uid('b_'), name:'Main', buttonIds:[] }];
  sbActiveBoardId=appStorageGet('sbActiveBoard', null);
  if(!sbState.boards.some(b=>b.id===sbActiveBoardId)) sbActiveBoardId=sbState.boards[0].id;
}
function sbSaveState(){ appStorageSet('soundboard', sbState); }
function sbGetActiveBoard(){ return sbState.boards.find(b=>b.id===sbActiveBoardId) || sbState.boards[0]; }

// ---- Tabs ----
function sbRenderTabs(){
  const wrap=$('sbTabs');
  wrap.innerHTML='';
  sbState.boards.forEach(board=>{
    const tab=document.createElement('div');
    tab.className='sb-tab'+(board.id===sbActiveBoardId?' active':'');
    tab.title='Double-click to rename';
    tab.innerHTML=`<span class="sb-tab-name">${escapeHtml(board.name)}</span><span class="sb-tab-count">${board.buttonIds.length}</span><span class="sb-tab-close" title="Delete board">✕</span>`;
    tab.addEventListener('click',()=>{ sbActiveBoardId=board.id; appStorageSet('sbActiveBoard',board.id); sbRenderTabs(); sbRenderGrid(); });
    tab.addEventListener('dblclick',async()=>{
      const name=await askText('Rename soundboard', board.name);
      if(name){ board.name=name; sbSaveState(); sbRenderTabs(); }
    });
    // Drop a button onto another board's tab to move it there
    tab.addEventListener('dragover',e=>{ if(sbDragId && board.id!==sbActiveBoardId){ e.preventDefault(); tab.classList.add('drop-target'); } });
    tab.addEventListener('dragleave',()=>tab.classList.remove('drop-target'));
    tab.addEventListener('drop',e=>{
      e.preventDefault(); tab.classList.remove('drop-target');
      if(!sbDragId || board.id===sbActiveBoardId) return;
      sbState.boards.forEach(b=>{ b.buttonIds=b.buttonIds.filter(id=>id!==sbDragId); });
      board.buttonIds.push(sbDragId);
      sbSaveState(); sbRenderTabs(); sbRenderGrid();
      notify(`Moved to "${board.name}"`,'ok');
    });
    tab.querySelector('.sb-tab-close').addEventListener('click',async(e)=>{
      e.stopPropagation();
      if(sbState.boards.length<=1){ notify("Can't delete the last soundboard.",'err'); return; }
      if(!await askConfirm(`Delete the "${board.name}" soundboard?`, 'Its buttons are removed (the sounds stay in your library).', 'Delete', true)) return;
      board.buttonIds.forEach(bid=>delete sbState.buttons[bid]);
      sbState.boards=sbState.boards.filter(b=>b.id!==board.id);
      if(sbActiveBoardId===board.id) sbActiveBoardId=sbState.boards[0].id;
      sbSaveState(); sbRenderTabs(); sbRenderGrid(); sbRenderLibrary();
    });
    wrap.appendChild(tab);
  });
  const addTab=document.createElement('button');
  addTab.className='sb-tab-add';
  addTab.textContent='+ Board';
  addTab.addEventListener('click',async()=>{
    const name=await askText('New soundboard','New Board');
    if(!name) return;
    const id=uid('b_');
    sbState.boards.push({ id, name, buttonIds:[] });
    sbActiveBoardId=id; appStorageSet('sbActiveBoard',id);
    sbSaveState(); sbRenderTabs(); sbRenderGrid();
  });
  wrap.appendChild(addTab);
}

// ---- Grid ----
function sbRenderGrid(){
  const grid=$('sbGrid');
  grid.innerHTML='';
  const board=sbGetActiveBoard();
  if(!board) return;
  board.buttonIds=board.buttonIds.filter(bid=>sbState.buttons[bid]);
  board.buttonIds.forEach(bid=>{
    const btn=sbState.buttons[bid];
    const tile=document.createElement('div');
    tile.className='sb-btn'+(sbPlayingButtons.has(bid)?' playing':'');
    tile.style.background=`linear-gradient(160deg, ${btn.color}, ${sbShade(btn.color,-25)})`;
    tile.dataset.buttonId=bid;
    tile.draggable=true;
    tile.title=(btn.loop?'Looping — click again to stop. ':'')+'Right-click for options';
    tile.innerHTML=`
      ${btn.hotkey?`<span class="sb-hotkey">${escapeHtml(btn.hotkey)}</span>`:''}
      <span class="sb-edit" title="Edit">⚙</span>
      <span class="sb-icon">${escapeHtml(btn.icon||'🔊')}</span>
      <span class="sb-name">${escapeHtml(btn.name||'Sound')}</span>
      ${btn.loop?'<span class="sb-loop" title="Loops">🔁</span>':''}
    `;
    tile.addEventListener('click',(e)=>{
      if(e.target.closest('.sb-edit')) return;
      if(btn.loop && sbPlayingButtons.has(bid)) sbStopButton(bid); else sbPlayButton(bid);
    });
    tile.querySelector('.sb-edit').addEventListener('click',(e)=>{ e.stopPropagation(); sbOpenModal(bid); });
    tile.addEventListener('contextmenu',(e)=>{
      e.preventDefault();
      showContextMenu(e.clientX,e.clientY,[
        { label:'Play', run:()=>sbPlayButton(bid) },
        { label:'Stop', run:()=>sbStopButton(bid) },
        { label:'Edit…', run:()=>sbOpenModal(bid) },
        { label:'Duplicate', run:()=>{ const id=uid('btn_'); sbState.buttons[id]={ ...btn, id, name:btn.name+' copy', hotkey:null }; board.buttonIds.splice(board.buttonIds.indexOf(bid)+1,0,id); sbSaveState(); sbRenderGrid(); } },
        { sep:true },
        { label:'Delete', danger:true, run:()=>sbDeleteButton(bid) }
      ]);
    });
    // Drag to reorder
    tile.addEventListener('dragstart',e=>{ sbDragId=bid; tile.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',bid); });
    tile.addEventListener('dragend',()=>{ sbDragId=null; tile.classList.remove('dragging'); document.querySelectorAll('.drop-target').forEach(x=>x.classList.remove('drop-target')); });
    tile.addEventListener('dragover',e=>{ if(sbDragId && sbDragId!==bid){ e.preventDefault(); tile.classList.add('drop-target'); } });
    tile.addEventListener('dragleave',()=>tile.classList.remove('drop-target'));
    tile.addEventListener('drop',e=>{
      e.preventDefault(); tile.classList.remove('drop-target');
      if(!sbDragId || sbDragId===bid) return;
      const ids=board.buttonIds;
      const from=ids.indexOf(sbDragId);
      if(from<0) return;
      ids.splice(from,1);
      ids.splice(ids.indexOf(bid)+(from<=ids.indexOf(bid)?1:0),0,sbDragId);
      sbSaveState(); sbRenderGrid();
    });
    grid.appendChild(tile);
  });
  const addTile=document.createElement('div');
  addTile.className='sb-add-tile';
  addTile.textContent='+';
  addTile.title='Add a soundboard button';
  addTile.addEventListener('click',()=>sbOpenModal(null));
  grid.appendChild(addTile);
}

function sbShade(hex,pct){
  hex=(hex||'#7c5cff').replace('#','');
  if(hex.length===3) hex=hex.split('').map(c=>c+c).join('');
  const num=parseInt(hex,16);
  const adj=c=>Math.max(0,Math.min(255,c+Math.round(255*(pct/100))));
  const r=adj(num>>16), g=adj((num>>8)&0xff), b=adj(num&0xff);
  return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);
}

function sbSetPlayingUI(buttonId,isPlaying,durationMs){
  clearTimeout(sbPlayingButtons.get(buttonId));
  if(isPlaying){
    // Real duration when we know it (measured locally when the sound was added), else a guess
    const t=durationMs===Infinity ? true : setTimeout(()=>sbSetPlayingUI(buttonId,false), durationMs||4000);
    sbPlayingButtons.set(buttonId,t);
  } else sbPlayingButtons.delete(buttonId);
  const tile=document.querySelector(`.sb-btn[data-button-id="${CSS.escape(buttonId)}"]`);
  if(tile) tile.classList.toggle('playing',isPlaying);
}

// Measure a sound's length locally (data URL or direct link) so the "playing" glow lasts the right time
function sbMeasureDuration(src){
  return new Promise(resolve=>{
    const a=new Audio();
    const done=v=>{ a.removeAttribute('src'); resolve(v); };
    a.preload='metadata';
    a.onloadedmetadata=()=>done(isFinite(a.duration)?Math.round(a.duration*1000):null);
    a.onerror=()=>done(null);
    setTimeout(()=>done(null), 8000);
    a.src=src;
  });
}

// ---- Sound library ----
function sbRenderLibrary(){
  const list=$('sbLibraryList');
  const ids=Object.keys(sbState.sounds);
  $('sbLibraryCount').textContent=ids.length?`(${ids.length})`:'';
  if(!ids.length){ list.innerHTML='<div class="empty-note">No sounds added yet.</div>'; return; }
  list.innerHTML='';
  ids.forEach(id=>{
    const s=sbState.sounds[id];
    const usedBy=Object.values(sbState.buttons).filter(b=>b.soundId===id).length;
    const sizeKb=s.kind==='file' ? Math.round((s.data||'').length*0.75/1024) : 0;
    const row=document.createElement('div');
    row.className='sb-source-row';
    row.innerHTML=`
      <span class="sb-source-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
      <span class="sb-source-kind">${s.kind==='url'?'URL':(sizeKb>1024?(sizeKb/1024).toFixed(1)+' MB':sizeKb+' KB')}${s.duration?' · '+(s.duration/1000).toFixed(1)+'s':''} · used by ${usedBy}</span>
      <button class="toggle-btn" data-role="play" title="Preview on this PC">🎧</button>
      <button class="toggle-btn danger" data-role="del" title="Delete from library">🗑</button>
    `;
    row.querySelector('[data-role=play]').addEventListener('click',()=>sbPreviewLocal(s.data));
    row.querySelector('[data-role=del]').addEventListener('click',async()=>{
      if(usedBy>0){ notify(`${usedBy} button(s) still use this sound — change or delete them first.`,'err'); return; }
      if(!await askConfirm('Delete this sound?', s.name, 'Delete', true)) return;
      delete sbState.sounds[id];
      sbSaveState(); sbRenderLibrary();
    });
    list.appendChild(row);
  });
}
$('sbLibraryToggle').addEventListener('click',()=>{
  const collapsed=$('sbLibraryList').classList.toggle('hidden');
  $('sbLibraryCaret').textContent=collapsed?'▸':'▾';
});

function sbPreviewLocal(src){
  if(sbPreviewAudio){ sbPreviewAudio.pause(); sbPreviewAudio=null; }
  if(!src) return;
  sbPreviewAudio=new Audio(src);
  sbPreviewAudio.volume=($('sbButtonModal').classList.contains('hidden')?100:parseInt($('sbFieldVolume').value,10))/100;
  sbPreviewAudio.play().catch(()=>notify("Couldn't play that sound here (is the link a direct audio file?)",'err'));
}

// ---- Editor modal ----
function sbPopulateExistingSelect(){
  const sel=$('sbFieldExisting');
  sel.innerHTML='';
  const ids=Object.keys(sbState.sounds);
  if(!ids.length){ sel.innerHTML='<option value="">(no sounds in library yet — use Upload or URL)</option>'; return; }
  ids.forEach(id=>{ const opt=document.createElement('option'); opt.value=id; opt.textContent=sbState.sounds[id].name; sel.appendChild(opt); });
}
function sbSetSoundMode(mode){
  sbSoundMode=mode;
  document.querySelectorAll('#sbSoundModeToggle button').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  $('sbModeExisting').classList.toggle('hidden',mode!=='existing');
  $('sbModeUpload').classList.toggle('hidden',mode!=='upload');
  $('sbModeUrl').classList.toggle('hidden',mode!=='url');
}
document.querySelectorAll('#sbSoundModeToggle button').forEach(b=>b.addEventListener('click',()=>sbSetSoundMode(b.dataset.mode)));

const sbResetHotkeyField=wireHotkeyField('sbFieldHotkey','sbRecordHotkeyBtn','sbClearHotkeyBtn');

function sbOpenModal(buttonId){
  sbEditingButtonId=buttonId;
  sbPendingUpload=null;
  hideBoxErr('sbModalErr');
  sbPopulateExistingSelect();
  const btn=buttonId?sbState.buttons[buttonId]:null;
  $('sbModalTitle').textContent=btn?'Edit Button':'New Button';
  $('sbFieldName').value=btn?btn.name:'';
  $('sbFieldIcon').value=btn?(btn.icon||'🔊'):'🔊';
  $('sbFieldColor').value=btn?(btn.color||'#7c5cff'):'#7c5cff';
  $('sbFieldVolume').value=btn?btn.volume:100;
  $('sbVolLabel').textContent=(btn?btn.volume:100)+'%';
  $('sbFieldLoop').checked=btn?!!btn.loop:false;
  $('sbFieldOneInstance').checked=btn?!!btn.oneInstance:false;
  $('sbFieldHotkey').value=btn?(btn.hotkey||''):'';
  $('sbFieldUrl').value='';
  $('sbFieldFile').value='';
  $('sbDeleteBtn').style.display=btn?'inline-block':'none';
  if(btn && btn.soundId && sbState.sounds[btn.soundId]){ sbSetSoundMode('existing'); $('sbFieldExisting').value=btn.soundId; }
  else sbSetSoundMode(Object.keys(sbState.sounds).length?'existing':'upload');
  openModal('sbButtonModal','sbModalBackdrop',()=>{ sbResetHotkeyField(); if(sbPreviewAudio){ sbPreviewAudio.pause(); sbPreviewAudio=null; } });
  setTimeout(()=>$('sbFieldName').focus(),0);
}
function sbCloseModal(){ closeModal('sbButtonModal'); }
$('sbModalCancel').addEventListener('click', sbCloseModal);
$('sbModalBackdrop').addEventListener('click', sbCloseModal);
$('sbFieldVolume').addEventListener('input',()=>{ $('sbVolLabel').textContent=$('sbFieldVolume').value+'%'; if(sbPreviewAudio) sbPreviewAudio.volume=$('sbFieldVolume').value/100; });
$('sbFieldName').addEventListener('keydown',e=>{ if(e.key==='Enter') $('sbModalSave').click(); });

$('sbPreviewBtn').addEventListener('click',()=>{
  if(sbSoundMode==='upload' && sbPendingUpload) return sbPreviewLocal(sbPendingUpload.dataUrl);
  if(sbSoundMode==='url' && $('sbFieldUrl').value.trim()) return sbPreviewLocal($('sbFieldUrl').value.trim());
  const id=sbSoundMode==='existing' ? $('sbFieldExisting').value : (sbEditingButtonId && sbState.buttons[sbEditingButtonId].soundId);
  if(id && sbState.sounds[id]) sbPreviewLocal(sbState.sounds[id].data);
  else notify('Pick a sound first','err');
});

$('sbFieldFile').addEventListener('change', async ()=>{
  const file=$('sbFieldFile').files[0];
  sbPendingUpload=null;
  hideBoxErr('sbModalErr');
  if(!file) return;
  if(file.size>SB_MAX_FILE_MB*1024*1024){
    showBoxErr('sbModalErr',`That file is ${(file.size/1048576).toFixed(1)} MB. Keep sounds under ${SB_MAX_FILE_MB} MB — every play sends the whole file to OBS.`);
    $('sbFieldFile').value=''; return;
  }
  try{
    const dataUrl=await readFileAsDataURL(file);
    sbPendingUpload={ name:file.name, dataUrl, duration:await sbMeasureDuration(dataUrl) };
    if(!$('sbFieldName').value.trim()) $('sbFieldName').value=file.name.replace(/\.[^.]+$/,'').slice(0,40);
  }catch(e){ showBoxErr('sbModalErr','Could not read that file.'); }
});

async function sbResolveOrCreateSound(){
  const btn=sbEditingButtonId?sbState.buttons[sbEditingButtonId]:null;
  if(sbSoundMode==='existing'){
    const id=$('sbFieldExisting').value;
    return id && sbState.sounds[id] ? id : null;
  }
  if(sbSoundMode==='upload'){
    if(!sbPendingUpload) return btn?btn.soundId:null; // keep existing sound if no new file chosen while editing
    const id=uid('s_');
    sbState.sounds[id]={ id, name:sbPendingUpload.name, kind:'file', data:sbPendingUpload.dataUrl, duration:sbPendingUpload.duration };
    return id;
  }
  if(sbSoundMode==='url'){
    const url=$('sbFieldUrl').value.trim();
    if(!url) return btn?btn.soundId:null;
    if(!/^https?:\/\//i.test(url)) throw new Error('The link should start with https://');
    const existing=Object.values(sbState.sounds).find(s=>s.kind==='url' && s.data===url);
    if(existing) return existing.id;
    const id=uid('s_');
    let name=url; try{ name=decodeURIComponent(new URL(url).pathname.split('/').pop())||url; }catch(e){}
    sbState.sounds[id]={ id, name, kind:'url', data:url, duration:await sbMeasureDuration(url) };
    return id;
  }
  return null;
}

$('sbModalSave').addEventListener('click',async()=>{
  hideBoxErr('sbModalErr');
  const name=$('sbFieldName').value.trim();
  if(!name) return showBoxErr('sbModalErr','Give it a name.');
  const hotkey=$('sbFieldHotkey').value.trim();
  const conflict=hotkeyConflict(hotkey,'sound',sbEditingButtonId);
  if(conflict) return showBoxErr('sbModalErr',conflict);
  let soundId;
  try{ soundId=await sbResolveOrCreateSound(); }catch(e){ return showBoxErr('sbModalErr',e.message); }
  if(!soundId) return showBoxErr('sbModalErr','Choose, upload, or link a sound first.');

  const data={
    name, icon:$('sbFieldIcon').value.trim()||'🔊', color:$('sbFieldColor').value,
    soundId, volume:parseInt($('sbFieldVolume').value,10),
    loop:$('sbFieldLoop').checked, oneInstance:$('sbFieldOneInstance').checked,
    hotkey:hotkey||null
  };
  if(sbEditingButtonId) sbState.buttons[sbEditingButtonId]={ ...sbState.buttons[sbEditingButtonId], ...data };
  else { const id=uid('btn_'); sbState.buttons[id]={ id, ...data }; sbGetActiveBoard().buttonIds.push(id); }
  sbSaveState();
  sbCloseModal();
  sbRenderTabs(); sbRenderGrid(); sbRenderLibrary();
});

async function sbDeleteButton(id){
  if(!await askConfirm('Delete this soundboard button?', 'The sound itself stays in your library.', 'Delete', true)) return;
  delete sbState.buttons[id];
  sbState.boards.forEach(b=>{ b.buttonIds=b.buttonIds.filter(x=>x!==id); });
  sbSaveState();
  if(!$('sbButtonModal').classList.contains('hidden')) sbCloseModal();
  sbRenderTabs(); sbRenderGrid(); sbRenderLibrary();
}
$('sbDeleteBtn').addEventListener('click',()=>{ if(sbEditingButtonId) sbDeleteButton(sbEditingButtonId); });

// ---- Playback via a pool of hidden OBS browser sources ----
const sbSilentHtml=()=>'<!DOCTYPE html><html><head><style>html,body{margin:0;background:transparent;}</style></head><body></body></html>';

async function sbEnsurePoolSlot(sceneName){
  if(!sbPoolByScene[sceneName]) sbPoolByScene[sceneName]=[];
  if(!sbPoolCursorByScene[sceneName]) sbPoolCursorByScene[sceneName]=0;
  const pool=sbPoolByScene[sceneName];
  // Prefer a free slot we already have
  const free=pool.find(s=>!s.buttonId);
  if(free) return free;
  if(pool.length<SB_POOL_SIZE){
    const name=`${SB_PLAYER_PREFIX}${pool.length+1} (${sceneName})`;
    const [inputs, sceneItems]=await Promise.all([req('GetInputList'), req('GetSceneItemList',{ sceneName })]);
    const exists=!!(inputs && inputs.inputs.some(i=>i.inputName===name));
    const inScene=!!(sceneItems && sceneItems.sceneItems.some(i=>i.sourceName===name));
    if(!exists){
      const d=await sendRequest('CreateInput',{
        sceneName, inputName:name, inputKind:'browser_source',
        inputSettings:{ url:toBase64HtmlUrl(sbSilentHtml()), width:8, height:8 }
      });
      if(!d.requestStatus.result) throw new Error(reqError(d));
    } else if(!inScene){
      // Source exists from a previous session but not in this scene yet. (The old code re-added it
      // every session even when it was already there, piling up duplicate scene items.)
      const d=await sendRequest('CreateSceneItem',{ sceneName, sourceName:name });
      if(!d.requestStatus.result) throw new Error(reqError(d));
    }
    const slot={ sourceName:name, buttonId:null };
    pool.push(slot);
    return slot;
  }
  // Pool is full — round-robin reuse the oldest-assigned slot
  const cursor=sbPoolCursorByScene[sceneName];
  sbPoolCursorByScene[sceneName]=(cursor+1)%SB_POOL_SIZE;
  return pool[cursor];
}

async function sbPlayButton(buttonId){
  const btn=sbState.buttons[buttonId];
  if(!btn) return;
  const sound=sbState.sounds[btn.soundId];
  if(!sound){ notify(`"${btn.name}" has no sound — edit it to add one.`,'err'); return; }
  if(!isConnected()){ notify('Connect to OBS first — sounds play through OBS on the other PC.','err'); return; }
  if(!currentProgramScene){ notify('No live scene — go live on a scene first.','err'); return; }

  if(btn.oneInstance){
    const slot=(sbPoolByScene[currentProgramScene]||[]).find(s=>s.buttonId===buttonId);
    if(slot) await sbStopSlot(slot);
  }
  let slot;
  try{ slot=await sbEnsurePoolSlot(currentProgramScene); }
  catch(e){ notify('Soundboard error: '+e.message,'err'); return; }
  if(slot.buttonId && slot.buttonId!==buttonId) sbSetPlayingUI(slot.buttonId,false);

  slot.buttonId=buttonId;
  const vol=Math.max(0,Math.min(100,btn.volume ?? 100))/100;
  const html=`<!DOCTYPE html><html><head><style>html,body{margin:0;background:transparent;}</style></head><body>
<audio id="a" src="${escapeHtml(sound.data)}" autoplay${btn.loop?' loop':''}></audio>
<script>document.getElementById('a').volume=${vol};<\/script>
</body></html>`;
  const d=await sendRequest('SetInputSettings',{ inputName:slot.sourceName, inputSettings:{ url:toBase64HtmlUrl(html), width:8, height:8 }, overlay:false });
  if(!d.requestStatus.result){ slot.buttonId=null; notify('Could not play: '+reqError(d),'err'); return; }
  sbSetPlayingUI(buttonId,true, btn.loop?Infinity:(sound.duration||null));
  if(!btn.loop && sound.duration) setTimeout(()=>{ if(slot.buttonId===buttonId) slot.buttonId=null; }, sound.duration+250);
  logActivity('Played '+btn.name);
}

async function sbStopSlot(slot){
  slot.buttonId=null;
  await sendRequest('SetInputSettings',{ inputName:slot.sourceName, inputSettings:{ url:toBase64HtmlUrl(sbSilentHtml()), width:8, height:8 }, overlay:false });
}
async function sbStopButton(buttonId){
  for(const pool of Object.values(sbPoolByScene)){
    for(const slot of pool) if(slot.buttonId===buttonId) await sbStopSlot(slot);
  }
  sbSetPlayingUI(buttonId,false);
}
async function sbStopAll(){
  [...sbPlayingButtons.keys()].forEach(id=>sbSetPlayingUI(id,false));
  for(const pool of Object.values(sbPoolByScene)) for(const slot of pool) await sbStopSlot(slot);
}
$('sbStopAllBtn').addEventListener('click', sbStopAll);

// A new OBS session has its own sources, so forget the pool on (re)connect
function sbResetPool(){ sbPoolByScene={}; sbPoolCursorByScene={}; [...sbPlayingButtons.keys()].forEach(id=>sbSetPlayingUI(id,false)); }

function initSoundboardUI(){
  sbLoadState();
  sbRenderTabs();
  sbRenderGrid();
  sbRenderLibrary();
}
