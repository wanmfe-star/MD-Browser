'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createStore,originOf}=require('../electron/browser-password-store');
(async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'md-password-test-'));try{
 const key=crypto.randomBytes(32);let available=true;
 const encryption={isEncryptionAvailable:()=>available,encryptString(text){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);const b=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),b]);},decryptString(bytes){const d=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));d.setAuthTag(bytes.subarray(12,28));return Buffer.concat([d.update(bytes.subarray(28)),d.final()]).toString();}};
 const store=createStore(dir,encryption);const secret='test-password-不可明文保存';
 await Promise.all([store.save('https://a.example/login','alice',secret),store.save('https://b.example','bob','second')]);
 assert.equal((await store.list()).length,2);assert.equal(JSON.stringify(await store.list()).includes(secret),false);
 const bytes=await fs.readFile(path.join(dir,'browser-passwords.enc'));assert.equal(bytes.includes(Buffer.from(secret)),false);assert.equal((await fs.stat(path.join(dir,'browser-passwords.enc'))).mode&0o777,0o600);
 assert.equal((await createStore(dir,encryption).get('https://a.example','alice')).password,secret);
 assert.equal(await store.get('https://sub.a.example','alice'),null);assert.equal(await store.get('https://a.example:444','alice'),null);
 for(const url of ['http://a.example','file:///tmp/a','https://user:pass@a.example'])assert.throws(()=>originOf(url));
 await store.save('https://a.example','alice','updated');assert.equal((await store.list()).length,2);assert.equal((await store.get('https://a.example','alice')).password,'updated');
 available=false;await assert.rejects(store.save('https://a.example','alice','unsafe'));available=true;
 const weak=createStore(dir,{...encryption,getSelectedStorageBackend:()=> 'basic_text'},'linux');await assert.rejects(weak.get('https://a.example','alice'));
 await store.remove('https://a.example','alice');assert.equal(await store.get('https://a.example','alice'),null);await store.clear();assert.deepEqual(await store.list(),[]);
 console.log('PASSWORD_STORE_OK: encryption, permissions, concurrency, persistence, exact origins, update, delete and unavailable encryption');
 }finally{await fs.rm(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
