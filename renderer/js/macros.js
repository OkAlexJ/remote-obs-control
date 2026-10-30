// ==================== Macros: a named list of steps run one after another ====================
let macrosState=[];          // [{ id, name, icon, color, hotkey, steps:[{type, ...}] }]
let mcEditingId=null;
let mcDraftSteps=[];
const macrosRunning=new Set();

// Field kinds: scene / source / input (free text with suggestions), sound (pick a soundboard button), number, text, select
const MACRO_STEPS={
  scene:        { label:'Go live on scene',            fields:[{k:'sceneName',kind:'scene',ph:'Scene name'}] },
  preview:      { label:'Send scene to preview',       fields:[{k:'sceneName',kind:'scene',ph:'Scene name'}] },
  transition:   { label:'Transition preview → live',   fields:[] },
  showSource:   { label:'Show source',                 fields:[{k:'sourceName',kind:'source',ph:'Source'},{k:'sceneName',kind:'scene',ph:'In scene (blank = live scene)'}] },
  hideSource:   { label:'Hide source',                 fields:[{k:'sourceName',kind:'source',ph:'Source'},{k:'sceneName',kind:'scene',ph:'In scene (blank = live scene)'}] },
  toggleSource: { label:'Toggle source visibility',    fields:[{k:'sourceName',kind:'source',ph:'Source'},{k:'sceneName',kind:'scene',ph:'In scene (blank = live scene)'}] },
  mute:         { label:'Mute input',                  fields:[{k:'inputName',kind:'input',ph:'Audio input'}] },
  unmute:       { label:'Unmute input',                fields:[{k:'inputName',kind:'input',ph:'Audio input'}] },
  toggleMute:   { label:'Toggle mute',                 fields:[{k:'inputName',kind:'input',ph:'Audio input'}] },
  volume:       { label:'Set volume (dB)',             fields:[{k:'inputName',kind:'input',ph:'Audio input'},{k:'db',kind:'number',ph:'dB, e.g. -6',min:-100,max:26}] },
  setText:      { label:'Change text source',          fields:[{k:'inputName',kind:'source',ph:'Text source'},{k:'text',kind:'text',ph:'New text'}] },
  playSound:    { label:'Play soundboard button',      fields:[{k:'buttonId',kind:'sound'}] },
  stopSounds:   { label:'Stop all sounds',             fields:[] },
  tts:          { label:'Say (text to speech)',        fields:[{k:'text',kind:'text',ph:'What to say'},{k:'style',kind:'select',options:[['normal','Normal'],['asmr','ASMR whisper']]}] },
  caption:      { label:'Show troll caption',          fields:[{k:'text',kind:'text',ph:'Caption text'},{k:'style',kind:'select',options:Object.entries(CAPTION_STYLES).map(([k,s])=>[k,s.name])}] },
  notify:       { label:'Fake iPhone notification',    fields:[{k:'app',kind:'select',options:Object.entries(NOTIFY_APPS).map(([k,a])=>[k,a.glyph+' '+a.name])},{k:'title',kind:'text',ph:'From'},{k:'text',kind:'text',ph:'Message'}] },
  wait:         { label:'Wait',                        fields:[{k:'ms',kind:'number',ph:'Milliseconds',min:0,max:600000}] },
  stream:       { label:'Streaming',                   fields:[{k:'action',kind:'select',options:[['start','Start'],['stop','Stop']]}] },
  record:       { label:'Recording',                   fields:[{k:'action',kind:'select',options:[['start','Start'],['stop','Stop'],['pause','Pause'],['resume','Resume']]}] },
  replaySave:   { label:'Save replay clip',            fields:[] },
  vcam:         { label:'Virtual camera',              fields:[{k:'action',kind:'select',options:[['start','Start'],['stop','Stop']]}] }
};

function macrosLoad(){ macrosState=appStorageGet('macros', []); }
function macrosSave(){ appStorageSet('macros', macrosState); }

function describeStep(s){
  const def=MACRO_STEPS[s.type];
  if(!def) return 'Unknown step';
  switch(s.type){
    case 'scene': case 'preview': return `${def.label}: ${s.sceneName||'?'}`;
    case 'showSource': case 'hideSource': case 'toggleSource': return `${def.label}: ${s.sourceName||'?'}${s.sceneName?' in '+s.sceneName:''}`;
    case 'mute': case 'unmute': case 'toggleMute': return `${def.label}: ${s.inputName||'?'}`;
    case 'volume': return `Set ${s.inputName||'?'} to ${s.db} dB`;
    case 'setText': return `Set ${s.inputName||'?'} text`;
    case 'playSound': return `Play ${(sbState.buttons[s.buttonId]||{}).name||'(deleted button)'}`;
    case 'tts': return `Say${s.style==='asmr'?' (ASMR)':''}: ${s.text||''}`;
    case 'caption': return `Caption: ${s.text||''}`;
    case 'notify': return `Notification: ${s.title||''} — ${s.text||''}`;
    case 'wait': return `Wait ${s.ms} ms`;
    case 'stream': case 'record': case 'vcam': return `${def.label}: ${s.action}`;
    default: return def.label;
  }
}

// ---- Running ----
async function sceneItemIdFor(sceneName, sourceName){
  const r=await sendRequest('GetSceneItemId',{ sceneName, sourceName });
  if(!r.requestStatus.result) throw new Error(`"${sourceName}" isn't in scene "${sceneName}"`);
  return r.responseData.sceneItemId;
}
async function must(type, data){
  const d=await sendRequest(type, data);
  if(!d.requestStatus.result) throw new Error(reqError(d));
  return d.responseData||{};
}

async function runStep(s){
  const scene=s.sceneName||currentProgramScene;
  switch(s.type){
    case 'scene': return must('SetCurrentProgramScene',{ sceneName:s.sceneName });
    case 'preview': return must('SetCurrentPreviewScene',{ sceneName:s.sceneName });
    case 'transition': return must('TriggerStudioModeTransition');
    case 'showSource': case 'hideSource': case 'toggleSource': {
      const id=await sceneItemIdFor(scene, s.sourceName);
      let enabled=s.type==='showSource';
      if(s.type==='toggleSource') enabled=!(await must('GetSceneItemEnabled',{ sceneName:scene, sceneItemId:id })).sceneItemEnabled;
      return must('SetSceneItemEnabled',{ sceneName:scene, sceneItemId:id, sceneItemEnabled:enabled });
    }
    case 'mute': return must('SetInputMute',{ inputName:s.inputName, inputMuted:true });
    case 'unmute': return must('SetInputMute',{ inputName:s.inputName, inputMuted:false });
    case 'toggleMute': return must('ToggleInputMute',{ inputName:s.inputName });
    case 'volume': return must('SetInputVolume',{ inputName:s.inputName, inputVolumeDb:Math.max(-100,Math.min(26,Number(s.db)||0)) });
    case 'setText': return must('SetInputSettings',{ inputName:s.inputName, inputSettings:{ text:s.text??'' }, overlay:true });
    case 'playSound': return sbPlayButton(s.buttonId);
    case 'stopSounds': return sbStopAll();
    case 'tts': { const p=appStorageGet('ttsPrefs',{}); return sayOnStream(s.text, s.style, p.voice||'', p.volume); }
    case 'caption': return showCaption(s.text, s.style);
    case 'notify': return sendFakeNotification({ app:s.app, title:s.title||'', text:s.text||'' });
    case 'wait': return sleep(Math.max(0,Math.min(600000,Number(s.ms)||0)));
    // Output steps are no-ops when OBS is already in the wanted state, so re-running a macro doesn't fail
    case 'stream':
      if((s.action==='stop')!==outputs.stream.active) return;
      return must(s.action==='stop'?'StopStream':'StartStream');
    case 'record': {
      const r=outputs.record;
      if(s.action==='start' && r.active) return;
      if(s.action==='stop' && !r.active) return;
      if(s.action==='pause' && (!r.active || r.paused)) return;
      if(s.action==='resume' && (!r.active || !r.paused)) return;
      return must({ start:'StartRecord', stop:'StopRecord', pause:'PauseRecord', resume:'ResumeRecord' }[s.action]||'StartRecord');
    }
    case 'replaySave': return must('SaveReplayBuffer');
    case 'vcam':
      if((s.action==='stop')!==outputs.vcam.active) return;
      return must(s.action==='stop'?'StopVirtualCam':'StartVirtualCam');
  }
}

async function runMacroSteps(name, steps, id){
  if(!isConnected()){ notify('Connect to OBS first','err'); return; }
  if(id && macrosRunning.has(id)) return;
  if(id){ macrosRunning.add(id); setMacroTileRunning(id,true); }
  logActivity(`Macro "${name}" started`);
  let i=0;
  try{
    for(; i<steps.length; i++) await runStep(steps[i]);
    notify(`Macro "${name}" done`,'ok');
  } catch(e){
    notify(`Macro "${name}" stopped at step ${i+1} (${describeStep(steps[i])}): ${e.message}`,'err');
    logActivity(`Macro "${name}" failed at step ${i+1}: ${e.message}`);
  } finally {
    if(id){ macrosRunning.delete(id); setMacroTileRunning(id,false); }
  }
}
function runMacro(id){
  const m=macrosState.find(x=>x.id===id);
  if(m) runMacroSteps(m.name, m.steps, m.id);
}

// ---- Grid ----
function setMacroTileRunning(id,on){
  const tile=document.querySelector(`#macroGrid [data-macro-id="${CSS.escape(id)}"]`);
  if(tile) tile.classList.toggle('playing',on);
}
function renderMacroGrid(){
  const grid=$('macroGrid');
  grid.innerHTML='';
  macrosState.forEach(m=>{
    const tile=document.createElement('div');
    tile.className='sb-btn'+(macrosRunning.has(m.id)?' playing':'');
    tile.dataset.macroId=m.id;
    tile.style.background=`linear-gradient(160deg, ${m.color||'#e0b23f'}, ${sbShade(m.color||'#e0b23f',-28)})`;
    tile.title=m.steps.map((s,i)=>`${i+1}. ${describeStep(s)}`).join('\n')||'No steps yet';
    tile.innerHTML=`
      ${m.hotkey?`<span class="sb-hotkey">${escapeHtml(m.hotkey)}</span>`:''}
      <span class="sb-edit" title="Edit">⚙</span>
      <span class="sb-icon">${escapeHtml(m.icon||'⚡')}</span>
      <span class="sb-name">${escapeHtml(m.name)}</span>
      <span class="sb-loop">${m.steps.length} step${m.steps.length===1?'':'s'}</span>
    `;
    tile.addEventListener('click',e=>{ if(!e.target.closest('.sb-edit')) runMacro(m.id); });
    tile.querySelector('.sb-edit').addEventListener('click',e=>{ e.stopPropagation(); openMacroModal(m.id); });
    tile.addEventListener('contextmenu',e=>{
      e.preventDefault();
      showContextMenu(e.clientX,e.clientY,[
        { label:'Run', run:()=>runMacro(m.id) },
        { label:'Edit…', run:()=>openMacroModal(m.id) },
        { label:'Duplicate', run:()=>{ macrosState.push({ ...JSON.parse(JSON.stringify(m)), id:uid('m_'), name:m.name+' copy', hotkey:null }); macrosSave(); renderMacroGrid(); } },
        { sep:true },
        { label:'Delete', danger:true, run:()=>deleteMacro(m.id) }
      ]);
    });
    grid.appendChild(tile);
  });
  const add=document.createElement('div');
  add.className='sb-add-tile';
  add.innerHTML='<span>+</span><small>New macro</small>';
  add.title='A macro does several things with one click — e.g. switch scene, mute the mic and start recording';
  add.addEventListener('click',()=>openMacroModal(null));
  grid.appendChild(add);
}

// ---- Editor ----
const mcResetHotkeyField=wireHotkeyField('mcFieldHotkey','mcRecordHotkeyBtn','mcClearHotkeyBtn');

async function fillMacroDatalists(){
  const opts=list=>[...new Set(list)].filter(Boolean).map(n=>`<option value="${escapeHtml(n)}"></option>`).join('');
  $('dlScenes').innerHTML=opts(scenesData.map(s=>s.sceneName));
  let inputs=[];
  if(isConnected()){
    const il=await req('GetInputList');
    inputs=((il&&il.inputs)||[]).map(i=>i.inputName).filter(n=>!isSbPlayerName(n));
  }
  $('dlSources').innerHTML=opts(inputs.concat(stageItems.map(i=>i.sourceName).filter(n=>!isSbPlayerName(n))));
  $('dlInputs').innerHTML=opts(audioInputs.map(i=>i.inputName).concat(inputs));
}

function renderMacroSteps(){
  const wrap=$('mcSteps');
  wrap.innerHTML='';
  if(!mcDraftSteps.length){ wrap.innerHTML='<div class="empty-note">No steps yet — add one below.</div>'; return; }
  mcDraftSteps.forEach((step,idx)=>{
    const row=document.createElement('div');
    row.className='mc-step';
    const typeSel=document.createElement('select');
    typeSel.innerHTML=Object.entries(MACRO_STEPS).map(([k,d])=>`<option value="${k}">${escapeHtml(d.label)}</option>`).join('');
    typeSel.value=step.type;
    typeSel.addEventListener('change',()=>{ mcDraftSteps[idx]=defaultStep(typeSel.value); renderMacroSteps(); });
    const num=document.createElement('span');
    num.className='mc-num'; num.textContent=idx+1;
    const fields=document.createElement('div');
    fields.className='mc-fields';
    fields.appendChild(typeSel);
    MACRO_STEPS[step.type].fields.forEach(f=>fields.appendChild(stepFieldInput(step,f)));
    const tools=document.createElement('div');
    tools.className='mc-tools';
    [['↑','Move up',()=>{ if(idx>0){ [mcDraftSteps[idx-1],mcDraftSteps[idx]]=[mcDraftSteps[idx],mcDraftSteps[idx-1]]; renderMacroSteps(); } }],
     ['↓','Move down',()=>{ if(idx<mcDraftSteps.length-1){ [mcDraftSteps[idx+1],mcDraftSteps[idx]]=[mcDraftSteps[idx],mcDraftSteps[idx+1]]; renderMacroSteps(); } }],
     ['✕','Remove step',()=>{ mcDraftSteps.splice(idx,1); renderMacroSteps(); }]
    ].forEach(([t,title,fn])=>{ const b=document.createElement('button'); b.type='button'; b.className='toggle-btn'+(t==='✕'?' danger':''); b.textContent=t; b.title=title; b.addEventListener('click',fn); tools.appendChild(b); });
    row.appendChild(num); row.appendChild(fields); row.appendChild(tools);
    wrap.appendChild(row);
  });
}

function stepFieldInput(step, f){
  let el;
  if(f.kind==='select'){
    el=document.createElement('select');
    el.innerHTML=f.options.map(([v,l])=>`<option value="${v}">${escapeHtml(l)}</option>`).join('');
    el.value=step[f.k]||f.options[0][0];
    step[f.k]=el.value;
  } else if(f.kind==='sound'){
    el=document.createElement('select');
    const btns=Object.values(sbState.buttons);
    el.innerHTML=btns.length ? btns.map(b=>`<option value="${escapeHtml(b.id)}">${escapeHtml((b.icon||'🔊')+' '+b.name)}</option>`).join('') : '<option value="">(no soundboard buttons yet)</option>';
    if(step[f.k] && sbState.buttons[step[f.k]]) el.value=step[f.k];
    step[f.k]=el.value;
  } else {
    el=document.createElement('input');
    el.type=f.kind==='number'?'number':'text';
    if(f.min!==undefined) el.min=f.min;
    if(f.max!==undefined) el.max=f.max;
    el.placeholder=f.ph||'';
    if(f.kind==='scene') el.setAttribute('list','dlScenes');
    if(f.kind==='source') el.setAttribute('list','dlSources');
    if(f.kind==='input') el.setAttribute('list','dlInputs');
    el.value=step[f.k]??'';
  }
  el.addEventListener(el.tagName==='SELECT'?'change':'input',()=>{ step[f.k]=f.kind==='number'?(el.value===''?'':Number(el.value)):el.value; });
  return el;
}

function defaultStep(type){
  const s={ type };
  if(type==='scene' || type==='preview') s.sceneName=currentProgramScene||'';
  if(type==='wait') s.ms=1000;
  if(type==='volume') s.db=0;
  return s;
}

function openMacroModal(id){
  mcEditingId=id;
  const m=id?macrosState.find(x=>x.id===id):null;
  $('macroModalTitle').textContent=m?'Edit Macro':'New Macro';
  $('mcFieldName').value=m?m.name:'';
  $('mcFieldIcon').value=m?(m.icon||'⚡'):'⚡';
  $('mcFieldColor').value=m?(m.color||'#e0b23f'):'#e0b23f';
  $('mcFieldHotkey').value=m?(m.hotkey||''):'';
  $('mcDeleteBtn').style.display=m?'inline-block':'none';
  mcDraftSteps=m?JSON.parse(JSON.stringify(m.steps)):[defaultStep('scene')];
  hideBoxErr('mcModalErr');
  fillMacroDatalists();
  renderMacroSteps();
  openModal('macroModal','macroModalBackdrop',mcResetHotkeyField);
  setTimeout(()=>$('mcFieldName').focus(),0);
}

function validateSteps(steps){
  for(let i=0;i<steps.length;i++){
    const s=steps[i], def=MACRO_STEPS[s.type];
    for(const f of def.fields){
      const v=s[f.k];
      const optional=f.k==='sceneName' && ['showSource','hideSource','toggleSource'].includes(s.type);
      if(!optional && f.kind!=='text' && (v===undefined || v==='')) return `Step ${i+1} (${def.label}) needs a ${f.ph||f.k}.`;
    }
  }
  return null;
}

$('mcAddStepBtn').addEventListener('click',()=>{
  const last=mcDraftSteps[mcDraftSteps.length-1];
  mcDraftSteps.push(defaultStep(last && last.type==='wait' ? 'scene' : (last?'wait':'scene')));
  renderMacroSteps();
});
$('mcModalCancel').addEventListener('click',()=>closeModal('macroModal'));
$('macroModalBackdrop').addEventListener('click',()=>closeModal('macroModal'));
$('mcTestBtn').addEventListener('click',()=>{
  const err=validateSteps(mcDraftSteps);
  if(err) return showBoxErr('mcModalErr',err);
  runMacroSteps($('mcFieldName').value.trim()||'Test', JSON.parse(JSON.stringify(mcDraftSteps)), null);
});
$('mcModalSave').addEventListener('click',()=>{
  hideBoxErr('mcModalErr');
  const name=$('mcFieldName').value.trim();
  if(!name) return showBoxErr('mcModalErr','Give the macro a name.');
  if(!mcDraftSteps.length) return showBoxErr('mcModalErr','Add at least one step.');
  const err=validateSteps(mcDraftSteps);
  if(err) return showBoxErr('mcModalErr',err);
  const hotkey=$('mcFieldHotkey').value.trim()||null;
  const conflict=hotkeyConflict(hotkey,'macro',mcEditingId);
  if(conflict) return showBoxErr('mcModalErr',conflict);
  const data={ name, icon:$('mcFieldIcon').value.trim()||'⚡', color:$('mcFieldColor').value, hotkey, steps:JSON.parse(JSON.stringify(mcDraftSteps)) };
  if(mcEditingId){ const i=macrosState.findIndex(x=>x.id===mcEditingId); macrosState[i]={ ...macrosState[i], ...data }; }
  else macrosState.push({ id:uid('m_'), ...data });
  macrosSave();
  closeModal('macroModal');
  renderMacroGrid();
});
async function deleteMacro(id){
  const m=macrosState.find(x=>x.id===id);
  if(!m || !await askConfirm(`Delete macro "${m.name}"?`, '', 'Delete', true)) return;
  macrosState=macrosState.filter(x=>x.id!==id);
  macrosSave();
  if(!$('macroModal').classList.contains('hidden')) closeModal('macroModal');
  renderMacroGrid();
}
$('mcDeleteBtn').addEventListener('click',()=>{ if(mcEditingId) deleteMacro(mcEditingId); });

function initMacrosUI(){ macrosLoad(); renderMacroGrid(); }
