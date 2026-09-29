'use strict';
const {app,BrowserWindow,session}=require('electron'),http=require('node:http'),assert=require('node:assert/strict'),os=require('node:os'),path=require('node:path');
const {attachBrowserWindows,webURL}=require('../electron/browser-windows');
app.setPath('userData',path.join(os.tmpdir(),'browser-popup-'+process.pid));
const timeout=setTimeout(()=>app.exit(1),20000);
app.whenReady().then(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(req.url==='/popup'?'<script>document.cookie="login=ok;path=/";opener.postMessage("complete",location.origin);</script>':'<script>window.result="";onmessage=e=>{if(e.origin===location.origin)result=e.data}</script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port;
 const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,session:session.fromPartition('popup-test')}});attachBrowserWindows(win.webContents);await win.loadURL(url);
 const created=new Promise(r=>win.webContents.once('did-create-window',r));await win.webContents.executeJavaScript(`window.open(${JSON.stringify(url+'/popup')},'login');void 0`,true);const child=await created;
 for(let i=0;i<100;i++){if(await win.webContents.executeJavaScript('result==="complete"'))break;await new Promise(r=>setTimeout(r,20));}
 assert.equal(await win.webContents.executeJavaScript('result'),'complete');assert.ok((await win.webContents.executeJavaScript('document.cookie')).includes('login=ok'));assert.equal(child.webContents.session,win.webContents.session);
 assert.equal(await child.webContents.executeJavaScript('typeof require'),'undefined');assert.equal(child.webContents.getLastWebPreferences().sandbox,true);assert.equal(webURL('file:///tmp/test'),false);assert.equal(webURL('javascript:alert(1)'),false);
 const destroyed=new Promise(r=>child.once('closed',r));await child.webContents.executeJavaScript('window.close()').catch(()=>{});await destroyed;assert.equal(win.isDestroyed(),false);
 win.destroy();await new Promise(r=>server.close(r));clearTimeout(timeout);console.log('BROWSER_POPUP_OK: opener callback, shared session, sandbox, close and scheme guards');app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});
