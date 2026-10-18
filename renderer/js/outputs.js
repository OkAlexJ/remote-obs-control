// ==================== Outputs: stream / record / replay buffer / virtual cam + stats ====================
const outputs={
  stream:{ active:false, state:'', startedAt:0 },
  record:{ active:false, paused:false, state:'', durationMs:0, syncedAt:0 },
  replay:{ active:false, available:true },
  vcam:{ active:false, available:true }
};
let statsTimer=null;
let lastStreamBytes=null, lastStreamBytesAt=0;

const OUT_STATE={
  STARTING:'OBS_WEBSOCKET_OUTPUT_STARTING', STARTED:'OBS_WEBSOCKET_OUTPUT_STARTED',
  STOPPING:'OBS_WEBSOCKET_OUTPUT_STOPPING', STOPPED:'OBS_WEBSOCKET_OUTPUT_STOPPED',
  PAUSED:'OBS_WEBSOCKET_OUTPUT_PAUSED', RESUMED:'OBS_WEBSOCKET_OUTPUT_RESUMED',
  RECONNECTING:'OBS_WEBSOCKET_OUTPUT_RECONNECTING', RECONNECTED:'OBS_WEBSOCKET_OUTPUT_RECONNECTED'
};

function setOutBtn(id, state, label){
  const b=$(id);
  b.dataset.state=state; // off | busy | on | paused
  if(label) b.querySelector('.out-label').textContent=label;
}

function renderOutputs(){
  const s=outputs.stream, r=outputs.record;
  if(s.state===OUT_STATE.STARTING) setOutBtn('streamBtn','busy','Starting…');
  else if(s.state===OUT_STATE.STOPPING) setOutBtn('streamBtn','busy','Stopping…');
  else if(s.state===OUT_STATE.RECONNECTING) setOutBtn('streamBtn','busy','Reconnecting…');
  else setOutBtn('streamBtn', s.active?'on':'off', s.active?'LIVE':'Go Live');
  if(!s.active) $('streamTime').textContent='';
  $('statBitrateWrap').classList.toggle('hidden', !s.active);

  if(r.state===OUT_STATE.STARTING) setOutBtn('recordBtn','busy','Starting…');
  else if(r.state===OUT_STATE.STOPPING) setOutBtn('recordBtn','busy','Saving…');
  else setOutBtn('recordBtn', r.active?(r.paused?'paused':'on'):'off', r.active?(r.paused?'Paused':'REC'):'Record');
  if(!r.active) $('recordTime').textContent='';
  $('recordPauseBtn').classList.toggle('hidden', !r.active);
  $('recordPauseBtn').textContent=r.paused?'▶':'⏸';
  $('recordPauseBtn').title=r.paused?'Resume recording':'Pause recording';

  $('replayBtn').classList.toggle('hidden', !outputs.replay.available);
  setOutBtn('replayBtn', outputs.replay.active?'on':'off');
  $('replaySaveBtn').classList.toggle('hidden', !outputs.replay.active);
  $('vcamBtn').classList.toggle('hidden', !outputs.vcam.available);
  setOutBtn('vcamBtn', outputs.vcam.active?'on':'off');
  document.title=(s.active?'🔴 LIVE · ':'')+(r.active?'⏺ REC · ':'')+'Remote OBS Control';
}

async function loadOutputs(){
  const [st, rec, rb, vc]=await Promise.all([req('GetStreamStatus'), req('GetRecordStatus'), sendRequest('GetReplayBufferStatus'), sendRequest('GetVirtualCamStatus')]);
  if(st){ outputs.stream.active=st.outputActive; outputs.stream.state=''; outputs.stream.startedAt=st.outputActive?Date.now()-(st.outputDuration||0):0; }
  if(rec){ outputs.record.active=rec.outputActive; outputs.record.paused=!!rec.outputPaused; outputs.record.state=''; outputs.record.durationMs=rec.outputDuration||0; outputs.record.syncedAt=Date.now(); }
  // Replay buffer / virtual cam fail when they're not set up in that OBS — hide their buttons then
  outputs.replay.available=!!rb.requestStatus.result; outputs.replay.active=!!(rb.responseData && rb.responseData.outputActive);
  outputs.vcam.available=!!vc.requestStatus.result; outputs.vcam.active=!!(vc.responseData && vc.responseData.outputActive);
  lastStreamBytes=null;
  renderOutputs();
}

async function pollStats(){
  if(!isConnected() || document.hidden) return;
  const stats=await req('GetStats');
  if(stats){
    $('statFps').textContent=stats.activeFps.toFixed(1);
    $('statCpu').textContent=stats.cpuUsage.toFixed(1)+'%';
    $('statMem').textContent=Math.round(stats.memoryUsage)+' MB';
    const dropped=(stats.renderSkippedFrames||0)+(stats.outputSkippedFrames||0);
    let streamDropped=0;
    if(outputs.stream.active){
      const ss=await req('GetStreamStatus');
      if(ss){
        streamDropped=ss.outputSkippedFrames||0;
        outputs.stream.startedAt=Date.now()-(ss.outputDuration||0);
        if(lastStreamBytes!==null && ss.outputBytes>=lastStreamBytes){
          const kbps=((ss.outputBytes-lastStreamBytes)*8/1000)/((Date.now()-lastStreamBytesAt)/1000);
          $('statBitrate').textContent=Math.round(kbps)+' kb/s';
        }
        lastStreamBytes=ss.outputBytes; lastStreamBytesAt=Date.now();
        const cong=ss.outputCongestion||0;
        $('statBitrate').style.color=cong>0.5?'var(--danger)':cong>0.2?'#e0b23f':'';
      }
    }
    const el=$('statDropped');
    el.textContent=String(dropped+streamDropped);
    el.style.color=(dropped+streamDropped)>0?'#e0b23f':'';
    $('statFps').style.color=stats.activeFps<25?'var(--danger)':'';
  }
  if(outputs.record.active && !outputs.record.paused){
    const rs=await req('GetRecordStatus');
    if(rs){ outputs.record.durationMs=rs.outputDuration||0; outputs.record.syncedAt=Date.now(); }
  }
}

// Clocks tick locally every half second between the 2s stats polls
function tickClocks(){
  if(outputs.stream.active) $('streamTime').textContent=formatDuration(Date.now()-outputs.stream.startedAt);
  const r=outputs.record;
  if(r.active) $('recordTime').textContent=formatDuration(r.durationMs+(r.paused?0:Date.now()-r.syncedAt));
}
let clockTimer=null;
function startStatsLoop(){
  stopStatsLoop();
  pollStats();
  statsTimer=setInterval(pollStats, 2000);
  clockTimer=setInterval(tickClocks, 500);
}
function stopStatsLoop(){ clearInterval(statsTimer); clearInterval(clockTimer); statsTimer=clockTimer=null; }

// ---- Actions (also used by macros + command palette) ----
async function outputAction(type, label){
  const d=await sendRequest(type);
  if(!d.requestStatus.result){ notify(`${label} failed: ${reqError(d)}`,'err'); return false; }
  return true;
}
async function toggleStream(){
  if(outputs.stream.active){
    if(PREFS.confirmStream && !await askConfirm('End the stream?', 'Your stream will go offline for viewers.', 'End stream', true)) return;
    if(await outputAction('StopStream','Stop stream')) { outputs.stream.state=OUT_STATE.STOPPING; renderOutputs(); }
  } else {
    if(PREFS.confirmStream && !await askConfirm('Go live now?', `This starts streaming from OBS on ${OBS.lastConn?OBS.lastConn.host:'the other PC'} using its stream settings.`, 'Go live')) return;
    if(await outputAction('StartStream','Start stream')) { outputs.stream.state=OUT_STATE.STARTING; renderOutputs(); }
  }
}
async function toggleRecord(){
  if(outputs.record.active) await outputAction('StopRecord','Stop recording');
  else await outputAction('StartRecord','Start recording');
}
async function toggleRecordPause(){
  if(!outputs.record.active) return;
  await outputAction(outputs.record.paused?'ResumeRecord':'PauseRecord', outputs.record.paused?'Resume':'Pause');
}
async function toggleReplay(){ await outputAction(outputs.replay.active?'StopReplayBuffer':'StartReplayBuffer','Replay buffer'); }
async function saveReplay(){ if(await outputAction('SaveReplayBuffer','Save clip')) notify('Saving clip…'); }
async function toggleVcam(){ await outputAction(outputs.vcam.active?'StopVirtualCam':'StartVirtualCam','Virtual camera'); }

$('streamBtn').addEventListener('click', toggleStream);
$('recordBtn').addEventListener('click', toggleRecord);
$('recordPauseBtn').addEventListener('click', toggleRecordPause);
$('replayBtn').addEventListener('click', toggleReplay);
$('replaySaveBtn').addEventListener('click', saveReplay);
$('vcamBtn').addEventListener('click', toggleVcam);

// ---- Events ----
obsOn('StreamStateChanged', d=>{
  const s=outputs.stream;
  s.state=d.outputState;
  if(d.outputState===OUT_STATE.STARTED){ s.active=true; s.startedAt=Date.now(); lastStreamBytes=null; notify('🔴 You are live','ok'); logActivity('Stream started'); }
  else if(d.outputState===OUT_STATE.STOPPED){ s.active=false; notify('Stream ended'); logActivity('Stream stopped'); }
  else if(d.outputState===OUT_STATE.RECONNECTING){ notify('Stream connection dropped — OBS is reconnecting','err'); logActivity('Stream reconnecting'); }
  else if(d.outputState===OUT_STATE.RECONNECTED){ s.active=true; notify('Stream reconnected','ok'); }
  if(d.outputState===OUT_STATE.STARTED || d.outputState===OUT_STATE.STOPPED || d.outputState===OUT_STATE.RECONNECTED) s.state='';
  renderOutputs();
});
obsOn('RecordStateChanged', d=>{
  const r=outputs.record;
  r.state=d.outputState;
  if(d.outputState===OUT_STATE.STARTED){ r.active=true; r.paused=false; r.durationMs=0; r.syncedAt=Date.now(); logActivity('Recording started'); notify('Recording started','ok'); }
  else if(d.outputState===OUT_STATE.STOPPED){ r.active=false; r.paused=false; logActivity('Recording saved'+(d.outputPath?': '+d.outputPath:'')); notify('Recording saved','ok'); }
  else if(d.outputState===OUT_STATE.PAUSED){ r.durationMs+=Date.now()-r.syncedAt; r.syncedAt=Date.now(); r.paused=true; logActivity('Recording paused'); }
  else if(d.outputState===OUT_STATE.RESUMED){ r.syncedAt=Date.now(); r.paused=false; logActivity('Recording resumed'); }
  if(d.outputState!==OUT_STATE.STARTING && d.outputState!==OUT_STATE.STOPPING) r.state='';
  renderOutputs();
});
obsOn('ReplayBufferStateChanged', d=>{ outputs.replay.active=d.outputActive; outputs.replay.available=true; renderOutputs(); logActivity(d.outputActive?'Replay buffer on':'Replay buffer off'); });
obsOn('ReplayBufferSaved', d=>{ notify('Clip saved','ok'); logActivity('Saved replay clip'+(d.savedReplayPath?': '+d.savedReplayPath:'')); });
obsOn('VirtualcamStateChanged', d=>{ outputs.vcam.active=d.outputActive; renderOutputs(); logActivity(d.outputActive?'Virtual camera on':'Virtual camera off'); });
