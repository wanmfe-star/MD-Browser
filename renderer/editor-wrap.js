(() => {
  const editor=document.getElementById('editor'),gutter=document.getElementById('lineNumbers');
  const mirror=document.createElement('div');mirror.className='editor-wrap-mirror';mirror.setAttribute('aria-hidden','true');document.body.append(mirror);
  let scheduled=false,previous='';
  function measure(){
    scheduled=false;if(!editor.clientWidth)return;
    const style=getComputedStyle(editor),width=editor.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
    const key=JSON.stringify([editor.value,width,style.font,style.lineHeight,style.letterSpacing,style.tabSize]);if(key===previous)return;previous=key;
    mirror.style.width=width+'px';mirror.style.font=style.font;mirror.style.lineHeight=style.lineHeight;mirror.style.letterSpacing=style.letterSpacing;mirror.style.tabSize=style.tabSize;
    const lines=editor.value.split('\n');
    mirror.replaceChildren(...lines.map(line=>{const node=document.createElement('div');node.textContent=line||'\u200b';return node;}));
    const heights=Array.from(mirror.children,node=>node.getBoundingClientRect().height);
    gutter.replaceChildren(...heights.map((height,index)=>{const node=document.createElement('div');node.textContent=index+1;node.style.height=height+'px';return node;}));
    gutter.scrollTop=editor.scrollTop;
  }
  function update(){if(!scheduled){scheduled=true;requestAnimationFrame(measure);}}
  window.markdownWrap={update};
  new ResizeObserver(update).observe(editor);
  editor.addEventListener('input',update);
  document.fonts?.ready.then(update);
  update();
})();
