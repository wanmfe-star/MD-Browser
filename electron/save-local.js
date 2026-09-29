'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

function createLocalSaver(webdav, chooseDestination) {
  return async target => {
    if (typeof target !== 'string' || !target.startsWith('/') || target.includes('\0') || target.endsWith('/')) throw new Error('请选择文件');
    const reader = await webdav.fileDownloadReader(target);
    const name = path.posix.basename(target).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const result = await chooseDestination({ title: '保存到本地', defaultPath: name });
    if (result.canceled || !result.filePath) return null;
    const destination = result.filePath;
    const temporary = await fsp.mkdtemp(path.join(path.dirname(destination), '.md-download-'));
    const partial = path.join(temporary, 'file');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);
    try {
      const response = await reader({ signal: controller.signal });
      if (response.status !== 200 || !response.body) {
        response.body?.destroy?.();
        throw new Error('文件下载失败（HTTP ' + response.status + '）');
      }
      const stream = response.body.getReader ? Readable.fromWeb(response.body) : response.body;
      await pipeline(stream, fs.createWriteStream(partial, { flags: 'wx' }), { signal: controller.signal });
      await fsp.rename(partial, destination);
      return destination;
    } finally {
      controller.abort();
      clearTimeout(timeout);
      await fsp.rm(temporary, { recursive: true, force: true });
    }
  };
}

module.exports = { createLocalSaver };
