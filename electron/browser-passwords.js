'use strict';
const path=require('node:path'),{fileURLToPath}=require('node:url');
const {createStore,originOf}=require('./browser-password-store');
// Executed in an isolated world; no API or password database is exposed to the website.
function formOperation(mode,expected,entry){
 if(location.origin!==expected.origin || (expected.time && performance.timeOrigin!==expected.time))throw Error('页面已变化，请重新操作');
 const visible=e=>!e.disabled&&!e.readOnly&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
 const passwords=[...document.querySelectorAll('input[type="password"]')].filter(visible);
 if(passwords.length!==1||passwords[0].autocomplete==='new-password')throw Error('请打开只有一个密码框的登录页面；不支持注册、改密和内嵌登录框');
 const password=passwords[0],form=password.form;
 if(form && new URL(form.action||location.href,location.href).origin!==location.origin)throw Error('登录表单提交到其他网站，无法安全填充');
 const candidates=[...(form||document).querySelectorAll('input')].filter(e=>visible(e)&&['text','email','tel'].includes(e.type));
 const user=candidates.find(e=>e.autocomplete==='username')||candidates.filter(e=>!!(e.compareDocumentPosition(password)&Node.DOCUMENT_POSITION_FOLLOWING)).pop();
 if(!user)throw Error('未找到账号输入框，请使用网站原有的登录方式');
 if(mode==='probe')return {origin:location.origin,time:performance.timeOrigin};
 if(mode==='read')return {username:user.value,password:password.value,time:performance.timeOrigin};
 const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
 set.call(user,entry.username);set.call(password,entry.password);
 for(const e of [user,password]){e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}
 return true;
}
function install({ipcMain,dialog,app,safeStorage,getWindow}){
 const store=createStore(app.getPath('userData'),safeStorage),guests=new Map();let busy=false;
 function attach(guest){const record={guest,epoch:0};guests.set(guest.id,record);guest.on('did-start-navigation',(_event,_url,_inPlace,main)=>{if(main)record.epoch++;});guest.once('destroyed',()=>guests.delete(guest.id));}
 function authorize(event){if(event.sender!==getWindow()?.webContents)throw Error('不允许的调用来源');const u=new URL(event.senderFrame.url);if(u.protocol!=='file:'||path.resolve(fileURLToPath(u))!==path.resolve(__dirname,'../renderer/index.html'))throw Error('不允许的网页调用');}
 function current(id){const r=guests.get(id);if(!r||r.guest.isDestroyed())throw Error('请先打开网页');const origin=originOf(r.guest.getURL()),epoch=r.epoch;return {r,origin,check(){if(r.guest.isDestroyed()||r.epoch!==epoch||originOf(r.guest.getURL())!==origin)throw Error('页面已变化，请重新操作');}};}
 async function execute(s,mode,expected,entry){s.check();const result=await s.r.guest.executeJavaScriptInIsolatedWorld(1001,[{code:`(${formOperation.toString()})(${JSON.stringify(mode)},${JSON.stringify(expected)},${JSON.stringify(entry||null)})`}]);s.check();return result;}
 const prompt=options=>dialog.showMessageBox(getWindow(),{type:'question',noLink:true,...options});
 async function manage(){const rows=await store.list();if(!rows.length)return '尚未保存网站密码';const buttons=['取消','清除全部',...rows.map(r=>r.origin+' · '+r.username)];const choice=await prompt({title:'管理网站密码',message:'选择要删除的账号',detail:'这里只显示网站和账号，不显示密码。',buttons,cancelId:0,defaultId:0});if(!choice.response)return '';const row=rows[choice.response-2];if(choice.response!==1&&!row)return '';const yes=await prompt({message:choice.response===1?'清除所有网站密码？':'删除此网站账号的密码？',detail:row?row.origin+'\n'+row.username:'仅清除 MD Browser 保存的网站密码。',buttons:['取消','删除'],cancelId:0,defaultId:0});if(yes.response!==1)return '';if(row)await store.remove(row.origin,row.username);else await store.clear();return '已删除保存的密码';}
 ipcMain.handle('browser:password',async(event,action,id)=>{
  try{authorize(event);if(busy)throw Error('请先完成当前密码操作');if(!['save','fill','manage','menu'].includes(action))throw Error('无效操作');busy=true;
   try{
    if(action==='menu'){const choice=await prompt({title:'网站密码',message:'网站密码',detail:'密码在本机加密保存。仅支持 HTTPS 登录页面，填写账号和密码后可选择保存。',buttons:['取消','填充密码','保存当前密码','管理已保存密码'],cancelId:0,defaultId:0});action=['','fill','save','manage'][choice.response];if(!action)return {ok:true,data:''};}
    if(action==='manage')return {ok:true,data:await manage()};
    const s=current(id),expected=await execute(s,'probe',{origin:s.origin});
    if(action==='save'){
     const yes=await prompt({title:'保存网站密码',message:'保存此网站登录框中的账号和密码？',detail:s.origin+'\n密码仅在本机加密保存，不同步到网盘。',buttons:['取消','保存'],cancelId:0,defaultId:0});s.check();if(yes.response!==1)return {ok:true,data:''};
     const entry=await execute(s,'read',expected);await store.save(s.origin,entry.username,entry.password);return {ok:true,data:'密码已加密保存；下次点击“填充密码”即可使用'};
    }
    const rows=(await store.list()).filter(r=>r.origin===s.origin);s.check();if(!rows.length)return {ok:true,data:'此网站尚未保存密码'};
    const choice=await prompt({title:'填充网站密码',message:'选择要填充的账号',detail:s.origin+'\n仅填入当前登录框，不自动提交。',buttons:['取消',...rows.map(r=>r.username)],cancelId:0,defaultId:0});s.check();if(!choice.response)return {ok:true,data:''};
    const row=rows[choice.response-1];if(!row)throw Error('无效账号');const entry=await store.get(s.origin,row.username);if(!entry)throw Error('密码已删除');await execute(s,'fill',expected,entry);return {ok:true,data:'已填充，请检查账号后登录'};
   }finally{busy=false;}
  }catch(error){return {ok:false,error:error.message};}
 });
 return {attach};
}
module.exports={install,formOperation};
