// Electron 主进程
'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, Menu, safeStorage, webFrameMain } = require('electron');
const path = require('path');
const os = require('os');
const webdav = require('./webdav');

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: 'MD Browser',
    icon: path.join(__dirname, '../assets/icon.png'),
    backgroundColor: '#fdfdfb',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      plugins: true,
    },
  });

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
      const data = await fn(...args);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });
}

handle('webdav:connect', async (cfg) => {
  const root = await webdav.connect(cfg);
  let credentialWarning = null;
  try { await credentials.save(cfg); }
  catch (error) { credentialWarning = '连接成功，但密码未保存：' + error.message; }
  return { root, credentialWarning };
});

handle('app:load-connection', () => credentials.load());
handle('app:clear-connection', () => credentials.clear());

handle('webdav:disconnect', () => {
  webdav.disconnect();
  return true;
});

handle('webdav:list', (dir) => webdav.list(dir));
handle('webdav:read', (p) => webdav.read(p));
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
handle('webdav:rename', (from, to) => webdav.rename(from, to));

handle('app:file-menu', (folder) => new Promise(resolve => {
  const menu = Menu.buildFromTemplate([
    { label: folder ? '打开文件夹' : '打开文件', click: () => resolve('open') },
    { type: 'separator' },
    { label: '重命名…', click: () => resolve('rename') },
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
