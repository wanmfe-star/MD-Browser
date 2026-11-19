'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
(async()=>{
  const appPath=path.resolve(process.argv[2] || (process.platform==='win32' ? 'dist/win-unpacked/MD Browser.exe' : 'dist/mac-arm64/MD Browser.app'));
  const portable=process.platform==='win32' && /-Portable\.exe$/i.test(appPath);
  const requests=[];
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'md-packaged-webdav-'));
  let server;
  try {
    await fs.writeFile(path.join(root,'readme.md'),'# Packaged client');
    server=await (await import('./mock-webdav.mjs')).startWebDAVServer(root,{onRequest:req=>requests.push(req.method+' '+req.url)});
    const env={...process.env,MD_BROWSER_SMOKE:'1',MD_BROWSER_TEST_WEBDAV_URL:`http://127.0.0.1:${server.port}/`};
    delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_PATH;delete env.NODE_OPTIONS;
    await new Promise((resolve,reject)=>{
      const child=spawn(process.platform==='win32' ? appPath : path.join(appPath,'Contents/MacOS/MD Browser'),[],{env,cwd:root});
      let output='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Packaged client test timed out'));},120000);
      child.stdout.on('data',data=>{output+=data;process.stdout.write(data);});
      child.stderr.on('data',data=>process.stderr.write(data));
      child.on('error',error=>{clearTimeout(timer);reject(error);});
      child.on('exit',code=>{
        clearTimeout(timer);
        // The NSIS portable launcher waits for Electron and forwards its exit code,
        // but does not forward stdout. Verify its real WebDAV traffic instead.
        const networkComplete=['GET /readme.md','PUT /created.md','GET /created.md','MOVE /created.md','DELETE /renamed.md','MKCOL /folder/','DELETE /folder','PUT /binary.pdf','GET /binary.pdf','DELETE /binary.pdf'].every(request=>requests.includes(request));
        const smokeComplete=output.includes('PACKAGED_WEBDAV_OK') && output.includes('SMOKE_OK');
        if(code===0 && networkComplete && (portable || smokeComplete))resolve();else reject(new Error('Packaged client network test failed: '+code+'; observed requests: '+requests.join(', ')));
      });
    });
    console.log('PACKAGED_CLIENT_OK: UI, WebDAV, text and PDF read/write, rename, mkdir and delete');
  } finally {if(server)await server.close();await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
})().catch(error=>{console.error(error);process.exitCode=1;});
