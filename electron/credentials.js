'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

function createCredentialStore(directory, encryption, platform = process.platform) {
  const file = path.join(directory, 'connection.enc');
  function ensureEncryption() {
    if (!encryption.isEncryptionAvailable() || (platform === 'linux' && encryption.getSelectedStorageBackend() === 'basic_text')) {
      throw new Error('系统加密存储不可用，连接密码未保存');
    }
  }
  return {
    async save({ url, username, password }) {
      ensureEncryption();
      const encrypted = encryption.encryptString(JSON.stringify({ url, username, password }));
      await fs.mkdir(directory, { recursive: true });
      const temporary = file + '.tmp';
      try {
        await fs.writeFile(temporary, encrypted, { mode: 0o600 });
        await fs.rename(temporary, file);
      } finally { await fs.rm(temporary, { force: true }); }
    },
    async load() {
      let encrypted;
      try { encrypted = await fs.readFile(file); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      ensureEncryption();
      const config = JSON.parse(encryption.decryptString(encrypted));
      if (!config || !['url', 'username', 'password'].every(key => typeof config[key] === 'string')) throw new Error('已保存的连接信息无效，请重新连接');
      return config;
    },
    async clear() { await fs.rm(file, { force: true }); },
  };
}
module.exports = { createCredentialStore };
