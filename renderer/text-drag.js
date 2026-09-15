(() => {
  const marker=document.createElement('div');marker.className='text-drop-caret';marker.hidden=true;document.body.append(marker);
  const files=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
  const textDrag=event=>!files(event)&&Array.from(event.dataTransfer?.types||[]).includes('text/plain');
  function wordNode(node){return (node?.nodeType===1?node:node?.parentElement)?.closest('.word-paragraph');}
  function destination(event){
    if(state.busy||state.saving||document.querySelector('dialog[open]'))return null;
    if(event.target===editorEl&&!editorEl.readOnly&&state.currentFile)return editorEl;
    const node=wordNode(event.target);return node&&node.closest('#wordPage')&&node.isContentEditable?node:null;
  }
  function hit(node,x,y){
    if(node===editorEl){
      const rect=node.getBoundingClientRect(),style=getComputedStyle(node),mirror=document.createElement('div');
      for(const key of ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','textAlign','textIndent','tabSize','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','boxSizing','wordBreak','overflowWrap'])mirror.style[key]=style[key];
      Object.assign(mirror.style,{position:'fixed',left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px',whiteSpace:'pre-wrap',overflow:'hidden',borderStyle:'solid',borderColor:'transparent',color:'transparent',background:'transparent',zIndex:'2147483646',scrollbarGutter:style.scrollbarGutter});
      const text=document.createTextNode(node.value+'\u200b');mirror.append(text);document.body.append(mirror);mirror.scrollTop=node.scrollTop;mirror.scrollLeft=node.scrollLeft;
      const range=document.caretRangeFromPoint(x,y);let result=null;
      if(range&&mirror.contains(range.startContainer)){const measure=document.createRange();measure.setStart(text,0);measure.setEnd(range.startContainer,range.startOffset);const offset=Math.min(node.value.length,measure.toString().length);const caret=range.getBoundingClientRect();result={offset,rect:{left:caret.left||x,top:caret.height?caret.top:y,height:caret.height||parseFloat(style.lineHeight)||20}};}
      mirror.remove();return result;
    }
    let range=document.caretRangeFromPoint(x,y);if(!range||!node.contains(range.startContainer)){range=document.createRange();range.selectNodeContents(node);range.collapse(false);}range.collapse(true);return {range,rect:range.getBoundingClientRect()};
  }
  document.addEventListener('dragstart',event=>{
    if(files(event))return;const node=event.target,selection=getSelection();let text='';
    if(node===editorEl)text=editorEl.value.slice(editorEl.selectionStart,editorEl.selectionEnd);
    else if(selection.rangeCount&&!selection.isCollapsed){const range=selection.getRangeAt(0),element=range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;if(element.closest('#preview,#wordPage,.textLayer'))text=selection.toString();}
    if(!text)return;event.dataTransfer.setData('text/plain',text);event.dataTransfer.effectAllowed='copy';
    document.querySelectorAll('.selection-copy,.pdf-selection-toolbar').forEach(el=>el.hidden=true);
  },true);
  document.addEventListener('beforeinput',event=>{if(event.inputType==='deleteByDrag'&&(event.target===editorEl||wordNode(event.target)))event.preventDefault();},true);
  document.addEventListener('dragover',event=>{
    if(event.target.closest?.('#mindMapPane'))return;if(!textDrag(event))return;event.preventDefault();const node=destination(event),point=node&&hit(node,event.clientX,event.clientY);event.dataTransfer.dropEffect=point?'copy':'none';marker.hidden=!point;
    if(point){const rect=point.rect;Object.assign(marker.style,{left:rect.left+'px',top:rect.top+'px',height:Math.max(16,rect.height)+'px'});}
  },true);
  document.addEventListener('drop',event=>{
    marker.hidden=true;if(event.target.closest?.('#mindMapPane'))return;if(!textDrag(event))return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';
    const node=destination(event),text=event.dataTransfer.getData('text/plain');if(!node||!text)return;const point=hit(node,event.clientX,event.clientY);if(!point)return;
    if(node===editorEl){node.focus();node.setSelectionRange(point.offset,point.offset);document.execCommand('insertText',false,text.replace(/\r\n?/g,'\n'));}
    else window.wordEditor.insertDroppedText(point.range,text);
  },true);
  for(const event of ['dragend','dragleave'])document.addEventListener(event,()=>marker.hidden=true,true);
})();
