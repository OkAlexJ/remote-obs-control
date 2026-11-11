// ==================== Live translation (speech → DeepL → captions) ====================
// Adds a browser source running filters/live-translate.html in their OBS. That page listens to the mic on
// the OBS PC, transcribes with Whisper there, and asks this app's /translate endpoint (which holds the
// DeepL key) for the translation.
const TRANSLATE_SOURCE='Live Translation';
const TRANSLATE_W=1600, TRANSLATE_H=360;
const SPOKEN_LANGS=[['es','Spanish'],['en','English'],['fr','French'],['de','German'],['it','Italian'],['pt','Portuguese'],['ja','Japanese'],['ko','Korean'],['zh','Chinese'],['ru','Russian']];
const TARGET_LANGS=[['EN-US','English (US)'],['EN-GB','English (UK)'],['ES','Spanish'],['FR','French'],['DE','German'],['IT','Italian'],['PT-BR','Portuguese (BR)'],['JA','Japanese'],['KO','Korean'],['ZH','Chinese']];

function translatePrefs(){ return appStorageGet('translatePrefs',{ from:'es', to:'EN-US', style:'cc', model:'base', original:false, mic:'' }); }

async function initTranslateUI(){
  const p=translatePrefs();
  $('trFrom').innerHTML=SPOKEN_LANGS.map(([v,n])=>`<option value="${v}">${n}</option>`).join('');
  $('trTo').innerHTML=TARGET_LANGS.map(([v,n])=>`<option value="${v}">${n}</option>`).join('');
  $('trFrom').value=p.from; $('trTo').value=p.to; $('trStyle').value=p.style; $('trModel').value=p.model;
  $('trOriginal').checked=!!p.original; $('trMic').value=p.mic||'';
  await refreshDeeplStatus();
}
function saveTranslatePrefs(){
  appStorageSet('translatePrefs',{ from:$('trFrom').value, to:$('trTo').value, style:$('trStyle').value, model:$('trModel').value, original:$('trOriginal').checked, mic:$('trMic').value.trim() });
}
['trFrom','trTo','trStyle','trModel','trOriginal','trMic'].forEach(id=>$(id).addEventListener('change', saveTranslatePrefs));

async function refreshDeeplStatus(){
  const el=$('deeplStatus');
  if(!window.desktop){ el.textContent='Needs the desktop app.'; return; }
  const has=await window.desktop.secrets.has('_app','deeplKey');
  $('deeplKey').placeholder=has?'•••••••• saved (paste a new key to replace)':'DeepL API key';
  if(!has){ el.textContent='No key yet — get a free one at deepl.com/pro-api (500,000 characters/month).'; return; }
  const r=await window.desktop.deepl.check();
  el.textContent=r.ok ? `✓ Key works — ${r.used.toLocaleString()} of ${r.limit.toLocaleString()} characters used this month.` : '⚠ '+r.error;
}
$('deeplSaveBtn').addEventListener('click',async()=>{
  const key=$('deeplKey').value.trim();
  if(!key){ notify('Paste your DeepL API key first','err'); return; }
  const r=await window.desktop.deepl.check(key);
  if(!r.ok){ notify('DeepL: '+r.error,'err'); return; }
  await window.desktop.secrets.set('_app','deeplKey',key);
  $('deeplKey').value='';
  notify('DeepL key saved (encrypted)','ok');
  refreshDeeplStatus();
});
$('deeplTestBtn').addEventListener('click',async()=>{
  const r=await window.desktop.deepl.translate('Hola chat, ¿cómo están todos hoy?', 'ES', $('trTo').value);
  if(r.ok) tellUser('DeepL works', `"Hola chat, ¿cómo están todos hoy?"\n→ "${r.text}"`);
  else notify(r.error==='no-key'?'Save your DeepL key first':'DeepL: '+r.error,'err');
});

async function addLiveTranslation(){
  if(!isConnected()) throw new Error('Connect to OBS first.');
  const scene=currentProgramScene;
  if(!scene) throw new Error('No live scene.');
  saveTranslatePrefs();
  const p=translatePrefs();
  const opts={ from:p.from, to:p.to, style:p.style, model:p.model, original:p.original };
  if(p.mic) opts.mic=p.mic;
  const url=(await filterPageUrl('live-translate.html','live translation'))+'#'+encodeURIComponent(JSON.stringify(opts));
  const settings={ url, width:TRANSLATE_W, height:TRANSLATE_H, shutdown:true, restart_when_active:true };

  const inputs=await req('GetInputList');
  const exists=!!(inputs && inputs.inputs.some(i=>i.inputName===TRANSLATE_SOURCE));
  if(exists){
    // Already set up: just apply the new settings (reloads the page)
    const d=await sendRequest('SetInputSettings',{ inputName:TRANSLATE_SOURCE, inputSettings:settings, overlay:true });
    if(!d.requestStatus.result) throw new Error(reqError(d));
    const list=await req('GetSceneItemList',{ sceneName:scene });
    if(list && !list.sceneItems.some(i=>i.sourceName===TRANSLATE_SOURCE)) await req('CreateSceneItem',{ sceneName:scene, sourceName:TRANSLATE_SOURCE });
    notify('Live translation updated','ok');
  } else {
    const d=await sendRequest('CreateInput',{ sceneName:scene, inputName:TRANSLATE_SOURCE, inputKind:'browser_source', inputSettings:settings });
    if(!d.requestStatus.result) throw new Error(reqError(d));
    const id=d.responseData.sceneItemId, scale=baseW/1920;
    await req('SetSceneItemTransform',{ sceneName:scene, sceneItemId:id, sceneItemTransform:{
      alignment:5, scaleX:scale, scaleY:scale, positionX:Math.round((baseW-TRANSLATE_W*scale)/2), positionY:Math.round(baseH-TRANSLATE_H*scale-baseH*0.02) } });
    const all=await req('GetSceneItemList',{ sceneName:scene });
    if(all) await req('SetSceneItemIndex',{ sceneName:scene, sceneItemId:id, sceneItemIndex:all.sceneItems.length-1 });
    tellUser('Live translation added', `It listens to the default microphone on the OBS PC${p.mic?` (one whose name contains "${p.mic}")`:''} and shows ${$('trTo').selectedOptions[0].textContent} captions at the bottom of "${scene}". Turn it on/off with 👁 in Sources.\n\n• OBS must be started with --enable-media-stream (same as the bald filter).\n• The first start downloads the speech model (about 80 MB${p.model==='small'?', or ~250 MB for "Accurate"':''}) — give it a minute.\n• Keep this app open: it does the DeepL translating.\n• Captions arrive a second or two after each sentence.`);
  }
  logActivity(`Live translation ${exists?'updated':'added'}: ${p.from.toUpperCase()} → ${p.to}`);
  if(editingScene===scene) refreshItems();
}
$('trAddBtn').addEventListener('click',async()=>{
  const btn=$('trAddBtn'); btn.disabled=true;
  try{ await addLiveTranslation(); }catch(e){ tellUser('Live translation', e.message); }
  btn.disabled=false;
});
