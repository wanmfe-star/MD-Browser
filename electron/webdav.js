// WebDAV 客户端封装（主进程 / Node 环境）
// 封装 webdav 包，统一返回结构，隔离存储层，未来可替换成 Git/S3 等
'use strict';

let client = null;
let libPromise = null;

// webdav 5.x 是 ESM-only，主进程是 CJS，因此用动态 import 懒加载
async function getLib() {
  if (!libPromise) libPromise = import('webdav');
  return libPromise;
}

function getClient() {
  if (!client) throw new Error('尚未连接，请先填写连接信息');
  return client;
}

async function connect({ url, username, password }) {
  const { createClient, AuthType } = await getLib();
  // MOVE/COPY concatenate remoteURL directly into the Destination header.
  // Canonicalize the base too: fetch encodes request URLs, but never header values.
  const base = new URL(url.replace(/\/+$/, '') + '/').href;
  const candidate = createClient(base, {
    username: username || '',
    password: password || '',
    authType: AuthType.Password,
  });
  const root = await candidate.getDirectoryContents('/', { deep: false, details: true });
  client = candidate;
  return root.data.filter(isVisible).map(normalizeItem);
}

function disconnect() {
  client = null;
}

function isVisible(item) {
  if (item.basename.startsWith('.')) return false;
  for (const [name,raw] of Object.entries(item.props || {})) {
    const key=name.split(':').pop().toLowerCase(),value=raw && typeof raw==='object' ? raw['#text'] : raw;
    if (['ishidden','hidden'].includes(key) && ['1','true'].includes(String(value).toLowerCase())) return false;
    if (key==='win32fileattributes' && typeof value==='string' && /^[a-f0-9]+$/i.test(value) && (parseInt(value,16)&2)) return false;
  }
  return true;
}

function normalizeItem(it) {
  return {
    name: it.basename,
    path: it.filename,
    type: it.type, // 'file' | 'directory'
    size: it.size,
    mtime: it.lastmod,
    mime: it.mime,
  };
}

async function list(dir) {
  const items = await getClient().getDirectoryContents(dir, { deep: false, details: true });
  return items.data.filter(isVisible).map(normalizeItem);
}

async function read(path) {
  const data = await getClient().getFileContents(path, { format: 'text' });
  return typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
}

async function write(path, content) {
  if (require('../shared/media-types').type(path)) throw new Error('媒体文件不能写入纯文本');
  if (/\.(pdf|docx)$/i.test(path)) throw new Error('PDF 和 Word 必须以原格式保存，不能写入纯文本');
  await getClient().putFileContents(path, content, { overwrite: true });
  return true;
}

async function create(path, content) {
  if (/\.(pdf|docx)$/i.test(path) && typeof content === 'string') throw new Error('PDF 必须以原始二进制文件导入');
  const created = await getClient().putFileContents(path, content, { overwrite: false });
  if (!created) throw new Error('同名文件已存在，请使用其他名称');
  return true;
}

async function createMedia(path, stream, size) {
  const ok = await getClient().putFileContents(path, stream, { overwrite: false, headers: { 'Content-Length': String(size) } });
  if (!ok) throw new Error('同名文件已存在，请使用其他名称');
  return true;
}

function mediaReader(path) {
  const selectedClient = getClient();
  return ({ method = 'GET', range, signal }) => selectedClient.customRequest(path, {
    method, signal, headers: { 'Accept-Encoding': 'identity', ...(range ? { Range: range } : {}) },
  });
}

async function readBinary(path) {
  const data = await getClient().getFileContents(path, { format: 'binary' });
  return Buffer.from(data);
}

async function writePDF(path, bytes, expected) {
  if(!/\.pdf$/i.test(path))throw new Error('只能保存 PDF 文件');
  const currentClient=getClient();
  const current=await currentClient.getFileContents(path,{format:'binary',details:true});
  if(!Buffer.from(current.data).equals(Buffer.from(expected)))throw new Error('远程 PDF 已被修改，请重新打开后再编辑；当前标注仍保留');
  const etag=current.headers?.etag;
  const ok=await currentClient.putFileContents(path,Buffer.from(bytes),{overwrite:true,headers:etag ? {'If-Match':etag} : {}});
  if(!ok)throw new Error('PDF 保存失败，请重试');
  return true;
}

async function writeDocx(path, bytes, expected) {
  if (!/\.docx$/i.test(path)) throw new Error('只能保存 DOCX 文件');
  const currentClient = getClient();
  const current = await currentClient.getFileContents(path, { format: 'binary', details: true });
  if (!Buffer.from(current.data).equals(Buffer.from(expected))) throw new Error('远程 Word 已被修改，请重新打开后核对；当前修改仍保留');
  const etag = current.headers?.etag;
  if (!etag) throw new Error('服务器未提供版本标识，无法安全覆盖 Word 文件；当前修改仍保留');
  const ok = await currentClient.putFileContents(path, Buffer.from(bytes), { overwrite: true, headers: { 'If-Match': etag } });
  if (!ok) throw new Error('Word 保存失败，请重试');
  return true;
}

async function mkdir(path) {
  await getClient().createDirectory(path);
  return true;
}

async function remove(path) {
  await getClient().deleteFile(path);
  return true;
}

async function rename(from, to) {
  const source = from.replace(/\/+$/, '');
  const target = to.replace(/\/+$/, '');
  if (!source || !target || target === source || target.startsWith(source + '/')) {
    throw new Error('不能移动根目录，也不能将项目移入自身或子目录');
  }
  await getClient().moveFile(from, to, { overwrite: false });
  return true;
}

async function copy(from, to) {
  if (from === to) throw new Error('副本名称不能与原文件相同');
  const client = getClient();
  if (await client.exists(to)) throw new Error('同名文件已存在，请使用其他名称');
  await client.copyFile(from, to, { overwrite: false });
  return true;
}

async function exists(path) {
  return getClient().exists(path);
}

module.exports = { connect, disconnect, list, read, readBinary, mediaReader, createMedia, writePDF, writeDocx, write, create, mkdir, remove, rename, copy, exists };
