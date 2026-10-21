// ==================== Text to speech (+ ASMR voice) ====================
// Speech comes from Windows' built-in voices (main process), optionally gets the ASMR treatment here,
// then plays through a hidden "Text to Speech" browser source in the live scene. That source is set to
// "Monitor and Output", so it's on the stream AND the streamer hears it through their OBS monitoring.
const TTS_SOURCE='Text to Speech';
const TTS_MAX=300;
let ttsVoices=[];
let ttsPreview=null;

const TTS_STYLES={
  normal:{ name:'Normal', rate:0 },
  asmr:  { name:'ASMR whisper', rate:-3 }
};

async function initTtsUI(){
  const sel=$('ttsVoice');
  if(!window.desktop){ sel.innerHTML='<option value="">(needs the desktop app)</option>'; return; }
  if(!ttsVoices.length) ttsVoices=await window.desktop.tts.voices();
  const prefs=appStorageGet('ttsPrefs',{ voice:'', style:'normal', volume:90 });
  sel.innerHTML=ttsVoices.length
    ? ttsVoices.map(v=>`<option value="${escapeHtml(v.name)}">${escapeHtml(v.name.replace(/^Microsoft /,'').replace(/ Desktop$/,''))}</option>`).join('')
    : '<option value="">(no Windows voices found)</option>';
  // Default: a female voice suits the ASMR style best
  sel.value=prefs.voice && ttsVoices.some(v=>v.name===prefs.voice) ? prefs.voice : ((ttsVoices.find(v=>v.gender==='Female')||ttsVoices[0]||{}).name||'');
  $('ttsStyle').value=prefs.style in TTS_STYLES ? prefs.style : 'normal';
  $('ttsVolume').value=prefs.volume ?? 90;
}
function saveTtsPrefs(){ appStorageSet('ttsPrefs',{ voice:$('ttsVoice').value, style:$('ttsStyle').value, volume:parseInt($('ttsVolume').value,10) }); }
['ttsVoice','ttsStyle','ttsVolume'].forEach(id=>$(id).addEventListener('change', saveTtsPrefs));

// Text -> WAV data URL (styled)
async function makeSpeech(text, style, voice){
  if(!window.desktop) throw new Error('Text to speech needs the desktop app.');
  const st=TTS_STYLES[style]||TTS_STYLES.normal;
  const r=await window.desktop.tts.speak({ text, voice, rate:st.rate });
  if(!r.ok) throw new Error(r.error);
  return style==='asmr' ? await asmrize(r.dataUrl) : r.dataUrl;
}

// ---- ASMR treatment ----
// Turns the plain voice into a close-mic whisper: breathy noise that follows the words, softer voiced
// part, warm low end, a slow ear-to-ear pan (binaural-style) and a little room.
async function asmrize(dataUrl){
  const bytes=Uint8Array.from(atob(dataUrl.split(',')[1]), c=>c.charCodeAt(0));
  const tmpCtx=new AudioContext();
  const buf=await tmpCtx.decodeAudioData(bytes.buffer);
  tmpCtx.close();

  const SR=22050, SLOW=0.92;
  const dur=buf.duration/SLOW;
  const len=Math.ceil((dur+0.8)*SR);
  const off=new OfflineAudioContext(2,len,SR);

  // Loudness envelope of the speech (10 ms steps), used to shape the breath noise
  const ch=buf.getChannelData(0), hop=Math.round(buf.sampleRate*0.01);
  const env=new Float32Array(Math.ceil(ch.length/hop));
  for(let i=0;i<env.length;i++){
    let s=0; const a=i*hop, b=Math.min(ch.length,a+hop);
    for(let j=a;j<b;j++) s+=ch[j]*ch[j];
    env[i]=Math.sqrt(s/Math.max(1,b-a));
  }
  for(let i=1;i<env.length;i++) env[i]=Math.max(env[i], env[i-1]*0.85); // soften decays
  const noise=off.createBuffer(1,len,SR), nd=noise.getChannelData(0);
  for(let t=0;t<len;t++){
    const srcSec=(t/SR)*SLOW, k=Math.floor(srcSec*buf.sampleRate/hop);
    const e=k<env.length?env[k]:0;
    nd[t]=(Math.random()*2-1)*e*2.2;
  }

  const voice=off.createBufferSource(); voice.buffer=buf; voice.playbackRate.value=SLOW;
  const vHp=off.createBiquadFilter(); vHp.type='highpass'; vHp.frequency.value=110;
  const vWarm=off.createBiquadFilter(); vWarm.type='lowshelf'; vWarm.frequency.value=220; vWarm.gain.value=5;
  const vSoft=off.createBiquadFilter(); vSoft.type='lowpass'; vSoft.frequency.value=5200;
  const vGain=off.createGain(); vGain.gain.value=0.42;
  voice.connect(vHp).connect(vWarm).connect(vSoft).connect(vGain);

  const breath=off.createBufferSource(); breath.buffer=noise;
  const bBand=off.createBiquadFilter(); bBand.type='bandpass'; bBand.frequency.value=3200; bBand.Q.value=0.6;
  const bAir=off.createBiquadFilter(); bAir.type='highshelf'; bAir.frequency.value=7000; bAir.gain.value=-6;
  const bGain=off.createGain(); bGain.gain.value=0.55;
  breath.connect(bBand).connect(bAir).connect(bGain);

  // Slow left-right drift, like whispering from one ear to the other
  const pan=off.createStereoPanner();
  const steps=Math.max(2,Math.ceil(dur*20)), curve=new Float32Array(steps);
  for(let i=0;i<steps;i++) curve[i]=0.8*Math.sin((i/steps)*dur*2*Math.PI/7);
  pan.pan.setValueCurveAtTime(curve,0,dur);
  vGain.connect(pan); bGain.connect(pan);

  // Small, close room
  const verb=off.createConvolver();
  const ir=off.createBuffer(2,Math.round(SR*0.45),SR);
  for(let c=0;c<2;c++){ const d=ir.getChannelData(c); for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,3); }
  verb.buffer=ir;
  const dry=off.createGain(); dry.gain.value=0.9;
  const wet=off.createGain(); wet.gain.value=0.12;
  pan.connect(dry).connect(off.destination);
  pan.connect(verb).connect(wet).connect(off.destination);

  voice.start(0); breath.start(0);
  const rendered=await off.startRendering();
  return wavDataUrl(rendered);
}

// AudioBuffer -> 16-bit PCM WAV data URL (peak-normalised)
function wavDataUrl(ab){
  const n=ab.length, chs=ab.numberOfChannels, data=[...Array(chs)].map((_,c)=>ab.getChannelData(c));
  let peak=0.0001; data.forEach(d=>{ for(let i=0;i<n;i++) peak=Math.max(peak,Math.abs(d[i])); });
  const gain=0.9/peak;
  const out=new DataView(new ArrayBuffer(44+n*chs*2));
  const w=(o,s)=>[...s].forEach((c,i)=>out.setUint8(o+i,c.charCodeAt(0)));
  w(0,'RIFF'); out.setUint32(4,36+n*chs*2,true); w(8,'WAVE'); w(12,'fmt ');
  out.setUint32(16,16,true); out.setUint16(20,1,true); out.setUint16(22,chs,true); out.setUint32(24,ab.sampleRate,true);
  out.setUint32(28,ab.sampleRate*chs*2,true); out.setUint16(32,chs*2,true); out.setUint16(34,16,true);
  w(36,'data'); out.setUint32(40,n*chs*2,true);
  let o=44;
  for(let i=0;i<n;i++) for(let c=0;c<chs;c++){ const v=Math.max(-1,Math.min(1,data[c][i]*gain)); out.setInt16(o,v<0?v*0x8000:v*0x7fff,true); o+=2; }
  const bytes=new Uint8Array(out.buffer);
  let bin=''; for(let i=0;i<bytes.length;i+=0x8000) bin+=String.fromCharCode.apply(null, bytes.subarray(i,i+0x8000));
  return 'data:audio/wav;base64,'+btoa(bin);
}

// ---- Playback through OBS ----
async function ensureTtsSource(){
  const scene=currentProgramScene;
  if(!scene) throw new Error('No live scene.');
  const list=await req('GetSceneItemList',{ sceneName:scene });
  if(list && list.sceneItems.some(i=>i.sourceName===TTS_SOURCE)) return;
  const inputs=await req('GetInputList');
  const exists=!!(inputs && inputs.inputs.some(i=>i.inputName===TTS_SOURCE));
  const d=exists
    ? await sendRequest('CreateSceneItem',{ sceneName:scene, sourceName:TTS_SOURCE })
    : await sendRequest('CreateInput',{ sceneName:scene, inputName:TTS_SOURCE, inputKind:'browser_source',
        inputSettings:{ url:'about:blank', width:8, height:8, reroute_audio:true } });
  if(!d.requestStatus.result) throw new Error(reqError(d));
}
async function playOnObs(dataUrl, volume){
  if(!isConnected()) throw new Error('Connect to OBS first.');
  await ensureTtsSource();
  // Audio goes through OBS (not straight to their speakers) and is monitored, so the streamer hears it too
  await req('SetInputAudioMonitorType',{ inputName:TTS_SOURCE, monitorType:'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT' });
  const vol=Math.max(0,Math.min(100,volume ?? 90))/100;
  const html=`<!DOCTYPE html><html><body style="margin:0;background:transparent"><audio id="a" src="${dataUrl}" autoplay></audio><script>document.getElementById('a').volume=${vol};<\/script></body></html>`;
  const d=await sendRequest('SetInputSettings',{ inputName:TTS_SOURCE, inputSettings:{ url:toBase64HtmlUrl(html), width:8, height:8, reroute_audio:true }, overlay:true });
  if(!d.requestStatus.result) throw new Error(reqError(d));
}

async function sayOnStream(text, style, voice, volume){
  const t=String(text||'').trim().slice(0,TTS_MAX);
  if(!t) throw new Error('Type something to say.');
  const audio=await makeSpeech(t, style, voice);
  await playOnObs(audio, volume);
  logActivity(`Said${style==='asmr'?' (ASMR)':''}: ${t}`);
}

// ---- Panel ----
$('ttsSpeakBtn').addEventListener('click',async()=>{
  const btn=$('ttsSpeakBtn');
  btn.disabled=true; btn.textContent='…';
  try{ await sayOnStream($('ttsText').value, $('ttsStyle').value, $('ttsVoice').value, parseInt($('ttsVolume').value,10)); }
  catch(e){ notify(e.message,'err'); }
  btn.disabled=false; btn.textContent='Say it';
});
$('ttsPreviewBtn').addEventListener('click',async()=>{
  const btn=$('ttsPreviewBtn');
  btn.disabled=true;
  try{
    const audio=await makeSpeech($('ttsText').value.trim().slice(0,TTS_MAX)||'Testing, one two three.', $('ttsStyle').value, $('ttsVoice').value);
    if(ttsPreview) ttsPreview.pause();
    ttsPreview=new Audio(audio); ttsPreview.volume=parseInt($('ttsVolume').value,10)/100; ttsPreview.play();
  }catch(e){ notify(e.message,'err'); }
  btn.disabled=false;
});
$('ttsText').addEventListener('keydown',e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); $('ttsSpeakBtn').click(); } });
$('ttsText').addEventListener('input',()=>{ $('ttsCount').textContent=`${$('ttsText').value.length}/${TTS_MAX}`; });
