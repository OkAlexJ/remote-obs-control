// ==================== Fake iPhone notification ====================
// An iOS-style banner that slides down on their stream with a chime. It's a Browser Source whose page is
// rebuilt each time you send one — changing the URL reloads the page, which plays the animation again.
const NOTIFY_SOURCE='Fake Notification';
const NOTIFY_W=1000, NOTIFY_H=260;

const NOTIFY_APPS={
  messages:  { name:'Messages',    glyph:'💬', bg:'linear-gradient(180deg,#67f27f,#1fc23b)' },
  discord:   { name:'Discord',     glyph:'🎮', bg:'linear-gradient(180deg,#7983f5,#5865f2)' },
  instagram: { name:'Instagram',   glyph:'📸', bg:'linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)' },
  snapchat:  { name:'Snapchat',    glyph:'👻', bg:'linear-gradient(180deg,#fffc00,#fff200)' },
  bank:      { name:'Bank',        glyph:'🏦', bg:'linear-gradient(180deg,#3b82f6,#1d4ed8)' },
  findmy:    { name:'Find My',     glyph:'📍', bg:'linear-gradient(180deg,#5bd17a,#2a9d4e)' },
  screentime:{ name:'Screen Time', glyph:'⏳', bg:'linear-gradient(180deg,#a26bfa,#6d28d9)' },
  money:     { name:'Cash App',    glyph:'💸', bg:'linear-gradient(180deg,#34d058,#00b140)' },
  phone:     { name:'Phone',       glyph:'📞', bg:'linear-gradient(180deg,#67f27f,#1fc23b)' },
  mail:      { name:'Mail',        glyph:'✉️', bg:'linear-gradient(180deg,#4fb3ff,#1a7cf0)' }
};

const NOTIFY_PRESETS=[
  { app:'messages',   title:'Mom',            text:'come downstairs right now. we need to talk' },
  { app:'bank',       title:'Card declined',  text:'$0.37 at Chuck E. Cheese. Insufficient funds.' },
  { app:'screentime', title:'Screen Time',    text:"You've been live for 9 hours. Maybe go outside?" },
  { app:'findmy',     title:'AirTag Found Moving With You', text:'The owner of this AirTag can see its location.' },
  { app:'messages',   title:'Ex',             text:'u up?' },
  { app:'instagram',  title:'Instagram',      text:'Your mom liked your photo from 2016.' },
  { app:'discord',    title:'#general',       text:'@everyone this stream is mid' },
  { app:'money',      title:'Cash App',       text:'Mom requested $20 for "wifi"' },
  { app:'phone',      title:'Missed Call',    text:'Grandma (14)' },
  { app:'mail',       title:'Teacher',        text:'Re: Your missing assignments (7)' }
];

function notifyHtml({ app, title, text, dark, sound, seconds }){
  const a=NOTIFY_APPS[app]||NOTIFY_APPS.messages;
  const secs=Math.max(2,Math.min(30,Number(seconds)||6));
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;font-family:-apple-system,"SF Pro Text","Segoe UI",Helvetica,Arial,sans-serif;}
.n{position:absolute;left:50%;top:22px;width:92%;max-width:940px;transform:translate(-50%,-140%);box-sizing:border-box;display:flex;gap:24px;align-items:center;padding:26px 30px;border-radius:44px;
background:${dark?'rgba(36,36,38,.94)':'rgba(246,246,248,.96)'};color:${dark?'#f2f2f7':'#111'};box-shadow:0 18px 50px rgba(0,0,0,.35),0 0 0 1px rgba(0,0,0,.05);
animation:in .55s cubic-bezier(.2,1.25,.35,1) forwards, out .45s cubic-bezier(.5,0,.8,.2) ${secs}s forwards;}
.i{flex:0 0 auto;width:96px;height:96px;border-radius:24px;background:${a.bg};display:flex;align-items:center;justify-content:center;font-size:54px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06);font-family:"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif;}
.c{flex:1;min-width:0;}
.t{display:flex;justify-content:space-between;align-items:baseline;gap:16px;}
.h{font-weight:700;font-size:38px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.01em;}
.w{font-size:30px;color:${dark?'#98989f':'#8a8a8e'};flex:0 0 auto;}
.m{font-size:36px;line-height:1.25;margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;letter-spacing:-.01em;}
@keyframes in{to{transform:translate(-50%,0);}}
@keyframes out{from{transform:translate(-50%,0);}to{transform:translate(-50%,-140%);}}
</style></head><body>
<div class="n" id="n"><div class="i">${escapeHtml(a.glyph)}</div><div class="c"><div class="t"><div class="h">${escapeHtml(title)}</div><div class="w">now</div></div><div class="m">${escapeHtml(text)}</div></div></div>
<script>
if(${sound?'true':'false'}){
  // A short two-note chime (synthesised here, not a recording)
  try{
    const ac=new AudioContext(), t=ac.currentTime+0.12;
    [[1318.5,0],[1760,0.13]].forEach(([f,d])=>{
      const o=ac.createOscillator(), g=ac.createGain();
      o.type='sine'; o.frequency.value=f;
      g.gain.setValueAtTime(0,t+d); g.gain.linearRampToValueAtTime(0.35,t+d+0.01); g.gain.exponentialRampToValueAtTime(0.001,t+d+0.6);
      o.connect(g).connect(ac.destination); o.start(t+d); o.stop(t+d+0.65);
    });
  }catch(e){}
}
<\/script></body></html>`;
}

// Makes sure the overlay exists in the live scene, on top, near the top-centre of the canvas
async function ensureNotifySource(){
  const scene=currentProgramScene;
  if(!scene) throw new Error('No live scene.');
  const list=await req('GetSceneItemList',{ sceneName:scene });
  let item=list && list.sceneItems.find(i=>i.sourceName===NOTIFY_SOURCE);
  if(!item){
    const inputs=await req('GetInputList');
    const exists=!!(inputs && inputs.inputs.some(i=>i.inputName===NOTIFY_SOURCE));
    const d=exists
      ? await sendRequest('CreateSceneItem',{ sceneName:scene, sourceName:NOTIFY_SOURCE })
      : await sendRequest('CreateInput',{ sceneName:scene, inputName:NOTIFY_SOURCE, inputKind:'browser_source',
          inputSettings:{ url:'about:blank', width:NOTIFY_W, height:NOTIFY_H, reroute_audio:true } });
    if(!d.requestStatus.result) throw new Error(reqError(d));
    const id=d.responseData.sceneItemId;
    const scale=Math.min(1, (baseW*0.42)/NOTIFY_W);
    await req('SetSceneItemTransform',{ sceneName:scene, sceneItemId:id, sceneItemTransform:{
      alignment:5, scaleX:scale, scaleY:scale, positionX:Math.round((baseW-NOTIFY_W*scale)/2), positionY:0 } });
    const all=await req('GetSceneItemList',{ sceneName:scene });
    if(all) await req('SetSceneItemIndex',{ sceneName:scene, sceneItemId:id, sceneItemIndex:all.sceneItems.length-1 });
    item={ sceneItemId:id, sceneItemEnabled:true };
  }
  if(item.sceneItemEnabled===false) await req('SetSceneItemEnabled',{ sceneName:scene, sceneItemId:item.sceneItemId, sceneItemEnabled:true });
}

async function sendFakeNotification(n){
  if(!isConnected()) throw new Error('Connect to OBS first.');
  await ensureNotifySource();
  const prefs=appStorageGet('notifyPrefs',{ dark:false, sound:true, seconds:6 });
  const html=notifyHtml({ ...prefs, ...n });
  const d=await sendRequest('SetInputSettings',{ inputName:NOTIFY_SOURCE, inputSettings:{ url:toBase64HtmlUrl(html) }, overlay:true });
  if(!d.requestStatus.result) throw new Error(reqError(d));
  logActivity(`Fake notification: ${n.title} — ${n.text}`);
}

// ---- Panel ----
function renderNotifyPanel(){
  const wrap=$('notifyPresets');
  wrap.innerHTML='';
  NOTIFY_PRESETS.forEach(p=>{
    const b=document.createElement('button');
    b.type='button';
    b.className='notify-chip';
    b.title=`${p.title}: ${p.text}`;
    b.innerHTML=`<span>${escapeHtml(NOTIFY_APPS[p.app].glyph)}</span>${escapeHtml(p.title)}`;
    b.addEventListener('click',()=>fireNotify(p, b));
    wrap.appendChild(b);
  });
  $('notifyApp').innerHTML=Object.entries(NOTIFY_APPS).map(([k,a])=>`<option value="${k}">${escapeHtml(a.glyph+' '+a.name)}</option>`).join('');
  const prefs=appStorageGet('notifyPrefs',{ dark:false, sound:true, seconds:6 });
  $('notifyDark').checked=!!prefs.dark;
  $('notifySound').checked=prefs.sound!==false;
}
async function fireNotify(n, btn){
  if(btn) btn.disabled=true;
  try{ await sendFakeNotification(n); notify('Notification sent','ok'); }
  catch(e){ notify(e.message,'err'); }
  if(btn) btn.disabled=false;
}
function saveNotifyPrefs(){ appStorageSet('notifyPrefs',{ ...appStorageGet('notifyPrefs',{ seconds:6 }), dark:$('notifyDark').checked, sound:$('notifySound').checked }); }
$('notifyDark').addEventListener('change', saveNotifyPrefs);
$('notifySound').addEventListener('change', saveNotifyPrefs);
$('notifySendBtn').addEventListener('click',()=>{
  const title=$('notifyTitle').value.trim(), text=$('notifyText').value.trim();
  if(!title && !text){ notify('Type who it\'s from and a message','err'); return; }
  fireNotify({ app:$('notifyApp').value, title:title||NOTIFY_APPS[$('notifyApp').value].name, text }, $('notifySendBtn'));
});
$('notifyText').addEventListener('keydown',e=>{ if(e.key==='Enter') $('notifySendBtn').click(); });
