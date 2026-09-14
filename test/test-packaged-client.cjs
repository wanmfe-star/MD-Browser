'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
(async()=>{
  const appPath=path.resolve(process.argv[2] || 'dist/mac-arm64/MD Browser.app');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'md-packaged-webdav-'));
  let server;
  try {
    await fs.writeFile(path.join(root,'readme.md'),'# Packaged client');
    server=await (await import('./mock-webdav.mjs')).startWebDAVServer(root);
    const env={...process.env,MD_BROWSER_SMOKE:'1',MD_BROWSER_TEST_WEBDAV_URL:`http://127.0.0.1:${server.port}/`};
    delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_PATH;delete env.NODE_OPTIONS;
    await new Promise((resolve,reject)=>{
      const child=spawn(path.join(appPath,'Contents/MacOS/MD Browser'),[],{env,cwd:root});
      let output='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Packaged client test timed out'));},60000);
      child.stdout.on('data',data=>{output+=data;process.stdout.write(data);});
      child.stderr.on('data',data=>process.stderr.write(data));
      child.on('error',error=>{clearTimeout(timer);reject(error);});
      child.on('exit',code=>{clearTimeout(timer);if(code===0 && output.includes('PACKAGED_WEBDAV_OK') && output.includes('SMOKE_OK'))resolve();else reject(new Error('Packaged client network test failed: '+code));});
    });
    console.log('PACKAGED_CLIENT_OK: UI, WebDAV, text and PDF read/write, rename, mkdir and delete');
  } finally {if(server)await server.close();await fs.rm(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
