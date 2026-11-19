'use strict';
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('node:path');
const { createStore } = require('./sticky-store');
const { createPreferences, quickBounds, desktopLayer, minimumNoteSize } = require('./quick-note');

function installNotes(getMainWindow, directory, showWall) {
  const prefs = createPreferences(app.getPath('userData'));
  let placement = Promise.resolve();
  const docked = new WeakSet();
  const editing = new WeakSet();
  const requests = new WeakMap();
  const transitioning = new WeakSet();
  const blurTimers = new WeakMap();
  const contextMenus = new WeakSet();
  let retry;
  const editors = new Map();
  const details = new Map();
  const ids = new Map();
  const correctingSize = new WeakSet();
  function enforceMinimum(win) {
    if (win.isDestroyed() || transitioning.has(win) || correctingSize.has(win)) return;
    const { width, height } = win.getBounds();
    if (width >= minimumNoteSize.width && height >= minimumNoteSize.height) return;
    correctingSize.add(win);
    try { win.setSize(Math.max(width,minimumNoteSize.width), Math.max(height,minimumNoteSize.height)); }
    finally { correctingSize.delete(win); }
  }
  const store = createStore(directory, id => {
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send('notes:changed');
    if (id && details.has(id)) details.get(id).webContents.send('note:detail', store.get(id));
    for (const [key, win] of editors) {
      if ((!id || id === key) && !win.isDestroyed()) win.webContents.send('note:status', store.get(key)?.backup);
    }
  });
  function editorId(event) {
    const id = ids.get(event.sender);
    if (!id || event.senderFrame !== event.sender.mainFrame) throw new Error('无效的便签窗口');
    return id;
  }
  ipcMain.handle('note:load', e => store.get(editorId(e)));
  async function leaveEditor(e) {
    const id = editorId(e), win = editors.get(id);
    if (id === prefs.data.id && !prefs.data.pinned) await place(win, false);
  }
  ipcMain.handle('note:wall', async e => { await leaveEditor(e); showWall(); });
  ipcMain.handle('note:new', async e => {
    const id = editorId(e), win = editors.get(id);
    if (id !== prefs.data.id) { await open(); return { reset:false }; }
    const nextId = store.newId();
    prefs.update({ id:nextId });
    editors.delete(id);
    editors.set(nextId,win);
    ids.set(e.sender,nextId);
    return { reset:true };
  });
  function detailId(event) {
    for (const [id, win] of details) {
      if (win.webContents === event.sender && event.senderFrame === event.sender.mainFrame) return id;
    }
    throw new Error('无效的便签窗口');
  }
  ipcMain.handle('note:detail', e => store.get(detailId(e)));
  ipcMain.handle('note:detail-edit', e => open(detailId(e)));
  async function openDetails(id) {
    if (!store.get(id)) throw new Error('找不到便签');
    if (details.has(id)) {
      const win = details.get(id);
      if (win.isMinimized()) win.restore();
      win.show(); win.focus(); return;
    }
    const win = new BrowserWindow({ width:620,height:600,minWidth:360,minHeight:300,
      title:'便签详情',autoHideMenuBar:true,backgroundColor:'#fffbed',
      webPreferences:{preload:path.join(__dirname,'sticky-detail-preload.js'),sandbox:true,contextIsolation:true} });
    details.set(id,win);
    win.on('closed', () => details.delete(id));
    await win.loadFile(path.join(__dirname,'../renderer/sticky-detail.html'));
  }
  ipcMain.handle('note:edit', async e => {
    const id = editorId(e), win = editors.get(id);
    clearTimeout(blurTimers.get(win));
    if (id === prefs.data.id && !prefs.data.pinned && !editing.has(win)) await place(win, false, true);
  });
  ipcMain.handle('note:controls', e => {
    const id = editorId(e), win = editors.get(id);
    return { pinned:id === prefs.data.id ? !!prefs.data.pinned : win.isAlwaysOnTop(),
      locked:process.platform === 'linux' ? null : !win.isMovable() };
  });
  ipcMain.handle('note:lock', e => {
    const id = editorId(e), win = editors.get(id);
    const locked = win.isMovable();
    if (id === prefs.data.id) prefs.update({ locked, bounds:win.getBounds() });
    win.setMovable(!locked);
    return !win.isMovable();
  });
  ipcMain.handle('note:pin', async e => {
    const id = editorId(e), win = editors.get(id);
    const pinned = !win.isAlwaysOnTop();
    if (id === prefs.data.id) {
      await place(win, pinned, !pinned);
      prefs.update({ pinned });
    } else win.setAlwaysOnTop(pinned);
    return pinned;
  });
  ipcMain.on('note:save', (event, data) => {
    try { event.returnValue = { backup: store.save(editorId(event), data).backup }; }
    catch (error) { event.returnValue = { error: error.message }; }
  });
  function place(win, pinned, edit = false, onBlur = false) {
    clearTimeout(blurTimers.get(win));
    const request = {};
    requests.set(win, request);
    const operation = placement.then(async () => {
      if (win.isDestroyed() || requests.get(win) !== request ||
          (onBlur && (win.isFocused() || prefs.data.pinned))) return;
      transitioning.add(win);
      const dock = !pinned && !edit;
      // Set the editing intent before SetParent, which can emit focus events.
      if (edit) editing.add(win);
      else editing.delete(win);
      if (!pinned) win.setAlwaysOnTop(false);
      try {
        if (dock !== docked.has(win)) {
          await desktopLayer(win, dock);
          if (dock) docked.add(win);
          else docked.delete(win);
        }
      }
      catch (error) {
        editing.delete(win);
        if (win.isDestroyed()) return;
        if (prefs.data.pinned) win.setAlwaysOnTop(true);
        throw error;
      }
      finally { transitioning.delete(win); }
      if (requests.get(win) !== request) return;
      if (!win.isDestroyed()) {
        enforceMinimum(win);
        win.setAlwaysOnTop(pinned);
        if (edit) {
          editing.add(win);
          win.show();
          win.focus();
          win.webContents.focus();
        } else {
          editing.delete(win);
          win.showInactive();
        }
      }
    });
    placement = operation.catch(() => {});
    return operation;
  }
  async function open(id, resident = false) {
    if (id && id === prefs.data.id) resident = true;
    if (id && !resident && !store.get(id)) throw new Error('找不到便签');
    id ||= store.newId();
    if (editors.has(id)) {
      const win = editors.get(id);
      if (resident) await place(win, !!prefs.data.pinned, !prefs.data.pinned);
      else { win.show(); win.focus(); }
      return;
    }
    const win = new BrowserWindow({ width: 390, height: 345,
      minWidth:minimumNoteSize.width, minHeight:minimumNoteSize.height,
      title: '桌面便签', autoHideMenuBar: true, backgroundColor: '#fff8df',
      ...(resident ? { ...quickBounds(prefs.data.bounds), title:'快捷便签', show:false, skipTaskbar:true,
        frame:false, thickFrame:false,
        movable:prefs.data.locked === false,
        minimizable:false, maximizable:false, fullscreenable:false } : {}),
      webPreferences: { preload: path.join(__dirname, 'sticky-preload.js'), sandbox: true, contextIsolation: true } });
    win.setMenuBarVisibility(false);
    async function showContextMenu(params = {}) {
      if (contextMenus.has(win)) return;
      contextMenus.add(win);
      try {
        if (resident && !prefs.data.pinned) await place(win, false, true);
        if (win.isDestroyed()) return;
        const items = [];
        if (params.isEditable) {
          const flags = params.editFlags || {};
          for (const role of ['undo','redo','cut','copy','paste','selectAll']) {
            const flag = 'can' + role[0].toUpperCase() + role.slice(1);
            items.push({ role, enabled:!!flags[flag] });
          }
          items.push({ type:'separator' });
        } else if (params.selectionText) {
          items.push({ role:'copy' }, { type:'separator' });
        }
        items.push({ label:'关闭便签', click:() => win.close() });
        await new Promise(resolve => Menu.buildFromTemplate(items).popup({window:win,callback:resolve}));
      } catch (error) { console.warn('便签菜单：', error.message); }
      finally {
        contextMenus.delete(win);
        if (!win.isDestroyed() && !win.isFocused()) win.emit('blur');
      }
    }
    win.webContents.on('context-menu', (_event, params) => showContextMenu(params));
    win.on('system-context-menu', event => { event.preventDefault(); showContextMenu(); });
    win.on('will-move', event => { if (!win.isMovable()) event.preventDefault(); });
    win.on('will-resize', (event, bounds) => {
      const current = win.getBounds();
      if (bounds.width < minimumNoteSize.width || bounds.height < minimumNoteSize.height ||
          (!win.isMovable() && (bounds.x !== current.x || bounds.y !== current.y))) event.preventDefault();
    });
    win.on('resize', () => enforceMinimum(win));
    const contents = win.webContents;
    editors.set(id, win);
    ids.set(contents, id);
    let placed = false;
    if (resident) {
      win.on('blur', () => {
        clearTimeout(blurTimers.get(win));
        // Ignore focus notifications caused by changing the native parent.
        if (!editing.has(win) || transitioning.has(win) || contextMenus.has(win)) return;
        blurTimers.set(win, setTimeout(() => {
          if (!win.isDestroyed() && !win.isFocused() && !prefs.data.pinned && !contextMenus.has(win))
            place(win, false, false, true).catch(error => console.warn(error.message));
        }, 250));
      });
      win.on('focus', () => clearTimeout(blurTimers.get(win)));
      let moveTimer;
      const saveBounds = () => {
        clearTimeout(moveTimer);
        if (placed && !transitioning.has(win) && !win.isDestroyed()) prefs.update({ bounds:win.getBounds() });
      };
      win.on('move', () => {
        clearTimeout(moveTimer);
        if (placed) moveTimer = setTimeout(saveBounds, 200);
      });
      win.on('moved', saveBounds);
      win.on('resized', saveBounds);
      win.on('close', saveBounds);
    }
    win.on('closed', () => {
      clearTimeout(blurTimers.get(win));
      requests.delete(win);
      editors.delete(ids.get(contents));
      ids.delete(contents);
      if (resident) clearTimeout(retry);
    });
    await win.loadFile(path.join(__dirname, '../renderer/sticky-editor.html'), {
      query:resident ? { quick:'1' } : {}
    });
    if (resident) {
      await place(win, !!prefs.data.pinned);
      placed = true;
    }
  }
  async function openQuick() {
    if (!prefs.data.id) prefs.update({ id:store.newId() });
    await open(prefs.data.id, true);
    clearTimeout(retry);
  }
  function restoreQuick() {
    openQuick().catch(error => {
      console.warn(error.message);
      retry = setTimeout(restoreQuick, 10000);
      retry.unref();
    });
  }
  async function remove(id) {
    const win = editors.get(id);
    if (win) {
      await new Promise((resolve, reject) => {
        const blocked = () => {
          win.removeListener('closed', closed);
          reject(new Error('便签未能保存，请重试'));
        };
        const closed = () => resolve();
        win.webContents.once('will-prevent-unload', blocked);
        win.once('closed', closed);
        win.close();
      });
    }
    store.remove(id);
    details.get(id)?.close();
    if (id === prefs.data.id) {
      prefs.update({ id:store.newId() });
      if (win) restoreQuick();
    }
  }
  app.on('will-quit', store.disconnect);
  return { store, open, openDetails, remove, openQuick, restoreQuick, quickId:() => prefs.data.id, pinned:() => !!prefs.data.pinned };
}
module.exports = { installNotes };
