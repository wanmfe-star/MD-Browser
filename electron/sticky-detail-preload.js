const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('noteDetail', {
  load: () => ipcRenderer.invoke('note:detail'),
  edit: () => ipcRenderer.invoke('note:detail-edit'),
  onChange: fn => { ipcRenderer.on('note:detail', (_event,note) => fn(note)); }
});
