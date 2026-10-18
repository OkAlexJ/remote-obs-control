// ==================== Twitch: open player/chat windows + live viewer count ====================
// The old inline <iframe> embed could never load inside the desktop app (Twitch requires the page
// to be served from a real domain), so the player and chat now open in their own windows.
let twitchTimer=null;
const TWITCH_LOGIN=/^[a-zA-Z0-9_]{2,25}$/;

function twitchChannel(){ return $('twitchChannelInput').value.trim().replace(/^https?:\/\/(www\.)?twitch\.tv\//i,'').replace(/\/.*$/,'').toLowerCase(); }

function twitchSaveSettings(){
  appStorageSet('twitch', { channel:twitchChannel(), clientId:$('twitchClientId').value.trim() });
}

function openTwitchWindow(kind){
  const ch=twitchChannel();
  if(!TWITCH_LOGIN.test(ch)){ notify('Enter a valid Twitch channel name first','err'); return; }
  twitchSaveSettings();
  if(window.desktop) window.desktop.twitch.open(kind, ch);
  else window.open(kind==='chat'?`https://www.twitch.tv/popout/${ch}/chat?popout=`:`https://www.twitch.tv/${ch}`,'_blank','noopener');
}
$('twitchPlayerBtn').addEventListener('click',()=>openTwitchWindow('player'));
$('twitchChatBtn').addEventListener('click',()=>openTwitchWindow('chat'));
$('twitchChannelInput').addEventListener('change',()=>{ twitchSaveSettings(); startTwitchPolling(); });

$('saveTwitchApiBtn').addEventListener('click',async()=>{
  if(!window.desktop){ notify('Viewer tracking needs the desktop app','err'); return; }
  const token=$('twitchToken').value.trim();
  if(token) await window.desktop.secrets.set(currentProfileId,'twitchToken',token);
  $('twitchToken').value='';
  twitchSaveSettings();
  await twitchRefreshTokenHint();
  startTwitchPolling(true);
});

async function twitchRefreshTokenHint(){
  if(!window.desktop || !currentProfileId) return;
  const has=await window.desktop.secrets.has(currentProfileId,'twitchToken');
  $('twitchToken').placeholder=has?'•••••••• saved (paste a new one to replace)':'Paste token (stored encrypted)';
}

async function fetchTwitchStatus(showErrors){
  const ch=twitchChannel(), clientId=$('twitchClientId').value.trim();
  if(!window.desktop || !TWITCH_LOGIN.test(ch) || !clientId) return;
  const r=await window.desktop.twitch.status(currentProfileId, ch, clientId);
  const chip=$('viewerChip'), info=$('twitchInfo');
  if(!r.ok){
    chip.classList.add('hidden');
    info.textContent='⚠ '+r.error;
    if(showErrors) notify('Twitch: '+r.error,'err');
    if(/token/i.test(r.error||'')) stopTwitchPolling();
    return;
  }
  $('twitchLiveBadge').classList.toggle('hidden', !r.live);
  chip.classList.remove('hidden');
  if(r.live){
    chip.textContent=`👁 ${r.viewers.toLocaleString()}`;
    chip.classList.add('live');
    const up=r.startedAt?formatDuration(Date.now()-new Date(r.startedAt).getTime()):'';
    info.innerHTML=`<b>${escapeHtml(r.title||'')}</b><br>${escapeHtml(r.game||'')}${up?' · up '+up:''} · ${r.viewers.toLocaleString()} watching`;
  } else {
    chip.textContent='Offline';
    chip.classList.remove('live');
    info.textContent=`${ch} is offline.`;
  }
}

function startTwitchPolling(showErrors){
  stopTwitchPolling();
  if(!$('twitchClientId').value.trim()) return;
  fetchTwitchStatus(showErrors);
  twitchTimer=setInterval(()=>{ if(!document.hidden) fetchTwitchStatus(false); }, 30000);
}
function stopTwitchPolling(){ clearInterval(twitchTimer); twitchTimer=null; }

async function initTwitchUI(){
  stopTwitchPolling();
  const t=appStorageGet('twitch', {});
  $('twitchChannelInput').value=t.channel||'';
  $('twitchClientId').value=t.clientId||'';
  $('twitchToken').value='';
  $('twitchInfo').textContent='';
  $('viewerChip').classList.add('hidden');
  $('twitchLiveBadge').classList.add('hidden');
  await twitchRefreshTokenHint();
  if(t.channel && t.clientId) startTwitchPolling(false);
}
