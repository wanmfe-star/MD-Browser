'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),stage=path.join(root,'.electron-cache','release-app'),pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
fs.mkdirSync(stage,{recursive:true});
for(const name of ['electron','renderer','shared','assets']){
 const destination=path.resolve(stage,name);
 if(!destination.startsWith(stage+path.sep))throw Error('Invalid staging path');
 fs.rmSync(destination,{recursive:true,force:true});
 fs.cpSync(path.join(root,name),destination,{recursive:true});
}
const {build,scripts,devDependencies,...release}=pkg;
release.dependencies=Object.fromEntries(Object.keys(pkg.dependencies).map(name=>[name,JSON.parse(fs.readFileSync(path.join(root,'node_modules',name,'package.json'),'utf8')).version]));
fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify(release,null,2)+'\n');
const install=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['install','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:stage,stdio:'inherit',shell:process.platform==='win32'});if(install.status!==0)process.exit(install.status||1);
const config={...build,directories:{output:path.join(root,'dist')},electronDist:path.join(root,'node_modules/electron/dist'),win:{...build.win,icon:path.join(root,'assets/icon.png')}};
const configPath=path.join(stage,'builder-config.json');fs.writeFileSync(configPath,JSON.stringify(config,null,2));
const result=spawnSync(process.execPath,[require.resolve('electron-builder/cli.js'),'--projectDir',stage,'--config',configPath,'--win','nsis','portable','--x64','--publish','never'],{cwd:root,stdio:'inherit'});process.exit(result.status??1);
