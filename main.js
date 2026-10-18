const { app, BrowserWindow, ipcMain, safeStorage, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const userDataDir = () => app.getPath('userData');
const filePath = (name) => path.join(userDataDir(), name);

function readJson(name, fallback) {
  try {
    const raw = fs.readFileSync(filePath(name), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function writeJson(name, data) {
  try {
    fs.mkdirSync(userDataDir(), { recursive: true });
    fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Failed to write', name, e);
    return false;
  }
}

// ---------- Window state (remember size/position) ----------
function loadWindowState() {
  const defaults = { width: 1440, height: 900, x: undefined, y: undefined, isMaximized: false };
  const saved = readJson('window-state.json', {});
  const state = { ...defaults, ...saved };
  // Make sure the remembered position is still on an actual screen
  const displays = screen.getAllDisplays();
  const onScreen = displays.some(d =>
    state.x !== undefined &&
    state.x >= d.bounds.x && state.x < d.bounds.x + d.bounds.width &&
    state.y >= d.bounds.y && state.y < d.bounds.y + d.bounds.height
  );
  if (!onScreen) { state.x = undefined; state.y = undefined; }
  return state;
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  const isMaximized = win.isMaximized();
  const bounds = isMaximized ? win.getNormalBounds() : win.getBounds();
  writeJson('window-state.json', { ...bounds, isMaximized });
}

// ---------- Main window ----------
let mainWindow;

function createWindow() {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1024,
    minHeight: 700,
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#0b0b0d',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (state.isMaximized) mainWindow.maximize();

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(mainWindow), 400);
  };
  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);
  mainWindow.on('close', () => saveWindowState(mainWindow));
}

// Only one copy of the app at a time; a second launch just focuses the first
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  app.whenReady().then(createWindow);
}

// Security: the app never needs to open new windows or navigate away from its own page
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (ev, url) => { if (!url.startsWith('file://')) ev.preventDefault(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ==================== Profiles ====================
// profiles.json: [{ id, name, description, avatar, connectionId, createdAt, lastUsedAt }]
ipcMain.handle('profiles:list', () => readJson('profiles.json', []));

ipcMain.handle('profiles:save', (e, profile) => {
  const list = readJson('profiles.json', []);
  const idx = list.findIndex(p => p.id === profile.id);
  if (idx >= 0) list[idx] = { ...list[idx], ...profile };
  else list.push({ ...profile, id: profile.id || 'p_' + Date.now(), createdAt: Date.now() });
  writeJson('profiles.json', list);
  return list;
});

ipcMain.handle('profiles:delete', (e, id) => {
  const list = readJson('profiles.json', []).filter(p => p.id !== id);
  writeJson('profiles.json', list);
  try { fs.unlinkSync(filePath(`store-${id}.json`)); } catch (err) {}
  return list;
});

ipcMain.handle('profiles:duplicate', (e, id, newName) => {
  const list = readJson('profiles.json', []);
  const original = list.find(p => p.id === id);
  if (!original) return list;
  const newId = 'p_' + Date.now() + Math.random().toString(36).slice(2, 6);
  list.push({ ...original, id: newId, name: newName || (original.name + ' Copy'), createdAt: Date.now(), lastUsedAt: null });
  writeJson('profiles.json', list);
  // Copy the profile's own store (soundboard etc.) so it starts from the same state
  const srcStore = readJson(`store-${id}.json`, null);
  if (srcStore) writeJson(`store-${newId}.json`, srcStore);
  return list;
});

ipcMain.handle('profiles:touch', (e, id) => {
  const list = readJson('profiles.json', []);
  const p = list.find(p => p.id === id);
  if (p) { p.lastUsedAt = Date.now(); writeJson('profiles.json', list); }
  writeJson('app-state.json', { lastProfileId: id });
  return list;
});

ipcMain.handle('app:getLastProfile', () => readJson('app-state.json', {}).lastProfileId || null);

// ==================== Global OBS connections ====================
// connections.json: [{ id, name, host, port, passwordEnc(base64|null) }]
// Passwords are encrypted at rest via Electron's OS-backed safeStorage and only
// ever decrypted in this (main) process, on demand, right before a connect attempt.
function connectionsPublic(list) {
  return list.map(({ passwordEnc, ...rest }) => ({ ...rest, hasPassword: !!passwordEnc }));
}

ipcMain.handle('connections:list', () => connectionsPublic(readJson('connections.json', [])));

ipcMain.handle('connections:save', (e, conn) => {
  const list = readJson('connections.json', []);
  const idx = list.findIndex(c => c.id === conn.id);
  let passwordEnc = idx >= 0 ? list[idx].passwordEnc : null;
  if (typeof conn.password === 'string') {
    passwordEnc = conn.password
      ? (safeStorage.isEncryptionAvailable()
          ? safeStorage.encryptString(conn.password).toString('base64')
          : Buffer.from(conn.password, 'utf8').toString('base64')) // fallback if OS keychain unavailable
      : null;
  }
  const record = { id: conn.id || 'c_' + Date.now(), name: conn.name, host: conn.host, port: conn.port, passwordEnc };
  if (idx >= 0) list[idx] = record; else list.push(record);
  writeJson('connections.json', list);
  return connectionsPublic(list);
});

ipcMain.handle('connections:delete', (e, id) => {
  const list = readJson('connections.json', []).filter(c => c.id !== id);
  writeJson('connections.json', list);
  return connectionsPublic(list);
});

ipcMain.handle('connections:getPassword', (e, id) => {
  const list = readJson('connections.json', []);
  const c = list.find(c => c.id === id);
  if (!c || !c.passwordEnc) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(c.passwordEnc, 'base64'));
    }
    return Buffer.from(c.passwordEnc, 'base64').toString('utf8');
  } catch (e) {
    return '';
  }
});

// ==================== Profile-scoped app data (soundboard, viz colors, etc.) ====================
ipcMain.handle('store:get', (e, profileId) => readJson(`store-${profileId}.json`, {}));
ipcMain.handle('store:set', (e, profileId, data) => writeJson(`store-${profileId}.json`, data));

// ==================== Export / import profiles, window pin ====================
ipcMain.handle('profiles:export', async (e, id) => {
  const p = readJson('profiles.json', []).find(x => x.id === id);
  if (!p) return { ok: false };
  const conn = readJson('connections.json', []).find(c => c.id === p.connectionId);
  const bundle = {
    format: 'remote-obs-control-profile', version: 1,
    profile: { name: p.name, description: p.description, avatar: p.avatar },
    connection: conn ? { name: conn.name, host: conn.host, port: conn.port } : null, // password is never exported
    store: readJson(`store-${id}.json`, {})
  };
  const r = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `${p.name.replace(/[^\w\- ]+/g, '')}.obsprofile.json`,
    filters: [{ name: 'OBS Profile', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false };
  fs.writeFileSync(r.filePath, JSON.stringify(bundle, null, 2), 'utf8');
  return { ok: true };
});

ipcMain.handle('profiles:import', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'OBS Profile', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  let b;
  try { b = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch (err) { return { ok: false, error: 'That file could not be read.' }; }
  if (!b || b.format !== 'remote-obs-control-profile' || !b.profile || !b.profile.name) return { ok: false, error: 'That is not a Remote OBS Control profile file.' };
  let connectionId = null;
  if (b.connection && b.connection.host) {
    const conns = readJson('connections.json', []);
    let c = conns.find(x => x.host === b.connection.host && String(x.port) === String(b.connection.port));
    if (!c) {
      c = { id: 'c_' + Date.now(), name: b.connection.name || 'Imported Connection', host: b.connection.host, port: b.connection.port, passwordEnc: null };
      conns.push(c); writeJson('connections.json', conns);
    }
    connectionId = c.id;
  }
  const list = readJson('profiles.json', []);
  const id = 'p_' + Date.now() + Math.random().toString(36).slice(2, 6);
  list.push({ ...b.profile, id, connectionId, createdAt: Date.now(), lastUsedAt: null });
  writeJson('profiles.json', list);
  writeJson(`store-${id}.json`, b.store || {});
  return { ok: true };
});

ipcMain.handle('window:togglePin', () => {
  if (!mainWindow) return false;
  mainWindow.setAlwaysOnTop(!mainWindow.isAlwaysOnTop());
  return mainWindow.isAlwaysOnTop();
});
