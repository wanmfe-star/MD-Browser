'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const mammoth = require('mammoth');
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');
const iconv = require('iconv-lite');
const run = promisify(execFile);
const MAX_BYTES = 20 * 1024 * 1024;

function decodeText(buffer) {
  let text;
  if (buffer[0] === 0xff && buffer[1] === 0xfe) text = iconv.decode(buffer, 'utf16-le');
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) text = iconv.decode(buffer, 'utf16-be');
  else {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch { text = iconv.decode(buffer, 'gb18030'); }
  }
  if (text.includes('\0')) throw new Error('文件不像纯文本，请转换为 UTF-8 或带 BOM 的 UTF-16 文本后导入');
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

async function convertDocument(filePath, { preserveDocx = false } = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const mediaType = require('../shared/media-types').type(filePath);
  if (!mediaType && !['.smm', '.mindmap', '.md', '.markdown', '.docx', '.doc', '.txt', '.text', '.pdf'].includes(ext)) throw new Error('请选择支持的文档、音乐、视频或图片文件');
  const stat = await fs.stat(filePath);
  const limit = mediaType ? 2 * 1024 * 1024 * 1024 : ext === '.pdf' ? 50 * 1024 * 1024 : MAX_BYTES;
  if (!stat.isFile() || stat.size > limit) throw new Error(mediaType ? '请选择不超过 2 GB 的媒体文件' : ext === '.pdf' ? '请选择不超过 50 MB 的 PDF' : '请选择不超过 20 MB 的文档');
  if (mediaType) return { name: path.basename(filePath), kind: mediaType.kind, media: true, sourcePath: filePath, warnings: [] };
  let buffer = await fs.readFile(filePath);
  if (['.smm','.mindmap'].includes(ext)) {
    const content=decodeText(buffer);const data=JSON.parse(content);if(!(data.root||data)?.data)throw Error('不是有效的思维导图文件');
    return {name:path.basename(filePath),kind:'mindmap',content,warnings:[]};
  }
  if (ext === '.pdf') {
    require('./pdf-file').validatePDF(buffer);
    return { name: path.basename(filePath), kind: 'pdf', bytes: new Uint8Array(buffer), warnings: [] };
  }
  if (ext === '.docx' && preserveDocx) {
    await require('./docx').inspectDocx(buffer);
    return { name: path.basename(filePath), kind: 'docx', bytes: new Uint8Array(buffer), warnings: [] };
  }
  const warnings = [];
  let content;
  if (['.md', '.markdown', '.txt', '.text'].includes(ext)) {
    content = decodeText(buffer);
  } else {
    if (ext === '.doc') {
      if (process.platform !== 'darwin') throw new Error('旧版 .doc 请先在 Word 中另存为 .docx 再导入');
      const converted = await run('/usr/bin/textutil', ['-convert', 'docx', '-stdout', '-noload', '-nostore', '--', filePath], {
        encoding: 'buffer', maxBuffer: 40 * 1024 * 1024, timeout: 30000,
      });
      buffer = converted.stdout;
      warnings.push('旧版 Word 经系统转换，部分格式可能简化。');
    }
    let imageBytes = 0;
    const result = await mammoth.convertToHtml({ buffer }, {
      externalFileAccess: false,
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='标题'] => h1:fresh"],
      convertImage: mammoth.images.imgElement(async image => {
        const data = await image.read('base64');
        imageBytes += data.length;
        if (imageBytes > 15 * 1024 * 1024 || !/^image\/(png|jpeg|gif|webp|bmp)$/.test(image.contentType)) {
          warnings.push('部分图片过大或格式不受支持，已保留说明文字。');
          return { src: '', alt: image.altText || '未导入的图片' };
        }
        return { src: 'data:' + image.contentType + ';base64,' + data };
      }),
    });
    if (result.messages.length) warnings.push('部分 Word 特殊样式无法完整转换，请检查导入结果。');
    const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
    converter.use(gfm);
    converter.addRule('wordTables', {
      filter: 'table',
      replacement: (_text, node) => {
        const rows = Array.from(node.rows);
        if (!rows.length) return '';
        if (node.querySelector('table') || Array.from(node.querySelectorAll('td,th')).some(cell => cell.colSpan > 1 || cell.rowSpan > 1)) {
          warnings.push('包含合并单元格或嵌套的表格以 HTML 保留。');
          return '\n\n' + node.outerHTML + '\n\n';
        }
        const values = rows.map(row => Array.from(row.cells).map(cell => converter.turndown(cell.innerHTML).replace(/\n+/g, '<br>').replace(/\|/g, '\\|')));
        const width = Math.max(...values.map(row => row.length));
        const header = Array.from(rows[0].cells).every(cell => cell.nodeName === 'TH') ? values.shift() : Array(width).fill('');
        const line = cells => '| ' + Array.from({ length: width }, (_, i) => cells[i] || '').join(' | ') + ' |';
        return '\n\n' + [line(header), line(Array(width).fill('---')), ...values.map(line)].join('\n') + '\n\n';
      },
    });
    converter.remove(['script', 'style']);
    converter.addRule('missingImage', {
      filter: node => node.nodeName === 'IMG' && !node.getAttribute('src'),
      replacement: (_text, node) => '[' + (node.getAttribute('alt') || '未导入的图片') + ']',
    });
    content = converter.turndown(result.value) + '\n';
  }
  if (Buffer.byteLength(content, 'utf8') > 30 * 1024 * 1024) throw new Error('转换后的文档过大，请减少内嵌图片后重试');
  return { name: path.basename(filePath, path.extname(filePath)) + '.md', content, warnings: [...new Set(warnings)] };
}
module.exports = { convertDocument, decodeText };
