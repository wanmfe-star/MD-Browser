(() => {
  const prefix='md-browser.progress:',el=id=>document.getElementById(id),preview=document.querySelector('.preview-scroll');
  let current=null,key=null,timer=null,generation=0;
  const keyFor=()=>state.currentFile&&prefix+JSON.stringify([state.connectionKey,state.currentFile.path]);
  const read=key=>{try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}};
  function save(){
    clearTimeout(timer);if(!current||current!==state.currentFile||!key)return;
    const kind=current.kind;if(kind==='mindmap'&&window.mindMapPane.instance?.demonstrate?.isInDemonstrate)return;let value={kind,updated:Date.now()};
    if(kind==='mindmap')value.view=window.mindMapPane.instance?.view.getTransformData();
    else if(kind==='pdf')value.pdf=window.pdfAnnotations.position();
    else if(kind==='docx')Object.assign(value,{top:el('wordScroll').scrollTop,left:el('wordScroll').scrollLeft,zoom:window.wordEditor.getZoom()});
    else if(kind==='audio'||kind==='video'){const player=el(kind==='audio'?'mediaAudio':'mediaVideo');if(!player.readyState)return;value.time=player.ended?0:player.currentTime;}
    else if(kind==='image')Object.assign(value,{...window.mediaViewer.position(),top:el('imageScroll').scrollTop,left:el('imageScroll').scrollLeft});
    else if(!kind)Object.assign(value,{top:editorEl.scrollTop,left:editorEl.scrollLeft,cursor:editorEl.selectionStart,previewTop:preview.scrollTop,mode:state.viewMode});
    else return;
    try{localStorage.setItem(key,JSON.stringify(value));}catch{setStatus('无法保存阅读进度：本机存储空间不足','error');}
  }
  function leave(){save();current=null;key=null;generation++;}
  const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  async function restore(){
    const token=++generation,item=state.currentFile,nextKey=keyFor(),value=read(nextKey);current=null;key=null;
    if(!item)return;
    const kind=item.kind;
    if(kind==='audio'||kind==='video'){
      const player=el(kind==='audio'?'mediaAudio':'mediaVideo');
      const apply=()=>{if(token!==generation||state.currentFile!==item)return;if(value&&Number.isFinite(value.time)&&value.time>0)try{player.currentTime=Math.min(value.time,Number.isFinite(player.duration)?Math.max(0,player.duration-.1):value.time);}catch{}current=item;key=nextKey;};
      if(player.readyState)apply();else player.addEventListener('loadedmetadata',apply,{once:true});return;
    }
    if(kind==='image'){
      const image=el('mediaImage');const apply=()=>{if(token!==generation||state.currentFile!==item)return;if(value){window.mediaViewer.restorePosition(value);el('imageScroll').scrollTop=value.top||0;el('imageScroll').scrollLeft=value.left||0;}current=item;key=nextKey;};
      if(image.complete&&image.naturalWidth)await apply();else image.addEventListener('load',apply,{once:true});return;
    }
    await frame();if(token!==generation||state.currentFile!==item)return;
    if(value){
      if(kind==='mindmap'&&value.view)window.mindMapPane.instance?.view.setTransformData(value.view);
      else if(kind==='pdf')await window.pdfAnnotations.restorePosition(value.pdf||{});
      else if(kind==='docx'){window.wordEditor.setZoom(value.zoom||1);el('wordScroll').scrollTop=value.top||0;el('wordScroll').scrollLeft=value.left||0;}
      else if(!kind){if(['edit','preview','split'].includes(value.mode)){state.viewMode=value.mode;applyViewMode();}editorEl.setSelectionRange(value.cursor||0,value.cursor||0);editorEl.scrollTop=value.top||0;editorEl.scrollLeft=value.left||0;preview.scrollTop=value.previewTop||0;}
    } else if(kind==='docx'){el('wordScroll').scrollTop=0;el('wordScroll').scrollLeft=0;}
    else if(!kind){editorEl.scrollTop=0;preview.scrollTop=0;}
    if(token===generation&&state.currentFile===item){current=item;key=nextKey;}
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(save,250);}
  document.addEventListener('scroll',schedule,true);document.addEventListener('keyup',schedule);document.addEventListener('pointerup',schedule);
  for(const id of ['mediaAudio','mediaVideo'])for(const event of ['timeupdate','pause','ended'])el(id).addEventListener(event,schedule);
  window.addEventListener('beforeunload',save);window.addEventListener('pagehide',save);
  window.readingProgress={save,leave,restore};
})();
