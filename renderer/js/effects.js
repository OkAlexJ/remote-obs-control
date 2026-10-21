// ==================== Face effects (bald filter) ====================
// The filter page runs inside OBS on the streaming PC as a Browser Source. Webcams only work on pages
// served over https, so it's loaded from the hosted copy of renderer/filters/bald-filter.html.
const BALD_FILTER_URL='https://okalexj.github.io/bald-filter/';
const BALD_SOURCE_NAME='Bald Filter';
const WEBCAM_KINDS=['dshow_input','av_capture_input','av_capture_input_v2','macos-avcapture','v4l2_input'];

async function addBaldFilter(){
  if(!editingScene) throw new Error('Pick a scene first.');
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
    + 'Toggle it with 👁 in Sources.\n\nIf it says camera access is blocked: on the OBS PC, close OBS, right-click the OBS shortcut → Properties, add  --enable-media-stream  to the end of "Target", and start OBS again. The first start takes a few seconds while it downloads the face/hair models.');
}
