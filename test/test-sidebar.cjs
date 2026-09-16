'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');
const path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
app.setPath('userData',path.join(os.tmpdir(),'md-sidebar-'+process.pid));app.disableHardwareAcceleration();
ipcMain.handle('app:load-connection',()=>({ok:true,data:null}));
const timeout=setTimeout(()=>app.exit(1),20000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1200,height:850,webPreferences:{preload:path.join(__dirname,'../electron/preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false}});
 const file=path.join(__dirname,'../renderer/index.html');await win.loadFile(file);const js=s=>win.webContents.executeJavaScript(s,true);
 const before=await js('workspaceShell.getBoundingClientRect().width');
 await js("editorEl.value='保留编辑内容';toggleSidebar.click()");
 assert.equal(await js("getComputedStyle(fileSidebar).display"),'none');assert.equal(await js("toggleSidebar.getAttribute('aria-expanded')"),'false');assert.equal(await js('editorEl.value'),'保留编辑内容');assert.ok(await js('workspaceShell.getBoundingClientRect().width')>before+200);
 assert.ok(await js('toggleSidebar.getBoundingClientRect().width>0'));
 await win.loadFile(file);assert.equal(await js("getComputedStyle(fileSidebar).display"),'none','saved collapse state');
 await js('toggleSidebar.click()');assert.equal(await js("toggleSidebar.getAttribute('aria-expanded')"),'true');assert.equal(await js('fileSidebar.inert'),false);assert.equal(await js('workspaceShell.getBoundingClientRect().width'),before);
 await win.loadFile(file);assert.notEqual(await js("getComputedStyle(fileSidebar).display"),'none');
 console.log('SIDEBAR_OK: collapse, expand, available toggle, document preservation and saved state');clearTimeout(timeout);app.exit(0);
}).catch(e=>{console.error(e);app.exit(1);});
