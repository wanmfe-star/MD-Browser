'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const stage = path.join(root, '.electron-cache', 'release-mac');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (process.platform !== 'darwin') throw new Error('macOS packaging must run on a Mac');
fs.mkdirSync(stage, { recursive: true });
for (const name of ['electron', 'renderer', 'shared', 'assets']) {
  fs.rmSync(path.join(stage, name), { recursive: true, force: true });
  fs.cpSync(path.join(root, name), path.join(stage, name), { recursive: true });
}
const { build, scripts, devDependencies, ...release } = pkg;
release.dependencies = Object.fromEntries(Object.keys(pkg.dependencies).map(name => [name,
  JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version]));
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(release, null, 2));
const install = spawnSync(process.env.PNPM_BIN || 'pnpm', ['install', '--ignore-workspace', '--prod', '--ignore-scripts', '--node-linker=hoisted', '--store-dir', path.join(root, '.pnpm-store')], { cwd: stage, stdio: 'inherit' });
if (install.status !== 0) process.exit(install.status || 1);
const config = {
  appId: build.appId, productName: build.productName, asar: false, npmRebuild: false,
  directories: { output: path.join(root, 'dist') }, files: build.files,
  electronDist: path.join(root, 'node_modules/electron/dist'), electronVersion: build.electronVersion,
  mac: { target: ['dir'], icon: path.join(root, 'assets/md-browser.icns'), identity: null,
    category: 'public.app-category.productivity', artifactName: 'MD-Browser-${version}-mac-${arch}.${ext}' }
};
const configPath = path.join(stage, 'builder-config.json');
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
const result = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--projectDir', stage, '--config', configPath, '--mac', '--dir', '--' + process.arch, '--publish', 'never'], { cwd: root, stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
if(result.status !== 0)process.exit(result.status ?? 1);
function run(command,args){const r=spawnSync(command,args,{stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);}
const appPath=path.join(root,'dist',process.arch==='arm64'?'mac-arm64':'mac',build.productName+'.app');
const packed=spawnSync(process.execPath,['-e',`require(${JSON.stringify(path.join(root,'scripts/pack-production.cjs'))}).packProduction(${JSON.stringify(stage)},${JSON.stringify(path.join(appPath,'Contents/Resources'))}).catch(e=>{console.error(e);process.exit(1)})`],{stdio:'inherit'});
if(packed.status!==0)process.exit(packed.status||1);
run('/usr/bin/codesign',['--force','--deep','--sign','-',appPath]);
run('/usr/bin/codesign',['--verify','--deep','--strict',appPath]);
run(process.execPath,[path.join(root,'test/test-packaged-client.cjs'),appPath]);
const artifact=path.join(root,'dist',`MD-Browser-${pkg.version}-mac-${process.arch}`);
fs.rmSync(artifact+'.zip',{force:true});
run('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',appPath,artifact+'.zip']);
const dmgStage=path.join(root,'.electron-cache','mac-dmg');
fs.rmSync(dmgStage,{recursive:true,force:true});fs.mkdirSync(dmgStage,{recursive:true});
run('/usr/bin/ditto',[appPath,path.join(dmgStage,build.productName+'.app')]);
fs.symlinkSync('/Applications',path.join(dmgStage,'Applications'));
run('/usr/bin/hdiutil',['create','-volname',build.productName,'-srcfolder',dmgStage,'-ov','-format','UDZO',artifact+'.dmg']);
