import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the renderer with controlled IPC responses, including delayed saves.
const elements = new Map();
function element() {
  return {
    value: '', textContent: '',
    set innerHTML(value) { this.html = value; this.children = []; }, get innerHTML() { return this.html || ''; }, disabled: false, readOnly: false,
    style: {}, dataset: {}, children: [], listeners: {},
    classList: { toggle() {} },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); },
    setCustomValidity(message) { this.validationMessage = message; },
    reportValidity() {}, focus() {}, select() {}, showModal() {}, close() {},
  };
}
const get = id => {
  if (!elements.has(id)) elements.set(id, element());
  return elements.get(id);
};
const windowEvents = {};
let reads = 0, disconnects = 0, closed = false;
const api = {
  loadConnection: async () => ({ ok: true, data: null }),
  write: async () => ({ ok: false, error: 'offline' }),
  confirmDiscard: async () => ({ ok: true, data: false }),
  read: async () => { reads++; return { ok: true, data: 'other' }; },
  disconnect: async () => { disconnects++; return { ok: true }; },
};
const storage = new Map();
const localStorage = { get length() { return storage.size; }, key: index => [...storage.keys()][index], getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
const context = vm.createContext({
  localStorage, URL,
  document: { getElementById: get, createElement: element, addEventListener() {} },
  window: { mdAPI: api, addEventListener: (name, fn) => { windowEvents[name] = fn; }, close: () => { closed = true; } },
  marked: { parse: text => text }, setTimeout, clearTimeout,
});
vm.runInContext(fs.readFileSync(new URL('../renderer/view-zoom.js', import.meta.url), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8'), context);
const run = code => vm.runInContext(code, context);

assert.equal(get('editor').readOnly, true);
assert.equal(get('newFile').disabled, true);
run("state.connected = true; state.currentFile = { path: '/a.md', name: 'a.md' }; state.savedContent = 'old'; editorEl.value = 'draft'; syncControls();");
await run("runAction(() => openFile({ path: '/b.md', name: 'b.md' }))");
assert.equal(reads, 0, 'cancelled switch must not read another file');
assert.equal(get('editor').value, 'draft');
await run('runAction(doDisconnect)');
assert.equal(disconnects, 0, 'cancelled disconnect must retain connection');

let finishSave;
api.write = () => new Promise(resolve => { finishSave = resolve; });
const saving = run('runAction(save)');
assert.equal(get('editor').readOnly, false, 'editing remains possible while saving');
get('editor').value = 'newer draft';
await run("runAction(() => openFile({ path: '/b.md', name: 'b.md' }))");
assert.equal(reads, 0, 'file switch is blocked while saving');
finishSave({ ok: true });
await saving;
assert.equal(run('state.savedContent'), 'draft');
assert.equal(run('isDirty()'), true, 'newer edits must remain unsaved');
assert.equal(get('renameBtn').disabled, false);

api.write = async () => ({ ok: false, error: 'offline' });
await run('runAction(save)');
assert.equal(run('state.savedContent'), 'draft', 'failed save must retain previous baseline');
assert.equal(run('isDirty()'), true);

let prevented = false;
windowEvents.beforeunload({ preventDefault() { prevented = true; } });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(prevented, true);
assert.equal(closed, false, 'cancelled close must keep window open');

api.confirmDiscard = async () => ({ ok: true, data: true });
await run("runAction(() => openFile({ path: '/b.md', name: 'b.md' }))");
assert.equal(reads, 1);
assert.equal(get('editor').value, 'other');
assert.equal(run('isDirty()'), false);
run("state.currentDir = '/empty'; state.entries = []; renderList();");
assert.equal(get('filelist').children.length, 2, 'empty subdirectory contains parent link and empty message');

get('connPass').value = 'secret';
get('editor').value = 'unsaved';
await run('runAction(doDisconnect)');
assert.equal(disconnects, 1);
assert.equal(run('state.currentDir'), '/');
assert.equal(get('editor').value, '');
assert.equal(get('editor').readOnly, true);
assert.equal(get('renameBtn').disabled, true);
assert.equal(get('connPass').value, '');

run("state.currentFile = { path: '/a.md' }; state.savedContent = ''; editorEl.value = 'draft';");
windowEvents.beforeunload({ preventDefault() {} });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(closed, true, 'approved discard permits closing');

// Debounced auto-save persists a draft immediately and clears it after success.
run("state.connected = true; state.connectionKey = 'server-a/user'; state.currentFile = { path: '/auto.md', name: 'auto.md' }; state.savedContent = ''; editorEl.value = 'auto draft';");
let writes = 0;
api.write = async (path, content) => { writes++; assert.equal(path, '/auto.md'); assert.equal(content, 'auto draft'); return { ok: true }; };
get('editor').listeners.input();
assert.equal(run("readDraft('/auto.md').content"), 'auto draft');
assert.equal(writes, 0);
await new Promise(resolve => setTimeout(resolve, 2150));
assert.equal(writes, 1, 'idle editing auto-saves once');
assert.equal(run('isDirty()'), false);
assert.equal(run("readDraft('/auto.md')"), null);

// Recovery compares the remote version before allowing a local replacement.
run("editorEl.value = 'recovered draft'; persistDraft(); state.currentFile = null;");
let conflictSeen = false;
api.read = async () => ({ ok: true, data: 'remote changed' });
api.recoverDraft = async conflict => { conflictSeen = conflict; return { ok: true, data: 'restore' }; };
await run("runAction(() => openFile({ path: '/auto.md', name: 'auto.md' }))");
assert.equal(conflictSeen, true);
assert.equal(get('editor').value, 'recovered draft');
assert.equal(run('state.savedContent'), 'remote changed');
run('clearTimeout(autoSaveTimer)');
run("state.connectionKey = 'server-b/user'");
assert.equal(run("readDraft('/auto.md')"), null, 'drafts are isolated by connection');

// Moving a folder updates its open document and all descendant drafts.
run("state.connectionKey = 'server-a/user'; state.currentDir = '/notes'; state.currentFile = { path: '/notes/a.md', name: 'a.md' }; state.savedContent = 'old'; editorEl.value = 'draft'; persistDraft(); localStorage.setItem(draftKey('/notes/b.md'), JSON.stringify({ content: 'other draft', base: 'old' }));");
api.rename = async () => ({ ok: true });
api.list = async () => ({ ok: true, data: [] });
await run("runAction(() => relocateItem({ path: '/notes/', name: 'notes', type: 'directory' }, '/archive/notes'))");
assert.equal(run('state.currentFile.path'), '/archive/notes/a.md');
assert.equal(run('state.currentDir'), '/archive/notes');
assert.equal(run("readDraft('/archive/notes/b.md').content"), 'other draft');
assert.equal(run("readDraft('/notes/b.md')"), null);
run('clearTimeout(autoSaveTimer)');
api.rename = async () => ({ ok: false, error: 'conflict' });
await run("runAction(() => relocateItem({ path: '/archive/notes', name: 'notes', type: 'directory' }, '/exists'))");
assert.equal(run('state.currentFile.path'), '/archive/notes/a.md', 'failed move preserves open path');
api.confirmDelete = async () => ({ ok: true, data: false });
let deletes = 0;
api.remove = async () => { deletes++; return { ok: true }; };
await run("runAction(() => deleteItem({ path: '/archive/notes', name: 'notes', type: 'directory' }))");
assert.equal(deletes, 0, 'cancelled deletion does not contact server');
api.confirmDelete = async () => ({ ok: true, data: true });
await run("runAction(() => deleteItem({ path: '/archive/notes', name: 'notes', type: 'directory' }))");
assert.equal(run('state.currentFile'), null);
assert.equal(run("readDraft('/archive/notes/b.md')"), null);
assert.equal(run('autoSaveTimer && state.currentFile'), null);
run("state.currentFile = { path: '/test.md' }; state.savedContent = ''; editorEl.value = 'draft';");

// A local storage failure must not be presented as a safely retained draft.
localStorage.setItem = () => { throw new Error('quota'); };
run('persistDraft()');
assert.equal(run('state.draftError'), true);
assert.match(get('status').textContent, /本地草稿保存失败/);
console.log('Renderer regression tests passed (auto-save, recovery, offline, connection isolation)');


// Startup connects saved credentials once; opening settings only restores fields.
run("state.currentFile = null; state.connected = false; state.busy = false; clearTimeout(autoSaveTimer);");
api.loadConnection = async () => ({ ok: true, data: { url: 'https://example.test/dav/', username: 'test', password: 'secret' } });
let connects = 0;
api.connect = async () => { connects++; return { ok: true, data: { root: [] } }; };
await run('restoreConnection(true)');
assert.equal(connects, 1);
assert.equal(run('state.connected'), true);
run('state.connected = false');
await run('restoreConnection()');
assert.equal(connects, 1, 'opening settings must not reconnect automatically');
api.connect = async () => ({ ok: false, error: 'offline' });
await run('restoreConnection(true)');
assert.equal(run('state.connected'), false);
assert.equal(get('connBtn').disabled, false, 'manual retry remains available');
assert.match(get('status').textContent, /连接失败/);
console.log('Automatic connection checks passed');
