'use strict';
const {app,BrowserWindow,ipcMain}=require('electron');
const path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {fixture}=require('./test-docx.cjs'),{inspectDocx,editDocx}=require('../electron/docx');
app.setPath('userData',path.join(os.tmpdir(),'word-text-'+process.pid));
ipcMain.handle('app:load-connection',()=>({ok:true,data:null}));let saved;
ipcMain.handle('word:save',async(_e,p)=>{try{saved=await editDocx(p.bytes,p.blocks);return {ok:true,data:{bytes:new Uint8Array(saved),model:await inspectDocx(saved)}};}catch(e){return {ok:false,error:e.message};}});
const timeout=setTimeout(()=>app.exit(1),30000);
app.whenReady().then(async()=>{
 const original=await fixture(),model=await inspectDocx(original);
 const win=new BrowserWindow({show:false,width:1360,height:960,webPreferences:{preload:path.join(__dirname,'../electron/preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false}});win.webContents.setBackgroundThrottling(false);
 await win.loadFile(path.join(__dirname,'../renderer/index.html'));const js=code=>win.webContents.executeJavaScript(code,true);
 await js('state.currentFile={path:"/sample.docx",name:"sample.docx",kind:"docx"};applyViewMode();wordEditor.setLocked(false);wordEditor.load('+JSON.stringify({bytes:Array.from(original),model})+')');
 async function select(start,end,first=0,last=first){await js('(()=>{const nodes=document.querySelectorAll(".word-paragraph");function point(node,offset){const w=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){if(offset<=n.length)return [n,offset];offset-=n.length;}return [node,node.childNodes.length];}nodes['+first+'].focus();const r=document.createRange();r.setStart(...point(nodes['+first+'],'+start+'));r.setEnd(...point(nodes['+last+'],'+end+'));getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event("selectionchange"));})()');}
 const change=(id,value)=>js('$('+JSON.stringify(id)+').value='+JSON.stringify(value)+';$('+JSON.stringify(id)+').dispatchEvent(new Event("change"))');
 await select(6,11);await change('wordColor','#cc2244');await change('wordSize','24');await change('wordFont','Arial');await js('$("wordBold").click();$("wordUnderline").click();$("wordStrike").click()');
 assert.equal(await js('getSelection().toString()'),'world','toolbar preserves selection');
 assert.equal(await js('document.querySelector(".word-paragraph").firstChild.style.color'),'','unselected prefix remains unchanged');
 await js('$("wordUndo").click()');await select(6,11);assert.equal(await js('$("wordStrike").getAttribute("aria-pressed")'),'false');await js('$("wordRedo").click()');
 await js('runAction(()=>wordEditor.save())');assert.ok(saved,await js('$("status").textContent'));
 let doc=await inspectDocx(saved),prefix=doc.blocks[0].runs[0],word=doc.blocks[0].runs.find(r=>r.text==='world');
 assert.equal(prefix.text,'Hello ');assert.equal(prefix.color,null);assert.equal(prefix.bold,true);
 assert.equal(word.color.toLowerCase(),'#cc2244');assert.equal(word.size,24);assert.equal(word.font,'Arial');assert.equal(word.bold,true);assert.equal(word.italic,true);assert.equal(word.underline,true);assert.equal(word.strike,true);
 // Typing into formatted text must keep both the edited run and untouched prefix styles.
 await select(8,8);await js('document.execCommand("insertText",false,"X")');
 await js('runAction(()=>wordEditor.save())');doc=await inspectDocx(saved);assert.equal(doc.blocks[0].text,'Hello woXrld');assert.ok(doc.blocks[0].runs.filter(r=>r.text.includes('X')).every(r=>r.size===24&&r.color.toLowerCase()==='#cc2244'));
 // Cross-paragraph selection formats only its selected spans.
 await select(6,2,0,1);await change('wordColor','#008844');await js('runAction(()=>wordEditor.save())');doc=await inspectDocx(saved);
 assert.equal(doc.blocks[1].runs[0].text,'第二');assert.equal(doc.blocks[1].runs[0].color.toLowerCase(),'#008844');assert.equal(doc.blocks[1].runs.at(-1).color,null);
 // Collapsed selection applies to its current paragraph.
 await select(3,3,1);await change('wordSize','18');await js('runAction(()=>wordEditor.save())');doc=await inspectDocx(saved);assert.ok(doc.blocks[1].runs.every(r=>r.size===18));
 const JSZip=require('jszip'),oldZip=await JSZip.loadAsync(original),nextZip=await JSZip.loadAsync(saved);
 for(const name of ['word/styles.xml','word/header1.xml','word/media/image.png'])assert.deepEqual(await nextZip.file(name).async('nodebuffer'),await oldZip.file(name).async('nodebuffer'));
 assert.equal(doc.protectedCount,2);
 await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await fs.writeFile(path.join(__dirname,'../.electron-cache/word-text-format.png'),(await win.webContents.capturePage()).toPNG());
 console.log('Word text formatting passed: partial selection, font/color/size and emphasis, undo/redo, typing preserves styles, multi-paragraph ranges, whole paragraph fallback, DOCX roundtrip and protected package preservation');
 clearTimeout(timeout);app.exit(0);
}).catch(e=>{console.error(e);clearTimeout(timeout);app.exit(1);});
