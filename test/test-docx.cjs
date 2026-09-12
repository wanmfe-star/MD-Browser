'use strict';
const assert=require('node:assert/strict');
const JSZip=require('jszip');
const {inspectDocx,editDocx}=require('../electron/docx');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
async function fixture() {
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Hello </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>world</w:t></w:r></w:p><w:p><w:r><w:t>第二段文字</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>保留表格</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:drawing/></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>');
  zip.file('word/styles.xml','<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>');
  zip.file('word/media/image.png',Buffer.from('unchanged image bytes'));
  zip.file('word/header1.xml','<header>unchanged header</header>');
  return zip.generateAsync({type:'nodebuffer'});
}
async function test() {
  const bytes=await fixture(),model=await inspectDocx(bytes);
  assert.equal(model.blocks.length,4);assert.equal(model.protectedCount,2);
  const rich=structuredClone(model.blocks).map(b=>({...b,richText:b.editable,runs:b.runs.map((r,index)=>({...r,origin:{id:b.id,index},overrides:{}}))}));
  require('../shared/word-runs').format(rich[0],6,11,{color:'#112233',size:18.5,bold:false});
  const styled=await inspectDocx(await editDocx(bytes,rich));
  assert.equal(styled.blocks[0].runs.at(-1).size,18.5);assert.equal(styled.blocks[0].runs.at(-1).italic,true);assert.equal(styled.blocks[0].runs[0].bold,true);
  const invalid=structuredClone(rich);invalid[0].runs[0].overrides={size:0};await assert.rejects(()=>editDocx(bytes,invalid),/字号/);
  invalid[0].runs[0].overrides={color:'bad'};await assert.rejects(()=>editDocx(bytes,invalid),/颜色/);
  invalid[0].runs[0].overrides={};invalid[0].runs[0].text='mismatch';await assert.rejects(()=>editDocx(bytes,invalid),/不一致/);
  const blocks=structuredClone(model.blocks);blocks[0].text='Hello brave world';
  Object.assign(blocks[0].format,{align:'center',line:2,before:6,after:12,indent:24});
  blocks.splice(1,1,{id:'new-test',sourceId:'b1',text:'新增段落\n第二行',format:{align:'right',line:1.5,before:0,after:8,indent:0}});
  const changed=await editDocx(bytes,blocks),loaded=await inspectDocx(changed);
  assert.equal(loaded.blocks[0].text,'Hello brave world');
  assert.deepEqual(loaded.blocks[0].format,blocks[0].format);
  assert.ok(loaded.blocks[0].runs.some(r=>r.text==='world'&&r.italic),'unchanged suffix keeps run styling');
  assert.ok(loaded.blocks[0].runs.some(r=>r.text.includes('Hello')&&r.bold),'prefix retains bold');
  assert.equal(loaded.blocks[1].text,'新增段落\n第二行');
  const oldZip=await JSZip.loadAsync(bytes),newZip=await JSZip.loadAsync(changed);
  for(const name of Object.keys(oldZip.files).filter(name=>name!=='word/document.xml')) assert.deepEqual(await newZip.file(name)?.async('nodebuffer'),await oldZip.file(name)?.async('nodebuffer'),name+' must remain unchanged');
  const xml=await newZip.file('word/document.xml').async('string');assert.match(xml,/<w:tbl>/);assert.match(xml,/<w:drawing\/>/);assert.match(xml,/w:pgSz/);
  await assert.rejects(editDocx(bytes,blocks.filter(b=>b.id!=='b2')),/受保护/);
  await assert.rejects(editDocx(bytes,[...blocks,blocks[0]]),/重复/);
  await assert.rejects(inspectDocx(Buffer.from('not word')));
  const protectedZip=await JSZip.loadAsync(bytes);protectedZip.file('word/settings.xml','<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:documentProtection w:enforcement="1"/></w:settings>');
  await assert.rejects(inspectDocx(await protectedZip.generateAsync({type:'nodebuffer'})),/编辑保护/);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'word-webdav-'));
  const {startWebDAVServer}=await import('./mock-webdav.mjs');const server=await startWebDAVServer(root);const webdav=require('../electron/webdav');
  try {
    await fs.writeFile(path.join(root,'file.docx'),bytes);
    await webdav.connect({url:'http://127.0.0.1:'+server.port});
    await webdav.writeDocx('/file.docx',changed,bytes);
    assert.deepEqual(await fs.readFile(path.join(root,'file.docx')),changed);
    await assert.rejects(webdav.writeDocx('/file.docx',bytes,bytes),/已被修改/);
    await assert.rejects(webdav.write('/file.docx','bad'),/纯文本/);
    assert.deepEqual(await fs.readFile(path.join(root,'file.docx')),changed);
    const local=path.join(root,'file.docx');
    const imported=await require('../electron/import-document').convertDocument(local,{preserveDocx:true});
    assert.equal(imported.kind,'docx');assert.deepEqual(Buffer.from(imported.bytes),changed);
  } finally {webdav.disconnect();await server.close();}
  console.log('DOCX checks passed: direct text/paragraph editing, run formatting, protected blocks, unchanged package parts, native import and remote conflicts');
}
module.exports={fixture};
if(require.main===module)test().catch(error=>{console.error(error);process.exitCode=1;});
