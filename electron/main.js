// Electron 主进程
'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, Menu, safeStorage, webFrameMain, protocol } = require('electron');
const path = require('path');
const os = require('os');
const webdav = require('./webdav');
const media = require('./media').createMediaService(webdav);
require('./media-protocol');

// Customize only Chromium's PDF toolbar; the underlying PDF stays untouched.
app.on('web-contents-created', (_event, contents) => {
  contents.on('did-frame-finish-load', (_loadEvent, _main, processId, routingId) => {
    const frame = webFrameMain.fromId(processId, routingId);
    if (!frame || !frame.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')) return;
    frame.executeJavaScript(`(() => {
      let attempts = 0;
      function hideTitle() {
        const toolbar = document.querySelector('pdf-viewer')?.shadowRoot?.querySelector('viewer-toolbar')?.shadowRoot;
        if (!toolbar) {
          if (++attempts < 100) setTimeout(hideTitle, 50);
          return;
        }
        if (toolbar.getElementById('md-hide-pdf-title')) return;
        const style = document.createElement('style');
        style.id = 'md-hide-pdf-title';
        style.textContent = '#title { visibility: hidden !important; }';
        toolbar.appendChild(style);
      }
      hideTitle();
    })()`).catch(() => {});
  });
});

// 冒烟测试环境（仅在 MD_BROWSER_SMOKE=1 时启用）：
// 在受限的自动化环境里，Chromium 沙箱无法初始化、也无法写系统缓存目录，
// 因此禁用沙箱/GPU 并把用户数据指向临时目录。真实运行时此开关不生效，不影响安全性。
if (process.env.MD_BROWSER_SMOKE) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu');
  app.setPath('userData', path.join(os.tmpdir(), 'md-browser-smoke-' + process.pid));
}

let mainWindow = null;
const credentials = require('./credentials').createCredentialStore(app.getPath('userData'), safeStorage);

const configuredBrowserSessions = new WeakSet();
let browserSession = null, browserStorageFlushed = false;
app.on('before-quit', event => {
  if (!browserSession || browserStorageFlushed) return;
  event.preventDefault();
  browserStorageFlushed = true;
  browserSession.flushStorageData();
  browserSession.cookies.flushStore().catch(() => {}).finally(() => app.quit());
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: 'MD Browser',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../assets/icon.png'),
    backgroundColor: '#fdfdfb',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      plugins: true,
      webviewTag: true,
    },
  });

  // Remote pages never receive the application's preload or NAS bridge.
  mainWindow.webContents.on('will-attach-webview', (event, preferences, params) => {
    if (!/^https?:\/\//i.test(params.src) || params.partition !== 'persist:md-browser-web') { event.preventDefault(); return; }
    delete preferences.preload;
    Object.assign(preferences, { nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false });
  });
  mainWindow.webContents.on('did-attach-webview', (_event, guest) => {
    const allowed = url => { try { return ['http:','https:'].includes(new URL(url).protocol); } catch { return false; } };
    for (const type of ['will-navigate','will-redirect']) guest.on(type, (event, url) => { if (!allowed(url)) event.preventDefault(); });
    guest.setWindowOpenHandler(({url}) => { if (allowed(url)) guest.loadURL(url).catch(()=>{}); return {action:'deny'}; });
    browserSession = guest.session;
    if (configuredBrowserSessions.has(guest.session)) return;
    configuredBrowserSessions.add(guest.session);
    guest.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    guest.session.setPermissionCheckHandler(() => false);
    guest.session.on('will-download', event => event.preventDefault());
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // 冒烟测试：MD_BROWSER_SMOKE=1 时加载完成后自检并退出
  if (process.env.MD_BROWSER_SMOKE) {
    mainWindow.webContents.on('did-finish-load', async () => {
      try {
        const result = await mainWindow.webContents.executeJavaScript(
          `(async () => {
            let renderOk = false, renderErr = null;
            try {
              const html = window.marked.parse('# 你好 **世界**');
              renderOk = typeof html === 'string' && html.includes('你好');
              if (window.DOMPurify) DOMPurify.sanitize(html);
            } catch (e) { renderErr = String(e && e.message || e); }
            const nameResult = promptName('测试文件名', 'example.md');
            const form = document.getElementById('nameForm');
            const input = document.getElementById('nameInput');
            const ok = form.querySelector('[value="ok"]');
            input.value = '../bad.md';
            form.requestSubmit(ok);
            const invalidRejected = document.getElementById('nameDialog').open && !input.validity.valid;
            input.value = 'valid.md';
            input.dispatchEvent(new Event('input'));
            form.requestSubmit(ok);
            const acceptedName = await nameResult;
            const cancelResult = promptName('取消测试', '');
            form.querySelector('[value="cancel"]').click();
            const dialogOk = invalidRejected && acceptedName === 'valid.md' && await cancelResult === null;
            return JSON.stringify({
              dialogOk,
              mdAPI: typeof window.mdAPI,
              marked: typeof window.marked,
              markedParse: typeof (window.marked && window.marked.parse),
              DOMPurify: typeof window.DOMPurify,
              renderOk, renderErr,
              appInitOk: document.getElementById('filelist').textContent.includes('尚未连接') &&
                         document.getElementById('crumb').textContent.trim() === '我的文档' &&
                         document.getElementById('editor').placeholder.length > 0
            });
          })()`
        );
        console.log('SMOKE_RESULT ' + result);
        const checks = JSON.parse(result);
        if (!checks.renderOk || !checks.appInitOk || !checks.dialogOk || checks.mdAPI !== 'object' || checks.DOMPurify !== 'function') {
          throw new Error('启动或渲染自检未通过');
        }
        if (process.env.MD_BROWSER_TEST_WEBDAV_URL) {
          const testURL=new URL(process.env.MD_BROWSER_TEST_WEBDAV_URL);
          if(testURL.protocol!=='http:' || testURL.hostname!=='127.0.0.1')throw new Error('Smoke server must be local');
          const network=await mainWindow.webContents.executeJavaScript(`(async()=>{
            const check=async(promise)=>{const result=await promise;if(!result.ok)throw new Error(result.error);return result.data;};
            await check(window.mdAPI.connect({url:${JSON.stringify(testURL.href)},username:'test',password:'test'}));
            const entries=await check(window.mdAPI.list('/'));
            if(!entries.some(entry=>entry.name==='readme.md'))throw new Error('Missing test document');
            const original=await check(window.mdAPI.read('/readme.md'));if(original!=='# Packaged client')throw new Error('Read mismatch');
            await check(window.mdAPI.create('/created.md','# 保存测试'));
            await check(window.mdAPI.write('/created.md','# 已修改'));
            if(await check(window.mdAPI.read('/created.md'))!=='# 已修改')throw new Error('Save mismatch');
            await check(window.mdAPI.rename('/created.md','/renamed.md'));
            await check(window.mdAPI.remove('/renamed.md'));
            await check(window.mdAPI.mkdir('/folder'));
            await check(window.mdAPI.remove('/folder'));
            const pdf=new TextEncoder().encode('%PDF-1.4\\npackaged binary check');
            await check(window.mdAPI.createPDF('/binary.pdf',pdf));
            const read=await check(window.mdAPI.readPDF('/binary.pdf'));
            if(Array.from(read).join(',')!==Array.from(pdf).join(','))throw new Error('Binary mismatch');
            await check(window.mdAPI.remove('/binary.pdf'));
            await check(window.mdAPI.clearConnection());
            await check(window.mdAPI.disconnect());return true;
          })()`);
          if(!network)throw new Error('Packaged network checks failed');
          console.log('PACKAGED_WEBDAV_OK');
        }
        const dict=await mainWindow.webContents.executeJavaScript("window.mdAPI.lookupCharacter('行')");
        if(!dict.ok || !dict.data.found || !dict.data.pinyin.includes('háng') || !dict.data.definitions.length)throw new Error('Packaged dictionary data missing');
        const phrase=await mainWindow.webContents.executeJavaScript("window.mdAPI.lookupCharacter('画蛇添足')");
        if(!phrase.ok || phrase.data.kind!=='idiom' || !phrase.data.definitions.length)throw new Error('Packaged phrase dictionary missing');
        const word=await mainWindow.webContents.executeJavaScript("window.mdAPI.lookupCharacter('学习')");
        if(!word.ok || word.data.kind!=='word' || !word.data.definitions.length)throw new Error('Packaged word dictionary missing');
        console.log('DICTIONARY_OK');
        console.log('SMOKE_OK');
      } catch (e) {
        console.error('SMOKE_FAIL ' + (e && e.message ? e.message : e));
        process.exitCode = 1;
      }
      setTimeout(() => app.quit(), 200);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  protocol.handle('mdmedia', request => media.handle(request));
  if (process.platform === 'darwin') app.dock.setIcon(path.join(__dirname, '../assets/icon.png'));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- 统一的 handler 包装 ----------
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      if (_event.sender !== mainWindow?.webContents) throw new Error('不允许的调用来源');
      const data = await fn(...args);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });
}

handle('webdav:connect', async (cfg) => {
  const root = await webdav.connect(cfg);
  media.clear();
  let credentialWarning = null;
  // Smoke runs use disposable credentials and must not open the user's Keychain.
  try { if (!process.env.MD_BROWSER_SMOKE) await credentials.save(cfg); }
  catch (error) { credentialWarning = '连接成功，但密码未保存：' + error.message; }
  return { root, credentialWarning };
});

handle('app:load-connection', () => credentials.load());
handle('app:clear-connection', () => credentials.clear());

handle('webdav:disconnect', () => {
  media.clear();
  webdav.disconnect();
  return true;
});

handle('media:upload', async (target, source) => {
  const type = require('../shared/media-types').type;
  if (typeof source !== 'string' || !path.isAbsolute(source) || !type(target) || !type(source) || path.extname(target).toLowerCase() !== path.extname(source).toLowerCase()) throw new Error('无效的媒体文件');
  const file = await require('node:fs/promises').open(source, 'r');
  let stream;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 2 * 1024 * 1024 * 1024) throw new Error('请选择不超过 2 GB 的媒体文件');
    stream = file.createReadStream({ autoClose: false });
    return await webdav.createMedia(target, stream, info.size);
  } finally { stream?.destroy(); await file.close(); }
});
handle('app:open-system-file', require('./system-open').createSystemOpener(webdav, shell, path.join(app.getPath('temp'), 'md-browser-open')));
handle('media:open', target => media.open(target));
handle('media:release', url => { media.release(url); return true; });
app.on('before-quit', () => media.clear());
handle('webdav:list', (dir) => webdav.list(dir));
handle('webdav:read', (p) => webdav.read(p));
handle('word:read', async target => {
  if (!/\.docx$/i.test(target)) throw new Error('请选择 DOCX 文件');
  const bytes = await webdav.readBinary(target);
  return { bytes: new Uint8Array(bytes), model: await require('./docx').inspectDocx(bytes) };
});
handle('word:create', async (target, bytes) => {
  if (!/\.docx$/i.test(target)) throw new Error('Word 导入必须保留 .docx 扩展名');
  const buffer = Buffer.from(bytes); await require('./docx').inspectDocx(buffer);
  return webdav.create(target, buffer);
});
handle('word:save', async ({ path: target, bytes, blocks }) => {
  const saved = await require('./docx').editDocx(Buffer.from(bytes), blocks);
  const model = await require('./docx').inspectDocx(saved);
  await webdav.writeDocx(target, saved, bytes);
  return { bytes: new Uint8Array(saved), model };
});
handle('webdav:read-pdf', async (p) => {
  const bytes = await webdav.readBinary(p);
  require('./pdf-file').validatePDF(bytes);
  return new Uint8Array(bytes);
});
handle('webdav:create-pdf', async (p, bytes) => {
  if (!/\.pdf$/i.test(p)) throw new Error('PDF 导入必须保留 .pdf 扩展名');
  const data = Buffer.from(bytes);
  require('./pdf-file').validatePDF(data);
  return webdav.create(p, data);
});
handle('webdav:exists', (p) => webdav.exists(p));
handle('app:export-pdf', async (payload) => {
  const title = String(payload.title || '未命名').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出 PDF', defaultPath: title + '.pdf', filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return null;
  const destination = /\.pdf$/i.test(result.filePath) ? result.filePath : result.filePath + '.pdf';
  return require('./export-pdf').exportPDF({ html: payload.html, title }, destination);
});
handle('app:select-import-documents', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入文档（可多选）', properties: ['openFile', 'multiSelections'],
    filters: [{ name: '文档 / 音乐 / 视频 / 图片', extensions: ['smm', 'mindmap', 'md', 'markdown', 'pdf', 'docx', 'doc', 'txt', 'text', ...require('../shared/media-types').extensions] }],
  });
  return result.canceled ? [] : result.filePaths.map(filePath => ({ path: filePath, name: path.basename(filePath) }));
});
handle('app:convert-import-document', filePath => {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('无法读取本地文件，请重新选择或拖入');
  return require('./import-document').convertDocument(filePath, { preserveDocx: true });
});
handle('app:import-document', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入 PDF、Word 或文本文件', properties: ['openFile'],
    filters: [{ name: 'PDF / Word / 文本', extensions: ['pdf', 'docx', 'doc', 'txt', 'text'] }],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return require('./import-document').convertDocument(result.filePaths[0]);
});
handle('webdav:write', (p, content) => webdav.write(p, content));
handle('webdav:create', (p, content) => webdav.create(p, content));
handle('webdav:mkdir', (p) => webdav.mkdir(p));
handle('webdav:delete', (p) => webdav.remove(p));
handle('webdav:copy', (from, to) => webdav.copy(from, to));
handle('webdav:rename', (from, to) => webdav.rename(from, to));

handle('app:file-menu', (folder) => new Promise(resolve => {
  const menu = Menu.buildFromTemplate([
    { label: folder ? '打开文件夹' : '打开文件', click: () => resolve('open') },
    ...(!folder ? [{label:'在左栏打开',click:()=>resolve('open-left')},{label:'在右栏打开',click:()=>resolve('open-right')}] : []),
    { type: 'separator' },
    { label: '重命名…', click: () => resolve('rename') },
    ...(!folder ? [{ label: '复制…', click: () => resolve('copy') }] : []),
    { label: '移动到…', click: () => resolve('move') },
    { type: 'separator' },
    { label: folder ? '删除文件夹…' : '删除文件…', click: () => resolve('delete') },
  ]);
  menu.popup({ window: mainWindow, callback: () => setTimeout(() => resolve(null), 0) });
}));

handle('app:confirm-delete', async ({ name, folder, dirty }) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning', message: '删除「' + name + '」？',
    detail: (folder ? '文件夹及其全部内容都会被永久删除。' : '文件会被永久删除。') +
      (dirty ? '其中包含当前文档尚未保存的修改。' : '') + '相关本地草稿也会删除，此操作无法撤销。',
    buttons: ['取消', '删除'], defaultId: 0, cancelId: 0, noLink: true,
  });
  return response === 1;
});

handle('app:confirm-discard', async (localSaved) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    message: '当前修改尚未保存到远程',
    detail: localSaved ? '本地草稿已保留。下次连接同一账号并打开此文件时，可以恢复草稿。仍要离开吗？' : '远程保存与本地草稿保存均未成功，离开会丢失修改。请取消并重试保存。',
    buttons: ['取消', localSaved ? '保留草稿并离开' : '放弃修改'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return response === 1;
});

handle('app:recover-draft', async (conflict) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question', message: '发现这篇文档的本地草稿',
    detail: conflict ? '远程内容已发生变化。恢复草稿后，自动保存将用本地草稿覆盖当前远程版本。也可以使用远程版本并删除本地草稿。' : '上次的修改尚未保存到远程。恢复后将继续编辑并自动保存。',
    buttons: ['取消', '恢复本地草稿', '使用远程版本'], defaultId: 0, cancelId: 0, noLink: true,
  });
  return ['cancel', 'restore', 'remote'][response];
});

handle('app:open-external', (url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
  }
  return true;
});

handle('app:confirm-annotations', async () => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning', message: 'PDF 标注尚未保存', detail: '离开后将丢失本次标注。可以先取消，再保存当前 PDF。',
    buttons: ['取消', '放弃标注'], defaultId: 0, cancelId: 0, noLink: true,
  });
  return response === 1;
});
handle('app:inspect-pdf-annotations', async (bytes) => require('./pdf-annotations').inspectAnnotations(bytes));
handle('app:preview-pdf-annotations', async ({bytes,removed}) => new Uint8Array(await require('./pdf-annotations').annotatePDF(bytes,[],[],removed)));
handle('app:save-annotated-pdf', async ({ bytes, annotations, removed, path: target, expected }) => {
  const result=await require('./pdf-annotations').annotatePDF(bytes,[],annotations,removed);
  require('./pdf-file').validatePDF(Buffer.from(result));
  await webdav.writePDF(target,result,expected);
  return new Uint8Array(result);
});

handle('app:copy-text', (text) => {
  if (typeof text !== 'string') throw new Error('无效的复制文本');
  require('electron').clipboard.writeText(text);
  return true;
});

handle('app:lookup-character', (text) => require('./dictionary').lookupCharacter(text));
