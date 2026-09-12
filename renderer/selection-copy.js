(() => {
  const button=document.createElement('button');button.className='selection-copy';button.textContent='复制';button.hidden=true;document.body.append(button);
  let text='',point=null;
  function selected(){
    if(document.activeElement===editorEl)return editorEl.value.slice(editorEl.selectionStart,editorEl.selectionEnd);
    const selection=getSelection();if(!selection.rangeCount||selection.isCollapsed)return '';
    const range=selection.getRangeAt(0),root=range.commonAncestorContainer.parentElement;
    if(!root?.closest('#preview,#wordPage,.textLayer'))return '';
    return selection.toString();
  }
  function update(){
    text=selected();if(!text||window.browserPane?.inspect().showing){button.hidden=true;return;}
    if(document.activeElement!==editorEl&&getSelection().anchorNode?.parentElement?.closest('.textLayer')){button.hidden=true;return;}
    let rect=document.activeElement===editorEl?editorEl.getBoundingClientRect():getSelection().getRangeAt(0).getBoundingClientRect();
    const x=document.activeElement===editorEl&&point?point.x:rect.left+rect.width/2,y=document.activeElement===editorEl&&point?point.y:rect.top;
    button.hidden=false;button.style.left=Math.max(8,Math.min(innerWidth-button.offsetWidth-8,x))+'px';button.style.top=Math.max(8,Math.min(innerHeight-button.offsetHeight-8,y-button.offsetHeight-8))+'px';
  }
  button.addEventListener('mousedown',event=>event.preventDefault());
  button.onclick=async()=>{const result=await window.mdAPI.copyText(text);if(result.ok){button.hidden=true;setStatus('已复制所选文字');}else setStatus('复制失败：'+result.error,'error');};
  document.addEventListener('pointerup',event=>{if(event.target===button)return;point={x:event.clientX,y:event.clientY};requestAnimationFrame(update);});
  document.addEventListener('selectionchange',()=>requestAnimationFrame(update));
  document.addEventListener('scroll',()=>button.hidden=true,true);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape')button.hidden=true;
    if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='c'){
      const value=selected();if(value){event.preventDefault();window.mdAPI.copyText(value).then(result=>{if(!result.ok)setStatus('复制失败：'+result.error,'error');});}
    }
  });
})();
