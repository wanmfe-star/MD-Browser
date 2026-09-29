'use strict';
const {app,BrowserWindow,session,clipboard}=require('electron'),http=require('node:http'),assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {configureBrowserPermissions}=require('../electron/browser-permissions');
app.setPath('userData',path.join(os.tmpdir(),'clipboard-test-'+process.pid));
app.whenReady().then(async()=>{
 const server=http.createServer((_q,r)=>r.end('<html><body>Copy test</body></html>'));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const ses=session.fromPartition('clipboard-test');configureBrowserPermissions(ses);
 const win=new BrowserWindow({show:true,width:420,height:250,webPreferences:{session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false}});
 await win.loadURL('http://127.0.0.1:'+server.address().port);win.focus();
 const previous=clipboard.availableFormats().map(format=>[format,clipboard.readBuffer(format)]);
 try{
  const copied=await win.webContents.executeJavaScript('navigator.clipboard.writeText("MD Browser clipboard test").then(()=>true)',true);
  assert.equal(copied,true);
  const result=await win.webContents.executeJavaScript('navigator.clipboard.readText().then(()=>"allowed",e=>e.name)',true);assert.equal(result,'NotAllowedError');
  console.log('BROWSER_CLIPBOARD_OK: web write API resolves, clipboard read denied');
 }finally{clipboard.clear();for(const [format,buffer]of previous)clipboard.writeBuffer(format,buffer);win.destroy();await new Promise(r=>server.close(r));}
 app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});
