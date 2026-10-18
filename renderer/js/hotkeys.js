// ==================== Hotkeys (shared by scenes, soundboard buttons and macros) ====================
const MODIFIER_KEYS=['Control','Shift','Alt','Meta'];

function comboFromEvent(e){
  if(MODIFIER_KEYS.includes(e.key)) return null;
  const parts=[];
  if(e.ctrlKey) parts.push('Ctrl');
  if(e.altKey) parts.push('Alt');
  if(e.shiftKey) parts.push('Shift');
  // Use the physical key for letters/digits so Shift+1 is "Shift+1", not "Shift+!"
  let key=e.key;
  if(/^Key[A-Z]$/.test(e.code)) key=e.code.slice(3);
  else if(/^Digit\d$/.test(e.code)) key=e.code.slice(5);
  else if(/^Numpad\d$/.test(e.code)) key='Num'+e.code.slice(6);
  else if(key===' ') key='Space';
  else if(key.length===1) key=key.toUpperCase();
  parts.push(key);
  return parts.join('+');
}

// Keys the app itself uses — refuse them as custom hotkeys
const RESERVED_COMBOS=['Ctrl+,','Ctrl+K','Ctrl+P','Ctrl+T','Ctrl+Shift+T','Escape','Shift+?','?','Delete','Backspace','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Shift+ArrowUp','Shift+ArrowDown','Shift+ArrowLeft','Shift+ArrowRight','Tab','Enter'];

// Every hotkey currently assigned, as [{combo, kind, id, label}]
function allHotkeys(){
  const out=[];
  Object.values(sbState.buttons||{}).forEach(b=>{ if(b.hotkey) out.push({ combo:b.hotkey, kind:'sound', id:b.id, label:`soundboard button "${b.name}"` }); });
  const sceneHotkeys=appStorageGet('sceneHotkeys', {});
  Object.entries(sceneHotkeys).forEach(([scene,combo])=>{ if(combo) out.push({ combo, kind:'scene', id:scene, label:`scene "${scene}"` }); });
  (macrosState||[]).forEach(m=>{ if(m.hotkey) out.push({ combo:m.hotkey, kind:'macro', id:m.id, label:`macro "${m.name}"` }); });
  return out;
}

// Returns a human-readable reason the combo can't be used, or null if it's free
function hotkeyConflict(combo, kind, id){
  if(!combo) return null;
  if(RESERVED_COMBOS.includes(combo)) return `"${combo}" is used by the app itself.`;
  const clash=allHotkeys().find(h=>h.combo===combo && !(h.kind===kind && h.id===id));
  return clash ? `"${combo}" is already used by ${clash.label}.` : null;
}

// One active "press a key…" recorder at a time
let hotkeyRecorder=null; // { onCombo(combo|null), onCancel() }
function startHotkeyRecording(onCombo, onCancel){
  if(hotkeyRecorder && hotkeyRecorder.onCancel) hotkeyRecorder.onCancel();
  hotkeyRecorder={ onCombo, onCancel };
}
function stopHotkeyRecording(){ hotkeyRecorder=null; }

// Used by the soundboard + macro editors: "Set" button records into a readonly input
function wireHotkeyField(inputId, setBtnId, clearBtnId){
  const input=$(inputId), setBtn=$(setBtnId);
  const reset=()=>{ setBtn.textContent='Set'; };
  setBtn.addEventListener('click',()=>{
    setBtn.textContent='Press keys…';
    startHotkeyRecording(combo=>{ input.value=combo||''; reset(); }, reset);
  });
  $(clearBtnId).addEventListener('click',()=>{ input.value=''; });
  return ()=>{ if(hotkeyRecorder){ stopHotkeyRecording(); } reset(); };
}

function runHotkey(combo){
  const h=allHotkeys().find(x=>x.combo===combo);
  if(!h) return false;
  if(h.kind==='sound') sbPlayButton(h.id);
  else if(h.kind==='macro') runMacro(h.id);
  else if(h.kind==='scene'){
    if(!scenesData.some(s=>s.sceneName===h.id)) return false;
    goLive(h.id);
  }
  return true;
}

// ==================== Single keyboard dispatcher ====================
// (The old code had five separate keydown listeners that could all fire for one key press.)
window.addEventListener('keydown',(e)=>{
  // 1. Recording a hotkey swallows everything (Esc cancels, Backspace/Delete clears)
  if(hotkeyRecorder){
    e.preventDefault(); e.stopPropagation();
    if(e.key==='Escape'){ const r=hotkeyRecorder; stopHotkeyRecording(); r.onCancel && r.onCancel(); return; }
    if(e.key==='Backspace' || e.key==='Delete'){ const r=hotkeyRecorder; stopHotkeyRecording(); r.onCombo(null); return; }
    const combo=comboFromEvent(e);
    if(!combo) return;
    if(RESERVED_COMBOS.includes(combo)){ notify(`"${combo}" is used by the app itself — pick another key.`,'err'); return; }
    const r=hotkeyRecorder; stopHotkeyRecording(); r.onCombo(combo);
    return;
  }

  const inApp=!!currentProfileId && !$('appRoot').classList.contains('hidden');

  // 2. Esc closes the topmost popup, otherwise deselects the stage item
  if(e.key==='Escape'){
    if(!$('propsPanel').classList.contains('hidden')){ closeProps(); return; }
    if(!$('previewPanel').classList.contains('hidden')){ $('previewPanel').classList.add('hidden'); return; }
    if(closeTopModal()) return;
    if(inApp && selectedItemId){ selectItem(null); }
    return;
  }

  // Inside a dialog only Enter/Esc matter; never fire app hotkeys behind a modal
  if(isModalOpen()) return;

  // 3. App-level shortcuts (work even while a field is focused)
  const key=e.key.toLowerCase();
  if(e.ctrlKey && !e.altKey && !e.shiftKey && key==='k' && inApp){ e.preventDefault(); openCommandPalette(); return; }
  if(e.ctrlKey && !e.altKey && !e.shiftKey && key==='p' && inApp){ e.preventDefault(); openQuickSwitcher(); return; }
  if(e.ctrlKey && !e.shiftKey && e.key===','){ e.preventDefault(); openSettings(); return; }
  if(e.ctrlKey && e.shiftKey && key==='t'){ e.preventDefault(); nextTheme(); return; }
  if(e.ctrlKey && !e.shiftKey && key==='t'){ e.preventDefault(); togglePin(); return; }

  if(isTyping()) return;
  if(e.key==='?'){ e.preventDefault(); openHelp(); return; }
  if(!inApp) return;

  // 4. Stage editing keys
  if(selectedItemId && handleStageKey(e)) return;

  // 5. User hotkeys
  const combo=comboFromEvent(e);
  if(combo && runHotkey(combo)) e.preventDefault();
});
