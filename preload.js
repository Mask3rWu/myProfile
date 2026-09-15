const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  reloadConfig: () => ipcRenderer.invoke('config:reload'),
  saveConfig: (data) => ipcRenderer.invoke('config:save', data),
  openConfig: () => ipcRenderer.invoke('config:open'),
  openFolder: () => ipcRenderer.invoke('folder:open'),
  setTop: (on) => ipcRenderer.invoke('config:set-top', on),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  expandWindow: () => ipcRenderer.send('window:expand'),
  dragStart: () => ipcRenderer.send('window:drag-start'),
  dragMove: () => ipcRenderer.send('window:drag-move'),
  dragEnd: () => ipcRenderer.send('window:drag-end'),
  onCollapsed: (cb) => {
    ipcRenderer.on('window:collapsed', (_event, edge) => cb(edge));
  },
  onExpanded: (cb) => {
    ipcRenderer.on('window:expanded', () => cb());
  },
  onEdgePosition: (cb) => {
    ipcRenderer.on('window:edge-position', (_event, data) => cb(data));
  },
  showHelpTip: () => ipcRenderer.send('help:tip-show'),
  hideHelpTip: () => ipcRenderer.send('help:tip-hide'),
  onConfigChanged: (cb) => {
    ipcRenderer.on('config:changed', (_event, data) => cb(data));
  }
});
