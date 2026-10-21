const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    save: (profile) => ipcRenderer.invoke('profiles:save', profile),
    delete: (id) => ipcRenderer.invoke('profiles:delete', id),
    duplicate: (id, newName) => ipcRenderer.invoke('profiles:duplicate', id, newName),
    touch: (id) => ipcRenderer.invoke('profiles:touch', id),
    export: (id) => ipcRenderer.invoke('profiles:export', id),
    import: () => ipcRenderer.invoke('profiles:import')
  },
  connections: {
    list: () => ipcRenderer.invoke('connections:list'),
    save: (conn) => ipcRenderer.invoke('connections:save', conn),
    delete: (id) => ipcRenderer.invoke('connections:delete', id),
    getPassword: (id) => ipcRenderer.invoke('connections:getPassword', id)
  },
  store: {
    get: (profileId) => ipcRenderer.invoke('store:get', profileId),
    set: (profileId, data) => ipcRenderer.invoke('store:set', profileId, data)
  },
  secrets: {
    set: (profileId, key, value) => ipcRenderer.invoke('secrets:set', profileId, key, value),
    has: (profileId, key) => ipcRenderer.invoke('secrets:has', profileId, key)
  },
  twitch: {
    status: (profileId, channel, clientId) => ipcRenderer.invoke('twitch:status', profileId, channel, clientId),
    open: (kind, channel) => ipcRenderer.invoke('twitch:open', kind, channel)
  },
  filters: {
    localUrl: () => ipcRenderer.invoke('filters:localUrl'),
    tailnetUrl: () => ipcRenderer.invoke('filters:tailnetUrl')
  },
  tts: {
    voices: () => ipcRenderer.invoke('tts:voices'),
    speak: (opts) => ipcRenderer.invoke('tts:speak', opts)
  },
  files: {
    saveImage: (dataUrl, name) => ipcRenderer.invoke('file:saveImage', dataUrl, name)
  },
  win: {
    togglePin: () => ipcRenderer.invoke('window:togglePin'),
    setPin: (on) => ipcRenderer.invoke('window:setPin', on)
  },
  app: {
    getLastProfile: () => ipcRenderer.invoke('app:getLastProfile'),
    version: () => ipcRenderer.invoke('app:version')
  }
});
