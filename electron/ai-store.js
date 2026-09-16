'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const defaults={deepseek:{baseURL:'https://api.deepseek.com',model:'deepseek-flash',key:''},volcengine:{baseURL:'https://ark.cn-beijing.volces.com/api/v3',model:'',key:''}};
function endpoint(value){const u=new URL(value);if(u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))throw Error('接口地址须为 HTTPS（本机测试可用 HTTP），不能含账号、查询参数或片段');return u.href.replace(/\/+$/,'');}
function createStore(directory,encryption){
 const dir=path.join(directory,'ai'),secret=path.join(dir,'settings.enc');let pending=Promise.resolve();
 const serial=fn=>{const p=pending.then(fn);pending=p.catch(()=>{});return p;};
 const file=id=>{if(!/^[\da-f-]{36}$/i.test(id))throw Error('无效的会话');return path.join(dir,id+'.json');};
 async function atomic(target,bytes){await fs.mkdir(dir,{recursive:true});await fs.writeFile(target+'.tmp',bytes,{mode:0o600});await fs.rename(target+'.tmp',target);}
 function available(){if(!encryption.isEncryptionAvailable()||encryption.getSelectedStorageBackend?.()==='basic_text')throw Error('系统安全存储不可用，无法保存 API Key');}
 async function settings(){try{available();return {...structuredClone(defaults),...JSON.parse(encryption.decryptString(await fs.readFile(secret)))};}catch(e){if(e.code==='ENOENT')return structuredClone(defaults);throw e;}}
 const publicSettings=s=>Object.fromEntries(Object.entries(s).filter(([k])=>k in defaults).map(([k,v])=>[k,{baseURL:v.baseURL,model:v.model,hasKey:!!v.key}]));
 return {
  settings,publicSettings:async()=>publicSettings(await settings()),
  configure:input=>serial(async()=>{const s=await settings();for(const provider of Object.keys(defaults)){const v=input?.[provider];if(!v)continue;const model=String(v.model||'').trim();if(model.length>200)throw Error('模型名称过长');const key=v.clearKey?'':v.key?String(v.key).trim():s[provider].key;if(key.length>4096||/[\r\n]/.test(key))throw Error('API Key 格式不正确');s[provider]={baseURL:endpoint(v.baseURL),model,key};}available();await atomic(secret,encryption.encryptString(JSON.stringify(s)));return publicSettings(s);}),
  async list(){await fs.mkdir(dir,{recursive:true});const list=[];for(const name of await fs.readdir(dir)){if(!/^[\da-f-]{36}\.json$/i.test(name))continue;const c=JSON.parse(await fs.readFile(path.join(dir,name),'utf8'));list.push({id:c.id,title:c.title,updatedAt:c.updatedAt,source:c.messages.find(m=>m.sources?.length)?.sources[0]?.name||''});}return list.sort((a,b)=>b.updatedAt-a.updatedAt);},
  get:async id=>JSON.parse(await fs.readFile(file(id),'utf8')),
  put:c=>serial(async()=>{c.updatedAt=Date.now();await atomic(file(c.id),JSON.stringify(c));return c;}),
  create:async()=>({id:randomUUID(),title:'新对话',createdAt:Date.now(),updatedAt:Date.now(),messages:[]}),
  remove:id=>serial(()=>fs.rm(file(id),{force:true})),
 };
}
module.exports={createStore,endpoint};
