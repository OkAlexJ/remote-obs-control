// ==================== App lifecycle ====================
function enterApp(profile){
  $('profileBarAvatar').textContent=profile.avatar||'🎬';
  $('profileBarName').textContent=profile.name;
  $('fpsSelect').value=appStorageGet('previewFps','15');
  initAudioPrefs();
  initSoundboardUI();
  initMacrosUI();
  initTwitchUI();
  renderActivityLog();
  setConnectedUI(false);
  setStatus('Not connected','');
  $('appRoot').classList.remove('hidden');
}

function setConnectedUI(on){
  ['scenesPanel','mainArea','outputsPanel'].forEach(id=>$(id).classList.toggle('hidden',!on));
  $('emptyState').classList.toggle('hidden',on);
}

obsOn('ConnectionOpened', async ({ host, port })=>{
  if(!window.desktop) appStorageSet('lastConnection',{ host, port });
  sbResetPool();
  setConnectedUI(true);
  const vs=await req('GetVideoSettings');
  if(vs){ baseW=vs.baseWidth; baseH=vs.baseHeight; $('addW').value=baseW; $('addH').value=baseH; }
  await loadScenes();
  await Promise.all([ loadScene(editingScene), loadAudioInputs(), loadOutputs(), loadStudioAndTransitions() ]);
  startThumbLoop();
  startStatsLoop();
});

obsOn('ConnectionClosed', ()=>{
  stopStageBgLoop();
  stopThumbLoop();
  stopStatsLoop();
  closeProps();
  $('previewPanel').classList.add('hidden');
  // Keep the last layout on screen while auto-reconnecting; hide it once we've really disconnected
  setTimeout(()=>{ if(!isConnected() && !OBS.reconnectTimer) setConnectedUI(false); }, 50);
  document.title='Remote OBS Control';
});

// OBS itself is shutting down — say so instead of a generic "connection lost"
obsOn('ExitStarted', ()=>{ notify('OBS on the other PC is closing','err'); logActivity('OBS closed on the remote PC'); });

if(window.desktop) window.desktop.app.version().then(v=>{ $('helpVersion').textContent='Remote OBS Control v'+v; });

initProfileLauncher();
