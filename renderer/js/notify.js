// ==================== Fake iPhone notification ====================
// An iOS-style banner that slides down on their stream with a chime. It's a Browser Source whose page is
// rebuilt each time you send one — changing the URL reloads the page, which plays the animation again.
const NOTIFY_SOURCE='Fake Notification';
// Built at iPhone 3x scale (1170px wide), so every size below is iOS points × 3
const NOTIFY_W=1170, NOTIFY_H=440;

// App icons drawn as vectors (60×60 units) so they look like real home-screen icons, not emoji
const iconBg=(id,c1,c2)=>`<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="60" height="60" fill="url(#${id})"/>`;
const NOTIFY_APPS={
  messages:  { name:'Messages',    glyph:'💬', svg:iconBg('g','#6cf47d','#0bba2b')+'<path d="M30 13.5c-10.2 0-18.5 6.7-18.5 15 0 4.8 2.7 9 7 11.8-.3 2.5-1.6 4.8-3.6 6.5 3.5-.2 6.8-1.5 9.3-3.6 1.8.5 3.8.7 5.8.7 10.2 0 18.5-6.7 18.5-15s-8.3-15.4-18.5-15.4z" fill="#fff"/>' },
  phone:     { name:'Phone',       glyph:'📞', svg:iconBg('g','#6cf47d','#0bba2b')+'<path d="M22.6 15.6c1-.6 2.3-.3 2.9.7l3.1 5.3c.5.9.3 2-.5 2.7l-2.3 1.9c1.6 3.5 4.3 6.3 7.8 7.9l1.9-2.3c.7-.8 1.8-1 2.7-.5l5.3 3.1c1 .6 1.3 1.9.7 2.9l-1.5 2.6c-.9 1.5-2.7 2.2-4.3 1.8-10.4-2.7-18.3-10.6-21-21-.4-1.6.3-3.4 1.8-4.3z" fill="#fff"/>' },
  mail:      { name:'Mail',        glyph:'✉️', svg:iconBg('g','#33aaff','#1673f0')+'<rect x="11.5" y="17.5" width="37" height="26" rx="4" fill="#fff"/><path d="M12.5 19.5 30 32.5l17.5-13" fill="none" stroke="#2a8cf7" stroke-width="2.2" stroke-linejoin="round"/>' },
  findmy:    { name:'Find My',     glyph:'📍', svg:iconBg('g','#ffffff','#e6e6eb')+'<circle cx="30" cy="30" r="20" fill="none" stroke="#34c759" stroke-opacity=".35" stroke-width="2.4"/><circle cx="30" cy="30" r="13" fill="none" stroke="#34c759" stroke-opacity=".6" stroke-width="2.4"/><circle cx="30" cy="30" r="6.5" fill="#34c759" stroke="#fff" stroke-width="2"/>' },
  screentime:{ name:'Screen Time', glyph:'⏳', svg:iconBg('g','#a46bfb','#5b2bd4')+'<path d="M21 14.5h18v3c0 4.6-3.3 8.3-6.4 10.5v4c3.1 2.2 6.4 5.9 6.4 10.5v3H21v-3c0-4.6 3.3-8.3 6.4-10.5v-4C24.3 25.8 21 22.1 21 17.5z" fill="#fff"/><path d="M24.5 42.5c.6-2.6 2.8-4.7 5.5-6.2 2.7 1.5 4.9 3.6 5.5 6.2z" fill="#7a45e6"/>' },
  bank:      { name:'Bank',        glyph:'🏦', svg:iconBg('g','#24467f','#0f2550')+'<path d="M30 13 13 21.5v3h34v-3z" fill="#fff"/><rect x="16" y="27" width="4" height="15" rx="1" fill="#fff"/><rect x="24" y="27" width="4" height="15" rx="1" fill="#fff"/><rect x="32" y="27" width="4" height="15" rx="1" fill="#fff"/><rect x="40" y="27" width="4" height="15" rx="1" fill="#fff"/><rect x="13" y="44" width="34" height="3.5" rx="1" fill="#fff"/>' },
  money:     { name:'Cash App',    glyph:'💸', svg:'<rect width="60" height="60" fill="#00d54b"/><text x="30" y="42.5" font-size="34" font-weight="700" text-anchor="middle" fill="#fff" font-family="Inter,Arial,sans-serif">$</text>' },
  instagram: { name:'Instagram',   glyph:'📸', svg:'<defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#fec053"/><stop offset=".35" stop-color="#f2203e"/><stop offset=".65" stop-color="#b729a8"/><stop offset="1" stop-color="#5342d6"/></linearGradient></defs><rect width="60" height="60" fill="url(#g)"/><rect x="15" y="15" width="30" height="30" rx="9" fill="none" stroke="#fff" stroke-width="3.2"/><circle cx="30" cy="30" r="7.2" fill="none" stroke="#fff" stroke-width="3.2"/><circle cx="38.6" cy="21.4" r="2" fill="#fff"/>' },
  discord:   { name:'Discord',     glyph:'🎮', svg:'<rect width="60" height="60" fill="#5865f2"/><path d="M18.5 21.5c3.6-1.8 7.5-2.8 7.5-2.8l.9 1.8c2.1-.3 4.1-.3 6.2 0l.9-1.8s3.9 1 7.5 2.8c2.9 4.6 4.3 9.8 3.9 15.1-2.9 2.2-5.8 3.5-8.7 3.9l-1.9-2.8c1.1-.4 2.2-.9 3.1-1.6l-.7-.6c-5.7 2.7-12 2.7-17.7 0l-.7.6c1 .7 2 1.2 3.1 1.6l-1.9 2.8c-2.9-.4-5.8-1.7-8.7-3.9-.4-5.3 1-10.5 3.9-15.1z" fill="#fff"/><ellipse cx="24.8" cy="30.6" rx="2.9" ry="3.3" fill="#5865f2"/><ellipse cx="35.2" cy="30.6" rx="2.9" ry="3.3" fill="#5865f2"/>' },
  snapchat:  { name:'Snapchat',    glyph:'👻', svg:'<rect width="60" height="60" fill="#fffc00"/><path d="M30 13.5c6.2 0 9.7 4.5 9.7 10.1v4.3c1 .5 2.3.1 3.1.4.9.4.7 1.6-.3 2.1-1.2.6-2.9 1-3.2 1.8.9 2.9 3.7 5.8 7.2 6.6-.3 1.2-2.4 1.7-4.4 2-.3.7-.3 1.7-1 2-1.1.4-2.5-.4-4.5 0-2.1.4-3.2 2.9-6.7 2.9s-4.6-2.5-6.7-2.9c-2-.4-3.4.4-4.5 0-.7-.3-.7-1.3-1-2-2-.3-4.1-.8-4.4-2 3.5-.8 6.3-3.7 7.2-6.6-.3-.8-2-1.2-3.2-1.8-1-.5-1.2-1.7-.3-2.1.8-.3 2.1.1 3.1-.4v-4.3c0-5.6 3.5-10.1 9.7-10.1z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/>' }
};

const NOTIFY_PRESETS=[
  { app:'messages',   title:'Mom',            text:'come downstairs right now. we need to talk' },
  { app:'bank',       title:'Card declined',  text:'$0.37 at Chuck E. Cheese. Insufficient funds.' },
  { app:'screentime', title:'Screen Time',    text:"You've been live for 9 hours. Maybe go outside?" },
  { app:'findmy',     title:'AirTag Found Moving With You', text:'The location of this AirTag can be seen by the owner.' },
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
  // iOS banner metrics (pt × 3): 16pt side margin, 14pt padding, 38pt icon, 15pt text, 20pt line height
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=block">
<style>
html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;}
body{font-family:-apple-system,"SF Pro Text",Inter,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;font-feature-settings:"cv11","ss01";}
.n{position:absolute;left:48px;right:48px;top:24px;transform:translateY(-130%);display:flex;align-items:center;gap:30px;padding:40px 42px;border-radius:63px;
  background:${dark?'rgba(38,38,40,.86)':'rgba(246,246,246,.86)'};-webkit-backdrop-filter:blur(40px) saturate(180%);backdrop-filter:blur(40px) saturate(180%);
  box-shadow:0 6px 28px rgba(0,0,0,${dark?'.32':'.14'});}
.n.go{animation:in .62s cubic-bezier(.32,1.28,.5,1) forwards, out .42s cubic-bezier(.55,0,.75,.25) ${secs}s forwards;}
.i{flex:0 0 auto;width:114px;height:114px;border-radius:25.5px;overflow:hidden;}
.i svg{display:block;width:100%;height:100%;}
.c{flex:1;min-width:0;}
.t{display:flex;align-items:baseline;gap:24px;}
.h{flex:1;min-width:0;font-weight:600;font-size:45px;line-height:60px;letter-spacing:-.6px;color:${dark?'#fff':'#000'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.w{flex:0 0 auto;font-size:39px;letter-spacing:-.2px;color:${dark?'rgba(235,235,245,.6)':'rgba(60,60,67,.6)'};}
.m{font-size:45px;line-height:60px;letter-spacing:-.6px;color:${dark?'#fff':'#000'};display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;}
@keyframes in{to{transform:translateY(0);}}
@keyframes out{from{transform:translateY(0);}to{transform:translateY(-130%);}}
</style></head><body>
<div class="n" id="n"><div class="i"><svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">${a.svg}</svg></div><div class="c"><div class="t"><div class="h">${escapeHtml(title)}</div><div class="w">now</div></div><div class="m">${escapeHtml(text)}</div></div></div>
<script>
// Wait (briefly) for the font so the text doesn't change shape mid-animation
let started=false;
const go=()=>{ if(started) return; started=true; document.getElementById('n').classList.add('go'); chime(); };
(document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(go);
setTimeout(go,1500);
function chime(){
  if(!${sound?'true':'false'}) return;
  // Short two-note chime (synthesised here, not a recording)
  try{
    const ac=new AudioContext(), t=ac.currentTime+0.08;
    [[1318.5,0],[1760,0.13]].forEach(([f,d])=>{
      const o=ac.createOscillator(), g=ac.createGain();
      o.type='sine'; o.frequency.value=f;
      g.gain.setValueAtTime(0,t+d); g.gain.linearRampToValueAtTime(0.3,t+d+0.01); g.gain.exponentialRampToValueAtTime(0.001,t+d+0.6);
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
    const scale=Math.min(1, (baseW*0.36)/NOTIFY_W);
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
  const d=await sendRequest('SetInputSettings',{ inputName:NOTIFY_SOURCE, inputSettings:{ url:toBase64HtmlUrl(html), width:NOTIFY_W, height:NOTIFY_H }, overlay:true });
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
