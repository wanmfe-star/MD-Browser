'use strict';
require('../electron/media-protocol');
const {app,safeStorage}=require('electron'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
app.setPath('userData',path.join(os.tmpdir(),'file-drag-'+process.pid));
// Only disposable test credentials are stored; avoid the system keychain in this test.
safeStorage.isEncryptionAvailable=()=>true;safeStorage.encryptString=s=>Buffer.from(s);safeStorage.decryptString=b=>b.toString();
let server;const timeout=setTimeout(()=>app.exit(1),45000);
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'file-drag-files-'));
 await fs.mkdir(path.join(root,'folder'));await fs.writeFile(path.join(root,'a.md'),'original');await fs.writeFile(path.join(root,'duplicate.md'),'source');await fs.writeFile(path.join(root,'folder','duplicate.md'),'destination');
 server=await(await import('./mock-webdav.mjs')).startWebDAVServer(root);
 const ready=new Promise(resolve=>app.once('browser-window-created',(_e,w)=>{w.hide();w.webContents.setBackgroundThrottling(false);w.webContents.once('did-finish-load',()=>resolve(w));}));require('../electron/main');const win=await ready,js=s=>win.webContents.executeJavaScript(s,true);
 await js('connUrl.value='+JSON.stringify('http://127.0.0.1:'+server.port)+';runAction(doConnect)');
 await js('runAction(()=>openFile({path:"/a.md",name:"a.md"}))');
 await js(`window.dragFile=(name,target)=>{const row=n=>Array.from(filelistEl.querySelectorAll('.file-row')).find(b=>b.title===n);const dt=new DataTransfer();const source=row(name);source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));const dest=target?row(target):filelistEl;dest.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));const result={effect:dt.dropEffect,highlight:dest.classList.contains('drop-target'),types:Array.from(dt.types)};dest.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));source.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));return result};void 0;`);
 async function settle(){for(let i=0;i<200;i++){if(await js('!state.busy'))return;await new Promise(r=>setTimeout(r,20));}throw Error('move timed out');}
 const result=await js('dragFile("a.md","folder")');assert.equal(result.highlight,true);assert.deepEqual(result.types,['application/x-md-browser-file-move']);await settle();
 assert.equal(await fs.readFile(path.join(root,'folder','a.md'),'utf8'),'original');await assert.rejects(fs.access(path.join(root,'a.md')));assert.equal(await js('state.currentFile.path'),'/folder/a.md');assert.equal(await js('state.entries.some(e=>e.path==="/a.md")'),false);
 await js('dragFile("duplicate.md","folder")');await settle();assert.equal(await fs.readFile(path.join(root,'duplicate.md'),'utf8'),'source');assert.equal(await fs.readFile(path.join(root,'folder','duplicate.md'),'utf8'),'destination');assert.ok(await js('statusEl.textContent.includes("失败")'));
 assert.equal((await js('dragFile("duplicate.md",null)')).effect,'none');assert.equal(await js('draggedFile===null'),true);assert.equal(await fs.readFile(path.join(root,'duplicate.md'),'utf8'),'source');
 await js('state.busy=true');assert.equal(await js(`(()=>{const row=Array.from(filelistEl.querySelectorAll('.file-row')).find(b=>b.title==='duplicate.md');return row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()}));})()`),false);
 console.log('FILE_DRAG_OK: move, open path update, conflict protection, cancellation, busy guard');clearTimeout(timeout);void server.close();app.exit(0);
})().catch(e=>{console.error(e);clearTimeout(timeout);app.exit(1)});
