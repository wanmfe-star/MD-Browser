'use strict';
const assert=require('node:assert/strict'),JSZip=require('jszip'),{DOMParser,XMLSerializer}=require('@xmldom/xmldom');
const {fixture}=require('./test-docx.cjs'),{inspectDocx,editDocx}=require('../electron/docx'),runs=require('../shared/word-runs');
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
async function complexFixture(){
 const zip=await JSZip.loadAsync(await fixture());
 const paragraph='<w:p w:rsidR="00112233"><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr><w:sectPr><w:pgSz w:w="11906"/></w:sectPr></w:pPr><w:bookmarkStart w:id="1" w:name="section"/><w:r><w:rPr><w:lang w:val="zh-CN"/></w:rPr><w:t xml:space="preserve">开头 </w:t></w:r><w:hyperlink r:id="link1"><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>超链接文字</w:t></w:r></w:hyperlink><w:r><w:t>图前</w:t><w:drawing><a:graphic/></w:drawing><w:tab/><w:t>图后</w:t><w:br w:type="page"/><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> DATE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>2026年</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:sdt><w:sdtPr><w:tag w:val="keep"/></w:sdtPr><w:sdtContent><w:r><w:t>控件内容</w:t></w:r></w:sdtContent></w:sdt><w:bookmarkEnd w:id="1"/></w:p>';
 const second='<w:p><w:r><w:t>外层</w:t><w:drawing><w:txbxContent><w:p><w:r><w:t>文本框文字</w:t></w:r></w:p></w:txbxContent></w:drawing><w:t>末尾</w:t></w:r></w:p>';
 let xml=await zip.file('word/document.xml').async('string');xml=xml.replace('<w:document xmlns:w=',`<w:document xmlns:r="${R}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:w=`).replace('<w:tbl>',paragraph+second+'<w:tbl>');zip.file('word/document.xml',xml);zip.file('word/_rels/document.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="link1" Type="${R}/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>`);
 return zip.generateAsync({type:'nodebuffer'});
}
async function test(){
 const bytes=await complexFixture(),model=await inspectDocx(bytes),blocks=structuredClone(model.blocks),b=blocks[2];assert.equal(b.editable,false);assert.equal(b.styleEditable,true);assert.equal(b.runs.map(r=>r.text).join(''),b.text);
 const start=b.text.indexOf('链接');runs.format(b,start,start+2,{color:'#cc2244',size:18.5,bold:true,italic:true,underline:false,strike:true,font:'Arial'});const pic=b.text.indexOf('图前');runs.format(b,pic,pic+1,{color:'#008844'});runs.format(b,b.text.indexOf('图后'),b.text.length,{color:'#2255aa'});
 runs.format(blocks[3],0,blocks[3].text.length,{bold:true,color:'#663399'});
 const saved=await editDocx(bytes,blocks),next=await inspectDocx(saved);assert.equal(next.blocks[2].text,b.text);assert.equal(next.blocks[3].text,blocks[3].text);assert.equal(next.blocks[2].runs.find(r=>r.text==='链接').color,'#CC2244');assert.equal(next.blocks[2].runs.find(r=>r.text==='链接').size,18.5);assert.equal(next.blocks[2].runs.find(r=>r.text==='超').color,null);
 const oldZip=await JSZip.loadAsync(bytes),newZip=await JSZip.loadAsync(saved),parser=new DOMParser(),serializer=new XMLSerializer();const oldDoc=parser.parseFromString(await oldZip.file('word/document.xml').async('string'),'text/xml'),newDoc=parser.parseFromString(await newZip.file('word/document.xml').async('string'),'text/xml');
 for(const tag of ['pPr','numPr','sectPr','bookmarkStart','bookmarkEnd','drawing','instrText','fldChar','sdtPr','tbl']){const signature=d=>Array.from(d.getElementsByTagNameNS(W,tag),n=>serializer.serializeToString(n));if(tag==='drawing'){assert.equal(signature(oldDoc).length,signature(newDoc).length);continue;}assert.deepEqual(signature(newDoc),signature(oldDoc),tag+' must survive unchanged');}
 assert.equal(newDoc.getElementsByTagNameNS(W,'hyperlink')[0].getAttributeNS(R,'id'),'link1');assert.equal(newDoc.getElementsByTagNameNS(W,'hyperlink').length,1);
 for(const name of Object.keys(oldZip.files).filter(n=>n!=='word/document.xml'))assert.deepEqual(await newZip.file(name)?.async('nodebuffer'),await oldZip.file(name)?.async('nodebuffer'),name);
 const bad=structuredClone(blocks);bad[2].text+='bad';await assert.rejects(()=>editDocx(bytes,bad),/复杂段落/);await assert.rejects(()=>editDocx(bytes,blocks.filter(x=>x.id!==b.id)),/受保护/);
 const twice=structuredClone(next.blocks);runs.format(twice[2],start,start+2,{color:'#123456'});assert.equal((await inspectDocx(await editDocx(saved,twice))).blocks[2].runs.find(r=>r.text==='链接').color,'#123456');
 console.log('COMPLEX_DOCX_OK: partial styles, hyperlinks, numbering, section settings, bookmarks, inline objects, field codes, content controls, nested text, two saves and rejected content changes');
}
module.exports={complexFixture};if(require.main===module)test().catch(e=>{console.error(e);process.exitCode=1});
