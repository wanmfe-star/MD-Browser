'use strict';
require('../electron/media-protocol');
const {app}=require('electron'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
app.setPath('userData',path.join(os.tmpdir(),'mindmap-'+process.pid));
let server;const timeout=setTimeout(()=>{console.error('MIND_MAP_TIMEOUT');app.exit(1)},60000);
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'mindmap-files-'));
 await fs.writeFile(path.join(root,'a.md'),'# 阅读资料');await fs.writeFile(path.join(root,'test.smm'),JSON.stringify({layout:'mindMap',root:{data:{text:'中心主题'},children:[{data:{text:'第一分支'},children:[]}]}}));
 await fs.writeFile(path.join(root,'bad.smm'),'{}');
 server=await(await import('./mock-webdav.mjs')).startWebDAVServer(root);
 const ready=new Promise(resolve=>app.once('browser-window-created',(_event,win)=>{win.hide();win.webContents.setBackgroundThrottling(false);win.webContents.on('console-message',(_event,level,message)=>{if(level>=2)console.log('BROWSER',message)});win.webContents.once('did-finish-load',()=>resolve(win));}));require('../electron/main');const win=await ready,js=code=>win.webContents.executeJavaScript(code,true);
 if(process.env.MD_BROWSER_PACKAGED_RENDERER==='1')await win.loadFile(path.join(__dirname,'../dist/win-unpacked/resources/app.asar/renderer/index.html'));
 await js('connUrl.value='+JSON.stringify('http://127.0.0.1:'+server.port)+';runAction(doConnect)');
 await js('runAction(()=>openFile({path:"/a.md",name:"a.md"}))');await js('workspace.enable("left")');await js('workspace.open({path:"/test.smm",name:"test.smm"},"right")');
 const frame=win.webContents.mainFrame.frames.find(f=>f.url.includes('pane=secondary')),second=code=>frame.executeJavaScript(code,true);
 await second('window.mindErrors=[];window.addEventListener("error",event=>mindErrors.push(event.error?.stack||event.message))');
 assert.equal(await second('state.currentFile?.kind'),'mindmap',await second('statusEl.textContent'));


 const delay=ms=>new Promise(r=>setTimeout(r,ms));await delay(600);
 win.webContents.debugger.attach('1.3');const mouse=e=>win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',e);
 async function rename(evaluate,newName,offset={x:0,y:0}){
  await evaluate('void runAction(renameCurrent)');await delay(80);
  assert.equal(await evaluate('nameDialog.open'),true);
  await evaluate('nameInput.value='+JSON.stringify(newName));
  const pt=await evaluate('(()=>{const r=nameForm.querySelector("[value=ok]").getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()');
  for(const type of ['mousePressed','mouseReleased'])await mouse({type,x:pt.x+offset.x,y:pt.y+offset.y,button:'left',clickCount:1});
  for(let i=0;i<200&&await evaluate('state.busy');i++)await delay(20);console.log('RENAME',await evaluate('[state.currentFile?.path,statusEl.textContent,nameDialog.open,state.busy]'));
  assert.equal(await evaluate('state.currentFile.name'),newName);
 }
 await rename(js,'改名.md');assert.ok(await fs.readFile(path.join(root,'改名.md')));
 await second('void runAction(async()=>await new Promise(resolve=>setTimeout(resolve,800)))');
 await rename(js,'等待后改名.md');
 const offset=await js('(()=>{const r=document.querySelector(".secondary-pane").getBoundingClientRect();return{x:r.left,y:r.top}})()');
 await rename(second,'改名.smm',offset);assert.ok(await fs.readFile(path.join(root,'改名.smm')));
 await second('void runAction(renameCurrent)');await delay(80);await second('nameInput.value="等待后改名.md";nameForm.requestSubmit(nameForm.querySelector("[value=ok]"))');await delay(250);
 assert.equal(await second('renameFailureDialog.open'),true,'server error is visible');assert.equal(await second('state.currentFile.name'),'改名.smm');
 assert.ok(await fs.readFile(path.join(root,'等待后改名.md')));assert.ok(await fs.readFile(path.join(root,'改名.smm')));
 console.log('RENAME_OK');clearTimeout(timeout);await server.close();app.exit(0);
})().catch(error=>{console.error(error);clearTimeout(timeout);app.exit(1)});
