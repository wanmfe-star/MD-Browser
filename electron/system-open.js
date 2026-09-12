'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

function createSystemOpener(webdav, shell, cacheRoot) {
  return async function open(target) {
    if (typeof target !== 'string' || !target.startsWith('/') || target.includes('\0') || target.endsWith('/')) throw Error('无效的远程文件路径');
    const reader = webdav.mediaReader(target);
    // Keep the original extension; isolate each download so repeated opens cannot overwrite local edits.
    let name = path.posix.basename(target).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
    if (!name || name === '.' || name === '..') throw Error('无效的文件名');
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
    await fsp.mkdir(cacheRoot, { recursive: true });
    const directory = await fsp.mkdtemp(path.join(cacheRoot, 'file-'));
    const destination = path.join(directory, name);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);
    try {
      const response = await reader({ signal: controller.signal });
      if (response.status !== 200 || !response.body) { response.body?.destroy?.(); throw Error('文件下载失败（HTTP ' + response.status + '）'); }
      const stream = response.body.getReader ? Readable.fromWeb(response.body) : response.body;
      await pipeline(stream, fs.createWriteStream(destination, { flags: 'wx' }), { signal: controller.signal });
    } catch (error) {
      controller.abort();
      await fsp.rm(directory, { recursive: true, force: true });
      throw error;
    } finally { clearTimeout(timeout); }
    const error = await shell.openPath(destination);
    if (error) throw Error('系统无法打开此文件，请先安装或设置关联程序：' + error);
    return true;
  };
}
module.exports = { createSystemOpener };
