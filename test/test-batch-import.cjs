require('../electron/media-protocol');
'use strict';
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { PDFDocument } = require('pdf-lib');
app.setPath('userData', path.join(os.tmpdir(), 'md-batch-test-' + process.pid));
let server;
const timeout = setTimeout(() => { console.error('Batch import test timed out'); app.exit(1); }, 45000);
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'md-batch-files-'));
  const remote = path.join(root, 'remote'), local = path.join(root, 'local');
  await fs.mkdir(path.join(remote, 'target'), { recursive: true });
  await fs.mkdir(local);
  for (const name of ['a.md','note.txt','dup.md','broken.docx','file.xyz','z.markdown','fail.md','drop1.md','drop2.md','stop1.md','stop2.md']) {
    await fs.writeFile(path.join(local, name), '# ' + name + '\n');
  }
  const pdf = await PDFDocument.create(); pdf.addPage();
  const pdfBytes = await pdf.save(); await fs.writeFile(path.join(local, 'file.pdf'), pdfBytes);
  await fs.writeFile(path.join(remote, 'target/dup.md'), 'keep original');
  await fs.writeFile(path.join(remote, 'target/current.md'), 'current document');
  server = await (await import('./mock-webdav.mjs')).startWebDAVServer(remote);
  const webdav = require('../electron/webdav');
  const originalCreate = webdav.create;
  let releaseUpload, uploading = false;
  webdav.create = async (file, content) => {
    if (file.endsWith('/fail.md')) throw new Error('Simulated upload failure');
    if (file.endsWith('/stop1.md')) { uploading = true; await new Promise(resolve => { releaseUpload = resolve; }); }
    return originalCreate(file, content);
  };
  const ready = new Promise(resolve => app.once('browser-window-created', (_event, win) => {
    win.hide(); win.webContents.once('did-finish-load', () => resolve(win));
  }));
  require('../electron/main');
  const win = await ready; win.webContents.setBackgroundThrottling(false); console.log('Window ready'); win.webContents.on('console-message', (_event, level, message) => console.log('Renderer:',message));
  const js = source => win.webContents.executeJavaScript(source);
  const waitFor = async source => {
    const deadline = Date.now() + 12000;
    while (!(await js(source))) {
      if (Date.now() > deadline) throw new Error('Timed out: ' + source);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  };
  win.webContents.debugger.attach('1.3');
  const drag = async names => {
    const data = { items: [], files: names.map(name => path.join(local, name)), dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await win.webContents.debugger.sendCommand('Input.dispatchDragEvent', { type, x: 150, y: 230, data });
    }
  };
  const originalURL = win.webContents.getURL();
  console.log('Starting native drop'); await drag(['drop1.md','drop2.md']); console.log('Native drop dispatched');
  assert.equal(await js('state.connected'), false);
  assert.equal(win.webContents.getURL(), originalURL, 'unconnected drop must not navigate away');
  await js('connUrl.value=' + JSON.stringify('http://127.0.0.1:' + server.port) + '; connUser.value="test"; connPass.value="test"; runAction(doConnect)');
  await js('navigate("/target")');
  await js('runAction(() => openFile({path:"/target/current.md",name:"current.md",type:"file"}))');
  await js('editorEl.value="local draft stays open"; editorEl.dispatchEvent(new Event("input"))');
  console.log('Connected to test directory');
  let selectedNames = ['a.md','file.pdf','note.txt','dup.md','broken.docx','file.xyz','fail.md','z.markdown'];
  dialog.showOpenDialog = async (_window, options) => {
    assert.ok(options.properties.includes('multiSelections'));
    return { canceled: false, filePaths: selectedNames.map(name => path.join(local,name)) };
  };
  console.log('Starting batch'); await js('window.importRun = runAction(importDocument); void 0'); console.log('Batch dispatched');
  await waitFor('document.getElementById("nameDialog").open');
  assert.equal(await js('document.getElementById("nameInput").value'), 'dup（导入）.md');
  await js('document.querySelector("#nameForm [value=cancel]").click()');
  await js('window.importRun');
  assert.match(await js('document.getElementById("importWarningsText").textContent'), /成功 4，失败 3，跳过 1/);
  assert.equal(await fs.readFile(path.join(remote,'target/dup.md'),'utf8'), 'keep original');
  assert.deepEqual(await fs.readFile(path.join(remote,'target/file.pdf')), Buffer.from(pdfBytes));
  assert.equal(await fs.readFile(path.join(remote,'target/z.md'),'utf8'), '# z.markdown\n');
  assert.equal(await js('state.currentFile.path'), '/target/current.md', 'batch keeps the current document');
  assert.equal(await js('editorEl.value'), 'local draft stays open', 'batch preserves pending editor content');
  await fs.mkdir(path.join(__dirname, '../.electron-cache'), { recursive: true });
  await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await fs.writeFile(path.join(__dirname, '../.electron-cache/batch-result.png'), (await win.webContents.capturePage()).toPNG());
  await js('document.getElementById("importWarnings").close()');
  await drag(['drop1.md','drop2.md']);
  await waitFor('document.getElementById("importWarnings").open && !state.busy');
  assert.match(await js('document.getElementById("importWarningsText").textContent'), /成功 2，失败 0/);
  for (const name of ['drop1.md','drop2.md']) assert.equal(await fs.readFile(path.join(remote,'target',name),'utf8'), '# '+name+'\n');
  assert.equal(win.webContents.getURL(), originalURL, 'native file drop must not navigate');
  await js('document.getElementById("importWarnings").close()');
  selectedNames = ['stop1.md', 'stop2.md'];
  await js('window.importRun = runAction(importDocument); void 0');
  const deadline = Date.now() + 5000;
  while (!uploading) { if (Date.now() > deadline) throw new Error('Upload never began'); await new Promise(resolve => setTimeout(resolve, 20)); }
  await js('document.getElementById("cancelImport").click()');
  releaseUpload();
  await js('window.importRun');
  assert.match(await js('document.getElementById("importWarningsText").textContent'), /成功 1，失败 0，跳过 1/);
  await fs.access(path.join(remote, 'target/stop1.md'));
  await assert.rejects(fs.access(path.join(remote, 'target/stop2.md')));
  assert.equal(await js('document.getElementById("importProgress").hidden'), true);
  console.log('Batch import checks passed: native multi-select, real file drag/drop, mixed formats, duplicate protection, conversion/upload failures, cancellation, PDF bytes and current document');
  clearTimeout(timeout); await server.close(); app.exit(0);
})().catch(async error => { console.error(error); clearTimeout(timeout); if(server) await server.close(); app.exit(1); });
