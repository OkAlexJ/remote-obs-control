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

// ==================== Helper-tab mode (no OBS restart) ====================
// The streamer opens translate-helper.html in Chrome; finished sentences arrive here already translated
// (main.js /caption) and we put them into the "Live Translation" source as a plain caption page.
async function ensureLiveCaptionSource(){
  const scene=currentProgramScene;
  if(!scene) throw new Error('No live scene.');
  const list=await req('GetSceneItemList',{ sceneName:scene });
  if(list && list.sceneItems.some(i=>i.sourceName===TRANSLATE_SOURCE)) return;
  const inputs=await req('GetInputList');
  const exists=!!(inputs && inputs.inputs.some(i=>i.inputName===TRANSLATE_SOURCE));
  const d=exists
    ? await sendRequest('CreateSceneItem',{ sceneName:scene, sourceName:TRANSLATE_SOURCE })
    : await sendRequest('CreateInput',{ sceneName:scene, inputName:TRANSLATE_SOURCE, inputKind:'browser_source', inputSettings:{ url:'about:blank', width:TRANSLATE_W, height:TRANSLATE_H } });
  if(!d.requestStatus.result) throw new Error(reqError(d));
  const id=d.responseData.sceneItemId, scale=baseW/1920;
  await req('SetSceneItemTransform',{ sceneName:scene, sceneItemId:id, sceneItemTransform:{
    alignment:5, scaleX:scale, scaleY:scale, positionX:Math.round((baseW-TRANSLATE_W*scale)/2), positionY:Math.round(baseH-TRANSLATE_H*scale-baseH*0.02) } });
  const all=await req('GetSceneItemList',{ sceneName:scene });
  if(all) await req('SetSceneItemIndex',{ sceneName:scene, sceneItemId:id, sceneItemIndex:all.sceneItems.length-1 });
}

function liveCaptionHtml({ original, translated, style, showOriginal }){
  const words=translated.split(/\s+/).length;
  const hold=Math.max(3.5, Math.min(12, words*0.45));
  const orig=showOriginal && original!==translated ? `<div class="orig"><span>${escapeHtml(original)}</span></div>` : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@600&family=Roboto:wght@500&display=swap">
<style>html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;}
.cap{position:absolute;left:0;right:0;bottom:24px;display:flex;flex-direction:column;align-items:center;gap:6px;padding:0 40px;box-sizing:border-box;animation:out .35s ease ${hold}s forwards;}
.orig,.tr{max-width:100%;text-align:center;}
.cc .tr{font:500 54px/1.45 Roboto,Inter,"Segoe UI",Arial,sans-serif;color:#fff;}
.cc .tr span,.cc .orig span{background:rgba(8,8,8,.78);padding:4px 14px;-webkit-box-decoration-break:clone;box-decoration-break:clone;}
.cc .orig{font:500 34px/1.45 Roboto,Inter,"Segoe UI",Arial,sans-serif;color:#cfcfcf;}
.movie .tr{font:600 62px/1.25 Inter,"Segoe UI",Arial,sans-serif;color:#fff;text-shadow:0 0 2px #000,0 0 2px #000,0 2px 4px rgba(0,0,0,.9),0 0 12px rgba(0,0,0,.6);}
.movie .orig{font:600 36px/1.25 Inter,"Segoe UI",Arial,sans-serif;color:#e8e8e8;text-shadow:0 0 2px #000,0 2px 4px rgba(0,0,0,.9);}
@keyframes out{to{opacity:0;}}</style></head><body>
<div class="cap ${style==='movie'?'movie':'cc'}">${orig}<div class="tr"><span>${escapeHtml(translated)}</span></div></div></body></html>`;
}

let liveCaptionChain=Promise.resolve();
async function pushLiveCaption(c){
  if(!isConnected()) return;
  const p=translatePrefs();
  await ensureLiveCaptionSource();
  const html=liveCaptionHtml({ original:c.original, translated:c.translated, style:p.style, showOriginal:p.original });
  await req('SetInputSettings',{ inputName:TRANSLATE_SOURCE, inputSettings:{ url:toBase64HtmlUrl(html), width:TRANSLATE_W, height:TRANSLATE_H }, overlay:true });
}
if(window.desktop && window.desktop.captions){
  // Keep captions in arrival order even if OBS is slow to answer
  window.desktop.captions.onLive(c=>{ liveCaptionChain=liveCaptionChain.then(()=>pushLiveCaption(c)).catch(e=>console.error(e)); });
}

$('trHelperBtn').addEventListener('click',async()=>{
  try{
    if(!isConnected()) throw new Error('Connect to OBS first.');
    saveTranslatePrefs();
    const p=translatePrefs();
    const token=await window.desktop.captions.token();
    const link=(await filterPageUrl('translate-helper.html','live translation'))+'#'+encodeURIComponent(JSON.stringify({ from:p.from, to:p.to, token }));
    // Captions now come from the helper tab, so the OBS source becomes a plain caption display
    const inputs=await req('GetInputList');
    if(inputs && inputs.inputs.some(i=>i.inputName===TRANSLATE_SOURCE))
      await req('SetInputSettings',{ inputName:TRANSLATE_SOURCE, inputSettings:{ url:'about:blank', width:TRANSLATE_W, height:TRANSLATE_H }, overlay:true });
    await ensureLiveCaptionSource();
    try{ await navigator.clipboard.writeText(link); }catch(e){}
    showDialog({ title:'Send this link to the streamer', input:link, okText:'Done', noCancel:true,
      message:'Copied to your clipboard. They open it in Chrome (or Edge) on their PC, click "Start translating" and allow the microphone — no OBS restart needed. Keep this app open while they stream.' });
    logActivity('Live translation helper link created');
  }catch(e){ tellUser('Live translation', e.message); }
});
