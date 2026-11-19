'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const digest = text => createHash('sha256').update(text).digest('hex');
const noteId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

function atomicWrite(file, text) {
  const temp = file + '.tmp';
  fs.writeFileSync(temp, text, { mode: 0o600 });
  fs.renameSync(temp, file);
}

function createStore(directory, changed = () => {}) {
  const receiptsFile = path.join(directory, '.backups.json');
  const notes = new Map();
  let receipts, target, running = false, timer;
  function load() {
    if (receipts) return;
    fs.mkdirSync(directory, { recursive: true });
    const saved = fs.existsSync(receiptsFile) ? JSON.parse(fs.readFileSync(receiptsFile, 'utf8')) : {};
    for (const file of fs.readdirSync(directory)) {
      const id = path.basename(file, '.md');
      if (!file.endsWith('.md') || !noteId.test(id)) continue;
      const raw = fs.readFileSync(path.join(directory, file), 'utf8');
      const match = /^---\r?\ntitle: (.*)\r?\ntags: (.*)\r?\nupdated: (.*)\r?\n---\r?\n\r?\n/.exec(raw);
      if (!match) throw new Error('无法读取便签格式：' + file);
      notes.set(id, { id, title: JSON.parse(match[1]), tags: JSON.parse(match[2]), updated: match[3].trim(), body: raw.slice(match[0].length), hash: digest(raw), raw });
    }
    receipts = saved;
  }
  function status(id) {
    const receipt = receipts[id];
    if (target && receipt && target.key !== receipt.key) return '等待原 WebDAV 连接';
    return receipt?.hash === notes.get(id)?.hash && receipt ? 'WebDAV 已备份' : '等待 WebDAV 备份';
  }
  function get(id) {
    load();
    const n = notes.get(id);
    if (!n) return null;
    const { raw, hash, ...data } = n;
    return { ...data, backup: status(id) };
  }
  function save(id, { title, tags, body }) {
    load();
    if (!noteId.test(id) || typeof title !== 'string' || typeof body !== 'string' || !Array.isArray(tags) || tags.some(t => typeof t !== 'string')) throw new Error('便签数据无效');
    const updated = new Date().toISOString();
    const raw = '---\ntitle: ' + JSON.stringify(title) + '\ntags: ' + JSON.stringify(tags) + '\nupdated: ' + updated + '\n---\n\n' + body;
    if (target && !receipts[id]) record(id, { key: target.key });
    atomicWrite(path.join(directory, id + '.md'), raw);
    notes.set(id, { id, title, tags, body, updated, raw, hash: digest(raw) });
    changed(id);
    schedule();
    return get(id);
  }
  function record(id, receipt) {
    const next = { ...receipts, [id]: receipt };
    atomicWrite(receiptsFile, JSON.stringify(next));
    receipts = next;
  }
  function remove(id) {
    load();
    if (!notes.has(id)) throw new Error('找不到便签');
    const trash = path.join(directory, '回收站');
    fs.mkdirSync(trash, { recursive:true });
    const file = id + '.md';
    const archived = path.join(trash, file);
    fs.renameSync(path.join(directory,file), fs.existsSync(archived) ? path.join(trash,randomUUID()+'.md') : archived);
    notes.delete(id);
    changed(id);
    if (receipts[id]) record(id, undefined);
  }
  function schedule(delay = 250) {
    clearTimeout(timer);
    timer = setTimeout(() => drain().catch(error => console.warn('便签备份：', error.message)), delay);
    timer.unref();
  }
  async function drain() {
    if (!target || running) return;
    running = true;
    const destination = target;
    try {
      load();
      for (const [id, n] of notes) {
        if (target !== destination) break;
        const receipt = receipts[id];
        if (receipt && (receipt.key !== destination.key || receipt.hash === n.hash)) continue;
        if (!receipt) record(id, { key: destination.key });
        await destination.upload(id, n.raw);
        if (!notes.has(id)) continue;
        record(id, { key: destination.key, hash: n.hash });
        changed(id);
      }
    } finally {
      running = false;
      if (target && Array.from(notes.keys()).some(id => status(id) === '等待 WebDAV 备份')) schedule(10000);
    }
  }
  return { get, save, remove, drain, newId: randomUUID, list() { load(); return [...notes.keys()].map(get).sort((a,b) => b.updated.localeCompare(a.updated)); },
    connect(destination) { target = destination; schedule(); changed(); },
    disconnect() { target = null; clearTimeout(timer); changed(); } };
}
module.exports = { createStore };
