const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('note', {
  load: () => ipcRenderer.invoke('note:load'),
  save: data => ipcRenderer.sendSync('note:save', data),
  pin: () => ipcRenderer.invoke('note:pin'),
  edit: () => ipcRenderer.invoke('note:edit'),
  create: () => ipcRenderer.invoke('note:new'),
  controls: () => ipcRenderer.invoke('note:controls'),
  lock: () => ipcRenderer.invoke('note:lock'),
  wall: () => ipcRenderer.invoke('note:wall'),
  onStatus: fn => { ipcRenderer.on('note:status', (_, status) => fn(status)); }
});
