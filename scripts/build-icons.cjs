// Run with: electron scripts/build-icons.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const assets = path.join(__dirname, '../assets');
app.setPath('userData', path.join(os.tmpdir(), 'md-icon-build-' + process.pid));
app.commandLine.appendSwitch('no-sandbox');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true } });
  const svg = await fs.readFile(path.join(assets, 'logo.svg'), 'utf8');
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<html><body style="margin:0;background:transparent">' + svg + '</body></html>'));
  await new Promise(resolve => setTimeout(resolve, 250));
  const icon = (await win.webContents.capturePage()).resize({ width: 1024, height: 1024, quality: 'best' });
  await fs.writeFile(path.join(assets, 'icon.png'), icon.toPNG());
  if (process.platform === 'darwin') {
    const set = path.join(assets, 'md-browser.iconset');
    await fs.mkdir(set, { recursive: true });
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        await fs.writeFile(path.join(set, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`), icon.resize({ width: size * scale, height: size * scale, quality: 'best' }).toPNG());
      }
    }
    await promisify(execFile)('/usr/bin/iconutil', ['-c', 'icns', set, '-o', path.join(assets, 'md-browser.icns')]);
    await fs.rm(set, { recursive: true });
  }
  console.log('Icons generated in assets/');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
