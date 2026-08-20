const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  reloadConfig: () => ipcRenderer.invoke('config:reload'),
  openConfig: () => ipcRenderer.invoke('config:open'),
  setTop: (on) => ipcRenderer.invoke('config:set-top', on),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onConfigChanged: (cb) => {
    ipcRenderer.on('config:changed', (_event, data) => cb(data));
  }
});
