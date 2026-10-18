// ==================== Command palette (Ctrl+K) ====================
let paletteItems=[], paletteFiltered=[], paletteActiveIndex=0;
const PALETTE_LIMIT=40;

function buildPaletteItems(){
  const items=[];
  scenesData.forEach(s=>{
    items.push({ kind:'Scene', label:'Go live: '+s.sceneName, run:()=>goLive(s.sceneName) });
    items.push({ kind:'Scene', label:'Edit layout: '+s.sceneName, run:()=>loadScene(s.sceneName) });
  });
  visibleItems().forEach(it=>{
    items.push({ kind:'Source', label:(it.sceneItemEnabled===false?'Show: ':'Hide: ')+it.sourceName, run:()=>setItemEnabled(it, it.sceneItemEnabled===false) });
  });
  audioInputs.forEach(inp=>{
    items.push({ kind:'Audio', label:(inp.muted?'Unmute: ':'Mute: ')+inp.inputName, run:()=>setMute(inp,!inp.muted) });
  });
  Object.values(sbState.buttons||{}).forEach(b=>{
    items.push({ kind:'Sound', label:'Play: '+b.name, hint:b.hotkey, run:()=>sbPlayButton(b.id) });
  });
  macrosState.forEach(m=>{
    items.push({ kind:'Macro', label:'Run macro: '+m.name, hint:m.hotkey, run:()=>runMacro(m.id) });
  });
  if(isConnected()){
    items.push({ kind:'Output', label:outputs.stream.active?'Stop streaming':'Start streaming', run:toggleStream });
    items.push({ kind:'Output', label:outputs.record.active?'Stop recording':'Start recording', run:toggleRecord });
    if(outputs.record.active) items.push({ kind:'Output', label:outputs.record.paused?'Resume recording':'Pause recording', run:toggleRecordPause });
    if(outputs.replay.available) items.push({ kind:'Output', label:outputs.replay.active?'Stop replay buffer':'Start replay buffer', run:toggleReplay });
    if(outputs.replay.active) items.push({ kind:'Output', label:'Save replay clip', run:saveReplay });
    if(outputs.vcam.available) items.push({ kind:'Output', label:outputs.vcam.active?'Stop virtual camera':'Start virtual camera', run:toggleVcam });
    items.push({ kind:'Action', label:studioMode?'Turn off studio mode':'Turn on studio mode', run:()=>$('studioToggleBtn').click() });
    if(studioMode) items.push({ kind:'Action', label:'Transition preview → live', run:()=>$('transitionBtn').click() });
    items.push({ kind:'Action', label:'Save scene screenshot', run:()=>$('screenshotBtn').click() });
    items.push({ kind:'Action', label:'Disconnect from OBS', run:disconnectObs });
  } else if($('host').value.trim()) {
    items.push({ kind:'Action', label:'Connect to '+$('host').value.trim(), run:()=>$('connectBtn').click() });
  }
  items.push({ kind:'Action', label:'Stop all sounds', run:sbStopAll });
  items.push({ kind:'Action', label:'New soundboard button', run:()=>sbOpenModal(null) });
  items.push({ kind:'Action', label:'New macro', run:()=>openMacroModal(null) });
  items.push({ kind:'App', label:'Settings', run:openSettings });
  items.push({ kind:'App', label:'Change theme', run:nextTheme });
  PANELS.forEach(p=>items.push({ kind:'Layout', label:(isPanelShown(p.id)?'Hide ':'Show ')+p.name+' panel', run:()=>setPanelShown(p.id,!isPanelShown(p.id)) }));
  items.push({ kind:'App', label:'Switch profile', run:openQuickSwitcher });
  items.push({ kind:'App', label:'Keyboard shortcuts', run:openHelp });
  return items;
}

// Every word in the query must appear somewhere in the label (so "live game" finds "Go live: Gameplay")
function paletteFilter(q){
  const words=q.toLowerCase().split(/\s+/).filter(Boolean);
  if(!words.length) return paletteItems;
  return paletteItems
    .map(i=>{ const l=(i.label+' '+i.kind).toLowerCase(); return { i, ok:words.every(w=>l.includes(w)), score:l.indexOf(words[0]) }; })
    .filter(x=>x.ok).sort((a,b)=>a.score-b.score).map(x=>x.i);
}

function openCommandPalette(){
  paletteItems=buildPaletteItems();
  paletteFiltered=paletteItems;
  paletteActiveIndex=0;
  $('paletteInput').value='';
  renderPaletteResults();
  openModal('commandPalette','paletteBackdrop');
  $('paletteInput').focus();
}
function closeCommandPalette(){ closeModal('commandPalette'); }
$('paletteBackdrop').addEventListener('click', closeCommandPalette);

function renderPaletteResults(){
  const wrap=$('paletteResults');
  wrap.innerHTML='';
  if(!paletteFiltered.length){ wrap.innerHTML='<div class="palette-empty">No matches.</div>'; return; }
  paletteFiltered.slice(0,PALETTE_LIMIT).forEach((item,i)=>{
    const row=document.createElement('div');
    row.className='palette-item'+(i===paletteActiveIndex?' active':'');
    row.innerHTML=`<span>${escapeHtml(item.label)}</span>${item.hint?`<kbd>${escapeHtml(item.hint)}</kbd>`:''}<span class="palette-kind">${escapeHtml(item.kind)}</span>`;
    row.addEventListener('click',()=>{ closeCommandPalette(); item.run(); });
    row.addEventListener('mousemove',()=>{ if(paletteActiveIndex!==i){ paletteActiveIndex=i; wrap.querySelectorAll('.palette-item').forEach((r,j)=>r.classList.toggle('active',j===i)); } });
    wrap.appendChild(row);
  });
  const active=wrap.querySelector('.palette-item.active');
  if(active) active.scrollIntoView({ block:'nearest' });
}

$('paletteInput').addEventListener('input',()=>{
  paletteFiltered=paletteFilter($('paletteInput').value.trim());
  paletteActiveIndex=0;
  renderPaletteResults();
});
$('paletteInput').addEventListener('keydown',(e)=>{
  const max=Math.min(paletteFiltered.length,PALETTE_LIMIT)-1;
  if(e.key==='ArrowDown'){ e.preventDefault(); paletteActiveIndex=paletteActiveIndex>=max?0:paletteActiveIndex+1; renderPaletteResults(); }
  else if(e.key==='ArrowUp'){ e.preventDefault(); paletteActiveIndex=paletteActiveIndex<=0?Math.max(0,max):paletteActiveIndex-1; renderPaletteResults(); }
  else if(e.key==='Enter'){ e.preventDefault(); const item=paletteFiltered[paletteActiveIndex]; if(item){ closeCommandPalette(); item.run(); } }
});
$('openSearchBtn').addEventListener('click', openCommandPalette);

// ==================== Quick profile switcher (Ctrl+P) ====================
async function openQuickSwitcher(){
  if(!window.desktop){ notify('Profiles need the desktop app'); return; }
  const profiles=await window.desktop.profiles.list();
  const list=$('qsList');
  list.innerHTML='';
  const rows=[];
  profiles.sort((a,b)=>(b.lastUsedAt||0)-(a.lastUsedAt||0)).forEach(p=>{
    const row=document.createElement('div');
    row.className='qs-row'+(p.id===currentProfileId?' current':'');
    row.innerHTML=`<span class="qs-avatar">${escapeHtml(p.avatar||'🎬')}</span><span>${escapeHtml(p.name)}</span>${p.id===currentProfileId?'<span class="palette-kind">current</span>':''}`;
    row.addEventListener('click', async ()=>{
      closeQuickSwitcher();
      if(p.id===currentProfileId) return;
      await leaveCurrentProfile();
      plConnections=await window.desktop.connections.list();
      await plSelectProfile(p);
    });
    list.appendChild(row); rows.push(row);
  });
  const manageRow=document.createElement('div');
  manageRow.className='qs-row muted';
  manageRow.innerHTML=`<span class="qs-avatar">⚙</span><span>Manage all profiles…</span>`;
  manageRow.addEventListener('click',()=>{ closeQuickSwitcher(); goToFullLauncher(); });
  list.appendChild(manageRow); rows.push(manageRow);

  // Arrow keys + Enter
  let active=Math.max(0, rows.findIndex(r=>!r.classList.contains('current')));
  const paint=()=>rows.forEach((r,i)=>r.classList.toggle('active',i===active));
  paint();
  quickSwitcherKeys=(e)=>{
    if(e.key==='ArrowDown'){ e.preventDefault(); active=(active+1)%rows.length; paint(); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); active=(active-1+rows.length)%rows.length; paint(); }
    else if(e.key==='Enter'){ e.preventDefault(); rows[active].click(); }
  };
  openModal('quickSwitcher','switcherBackdrop');
}
let quickSwitcherKeys=null;
window.addEventListener('keydown',e=>{ if(quickSwitcherKeys && !$('quickSwitcher').classList.contains('hidden')) quickSwitcherKeys(e); });
function closeQuickSwitcher(){ closeModal('quickSwitcher'); }
$('switcherBackdrop').addEventListener('click', closeQuickSwitcher);
$('openSwitcherBtn').addEventListener('click', openQuickSwitcher);
$('profileChip').addEventListener('click', openQuickSwitcher);

// ==================== Help ====================
function openHelp(){ openModal('helpBox','helpBackdrop'); }
$('dockHelp').addEventListener('click',openHelp);
$('helpBackdrop').addEventListener('click',()=>closeModal('helpBox'));
