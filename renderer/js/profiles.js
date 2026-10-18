// ==================== Profile launcher ====================
const PL_AVATARS=['🎬','🎮','🎙️','📺','🎧','🖥️','🎵','⚡','🚀','🧪','🐾','🌟','🎨','🏆','🔥','🌙'];
let plConnections=[];
let plEditingProfileId=null;
let plSelectedAvatar='🎬';
let currentProfile=null;

async function initProfileLauncher(){
  if(!window.desktop){
    // Running as a plain web page (no Electron) — skip profiles entirely and use one local profile
    currentProfileId='default';
    currentProfile={ id:'default', name:'Remote OBS Control', avatar:'🎬' };
    await appStorageLoad();
    enterApp(currentProfile);
    const last=appStorageGet('lastConnection', null);
    if(last){ $('host').value=last.host||''; $('port').value=last.port||'4455'; }
    return;
  }
  plConnections=await window.desktop.connections.list();
  await plRenderGrid();
  $('profileLauncher').classList.remove('hidden');
  const profiles=await window.desktop.profiles.list();
  if(!profiles.length) plOpenModal(null); // first launch: straight into creating a profile
}

async function plRenderGrid(){
  const profiles=await window.desktop.profiles.list();
  const grid=$('plGrid');
  grid.innerHTML='';
  profiles.sort((a,b)=>(b.lastUsedAt||0)-(a.lastUsedAt||0)).forEach((p,i)=>{
    const card=document.createElement('div');
    card.className='pl-card';
    card.tabIndex=0;
    const conn=plConnections.find(c=>c.id===p.connectionId);
    card.innerHTML=`
      <div class="pl-avatar">
        ${escapeHtml(p.avatar||'🎬')}
        <span class="pl-status-dot ${conn?'ok':''}" title="${conn?'Has a saved OBS connection':'No OBS connection saved'}"></span>
        <span class="pl-edit" title="Edit profile">⚙</span>
        ${i<9?`<span class="pl-key">${i+1}</span>`:''}
      </div>
      <div class="pl-name">${escapeHtml(p.name)}</div>
      <div class="pl-meta">${conn?escapeHtml(conn.name):'No OBS connection set'}</div>
      <div class="pl-meta">${p.lastUsedAt?plRelativeTime(p.lastUsedAt):'Never used'}</div>
    `;
    card.querySelector('.pl-edit').addEventListener('click',(e)=>{ e.stopPropagation(); plOpenModal(p.id); });
    card.addEventListener('click',()=>plSelectProfile(p));
    card.addEventListener('keydown',e=>{ if(e.key==='Enter') plSelectProfile(p); });
    card.dataset.index=i;
    grid.appendChild(card);
  });
  const addCard=document.createElement('div');
  addCard.className='pl-card pl-add';
  addCard.tabIndex=0;
  addCard.innerHTML=`<div class="pl-avatar">+</div><div class="pl-name">Add Profile</div><div class="pl-meta">&nbsp;</div>`;
  addCard.addEventListener('click',()=>plOpenModal(null));
  addCard.addEventListener('keydown',e=>{ if(e.key==='Enter') plOpenModal(null); });
  grid.appendChild(addCard);
}

// Number keys 1–9 open profiles from the launcher
window.addEventListener('keydown',e=>{
  if($('profileLauncher').classList.contains('hidden') || isModalOpen() || isTyping()) return;
  if(/^[1-9]$/.test(e.key)){
    const card=$('plGrid').querySelector(`.pl-card[data-index="${Number(e.key)-1}"]`);
    if(card) card.click();
  }
});

function plRelativeTime(ts){
  const mins=Math.floor((Date.now()-ts)/60000);
  if(mins<1) return 'Just now';
  if(mins<60) return mins+'m ago';
  const hrs=Math.floor(mins/60);
  if(hrs<24) return hrs+'h ago';
  const days=Math.floor(hrs/24);
  if(days<30) return days+'d ago';
  return new Date(ts).toLocaleDateString();
}

async function plSelectProfile(profile){
  currentProfileId=profile.id;
  currentProfile=profile;
  await window.desktop.profiles.touch(profile.id);
  await appStorageLoad();
  $('profileLauncher').classList.add('hidden');
  enterApp(profile);
  notify('Switched to '+profile.name,'ok');

  const conn=plConnections.find(c=>c.id===profile.connectionId);
  $('saveConnBtn').classList.remove('hidden');
  if(conn){
    $('host').value=conn.host||'';
    $('port').value=conn.port||'4455';
    $('pass').value=await window.desktop.connections.getPassword(conn.id)||'';
    if(PREFS.autoConnect) connectObs({ host:$('host').value, port:$('port').value, password:$('pass').value });
  } else {
    $('host').value=''; $('port').value='4455'; $('pass').value='';
    $('host').focus();
  }
}

// Disconnect cleanly and save before showing another profile
async function leaveCurrentProfile(){
  disconnectObs();
  appStorageFlush();
  stopTwitchPolling();
  sbResetPool();
  closeProps();
  while(closeTopModal()){}
}

async function goToFullLauncher(){
  await leaveCurrentProfile();
  currentProfileId=null;
  currentProfile=null;
  $('appRoot').classList.add('hidden');
  plConnections=await window.desktop.connections.list();
  await plRenderGrid();
  $('profileLauncher').classList.remove('hidden');
}

// Save the connection fields in the top bar into this profile's linked connection
$('saveConnBtn').addEventListener('click',async()=>{
  if(!window.desktop || !currentProfile) return;
  const host=$('host').value.trim(), port=$('port').value.trim()||'4455';
  if(!host){ notify('Enter a host first','err'); return; }
  const existing=plConnections.find(c=>c.id===currentProfile.connectionId);
  const r=await window.desktop.connections.save({ id:existing?existing.id:undefined, name:existing?existing.name:(currentProfile.name+' OBS'), host, port, password:$('pass').value });
  plConnections=r.list;
  if(!existing){
    await window.desktop.profiles.save({ id:currentProfile.id, connectionId:r.id });
    currentProfile.connectionId=r.id;
  }
  notify('Connection saved to this profile','ok');
});

// ---- Create / edit profile modal ----
function plRenderAvatarPicker(){
  const wrap=$('plAvatarPicker');
  wrap.innerHTML='';
  PL_AVATARS.forEach(a=>{
    const opt=document.createElement('button');
    opt.type='button';
    opt.className='pl-avatar-opt'+(a===plSelectedAvatar?' active':'');
    opt.textContent=a;
    opt.addEventListener('click',()=>{ plSelectedAvatar=a; plRenderAvatarPicker(); });
    wrap.appendChild(opt);
  });
}

function plFillConnectionSelect(selectedId){
  const sel=$('plFieldConnection');
  sel.innerHTML='<option value="">— No OBS connection —</option><option value="__new__">+ New connection…</option>';
  plConnections.forEach(c=>{
    const opt=document.createElement('option');
    opt.value=c.id; opt.textContent=`${c.name} (${c.host}:${c.port})`;
    sel.appendChild(opt);
  });
  sel.value=selectedId||'';
  plSyncConnFields();
}

// Picking an existing connection now lets you edit it (host/port/password) — before, there was no way to fix a typo'd IP
function plSyncConnFields(){
  const v=$('plFieldConnection').value;
  const conn=plConnections.find(c=>c.id===v);
  $('plConnFields').classList.toggle('hidden', !v);
  $('plConnDeleteBtn').classList.toggle('hidden', !conn);
  $('plConnTestResult').textContent='';
  $('plConnName').value=conn?conn.name:'';
  $('plConnHost').value=conn?conn.host:'';
  $('plConnPort').value=conn?conn.port:'4455';
  $('plConnPass').value='';
  $('plConnPass').placeholder=conn&&conn.hasPassword?'•••••••• saved (type to change)':'Password (leave blank if none)';
  $('plConnPass').dataset.dirty='';
}
$('plFieldConnection').addEventListener('change', plSyncConnFields);
$('plConnPass').addEventListener('input',()=>{ $('plConnPass').dataset.dirty='1'; });

async function plOpenModal(profileId){
  plEditingProfileId=profileId;
  hideBoxErr('plModalErr');
  plConnections=await window.desktop.connections.list();
  const profiles=await window.desktop.profiles.list();
  const p=profileId?profiles.find(x=>x.id===profileId):null;
  $('plModalTitle').textContent=p?'Edit Profile':(profiles.length?'New Profile':'Welcome! Create your first profile');
  $('plFieldName').value=p?p.name:'';
  $('plFieldDesc').value=p?(p.description||''):'';
  plSelectedAvatar=p?(p.avatar||'🎬'):PL_AVATARS[profiles.length % PL_AVATARS.length];
  plRenderAvatarPicker();
  ['plDeleteBtn','plDupBtn','plExportBtn'].forEach(id=>{ $(id).style.display=p?'inline-block':'none'; });
  plFillConnectionSelect(p && p.connectionId ? p.connectionId : (profiles.length?'':'__new__'));
  openModal('plModal','plModalBackdrop');
  setTimeout(()=>$('plFieldName').focus(),0);
}
function plCloseModal(){ closeModal('plModal'); }
$('plModalCancel').addEventListener('click', plCloseModal);
$('plModalBackdrop').addEventListener('click', plCloseModal);
$('plFieldName').addEventListener('keydown',e=>{ if(e.key==='Enter') $('plModalSave').click(); });

$('plConnTestBtn').addEventListener('click',async()=>{
  const host=$('plConnHost').value.trim();
  if(!host){ $('plConnTestResult').textContent='Enter a host first.'; return; }
  let password=$('plConnPass').value;
  const existing=plConnections.find(c=>c.id===$('plFieldConnection').value);
  if(existing && !$('plConnPass').dataset.dirty) password=await window.desktop.connections.getPassword(existing.id);
  $('plConnTestResult').textContent='Testing…';
  $('plConnTestBtn').disabled=true;
  const r=await testObsConnection(host, $('plConnPort').value.trim()||'4455', password);
  $('plConnTestBtn').disabled=false;
  $('plConnTestResult').textContent=(r.ok?'✅ ':'❌ ')+r.msg;
});

$('plConnDeleteBtn').addEventListener('click',async()=>{
  const conn=plConnections.find(c=>c.id===$('plFieldConnection').value);
  if(!conn) return;
  if(!await askConfirm(`Delete connection "${conn.name}"?`, 'Any profile using it will be left without a connection.', 'Delete', true)) return;
  plConnections=await window.desktop.connections.delete(conn.id);
  plFillConnectionSelect('');
});

$('plModalSave').addEventListener('click', async ()=>{
  hideBoxErr('plModalErr');
  const name=$('plFieldName').value.trim();
  if(!name) return showBoxErr('plModalErr','Give the profile a name.');

  let connectionId=$('plFieldConnection').value;
  if(connectionId){
    const isNew=connectionId==='__new__';
    const host=$('plConnHost').value.trim();
    const port=$('plConnPort').value.trim()||'4455';
    if(!host) return showBoxErr('plModalErr','Enter a host/IP for the connection, or choose "No OBS connection".');
    if(!/^\d{1,5}$/.test(port)) return showBoxErr('plModalErr','The port should be a number (4455 by default).');
    const conn={
      id:isNew?undefined:connectionId,
      name:$('plConnName').value.trim() || (name+' OBS'),
      host, port,
      // Only send a password when it was typed, so editing other fields keeps the saved one
      password:(isNew || $('plConnPass').dataset.dirty) ? $('plConnPass').value : undefined
    };
    const r=await window.desktop.connections.save(conn);
    plConnections=r.list;
    connectionId=r.id;
  }

  await window.desktop.profiles.save({
    id:plEditingProfileId||undefined,
    name, description:$('plFieldDesc').value.trim(),
    avatar:plSelectedAvatar,
    connectionId:connectionId||null
  });
  plCloseModal();
  await plRenderGrid();
});

$('plDeleteBtn').addEventListener('click', async ()=>{
  if(!plEditingProfileId) return;
  if(!await askConfirm('Delete this profile?', 'Its soundboards, macros and saved layout are removed. The OBS connection stays, since other profiles may use it.', 'Delete', true)) return;
  await window.desktop.profiles.delete(plEditingProfileId);
  plCloseModal();
  await plRenderGrid();
  const profiles=await window.desktop.profiles.list();
  if(!profiles.length) plOpenModal(null);
});

$('plDupBtn').addEventListener('click', async ()=>{
  if(!plEditingProfileId) return;
  const orig=(await window.desktop.profiles.list()).find(x=>x.id===plEditingProfileId);
  await window.desktop.profiles.duplicate(plEditingProfileId, (orig?orig.name:'Profile')+' Copy');
  plCloseModal();
  await plRenderGrid();
  notify('Profile duplicated','ok');
});

$('plImportBtn').addEventListener('click',async()=>{
  const r=await window.desktop.profiles.import();
  if(r && r.error) tellUser('Import failed', r.error);
  if(r && r.ok){ plConnections=await window.desktop.connections.list(); await plRenderGrid(); notify(`Imported "${r.name}" — add its OBS password in the profile editor`,'ok'); }
});
$('plExportBtn').addEventListener('click',async()=>{
  if(!plEditingProfileId) return;
  const r=await window.desktop.profiles.export(plEditingProfileId);
  if(r && r.ok) notify('Profile exported (your OBS password is not included)','ok');
  else if(r && r.error) notify(r.error,'err');
});
