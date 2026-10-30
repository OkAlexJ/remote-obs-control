// ==================== Troll captions ====================
// Whatever you type appears under the streamer as if it were live captions of what they just said.
// Same trick as the fake notification: one browser source whose page is rebuilt per caption.
const CAPTION_SOURCE='Captions';
const CAPTION_W=1600, CAPTION_H=300;
const CAPTION_MAX=160;

const CAPTION_STYLES={
  cc:    { name:'Live captions (CC)' },
  movie: { name:'Movie subtitles' },
  tiktok:{ name:'TikTok style' }
};

const CAPTION_PRESETS=[
  "chat I have something to confess",
  "[loud fart]",
  "I'm honestly so bad at this game",
  "[crying intensifies]",
  "mom said I can only stream for one more hour",
  "(speaking in tongues)",
  "I still sleep with a nightlight",
  "[suspicious slurping]",
  "subscribe or I'll cry",
  "[inaudible screaming]"
];

// Look of each style — shared by the overlay and the in-app preview
function captionCss(style){
  const base=`.cap{position:absolute;left:0;right:0;bottom:24px;display:flex;justify-content:center;padding:0 40px;box-sizing:border-box;}
.cap .line{max-width:100%;text-align:center;}
.w{display:inline;}`;
  if(style==='movie') return base+`
.cap .line{font:600 64px/1.25 Inter,"Segoe UI",Arial,sans-serif;color:#fff;letter-spacing:-.3px;
  text-shadow:0 0 2px #000,0 0 2px #000,0 2px 4px rgba(0,0,0,.9),0 0 12px rgba(0,0,0,.6);}`;
  if(style==='tiktok') return base+`
.cap .line{font:800 72px/1.2 Inter,"Segoe UI",Arial,sans-serif;color:#fff;text-transform:uppercase;letter-spacing:.5px;
  -webkit-text-stroke:10px #000;paint-order:stroke fill;}
.w.on{color:#ffe14d;}
.w.pop{display:inline-block;animation:pop .18s ease-out;}
@keyframes pop{from{transform:scale(1.35);}to{transform:scale(1);}}`;
  // Live captions: white text on a dark box that wraps per line, like YouTube/Twitch auto-captions
  return base+`
.cap .line{font:500 54px/1.45 Roboto,Inter,"Segoe UI",Arial,sans-serif;color:#fff;text-align:left;}
.cap .line span.box{background:rgba(8,8,8,.78);padding:4px 14px;-webkit-box-decoration-break:clone;box-decoration-break:clone;}`;
}
function captionMarkup(text, style, revealAll){
  const words=String(text).trim().split(/\s+/).filter(Boolean);
  const ws=words.map((w,i)=>`<span class="w${revealAll?'':' hide'}" data-i="${i}">${escapeHtml(w)}</span>`).join(' ');
  return style==='cc' ? `<div class="cap"><div class="line"><span class="box">${ws}</span></div></div>` : `<div class="cap"><div class="line">${ws}</div></div>`;
}

function captionHtml({ text, style }){
  const st=CAPTION_STYLES[style] ? style : 'cc';
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@600;800&family=Roboto:wght@500&display=swap">
<style>html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;}
${captionCss(st)}
.w.hide{display:none;}
.cap{transition:opacity .35s;}
.cap.gone{opacity:0;}</style></head><body>
${captionMarkup(text, st, false)}
<script>
const style=${JSON.stringify(st)};
const words=[...document.querySelectorAll('.w')];
const cap=document.querySelector('.cap');
// Real live captions arrive a word at a time at speaking pace, slightly uneven
const show=i=>{
  if(i>=words.length){ setTimeout(()=>cap.classList.add('gone'), Math.max(2500, words.length*350)); return; }
  if(style==='movie'){ words.forEach(w=>w.classList.remove('hide')); show(words.length); return; }
  words[i].classList.remove('hide');
  if(style==='tiktok'){ words.forEach(w=>w.classList.remove('on')); words[i].classList.add('on','pop'); }
  setTimeout(()=>show(i+1), style==='tiktok' ? 330 : 220+Math.random()*220);
};
setTimeout(()=>show(0), 250);
<\/script></body></html>`;
}

async function ensureCaptionSource(){
  const scene=currentProgramScene;
  if(!scene) throw new Error('No live scene.');
  const list=await req('GetSceneItemList',{ sceneName:scene });
  let item=list && list.sceneItems.find(i=>i.sourceName===CAPTION_SOURCE);
  if(!item){
    const inputs=await req('GetInputList');
    const exists=!!(inputs && inputs.inputs.some(i=>i.inputName===CAPTION_SOURCE));
    const d=exists
      ? await sendRequest('CreateSceneItem',{ sceneName:scene, sourceName:CAPTION_SOURCE })
      : await sendRequest('CreateInput',{ sceneName:scene, inputName:CAPTION_SOURCE, inputKind:'browser_source',
          inputSettings:{ url:'about:blank', width:CAPTION_W, height:CAPTION_H } });
    if(!d.requestStatus.result) throw new Error(reqError(d));
    const id=d.responseData.sceneItemId;
    // Bottom centre of the canvas, on top of everything
    const scale=baseW/1920;
    await req('SetSceneItemTransform',{ sceneName:scene, sceneItemId:id, sceneItemTransform:{
      alignment:5, scaleX:scale, scaleY:scale, positionX:Math.round((baseW-CAPTION_W*scale)/2), positionY:Math.round(baseH-CAPTION_H*scale-baseH*0.03) } });
    const all=await req('GetSceneItemList',{ sceneName:scene });
    if(all) await req('SetSceneItemIndex',{ sceneName:scene, sceneItemId:id, sceneItemIndex:all.sceneItems.length-1 });
    item={ sceneItemId:id, sceneItemEnabled:true };
  }
  if(item.sceneItemEnabled===false) await req('SetSceneItemEnabled',{ sceneName:scene, sceneItemId:item.sceneItemId, sceneItemEnabled:true });
}

async function showCaption(text, style){
  const t=String(text||'').trim().slice(0,CAPTION_MAX);
  if(!t) throw new Error('Type a caption first.');
  if(!isConnected()) throw new Error('Connect to OBS first.');
  await ensureCaptionSource();
  const d=await sendRequest('SetInputSettings',{ inputName:CAPTION_SOURCE, inputSettings:{ url:toBase64HtmlUrl(captionHtml({ text:t, style })), width:CAPTION_W, height:CAPTION_H }, overlay:true });
  if(!d.requestStatus.result) throw new Error(reqError(d));
  logActivity(`Caption: ${t}`);
}
async function clearCaption(){
  if(!isConnected()) return;
  await req('SetInputSettings',{ inputName:CAPTION_SOURCE, inputSettings:{ url:'about:blank' }, overlay:true });
}

// ---- Panel ----
function updateCaptionPreview(){
  const host=$('captionPreview');
  const root=host.shadowRoot || host.attachShadow({ mode:'open' });
  const style=$('captionStyle').value;
  const text=$('captionText').value.trim() || 'Type what they "said"…';
  root.innerHTML=`<style>:host{display:block;}
.stage{position:relative;width:${CAPTION_W}px;height:${CAPTION_H}px;zoom:.19;}
${captionCss(style)}</style><div class="stage">${captionMarkup(text, style, true)}</div>`;
  if(style==='tiktok'){ const ws=root.querySelectorAll('.w'); if(ws.length) ws[ws.length-1].classList.add('on'); }
}
function renderCaptionPanel(){
  const wrap=$('captionPresets');
  wrap.innerHTML='';
  CAPTION_PRESETS.forEach(p=>{
    const b=document.createElement('button');
    b.type='button'; b.className='notify-chip'; b.textContent=p; b.title='Preview it — then press Show';
    b.addEventListener('click',()=>{
      $('captionText').value=p;
      wrap.querySelectorAll('.notify-chip').forEach(c=>c.classList.toggle('active',c===b));
      updateCaptionPreview();
    });
    wrap.appendChild(b);
  });
  $('captionStyle').innerHTML=Object.entries(CAPTION_STYLES).map(([k,s])=>`<option value="${k}">${escapeHtml(s.name)}</option>`).join('');
  $('captionStyle').value=appStorageGet('captionStyle','cc');
  requestAnimationFrame(updateCaptionPreview);
}
$('captionStyle').addEventListener('change',()=>{ appStorageSet('captionStyle',$('captionStyle').value); updateCaptionPreview(); });
$('captionText').addEventListener('input',()=>{ document.querySelectorAll('#captionPresets .notify-chip.active').forEach(c=>c.classList.remove('active')); updateCaptionPreview(); });
$('captionText').addEventListener('keydown',e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); $('captionShowBtn').click(); } });
$('captionShowBtn').addEventListener('click',async()=>{
  const btn=$('captionShowBtn'); btn.disabled=true;
  try{ await showCaption($('captionText').value, $('captionStyle').value); notify('Caption shown','ok'); }
  catch(e){ notify(e.message,'err'); }
  btn.disabled=false;
});
$('captionClearBtn').addEventListener('click',clearCaption);
