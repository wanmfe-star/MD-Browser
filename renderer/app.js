// 渲染进程主逻辑
'use strict';

const $ = (id) => document.getElementById(id);

const connUrl = $('connUrl'), connUser = $('connUser'), connPass = $('connPass');
const connBtn = $('connBtn'), discBtn = $('discBtn'), statusEl = $('status');
const crumbEl = $('crumb'), filelistEl = $('filelist');
const newFileBtn = $('newFile'), newDirBtn = $('newDir'), refreshBtn = $('refresh');
const docNameEl = $('docName'), dirtyEl = $('dirty');
const renameBtn = $('renameBtn'), deleteBtn = $('deleteBtn');
const editorEl = $('editor'), previewEl = $('preview');
const editorPane = $('editorPane'), previewPane = $('previewPane');
const viewSeg = $('viewMode');

const state = {
  connected: false,
  currentDir: '/',
  entries: [],
  currentFile: null, // { path, name }
  savedContent: '',
  viewMode: 'split',
  busy: false,
  connectionKey: '',
  saveError: false,
  saving: false,
  draftError: false,
  pdfUrl: null,
};

function isDirty() {
  return !!state.currentFile && state.currentFile.kind !== 'pdf' && editorEl.value !== state.savedContent;
}

async function canDiscard() {
  if (window.pdfAnnotations?.dirty()) {
    const result = await window.mdAPI.confirmAnnotations();
    if (!result.ok || !result.data) return false;
  }
  if (!isDirty()) return true;
  await save();
  if (!isDirty()) return true;
  const localSaved = persistDraft();
  const res = await window.mdAPI.confirmDiscard(localSaved);
  return res.ok && res.data === true;
}

function syncControls(action) {
  setConnUI(state.connected);
  connBtn.disabled = state.busy || state.connected;
  discBtn.disabled = state.busy || !state.connected;
  [connUrl, connUser, connPass].forEach(el => { el.disabled = state.busy || state.connected; });
  [newFileBtn, newDirBtn, refreshBtn].forEach(el => { el.disabled = state.busy || !state.connected; });
  $('importFile').disabled = state.busy || !state.connected;
  $('exportPdf').disabled = state.busy || !state.currentFile || state.currentFile.kind === 'pdf';
  [renameBtn, deleteBtn].forEach(el => { el.disabled = state.busy || !state.connected || !state.currentFile; });
  editorEl.readOnly = !state.currentFile || state.currentFile.kind === 'pdf' || (state.busy && action !== save);
  viewSeg.querySelectorAll('button').forEach(button => { button.disabled = state.currentFile?.kind === 'pdf'; });
  $('formatToolbar').querySelectorAll('button, select, input').forEach(button => { button.disabled = editorEl.readOnly; });
}

async function runAction(action) {
  if (state.busy) return;
  state.busy = true;
  syncControls(action);
  try {
    await action();
  } catch (err) {
    setStatus('操作失败：' + (err.message || String(err)), 'error');
  } finally {
    state.busy = false;
    syncControls();
    if (isDirty() && !state.saveError) scheduleSave();
  }
}

// ---------- 工具 ----------
function joinPath(base, name) {
  base = base.replace(/\/+$/, '');
  if (base === '') base = '';
  return (base || '') + '/' + name;
}
function parentPath(p) {
  const t = p.replace(/\/+$/, '');
  if (t === '') return '/';
  const i = t.lastIndexOf('/');
  return i <= 0 ? '/' : t.slice(0, i + 1);
}
function isMarkdown(name) {
  return /\.(md|markdown|mdown|mkd)$/i.test(name);
}
function fmtSize(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
  if ($('connectionDialog').open) $('connectionMessage').textContent = kind === 'error' ? msg : '';
}

// ---------- 连接 ----------
async function doConnect() {
  credentialRevision++;
  if (!(await canDiscard())) return;
  const cfg = {
    url: connUrl.value.trim(),
    username: connUser.value.trim(),
    password: connPass.value,
  };
  if (!cfg.url) { setStatus('请先填写 WebDAV 地址', 'error'); return; }
  const address = new URL(cfg.url);
  if (!/^https?:$/.test(address.protocol) || address.username || address.password) {
    setStatus('请使用 HTTP(S) 地址，并在下方单独填写账号密码', 'error'); return;
  }
  setStatus('连接中…');
  const res = await window.mdAPI.connect(cfg);
  if (res.ok) {
    state.connected = true;
    state.connectionKey = JSON.stringify([new URL(cfg.url).href.replace(/\/+$/, ''), cfg.username]);
    try { localStorage.setItem('md-browser.connection', JSON.stringify({ url: cfg.url, username: cfg.username })); } catch {}
    $('connectionName').textContent = /jianguoyun/.test(cfg.url) ? '坚果云' : new URL(cfg.url).hostname;
    $('connectionDialog').close();
    state.currentDir = '/';
    state.currentFile = null;
    state.savedContent = '';
    editorEl.value = '';
    docNameEl.textContent = '你的下一页，从这里开始';
    updateEditorUI(false);
    setStatus(res.data.credentialWarning || '已连接，密码已加密保存', res.data.credentialWarning ? 'error' : 'ok');
    setConnUI(true);
    state.entries = res.data.root;
    renderCrumb();
    renderList();
  } else {
    setStatus('连接失败：' + res.error, 'error');
  }
}

async function doDisconnect() {
  if (!(await canDiscard())) return;
  const res = await window.mdAPI.disconnect();
  if (!res.ok) { setStatus('断开失败：' + res.error, 'error'); return; }
  clearTimeout(autoSaveTimer);
  state.connected = false;
  state.currentDir = '/';
  state.entries = [];
  state.currentFile = null;
  state.savedContent = '';
  connPass.value = '';
  updateEditorUI(false);
  renderCrumb();
  renderList();
  setStatus('未连接');
  setConnUI(false);
}

function setConnUI(connected) {
  $('connectionState').textContent = connected ? '已连接' : '未连接 · 点击设置';
  $('sidebarStatus').textContent = connected ? 'WebDAV 已连接' : '尚未连接 WebDAV';
  $('connectionDot').classList.toggle('online', connected);
  connBtn.disabled = connected;
  discBtn.disabled = !connected;
  connUrl.disabled = connected;
  connUser.disabled = connected;
  connPass.disabled = connected;
}

// ---------- 目录浏览 ----------
async function refreshDir() {
  if (!state.connected) return;
  const res = await window.mdAPI.list(state.currentDir);
  if (!res.ok) {
    setStatus('读取目录失败：' + res.error, 'error');
    renderList();
    return;
  }
  state.entries = res.data;
  renderCrumb();
  renderList();
}

function navigate(dir) {
  return runAction(async () => {
    const previous = state.currentDir;
    state.currentDir = dir;
    const res = await window.mdAPI.list(dir);
    if (!res.ok) { state.currentDir = previous; setStatus('读取目录失败：' + res.error, 'error'); return; }
    state.entries = res.data;
    renderCrumb(); renderList();
  });
}

function renderCrumb() {
  crumbEl.innerHTML = '';
  const parts = state.currentDir.split('/').filter(Boolean);
  const root = document.createElement('button');
  root.textContent = '我的文档'; root.addEventListener('click', () => navigate('/'));
  crumbEl.appendChild(root);
  let acc = '';
  parts.forEach(part => {
    acc += '/' + part;
    const path = acc;
    const sep = document.createElement('span'); sep.textContent = '/'; crumbEl.appendChild(sep);
    const button = document.createElement('button'); button.textContent = part;
    button.addEventListener('click', () => navigate(path)); crumbEl.appendChild(button);
  });
  $('directoryLabel').textContent = parts.length ? parts.join(' / ') : '我的文档';
}

function fileIcon(folder) {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + (folder ? 'M3 7V5h6l2 2h10v13H3Z' : 'M6 3h8l4 4v14H6Z M14 3v5h4 M9 12h6 M9 16h6') + '"/></svg>';
}
function renderList() {
  filelistEl.innerHTML = '';
  if (!state.connected) { filelistEl.innerHTML = '<li class="empty">尚未连接<br>连接后，你的文档会显示在这里</li>'; return; }
  if (state.currentDir !== '/') {
    const li = document.createElement('li'); const button = document.createElement('button');
    button.className = 'file-row'; button.textContent = '↰  返回上级';
    button.addEventListener('click', () => navigate(parentPath(state.currentDir)));
    li.appendChild(button); filelistEl.appendChild(li);
  }
  const sorted = [...state.entries].sort((a,b) => a.type !== b.type ? (a.type === 'directory' ? -1 : 1) : a.name.localeCompare(b.name,'zh-CN'));
  sorted.forEach(item => {
    const folder = item.type === 'directory';
    const li = document.createElement('li'); const button = document.createElement('button');
    button.className = 'file-row' + (state.currentFile?.path === item.path ? ' active' : '');
    button.innerHTML = fileIcon(folder) + '<span class="name">' + escapeHtml(item.name) + '</span>' + (folder ? '<span class="meta">›</span>' : /\.pdf$/i.test(item.name) ? '<span class="file-pdf-badge">PDF</span>' : '');
    button.title = item.name;
    button.addEventListener('contextmenu', e => { e.preventDefault(); runAction(() => showFileMenu(item)); });
    button.addEventListener('click', () => folder ? navigate(item.path) : runAction(() => openFile(item)));
    li.appendChild(button); filelistEl.appendChild(li);
  });
  if (!sorted.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = '此目录为空'; filelistEl.appendChild(li); }
}

// ---------- 打开 / 编辑 / 保存 ----------
async function openFile(item, discardApproved = false) {
  if (!discardApproved && !(await canDiscard())) return;
  if (/\.pdf$/i.test(item.name)) return openPDF(item);
  const res = await window.mdAPI.read(item.path);
  if (!res.ok) {
    setStatus('读取文件失败：' + res.error, 'error');
    return;
  }
  const draft = readDraft(item.path);
  let content = res.data;
  if (draft && draft.content !== res.data) {
    const choice = await window.mdAPI.recoverDraft(draft.base !== res.data);
    if (!choice.ok || choice.data === 'cancel') return;
    if (choice.data === 'restore') content = draft.content;
    else removeDraft(item.path);
  } else if (draft) removeDraft(item.path);
  clearTimeout(autoSaveTimer);
  state.saveError = false;
  releasePDF();
  state.currentFile = { path: item.path, name: item.name };
  applyViewMode();
  state.savedContent = res.data;
  editorEl.value = content;
  docNameEl.textContent = item.name;
  renderPreview();
  updateDirty();
  updateEditorUI(true);
  setStatus(content !== res.data ? '已恢复本地草稿，稍后自动保存到远程' : '已打开：' + item.name);
  updateMetrics(); renderList();
  if (isDirty()) { persistDraft(); scheduleSave(); }
}

function releasePDF() {
  window.pdfAnnotations?.clear();
  if (state.pdfUrl) {
    $('pdfViewer').src = 'about:blank';
    URL.revokeObjectURL(state.pdfUrl);
    state.pdfUrl = null;
  }
}
async function openPDF(item) {
  setStatus('正在加载 PDF…');
  const res = await window.mdAPI.readPDF(item.path);
  if (!res.ok) { setStatus('PDF 加载失败：' + res.error, 'error'); return; }
  const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
  releasePDF();
  clearTimeout(autoSaveTimer); clearTimeout(previewTimer);
  state.pdfUrl = url;
  window.pdfAnnotations?.load(res.data);
  state.currentFile = { path: item.path, name: item.name, kind: 'pdf' };
  state.savedContent = ''; state.saveError = false;
  editorEl.value = '';
  docNameEl.textContent = item.name;
  $('pdfViewer').src = url;
  applyViewMode(); updateDirty(); renderList();
  $('wordCount').textContent = fmtSize(res.data.byteLength);
  $('cursorPosition').textContent = 'PDF · 阅读与标注';
  try { await window.pdfAnnotations?.open(); }
  catch (err) { setStatus('标注阅读器加载失败，已保留原版预览：' + err.message, 'error'); return; }
  setStatus('已打开 PDF：' + item.name, 'ok');
}

function renderPreview() {
  if (state.currentFile?.kind === 'pdf') return;
  const text = editorEl.value;
  if (!text.trim()) {
    previewEl.innerHTML = '<div class="placeholder">（空文档）</div>';
    return;
  }
  let html;
  try {
    html = marked.parse(text);
  } catch (e) {
    html = '<p>渲染出错：' + escapeHtml(String(e)) + '</p>';
  }
  if (window.DOMPurify) {
    html = window.sanitizeMarkdownHTML ? window.sanitizeMarkdownHTML(html) : DOMPurify.sanitize(html);
  }
  previewEl.innerHTML = html;
}

let autoSaveTimer = null;
function draftKey(path = state.currentFile?.path) {
  return 'md-browser.draft:' + JSON.stringify([state.connectionKey, path]);
}
function readDraft(path) {
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey(path)));
    return draft && typeof draft.content === 'string' && typeof draft.base === 'string' ? draft : null;
  } catch { return null; }
}
function removeDraft(path) {
  try { localStorage.removeItem(draftKey(path)); } catch {}
}
function persistDraft() {
  if (!state.currentFile || state.currentFile.kind === 'pdf') return true;
  try {
    if (isDirty()) localStorage.setItem(draftKey(), JSON.stringify({ content: editorEl.value, base: state.savedContent, updatedAt: Date.now() }));
    else localStorage.removeItem(draftKey());
    state.draftError = false;
    return true;
  } catch {
    state.draftError = true;
    setStatus('本地草稿保存失败，请保持窗口打开并重试远程保存', 'error');
    return false;
  }
}
function scheduleSave() {
  clearTimeout(autoSaveTimer);
  if (state.connected && isDirty()) autoSaveTimer = setTimeout(() => runAction(save), 2000);
}
function updateDirty() {
  dirtyEl.disabled = !state.saveError;
  dirtyEl.className = 'save-status' + (state.saveError ? ' error' : isDirty() ? ' pending' : '');
  dirtyEl.textContent = !state.currentFile ? '' : state.currentFile.kind === 'pdf' ? 'PDF 原文件' : state.saving ? '保存中…' : state.saveError ? '保存失败 · 点击重试' : isDirty() ? '待保存' : '✓ 已保存';
}
async function save() {
  if (state.currentFile?.kind === 'pdf') return window.pdfAnnotations?.save();
  clearTimeout(autoSaveTimer);
  if (!state.currentFile || !state.connected || !isDirty()) return;
  const file = state.currentFile;
  const content = editorEl.value;
  persistDraft();
  state.saving = true; updateDirty();
  try {
    const res = await window.mdAPI.write(file.path, content);
    if (!res.ok) throw new Error(res.error);
    if (state.currentFile !== file) return;
    state.savedContent = content;
    state.saveError = false;
    const localOk = persistDraft();
    if (localOk) setStatus(isDirty() ? '仍有新修改，稍后自动保存' : '已保存到远程', 'ok');
  } catch (err) {
    state.saveError = true;
    setStatus('远程保存失败：' + err.message + (state.draftError ? '；本地草稿也未能保存，请勿关闭' : '；已保留本地草稿'), 'error');
  } finally {
    state.saving = false; updateDirty();
  }
}
function updateMetrics() {
  const text = editorEl.value;
  $('lineNumbers').textContent = Array.from({ length: text.split('\n').length }, (_,i) => i + 1).join('\n');
  $('lineNumbers').scrollTop = editorEl.scrollTop;
  $('wordCount').textContent = text.replace(/\s/g, '').length + ' 字';
  const before = text.slice(0, editorEl.selectionStart || 0).split('\n');
  $('cursorPosition').textContent = 'Ln ' + before.length + ', Col ' + (before[before.length - 1].length + 1);
}

function updateEditorUI(hasFile) {
  renameBtn.disabled = !hasFile;
  deleteBtn.disabled = !hasFile;
  if (!hasFile) {
    releasePDF();
    applyViewMode();
    clearTimeout(previewTimer);
    clearTimeout(autoSaveTimer);
    state.saveError = false;
    editorEl.value = '';
    previewEl.innerHTML = '<div class="placeholder">选择或新建一个 Markdown 文件后，这里会显示渲染结果。</div>';
    docNameEl.textContent = '你的下一页，从这里开始';
    dirtyEl.textContent = '';
    updateMetrics();
  }
}

// ---------- 视图模式 ----------
let previewFontSize = 14;
try {
  const savedSize = Number(localStorage.getItem('md-browser.previewFontSize'));
  if (Number.isInteger(savedSize) && savedSize >= 12 && savedSize <= 28) previewFontSize = savedSize;
} catch {}

function setPreviewFontSize(size, remember = true) {
  previewFontSize = Math.max(12, Math.min(28, size));
  previewEl.style.fontSize = previewFontSize + 'px';
  $('previewFontReset').textContent = previewFontSize + 'px';
  $('previewFontDown').disabled = previewFontSize <= 12;
  $('previewFontUp').disabled = previewFontSize >= 28;
  if (remember) {
    try { localStorage.setItem('md-browser.previewFontSize', String(previewFontSize)); } catch {}
  }
}
$('previewFontDown').addEventListener('click', () => setPreviewFontSize(previewFontSize - 2));
$('previewFontUp').addEventListener('click', () => setPreviewFontSize(previewFontSize + 2));
$('previewFontReset').addEventListener('click', () => setPreviewFontSize(14));
setPreviewFontSize(previewFontSize, false);

let editorFontSize = 13;
try {
  const savedSize = Number(localStorage.getItem('md-browser.editorFontSize'));
  if (Number.isInteger(savedSize) && savedSize >= 12 && savedSize <= 28) editorFontSize = savedSize;
} catch {}

function setEditorFontSize(size, remember = true) {
  editorFontSize = Math.max(12, Math.min(28, size));
  const lineHeight = Math.round(editorFontSize * 27 / 13) + 'px';
  editorEl.style.fontSize = editorFontSize + 'px';
  editorEl.style.lineHeight = lineHeight;
  $('lineNumbers').style.fontSize = (editorFontSize - 1) + 'px';
  $('lineNumbers').style.lineHeight = lineHeight;
  $('lineNumbers').scrollTop = editorEl.scrollTop;
  if (remember) {
    try { localStorage.setItem('md-browser.editorFontSize', String(editorFontSize)); } catch {}
  }
}
setEditorFontSize(editorFontSize, false);

function enableControlZoom(pane, getSize, setSize) {
  let accumulated = 0, lastWheelAt = 0;
  pane.addEventListener('wheel', event => {
    if (!event.ctrlKey) { accumulated = 0; return; }
    event.preventDefault();
    event.stopPropagation();
    if (!event.deltaY) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pane.clientHeight : 1);
    const now = Date.now();
    if (now - lastWheelAt > 250 || Math.sign(delta) !== Math.sign(accumulated)) accumulated = 0;
    lastWheelAt = now;
    accumulated += delta;
    // Accumulate small trackpad movements to avoid jumping through sizes.
    if (Math.abs(accumulated) < 40) return;
    setSize(getSize() + (accumulated < 0 ? 1 : -1));
    accumulated = 0;
  }, { passive: false });
}
enableControlZoom(editorPane, () => editorFontSize, setEditorFontSize);
enableControlZoom(previewPane, () => previewFontSize, setPreviewFontSize);

function applyViewMode() {
  const pdf = state.currentFile?.kind === 'pdf';
  $('markdownPanes').style.display = pdf ? 'none' : '';
  $('pdfPane').hidden = !pdf;
  viewSeg.style.display = pdf ? 'none' : '';
  $('textEncoding').hidden = pdf;
  $('saveHint').hidden = pdf;
  const m = state.viewMode;
  if (m === 'split') {
    editorPane.style.display = '';
    previewPane.style.display = '';
    editorPane.style.flex = '1';
    previewPane.style.flex = '1';
  } else if (m === 'edit') {
    editorPane.style.display = '';
    previewPane.style.display = 'none';
  } else {
    editorPane.style.display = 'none';
    previewPane.style.display = '';
  }
  viewSeg.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === m);
  });
}

// ---------- 新建 / 重命名 / 删除 ----------
function promptName(title, def) {
  const dialog = $('nameDialog');
  const input = $('nameInput');
  $('nameTitle').textContent = title;
  input.value = def || '';
  input.setCustomValidity('');
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok' ? input.value.trim() : null);
    }, { once: true });
    dialog.showModal();
    input.focus();
    input.select();
  });
}

async function createFile() {
  if (!state.connected) return;
  if (!(await canDiscard())) return;
  const name = await promptName('新建文件（以 .md 结尾）：', '未命名.md');
  if (!name) return;
  const p = joinPath(state.currentDir, name);
  const res = await window.mdAPI.create(p, '# ' + name.replace(/\.(md|markdown)$/i, '') + '\n\n');
  if (res.ok) {
    await refreshDir();
    // 直接打开新文件
    await openFile({ path: p, name, type: 'file' }, true);
    setStatus('已新建：' + name, 'ok');
  } else {
    setStatus('新建失败：' + res.error, 'error');
  }
}

async function createDir() {
  if (!state.connected) return;
  const name = await promptName('新建文件夹名：');
  if (!name) return;
  const p = joinPath(state.currentDir, name);
  const res = await window.mdAPI.mkdir(p);
  if (res.ok) {
    await refreshDir();
    setStatus('已新建文件夹：' + name, 'ok');
  } else {
    setStatus('新建文件夹失败：' + res.error, 'error');
  }
}

async function importDocument() {
  if (!state.connected || !(await canDiscard())) return;
  setStatus('选择文档：PDF 保留原格式，Word / 文本转为 Markdown…');
  const result = await window.mdAPI.importDocument();
  if (!result.ok) { setStatus('导入失败：' + result.error, 'error'); return; }
  if (!result.data) { setStatus('已取消导入'); return; }
  const converted = result.data;
  const pdf = converted.kind === 'pdf';
  let suggested = converted.name;
  while (true) {
    const name = await promptName(pdf ? '导入 PDF（保留原格式）：' : '导入为 Markdown 文件：', suggested);
    if (!name) { setStatus('已取消导入'); return; }
    const extension = pdf ? '.pdf' : '.md';
    const finalName = name.toLowerCase().endsWith(extension) ? name : name + extension;
    const target = joinPath(state.currentDir, finalName);
    const exists = await window.mdAPI.exists(target);
    if (!exists.ok) { setStatus('检查文件名失败：' + exists.error, 'error'); return; }
    if (exists.data) {
      setStatus('同名文件已存在，请更换名称', 'error');
      suggested = finalName.slice(0, -extension.length) + '（导入）' + extension;
      continue;
    }
    const saved = pdf ? await window.mdAPI.createPDF(target, converted.bytes) : await window.mdAPI.create(target, converted.content);
    if (!saved.ok) { setStatus('上传失败：' + saved.error + '；原始本地文件不受影响', 'error'); return; }
    await refreshDir();
    await openFile({ path: target, name: finalName, type: 'file' }, true);
    const message = '已导入：' + finalName + (converted.warnings.length ? ' · ' + converted.warnings.join(' ') : '');
    setStatus(message, 'ok'); statusEl.title = message;
    if (converted.warnings.length) {
      $('importWarningsText').textContent = converted.warnings.join('\n');
      $('importWarnings').showModal();
    }
    return;
  }
}

function normalizedPath(path) { return path.replace(/\/+$/, '') || '/'; }
function containsPath(parent, child) {
  parent = normalizedPath(parent); child = normalizedPath(child);
  return parent === child || child.startsWith(parent === '/' ? '/' : parent + '/');
}

// Migrate every draft under a renamed/moved folder, including unopened documents.
function updateItemDrafts(from, to) {
  const updates = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key.startsWith('md-browser.draft:')) continue;
      const [connection, path] = JSON.parse(key.slice('md-browser.draft:'.length));
      if (connection === state.connectionKey && typeof path === 'string' && containsPath(from, path)) {
        updates.push({ key, path, value: localStorage.getItem(key) });
      }
    }
    // Keep original copies if a destination write fails.
    if (to) for (const draft of updates) {
      localStorage.setItem(draftKey(to + draft.path.slice(from.length)), draft.value);
    }
    for (const draft of updates) localStorage.removeItem(draft.key);
    return true;
  } catch { return false; }
}

async function showFileMenu(item) {
  if (!state.connected) return;
  const choice = await window.mdAPI.fileMenu(item.type === 'directory');
  if (!choice.ok) { setStatus(choice.error, 'error'); return; }
  if (choice.data === 'rename') await renameItem(item);
  if (choice.data === 'delete') await deleteItem(item);
  if (choice.data === 'move') {
    const target = await chooseMoveDirectory(item);
    if (target !== null) await relocateItem(item, joinPath(target, item.name));
  }
  if (choice.data === 'open') {
    if (item.type === 'directory') { state.currentDir = item.path; await refreshDir(); }
    else await openFile(item);
  }
}

async function renameItem(item) {
  let name = await promptName('重命名为：', item.name);
  if (name && /\.pdf$/i.test(item.name) && !/\.pdf$/i.test(name)) name += '.pdf';
  if (!name || name === item.name) return;
  await relocateItem(item, joinPath(parentPath(item.path), name));
}

async function relocateItem(item, to) {
  const from = normalizedPath(item.path);
  to = normalizedPath(to);
  if (containsPath(from, to)) { setStatus('不能移动到自身或子目录', 'error'); return; }
  const affectsOpen = state.currentFile && containsPath(from, state.currentFile.path);
  if (affectsOpen && isDirty()) persistDraft();
  const res = await window.mdAPI.rename(from, to);
  if (!res.ok) { setStatus('移动或重命名失败：' + res.error, 'error'); return; }
  const draftsOk = updateItemDrafts(from, to);
  if (affectsOpen) {
    state.currentFile.path = to + state.currentFile.path.slice(from.length);
    state.currentFile.name = state.currentFile.path.split('/').pop();
    docNameEl.textContent = state.currentFile.name;
    persistDraft();
  }
  if (containsPath(from, state.currentDir)) state.currentDir = to + normalizedPath(state.currentDir).slice(from.length);
  await refreshDir();
  setStatus(draftsOk ? '已移动至 ' + to : '远程操作已完成，本地草稿迁移失败，原草稿仍保留', draftsOk ? 'ok' : 'error');
}

async function deleteItem(item) {
  const from = normalizedPath(item.path);
  const affectsOpen = state.currentFile && containsPath(from, state.currentFile.path);
  const confirm = await window.mdAPI.confirmDelete({ name: item.name, folder: item.type === 'directory', dirty: !!affectsOpen && (isDirty() || !!window.pdfAnnotations?.dirty()) });
  if (!confirm.ok || !confirm.data) return;
  const res = await window.mdAPI.remove(from);
  if (!res.ok) { setStatus('删除失败：' + res.error, 'error'); return; }
  const draftsOk = updateItemDrafts(from, null);
  if (affectsOpen) {
    clearTimeout(autoSaveTimer);
    state.currentFile = null;
    state.savedContent = '';
    updateEditorUI(false);
  }
  if (containsPath(from, state.currentDir)) state.currentDir = parentPath(from);
  await refreshDir();
  setStatus(draftsOk ? '已删除：' + item.name : '远程项目已删除，但本地草稿清理失败', draftsOk ? 'ok' : 'error');
}

async function renameCurrent() {
  if (state.currentFile) await renameItem({ ...state.currentFile, type: 'file' });
}
async function deleteCurrent() {
  if (state.currentFile) await deleteItem({ ...state.currentFile, type: 'file' });
}

function chooseMoveDirectory(item) {
  const dialog = $('moveDialog');
  const confirm = $('moveConfirm'), up = $('moveUp');
  let current = '/', request = 0, finished = false;
  $('moveItemName').textContent = '选择「' + item.name + '」的目标文件夹';
  return new Promise(resolve => {
    function finish(value) {
      if (finished) return;
      finished = true; request++;
      dialog.removeEventListener('cancel', cancel);
      dialog.close(); resolve(value);
    }
    function cancel(e) { if (e) e.preventDefault(); finish(null); }
    async function browse(dir) {
      const version = ++request;
      confirm.disabled = true; up.disabled = true;
      $('moveMessage').textContent = '正在读取目录…';
      try {
        const res = await window.mdAPI.list(dir);
        if (version !== request || finished) return;
        if (!res.ok) throw new Error(res.error);
        current = normalizedPath(dir);
        $('movePath').textContent = current;
        $('moveMessage').textContent = '';
        $('moveFolders').innerHTML = '';
        const folders = res.data.filter(entry => entry.type === 'directory').sort((a,b) => a.name.localeCompare(b.name, 'zh-CN'));
        for (const folder of folders) {
          const button = document.createElement('button');
          button.textContent = folder.name + '  ›';
          button.disabled = item.type === 'directory' && containsPath(item.path, folder.path);
          button.addEventListener('click', () => browse(folder.path));
          $('moveFolders').appendChild(button);
        }
        if (!folders.length) $('moveFolders').textContent = '此目录下没有子文件夹';
        confirm.disabled = current === normalizedPath(parentPath(item.path)) || containsPath(item.path, current);
      } catch (error) {
        if (version === request && !finished) $('moveMessage').textContent = '读取失败：' + error.message;
      } finally {
        if (version === request && !finished) up.disabled = current === '/';
      }
    }
    confirm.onclick = () => { if (!confirm.disabled) finish(current); };
    up.onclick = () => browse(parentPath(current));
    $('moveCancel').onclick = () => finish(null);
    dialog.addEventListener('cancel', cancel);
    dialog.showModal(); browse('/');
  });
}

// ---------- 转义 ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------- 事件绑定 ----------
async function exportCurrentPDF() {
  if (!state.currentFile || state.currentFile.kind === 'pdf') return;
  setStatus('正在整理 PDF 排版…');
  const result = await window.mdAPI.exportPDF({
    title: state.currentFile.name.replace(/\.(md|markdown|mdown|mkd)$/i, ''),
    html: window.sanitizeMarkdownHTML(marked.parse(editorEl.value)),
  });
  if (!result.ok) { setStatus('导出失败：' + result.error, 'error'); return; }
  if (!result.data) { setStatus('已取消导出'); return; }
  const message = 'PDF 已导出：' + result.data.path + (result.data.missingImages ? '；有 ' + result.data.missingImages + ' 张图片未加载，已在 PDF 中标注' : '');
  setStatus(message, result.data.missingImages ? 'error' : 'ok');
  statusEl.title = message;
}
[[discBtn, doDisconnect], [refreshBtn, refreshDir],
 [$('exportPdf'), exportCurrentPDF],
 [$('importFile'), importDocument],
 [newFileBtn, createFile], [newDirBtn, createDir], [dirtyEl, save],
 [renameBtn, renameCurrent], [deleteBtn, deleteCurrent]].forEach(([button, action]) => {
  button.addEventListener('click', () => { $('moreMenu').open = false; runAction(action); });
});

$('nameForm').addEventListener('submit', (event) => {
  if (event.submitter && event.submitter.value === 'cancel') return;
  const input = $('nameInput');
  const name = input.value.trim();
  if (!name || name === '.' || name === '..' || /[\\/\u0000-\u001f\u007f]/.test(name)) {
    event.preventDefault();
    input.setCustomValidity('请输入有效名称，不能包含斜杠或控制字符，也不能是 . 或 ..');
    input.reportValidity();
  }
});
$('nameInput').addEventListener('input', () => $('nameInput').setCustomValidity(''));

let credentialRevision = 0;
async function restoreConnection(autoConnect = false) {
  const revision = ++credentialRevision;
  const before = [connUrl.value, connUser.value, connPass.value];
  try {
    const res = await window.mdAPI.loadConnection();
    if (!res.ok) { setStatus('无法读取已保存密码：' + res.error, 'error'); return; }
    if (revision !== credentialRevision || !res.data || state.connected || state.busy || before.some((value, i) => value !== [connUrl.value, connUser.value, connPass.value][i])) return;
    connUrl.value = res.data.url;
    connUser.value = res.data.username;
    connPass.value = res.data.password;
    if (autoConnect) await runAction(doConnect);
  } catch { setStatus('无法读取已保存密码，请手动输入', 'error'); }
}
function showConnection() {
  $('connectionMessage').textContent = '';
  $('connectionDialog').showModal();
  if (!state.connected && !connPass.value) restoreConnection();
}
$('forgetPassword').addEventListener('click', () => runAction(async () => {
  credentialRevision++;
  const res = await window.mdAPI.clearConnection();
  if (!res.ok) { setStatus('清除失败：' + res.error, 'error'); return; }
  connPass.value = '';
  setStatus('已清除本机保存的密码', 'ok');
  $('connectionMessage').textContent = '已清除保存的密码；当前连接不受影响。';
}));
[connUrl, connUser].forEach(input => input.addEventListener('input', () => { credentialRevision++; connPass.value = ''; }));
$('connectionSettings').addEventListener('click', showConnection);
$('welcomeConnect').addEventListener('click', showConnection);
$('closeConnection').addEventListener('click', () => $('connectionDialog').close());
$('connectionForm').addEventListener('submit', e => { e.preventDefault(); runAction(doConnect); });
editorEl.addEventListener('scroll', () => { $('lineNumbers').scrollTop = editorEl.scrollTop; });
editorEl.addEventListener('click', updateMetrics);
editorEl.addEventListener('keyup', updateMetrics);
window.addEventListener('online', () => { if (isDirty()) runAction(save); });
try {
  const remembered = JSON.parse(localStorage.getItem('md-browser.connection'));
  if (remembered) { connUrl.value = remembered.url || ''; connUser.value = remembered.username || ''; }
} catch {}
let closeApproved = false;
window.addEventListener('beforeunload', (event) => {
  if (closeApproved || (!state.busy && !isDirty() && !window.pdfAnnotations?.dirty())) return;
  persistDraft();
  event.preventDefault();
  event.returnValue = false;
  if (state.busy) {
    setStatus('操作进行中，请完成后再关闭窗口');
    return;
  }
  runAction(async () => {
    if (await canDiscard()) {
      closeApproved = true;
      window.close();
    }
  });
});

let previewTimer = null;
editorEl.addEventListener('input', () => {
  state.saveError = false;
  persistDraft();
  updateDirty();
  updateMetrics();
  scheduleSave();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 200);
});

function applyFormat(kind) {
  if (editorEl.readOnly || !state.currentFile) return;
  const edit = window.mdFormat(editorEl.value, editorEl.selectionStart, editorEl.selectionEnd, kind);
  if (!edit) return;
  const top = editorEl.scrollTop;
  editorEl.focus();
  editorEl.setSelectionRange(edit.start, edit.end);
  // Chromium's text insertion keeps formatting in the native undo history.
  if (!document.execCommand('insertText', false, edit.value)) {
    editorEl.setRangeText(edit.value, edit.start, edit.end, 'end');
    editorEl.dispatchEvent(new Event('input', { bubbles: true }));
  }
  editorEl.setSelectionRange(edit.selectStart, edit.selectEnd);
  editorEl.scrollTop = top;
  updateMetrics();
}
$('formatToolbar').addEventListener('mousedown', e => {
  if (e.target.closest('button')) e.preventDefault();
});
$('formatToolbar').addEventListener('click', e => {
  const button = e.target.closest('button[data-format]');
  if (button && !button.disabled) applyFormat(button.dataset.format);
});

$('textFont').addEventListener('change', e => { if (e.target.value) applyFormat('font:' + e.target.value); e.target.value = ''; });
$('textSize').addEventListener('change', e => { if (e.target.value) applyFormat('size:' + e.target.value); e.target.value = ''; });
$('textColor').addEventListener('change', e => applyFormat('color:' + e.target.value));

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.target === editorEl) {
    const kind = { b: 'bold', i: 'italic', k: 'link' }[e.key.toLowerCase()];
    if (kind) { e.preventDefault(); applyFormat(kind); return; }
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    runAction(save);
  }
});

viewSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (!btn) return;
  state.viewMode = btn.dataset.mode;
  applyViewMode();
});

// 预览内链接：外部链接用系统浏览器打开
previewEl.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href') || '';
  if (!href.startsWith('#')) e.preventDefault();
  if (/^https?:\/\//i.test(href)) {
    e.preventDefault();
    window.mdAPI.openExternal(href);
  }
});

// ---------- 初始化 ----------
applyViewMode();
setConnUI(false);
renderCrumb();
renderList();
syncControls();
restoreConnection(true);
