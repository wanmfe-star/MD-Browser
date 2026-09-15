// 客户端层集成测试：用本地 mock WebDAV 服务器验证 connect/list/read/write/mkdir/rename/remove
import { startWebDAVServer } from './mock-webdav.mjs';
import { createRequire } from 'node:module';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const webdav = require('../electron/webdav.js');

let failures = 0;
function check(name, cond, extra) {
  console.log((cond ? '✅ ' : '❌ ') + name + (extra ? '  →  ' + extra : ''));
  if (!cond) failures++;
}

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'md-webdav-'));
await fsp.writeFile(path.join(root, 'README.md'), '# Hello\n\n这是 **测试** 文档。\n');
await fsp.mkdir(path.join(root, 'notes'));
await fsp.writeFile(path.join(root, 'notes', 'todo.md'), '## TODO\n\n- [ ] 事项一\n- [x] 事项二\n');

for(const name of ['.DS_Store','._README.md','server-hidden.pdf'])await fsp.writeFile(path.join(root,name),'hidden');
await fsp.mkdir(path.join(root,'.hidden-folder'));
await fsp.writeFile(path.join(root,'notes','._todo.md'),'apple metadata');
const { port, close } = await startWebDAVServer(root,{hiddenNames:['server-hidden.pdf']});
const base = `http://127.0.0.1:${port}/`;

try {
  const connected = await webdav.connect({ url: base, username: 'u', password: 'p' });
  check('首次连接过滤隐藏文件、目录及服务端隐藏标记',connected.length===2);
  check('过滤不会删除远程文件',await fsp.readFile(path.join(root,'._README.md'),'utf8')==='hidden');

  const rootList = await webdav.list('/');
  check('list 根目录返回 2 项', rootList.length === 2, JSON.stringify(rootList.map((i) => i.name)));
  check('根目录含文件 README.md', rootList.some((i) => i.name === 'README.md' && i.type === 'file'));
  check('根目录含目录 notes', rootList.some((i) => i.name === 'notes' && i.type === 'directory'));

  const readme = await webdav.read('/README.md');
  check('read 读取内容正确', readme === '# Hello\n\n这是 **测试** 文档。\n', JSON.stringify(readme));

  const notesList = await webdav.list('/notes');
  check('list 子目录 notes', notesList.length === 1 && notesList[0].name === 'todo.md', JSON.stringify(notesList.map((i) => i.name)));

  await webdav.write('/新文件.md', '## 新文件\n内容。\n');
  const afterWrite = await webdav.list('/');
  check('write 新建文件成功', afterWrite.some((i) => i.name === '新文件.md'));

  const newRead = await webdav.read('/新文件.md');
  check('read 回读新文件一致', newRead === '## 新文件\n内容。\n');

  await webdav.write('/notes/todo.md', '- [x] 已修改\n');
  const updated = await webdav.read('/notes/todo.md');
  check('write 覆盖已有文件', updated === '- [x] 已修改\n');

  await webdav.create('/created.md', '原始内容');
  let createRejected = false;
  try { await webdav.create('/created.md', '意外覆盖'); } catch { createRejected = true; }
  check('新建同名文件被拒绝且原内容保留', createRejected && await webdav.read('/created.md') === '原始内容');
  let renameRejected = false;
  try { await webdav.rename('/created.md', '/README.md'); } catch { renameRejected = true; }
  check('重命名不覆盖目标且源文件保留', renameRejected && await webdav.read('/README.md') === readme && await webdav.read('/created.md') === '原始内容');

  await webdav.mkdir('/sub');
  const afterMkdir = await webdav.list('/');
  check('mkdir 新建目录', afterMkdir.some((i) => i.name === 'sub' && i.type === 'directory'));

  await webdav.rename('/新文件.md', '/renamed.md');
  const afterRename = await webdav.list('/');
  check('rename 成功且旧名消失', afterRename.some((i) => i.name === 'renamed.md') && !afterRename.some((i) => i.name === '新文件.md'));

  await webdav.mkdir('/archive');
  await webdav.rename('/sub', '/archive/sub');
  check('文件夹跨目录移动成功', await webdav.exists('/archive/sub') && !await webdav.exists('/sub'));
  let selfRejected = false;
  try { await webdav.rename('/archive', '/archive/sub/nested'); } catch { selfRejected = true; }
  check('拒绝将文件夹移入自身子目录', selfRejected && await webdav.exists('/archive/sub'));
  await webdav.write('/archive/sub/child.md', 'child');
  await webdav.remove('/archive');
  check('删除文件夹及其内容', !await webdav.exists('/archive'));

  const pdfBytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from([0, 128, 255, 10])]);
  await webdav.create('/binary.pdf', pdfBytes);
  check('PDF 二进制上传回读完全一致', (await webdav.readBinary('/binary.pdf')).equals(pdfBytes));
  await webdav.copy('/binary.pdf', '/副本.pdf');
  check('复制保留二进制内容及原文件', (await webdav.readBinary('/副本.pdf')).equals(pdfBytes) && (await webdav.readBinary('/binary.pdf')).equals(pdfBytes));
  let copyRejected = false;
  try { await webdav.copy('/created.md', '/副本.pdf'); } catch { copyRejected = true; }
  check('复制不覆盖同名目标', copyRejected && (await webdav.readBinary('/副本.pdf')).equals(pdfBytes));
  let textWriteRejected = false;
  try { await webdav.write('/binary.pdf', 'text'); } catch { textWriteRejected = true; }
  check('拒绝以文本覆盖 PDF', textWriteRejected && (await webdav.readBinary('/binary.pdf')).equals(pdfBytes));

  await webdav.remove('/renamed.md');
  const afterRemove = await webdav.list('/');
  check('remove 删除成功', !afterRemove.some((i) => i.name === 'renamed.md'));

  // Destination must also encode the connection's base directory, not only the filename.
  const scoped='学习资料/课程 01';
  await fsp.mkdir(path.join(root,scoped),{recursive:true});
  for(const suffix of [scoped,scoped.split('/').map(encodeURIComponent).join('/')]){
    await webdav.connect({url:base+suffix,username:'u',password:'p'});
    await webdav.create('/原稿.smm','中文内容');
    await webdav.rename('/原稿.smm','/新名称 #1.smm');
    check('中文连接目录重命名（原始或已编码地址）',await webdav.read('/新名称 #1.smm')==='中文内容');
    await webdav.copy('/新名称 #1.smm','/副本 100%.smm');
    check('中文连接目录复制',await webdav.read('/副本 100%.smm')==='中文内容');
    await webdav.mkdir('/子目录');
    await webdav.rename('/副本 100%.smm','/子目录/移动.smm');
    check('中文连接目录移动',await webdav.read('/子目录/移动.smm')==='中文内容');
    await webdav.remove('/子目录');await webdav.remove('/新名称 #1.smm');
  }
  await webdav.disconnect();

  // 未连接时报错
  let threw = false;
  try { await webdav.list('/'); } catch { threw = true; }
  check('断开后调用 list 会报错', threw);
} catch (e) {
  failures++;
  console.error('测试抛出异常：', e);
} finally {
  await close();
}

console.log(failures === 0 ? '\n全部通过 🎉' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
