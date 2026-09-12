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
  const base = url.replace(/\/+$/, '') + '/';
  const candidate = createClient(base, {
    username: username || '',
    password: password || '',
    authType: AuthType.Password,
  });
  const root = await candidate.getDirectoryContents('/', { deep: false });
  client = candidate;
  return root.map(normalizeItem);
}

function disconnect() {
  client = null;
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
  const items = await getClient().getDirectoryContents(dir, { deep: false });
  return items.map(normalizeItem);
}

async function read(path) {
  const data = await getClient().getFileContents(path, { format: 'text' });
  return typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
}

async function write(path, content) {
  if (/\.pdf$/i.test(path)) throw new Error('PDF 不支持文本写入，请使用原文件导入');
  await getClient().putFileContents(path, content, { overwrite: true });
  return true;
}

async function create(path, content) {
  if (/\.pdf$/i.test(path) && typeof content === 'string') throw new Error('PDF 必须以原始二进制文件导入');
  const created = await getClient().putFileContents(path, content, { overwrite: false });
  if (!created) throw new Error('同名文件已存在，请使用其他名称');
  return true;
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

async function exists(path) {
  return getClient().exists(path);
}

module.exports = { connect, disconnect, list, read, readBinary, writePDF, write, create, mkdir, remove, rename, exists };
