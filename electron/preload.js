// 预加载脚本：通过 contextBridge 暴露安全的 API 给渲染进程
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mdAPI', {
  copyText: (text) => ipcRenderer.invoke('app:copy-text', text),
  connect: (cfg) => ipcRenderer.invoke('webdav:connect', cfg),
  loadConnection: () => ipcRenderer.invoke('app:load-connection'),
  clearConnection: () => ipcRenderer.invoke('app:clear-connection'),
  disconnect: () => ipcRenderer.invoke('webdav:disconnect'),
  list: (dir) => ipcRenderer.invoke('webdav:list', dir),
  read: (p) => ipcRenderer.invoke('webdav:read', p),
  readPDF: (p) => ipcRenderer.invoke('webdav:read-pdf', p),
  createPDF: (p, bytes) => ipcRenderer.invoke('webdav:create-pdf', p, bytes),
  exists: (p) => ipcRenderer.invoke('webdav:exists', p),
  importDocument: () => ipcRenderer.invoke('app:import-document'),
  inspectPDFAnnotations: (bytes) => ipcRenderer.invoke('app:inspect-pdf-annotations', bytes),
  previewPDFAnnotations: (payload) => ipcRenderer.invoke('app:preview-pdf-annotations', payload),
  saveAnnotatedPDF: (payload) => ipcRenderer.invoke('app:save-annotated-pdf', payload),
  confirmAnnotations: () => ipcRenderer.invoke('app:confirm-annotations'),
  exportPDF: (payload) => ipcRenderer.invoke('app:export-pdf', payload),
  write: (p, content) => ipcRenderer.invoke('webdav:write', p, content),
  create: (p, content) => ipcRenderer.invoke('webdav:create', p, content),
  confirmDiscard: (localSaved) => ipcRenderer.invoke('app:confirm-discard', localSaved),
  recoverDraft: (conflict) => ipcRenderer.invoke('app:recover-draft', conflict),
  mkdir: (p) => ipcRenderer.invoke('webdav:mkdir', p),
  remove: (p) => ipcRenderer.invoke('webdav:delete', p),
  rename: (from, to) => ipcRenderer.invoke('webdav:rename', from, to),
  fileMenu: (folder) => ipcRenderer.invoke('app:file-menu', folder),
  confirmDelete: (item) => ipcRenderer.invoke('app:confirm-delete', item),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
});
