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
  win: { togglePin: () => ipcRenderer.invoke('window:togglePin') },
  app: {
    getLastProfile: () => ipcRenderer.invoke('app:getLastProfile')
  }
});
