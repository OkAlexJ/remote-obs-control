// ==================== Stage editor (scene layout) + sources list + properties ====================
let baseW=1920, baseH=1080, scaleFactor=1, zoomLevel=1;
let stageItems=[], itemElMap={}, sourceRowElMap={};
let selectedItemId=null;
let draggingItemId=null;     // item currently being dragged/scaled (ignore OBS echo events for it)
let stageLoopGen=0;
let propsInputName=null, propsFields=null, propsOriginal=null, propsCurrentItem=null, propsMediaTimer=null;


const OBS_ALIGN={ LEFT:1, RIGHT:2, TOP:4, BOTTOM:8 };
const SNAP_PX=8; // screen pixels

// ---- Geometry: OBS positions refer to the item's *alignment point*, and bounds (if set) replace the scaled size ----
function hasBounds(t){ return t.boundsType && t.boundsType!=='OBS_BOUNDS_NONE'; }
function itemBoxSize(t){
  if(hasBounds(t)) return { w:Math.abs(t.boundsWidth||0), h:Math.abs(t.boundsHeight||0) };
  return { w:Math.abs(t.width||0), h:Math.abs(t.height||0) };
}
function alignOffset(align, w, h){
  const a=align ?? 5;
  const ox=(a & OBS_ALIGN.LEFT)?0:(a & OBS_ALIGN.RIGHT)?w:w/2;
  const oy=(a & OBS_ALIGN.TOP)?0:(a & OBS_ALIGN.BOTTOM)?h:h/2;
  return { ox, oy };
}
// Top-left corner + size in canvas pixels (ignoring rotation)
function itemBox(t){
  const { w, h }=itemBoxSize(t);
  const { ox, oy }=alignOffset(t.alignment, w, h);
  return { x:t.positionX-ox, y:t.positionY-oy, w, h, ox, oy };
}

const isSbPlayerName = name => typeof SB_PLAYER_PREFIX!=='undefined' && String(name).startsWith(SB_PLAYER_PREFIX);
const visibleItems = () => stageItems.filter(i=>!isSbPlayerName(i.sourceName));

// ---- Loading ----
async function loadScene(sceneName){
  if(!sceneName) return;
  const changed=sceneName!==editingScene;
  editingScene=sceneName;
  if(changed){ selectedItemId=null; closeProps(); }
  renderSceneTabs();
  await refreshItems();
  restartStageBgLoop();
}

async function refreshItems(){
  if(!editingScene) return;
  const items=await req('GetSceneItemList',{sceneName:editingScene});
  if(!items) return;
  stageItems=items.sceneItems||[];
  if(selectedItemId && !stageItems.some(i=>i.sceneItemId===selectedItemId)) selectedItemId=null;
  renderStage();
  renderSourceList();
}
let refreshItemsTimer=null;
function refreshItemsSoon(){ clearTimeout(refreshItemsTimer); refreshItemsTimer=setTimeout(refreshItems, 120); }

// ---- Rendering ----
function computeScale(){
  const wrapEl=$('stageWrap');
  const fitW=Math.max(200, (wrapEl ? wrapEl.clientWidth : 800) - 4);
  const fitH=Math.max(200, window.innerHeight*0.62);
  scaleFactor=Math.min(fitW/baseW, fitH/baseH)*zoomLevel;
}

function renderStage(recalcSize){
  if(recalcSize!==false) computeScale();
  const stage=$('stage');
  stage.style.width=(baseW*scaleFactor)+'px';
  stage.style.height=(baseH*scaleFactor)+'px';
  stage.innerHTML='';
  itemElMap={};
  $('zoomLabel').textContent=Math.round(zoomLevel*100)+'%';

  visibleItems().forEach(item=>{
    const div=document.createElement('div');
    const isSelected=item.sceneItemId===selectedItemId;
    const isText=(item.inputKind||'').startsWith('text_');
    div.className='item'+(isText?' text':'')+(item.sceneItemLocked?' locked':'')+(item.sceneItemEnabled===false?' hidden-src':'')+(isSelected?' selected':'');
    const tag=document.createElement('div');
    tag.className='tag'; tag.textContent=item.sourceName;
    div.appendChild(tag);
    positionItemEl(div, item);

    const rotated=Math.abs((item.sceneItemTransform.rotation||0)%360)>0.01;
    if(isSelected && !item.sceneItemLocked && !rotated){
      ['nw','n','ne','e','se','s','sw','w'].forEach(h=>{
        const hEl=document.createElement('div');
        hEl.className=`handle ${h}`;
        hEl.addEventListener('pointerdown',(e)=>{ e.stopPropagation(); startScale(e,div,item,h); });
        div.appendChild(hEl);
      });
    }
    div.addEventListener('pointerdown',(e)=>{
      if(e.button!==0) return;
      if(item.sceneItemLocked){ selectItem(item.sceneItemId); flashSourceRow(item.sceneItemId); return; }
      startDrag(e,div,item);
    });
    div.addEventListener('dblclick',()=>openProperties(item, sourceRowElMap[item.sceneItemId]));
    div.addEventListener('contextmenu',(e)=>{ e.preventDefault(); selectItem(item.sceneItemId); sourceContextMenu(e, item); });

    stage.appendChild(div);
    itemElMap[item.sceneItemId]=div;
  });
}

function positionItemEl(el, item){
  const t=item.sceneItemTransform;
  const b=itemBox(t);
  el.style.left=(b.x*scaleFactor)+'px';
  el.style.top=(b.y*scaleFactor)+'px';
  el.style.width=Math.max(b.w*scaleFactor,4)+'px';
  el.style.height=Math.max(b.h*scaleFactor,4)+'px';
  const rot=t.rotation||0;
  el.style.transformOrigin=`${b.ox*scaleFactor}px ${b.oy*scaleFactor}px`;
  el.style.transform=rot?`rotate(${rot}deg)`:'';
}

$('stage').addEventListener('pointerdown',(e)=>{ if(e.target===$('stage')) selectItem(null); });

function selectItem(id){
  selectedItemId=id;
  renderStage(false);
  Object.entries(sourceRowElMap).forEach(([rid,row])=>row.classList.toggle('selected', Number(rid)===id));
}

// Re-fit when the window / column resizes
let lastWrapW=0;
new ResizeObserver(()=>{
  const w=$('stageWrap').clientWidth;
  if(Math.abs(w-lastWrapW)>1){ lastWrapW=w; if(stageItems.length || editingScene) renderStage(); }
}).observe($('stageWrap'));
window.addEventListener('resize',()=>{ if(editingScene) renderStage(); });

$('zoomInBtn').addEventListener('click',()=>{ zoomLevel=Math.min(zoomLevel*1.25,4); renderStage(); });
$('zoomOutBtn').addEventListener('click',()=>{ zoomLevel=Math.max(zoomLevel/1.25,0.5); renderStage(); });
$('zoomResetBtn').addEventListener('click',()=>{ zoomLevel=1; renderStage(); });
$('refreshSceneBtn').addEventListener('click',()=>editingScene && loadScene(editingScene));
$('stageWrap').addEventListener('wheel',(e)=>{
  if(!e.ctrlKey) return;
  e.preventDefault();
  zoomLevel=e.deltaY<0 ? Math.min(zoomLevel*1.1,4) : Math.max(zoomLevel/1.1,0.5);
  renderStage();
},{ passive:false });

// ---- Live preview background ----
async function refreshStageBg(){
  if(!editingScene) return;
  const width=Math.min(baseW, Math.max(320, Math.ceil(baseW*scaleFactor*(window.devicePixelRatio||1))));
  const data=await req('GetSourceScreenshot',{sourceName:editingScene,imageFormat:'jpg',imageWidth:width,imageCompressionQuality:75});
  if(data) $('stage').style.backgroundImage=`url("${data.imageData}")`;
}

// Each (re)start bumps a generation number; older loops notice and exit. Previously every
// loadScene() started an extra loop on top of the old one, so screenshot traffic kept multiplying.
function restartStageBgLoop(){
  const gen=++stageLoopGen;
  (async function loop(){
    while(gen===stageLoopGen && editingScene && isConnected()){
      const fps=parseInt(PREFS.fps,10)||0;
      if(!fps || document.hidden || !panelVisible('editor')){ await sleep(500); continue; }
      const t0=performance.now();
      await refreshStageBg();
      const delay=1000/fps-(performance.now()-t0);
      if(delay>0) await sleep(delay);
    }
  })();
}
function stopStageBgLoop(){ stageLoopGen++; }

// ---- Dragging (with edge/center snapping) ----
function clearSnapGuides(){ document.querySelectorAll('.snap-guide').forEach(g=>g.remove()); }
function showSnapGuide(axis, canvasPos){
  const g=document.createElement('div');
  g.className='snap-guide '+axis;
  if(axis==='v') g.style.left=(canvasPos*scaleFactor)+'px'; else g.style.top=(canvasPos*scaleFactor)+'px';
  $('stage').appendChild(g);
}

function startDrag(e,el,item){
  e.preventDefault();
  const t=item.sceneItemTransform;
  const startX=e.clientX, startY=e.clientY;
  const startPosX=t.positionX, startPosY=t.positionY;
  const box=itemBox(t);
  const rotated=Math.abs((t.rotation||0)%360)>0.01;
  let rafQueued=false, moved=false, px=startPosX, py=startPosY;
  draggingItemId=item.sceneItemId;

  const send=()=>req('SetSceneItemTransform',{sceneName:editingScene,sceneItemId:item.sceneItemId,sceneItemTransform:{positionX:px,positionY:py}});

  const move=(ev)=>{
    if(Math.abs(ev.clientX-startX)>3 || Math.abs(ev.clientY-startY)>3) moved=true;
    if(!moved) return;
    px=startPosX+(ev.clientX-startX)/scaleFactor;
    py=startPosY+(ev.clientY-startY)/scaleFactor;
    clearSnapGuides();
    if(!ev.altKey && !rotated){
      const thr=SNAP_PX/scaleFactor;
      const left=px-box.ox, top=py-box.oy;
      const xs=[[left,0],[left+box.w/2,baseW/2],[left+box.w,baseW]];
      const ys=[[top,0],[top+box.h/2,baseH/2],[top+box.h,baseH]];
      let bestX=null, bestY=null;
      xs.forEach(([edge,target])=>{ const d=target-edge; if(Math.abs(d)<thr && (bestX===null || Math.abs(d)<Math.abs(bestX.d))) bestX={d,target}; });
      ys.forEach(([edge,target])=>{ const d=target-edge; if(Math.abs(d)<thr && (bestY===null || Math.abs(d)<Math.abs(bestY.d))) bestY={d,target}; });
      if(bestX){ px+=bestX.d; showSnapGuide('v',bestX.target); }
      if(bestY){ py+=bestY.d; showSnapGuide('h',bestY.target); }
    }
    t.positionX=px; t.positionY=py;
    positionItemEl(el,item);
    if(!rafQueued){ rafQueued=true; requestAnimationFrame(()=>{ rafQueued=false; send(); }); }
  };
  const up=(ev)=>{
    try{ el.releasePointerCapture(ev.pointerId); }catch(err){}
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',up);
    clearSnapGuides();
    draggingItemId=null;
    if(moved) send(); else flashSourceRow(item.sceneItemId);
    selectItem(item.sceneItemId);
  };
  try{ el.setPointerCapture(e.pointerId); }catch(err){}
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',up);
}

// ---- Scaling with the 8 handles ----
function startScale(e, el, item, handle){
  e.preventDefault();
  const t=item.sceneItemTransform;
  const startX=e.clientX, startY=e.clientY;
  const b0=itemBox(t);
  const startW=b0.w||1, startH=b0.h||1;
  const scaleX0=t.scaleX ?? 1, scaleY0=t.scaleY ?? 1;
  const bounds=hasBounds(t);
  const aspectRatio=startW/startH;
  const wFactor=handle.includes('e')?1:(handle.includes('w')?-1:0);
  const hFactor=handle.includes('s')?1:(handle.includes('n')?-1:0);
  let rafQueued=false, latest=null;
  draggingItemId=item.sceneItemId;

  const send=()=>{ if(latest) req('SetSceneItemTransform',{ sceneName:editingScene, sceneItemId:item.sceneItemId, sceneItemTransform:latest }); };

  const move=(ev)=>{
    const dx=(ev.clientX-startX)/scaleFactor;
    const dy=(ev.clientY-startY)/scaleFactor;
    const lockAspect=ev.shiftKey, fromCenter=ev.ctrlKey||ev.metaKey;
    let newW=wFactor!==0?Math.max(4,startW+wFactor*dx*(fromCenter?2:1)):startW;
    let newH=hFactor!==0?Math.max(4,startH+hFactor*dy*(fromCenter?2:1)):startH;
    if(lockAspect){
      if(wFactor!==0 && hFactor!==0){
        if(Math.abs(newW/startW-1)>=Math.abs(newH/startH-1)) newH=newW/aspectRatio; else newW=newH*aspectRatio;
      } else if(wFactor!==0) newH=newW/aspectRatio;
      else if(hFactor!==0) newW=newH*aspectRatio;
    }
    // New top-left corner: anchor the opposite edge (or the center with Ctrl)
    let left=b0.x, top=b0.y;
    if(fromCenter){ left=b0.x-(newW-startW)/2; top=b0.y-(newH-startH)/2; }
    else {
      if(wFactor<0) left=b0.x+(startW-newW);
      if(hFactor<0) top=b0.y+(startH-newH);
    }
    const { ox, oy }=alignOffset(t.alignment,newW,newH);
    const update={ positionX:left+ox, positionY:top+oy };
    if(bounds){ update.boundsWidth=newW; update.boundsHeight=newH; }
    else { update.scaleX=scaleX0*(newW/startW); update.scaleY=scaleY0*(newH/startH); }
    latest=update;
    // Live local update so the box follows the mouse
    Object.assign(t, update);
    if(!bounds){ t.width=newW; t.height=newH; }
    positionItemEl(el,item);
    if(!rafQueued){ rafQueued=true; requestAnimationFrame(()=>{ rafQueued=false; send(); }); }
  };
  const up=()=>{
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',up);
    draggingItemId=null;
    send();
    setTimeout(refreshItems, 150); // pick up OBS's exact final numbers
  };
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',up);
}

// Keyboard: arrows nudge, Delete removes. Returns true if handled.
function handleStageKey(e){
  const item=stageItems.find(i=>i.sceneItemId===selectedItemId);
  if(!item) return false;
  const map={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]};
  if(map[e.key] && !e.ctrlKey && !e.altKey){
    e.preventDefault();
    if(item.sceneItemLocked) return true;
    const step=e.shiftKey?20:1;
    const [dx,dy]=map[e.key];
    const t=item.sceneItemTransform;
    t.positionX+=dx*step; t.positionY+=dy*step;
    const el=itemElMap[selectedItemId];
    if(el) positionItemEl(el,item);
    req('SetSceneItemTransform',{sceneName:editingScene,sceneItemId:selectedItemId,sceneItemTransform:{positionX:t.positionX,positionY:t.positionY}});
    return true;
  }
  if(e.key==='Delete'){ e.preventDefault(); removeSceneItem(item); return true; }
  return false;
}

async function removeSceneItem(item){
  const ok=await askConfirm(`Remove "${item.sourceName}"?`, "It's removed from this scene only — the source itself stays available in OBS.", 'Remove', true);
  if(!ok) return;
  const d=await sendRequest('RemoveSceneItem',{sceneName:editingScene,sceneItemId:item.sceneItemId});
  if(!d.requestStatus.result){ notify('Could not remove: '+reqError(d),'err'); return; }
  if(selectedItemId===item.sceneItemId) selectedItemId=null;
  logActivity(`Removed ${item.sourceName} from ${editingScene}`);
  refreshItems();
}

async function setItemEnabled(item, enabled){
  const d=await sendRequest('SetSceneItemEnabled',{sceneName:editingScene,sceneItemId:item.sceneItemId,sceneItemEnabled:enabled});
  if(!d.requestStatus.result){ notify('Could not change visibility: '+reqError(d),'err'); return; }
  item.sceneItemEnabled=enabled;
  renderStage(false); renderSourceList();
  logActivity((enabled?'Showed ':'Hid ')+item.sourceName);
}

// ---- Sources list (top of list = top layer, like OBS) ----
let dragRowId=null;
function renderSourceList(){
  const list=$('sourceList');
  list.innerHTML='';
  sourceRowElMap={};
  const items=visibleItems().slice().reverse();
  const players=stageItems.length-visibleItems().length;
  $('hiddenPlayersNote').classList.toggle('hidden', !players);
  $('hiddenPlayersNote').textContent=players?`+ ${players} hidden soundboard player source${players>1?'s':''}`:'';
  if(!items.length){ list.innerHTML='<div class="empty-note">No sources in this scene yet. Add one below.</div>'; return; }
  items.forEach(item=>{
    const row=document.createElement('div');
    row.className='src-row'+(item.sceneItemId===selectedItemId?' selected':'');
    row.draggable=true;
    row.innerHTML=`
      <span class="drag-grip" title="Drag to reorder">⋮⋮</span>
      <span class="src-name" title="${escapeHtml(item.sourceName)}${item.inputKind?' ('+escapeHtml(item.inputKind)+')':''}">${escapeHtml(item.sourceName)}</span>
      <button class="toggle-btn" data-role="preview" title="Preview this source alone">📷</button>
      <button class="toggle-btn" data-role="props" title="Properties">⚙</button>
      <button class="toggle-btn ${item.sceneItemEnabled===false?'off':''}" data-role="eye" title="Show/hide">👁</button>
      <button class="toggle-btn ${item.sceneItemLocked?'':'off'}" data-role="lock" title="Lock/unlock">🔒</button>
      <button class="toggle-btn danger" data-role="delete" title="Remove from scene">🗑</button>
    `;
    row.querySelector('.src-name').addEventListener('click',()=>{ selectItem(item.sceneItemId); flashItem(item.sceneItemId); });
    row.querySelector('.src-name').addEventListener('dblclick',()=>openProperties(item,row));
    row.querySelector('[data-role=preview]').addEventListener('click',()=>previewSource(item.sourceName,row));
    row.querySelector('[data-role=props]').addEventListener('click',()=>{ selectItem(item.sceneItemId); openProperties(item,row); });
    row.querySelector('[data-role=eye]').addEventListener('click',()=>setItemEnabled(item, item.sceneItemEnabled===false));
    row.querySelector('[data-role=lock]').addEventListener('click',async()=>{
      const newVal=!item.sceneItemLocked;
      const d=await sendRequest('SetSceneItemLocked',{sceneName:editingScene,sceneItemId:item.sceneItemId,sceneItemLocked:newVal});
      if(!d.requestStatus.result){ notify('Could not lock: '+reqError(d),'err'); return; }
      item.sceneItemLocked=newVal;
      renderStage(false); renderSourceList();
    });
    row.querySelector('[data-role=delete]').addEventListener('click',()=>removeSceneItem(item));
    row.addEventListener('contextmenu',(e)=>{ e.preventDefault(); selectItem(item.sceneItemId); sourceContextMenu(e,item); });

    // Drag-and-drop reordering
    row.addEventListener('dragstart',(e)=>{ dragRowId=item.sceneItemId; row.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', String(item.sceneItemId)); });
    row.addEventListener('dragend',()=>{ dragRowId=null; row.classList.remove('dragging'); list.querySelectorAll('.drop-target').forEach(r=>r.classList.remove('drop-target')); });
    row.addEventListener('dragover',(e)=>{ if(dragRowId!==null && dragRowId!==item.sceneItemId){ e.preventDefault(); row.classList.add('drop-target'); } });
    row.addEventListener('dragleave',()=>row.classList.remove('drop-target'));
    row.addEventListener('drop',async(e)=>{
      e.preventDefault(); row.classList.remove('drop-target');
      if(dragRowId===null || dragRowId===item.sceneItemId) return;
      const d=await sendRequest('SetSceneItemIndex',{ sceneName:editingScene, sceneItemId:dragRowId, sceneItemIndex:item.sceneItemIndex });
      if(!d.requestStatus.result) notify('Could not reorder: '+reqError(d),'err');
      refreshItems();
    });

    list.appendChild(row);
    sourceRowElMap[item.sceneItemId]=row;
  });
}

function sourceContextMenu(e, item){
  const idx=item.sceneItemIndex, max=stageItems.length-1;
  showContextMenu(e.clientX, e.clientY, [
    { label:'Properties…', run:()=>openProperties(item, sourceRowElMap[item.sceneItemId]) },
    { label:'Preview alone', run:()=>previewSource(item.sourceName, sourceRowElMap[item.sceneItemId]) },
    { label:item.sceneItemEnabled===false?'Show':'Hide', run:()=>setItemEnabled(item, item.sceneItemEnabled===false) },
    { sep:true },
    { label:'Bring to front', run:()=>reorderItem(item, max) },
    { label:'Move up', run:()=>reorderItem(item, Math.min(max, idx+1)) },
    { label:'Move down', run:()=>reorderItem(item, Math.max(0, idx-1)) },
    { label:'Send to back', run:()=>reorderItem(item, 0) },
    { sep:true },
    { label:'Fit to screen', run:()=>fitItemToScreen(item) },
    { label:'Center on screen', run:()=>centerItem(item) },
    { sep:true },
    { label:'Remove from scene…', danger:true, run:()=>removeSceneItem(item) }
  ]);
}
async function reorderItem(item, index){
  const d=await sendRequest('SetSceneItemIndex',{ sceneName:editingScene, sceneItemId:item.sceneItemId, sceneItemIndex:index });
  if(!d.requestStatus.result) notify('Could not reorder: '+reqError(d),'err');
  refreshItems();
}

function flashItem(id){
  const el=itemElMap[id];
  if(!el) return;
  el.classList.add('flash');
  el.scrollIntoView({behavior:'smooth',block:'nearest',inline:'nearest'});
  setTimeout(()=>el.classList.remove('flash'),1200);
}
function flashSourceRow(id){
  const el=sourceRowElMap[id];
  if(!el) return;
  el.classList.add('flash');
  el.scrollIntoView({behavior:'smooth',block:'nearest'});
  setTimeout(()=>el.classList.remove('flash'),1200);
}

// ---- Transform helpers ----
async function applyTransform(item, transform){
  const d=await sendRequest('SetSceneItemTransform',{ sceneName:editingScene, sceneItemId:item.sceneItemId, sceneItemTransform:transform });
  if(!d.requestStatus.result){ notify('Could not update transform: '+reqError(d),'err'); return false; }
  await refreshItems();
  if(propsCurrentItem && propsCurrentItem.sceneItemId===item.sceneItemId){
    propsCurrentItem=stageItems.find(i=>i.sceneItemId===item.sceneItemId)||propsCurrentItem;
    updateScaleInputsUI();
  }
  return true;
}
function fitItemToScreen(item){
  return applyTransform(item,{ alignment:5, boundsType:'OBS_BOUNDS_SCALE_INNER', boundsAlignment:0, boundsWidth:baseW, boundsHeight:baseH, positionX:0, positionY:0 });
}
function centerItem(item){
  const t=item.sceneItemTransform, b=itemBox(t);
  return applyTransform(item,{ positionX:(baseW-b.w)/2+b.ox, positionY:(baseH-b.h)/2+b.oy });
}
function resetItemTransform(item){
  return applyTransform(item,{ alignment:5, positionX:0, positionY:0, scaleX:1, scaleY:1, rotation:0, boundsType:'OBS_BOUNDS_NONE', cropLeft:0, cropRight:0, cropTop:0, cropBottom:0 });
}

// ---- Single-source preview popup ----
async function previewSource(name, anchorEl){
  $('previewTitle').textContent=name;
  $('previewImg').removeAttribute('src');
  const panel=$('previewPanel');
  panel.classList.remove('hidden');
  positionFloating(panel, anchorEl);
  const data=await req('GetSourceScreenshot',{ sourceName:name, imageFormat:'jpg', imageWidth:640 });
  if(data) $('previewImg').src=data.imageData;
  else $('previewImg').alt='No preview available for this source';
}
$('previewClose').addEventListener('click',()=>$('previewPanel').classList.add('hidden'));

function positionFloating(panel, anchorEl){
  const rect=anchorEl ? anchorEl.getBoundingClientRect() : { top:80, left:window.innerWidth-340, right:window.innerWidth-8 };
  const pw=panel.offsetWidth, ph=panel.offsetHeight;
  let left=rect.left-pw-12;
  if(left<8) left=Math.min(rect.right+12, window.innerWidth-pw-8);
  let top=rect.top;
  if(top+ph>window.innerHeight-8) top=Math.max(8, window.innerHeight-ph-8);
  panel.style.left=Math.max(8,left)+'px';
  panel.style.top=top+'px';
}

// ---- Properties panel ----
function closeProps(){
  $('propsPanel').classList.add('hidden');
  document.removeEventListener('mousedown', onPropsOutsideClick, true);
  clearInterval(propsMediaTimer); propsMediaTimer=null;
  propsCurrentItem=null;
}
function onPropsOutsideClick(e){
  if($('propsPanel').contains(e.target)) return;
  const menu=$('ctxMenu');
  if($('dialogBox').contains(e.target) || (menu && menu.contains(e.target))) return;
  closeProps();
}

async function openProperties(item, anchorEl){
  propsCurrentItem=item;
  propsInputName=item.sourceName;
  $('propsTitle').textContent=item.sourceName;
  $('propsKind').textContent=item.inputKind || (item.isGroup?'group':'');
  $('propsForm').innerHTML='<div class="empty-note">Loading…</div>';
  $('propsErr').classList.add('hidden');
  $('filtersSection').classList.add('hidden');
  updateScaleInputsUI();

  const panel=$('propsPanel');
  panel.classList.remove('hidden');
  panel.style.left='-9999px'; panel.style.top='0px';

  const [mediaState, data, filters]=await Promise.all([
    req('GetMediaInputStatus',{ inputName:item.sourceName }),
    req('GetInputSettings',{ inputName:item.sourceName }),
    req('GetSourceFilterList',{ sourceName:item.sourceName })
  ]);
  if(propsCurrentItem!==item) return; // user opened something else meanwhile

  const mediaSec=$('mediaSection');
  clearInterval(propsMediaTimer); propsMediaTimer=null;
  if(mediaState && mediaState.mediaDuration){
    mediaSec.classList.remove('hidden');
    updateMediaUI(mediaState);
    propsMediaTimer=setInterval(async()=>{
      if(scrubbing) return;
      const s=await req('GetMediaInputStatus',{ inputName:propsInputName });
      if(s) updateMediaUI(s);
    },1000);
  } else mediaSec.classList.add('hidden');

  if(!data){
    $('propsForm').innerHTML='';
    showBoxErr('propsErr', "This source has no editable settings (it may be a scene or group).");
    propsOriginal={};
  } else {
    propsOriginal=data.inputSettings || {};
    renderPropsForm(propsOriginal);
  }
  renderFilters(filters && filters.filters);

  positionFloating(panel, anchorEl);
  document.addEventListener('mousedown', onPropsOutsideClick, true);
}

function renderFilters(filters){
  const sec=$('filtersSection'), list=$('filtersList');
  list.innerHTML='';
  if(!filters || !filters.length){ sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  filters.forEach(f=>{
    const row=document.createElement('div');
    row.className='checkbox-row';
    const id='flt_'+cssSafe(f.filterName);
    row.innerHTML=`<input type="checkbox" id="${id}" ${f.filterEnabled?'checked':''}><label for="${id}">${escapeHtml(f.filterName)} <span class="muted">${escapeHtml(f.filterKind||'')}</span></label>`;
    row.querySelector('input').addEventListener('change',async(e)=>{
      const d=await sendRequest('SetSourceFilterEnabled',{ sourceName:propsInputName, filterName:f.filterName, filterEnabled:e.target.checked });
      if(!d.requestStatus.result){ e.target.checked=!e.target.checked; notify('Could not toggle filter: '+reqError(d),'err'); }
      else logActivity(`${e.target.checked?'Enabled':'Disabled'} filter "${f.filterName}" on ${propsInputName}`);
    });
    list.appendChild(row);
  });
}

let scrubbing=false;
function updateMediaUI(s){
  const dur=s.mediaDuration||0, cur=s.mediaCursor||0;
  $('mediaScrubber').value=dur?Math.round(cur/dur*1000):0;
  $('mediaPosLabel').textContent=dur?`${formatDuration(cur)} / ${formatDuration(dur)}`:'';
}
$('mediaScrubber').addEventListener('input',()=>{ scrubbing=true; });
$('mediaScrubber').addEventListener('change',async(e)=>{
  const status=await req('GetMediaInputStatus',{ inputName:propsInputName });
  if(status && status.mediaDuration){
    const target=Math.round((e.target.value/1000)*status.mediaDuration);
    await req('SetMediaInputCursor',{ inputName:propsInputName, mediaCursor:target });
  }
  scrubbing=false;
});
$('mediaPlayBtn').addEventListener('click',()=>req('TriggerMediaInputAction',{ inputName:propsInputName, mediaAction:'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY' }));
$('mediaPauseBtn').addEventListener('click',()=>req('TriggerMediaInputAction',{ inputName:propsInputName, mediaAction:'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE' }));
$('mediaRestartBtn').addEventListener('click',()=>req('TriggerMediaInputAction',{ inputName:propsInputName, mediaAction:'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART' }));

function updateScaleInputsUI(){
  if(!propsCurrentItem) return;
  const t=propsCurrentItem.sceneItemTransform||{};
  const sx=t.scaleX ?? 1, sy=t.scaleY ?? 1;
  $('propScaleX').value=(sx*100).toFixed(1); $('propScaleY').value=(sy*100).toFixed(1);
  const disabled=hasBounds(t);
  $('propScaleX').disabled=disabled; $('propScaleY').disabled=disabled;
  $('propScaleX').title=disabled?'This source uses a bounding box; scale is controlled by its bounds (use Reset to remove).':'';
  $('propPosX').value=Math.round((t.positionX||0)*10)/10;
  $('propPosY').value=Math.round((t.positionY||0)*10)/10;
  $('propRot').value=Math.round((t.rotation||0)*10)/10;
}

$('fitScreenBtn').addEventListener('click',()=>propsCurrentItem && fitItemToScreen(propsCurrentItem));
$('centerBtn').addEventListener('click',()=>propsCurrentItem && centerItem(propsCurrentItem));
$('resetTransformBtn').addEventListener('click',()=>propsCurrentItem && resetItemTransform(propsCurrentItem));

function flattenSettings(obj, prefix){
  let out={};
  for(const [k,v] of Object.entries(obj||{})){
    const key=prefix?prefix+'.'+k:k;
    if(v===null || v===undefined) out[key]='';
    else if(Array.isArray(v)) continue;
    else if(typeof v==='object'){ if(!prefix) out={...out, ...flattenSettings(v,key)}; }
    else out[key]=v;
  }
  return out;
}
function setNestedValue(obj, dottedKey, value){
  const parts=dottedKey.split('.');
  let cur=obj;
  for(let i=0;i<parts.length-1;i++){
    if(typeof cur[parts[i]]!=='object' || cur[parts[i]]===null) cur[parts[i]]={};
    cur=cur[parts[i]];
  }
  cur[parts[parts.length-1]]=value;
}

function renderPropsForm(settings){
  const form=$('propsForm');
  form.innerHTML='';
  propsFields={};
  const entries=Object.entries(flattenSettings(settings,''));
  if(!entries.length){ form.innerHTML='<div class="empty-note">No additional settings available.</div>'; return; }
  entries.forEach(([key,val])=>{
    const row=document.createElement('div');
    row.className='prop-row';
    const type=typeof val;
    const fieldId='pf_'+cssSafe(key);
    const label=document.createElement('label');
    label.htmlFor=fieldId; label.textContent=key;
    let input;
    if(type==='boolean'){
      input=document.createElement('input'); input.type='checkbox'; input.checked=val;
      row.className='checkbox-row';
      row.appendChild(input); row.appendChild(label);
    } else {
      const str=String(val);
      if(type==='string' && (key==='text' || str.includes('\n') || str.length>80) && !str.startsWith('data:')){
        input=document.createElement('textarea'); input.value=str;
      } else {
        input=document.createElement('input');
        input.type=type==='number'?'number':'text';
        if(type==='number') input.step='any';
        input.value=str.startsWith('data:') && str.length>200 ? '' : str;
        if(str.startsWith('data:') && str.length>200){ input.placeholder='(embedded file — leave blank to keep)'; }
      }
      row.appendChild(label); row.appendChild(input);
    }
    input.id=fieldId;
    form.appendChild(row);
    propsFields[key]={ type, fieldId, original:val };
  });
}

$('propsCancel').addEventListener('click', closeProps);

$('propsSave').addEventListener('click',async()=>{
  const updated=JSON.parse(JSON.stringify(propsOriginal||{}));
  let changed=false;
  Object.entries(propsFields||{}).forEach(([key,{type,fieldId,original}])=>{
    const el=$(fieldId);
    if(!el) return;
    let val;
    if(type==='boolean') val=el.checked;
    else if(type==='number'){ val=parseFloat(el.value); if(isNaN(val)) val=original; }
    else { val=el.value; if(val==='' && String(original).startsWith('data:')) val=original; }
    if(val!==original){ changed=true; setNestedValue(updated,key,val); }
  });

  $('propsSave').disabled=true;
  hideBoxErr('propsErr');
  if(changed){
    const d=await sendRequest('SetInputSettings',{inputName:propsInputName,inputSettings:updated,overlay:true});
    if(!d.requestStatus.result){ showBoxErr('propsErr','Could not save settings: '+reqError(d)); $('propsSave').disabled=false; return; }
  }

  if(propsCurrentItem){
    const t=propsCurrentItem.sceneItemTransform||{};
    const transform={};
    if(!hasBounds(t)){
      let sx=parseFloat($('propScaleX').value), sy=parseFloat($('propScaleY').value);
      if(!isNaN(sx) && !isNaN(sy) && sx!==0 && sy!==0){
        sx/=100; sy/=100;
        transform.scaleX=sx; transform.scaleY=sy;
      }
    }
    const posX=parseFloat($('propPosX').value), posY=parseFloat($('propPosY').value), rot=parseFloat($('propRot').value);
    if(!isNaN(posX)) transform.positionX=posX;
    if(!isNaN(posY)) transform.positionY=posY;
    if(!isNaN(rot)) transform.rotation=((rot%360)+360)%360;
    const d=await sendRequest('SetSceneItemTransform',{ sceneName:editingScene, sceneItemId:propsCurrentItem.sceneItemId, sceneItemTransform:transform });
    if(!d.requestStatus.result){ showBoxErr('propsErr','Could not save transform: '+reqError(d)); $('propsSave').disabled=false; return; }
  }

  $('propsSave').disabled=false;
  logActivity('Edited '+propsInputName);
  closeProps();
  refreshItems();
});

// ---- Adding sources ----
async function populateExistingSources(){
  const sel=$('addExisting');
  const il=await req('GetInputList');
  const inScene=new Set(stageItems.map(i=>i.sourceName));
  const names=((il&&il.inputs)||[]).map(i=>i.inputName).filter(n=>!inScene.has(n) && !isSbPlayerName(n));
  scenesData.forEach(s=>{ if(s.sceneName!==editingScene && !inScene.has(s.sceneName)) names.push(s.sceneName); });
  sel.innerHTML=names.length ? names.map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('') : '<option value="">(nothing else to add)</option>';
}
function syncAddFields(){
  const v=$('addType').value;
  const show=(id,on)=>$(id).classList.toggle('hidden',!on);
  show('addExisting', v==='existing');
  show('addName', v!=='existing' && v!=='bald_filter');
  show('addUrl', v==='browser_source');
  show('addFile', v==='image_source');
  show('addText', v==='text_source');
  show('addColor', v==='color_source');
  show('uploadFileInput', v==='upload');
  show('uploadAudioRow', v==='upload');
  show('addDims', v==='browser_source' || v==='color_source');
  $('addName').placeholder=v==='upload'?'Name (optional)':'Name';
  if(v==='existing') populateExistingSources();
}
$('addType').addEventListener('change', syncAddFields);
$('addSrcDetails').addEventListener('toggle',()=>{ if($('addSrcDetails').open) syncAddFields(); });

async function pickInputKind(priority){
  const data=await req('GetInputKindList',{ unversioned:false });
  const kinds=(data && data.inputKinds)||[];
  return priority.find(k=>kinds.includes(k)) || null;
}
function hexToObsColor(hex){
  const n=parseInt(hex.replace('#',''),16);
  const r=(n>>16)&255, g=(n>>8)&255, b=n&255;
  return ((0xFF<<24)|(b<<16)|(g<<8)|r)>>>0; // OBS stores colors as ABGR
}

$('addBtn').addEventListener('click', async ()=>{
  hideBoxErr('addErr');
  const fail=m=>showBoxErr('addErr',m);
  if(!editingScene) return fail('Load a scene first.');
  const kind=$('addType').value;

  if(kind==='bald_filter'){
    $('addBtn').disabled=true;
    try{ await addBaldFilter(); }catch(e){ fail(e.message); }
    $('addBtn').disabled=false;
    return;
  }

  if(kind==='existing'){
    const src=$('addExisting').value;
    if(!src) return fail('Pick a source.');
    $('addBtn').disabled=true;
    const d=await sendRequest('CreateSceneItem',{ sceneName:editingScene, sourceName:src });
    $('addBtn').disabled=false;
    if(!d.requestStatus.result) return fail('Could not add: '+reqError(d));
    logActivity(`Added ${src} to ${editingScene}`);
    await refreshItems(); populateExistingSources();
    return;
  }

  const file=$('uploadFileInput').files[0];
  if(kind==='upload' && !file) return fail('Choose a file first.');
  const name=$('addName').value.trim() || (kind==='upload' ? file.name.replace(/\.[^.]+$/,'') : '');
  if(!name) return fail('Give the source a name.');
  let actualKind=kind, inputSettings={};
  const w=parseInt($('addW').value,10)||baseW, h=parseInt($('addH').value,10)||baseH;
  if(kind==='upload'){
    actualKind='browser_source';
    try{ inputSettings=await uploadSettingsFromFile(file); }catch(e){ return fail(e.message); }
  } else if(kind==='browser_source'){
    const url=$('addUrl').value.trim();
    if(!/^(https?|file):\/\//i.test(url)) return fail('Enter a full overlay URL starting with https://');
    inputSettings={ url, width:w, height:h };
  } else if(kind==='image_source'){
    const file=$('addFile').value.trim();
    if(!file) return fail("Enter the image's file path on their PC.");
    inputSettings={ file };
  } else if(kind==='text_source'){
    const text=$('addText').value;
    if(!text.trim()) return fail('Enter some text.');
    actualKind=await pickInputKind(['text_gdiplus_v3','text_gdiplus_v2','text_ft2_source_v2','text_gdiplus','text_ft2_source']);
    if(!actualKind) return fail("Their OBS doesn't have a text source type available.");
    inputSettings={ text };
  } else if(kind==='color_source'){
    actualKind=await pickInputKind(['color_source_v3','color_source_v2','color_source']);
    if(!actualKind) return fail("Their OBS doesn't have a color source type available.");
    inputSettings={ color:hexToObsColor($('addColor').value), width:w, height:h };
  }

  $('addBtn').disabled=true;
  const d=await sendRequest('CreateInput',{ sceneName:editingScene, inputName:name, inputKind:actualKind, inputSettings });
  $('addBtn').disabled=false;
  if(!d.requestStatus.result) return fail('Could not add source: '+reqError(d));
  logActivity(`Added ${name} to ${editingScene}`);
  ['addName','addUrl','addFile','addText','uploadFileInput'].forEach(id=>{ $(id).value=''; });
  await refreshItems();
});

// A local HTML overlay or image becomes a browser source with the file embedded, so nothing needs copying to their PC
const MAX_UPLOAD_MB=12;
async function uploadSettingsFromFile(file){
  if(file.size>MAX_UPLOAD_MB*1024*1024) throw new Error(`That file is over ${MAX_UPLOAD_MB} MB — too big to send to OBS. Host it online and add it as a web page instead.`);
  const isHtml=/\.html?$/i.test(file.name);
  if(!isHtml && !file.type.startsWith('image/')) throw new Error('Only images and HTML files are supported.');
  let htmlString, width=baseW, height=baseH;
  if(isHtml) htmlString=await readFileAsText(file);
  else {
    const dataUrl=await readFileAsDataURL(file);
    const dims=await new Promise(res=>{ const im=new Image(); im.onload=()=>res({w:im.naturalWidth,h:im.naturalHeight}); im.onerror=()=>res(null); im.src=dataUrl; });
    if(dims && dims.w && dims.h){ width=dims.w; height=dims.h; }
    htmlString=`<!DOCTYPE html><html><head><style>html,body{margin:0;background:transparent;overflow:hidden;}img{width:100%;height:100%;object-fit:contain;}</style></head><body><img src="${dataUrl}"></body></html>`;
  }
  return { url:toBase64HtmlUrl(htmlString), width, height, reroute_audio:$('uploadAudio').checked };
}

// ---- Screenshot of the scene being edited ----
$('screenshotBtn').addEventListener('click',async()=>{
  if(!editingScene) return;
  $('screenshotBtn').disabled=true;
  const data=await req('GetSourceScreenshot',{ sourceName:editingScene, imageFormat:'png', imageWidth:baseW, imageHeight:baseH });
  $('screenshotBtn').disabled=false;
  if(!data){ notify('Could not capture a screenshot','err'); return; }
  const name=`${editingScene} ${new Date().toISOString().slice(0,19).replace(/[T:]/g,'-')}`;
  if(window.desktop){
    const r=await window.desktop.files.saveImage(data.imageData, name);
    if(r && r.ok) notify('Screenshot saved','ok'); else if(r && r.error) notify(r.error,'err');
  } else {
    const a=document.createElement('a'); a.href=data.imageData; a.download=name+'.png'; a.click();
  }
});

// ---- Live updates from OBS ----
obsOn('SceneItemCreated', d=>{ if(d.sceneName===editingScene) refreshItemsSoon(); });
obsOn('SceneItemRemoved', d=>{ if(d.sceneName===editingScene) refreshItemsSoon(); });
obsOn('SceneItemListReindexed', d=>{ if(d.sceneName===editingScene) refreshItemsSoon(); });
obsOn('InputNameChanged', ()=>refreshItemsSoon());
obsOn('SceneItemEnableStateChanged', d=>{
  if(d.sceneName!==editingScene) return;
  const it=stageItems.find(i=>i.sceneItemId===d.sceneItemId);
  if(it && it.sceneItemEnabled!==d.sceneItemEnabled){ it.sceneItemEnabled=d.sceneItemEnabled; renderStage(false); renderSourceList(); }
});
obsOn('SceneItemLockStateChanged', d=>{
  if(d.sceneName!==editingScene) return;
  const it=stageItems.find(i=>i.sceneItemId===d.sceneItemId);
  if(it && it.sceneItemLocked!==d.sceneItemLocked){ it.sceneItemLocked=d.sceneItemLocked; renderStage(false); renderSourceList(); }
});
// Replaces the old once-a-second polling, which also rebuilt the sources list under your mouse
obsOn('SceneItemTransformChanged', d=>{
  if(d.sceneName!==editingScene || d.sceneItemId===draggingItemId) return;
  const it=stageItems.find(i=>i.sceneItemId===d.sceneItemId);
  if(!it) return;
  it.sceneItemTransform={ ...it.sceneItemTransform, ...d.sceneItemTransform };
  const el=itemElMap[d.sceneItemId];
  if(el) positionItemEl(el,it);
});
obsOn('SourceFilterEnableStateChanged', d=>{
  if($('propsPanel').classList.contains('hidden') || d.sourceName!==propsInputName) return;
  const cb=$('flt_'+cssSafe(d.filterName));
  if(cb) cb.checked=d.filterEnabled;
});
