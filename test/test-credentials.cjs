const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createCredentialStore } = require('../electron/credentials');
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'md-credentials-test-'));
  const key = crypto.randomBytes(32);
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString(text) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString(data) {
      const cipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      cipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
    },
  };
  try {
    const store = createCredentialStore(root, encryption);
    assert.equal(await store.load(), null);
    const config = { url: 'https://example.test/dav/', username: 'test', password: 'test-secret-密码' };
    await store.save(config);
    const bytes = await fs.readFile(path.join(root, 'connection.enc'));
    assert.equal(bytes.includes(Buffer.from(config.password)), false);
    assert.deepEqual(await createCredentialStore(root, encryption).load(), config);
    await assert.rejects(createCredentialStore(root, { ...encryption, isEncryptionAvailable: () => false }).save(config));
    assert.deepEqual(await store.load(), config, 'failed save retains previous credentials');
    await assert.rejects(createCredentialStore(root, { ...encryption, getSelectedStorageBackend: () => 'basic_text' }, 'linux').save(config));
    await store.clear();
    assert.equal(await store.load(), null);
    console.log('Credential storage tests passed: persistence, encryption, unavailable backend, clear');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
