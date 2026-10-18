// ==================== Scenes, studio mode & transitions ====================
let scenesData=[], currentProgramScene=null, currentPreviewScene=null, editingScene=null;
let studioMode=false;
const sceneThumbs=new Map();   // sceneName -> data URL (so re-rendering the strip doesn't flash)
let thumbTimer=null;
let sceneHotkeyRecordingFor=null;

async function loadScenes(){
  const sl=await req('GetSceneList');
  if(!sl) return;
  // OBS lists scenes bottom-up; reverse so the strip matches the order in OBS's Scenes dock
  scenesData=sl.scenes.slice().reverse();
  currentProgramScene=sl.currentProgramSceneName;
  currentPreviewScene=sl.currentPreviewSceneName||null;
  if(!editingScene || !scenesData.some(s=>s.sceneName===editingScene)) editingScene=currentProgramScene;
  renderSceneTabs();
}

async function loadStudioAndTransitions(){
  const sm=await req('GetStudioModeEnabled');
  setStudioModeUI(!!(sm && sm.studioModeEnabled));
  const tl=await req('GetSceneTransitionList');
  const sel=$('transitionSelect');
  sel.innerHTML='';
  if(tl && tl.transitions){
    tl.transitions.forEach(t=>{
      const o=document.createElement('option'); o.value=t.transitionName; o.textContent=t.transitionName; sel.appendChild(o);
    });
    sel.value=tl.currentSceneTransitionName||'';
  }
  const ct=await req('GetCurrentSceneTransition');
  if(ct){
    $('transitionDuration').value=ct.transitionDuration ?? '';
    $('transitionDuration').disabled=!!ct.transitionFixed;
  }
}

function setStudioModeUI(on){
  studioMode=on;
  $('studioBadge').classList.toggle('hidden',!on);
  $('transitionBtn').classList.toggle('hidden',!on);
  $('studioToggleBtn').classList.toggle('on',on);
  renderSceneTabs();
}

// "Go live": straight to program, or — in studio mode — to preview, ready for the Transition button
async function goLive(sceneName){
  const d=await sendRequest('SetCurrentProgramScene',{sceneName});
  if(!d.requestStatus.result){ notify(`Couldn't switch to "${sceneName}": ${reqError(d)}`,'err'); return false; }
  currentProgramScene=sceneName;
  renderSceneTabs();
  return true;
}
async function sendToPreview(sceneName){
  const d=await sendRequest('SetCurrentPreviewScene',{sceneName});
  if(!d.requestStatus.result){ notify(`Couldn't preview "${sceneName}": ${reqError(d)}`,'err'); return; }
  currentPreviewScene=sceneName; renderSceneTabs();
}

function renderSceneTabs(){
  const strip=$('sceneStrip');
  strip.innerHTML='';
  const sceneHotkeys=appStorageGet('sceneHotkeys', {});
  scenesData.forEach(s=>{
    const name=s.sceneName;
    const tab=document.createElement('div');
    const isLive=name===currentProgramScene, isPvw=studioMode && name===currentPreviewScene;
    tab.className='scene-tab'+(name===editingScene?' active':'')+(isLive?' live':'')+(isPvw?' pvw':'');
    tab.title='Click to edit • double-click to go live • right-click for more';
    const hk=sceneHotkeys[name];
    const recording=sceneHotkeyRecordingFor===name;
    tab.innerHTML=`
      <img class="thumb" alt="">
      <div class="name">${escapeHtml(name)}</div>
      ${isLive?'<div class="scene-flag live-flag">LIVE</div>':''}
      ${isPvw?'<div class="scene-flag pvw-flag">PREVIEW</div>':''}
      <div class="scene-actions">
        <button class="secondary" data-role="hotkey" title="Set a hotkey that goes live on this scene (Backspace clears)">${recording?'Press keys…':(hk?escapeHtml(hk):'⌨')}</button>
        ${studioMode?'<button class="secondary" data-role="pvw">Preview</button>':''}
        <button class="${isLive?'secondary':''}" data-role="live">${isLive?'Live':'Go live'}</button>
      </div>
    `;
    const img=tab.querySelector('.thumb');
    if(sceneThumbs.has(name)) img.src=sceneThumbs.get(name);
    tab.addEventListener('click',(e)=>{ if(!e.target.closest('button')) loadScene(name); });
    tab.addEventListener('dblclick',(e)=>{ if(!e.target.closest('button')) goLive(name); });
    tab.addEventListener('contextmenu',(e)=>{
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { label:'Go live', run:()=>goLive(name) },
        ...(studioMode?[{ label:'Send to preview', run:()=>sendToPreview(name) }]:[]),
        { label:'Edit layout', run:()=>loadScene(name) },
        { label:hk?'Clear hotkey ('+hk+')':'Set hotkey…', run:()=>hk?setSceneHotkey(name,null):tab.querySelector('[data-role=hotkey]').click() },
        { sep:true },
        { label:'Rename…', run:()=>renameScene(name) },
        { label:'Delete scene…', danger:true, run:()=>deleteScene(name) }
      ]);
    });
    tab.querySelector('[data-role=live]').addEventListener('click',()=>goLive(name));
    const pvw=tab.querySelector('[data-role=pvw]');
    if(pvw) pvw.addEventListener('click',()=>sendToPreview(name));
    tab.querySelector('[data-role=hotkey]').addEventListener('click',()=>{
      sceneHotkeyRecordingFor=name;
      renderSceneTabs();
      startHotkeyRecording(combo=>{ sceneHotkeyRecordingFor=null; setSceneHotkey(name, combo); },
                           ()=>{ sceneHotkeyRecordingFor=null; renderSceneTabs(); });
    });
    strip.appendChild(tab);
  });
  const editLabel=$('editingLabel');
  if(editLabel) editLabel.textContent=editingScene ? (editingScene===currentProgramScene ? `Editing: ${editingScene} (live)` : `Editing: ${editingScene}`) : '';
}

function setSceneHotkey(sceneName, combo){
  const sceneHotkeys=appStorageGet('sceneHotkeys', {});
  if(!combo){ delete sceneHotkeys[sceneName]; appStorageSet('sceneHotkeys', sceneHotkeys); renderSceneTabs(); return; }
  const conflict=hotkeyConflict(combo,'scene',sceneName);
  if(conflict){ notify(conflict,'err'); renderSceneTabs(); return; }
  sceneHotkeys[sceneName]=combo;
  appStorageSet('sceneHotkeys', sceneHotkeys);
  notify(`${combo} now goes live on "${sceneName}"`,'ok');
  renderSceneTabs();
}

async function renameScene(name){
  const newName=await askText('Rename scene', name);
  if(!newName || newName===name) return;
  const d=await sendRequest('SetSceneName',{ sceneName:name, newSceneName:newName });
  if(!d.requestStatus.result) notify('Rename failed: '+reqError(d),'err');
}
async function deleteScene(name){
  if(!await askConfirm(`Delete scene "${name}"?`, 'This removes the scene from OBS on that PC. It cannot be undone from here.', 'Delete', true)) return;
  const d=await sendRequest('RemoveScene',{ sceneName:name });
  if(!d.requestStatus.result) notify('Delete failed: '+reqError(d),'err');
}

async function refreshSceneThumbs(){
  if(!isConnected() || document.hidden) return;
  for(const s of scenesData){
    if(!isConnected()) return;
    const data=await req('GetSourceScreenshot',{sourceName:s.sceneName,imageFormat:'jpg',imageWidth:320,imageCompressionQuality:70});
    if(!data) continue;
    sceneThumbs.set(s.sceneName, data.imageData);
    const tabs=$('sceneStrip').querySelectorAll('.scene-tab');
    const idx=scenesData.indexOf(s);
    const img=tabs[idx] && tabs[idx].querySelector('.thumb');
    if(img) img.src=data.imageData;
  }
}
function startThumbLoop(){ stopThumbLoop(); refreshSceneThumbs(); thumbTimer=setInterval(refreshSceneThumbs, 5000); }
function stopThumbLoop(){ clearInterval(thumbTimer); thumbTimer=null; }

// ---- Toolbar ----
$('studioToggleBtn').addEventListener('click',async()=>{
  const d=await sendRequest('SetStudioModeEnabled',{ studioModeEnabled:!studioMode });
  if(!d.requestStatus.result) notify('Could not toggle studio mode: '+reqError(d),'err');
});
$('transitionBtn').addEventListener('click',async()=>{
  const d=await sendRequest('TriggerStudioModeTransition');
  if(!d.requestStatus.result) notify('Transition failed: '+reqError(d),'err');
});
$('transitionSelect').addEventListener('change',()=>req('SetCurrentSceneTransition',{ transitionName:$('transitionSelect').value }));
$('transitionDuration').addEventListener('change',()=>{
  const v=parseInt($('transitionDuration').value,10);
  if(v>=50 && v<=20000) req('SetCurrentSceneTransitionDuration',{ transitionDuration:v });
});
$('addSceneBtn').addEventListener('click',async()=>{
  const name=await askText('New scene','', 'Name for the new scene in OBS:');
  if(!name) return;
  const d=await sendRequest('CreateScene',{ sceneName:name });
  if(!d.requestStatus.result) notify('Could not create scene: '+reqError(d),'err');
  else logActivity('Created scene '+name);
});

// ---- Live updates from OBS (changes made in OBS itself now show up here) ----
obsOn('CurrentProgramSceneChanged', d=>{
  if(d.sceneName===currentProgramScene) return;
  currentProgramScene=d.sceneName;
  renderSceneTabs();
  notify('Live: '+d.sceneName,'ok');
  logActivity('Switched to '+d.sceneName);
});
obsOn('CurrentPreviewSceneChanged', d=>{ currentPreviewScene=d.sceneName; renderSceneTabs(); });
obsOn('StudioModeStateChanged', d=>{ setStudioModeUI(!!d.studioModeEnabled); logActivity(d.studioModeEnabled?'Studio mode on':'Studio mode off'); });
obsOn('SceneListChanged', ()=>loadScenes());
obsOn('SceneNameChanged', d=>{
  const hk=appStorageGet('sceneHotkeys',{});
  if(hk[d.oldSceneName]){ hk[d.sceneName]=hk[d.oldSceneName]; delete hk[d.oldSceneName]; appStorageSet('sceneHotkeys',hk); }
  if(sceneThumbs.has(d.oldSceneName)){ sceneThumbs.set(d.sceneName, sceneThumbs.get(d.oldSceneName)); sceneThumbs.delete(d.oldSceneName); }
  if(editingScene===d.oldSceneName) editingScene=d.sceneName;
  if(currentProgramScene===d.oldSceneName) currentProgramScene=d.sceneName;
  loadScenes();
});
obsOn('SceneRemoved', d=>{
  if(editingScene===d.sceneName){ editingScene=null; loadScenes().then(()=>editingScene && loadScene(editingScene)); }
});
obsOn('CurrentSceneTransitionChanged', d=>{ $('transitionSelect').value=d.transitionName; req('GetCurrentSceneTransition').then(ct=>{ if(ct){ $('transitionDuration').value=ct.transitionDuration ?? ''; $('transitionDuration').disabled=!!ct.transitionFixed; } }); });
obsOn('CurrentSceneTransitionDurationChanged', d=>{ $('transitionDuration').value=d.transitionDuration; });
