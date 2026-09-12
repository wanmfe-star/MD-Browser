const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { marked } = require('marked');
app.setPath('userData', path.join(os.tmpdir(), 'md-pdf-test-' + process.pid));
app.commandLine.appendSwitch('no-sandbox');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const { exportPDF } = require('../electron/export-pdf');
  const directory = path.join(__dirname, '../output/pdf');
  await fs.mkdir(directory, { recursive: true });
  const text = '# 文档导出排版验证\n\n这份文档用于验证中文段落、标题、列表、表格与代码的分页效果。\n\n> 保留内容的层次，让纸面阅读更清晰。\n\n## 一、阅读与记录\n\n' +
    Array.from({ length: 8 }, () => '阅读时，我们会不断记录新的想法。清晰的段落间距与适当的行距，可以帮助读者理解内容。导出时保留原文的顺序，不改写正文，也不添加额外的结论。').join('\n\n') +
    '\n\n## 二、行动清单\n\n- [x] 整理文档结构\n- [ ] 检查段落分页\n- [ ] 核对导出结果\n\n## 三、资料列表\n\n| 序号 | 主题 | 说明 |\n| --- | --- | --- |\n' +
    Array.from({ length: 28 }, (_, i) => `| ${i + 1} | 学习记录 | 中文表格内容应完整显示，跨页重复表头。 |`).join('\n') +
    '\n\n## 四、代码与链接\n\n```js\n' + Array.from({ length: 18 }, (_, i) => `const entry${i} = "这是一条需要完整保留的示例代码，长行应该自动换行，不应截断到纸张之外。";`).join('\n') + '\n```\n\n参考链接：[示例文档](https://example.com/document)。\n\n导出验证结束。';
  const result = await exportPDF({ title: '文档导出排版验证', html: marked.parse(text) }, path.join(directory, 'export-layout-check.pdf'));
  assert.equal(result.missingImages, 0);
  assert.equal((await fs.readFile(result.path)).subarray(0, 5).toString(), '%PDF-');
  const missing = await exportPDF({ title: '图片状态', html: '<h1>图片状态</h1><img src="data:image/png;base64,bad" alt="示例图片"><p>正文保持完整。</p>' }, path.join(directory, 'export-image-check.pdf'));
  assert.equal(missing.missingImages, 1);
  console.log('PDF_EXPORT_OK: multi-page layout, image failure reporting, valid PDF');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
