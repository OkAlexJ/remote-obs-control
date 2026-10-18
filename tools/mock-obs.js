#!/usr/bin/env node
// A tiny fake OBS (obs-websocket v5) for trying the app without a real OBS install.
//   node tools/mock-obs.js [port] [password]
// No dependencies: implements just enough of the WebSocket protocol by hand.
const http = require('http');
const crypto = require('crypto');

const PORT = parseInt(process.argv[2] || '4455', 10);
const PASSWORD = process.argv[3] || '';

// ---------------- Fake OBS state ----------------
const state = {
  base: { w: 1920, h: 1080 },
  scenes: ['Starting Soon', 'Gameplay', 'Just Chatting', 'BRB', 'Ending'],
  program: 'Gameplay',
  preview: 'Just Chatting',
  studioMode: false,
  transitions: ['Fade', 'Cut', 'Swipe'],
  transition: 'Fade',
  transitionDuration: 300,
  stream: { active: false, start: 0, bytes: 0 },
  record: { active: false, paused: false, start: 0, pausedMs: 0, pauseAt: 0 },
  replay: { active: false },
  vcam: { active: false },
  inputs: {}, // name -> { kind, settings, volDb, muted, audio }
  items: {},  // scene -> [{ id, source, enabled, locked, index, transform }]
  nextId: 1
};
const COLORS = { 'Starting Soon': '#3b2a7a', 'Gameplay': '#1d4d6b', 'Just Chatting': '#5a2f4f', 'BRB': '#5a4a1d', 'Ending': '#1d5a3a' };

function addInput(name, kind, settings = {}, audio = false) {
  state.inputs[name] = { kind, settings, volDb: audio ? -6 : 0, muted: false, audio };
}
function transformFor(w, h, x = 0, y = 0, sx = 1, sy = 1) {
  return {
    positionX: x, positionY: y, scaleX: sx, scaleY: sy, rotation: 0, alignment: 5,
    sourceWidth: w, sourceHeight: h, width: w * sx, height: h * sy,
    boundsType: 'OBS_BOUNDS_NONE', boundsWidth: 0, boundsHeight: 0, boundsAlignment: 0,
    cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0
  };
}
function addItem(scene, source, t) {
  const list = state.items[scene] = state.items[scene] || [];
  const item = { id: state.nextId++, source, enabled: true, locked: false, transform: t };
  list.push(item);
  return item;
}
addInput('Mic/Aux', 'wasapi_input_capture', {}, true);
addInput('Desktop Audio', 'wasapi_output_capture', {}, true);
addInput('Game Capture', 'game_capture', { capture_mode: 'any_fullscreen' }, true);
addInput('Webcam', 'dshow_input', { video_device_id: 'cam0' });
addInput('Alerts', 'browser_source', { url: 'https://example.com/alerts', width: 800, height: 600 }, true);
addInput('Title', 'text_gdiplus_v2', { text: 'Welcome to the stream!', font: { face: 'Arial', size: 72 } });
addInput('Intro Video', 'ffmpeg_source', { local_file: 'C:/videos/intro.mp4', looping: true }, true);
state.scenes.forEach(s => { state.items[s] = []; });
addItem('Gameplay', 'Game Capture', transformFor(1920, 1080));
addItem('Gameplay', 'Webcam', transformFor(640, 360, 1260, 700, 1, 1));
addItem('Gameplay', 'Alerts', transformFor(800, 600, 560, 40, 1, 1));
addItem('Just Chatting', 'Webcam', transformFor(1280, 720, 320, 180));
addItem('Just Chatting', 'Title', transformFor(900, 90, 510, 60));
addItem('Starting Soon', 'Intro Video', transformFor(1920, 1080));
addItem('Starting Soon', 'Title', transformFor(900, 90, 510, 900));
addItem('BRB', 'Title', transformFor(900, 90, 510, 495));

const media = { 'Intro Video': { duration: 60000, cursor: 0, state: 'OBS_MEDIA_STATE_PLAYING' } };
const filters = { 'Webcam': [{ filterName: 'Color Correction', filterKind: 'color_filter_v2', filterEnabled: true }, { filterName: 'Chroma Key', filterKind: 'chroma_key_filter_v2', filterEnabled: false }], 'Mic/Aux': [{ filterName: 'Noise Suppression', filterKind: 'noise_suppress_filter_v2', filterEnabled: true }] };

function svgShot(label, color, w, h) {
  const t = (Date.now() / 1000) % 60;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 1920 1080">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#0b0b10"/></linearGradient></defs>
<rect width="1920" height="1080" fill="url(#g)"/>
<circle cx="${960 + Math.cos(t) * 500}" cy="${540 + Math.sin(t) * 300}" r="80" fill="#ffffff22"/>
<text x="960" y="560" font-family="Segoe UI,Arial" font-size="110" fill="#fff" text-anchor="middle">${label.replace(/[<&>]/g, '')}</text>
<text x="960" y="680" font-family="Segoe UI,Arial" font-size="40" fill="#ffffffaa" text-anchor="middle">mock OBS · ${new Date().toLocaleTimeString()}</text></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

const sceneItemObj = (scene, it, i) => ({
  sceneItemId: it.id, sourceName: it.source, sceneItemEnabled: it.enabled, sceneItemLocked: it.locked,
  sceneItemIndex: i, inputKind: (state.inputs[it.source] || {}).kind || null, isGroup: false, sourceType: 'OBS_SOURCE_TYPE_INPUT',
  sceneItemTransform: it.transform
});
const findItem = (scene, id) => (state.items[scene] || []).find(i => i.id === id);
const dbToMul = db => db <= -100 ? 0 : Math.pow(10, db / 20);
const timecode = ms => { const s = Math.floor(ms / 1000); const p = n => String(n).padStart(2, '0'); return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}.${String(ms % 1000).padStart(3, '0')}`; };
const recDur = () => state.record.active ? (state.record.paused ? state.record.pauseAt : Date.now()) - state.record.start - state.record.pausedMs : 0;

// ---------------- Requests ----------------
function handle(type, d, client) {
  const ok = (data = {}) => ({ ok: true, data });
  const fail = (code, comment) => ({ ok: false, code, comment });
  switch (type) {
    case 'GetVersion': return ok({ obsVersion: '30.2.0', obsWebSocketVersion: '5.5.0', rpcVersion: 1, platform: 'windows' });
    case 'GetVideoSettings': return ok({ baseWidth: state.base.w, baseHeight: state.base.h, outputWidth: 1280, outputHeight: 720, fpsNumerator: 60, fpsDenominator: 1 });
    case 'GetStats': return ok({ cpuUsage: 8 + Math.random() * 6, memoryUsage: 512 + Math.random() * 20, activeFps: 59.9 + Math.random() * 0.1, averageFrameRenderTime: 2.1, renderSkippedFrames: 0, renderTotalFrames: 100000, outputSkippedFrames: 3, outputTotalFrames: 90000 });
    case 'GetSceneList': return ok({ currentProgramSceneName: state.program, currentPreviewSceneName: state.studioMode ? state.preview : null, scenes: state.scenes.map((s, i) => ({ sceneName: s, sceneIndex: state.scenes.length - 1 - i })).reverse() });
    case 'SetCurrentProgramScene':
      if (!state.scenes.includes(d.sceneName)) return fail(600, 'No scene with that name');
      state.program = d.sceneName; broadcast('CurrentProgramSceneChanged', { sceneName: d.sceneName }, 1 << 2); return ok();
    case 'SetCurrentPreviewScene':
      if (!state.studioMode) return fail(506, 'Studio mode is not active');
      state.preview = d.sceneName; broadcast('CurrentPreviewSceneChanged', { sceneName: d.sceneName }, 1 << 2); return ok();
    case 'GetStudioModeEnabled': return ok({ studioModeEnabled: state.studioMode });
    case 'SetStudioModeEnabled':
      state.studioMode = !!d.studioModeEnabled; broadcast('StudioModeStateChanged', { studioModeEnabled: state.studioMode }, 1 << 10);
      if (state.studioMode) broadcast('CurrentPreviewSceneChanged', { sceneName: state.preview }, 1 << 2);
      return ok();
    case 'TriggerStudioModeTransition': {
      if (!state.studioMode) return fail(506, 'Studio mode is not active');
      const old = state.program; state.program = state.preview; state.preview = old;
      broadcast('CurrentProgramSceneChanged', { sceneName: state.program }, 1 << 2);
      broadcast('CurrentPreviewSceneChanged', { sceneName: state.preview }, 1 << 2);
      return ok();
    }
    case 'GetSceneTransitionList': return ok({ currentSceneTransitionName: state.transition, currentSceneTransitionKind: 'fade_transition', transitions: state.transitions.map(t => ({ transitionName: t, transitionKind: t.toLowerCase() + '_transition', transitionFixed: t === 'Cut', transitionConfigurable: true })) });
    case 'GetCurrentSceneTransition': return ok({ transitionName: state.transition, transitionDuration: state.transitionDuration, transitionFixed: state.transition === 'Cut' });
    case 'SetCurrentSceneTransition': state.transition = d.transitionName; broadcast('CurrentSceneTransitionChanged', { transitionName: d.transitionName }, 1 << 4); return ok();
    case 'SetCurrentSceneTransitionDuration': state.transitionDuration = d.transitionDuration; broadcast('CurrentSceneTransitionDurationChanged', { transitionDuration: d.transitionDuration }, 1 << 4); return ok();
    case 'CreateScene':
      if (state.scenes.includes(d.sceneName)) return fail(601, 'A source already exists by that name');
      state.scenes.push(d.sceneName); state.items[d.sceneName] = []; broadcast('SceneCreated', { sceneName: d.sceneName, isGroup: false }, 1 << 2);
      broadcast('SceneListChanged', { scenes: handle('GetSceneList').data.scenes }, 1 << 2); return ok();
    case 'RemoveScene':
      state.scenes = state.scenes.filter(s => s !== d.sceneName); delete state.items[d.sceneName];
      if (state.program === d.sceneName) { state.program = state.scenes[0]; broadcast('CurrentProgramSceneChanged', { sceneName: state.program }, 1 << 2); }
      broadcast('SceneRemoved', { sceneName: d.sceneName, isGroup: false }, 1 << 2);
      broadcast('SceneListChanged', { scenes: handle('GetSceneList').data.scenes }, 1 << 2); return ok();
    case 'SetSceneName': {
      const i = state.scenes.indexOf(d.sceneName); if (i < 0) return fail(600, 'No scene');
      state.scenes[i] = d.newSceneName; state.items[d.newSceneName] = state.items[d.sceneName]; delete state.items[d.sceneName];
      if (state.program === d.sceneName) state.program = d.newSceneName;
      broadcast('SceneNameChanged', { oldSceneName: d.sceneName, sceneName: d.newSceneName }, 1 << 2); return ok();
    }
    case 'GetSourceScreenshot': {
      const w = d.imageWidth || 640, h = Math.round(w * 9 / 16);
      if (state.scenes.includes(d.sourceName)) return ok({ imageData: svgShot(d.sourceName, COLORS[d.sourceName] || '#333', w, h) });
      if (state.inputs[d.sourceName]) return ok({ imageData: svgShot(d.sourceName, '#444', w, h) });
      return fail(600, 'No source');
    }
    case 'GetSceneItemList': {
      if (!state.items[d.sceneName]) return fail(600, 'No scene');
      return ok({ sceneItems: state.items[d.sceneName].map((it, i) => sceneItemObj(d.sceneName, it, i)) });
    }
    case 'GetSceneItemId': {
      const it = (state.items[d.sceneName] || []).find(i => i.source === d.sourceName);
      return it ? ok({ sceneItemId: it.id }) : fail(600, 'No scene item');
    }
    case 'GetSceneItemEnabled': { const it = findItem(d.sceneName, d.sceneItemId); return it ? ok({ sceneItemEnabled: it.enabled }) : fail(600, 'No item'); }
    case 'SetSceneItemEnabled': {
      const it = findItem(d.sceneName, d.sceneItemId); if (!it) return fail(600, 'No item');
      it.enabled = d.sceneItemEnabled; broadcast('SceneItemEnableStateChanged', { sceneName: d.sceneName, sceneItemId: it.id, sceneItemEnabled: it.enabled }, 1 << 7); return ok();
    }
    case 'SetSceneItemLocked': {
      const it = findItem(d.sceneName, d.sceneItemId); if (!it) return fail(600, 'No item');
      it.locked = d.sceneItemLocked; broadcast('SceneItemLockStateChanged', { sceneName: d.sceneName, sceneItemId: it.id, sceneItemLocked: it.locked }, 1 << 7); return ok();
    }
    case 'SetSceneItemIndex': {
      const list = state.items[d.sceneName]; const it = findItem(d.sceneName, d.sceneItemId); if (!it) return fail(600, 'No item');
      list.splice(list.indexOf(it), 1); list.splice(Math.max(0, Math.min(list.length, d.sceneItemIndex)), 0, it);
      broadcast('SceneItemListReindexed', { sceneName: d.sceneName, sceneItems: list.map((x, i) => ({ sceneItemId: x.id, sceneItemIndex: i })) }, 1 << 7); return ok();
    }
    case 'SetSceneItemTransform': {
      const it = findItem(d.sceneName, d.sceneItemId); if (!it) return fail(600, 'No item');
      Object.assign(it.transform, d.sceneItemTransform);
      it.transform.width = it.transform.sourceWidth * it.transform.scaleX;
      it.transform.height = it.transform.sourceHeight * it.transform.scaleY;
      broadcast('SceneItemTransformChanged', { sceneName: d.sceneName, sceneItemId: it.id, sceneItemTransform: it.transform }, 1 << 19, client); return ok();
    }
    case 'RemoveSceneItem': {
      const list = state.items[d.sceneName] || []; const it = findItem(d.sceneName, d.sceneItemId); if (!it) return fail(600, 'No item');
      list.splice(list.indexOf(it), 1); broadcast('SceneItemRemoved', { sceneName: d.sceneName, sourceName: it.source, sceneItemId: it.id }, 1 << 7); return ok();
    }
    case 'CreateSceneItem': {
      if (!state.inputs[d.sourceName]) return fail(600, 'No source');
      const s = state.inputs[d.sourceName].settings;
      const it = addItem(d.sceneName, d.sourceName, transformFor(s.width || 400, s.height || 300));
      broadcast('SceneItemCreated', { sceneName: d.sceneName, sourceName: d.sourceName, sceneItemId: it.id, sceneItemIndex: state.items[d.sceneName].length - 1 }, 1 << 7);
      return ok({ sceneItemId: it.id });
    }
    case 'CreateInput': {
      if (state.inputs[d.inputName] || state.scenes.includes(d.inputName)) return fail(601, 'A source already exists by that name.');
      addInput(d.inputName, d.inputKind, d.inputSettings || {}, d.inputKind === 'browser_source');
      broadcast('InputCreated', { inputName: d.inputName, inputKind: d.inputKind }, 1 << 3);
      const s = d.inputSettings || {};
      const it = addItem(d.sceneName, d.inputName, transformFor(s.width || 600, s.height || 120));
      broadcast('SceneItemCreated', { sceneName: d.sceneName, sourceName: d.inputName, sceneItemId: it.id }, 1 << 7);
      return ok({ inputUuid: crypto.randomUUID(), sceneItemId: it.id });
    }
    case 'RemoveInput':
      delete state.inputs[d.inputName];
      Object.values(state.items).forEach(list => { for (let i = list.length - 1; i >= 0; i--) if (list[i].source === d.inputName) list.splice(i, 1); });
      broadcast('InputRemoved', { inputName: d.inputName }, 1 << 3); return ok();
    case 'GetInputList': return ok({ inputs: Object.entries(state.inputs).map(([n, i]) => ({ inputName: n, inputKind: i.kind, unversionedInputKind: i.kind })) });
    case 'GetInputKindList': return ok({ inputKinds: ['browser_source', 'image_source', 'text_gdiplus_v2', 'color_source_v3', 'ffmpeg_source', 'dshow_input', 'game_capture'] });
    case 'GetInputSettings': { const i = state.inputs[d.inputName]; return i ? ok({ inputSettings: i.settings, inputKind: i.kind }) : fail(600, 'No input'); }
    case 'SetInputSettings': {
      const i = state.inputs[d.inputName]; if (!i) return fail(600, 'No input');
      i.settings = d.overlay === false ? { ...d.inputSettings } : { ...i.settings, ...d.inputSettings };
      if (d.inputName.startsWith('Soundboard Player')) console.log(`[mock] ${d.inputName} -> ${String(i.settings.url).length} chars`);
      broadcast('InputSettingsChanged', { inputName: d.inputName, inputSettings: i.settings }, 1 << 3); return ok();
    }
    case 'GetInputVolume': { const i = state.inputs[d.inputName]; if (!i || !i.audio) return fail(604, 'Not an audio input'); return ok({ inputVolumeDb: i.volDb, inputVolumeMul: dbToMul(i.volDb) }); }
    case 'SetInputVolume': {
      const i = state.inputs[d.inputName]; if (!i || !i.audio) return fail(604, 'Not an audio input');
      i.volDb = d.inputVolumeDb !== undefined ? d.inputVolumeDb : (d.inputVolumeMul > 0 ? 20 * Math.log10(d.inputVolumeMul) : -100);
      broadcast('InputVolumeChanged', { inputName: d.inputName, inputVolumeDb: i.volDb, inputVolumeMul: dbToMul(i.volDb) }, 1 << 3, client); return ok();
    }
    case 'GetInputMute': { const i = state.inputs[d.inputName]; if (!i || !i.audio) return fail(604, 'Not an audio input'); return ok({ inputMuted: i.muted }); }
    case 'SetInputMute': case 'ToggleInputMute': {
      const i = state.inputs[d.inputName]; if (!i || !i.audio) return fail(604, 'Not an audio input');
      i.muted = type === 'ToggleInputMute' ? !i.muted : !!d.inputMuted;
      broadcast('InputMuteStateChanged', { inputName: d.inputName, inputMuted: i.muted }, 1 << 3); return ok({ inputMuted: i.muted });
    }
    case 'GetSourceFilterList': return ok({ filters: (filters[d.sourceName] || []).map((f, i) => ({ ...f, filterIndex: i, filterSettings: {} })) });
    case 'SetSourceFilterEnabled': {
      const f = (filters[d.sourceName] || []).find(x => x.filterName === d.filterName); if (!f) return fail(600, 'No filter');
      f.filterEnabled = !!d.filterEnabled; broadcast('SourceFilterEnableStateChanged', { sourceName: d.sourceName, filterName: d.filterName, filterEnabled: f.filterEnabled }, 1 << 5); return ok();
    }
    case 'GetMediaInputStatus': { const m = media[d.inputName]; return m ? ok({ mediaState: m.state, mediaDuration: m.duration, mediaCursor: m.cursor }) : fail(604, 'Not a media input'); }
    case 'SetMediaInputCursor': if (media[d.inputName]) media[d.inputName].cursor = d.mediaCursor; return ok();
    case 'TriggerMediaInputAction': return media[d.inputName] ? ok() : fail(604, 'Not a media input');
    case 'GetStreamStatus': {
      const dur = state.stream.active ? Date.now() - state.stream.start : 0;
      return ok({ outputActive: state.stream.active, outputReconnecting: false, outputTimecode: timecode(dur), outputDuration: dur, outputCongestion: 0.02, outputBytes: Math.floor(dur / 1000 * 750000), outputSkippedFrames: 2, outputTotalFrames: Math.floor(dur / 1000 * 60) });
    }
    case 'StartStream': case 'StopStream': case 'ToggleStream': {
      const want = type === 'StartStream' ? true : type === 'StopStream' ? false : !state.stream.active;
      if (want === state.stream.active) return fail(500, want ? 'Stream already active' : 'Stream not active');
      outputChange('Stream', want); return ok({ outputActive: want });
    }
    case 'GetRecordStatus': {
      const dur = recDur();
      return ok({ outputActive: state.record.active, outputPaused: state.record.paused, outputTimecode: timecode(dur), outputDuration: dur, outputBytes: Math.floor(dur / 1000 * 2000000) });
    }
    case 'StartRecord': case 'StopRecord': case 'ToggleRecord': {
      const want = type === 'StartRecord' ? true : type === 'StopRecord' ? false : !state.record.active;
      if (want === state.record.active) return fail(500, 'Record state unchanged');
      outputChange('Record', want);
      return want ? ok() : ok({ outputPath: 'C:/Videos/2026-10-17 20-00-00.mkv' });
    }
    case 'PauseRecord': case 'ResumeRecord': {
      if (!state.record.active) return fail(501, 'Not recording');
      const pause = type === 'PauseRecord';
      if (pause === state.record.paused) return fail(500, 'Already in that state');
      if (pause) state.record.pauseAt = Date.now(); else state.record.pausedMs += Date.now() - state.record.pauseAt;
      state.record.paused = pause;
      broadcast('RecordStateChanged', { outputActive: true, outputState: pause ? 'OBS_WEBSOCKET_OUTPUT_PAUSED' : 'OBS_WEBSOCKET_OUTPUT_RESUMED' }, 1 << 6); return ok();
    }
    case 'GetReplayBufferStatus': return ok({ outputActive: state.replay.active });
    case 'StartReplayBuffer': case 'StopReplayBuffer': case 'ToggleReplayBuffer': {
      const want = type === 'StartReplayBuffer' ? true : type === 'StopReplayBuffer' ? false : !state.replay.active;
      state.replay.active = want; broadcast('ReplayBufferStateChanged', { outputActive: want, outputState: want ? 'OBS_WEBSOCKET_OUTPUT_STARTED' : 'OBS_WEBSOCKET_OUTPUT_STOPPED' }, 1 << 6); return ok();
    }
    case 'SaveReplayBuffer':
      if (!state.replay.active) return fail(501, 'Replay buffer is not active');
      setTimeout(() => broadcast('ReplayBufferSaved', { savedReplayPath: 'C:/Videos/Replay 2026-10-17.mkv' }, 1 << 6), 300); return ok();
    case 'GetVirtualCamStatus': return ok({ outputActive: state.vcam.active });
    case 'StartVirtualCam': case 'StopVirtualCam': case 'ToggleVirtualCam': {
      const want = type === 'StartVirtualCam' ? true : type === 'StopVirtualCam' ? false : !state.vcam.active;
      state.vcam.active = want; broadcast('VirtualcamStateChanged', { outputActive: want, outputState: want ? 'OBS_WEBSOCKET_OUTPUT_STARTED' : 'OBS_WEBSOCKET_OUTPUT_STOPPED' }, 1 << 6); return ok();
    }
    default: return fail(204, `Mock OBS doesn't implement ${type}`);
  }
}

function outputChange(kind, active) {
  const key = kind === 'Stream' ? 'stream' : 'record';
  const ev = kind + 'StateChanged';
  broadcast(ev, { outputActive: false, outputState: active ? 'OBS_WEBSOCKET_OUTPUT_STARTING' : 'OBS_WEBSOCKET_OUTPUT_STOPPING' }, 1 << 6);
  setTimeout(() => {
    state[key].active = active;
    if (active) { state[key].start = Date.now(); if (key === 'record') { state.record.paused = false; state.record.pausedMs = 0; } }
    broadcast(ev, { outputActive: active, outputState: active ? 'OBS_WEBSOCKET_OUTPUT_STARTED' : 'OBS_WEBSOCKET_OUTPUT_STOPPED' }, 1 << 6);
  }, 700);
}

// ---------------- Minimal WebSocket server ----------------
const clients = new Set();

function sendFrame(sock, str) {
  const payload = Buffer.from(str);
  let header;
  if (payload.length < 126) header = Buffer.from([0x81, payload.length]);
  else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
  sock.write(Buffer.concat([header, payload]));
}
function closeSock(sock, code, reason = '') {
  const r = Buffer.from(reason);
  const body = Buffer.alloc(2 + r.length); body.writeUInt16BE(code, 0); r.copy(body, 2);
  sock.write(Buffer.concat([Buffer.from([0x88, body.length]), body]));
  sock.end();
}
const send = (c, op, d) => { if (!c.sock.destroyed) sendFrame(c.sock, JSON.stringify({ op, d })); };

function broadcast(eventType, eventData, intent, except) {
  for (const c of clients) {
    if (!c.identified || c === except) continue;
    if ((c.subs & intent) === 0) continue;
    send(c, 5, { eventType, eventIntent: intent, eventData });
  }
}

function onMessage(c, text) {
  let msg; try { msg = JSON.parse(text); } catch (e) { return closeSock(c.sock, 4002, 'Bad JSON'); }
  if (msg.op === 1) {
    if (PASSWORD) {
      const secret = crypto.createHash('sha256').update(PASSWORD + c.salt).digest('base64');
      const expected = crypto.createHash('sha256').update(secret + c.challenge).digest('base64');
      if (msg.d.authentication !== expected) { console.log('[mock] auth failed'); return closeSock(c.sock, 4009, 'Authentication failed.'); }
    }
    c.identified = true; c.subs = msg.d.eventSubscriptions ?? 0x7ff;
    console.log(`[mock] client identified (subs=${c.subs})`);
    return send(c, 2, { negotiatedRpcVersion: 1 });
  }
  if (!c.identified) return closeSock(c.sock, 4007, 'Not identified');
  if (msg.op === 6) {
    const { requestType, requestId, requestData } = msg.d;
    let r;
    try { r = handle(requestType, requestData || {}, c); } catch (e) { r = { ok: false, code: 702, comment: e.message }; }
    send(c, 7, { requestType, requestId, requestStatus: r.ok ? { result: true, code: 100 } : { result: false, code: r.code, comment: r.comment }, ...(r.ok ? { responseData: r.data } : {}) });
  }
}

const server = http.createServer((req, res) => { res.writeHead(426); res.end('WebSocket only'); });
server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const c = { sock, identified: false, subs: 0, salt: crypto.randomBytes(16).toString('base64'), challenge: crypto.randomBytes(16).toString('base64') };
  clients.add(c);
  console.log('[mock] client connected');
  let buf = Buffer.alloc(0);
  let fragments = [];
  sock.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin = (buf[0] & 0x80) !== 0, op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const maskOff = off; if (masked) off += 4;
      if (buf.length < off + len) return;
      let payload = buf.slice(off, off + len);
      if (masked) { const m = buf.slice(maskOff, maskOff + 4); payload = Buffer.from(payload.map((b, i) => b ^ m[i % 4])); }
      buf = buf.slice(off + len);
      if (op === 0x8) { sock.end(); return; }
      if (op === 0x9) { sock.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }
      if (op === 0x1 || op === 0x0) {
        fragments.push(payload);
        if (fin) { const text = Buffer.concat(fragments).toString('utf8'); fragments = []; onMessage(c, text); }
      }
    }
  });
  sock.on('close', () => { clients.delete(c); console.log('[mock] client disconnected'); });
  sock.on('error', () => clients.delete(c));
  send(c, 0, { obsWebSocketVersion: '5.5.0', rpcVersion: 1, ...(PASSWORD ? { authentication: { salt: c.salt, challenge: c.challenge } } : {}) });
});

// Fake audio levels, ~20 per second like real OBS
setInterval(() => {
  const inputs = Object.entries(state.inputs).filter(([, i]) => i.audio).map(([name, i]) => {
    const base = i.muted ? 0 : dbToMul(i.volDb) * (name === 'Mic/Aux' ? 0.25 + Math.random() * 0.5 * (Math.sin(Date.now() / 700) > 0 ? 1 : 0.2) : 0.15 + Math.random() * 0.25);
    return { inputName: name, inputLevelsMul: [[base, base * 1.2, base * 1.3], [base * 0.9, base * 1.1, base * 1.2]] };
  });
  broadcast('InputVolumeMeters', { inputs }, 1 << 16);
}, 50);
setInterval(() => { const m = media['Intro Video']; m.cursor = (m.cursor + 1000) % m.duration; }, 1000);

server.listen(PORT, () => console.log(`Mock OBS listening on ws://localhost:${PORT}${PASSWORD ? ' (password: ' + PASSWORD + ')' : ' (no password)'}`));
