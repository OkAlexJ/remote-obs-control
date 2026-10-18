const { app, BrowserWindow, ipcMain, safeStorage, screen, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Dev/testing: ROC_USER_DATA points the app at a throwaway data folder instead of your real profiles
if (process.env.ROC_USER_DATA) app.setPath('userData', process.env.ROC_USER_DATA);

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

// Write to a temp file then rename, so a crash mid-write can never leave a half-written (corrupt) JSON file
function writeJson(name, data) {
  try {
    fs.mkdirSync(userDataDir(), { recursive: true });
    const target = filePath(name);
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, target);
    return true;
  } catch (e) {
    console.error('Failed to write', name, e);
    return false;
  }
}

// Profile ids end up in file names, so only allow safe characters (blocks "../" path traversal)
const SAFE_ID = /^[\w-]{1,64}$/;
function assertId(id) {
  if (typeof id !== 'string' || !SAFE_ID.test(id)) throw new Error('Invalid id');
  return id;
}
const newId = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------- Encryption helpers (OS keychain via safeStorage) ----------
function encrypt(plain) {
  if (!plain) return null;
  return safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(plain).toString('base64')
    : 'b64:' + Buffer.from(plain, 'utf8').toString('base64'); // fallback if OS keychain unavailable (flagged in README)
}
function decrypt(enc) {
  if (!enc) return '';
  try {
    if (enc.startsWith('b64:')) return Buffer.from(enc.slice(4), 'base64').toString('utf8');
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    return Buffer.from(enc, 'base64').toString('utf8'); // legacy un-prefixed fallback values
  } catch (e) {
    return '';
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
const indexUrl = () => 'file://' + path.join(__dirname, 'renderer', 'index.html').replace(/\\/g, '/');

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
    backgroundColor: '#0e0e11',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  if (state.isMaximized) mainWindow.maximize();

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // The app page should never navigate away — this also stops a file dragged onto
  // the window from replacing the whole app with that file.
  mainWindow.webContents.on('will-navigate', (ev, url) => {
    if (url.split('#')[0] !== indexUrl()) ev.preventDefault();
  });

  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(mainWindow), 400);
  };
  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);
  mainWindow.on('close', () => saveWindowState(mainWindow));
  mainWindow.on('closed', () => { mainWindow = null; });
}

if (process.platform === 'win32') app.setAppUserModelId('com.remoteobscontrol.app');

// Only one copy of the app at a time; a second launch just focuses the first
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  app.whenReady().then(createWindow);
}

// Security: nothing may open arbitrary new windows. Links that try to are sent to the real browser instead.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ==================== Profiles ====================
// profiles.json: [{ id, name, description, avatar, connectionId, createdAt, lastUsedAt }]
const PROFILE_FIELDS = ['name', 'description', 'avatar', 'connectionId'];
const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj && k in obj).map(k => [k, obj[k]]));

ipcMain.handle('profiles:list', () => readJson('profiles.json', []));

ipcMain.handle('profiles:save', (e, profile) => {
  const list = readJson('profiles.json', []);
  const fields = pick(profile, PROFILE_FIELDS);
  const idx = profile.id ? list.findIndex(p => p.id === profile.id) : -1;
  let id;
  if (idx >= 0) { list[idx] = { ...list[idx], ...fields }; id = list[idx].id; }
  else { id = newId('p_'); list.push({ ...fields, id, createdAt: Date.now(), lastUsedAt: null }); }
  writeJson('profiles.json', list);
  return { list, id };
});

ipcMain.handle('profiles:delete', (e, id) => {
  assertId(id);
  const list = readJson('profiles.json', []).filter(p => p.id !== id);
  writeJson('profiles.json', list);
  try { fs.unlinkSync(filePath(`store-${id}.json`)); } catch (err) {}
  const secrets = readJson('secrets.json', {});
  if (secrets[id]) { delete secrets[id]; writeJson('secrets.json', secrets); }
  return list;
});

ipcMain.handle('profiles:duplicate', (e, id, newName) => {
  assertId(id);
  const list = readJson('profiles.json', []);
  const original = list.find(p => p.id === id);
  if (!original) return list;
  const copyId = newId('p_');
  list.push({ ...original, id: copyId, name: newName || (original.name + ' Copy'), createdAt: Date.now(), lastUsedAt: null });
  writeJson('profiles.json', list);
  // Copy the profile's own store (soundboard etc.) so it starts from the same state
  const srcStore = readJson(`store-${id}.json`, null);
  if (srcStore) writeJson(`store-${copyId}.json`, srcStore);
  return list;
});

ipcMain.handle('profiles:touch', (e, id) => {
  assertId(id);
  const list = readJson('profiles.json', []);
  const p = list.find(p => p.id === id);
  if (p) { p.lastUsedAt = Date.now(); writeJson('profiles.json', list); }
  writeJson('app-state.json', { ...readJson('app-state.json', {}), lastProfileId: id });
  return list;
});

ipcMain.handle('app:getLastProfile', () => readJson('app-state.json', {}).lastProfileId || null);
ipcMain.handle('app:version', () => app.getVersion());

// ==================== Global OBS connections ====================
// connections.json: [{ id, name, host, port, passwordEnc }]
// Passwords are encrypted at rest via Electron's OS-backed safeStorage and only
// ever decrypted in this (main) process, on demand, right before a connect attempt.
function connectionsPublic(list) {
  return list.map(({ passwordEnc, ...rest }) => ({ ...rest, hasPassword: !!passwordEnc }));
}

ipcMain.handle('connections:list', () => connectionsPublic(readJson('connections.json', [])));

ipcMain.handle('connections:save', (e, conn) => {
  const list = readJson('connections.json', []);
  const idx = conn.id ? list.findIndex(c => c.id === conn.id) : -1;
  let passwordEnc = idx >= 0 ? list[idx].passwordEnc : null;
  // password: string = set it ('' clears it); undefined/null = keep the saved one
  if (typeof conn.password === 'string') passwordEnc = encrypt(conn.password);
  const id = idx >= 0 ? list[idx].id : newId('c_');
  const record = {
    id,
    name: String(conn.name || 'OBS').slice(0, 80),
    host: String(conn.host || '').trim(),
    port: String(conn.port || '4455').trim(),
    passwordEnc
  };
  if (idx >= 0) list[idx] = record; else list.push(record);
  writeJson('connections.json', list);
  return { list: connectionsPublic(list), id };
});

ipcMain.handle('connections:delete', (e, id) => {
  const list = readJson('connections.json', []).filter(c => c.id !== id);
  writeJson('connections.json', list);
  // Unlink it from any profile that used it
  const profiles = readJson('profiles.json', []);
  let changed = false;
  profiles.forEach(p => { if (p.connectionId === id) { p.connectionId = null; changed = true; } });
  if (changed) writeJson('profiles.json', profiles);
  return connectionsPublic(list);
});

ipcMain.handle('connections:getPassword', (e, id) => {
  const c = readJson('connections.json', []).find(c => c.id === id);
  return c ? decrypt(c.passwordEnc) : '';
});

// ==================== Profile-scoped app data (soundboard, macros, viz colors, etc.) ====================
ipcMain.handle('store:get', (e, profileId) => readJson(`store-${assertId(profileId)}.json`, {}));
ipcMain.handle('store:set', (e, profileId, data) => writeJson(`store-${assertId(profileId)}.json`, data));

// ==================== Per-profile secrets (e.g. Twitch token) ====================
// The renderer can set a secret or ask whether one exists, but never read it back.
ipcMain.handle('secrets:set', (e, profileId, key, value) => {
  assertId(profileId);
  const all = readJson('secrets.json', {});
  all[profileId] = all[profileId] || {};
  if (value) all[profileId][key] = encrypt(String(value)); else delete all[profileId][key];
  writeJson('secrets.json', all);
  return true;
});
ipcMain.handle('secrets:has', (e, profileId, key) => {
  assertId(profileId);
  return !!(readJson('secrets.json', {})[profileId] || {})[key];
});
const getSecret = (profileId, key) => decrypt((readJson('secrets.json', {})[profileId] || {})[key]);

// ==================== Twitch ====================
const TWITCH_LOGIN = /^[a-zA-Z0-9_]{2,25}$/;

ipcMain.handle('twitch:status', async (e, profileId, channel, clientId) => {
  assertId(profileId);
  if (!TWITCH_LOGIN.test(channel || '')) return { ok: false, error: 'Invalid channel name' };
  let token = getSecret(profileId, 'twitchToken');
  if (!clientId || !token) return { ok: false, error: 'Missing Client ID or token' };
  token = token.replace(/^oauth:/i, '').replace(/^Bearer\s+/i, '');
  try {
    const res = await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(channel)}`, {
      headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` }
    });
    if (res.status === 401) return { ok: false, error: 'Twitch rejected the token (expired or wrong Client ID)' };
    if (!res.ok) return { ok: false, error: `Twitch API error ${res.status}` };
    const data = await res.json();
    const s = data.data && data.data[0];
    if (!s) return { ok: true, live: false };
    return { ok: true, live: true, viewers: s.viewer_count, title: s.title, game: s.game_name, startedAt: s.started_at };
  } catch (err) {
    return { ok: false, error: 'Could not reach Twitch' };
  }
});

// Twitch's embedded player refuses to run inside a file:// page (it needs a real "parent" domain),
// so the player and chat open in their own small windows instead, where they work normally.
const twitchWindows = {};
ipcMain.handle('twitch:open', (e, kind, channel) => {
  if (!TWITCH_LOGIN.test(channel || '')) return false;
  const url = kind === 'chat'
    ? `https://www.twitch.tv/popout/${channel}/chat?popout=`
    : `https://player.twitch.tv/?channel=${channel}&parent=twitch.tv&muted=false`;
  const existing = twitchWindows[kind];
  if (existing && !existing.isDestroyed()) { existing.loadURL(url); existing.focus(); return true; }
  const win = new BrowserWindow({
    width: kind === 'chat' ? 380 : 960,
    height: kind === 'chat' ? 720 : 560,
    title: kind === 'chat' ? `Chat — ${channel}` : `Stream — ${channel}`,
    autoHideMenuBar: true,
    backgroundColor: '#0e0e11',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:twitch' }
  });
  win.webContents.on('will-navigate', (ev, navUrl) => {
    if (!/^https:\/\/([a-z0-9-]+\.)*twitch\.tv\//i.test(navUrl)) { ev.preventDefault(); shell.openExternal(navUrl); }
  });
  win.loadURL(url);
  twitchWindows[kind] = win;
  return true;
});

// ==================== Files: export / import profiles, save screenshots ====================
ipcMain.handle('profiles:export', async (e, id) => {
  const p = readJson('profiles.json', []).find(x => x.id === id);
  if (!p) return { ok: false };
  const conn = readJson('connections.json', []).find(c => c.id === p.connectionId);
  const bundle = {
    format: 'remote-obs-control-profile', version: 1,
    profile: { name: p.name, description: p.description, avatar: p.avatar },
    connection: conn ? { name: conn.name, host: conn.host, port: conn.port } : null, // password is never exported
    store: readJson(`store-${assertId(id)}.json`, {})
  };
  const safeName = (p.name || '').replace(/[^\w\- ]+/g, '').trim() || 'profile';
  const r = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `${safeName}.obsprofile.json`,
    filters: [{ name: 'OBS Profile', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false };
  try { fs.writeFileSync(r.filePath, JSON.stringify(bundle, null, 2), 'utf8'); }
  catch (err) { return { ok: false, error: 'Could not write that file.' }; }
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
      c = { id: newId('c_'), name: String(b.connection.name || 'Imported Connection'), host: String(b.connection.host), port: String(b.connection.port || '4455'), passwordEnc: null };
      conns.push(c); writeJson('connections.json', conns);
    }
    connectionId = c.id;
  }
  const list = readJson('profiles.json', []);
  const id = newId('p_');
  const prof = pick(b.profile, ['name', 'description', 'avatar']);
  prof.name = String(prof.name).slice(0, 60);
  list.push({ ...prof, id, connectionId, createdAt: Date.now(), lastUsedAt: null });
  writeJson('profiles.json', list);
  writeJson(`store-${id}.json`, (b.store && typeof b.store === 'object') ? b.store : {});
  return { ok: true, name: prof.name };
});

ipcMain.handle('file:saveImage', async (e, dataUrl, suggestedName) => {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return { ok: false, error: 'Not an image' };
  const ext = m[1] === 'png' ? 'png' : 'jpg';
  const safe = String(suggestedName || 'screenshot').replace(/[^\w\- ]+/g, '').trim() || 'screenshot';
  const r = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('pictures'), `${safe}.${ext}`),
    filters: [{ name: 'Image', extensions: [ext] }]
  });
  if (r.canceled || !r.filePath) return { ok: false };
  try { fs.writeFileSync(r.filePath, Buffer.from(m[2], 'base64')); }
  catch (err) { return { ok: false, error: 'Could not save the image.' }; }
  return { ok: true, path: r.filePath };
});

// ==================== Window ====================
ipcMain.handle('window:setPin', (e, on) => {
  if (!mainWindow) return false;
  mainWindow.setAlwaysOnTop(!!on);
  return mainWindow.isAlwaysOnTop();
});
ipcMain.handle('window:togglePin', () => {
  if (!mainWindow) return false;
  mainWindow.setAlwaysOnTop(!mainWindow.isAlwaysOnTop());
  return mainWindow.isAlwaysOnTop();
});
