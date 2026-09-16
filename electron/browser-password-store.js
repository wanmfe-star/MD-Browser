'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
function originOf(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)throw Error('密码功能仅支持 HTTPS 网站');return u.origin;}
function createStore(directory,encryption,platform=process.platform){
 const file=path.join(directory,'browser-passwords.enc');let pending=Promise.resolve();
 const serial=fn=>{const next=pending.then(fn);pending=next.catch(()=>{});return next;};
 function available(){if(!encryption.isEncryptionAvailable()||(platform==='linux'&&encryption.getSelectedStorageBackend()==='basic_text'))throw Error('系统加密存储不可用，无法保存或读取密码');}
 async function read(){let bytes;try{bytes=await fs.readFile(file);}catch(e){if(e.code==='ENOENT')return [];throw e;}available();const rows=JSON.parse(encryption.decryptString(bytes));if(!Array.isArray(rows))throw Error('密码库格式异常');return rows;}
 async function write(rows){available();const bytes=encryption.encryptString(JSON.stringify(rows));await fs.mkdir(directory,{recursive:true});try{await fs.writeFile(file+'.tmp',bytes,{mode:0o600});await fs.rename(file+'.tmp',file);}finally{await fs.rm(file+'.tmp',{force:true});}}
 return {
  save:(origin,username,password)=>serial(async()=>{origin=originOf(origin);if(typeof username!=='string'||!username||username.length>512||typeof password!=='string'||!password||password.length>4096)throw Error('请先填写有效的账号和密码');const rows=await read(),entry={origin,username,password};const i=rows.findIndex(r=>r.origin===origin&&r.username===username);if(i<0)rows.push(entry);else rows[i]=entry;await write(rows);}),
  list:()=>serial(async()=>(await read()).map(({origin,username})=>({origin,username}))),
  get:(origin,username)=>serial(async()=>{origin=originOf(origin);return (await read()).find(r=>r.origin===origin&&r.username===username)||null;}),
  remove:(origin,username)=>serial(async()=>{origin=originOf(origin);await write((await read()).filter(r=>r.origin!==origin||r.username!==username));}),
  clear:()=>serial(()=>fs.rm(file,{force:true}))
 };
}
module.exports={createStore,originOf};
