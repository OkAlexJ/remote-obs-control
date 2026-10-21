// ==================== Face effects (bald filter) ====================
// The filter page runs inside OBS as a Browser Source. Webcams only work on secure pages:
//  - OBS on this PC: http://localhost counts as secure, so the app's own filter server is used.
//  - OBS on another PC: the same server reached through Tailscale Serve (https://<this-pc>.ts.net/),
//    visible only inside your tailnet. Either way this app must be running for the filter to load.
const BALD_SOURCE_NAME='Bald Filter';
const WEBCAM_KINDS=['dshow_input','av_capture_input','av_capture_input_v2','macos-avcapture','v4l2_input'];
const isLocalHost=h=>/^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\])$/i.test(String(h||'').trim());

async function baldFilterBaseUrl(){
  if(!window.desktop) throw new Error('The bald filter needs the desktop app.');
  if(OBS.lastConn && isLocalHost(OBS.lastConn.host)){
    const base=await window.desktop.filters.localUrl();
    if(!base) throw new Error("The app's filter server didn't start — is another copy of the app running?");
    return base+'bald-filter.html';
  }
  const t=await window.desktop.filters.tailnetUrl();
  if(t.ok) return t.url+'bald-filter.html';
  if(t.reason==='not-served')
    throw new Error('To use the bald filter on another PC, share it over your tailnet once. On this PC run:\n\ntailscale serve --bg http://127.0.0.1:47821\n\n(It stays private to your tailnet.)');
  throw new Error('For OBS on another PC the bald filter goes through Tailscale, but Tailscale isn\'t running on this PC. Start Tailscale, or connect to an OBS on this PC (localhost).');
}

async function addBaldFilter(){
  if(!editingScene) throw new Error('Pick a scene first.');
  const BALD_FILTER_URL=await baldFilterBaseUrl();
  if(stageItems.some(i=>i.sourceName===BALD_SOURCE_NAME)) throw new Error('This scene already has the bald filter — use 👁 to turn it on and off.');

  // Find their webcam in this scene so the filter can sit exactly on top of it
  const cam=stageItems.find(i=>WEBCAM_KINDS.includes(i.inputKind));
  let cameraName='', camW=1280, camH=720;
  if(cam){
    const s=await req('GetInputSettings',{ inputName:cam.sourceName });
    const id=s && s.inputSettings && (s.inputSettings.video_device_id || s.inputSettings.device || '');
    cameraName=String(id).split(':')[0];   // dshow ids look like "Camera Name:\\?\usb#..."
    const t=cam.sceneItemTransform;
    if(t.sourceWidth && t.sourceHeight){ camW=t.sourceWidth; camH=t.sourceHeight; }
  }

  const options=cameraName ? { camera:cameraName } : {};
  const url=BALD_FILTER_URL+'#'+encodeURIComponent(JSON.stringify(options));
  const d=await sendRequest('CreateInput',{
    sceneName:editingScene, inputName:BALD_SOURCE_NAME, inputKind:'browser_source',
    // shutdown: release the webcam whenever the filter is hidden, so the normal webcam source can use it
    inputSettings:{ url, width:camW, height:camH, fps_custom:true, fps:30, shutdown:true, restart_when_active:true }
  });
  if(!d.requestStatus.result) throw new Error(reqError(d));
  const filterId=d.responseData && d.responseData.sceneItemId;

  if(cam && filterId){
    // Same place and size as the webcam, then hide the webcam and let it give up the camera while hidden
    const t=cam.sceneItemTransform, b=itemBox(t);
    await req('SetSceneItemTransform',{ sceneName:editingScene, sceneItemId:filterId, sceneItemTransform:{
      alignment:5, positionX:b.x, positionY:b.y, rotation:0,
      boundsType:'OBS_BOUNDS_SCALE_INNER', boundsAlignment:0, boundsWidth:Math.max(1,b.w), boundsHeight:Math.max(1,b.h),
      cropLeft:t.cropLeft||0, cropRight:t.cropRight||0, cropTop:t.cropTop||0, cropBottom:t.cropBottom||0
    }});
    await req('SetInputSettings',{ inputName:cam.sourceName, inputSettings:{ deactivate_when_not_showing:true }, overlay:true });
    await req('SetSceneItemEnabled',{ sceneName:editingScene, sceneItemId:cam.sceneItemId, sceneItemEnabled:false });
  }
  logActivity(`Added bald filter to ${editingScene}`);
  await refreshItems();
  tellUser('Bald filter added', (cam ? `It's placed over "${cam.sourceName}", which is now hidden so the filter can use the camera. ` : 'No webcam source was found in this scene, so it was added full-size. ')
    + 'Toggle it with 👁 in Sources. Keep this app open while using it — the app is what serves the filter to OBS.\n\nIf it says camera access is blocked: on the OBS PC, close OBS, right-click the OBS shortcut → Properties, add  --enable-media-stream  to the end of "Target", and start OBS again. The first start takes a few seconds while it downloads the face/hair models.');
}
