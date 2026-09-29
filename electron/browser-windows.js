'use strict';
function webURL(value){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}}
// Let Chromium retain window.opener, POST bodies and the shared browser session.
function attachBrowserWindows(contents){
  for(const event of ['will-navigate','will-redirect'])contents.on(event,(e,url)=>{if(url!=='about:blank'&&!webURL(url))e.preventDefault();});
  contents.setWindowOpenHandler(({url})=>{
    if(url!=='about:blank'&&!webURL(url))return {action:'deny'};
    return {action:'allow',overrideBrowserWindowOptions:{width:620,height:780,minWidth:400,minHeight:400,autoHideMenuBar:true,webPreferences:{session:contents.session,nodeIntegration:false,nodeIntegrationInSubFrames:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false}}};
  });
  contents.on('did-create-window',window=>{
    window.setMenuBarVisibility(false);attachBrowserWindows(window.webContents);
    const title=()=>{try{const url=new URL(window.webContents.getURL());window.setTitle(url.origin+' · MD Browser');}catch{window.setTitle('网页窗口 · MD Browser');}};
    window.webContents.on('page-title-updated',event=>{event.preventDefault();title();});window.webContents.on('did-navigate',title);
  });
}
module.exports={attachBrowserWindows,webURL};
