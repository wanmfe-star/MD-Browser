'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createService}=require('../electron/ai-service');
const encryption={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s.split('').reverse().join('')),decryptString:b=>b.toString().split('').reverse().join('')};
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ai-test-')),requests=[],events=[];
 const server=http.createServer(async(req,res)=>{let raw='';for await(const data of req)raw+=data;const body=raw?JSON.parse(raw):null;requests.push({url:req.url,body,auth:req.headers.authorization});
  if(req.url==='/models'){res.setHeader('Content-Type','application/json');res.end('{"data":[]}');return;}
  if(req.url==='/images/generations'){res.setHeader('Content-Type','application/json');res.end('{"data":[{"url":"https://example.com/image.png"}]}');return;}
  if(body.messages.at(-1).content.includes('错误测试')){res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'bad test-key-secret'}}));return;}
  if(!body.stream){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:body.messages[0].content.includes('搜索关键词生成器')?JSON.parse(body.messages.at(-1).content).question:'已整理摘要：关键信息及[第 1 页]。'}}]}));return;}
  res.writeHead(200,{'Content-Type':'text/event-stream'});const slow=body.messages.at(-1).content.includes('停止测试');let i=0;const timer=setInterval(()=>{if(i++===0)res.write('data: '+JSON.stringify({choices:[{delta:{content:'中文回答：已分析引用。'}}]})+'\n\n');else if(!slow){res.end('data: [DONE]\n\n');clearInterval(timer);}},20);res.on('close',()=>clearInterval(timer));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const baseURL='http://127.0.0.1:'+server.address().port;
 const service=createService({directory:dir,encryption,emit:e=>events.push(e)});const call=(a,p)=>service.dispatch(a,p);
 async function done(id){for(let i=0;i<300;i++){const e=events.findLast(e=>e.id===id&&e.type==='done');if(e)return e.conversation;await new Promise(r=>setTimeout(r,10));}throw Error('timeout');}
 try{
  await call('configure',{deepseek:{baseURL,model:'mock-model',key:'test-key-secret'},volcengine:{baseURL,model:'test-image',key:'test-image-key'}});
  const settings=await call('settings');assert.equal(settings.deepseek.hasKey,true);assert.ok(!JSON.stringify(settings).includes('test-key-secret'));assert.ok(!(await fs.readFile(path.join(dir,'ai/settings.enc'),'utf8')).includes('test-key-secret'));
  await call('test',{provider:'deepseek'});await call('test',{provider:'volcengine'});
  let c=await call('create');await call('send',{id:c.id,text:'解释这段话',sources:[{id:'doc',name:'文档.md',text:'这是原文',mode:'selection'}]});c=await done(c.id);assert.equal(c.messages.at(-1).status,'complete');assert.ok(c.messages.at(-1).content.includes('中文回答'));assert.ok(requests.at(-1).body.messages.at(-1).content.includes('这是原文'));
  events.length=0;await call('send',{id:c.id,text:'再举例',sources:c.messages[0].sources});await done(c.id);assert.ok(requests.at(-1).body.messages.some(m=>m.role==='assistant'&&m.content.includes('中文回答')));
  const reload=createService({directory:dir,encryption});assert.equal((await reload.dispatch('get',{id:c.id})).messages.length,4);assert.equal((await reload.dispatch('settings')).deepseek.hasKey,true);
  const long=await call('create');await call('send',{id:long.id,text:'全文总结',sources:[{id:'long',name:'长文.pdf',mode:'full',text:'[第 1 页] '+ '长文内容。'.repeat(6000)}]});assert.equal((await done(long.id)).messages.at(-1).analysisMode,'分段分析后汇总');assert.ok(events.some(e=>e.id===long.id&&e.type==='progress'&&e.text.includes('第')));
  const stop=await call('create');await call('send',{id:stop.id,text:'停止测试',sources:[]});await new Promise(r=>setTimeout(r,90));await assert.rejects(()=>call('send',{id:stop.id,text:'重复',sources:[]}));await call('cancel',{id:stop.id});assert.equal((await done(stop.id)).messages.at(-1).status,'stopped');
  const fail=await call('create');await call('send',{id:fail.id,text:'错误测试',sources:[]});const failed=await done(fail.id);assert.equal(failed.messages.at(-1).status,'error');assert.ok(!failed.messages.at(-1).error.includes('test-key-secret'));
  assert.equal((await call('image',{prompt:'测试图片'})).images.length,1);assert.equal(requests.at(-1).body.watermark,true);
  await call('rename',{id:c.id,title:'重命名会话'});assert.ok((await call('list')).some(c=>c.title==='重命名会话'));await call('delete',{id:c.id});assert.ok(!(await call('list')).some(x=>x.id===c.id));
  await call('configure',{deepseek:{baseURL,model:'mock-model',clearKey:true}});assert.equal((await call('settings')).deepseek.hasKey,false);
  await assert.rejects(()=>call('configure',{deepseek:{baseURL:'http://remote.example.com',model:'x'}}));
  await call('clear');assert.equal((await call('list')).length,0);console.log('AI_SERVICE_OK: encrypted keys, streaming, history, context, long text, cancellation, errors, images');
 }finally{service.close();server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
