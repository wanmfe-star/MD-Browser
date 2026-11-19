const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow } = require('electron');
const { setTimeout: delay } = require('node:timers/promises');
require('../electron/media-protocol');

async function until(check) {
  for (let i = 0; i < 180; i++) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error('等待测试条件超时：' + check);
}
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'md-sticky-test-'));
  app.setPath('userData', root);
  app.disableHardwareAcceleration();
  const remote = path.join(root, 'remote');
  const server = await (await import('./mock-webdav.mjs')).startWebDAVServer(remote);
  let offline = false;
  const proxy = http.createServer((req, res) => {
    if (offline) { res.writeHead(503).end(); return; }
    const upstream = http.request({ host:'127.0.0.1', port:server.port, path:req.url, method:req.method, headers:req.headers }, reply => {
      res.writeHead(reply.statusCode, reply.headers);
      reply.pipe(res);
    });
    req.pipe(upstream);
  });
  await new Promise(resolve => proxy.listen(0,'127.0.0.1',resolve));
  require('../electron/main');
  await app.whenReady();
  let main;
  await until(() => (main = BrowserWindow.getAllWindows().find(w => w.getTitle()==='MD Browser')) && !main.webContents.isLoading());
  const board = code => main.webContents.executeJavaScript(code);
  await board("document.getElementById('showNotes').click()");
  await board("document.getElementById('createNote').click()");
  let editor;
  await until(() => (editor = BrowserWindow.getAllWindows().find(w => w !== main)) && !editor.webContents.isLoading() && editor.webContents.getURL().includes('sticky-editor'));
  const edit = code => editor.webContents.executeJavaScript(code);
  await until(() => edit("!document.querySelector('#body').disabled"));
  await edit("document.querySelector('#pin').click()");
  await until(() => editor.isAlwaysOnTop());
  await edit("document.querySelector('#title').value='晨读';document.querySelector('#tags').value='法义，随想';document.querySelector('#body').value='今日读到缘起';document.querySelector('#body').dispatchEvent(new Event('input'))");
  editor.close();
  await until(() => editor.isDestroyed());
  const local = path.join(root, '便签');
  const file = (await fs.readdir(local)).find(name => name.endsWith('.md'));
  assert.match(await fs.readFile(path.join(local,file),'utf8'), /今日读到缘起/);
  await until(() => board("document.querySelectorAll('.sticky-card').length===1"));
  await board("document.querySelector('#noteQuery').value='缘起';document.querySelector('#noteQuery').dispatchEvent(new Event('input'));Array.from(document.querySelectorAll('#noteFilters button')).find(b=>b.textContent==='法义').click()");
  assert.equal(await board("document.querySelectorAll('.sticky-card').length"),1);
  await board("Array.from(document.querySelectorAll('#noteFilters button')).find(b=>b.textContent==='产品创意').click()");
  assert.equal(await board("document.querySelectorAll('.sticky-card').length"),0);
  const url = 'http://127.0.0.1:'+proxy.address().port;
  const result = await board('window.mdAPI.connect('+JSON.stringify({url,username:'test',password:'test'})+')');
  assert.equal(result.ok,true,result.error);
  const backup = path.join(remote,'MD Browser 便签备份',file);
  await until(async () => fs.access(backup).then(()=>true,()=>false));
  offline = true;
  await board('window.mdAPI.notesOpen('+JSON.stringify(path.basename(file,'.md'))+')');
  await until(() => (editor = BrowserWindow.getAllWindows().find(w => w !== main)) && !editor.webContents.isLoading() && editor.webContents.getURL().includes('sticky-editor'));
  await until(() => edit("document.querySelector('#body').value==='今日读到缘起'"));
  await edit("document.querySelector('#body').value+='，重读后补记';document.querySelector('#body').dispatchEvent(new Event('input'))");
  await until(() => edit("document.querySelector('#backup').textContent==='等待 WebDAV 备份'"));
  await delay(800);
  assert.doesNotMatch(await fs.readFile(backup,'utf8'), /重读/);
  offline = false;
  await until(() => edit("document.querySelector('#backup').textContent==='WebDAV 已备份'"));
  assert.equal(await fs.readFile(backup,'utf8'),await fs.readFile(path.join(local,file),'utf8'));
  const restored = require('../electron/sticky-store').createStore(local).list();
  assert.equal(restored[0].backup,'WebDAV 已备份');
  assert.deepEqual(restored[0].tags,['法义','随想']);
  const { createStore } = require('../electron/sticky-store');
  const reopened = createStore(local);
  reopened.save(restored[0].id, { ...restored[0], body:'关机前的离线修改' });
  const restarted = createStore(local);
  const target = await require('../electron/webdav').noteBackupTarget({ url, username:'test', password:'test' });
  let wrongUploads = 0;
  restarted.connect({ key:'other account', upload:async () => { wrongUploads++; } });
  await restarted.drain();
  assert.equal(wrongUploads,0);
  restarted.connect(target);
  await restarted.drain();
  restarted.disconnect();
  assert.match(await fs.readFile(backup,'utf8'),/关机前的离线修改/);
  if (process.env.MD_STICKY_PREVIEW) {
    const limit = setTimeout(() => { console.error('窗口截图超时'); app.exit(1); }, 15000);
    main.webContents.setBackgroundThrottling(false);
    await board("document.querySelector('#noteQuery').value='';document.querySelector('#noteFilters button').click()");
    await delay(200);
    for (const [name, win] of [['wall',main],['editor',editor]]) {
      const [width,height] = win.getContentSize();
      const page = await win.webContents.printToPDF({ printBackground:true,
        pageSize:{width:width/96,height:height/96}, margins:{ top:0,left:0,bottom:0,right:0 } });
      await fs.writeFile(path.join(process.env.MD_STICKY_PREVIEW, name+'.pdf'),page);
    }
    clearTimeout(limit);
  }
  console.log('便签小窗置顶、关闭保存、正文与标签组合筛选、离线补传及重载通过');
  proxy.close();
  await server.close();
  app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
