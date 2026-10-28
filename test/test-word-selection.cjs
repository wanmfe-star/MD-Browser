'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');
const path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const JSZip=require('jszip'),{fixture}=require('./test-docx.cjs'),{inspectDocx,editDocx}=require('../electron/docx');
app.setPath('userData',path.join(os.tmpdir(),'word-selection-'+process.pid));ipcMain.handle('app:load-connection',()=>({ok:true,data:null}));
let saved;ipcMain.handle('word:save',async(_e,p)=>{saved=await editDocx(p.bytes,p.blocks);return {ok:true,data:{bytes:new Uint8Array(saved),model:await inspectDocx(saved)}};});
const timeout=setTimeout(()=>app.exit(1),30000);
app.whenReady().then(async()=>{
 const zip=await JSZip.loadAsync(await fixture());zip.file('word/document.xml',(await zip.file('word/document.xml').async('string')).replace('<w:tbl>','<w:p><w:hyperlink w:anchor="bookmark"><w:r><w:t>受保护的复杂段落内容</w:t></w:r></w:hyperlink></w:p><w:p><w:r><w:t>后面的普通段落</w:t></w:r></w:p><w:tbl>'));
 const bytes=await zip.generateAsync({type:'nodebuffer'}),model=await inspectDocx(bytes),win=new BrowserWindow({show:false,width:1360,height:960,webPreferences:{preload:path.join(__dirname,'../electron/preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false}});win.webContents.setBackgroundThrottling(false);
 await win.loadFile(path.join(__dirname,'../renderer/index.html'));const js=c=>win.webContents.executeJavaScript(c,true);
 const load='state.currentFile={path:"/selection.docx",name:"selection.docx",kind:"docx"};applyViewMode();wordEditor.setLocked(false);wordEditor.load('+JSON.stringify({bytes:Array.from(bytes),model})+')';await js(load);
 const select=selector=>js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(n.isContentEditable)n.focus();const r=document.createRange();r.selectNodeContents(n);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));n.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));})()`);
 await select('.word-paragraph');await select('.word-style-content');
 assert.equal(await js('$("wordColor").disabled'),false,'complex paragraph text supports formatting');
 assert.equal(await js('$("wordAlign").disabled'),true,'complex paragraph structure remains protected');assert.equal(await js('$("wordDeleteParagraph").disabled'),true);
 await js('$("wordColor").value="#ff0000";$("wordColor").dispatchEvent(new Event("change"))');
 assert.equal(await js('getSelection().toString()'),'受保护的复杂段落内容','selection offsets exclude the status label');
 await js('$("wordUndo").click()');assert.equal(await js('wordEditor.dirty()'),false);assert.equal(await js('getSelection().toString()'),'受保护的复杂段落内容');await js('$("wordRedo").click()');assert.ok(await js('wordEditor.dirty()'));
 await js('wordEditor.save()');let complex=await inspectDocx(saved);assert.deepEqual(complex.blocks[0],model.blocks[0]);assert.deepEqual(complex.blocks[1],model.blocks[1]);assert.ok(complex.blocks[2].runs.every(r=>r.color==='#FF0000'));
 // A partial selection in a complex paragraph only changes its selected text.
 await js('(()=>{const n=document.querySelector(".word-style-content"),r=document.createRange();r.setStart(n.firstChild.firstChild,1);r.setEnd(n.firstChild.firstChild,4);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event("selectionchange"));})()');
 await js('$("wordSize").value="20";$("wordSize").dispatchEvent(new Event("change"));$("wordBold").click()');assert.equal(await js('getSelection().toString()'),'保护的');await js('wordEditor.save()');complex=await inspectDocx(saved);assert.equal(complex.blocks[2].runs.find(r=>r.text==='保护的').size,20);assert.equal(complex.blocks[2].runs[0].size,null);
 // Tables still block the whole selection rather than modifying the preceding paragraph.
 await select('.word-paragraph');await select('.word-protected td');assert.equal(await js('$("wordBold").disabled'),true);
 await js('$("wordSize").value="22";$("wordSize").dispatchEvent(new Event("change"))');assert.equal(await js('wordEditor.dirty()'),false);
 // Mixed normal/complex paragraph selections map to the correct spans in both paragraphs.
 await select('.word-paragraph');
 await js('(()=>{const before=document.querySelectorAll(".word-paragraph")[1],after=document.querySelector(".word-style-content"),r=document.createRange();r.setStart(before.firstChild.firstChild,1);r.setEnd(after.firstChild.firstChild,1);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event("selectionchange"));})()');
 assert.equal(await js('$("wordColor").disabled'),false);await js('$("wordColor").value="#3333cc";$("wordColor").dispatchEvent(new Event("change"))');await js('wordEditor.save()');complex=await inspectDocx(saved);assert.equal(complex.blocks[1].runs[0].color,null);assert.equal(complex.blocks[1].runs[1].color,'#3333CC');assert.equal(complex.blocks[2].runs[0].color,'#3333CC');
 // Reload the fixture for the ordinary-paragraph recovery check.
 await js(load);
 // Returning to an editable paragraph restores its own controls and only changes that paragraph.
 await js('(()=>{const nodes=document.querySelectorAll(".word-paragraph"),n=nodes[2],r=document.createRange();n.focus();r.selectNodeContents(n);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event("selectionchange"));})()');
 assert.equal(await js('$("wordApplyColor").disabled'),false);
 await js('$("wordColor").value="#229944";$("wordColor").dispatchEvent(new Event("change"))');await js('wordEditor.save()');
 const updated=await inspectDocx(saved);assert.deepEqual(updated.blocks[0],model.blocks[0]);assert.deepEqual(updated.blocks[1],model.blocks[1]);assert.deepEqual(updated.blocks[2],model.blocks[2]);assert.ok(updated.blocks[3].runs.every(r=>r.color==='#229944'));
 const oldXml=await zip.file('word/document.xml').async('string'),newXml=await (await JSZip.loadAsync(saved)).file('word/document.xml').async('string');assert.ok(oldXml.includes('<w:hyperlink w:anchor="bookmark">'));assert.ok(newXml.includes('<w:hyperlink w:anchor="bookmark">'));
 console.log('WORD_PROTECTED_SELECTION_OK: complex paragraph styles, partial and mixed ranges, table protection, undo/redo, copy, correct-paragraph recovery and DOCX roundtrip');clearTimeout(timeout);app.exit(0);
}).catch(e=>{console.error(e);clearTimeout(timeout);app.exit(1)});
