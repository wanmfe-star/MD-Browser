'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createLocalSaver } = require('../electron/save-local');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'md-save-test-'));
  const destination = path.join(root, '中文.pdf');
  const bytes = Buffer.from([0, 255, 13, 10, 128, 65]);
  let requested = 0;
  let fail = false;
  const webdav = { fileDownloadReader: async target => {
    if (target === '/folder') throw new Error('只能保存文件');
    return async () => {
      requested++;
      return { status: 200, body: fail ? Readable.from((async function* () {
        yield bytes;
        throw new Error('connection interrupted');
      })()) : Readable.from([bytes]) };
    };
  } };
  const save = createLocalSaver(webdav, async options => {
    assert.equal(options.defaultPath, '中文.pdf');
    return { filePath: destination };
  });
  try {
    assert.equal(await save('/资料/中文.pdf'), destination);
    assert.deepEqual(await fs.readFile(destination), bytes);
    fail = true;
    await assert.rejects(save('/资料/中文.pdf'), /interrupted/);
    assert.deepEqual(await fs.readFile(destination), bytes, 'failed download preserves destination');
    assert.deepEqual(await fs.readdir(root), ['中文.pdf'], 'partial download cleaned up');
    const cancel = createLocalSaver(webdav, async () => ({ canceled: true }));
    const before = requested;
    assert.equal(await cancel('/中文.pdf'), null);
    assert.equal(requested, before, 'cancel does not download');
    await assert.rejects(save('/folder'), /只能保存文件/);
    await assert.rejects(save('/folder/'), /请选择文件/);
    console.log('save-local: binary preservation, cancellation, folder rejection and failure cleanup passed');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
