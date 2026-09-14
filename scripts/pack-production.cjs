'use strict';
const fs=require('node:fs');
const path=require('node:path');
const builderLib=require.resolve('app-builder-lib',{paths:[path.dirname(require.resolve('electron-builder'))]});
const asar=require(require.resolve('@electron/asar',{paths:[path.dirname(builderLib)]}));

// Copy the installed production tree explicitly: the builder's dependency collector
// can omit transitive packages from a hoisted pnpm installation.
async function packProduction(stage,resources){
  const payload=path.join(resources,'app');
  fs.rmSync(payload,{recursive:true,force:true});fs.mkdirSync(payload,{recursive:true});
  for(const name of ['electron','renderer','shared','assets','package.json'])fs.cpSync(path.join(stage,name),path.join(payload,name),{recursive:true});
  const modules=path.join(stage,'node_modules');
  fs.cpSync(modules,path.join(payload,'node_modules'),{recursive:true,dereference:true,filter:source=>{
    const relative=path.relative(modules,source);
    return !relative || !relative.split(path.sep)[0].startsWith('.');
  }});
  const expected=[];
  function walk(directory){for(const item of fs.readdirSync(directory,{withFileTypes:true})){
    const file=path.join(directory,item.name);
    if(item.isDirectory())walk(file);else if(item.isFile())expected.push(path.relative(payload,file).split(path.sep).join('/'));
  }}
  walk(payload);
  const archive=path.join(resources,'app.asar');
  fs.rmSync(archive,{force:true});fs.rmSync(archive+'.unpacked',{recursive:true,force:true});
  await asar.createPackageWithOptions(payload,archive,{unpack:'**/*.node'});
  const packed=new Set(asar.listPackage(archive).map(name=>name.replace(/^\//,'')));
  for(const name of expected)if(!packed.has(name))throw new Error('Missing release file: '+name);
  for(const name of ['webdav','node-fetch','data-uri-to-buffer','fetch-blob','formdata-polyfill','web-streams-polyfill']){
    asar.extractFile(archive,`node_modules/${name}/package.json`);
  }
  fs.rmSync(payload,{recursive:true,force:true});
  console.log(`PACKAGED_FILES_OK: ${expected.length} production files verified`);
}
module.exports={packProduction};
