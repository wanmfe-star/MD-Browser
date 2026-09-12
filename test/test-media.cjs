'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createMediaService}=require('../electron/media');
(async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'media-stream-')),bytes=Buffer.from('0123456789abcdef');
  await fs.writeFile(path.join(root,'media.mp3'),bytes);
  const requests=[];const server=await (await import('./mock-webdav.mjs')).startWebDAVServer(root,{onRequest:req=>requests.push({method:req.method,range:req.headers.range,auth:req.headers.authorization})});
  const webdav=require('../electron/webdav'),media=createMediaService(webdav);
  try {
    await webdav.connect({url:'http://127.0.0.1:'+server.port,username:'test',password:'test-password'});
    const ticket=media.open('/media.mp3');assert.ok(!ticket.url.includes('test-password'));
    const partial=await media.handle(new Request(ticket.url,{headers:{Range:'bytes=2-7'}}));
    assert.equal(partial.status,206);assert.equal(partial.headers.get('content-range'),'bytes 2-7/16');assert.equal(partial.headers.get('content-type'),'audio/mpeg');assert.equal(await partial.text(),'234567');
    const suffix=await media.handle(new Request(ticket.url,{headers:{Range:'bytes=-4'}}));assert.equal(await suffix.text(),'cdef');
    const head=await media.handle(new Request(ticket.url,{method:'HEAD'}));assert.equal(head.headers.get('content-length'),'16');assert.equal(await head.text(),'');
    assert.equal((await media.handle(new Request(ticket.url,{headers:{Range:'bytes=99-100'}}))).status,416);
    assert.equal((await media.handle(new Request(ticket.url,{headers:{Range:'bytes=0-1,4-5'}}))).status,416);
    assert.equal((await media.handle(new Request(ticket.url,{method:'POST'}))).status,405);
    assert.ok(requests.some(r=>r.range==='bytes=2-7'&&r.auth==='Basic '+Buffer.from('test:test-password').toString('base64')));
    const source=require('node:fs').createReadStream(path.join(root,'media.mp3'));
    await webdav.createMedia('/copy.mp3',source,bytes.length);assert.deepEqual(await fs.readFile(path.join(root,'copy.mp3')),bytes);
    await assert.rejects(webdav.createMedia('/copy.mp3',require('node:stream').Readable.from(Buffer.from('other')),5),/同名/);
    assert.deepEqual(await fs.readFile(path.join(root,'copy.mp3')),bytes);
    await assert.rejects(webdav.write('/media.mp3','text'),/纯文本/);
    media.release(ticket.url);assert.equal((await media.handle(new Request(ticket.url))).status,404);
    const again=media.open('/media.mp3');media.clear();assert.equal((await media.handle(new Request(again.url))).status,404);
    assert.throws(()=>media.open('/document.html'),/不支持/);
    const imported=await require('../electron/import-document').convertDocument(path.join(root,'media.mp3'));assert.equal(imported.media,true);assert.equal(imported.bytes,undefined);
    let signal;const pending=createMediaService({mediaReader:()=>async options=>{signal=options.signal;return {status:200,headers:new Headers(),body:new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(Error('aborted')));}})};}});
    const pendingTicket=pending.open('/wait.mp3');const stream=await pending.handle(new Request(pendingTicket.url));pending.release(pendingTicket.url);assert.equal(signal.aborted,true);await assert.rejects(stream.arrayBuffer());
    console.log('Media stream checks passed: authenticated byte ranges, HEAD, suffix/range errors, streaming upload, no overwrite, text-write protection and cancellation');
  }finally{media.clear();webdav.disconnect();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
