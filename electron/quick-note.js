'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, screen } = require('electron');

const quickFlag = '--quick-note';
const minimumNoteSize = { width:360, height:300 };
function loginOptions() {
  const quote = value => '"' + value + '"';
  const args = app.isPackaged ? [] : [quote(app.getAppPath())];
  return { name: 'MD Browser Quick Note', path: quote(process.env.PORTABLE_EXECUTABLE_FILE || process.execPath),
    args: [...args, quickFlag] };
}
function loginEnabled() {
  if (process.platform !== 'win32') return null;
  const options = loginOptions();
  return app.getLoginItemSettings(options).launchItems.some(item =>
    item.scope === 'user' && item.name === options.name && item.enabled);
}
function setLogin(enabled) {
  if (process.platform !== 'win32') throw new Error('此开关适用于 Windows');
  app.setLoginItemSettings({ ...loginOptions(), openAtLogin: enabled, enabled });
  if (loginEnabled() !== enabled) throw new Error('请检查 Windows 启动应用设置');
  return enabled;
}
function createPreferences(directory) {
  const file = path.join(directory, 'quick-note.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { get data() { return data; }, update(values) {
    const next = { ...data, ...values };
    fs.mkdirSync(directory, { recursive:true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(next), {mode:0o600});
    fs.renameSync(file + '.tmp', file);
    data = next;
  } };
}
function quickBounds(bounds) {
  const area = (bounds ? screen.getDisplayMatching(bounds) : screen.getPrimaryDisplay()).workArea;
  const width = Math.max(minimumNoteSize.width, Math.min(area.width, bounds?.width || 390));
  const height = Math.max(minimumNoteSize.height, Math.min(area.height, bounds?.height || 345));
  return { width, height, x: Math.max(area.x, Math.min(bounds?.x ?? area.x+area.width-width-20, area.x+area.width-width)),
    y: Math.max(area.y, Math.min(bounds?.y ?? area.y+30, area.y+area.height-height)) };
}
let desktopWorker;
let commandId = 0;
function startDesktopWorker() {
  if (desktopWorker) return desktopWorker;
  const source = fs.readFileSync(path.join(__dirname, 'desktop-layer.cs'), 'utf8');
  // Compile the Win32 bridge once. Subsequent transitions only send a window handle.
  const command = `
    $ErrorActionPreference = 'Stop'
    Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(source).toString('base64')}')))
    while ($null -ne ($line = [Console]::ReadLine())) {
      $parts = $line.Split(' ')
      try {
        [DesktopLayer]::Apply([long]$parts[1], [uint32]${process.pid}, $parts[2] -eq '1')
        [Console]::WriteLine($parts[0] + ' OK')
      } catch {
        [Console]::WriteLine($parts[0] + ' ERROR')
      }
    }`;
  const exe = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const child = spawn(exe, ['-NoProfile','-NonInteractive','-Command',command], { windowsHide:true, stdio:'pipe' });
  const worker = { child, pending:new Map() };
  desktopWorker = worker;
  function fail() {
    if (desktopWorker === worker) desktopWorker = null;
    for (const request of worker.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('桌面窗口服务已停止，请重试'));
    }
    worker.pending.clear();
  }
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    output += chunk;
    let end;
    while ((end = output.indexOf('\n')) !== -1) {
      const [id,status] = output.slice(0,end).trim().split(' ');
      output = output.slice(end+1);
      const request = worker.pending.get(id);
      if (!request) continue;
      worker.pending.delete(id);
      clearTimeout(request.timer);
      if (status === 'OK') request.resolve();
      else request.reject(new Error('桌面挂载失败，请重试'));
    }
  });
  child.stderr.on('data', () => {});
  child.stdin.on('error', fail);
  child.on('error', fail);
  child.on('exit', fail);
  return worker;
}
async function desktopLayer(win, dock) {
  if (process.platform !== 'win32') return;
  const raw = win.getNativeWindowHandle();
  const handle = raw.length === 8 ? raw.readBigUInt64LE() : BigInt(raw.readUInt32LE());
  const worker = startDesktopWorker();
  const id = String(++commandId);
  return new Promise((resolve,reject) => {
    const timer = setTimeout(() => {
      worker.pending.delete(id);
      reject(new Error('桌面窗口服务响应超时，请重试'));
      worker.child.kill();
    }, 12000);
    worker.pending.set(id,{resolve,reject,timer});
    worker.child.stdin.write(id + ' ' + handle + ' ' + Number(dock) + '\n');
  });
}
app.on('will-quit', () => { desktopWorker?.child.stdin.end(); });
module.exports = { quickFlag, minimumNoteSize, createPreferences, loginEnabled, setLogin, quickBounds, desktopLayer };
