(() => {
  const button=document.createElement('div');button.className='selection-copy selection-actions';button.setAttribute('role','toolbar');button.setAttribute('aria-label','选中文字操作');button.hidden=true;
  const copy=document.createElement('button');copy.textContent='复制';const dictionary=document.createElement('button');dictionary.textContent='查字典';dictionary.hidden=true;button.append(copy,dictionary);document.body.append(button);
  let text='',point=null;
  function selected(){
    if(document.activeElement===editorEl)return editorEl.value.slice(editorEl.selectionStart,editorEl.selectionEnd);
    const selection=getSelection();if(!selection.rangeCount||selection.isCollapsed)return '';
    const range=selection.getRangeAt(0),root=range.commonAncestorContainer.parentElement;
    if(!root?.closest('#preview,#wordPage,.textLayer'))return '';
    return selection.toString();
  }
  function update(){
    text=selected();if(!text||window.browserPane?.inspect().showing||window.dictionaryLookup?.isOpen()){button.hidden=true;return;}
    if(document.activeElement!==editorEl&&getSelection().anchorNode?.parentElement?.closest('.textLayer')){button.hidden=true;return;}
    let rect=document.activeElement===editorEl?editorEl.getBoundingClientRect():getSelection().getRangeAt(0).getBoundingClientRect();
    const x=document.activeElement===editorEl&&point?point.x:rect.left+rect.width/2,y=document.activeElement===editorEl&&point?point.y:rect.top;
    dictionary.hidden=!window.dictionaryLookup?.canLookup(text);button.hidden=false;button.style.left=Math.max(8,Math.min(innerWidth-button.offsetWidth-8,x))+'px';button.style.top=Math.max(8,Math.min(innerHeight-button.offsetHeight-8,y-button.offsetHeight-8))+'px';
  }
  button.addEventListener('mousedown',event=>event.preventDefault());
  copy.onclick=async()=>{const result=await window.mdAPI.copyText(text);if(result.ok){button.hidden=true;setStatus('已复制所选文字');}else setStatus('复制失败：'+result.error,'error');};
  dictionary.onclick=()=>{const rect=button.getBoundingClientRect();button.hidden=true;window.dictionaryLookup.show(text,rect);};
  document.addEventListener('pointerdown',event=>{if(!button.contains(event.target))button.hidden=true;});
  document.addEventListener('pointerup',event=>{if(button.contains(event.target))return;point={x:event.clientX,y:event.clientY};requestAnimationFrame(update);});
  document.addEventListener('selectionchange',()=>requestAnimationFrame(update));
  document.addEventListener('scroll',()=>button.hidden=true,true);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape')button.hidden=true;
    if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='c'){
      const value=selected();if(value){event.preventDefault();window.mdAPI.copyText(value).then(result=>{if(!result.ok)setStatus('复制失败：'+result.error,'error');});}
    }
  });
})();
