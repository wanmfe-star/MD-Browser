'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');
const path=require('node:path'),os=require('node:os'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const {lookupCharacter}=require('../electron/dictionary');
app.setPath('userData',path.join(os.tmpdir(),'md-dictionary-ui-'+process.pid));app.disableHardwareAcceleration();app.commandLine.appendSwitch('no-sandbox');app.on('window-all-closed',()=>{});
ipcMain.handle('app:load-connection',()=>({ok:true,data:null}));
ipcMain.handle('app:lookup-character',(_event,text)=>({ok:true,data:lookupCharacter(text)}));
ipcMain.handle('app:inspect-pdf-annotations',async(_event,bytes)=>({ok:true,data:await require('../electron/pdf-annotations').inspectAnnotations(bytes)}));
const timeout=setTimeout(()=>app.exit(1),40000);
app.whenReady().then(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'md-dict-files-'));
 try {
  const win=new BrowserWindow({show:true,width:1100,height:850,webPreferences:{preload:path.join(__dirname,'../electron/preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false}});
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=2)console.log('Renderer:',message);});
  await win.loadFile(path.join(__dirname,'../renderer/index.html'));const js=code=>win.webContents.executeJavaScript(code,true).catch(error=>{console.error('JS failed:',code.slice(0,200));throw error;});
  const tick=()=>new Promise(r=>setTimeout(r,100));
  async function select(selector,start=0,end=1){await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});const w=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);const t=w.nextNode();const r=document.createRange();r.setStart(t,${start});r.setEnd(t,${end});getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));})()`);await tick();}
  async function checkCard(char,pinyin){for(let i=0;i<30;i++){if(await js(`document.querySelector('.dictionary-pinyin').textContent.includes(${JSON.stringify(pinyin)})`))break;await tick();}assert.equal(await js(`!document.querySelector('.dictionary-card').hidden && document.querySelector('.dictionary-character').textContent===${JSON.stringify(char)} && document.querySelector('.dictionary-pinyin').textContent.includes(${JSON.stringify(pinyin)})`),true);assert.ok((await js("document.querySelector('.dictionary-definitions').textContent")).length>5);}
  await js("state.currentFile={path:'/test.md',name:'test.md'};state.viewMode='preview';editorEl.value='# 学习';state.savedContent=editorEl.value;applyViewMode();renderPreview();editorEl.blur()");
  await select('#preview h1');assert.equal(await js("document.querySelector('.selection-actions button:last-child').hidden"),false);
  await js("document.querySelector('.selection-actions button:last-child').click()");await checkCard('学','xué');
  assert.equal(await js('isDirty()'),false,'lookup does not edit Markdown');
  await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");assert.equal(await js("document.querySelector('.dictionary-card').hidden"),true);
  await select('#preview h1',0,2);assert.equal(await js("document.querySelector('.selection-actions button:last-child').hidden"),false);
  await js("document.querySelector('.selection-actions button:last-child').click()");await checkCard('学习','xué');
  await js("dictionaryLookup.close()");
  await js("dictionaryLookup.show('龘龘龘龘龘龘')");await tick();assert.ok((await js("document.querySelector('.dictionary-definitions').textContent")).includes('暂未收录'));
  await js("dictionaryLookup.close()");assert.equal(await js("dictionaryLookup.canLookup('学'.repeat(33))"),false);
  await js("state.viewMode='split';applyViewMode();editorEl.focus();editorEl.setSelectionRange(2,3);document.dispatchEvent(new Event('selectionchange'))");await tick();await js("document.querySelector('.selection-actions button:last-child').click()");await checkCard('学','xué');
  const bytes=await require('./test-docx.cjs').fixture(),model=await require('../electron/docx').inspectDocx(bytes);
  await js(`dictionaryLookup.close();state.currentFile={path:'/test.docx',name:'test.docx',kind:'docx'};applyViewMode();editorEl.blur();wordEditor.load(${JSON.stringify({bytes:Array.from(bytes),model})});wordEditor.setLocked(false)`);
  await select('#wordPage .word-paragraph:nth-child(2)');await js("document.querySelector('.selection-actions button:last-child').click()");await checkCard('第','dì');assert.equal(await js('wordEditor.dirty()'),false);
  const pdfPath=path.join(root,'dictionary.pdf');await require('../electron/export-pdf').exportPDF({title:'字典查询',html:'<h1>画蛇添足</h1><p>学习汉字</p>'},pdfPath);
  const pdfBytes=await fs.readFile(pdfPath);
  await js(`dictionaryLookup.close();state.currentFile={path:'/dictionary.pdf',name:'dictionary.pdf',kind:'pdf'};applyViewMode();pdfAnnotations.load(${JSON.stringify(Array.from(pdfBytes))});pdfAnnotations.open()`);
  await tick();
  await js(`(()=>{const spans=[...document.querySelectorAll('.textLayer span')];const first=spans.findIndex(s=>s.textContent.normalize('NFKC').startsWith('画'));let end=first,term='';while(end<spans.length && term.length<4)term+=spans[end++].textContent.normalize('NFKC');if(term!=='画蛇添足')throw Error('Missing PDF text layer');const r=document.createRange();r.setStart(spans[first].firstChild,0);r.setEnd(spans[end-1].firstChild,spans[end-1].textContent.length);getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));})()`);await tick();
  assert.equal(await js("!document.getElementById('pdfSelectionToolbar').hidden && !document.getElementById('pdfDictionary').hidden"),true);
  await js("document.getElementById('pdfDictionary').click()");await checkCard('画蛇添足','huà');assert.equal(await js('pdfAnnotations.dirty()'),false);
  assert.ok((await js("document.querySelector('.dictionary-definitions').textContent")).includes('出处'));
  await tick();await tick();
  await fs.mkdir(path.join(__dirname,'../output'),{recursive:true});await fs.writeFile(path.join(__dirname,'../output/dictionary-card.png'),(await win.webContents.capturePage()).toPNG());
  await js("document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))");assert.equal(await js("document.querySelector('.dictionary-card').hidden"),true);
  console.log('DICTIONARY_UI_OK: PDF, Markdown preview/editor, Word, polyphones, close behavior, no document mutations');
 } finally {await fs.rm(root,{recursive:true,force:true});clearTimeout(timeout);}
 app.exit(0);
}).catch(e=>{console.error(e);app.exit(1);});
