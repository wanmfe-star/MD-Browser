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

 const original='开场白\n\n# 第一页\n第一部分\n\n# 第二页\n第二部分\n';
 await js('editorEl.value='+JSON.stringify(original)+';sectionTabs.load();editorEl.dispatchEvent(new Event("input"));runAction(save)');
 assert.deepEqual(await js('sectionTabs.inspect().titles'),['前言','第一页','第二页']);
 await js(`Array.from(document.querySelectorAll('.section-tabs button')).find(b=>b.textContent==='第一页').click()`);
 assert.equal(await js('editorEl.value'),'# 第一页\n第一部分\n\n');assert.ok(!(await js('previewEl.textContent')).includes('第二部分'));
 await js(`editorEl.value='# 第一页\\n修改后的第一部分';editorEl.dispatchEvent(new Event('input'));runAction(save)`);
 let saved=await fs.readFile(path.join(root,'a.md'),'utf8');assert.ok(saved.includes('开场白'));assert.ok(saved.includes('修改后的第一部分\n\n# 第二页'));assert.ok(saved.includes('第二部分'));
 assert.ok((await js('aiDocument.snapshot()')).text.includes('第二部分'));
 await js(`Array.from(document.querySelectorAll('.section-tabs button')).find(b=>b.textContent==='第二页').click()`);
 assert.ok((await js('editorEl.value')).includes('第二部分'));
 await js(`promptName=async()=> '第三页';document.querySelector('.section-add').click()`);await new Promise(r=>setTimeout(r,50));
 assert.equal(await js('editorEl.value'),'# 第三页\n\n');await js('runAction(save)');saved=await fs.readFile(path.join(root,'a.md'),'utf8');assert.ok(saved.includes('修改后的第一部分'));assert.ok(saved.includes('# 第三页'));
 await js(`Array.from(document.querySelectorAll('.section-tabs button')).find(b=>b.textContent==='全文').click()`);assert.equal(await js('editorEl.value'),saved);assert.equal(await js('isDirty()'),false);
 await js('runAction(()=>openFile({path:"/duplicate.md",name:"duplicate.md"}))');assert.equal(await js('documentText()'),'source');assert.deepEqual(await js('sectionTabs.inspect().titles'),[]);
 await js('workspace.enable("left")');await js('workspace.open({path:"/a.md",name:"a.md"},"right")');
 const frame=win.webContents.mainFrame.frames.find(f=>f.url.includes('pane=secondary')),second=s=>frame.executeJavaScript(s,true);
 await second(`Array.from(document.querySelectorAll('.section-tabs button')).find(b=>b.textContent==='第二页').click();editorEl.value+="双栏编辑";editorEl.dispatchEvent(new Event('input'));runAction(save)`);
 saved=await fs.readFile(path.join(root,'a.md'),'utf8');assert.ok(saved.includes('双栏编辑'));assert.ok(saved.includes('修改后的第一部分'));assert.ok(saved.includes('# 第三页'));
 console.log('SECTION_TABS_OK: switching, full save, AI full reference, add page, open another file');clearTimeout(timeout);void server.close();app.exit(0);
})().catch(e=>{console.error(e);clearTimeout(timeout);app.exit(1)});
