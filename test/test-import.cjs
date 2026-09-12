const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { createRequire } = require('node:module');
const iconv = require('iconv-lite');
const { convertDocument, decodeText } = require('../electron/import-document');
const fixture = name => path.join(path.dirname(require.resolve('mammoth/package.json')), 'test/test-data', name);
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'md-import-test-'));
  try {
    assert.equal(decodeText(Buffer.from('\uFEFF中文\r\n文本')), '中文\n文本');
    assert.equal(decodeText(iconv.encode('中文文本', 'gb18030')), '中文文本');
    assert.equal(decodeText(iconv.encode('中文', 'utf16-le', { addBOM: true })), '中文');
    const file = path.join(root, '笔记.text');
    await fs.writeFile(file, '# 原始文本\n');
    assert.deepEqual(await convertDocument(file), { name: '笔记.md', content: '# 原始文本\n', warnings: [] });
    const Zip = createRequire(require.resolve('mammoth'))('jszip');
    const zip = new Zip();
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
    zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/styles.xml', '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>');
    zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>导入测试</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>加粗文本</w:t></w:r></w:p></w:body></w:document>');
    const docx = path.join(root, '标题.docx');
    await fs.writeFile(docx, await zip.generateAsync({ type: 'nodebuffer' }));
    const result = await convertDocument(docx);
    assert.match(result.content, /# 导入测试/);
    assert.match(result.content, /\*\*加粗文本\*\*/);
    const table = await convertDocument(fixture('tables.docx'));
    assert.match(table.content, /\| ---/);
    const list = await convertDocument(fixture('simple-list.docx'));
    assert.match(list.content, /(?:- |1\.)/);
    const image = await convertDocument(fixture('tiny-picture.docx'));
    assert.match(image.content, /data:image\/png;base64,/);
    await fs.writeFile(path.join(root, 'bad.docx'), 'not a docx');
    await assert.rejects(convertDocument(path.join(root, 'bad.docx')));
    if (process.platform === 'darwin') {
      const legacy = path.join(root, 'legacy.doc');
      await promisify(execFile)('/usr/bin/textutil', ['-convert', 'doc', '-output', legacy, file]);
      assert.match((await convertDocument(legacy)).content, /原始文本/);
    }
    console.log('Import tests passed: TXT encodings, DOCX headings/bold/tables/lists/images, legacy DOC, corrupt document');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
