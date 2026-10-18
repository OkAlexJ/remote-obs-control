// ==================== obs-websocket v5 connection ====================
// Event subscription bits from the obs-websocket protocol
const EVENT_SUBS = {
  All: (1<<11)-1,              // General, Config, Scenes, Inputs, Transitions, Filters, Outputs, SceneItems, MediaInputs, Vendors, Ui
  InputVolumeMeters: 1<<16,
  SceneItemTransformChanged: 1<<19
};
const REQUEST_TIMEOUT_MS = 10000;
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000];

const OBS = {
  ws: null,
  identified: false,
  pending: new Map(),
  handlers: {},
  manualClose: false,
  reconnectTimer: null,
  reconnectAttempt: 0,
  countdownTimer: null,
  lastConn: null,      // { host, port, password }
  version: null
};

function obsOn(type, fn){ (OBS.handlers[type] = OBS.handlers[type] || []).push(fn); }
function obsEmit(type, data){
  (OBS.handlers[type]||[]).forEach(fn=>{ try{ fn(data); }catch(e){ console.error('Handler for', type, 'failed', e); } });
}
function isConnected(){ return OBS.identified && OBS.ws && OBS.ws.readyState===WebSocket.OPEN; }

const statusDot=$('statusDot'), statusText=$('statusText'), errBox=$('errBox');
function setStatus(t,k){ statusText.textContent=t; statusDot.className='dot'+(k?' '+k:''); }
function showErr(m){ errBox.textContent=m; errBox.classList.remove('hidden'); }
function clearErr(){ errBox.classList.add('hidden'); }

async function sha256b64(str){
  const enc=new TextEncoder().encode(str);
  const hash=await crypto.subtle.digest('SHA-256',enc);
  let bin=''; new Uint8Array(hash).forEach(b=>bin+=String.fromCharCode(b));
  return btoa(bin);
}
async function obsAuthString(password, auth){
  const secret=await sha256b64(password+auth.salt);
  return sha256b64(secret+auth.challenge);
}

function closeReasonText(code, reason){
  switch(code){
    case 4009: return 'Wrong password — OBS rejected the login.';
    case 4010: return 'This OBS uses an incompatible obs-websocket version.';
    case 4011: return 'OBS kicked this client.';
    case 1006: return "Couldn't reach OBS at that address. Check the IP/port, that OBS is running, and that its WebSocket server is enabled.";
    default: return reason ? `Connection closed: ${reason}` : '';
  }
}

function updateConnectButton(){
  const btn=$('connectBtn');
  const busy=OBS.ws && !OBS.identified && OBS.ws.readyState<=WebSocket.OPEN;
  if(isConnected() || OBS.reconnectTimer){ btn.textContent='Disconnect'; btn.classList.add('secondary'); }
  else { btn.textContent=busy?'Connecting…':'Connect'; btn.classList.remove('secondary'); }
  btn.disabled=!!busy && !OBS.reconnectTimer;
}

function cancelReconnect(){
  clearTimeout(OBS.reconnectTimer); OBS.reconnectTimer=null;
  clearInterval(OBS.countdownTimer); OBS.countdownTimer=null;
}

function disconnectObs(){
  cancelReconnect();
  OBS.manualClose=true;
  if(OBS.ws){ try{ OBS.ws.close(1000); }catch(e){} }
  else setStatus('Disconnected','');
  updateConnectButton();
}

function connectObs(conn){
  clearErr();
  cancelReconnect();
  const host=(conn.host||'').trim();
  const port=String(conn.port||'').trim()||'4455';
  if(!host){ showErr("Enter the OBS PC's IP address (e.g. its Tailscale IP)."); return; }
  if(!/^\d{1,5}$/.test(port)){ showErr('The port should be a number (OBS uses 4455 by default).'); return; }
  OBS.lastConn={ host, port, password: conn.password||'' };

  // Close the previous socket first. Its handlers check `sock===OBS.ws`, so a late close event from
  // the old socket can no longer flip the *new* connection to "disconnected" (old bug on profile switch).
  if(OBS.ws){ const old=OBS.ws; OBS.ws=null; try{ old.close(1000); }catch(e){} }
  failAllPending('Reconnecting');
  OBS.identified=false;
  OBS.manualClose=false;

  setStatus(OBS.reconnectAttempt ? 'Reconnecting…' : 'Connecting…','pending');
  let sock;
  const url=`ws://${host.includes(':') && !host.startsWith('[') ? '['+host+']' : host}:${port}`;
  try{ sock=new WebSocket(url); }
  catch(e){ setStatus('Connection failed','err'); showErr('Could not open the socket: '+e.message); updateConnectButton(); return; }
  OBS.ws=sock;
  updateConnectButton();

  sock.onopen=()=>{ if(sock===OBS.ws) setStatus('Waiting for OBS handshake…','pending'); };

  sock.onmessage=async(evt)=>{
    if(sock!==OBS.ws) return;
    let msg; try{ msg=JSON.parse(evt.data); }catch(e){ return; }
    if(msg.op===0){
      const identifyMsg={op:1,d:{rpcVersion:1,eventSubscriptions: EVENT_SUBS.All | EVENT_SUBS.InputVolumeMeters | EVENT_SUBS.SceneItemTransformChanged}};
      if(msg.d.authentication){
        if(!OBS.lastConn.password){ showErr('This OBS needs a password. Enter it and connect again.'); }
        identifyMsg.d.authentication=await obsAuthString(OBS.lastConn.password, msg.d.authentication);
      }
      OBS.version=msg.d.obsWebSocketVersion;
      sock.send(JSON.stringify(identifyMsg));
    } else if(msg.op===2){
      OBS.identified=true;
      const wasReconnect=OBS.reconnectAttempt>0;
      OBS.reconnectAttempt=0;
      setStatus(`Connected to ${host}`,'ok');
      clearErr();
      updateConnectButton();
      notify(wasReconnect?'Reconnected to OBS':'Connected to OBS','ok');
      logActivity(wasReconnect?'Reconnected to OBS':'Connected to OBS at '+host);
      obsEmit('ConnectionOpened', { host, port });
    } else if(msg.op===5){
      obsEmit(msg.d.eventType, msg.d.eventData||{});
    } else if(msg.op===7){
      const p=OBS.pending.get(msg.d.requestId);
      if(p){ OBS.pending.delete(msg.d.requestId); clearTimeout(p.timer); p.resolve(msg.d); }
    }
  };

  sock.onclose=(ev)=>{
    if(sock!==OBS.ws) return;
    const wasIdentified=OBS.identified;
    OBS.identified=false;
    OBS.ws=null;
    failAllPending('Disconnected');
    if(wasIdentified){ obsEmit('ConnectionClosed', {}); }

    const reasonText=closeReasonText(ev.code, ev.reason);
    const fatal=ev.code===4009 || ev.code===4010 || ev.code===4011;
    if(OBS.manualClose){
      setStatus('Disconnected','');
      if(wasIdentified){ notify('Disconnected from OBS'); logActivity('Disconnected from OBS'); }
    } else if(fatal || (!wasIdentified && OBS.reconnectAttempt===0)){
      // First attempt failed or OBS refused us: tell the user instead of retrying forever
      setStatus('Connection failed','err');
      if(reasonText) showErr(reasonText);
      notify(ev.code===4009?'Wrong OBS password':"Couldn't connect to OBS",'err');
    } else {
      if(wasIdentified){ notify('Lost connection to OBS — reconnecting…','err'); logActivity('Lost connection to OBS'); }
      scheduleReconnect();
    }
    updateConnectButton();
  };
}

function scheduleReconnect(){
  const delay=RECONNECT_DELAYS[Math.min(OBS.reconnectAttempt, RECONNECT_DELAYS.length-1)];
  OBS.reconnectAttempt++;
  let remaining=Math.round(delay/1000);
  setStatus(`Connection lost — retrying in ${remaining}s`,'pending');
  clearInterval(OBS.countdownTimer);
  OBS.countdownTimer=setInterval(()=>{
    remaining--;
    if(remaining>0) setStatus(`Connection lost — retrying in ${remaining}s`,'pending');
  },1000);
  OBS.reconnectTimer=setTimeout(()=>{
    clearInterval(OBS.countdownTimer); OBS.countdownTimer=null;
    OBS.reconnectTimer=null;
    if(OBS.lastConn) connectObs(OBS.lastConn);
  }, delay);
  updateConnectButton();
}

function failAllPending(reason){
  OBS.pending.forEach(p=>{ clearTimeout(p.timer); p.resolve({ requestStatus:{ result:false, code:-1, comment:reason } }); });
  OBS.pending.clear();
}

// Always resolves (never rejects): { requestStatus, responseData }
function sendRequest(requestType, requestData={}){
  return new Promise((resolve)=>{
    if(!isConnected()){ resolve({ requestStatus:{ result:false, code:-1, comment:'Not connected to OBS' } }); return; }
    const requestId=requestType+'_'+Math.random().toString(36).slice(2);
    const timer=setTimeout(()=>{
      if(OBS.pending.delete(requestId)) resolve({ requestStatus:{ result:false, code:-2, comment:'OBS did not answer in time' } });
    }, REQUEST_TIMEOUT_MS);
    OBS.pending.set(requestId, { resolve, timer });
    try{ OBS.ws.send(JSON.stringify({op:6,d:{requestType,requestId,requestData}})); }
    catch(e){ clearTimeout(timer); OBS.pending.delete(requestId); resolve({ requestStatus:{ result:false, code:-1, comment:e.message } }); }
  });
}

// Returns responseData (or {}) on success, null on failure
async function req(type, data={}){
  const d=await sendRequest(type,data);
  if(!d.requestStatus || !d.requestStatus.result) return null;
  return d.responseData || {};
}
function reqError(d){ return (d && d.requestStatus && d.requestStatus.comment) || 'unknown error'; }

// One-off connection check (used by "Test connection" in the profile editor); doesn't touch the main socket
function testObsConnection(host, port, password){
  return new Promise(resolve=>{
    let done=false, sock;
    const finish=(ok,msg)=>{ if(done) return; done=true; try{ sock && sock.close(); }catch(e){} resolve({ok,msg}); };
    try{ sock=new WebSocket(`ws://${host}:${port||4455}`); }catch(e){ return finish(false,'Invalid address'); }
    const timer=setTimeout(()=>finish(false,'Timed out — nothing answered at that address.'), 6000);
    sock.onmessage=async(evt)=>{
      let msg; try{ msg=JSON.parse(evt.data); }catch(e){ return; }
      if(msg.op===0){
        const d={rpcVersion:1,eventSubscriptions:0};
        if(msg.d.authentication) d.authentication=await obsAuthString(password||'', msg.d.authentication);
        sock.send(JSON.stringify({op:1,d}));
      } else if(msg.op===2){ clearTimeout(timer); finish(true,'Success — OBS accepted the connection.'); }
    };
    sock.onclose=(ev)=>{ clearTimeout(timer); finish(false, closeReasonText(ev.code, ev.reason) || 'Connection closed.'); };
  });
}

// ---- Connection bar wiring ----
$('connectBtn').addEventListener('click', ()=>{
  if(isConnected() || OBS.reconnectTimer){ disconnectObs(); return; }
  connectObs({ host:$('host').value, port:$('port').value, password:$('pass').value });
});
['host','port','pass'].forEach(id=>$(id).addEventListener('keydown',e=>{ if(e.key==='Enter') $('connectBtn').click(); }));
