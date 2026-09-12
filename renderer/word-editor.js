(() => {
  const el = id => document.getElementById(id);
  const page = el('wordPage'), pane = el('wordPane');
  let zoom = 1;
  const scroll = el('wordScroll');
  function setZoom(value, offset = scroll.clientHeight / 2) {
    const next = window.viewZoom.clamp(value, 0.1, 4), previous = zoom;
    zoom = next;page.style.zoom = zoom;
    scroll.scrollTop = (scroll.scrollTop + offset) * zoom / previous - offset;
    el('wordZoomReset').textContent = Number((zoom * 100).toFixed(1)) + '%';
    el('wordZoomOut').disabled = zoom <= 0.1;el('wordZoomIn').disabled = zoom >= 4;
  }
  scroll.addEventListener('wheel', event => {
    if (!bytes || !event.ctrlKey) return;
    event.preventDefault();event.stopPropagation();
    setZoom(zoom + window.viewZoom.delta(event, scroll), event.clientY - scroll.getBoundingClientRect().top);
  }, { passive: false });
  el('wordZoomOut').onclick = () => setZoom(zoom - 0.05);
  el('wordZoomIn').onclick = () => setZoom(zoom + 0.05);
  el('wordZoomReset').onclick = () => setZoom(1);
  let bytes, blocks = [], originals = new Map(), saved = '', selectedId = null, locked = false;
  const runs = window.wordRuns;
  let textSelection = [], inputEdit = null;
  let undoStack = [], redoStack = [], composing = false;
  const snapshot = () => JSON.stringify(blocks.map(b => ({ id:b.id, sourceId:b.sourceId, text:b.text, format:b.format, runs:b.runs, richText:b.editable })));
  const dirty = () => !!bytes && snapshot() !== saved;
  const current = () => blocks.find(b => b.id === selectedId && b.editable);
  function remember() { undoStack.push(snapshot()); if(undoStack.length>100)undoStack.shift();redoStack=[]; }
  function changed() {
    state.saveError = false; updateDirty();
    el('wordCount').textContent = blocks.map(b=>b.text).join('').replace(/\s/g,'').length + ' 字';
    el('wordUndo').disabled = locked || !undoStack.length;
    el('wordRedo').disabled = locked || !redoStack.length;
    el('wordSave').disabled = locked || !dirty();
    setStatus(dirty() ? 'Word 修改未保存 · Ctrl+S 保存原文件' : 'Word 已保存');
  }
  function formatNode(node, format) {
    node.style.textAlign = format.align;
    node.style.lineHeight = String(format.line);
    node.style.marginTop = format.before + 'pt';
    node.style.marginBottom = format.after + 'pt';
    node.style.textIndent = format.indent + 'pt';
  }
  function syncToolbar() {
    const b=current();
    syncTextToolbar();
    el('wordToolbar').querySelectorAll('[data-paragraph]').forEach(n=>n.disabled=locked || !b);
    if(b) {
      el('wordAlign').value=b.format.align;
      el('wordLine').value=String(b.format.line);
      el('wordAfter').value=String(b.format.after);
      el('wordBefore').value=String(b.format.before);
      el('wordIndent').classList.toggle('active',b.format.indent>0);
    }
  }
  function focusParagraph(id, offset=0) {
    selectedId=id;
    const node=Array.from(page.children).find(n=>n.dataset.id===id);
    if(!node || !current())return;
    node.focus();
    const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);
    let remaining=Math.max(0,offset),text;
    while((text=walker.nextNode())) { if(remaining<=text.length)break;remaining-=text.length; }
    const range=document.createRange();
    if(text)range.setStart(text,remaining);else {range.selectNodeContents(node);range.collapse(false);}
    range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);syncToolbar();
  }
  function render(focusId,offset) {
    const top=el('wordScroll').scrollTop;
    page.replaceChildren();
    for(const b of blocks) {
      const node=document.createElement(b.editable?'p':'section');node.dataset.id=b.id;
      if(b.editable) {
        node.className='word-paragraph';node.contentEditable=locked?'false':'plaintext-only';node.spellcheck=false;
        node.setAttribute('aria-label','可编辑段落');formatNode(node,b.format);
        for(const run of b.runs || [{text:b.text}]) {
          const span=document.createElement('span');span.textContent=run.text;
          if(run.bold)span.style.fontWeight='bold';if(run.italic)span.style.fontStyle='italic';
          span.style.textDecoration=[run.underline?'underline':'',run.strike?'line-through':''].join(' ');
          if(run.size)span.style.fontSize=run.size+'pt';if(run.color)span.style.color=run.color;if(run.font)span.style.fontFamily=run.font;
          node.appendChild(span);
        }
        if(!b.text)node.appendChild(document.createElement('br'));
      } else {
        node.className='word-protected';node.contentEditable='false';
        const label=document.createElement('small');label.textContent=b.kind==='table'?'表格 · 保留原内容':'复杂内容 · 保留原内容';node.appendChild(label);
        if(b.rows) { const table=document.createElement('table');for(const row of b.rows){const tr=table.insertRow();for(const text of row)tr.insertCell().textContent=text;}node.appendChild(table); }
        else {const p=document.createElement('p');p.textContent=b.text;node.appendChild(p);}
        for(const src of b.images||[]){const img=document.createElement('img');img.src=src;img.alt='Word 原文图片';node.appendChild(img);}
      }
      page.appendChild(node);
    }
    if(focusId)focusParagraph(focusId,offset);
    el('wordScroll').scrollTop=top;syncToolbar();
  }
  function offsets(node) {
    const selection=getSelection();if(!selection.rangeCount)return {start:0,end:0};
    const range=selection.getRangeAt(0);
    if(!node.contains(range.startContainer)||!node.contains(range.endContainer))return null;
    const before=range.cloneRange();before.selectNodeContents(node);before.setEnd(range.startContainer,range.startOffset);
    const after=range.cloneRange();after.selectNodeContents(node);after.setEnd(range.endContainer,range.endOffset);
    return {start:before.toString().length,end:after.toString().length};
  }
  function newBlock(source,text='') {
    return {id:'new-'+crypto.randomUUID(),sourceId:originals.has(source?.id)?source.id:source?.sourceId,editable:true,text,runs:text?[{...runs.at(source?.runs,0),text}]:[],
      format:{...(source?.format||{align:'left',line:1.5,before:0,after:8,indent:0})}};
  }
  function replaceSelection(text, splitParagraphs = true) {
    const b=current(),node=Array.from(page.children).find(n=>n.dataset.id===selectedId);
    if(!b||!node||locked)return;
    const selection=offsets(node);if(!selection)return;
    remember();
    const normalized=text.replace(/\r\n?/g,'\n');
    const parts=splitParagraphs?normalized.split('\n'):[normalized];
    const prefix=b.text.slice(0,selection.start),suffix=b.text.slice(selection.end);
    const originalRuns=b.runs,style=runs.at(originalRuns,selection.start);
    b.text=prefix+parts[0];b.runs=[...runs.slice(originalRuns,0,selection.start),...(parts[0]?[{...style,text:parts[0]}]:[])];
    const inserted=parts.slice(1).map(part=>({...newBlock(b,part),runs:part?[{...runs.copy(style),text:part}]:[]}));
    const last=inserted.at(-1)||b;last.text+=suffix;last.runs.push(...runs.slice(originalRuns,selection.end,Infinity));textSelection=[];
    blocks.splice(blocks.indexOf(b)+1,0,...inserted);
    render(last.id,last.text.length-suffix.length);changed();
  }
  page.addEventListener('focusin',event=>{const node=event.target.closest('.word-paragraph');if(node){if(selectedId!==node.dataset.id)textSelection=[];selectedId=node.dataset.id;syncToolbar();}});
  page.addEventListener('compositionstart',()=>{composing=true;});
  page.addEventListener('compositionend',()=>{composing=false;const node=Array.from(page.children).find(n=>n.dataset.id===selectedId),pos=node&&offsets(node);render(selectedId,pos?.end||0);});
  page.addEventListener('beforeinput',event=>{
    const node=event.target.closest('.word-paragraph'),block=blocks.find(b=>b.id===node?.dataset.id),pos=node&&offsets(node);
    inputEdit=block&&pos?{id:block.id,...pos,type:event.inputType}:null;
  });
  page.addEventListener('input',event=>{
    const node=event.target.closest('.word-paragraph');const b=blocks.find(b=>b.id===node?.dataset.id);
    if(!b||locked)return;
    selectedId=b.id;syncToolbar();
    const text=node.innerText.replace(/\r/g,'');
    if(text===b.text)return;
    const pos=offsets(node);remember();
    let applied=false;
    if(inputEdit?.id===b.id&&!composing){
      let {start,end,type}=inputEdit;
      const deleted=b.text.length-text.length;
      if(start===end&&deleted>0){if(type==='deleteContentBackward')start=Math.max(0,start-deleted);else if(type==='deleteContentForward')end+=deleted;}
      const prefix=b.text.slice(0,start),suffix=b.text.slice(end);
      if(text.startsWith(prefix)&&text.endsWith(suffix)&&text.length>=prefix.length+suffix.length){b.runs=runs.insert(b.runs,start,end,text.slice(prefix.length,text.length-suffix.length));b.text=text;applied=true;}
    }
    inputEdit=null;if(!applied)runs.update(b,text);textSelection=[];if(!composing)render(b.id,pos?.end??text.length);changed();
  });
  page.addEventListener('paste',event=>{if(locked)return;event.preventDefault();replaceSelection(event.clipboardData.getData('text/plain'));});
  page.addEventListener('keydown',event=>{
    if(locked||composing||event.isComposing)return;
    const node=event.target.closest('.word-paragraph'),b=blocks.find(b=>b.id===node?.dataset.id&&b.editable);if(!b||!node)return;selectedId=b.id;
    if(event.key==='Enter'){event.preventDefault();replaceSelection('\n',!event.shiftKey);return;}
    if(!['Backspace','Delete'].includes(event.key))return;
    const pos=offsets(node);if(!pos||pos.start!==pos.end)return;
    const index=blocks.indexOf(b),back=event.key==='Backspace';
    if((back&&pos.start!==0)||(!back&&pos.end!==b.text.length))return;
    const other=blocks[index+(back?-1:1)];
    event.preventDefault();if(!other?.editable)return;
    remember();
    const first=back?other:b,second=back?b:other,at=first.text.length;
    first.runs=[...(first.runs||[]),...(second.runs||[])];textSelection=[];first.text+=second.text;blocks.splice(blocks.indexOf(second),1);render(first.id,at);changed();
  });
  function format(values) {
    const b=current();if(!b||locked)return;remember();Object.assign(b.format,values);
    const node=Array.from(page.children).find(n=>n.dataset.id===b.id);formatNode(node,b.format);syncToolbar();changed();
  }
  function captureTextSelection() {
    const selection=getSelection();if(!selection.rangeCount)return;
    const range=selection.getRangeAt(0);
    if(!page.contains(range.startContainer)||!page.contains(range.endContainer))return;
    const captured=[];
    for(const node of page.children){
      const block=blocks.find(b=>b.id===node.dataset.id);if(!block?.editable||!range.intersectsNode(node))continue;
      const part=range.cloneRange();
      if(!node.contains(range.startContainer))part.setStart(node,0);
      if(!node.contains(range.endContainer))part.setEnd(node,node.childNodes.length);
      const before=document.createRange();before.selectNodeContents(node);before.setEnd(part.startContainer,part.startOffset);
      captured.push({id:block.id,start:before.toString().length,end:before.toString().length+part.toString().length});
    }
    textSelection=captured;
    if(captured.length)selectedId=captured[0].id;
  }
  function targets() {
    const selected=textSelection.filter(r=>r.end>r.start&&blocks.some(b=>b.id===r.id&&b.editable));
    return selected.length?selected:current()?[{id:current().id,start:0,end:current().text.length}]:[];
  }
  function selectedRuns() { return targets().flatMap(r=>runs.slice(blocks.find(b=>b.id===r.id).runs,r.start,r.end)); }
  function syncTextToolbar() {
    const list=selectedRuns(),enabled=!locked&&list.length>0;
    el('wordToolbar').querySelectorAll('[data-text-format]').forEach(n=>n.disabled=!enabled);
    const common=key=>list.length&&list.every(r=>r[key]===list[0][key])?list[0][key]:null;
    el('wordFont').value=common('font')||'';el('wordSize').value=common('size')||'';el('wordColor').value=common('color')||'#26352d';
    for(const [id,key] of [['wordBold','bold'],['wordItalic','italic'],['wordUnderline','underline'],['wordStrike','strike']]){const on=!!common(key);el(id).classList.toggle('active',on);el(id).setAttribute('aria-pressed',String(on));}
  }
  function restoreTextSelection(selection) {
    if(!selection.length)return;
    function point(record,end) {
      const node=[...page.children].find(n=>n.dataset.id===record.id);if(!node)return;
      let offset=end?record.end:record.start;const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);let text;
      while((text=walker.nextNode())){if(offset<=text.length)return [text,offset];offset-=text.length;}
      return [node,node.childNodes.length];
    }
    const start=point(selection[0],false),end=point(selection.at(-1),true);if(!start||!end)return;
    const range=document.createRange();range.setStart(...start);range.setEnd(...end);const currentSelection=getSelection();currentSelection.removeAllRanges();currentSelection.addRange(range);textSelection=selection;
  }
  function formatText(values) {
    if(locked)return;const selection=targets();if(!selection.length)return;
    remember();for(const r of selection)runs.format(blocks.find(b=>b.id===r.id),r.start,r.end,values);
    render();restoreTextSelection(selection);syncToolbar();changed();
  }
  page.addEventListener('pointerup',()=>{captureTextSelection();syncToolbar();});
  document.addEventListener('selectionchange',()=>{if(bytes&&!composing&&page.contains(getSelection().anchorNode)){captureTextSelection();syncTextToolbar();}});
  el('wordToolbar').addEventListener('mousedown',()=>captureTextSelection());
  el('wordFont').onchange=event=>{if(event.target.value)formatText({font:event.target.value});};
  el('wordSize').onchange=event=>{const size=Number(event.target.value);if(size<6||size>96||!Number.isInteger(size*2)){setStatus('字号须为 6–96 磅，支持半磅','error');syncTextToolbar();return;}formatText({size});};
  el('wordColor').onchange=event=>formatText({color:event.target.value});
  for(const [id,key] of [['wordBold','bold'],['wordItalic','italic'],['wordUnderline','underline'],['wordStrike','strike']])el(id).onclick=()=>formatText({[key]:!selectedRuns().every(r=>r[key])});
  page.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&!event.altKey&&['b','i','u'].includes(event.key.toLowerCase())){event.preventDefault();captureTextSelection();const key={b:'bold',i:'italic',u:'underline'}[event.key.toLowerCase()];formatText({[key]:!selectedRuns().every(r=>r[key])});}});
  el('wordAlign').onchange=event=>format({align:event.target.value});
  el('wordLine').onchange=event=>format({line:Number(event.target.value)});
  el('wordAfter').onchange=event=>format({after:Number(event.target.value)});
  el('wordBefore').onchange=event=>format({before:Number(event.target.value)});
  el('wordIndent').onclick=()=>format({indent:current()?.format.indent>0?0:24});
  el('wordAddParagraph').onclick=()=>{
    if(locked)return;remember();const source=current(),b=newBlock(source);blocks.splice(source?blocks.indexOf(source)+1:blocks.length,0,b);render(b.id,0);changed();
  };
  el('wordDeleteParagraph').onclick=()=>{
    const b=current();if(!b||locked)return;remember();const index=blocks.indexOf(b);blocks.splice(index,1);
    if(!blocks.some(b=>b.editable))blocks.push(newBlock());
    const next=blocks.slice(index).find(b=>b.editable)||blocks.find(b=>b.editable);render(next.id,0);changed();
  };
  function restore(snapshotText) {
    textSelection=[];
    blocks=JSON.parse(snapshotText).map(b=>({...originals.get(b.id),...b,editable:originals.get(b.id)?.editable??true}));
    const focus=blocks.find(b=>b.id===selectedId&&b.editable)||blocks.find(b=>b.editable);render(focus?.id,focus?.text.length||0);changed();
  }
  function undo() { if(locked||!undoStack.length)return;redoStack.push(snapshot());restore(undoStack.pop()); }
  function redo() { if(locked||!redoStack.length)return;undoStack.push(snapshot());restore(redoStack.pop()); }
  el('wordUndo').onclick=undo;el('wordRedo').onclick=redo;
  el('wordSave').onclick=()=>runAction(save);
  document.addEventListener('keydown',event=>{
    if(state.currentFile?.kind!=='docx'||document.querySelector('dialog[open]'))return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?redo():undo();}
    else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();redo();}
  });
  el('wordToolbar').addEventListener('mousedown',event=>{if(event.target.closest('button'))event.preventDefault();});
  function load(data) {
    textSelection=[];bytes=new Uint8Array(data.bytes);blocks=data.model.blocks;
    for(const b of blocks)if(b.editable)b.runs=(b.runs?.length?b.runs:[{text:b.text}]).map((r,index)=>({...r,origin:b.runs?.length?{id:b.id,index}:undefined,overrides:{}}));
    originals=new Map(blocks.map(b=>[b.id,JSON.parse(JSON.stringify(b))]));
    if(!blocks.length)blocks.push(newBlock());
    saved=snapshot();undoStack=[];redoStack=[];selectedId=null;
    el('wordNotice').textContent=data.model.protectedCount?'选中文字设置样式；未选中时应用到当前段落。图片、表格及复杂段落保留原内容。':'选中文字设置样式；未选中文字时应用到当前段落 · Ctrl+S 保存原文件';
    render();changed();
  }
  async function save() {
    if(!dirty())return;
    state.saving=true;updateDirty();
    const selected=selectedId,top=el('wordScroll').scrollTop;
    try {
      const result=await window.mdAPI.saveWord({path:state.currentFile.path,bytes,blocks:JSON.parse(snapshot())});
      if(!result.ok)throw new Error(result.error);
      load(result.data);selectedId=blocks.some(b=>b.id===selected)?selected:null;el('wordScroll').scrollTop=top;
      state.saveError=false;setStatus('已保存 Word 原文件', 'ok');
    } catch(error) {state.saveError=true;setStatus('Word 保存失败：'+error.message+'；修改仍保留，请勿关闭窗口','error');}
    finally {state.saving=false;updateDirty();}
  }
  function setLocked(value) {
    locked=value;
    page.querySelectorAll('.word-paragraph').forEach(n=>n.contentEditable=value?'false':'plaintext-only');
    el('wordAddParagraph').disabled=value;el('wordSave').disabled=value||!dirty();
    el('wordUndo').disabled=value||!undoStack.length;el('wordRedo').disabled=value||!redoStack.length;syncToolbar();
  }
  window.wordEditor={getZoom:()=>zoom,setZoom,load,save,dirty,setLocked,clear(){textSelection=[];bytes=null;blocks=[];originals.clear();saved='';undoStack=[];redoStack=[];selectedId=null;page.replaceChildren();}};
})();
