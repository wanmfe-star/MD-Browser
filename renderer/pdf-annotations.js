/* Original annotations retain their PDF appearance; edits are undoable snapshots. */
(() => {
  const el = id => document.getElementById(id);
  let overlay = el('pdfOverlayCanvas'), base = el('pdfPageCanvas');
  let bytes, documentPDF, page = 1, tool = 'select', actions = [], pending = null, active = false, loading = false;
  let generation = 0, pageSizes = new Map();
  let originalAnnotations=[], history=[], expectedBytes, sourceRemoved='[]', selectedAnnotation=null, pointerStart=null;
  const removedIds=()=>originalAnnotations.filter(a=>!actions.some(b=>b.id===a.id)).map(a=>a.id);
  let pdfjs, viewportNow, zoom = 1;
  const scroll = document.querySelector('.pdf-canvas-scroll');
  let textLayer = el('pdfTextLayer');
  const firstPage = { number: 1, wrap: el('pdfCanvasWrap'), base, overlay, textLayer };
  let pages = [], layoutKey = '', scrollTimer;
  function bindPage(entry) {
    if (!entry) return;
    for (const id of ['pdfCanvasWrap','pdfPageCanvas','pdfOverlayCanvas','pdfTextLayer']) el(id)?.removeAttribute('id');
    entry.wrap.id='pdfCanvasWrap';entry.base.id='pdfPageCanvas';entry.overlay.id='pdfOverlayCanvas';entry.textLayer.id='pdfTextLayer';
    page=entry.number;base=entry.base;overlay=entry.overlay;textLayer=entry.textLayer;viewportNow=entry.viewport;
  }
  const floating = el('pdfSelectionToolbar');
  let selecting = false, selectedRange = null;
  function hideSelectionToolbar() { floating.hidden=true;selectedRange=null;selectedAnnotation=null; }
  function annotationRects(a){
    const quads=a.quads?.length?a.quads:[[a.rectPdf[0],a.rectPdf[3],a.rectPdf[2],a.rectPdf[3],a.rectPdf[0],a.rectPdf[1],a.rectPdf[2],a.rectPdf[1]]];
    return quads.map(q=>{const pts=[];for(let i=0;i<8;i+=2)pts.push(viewportNow.convertToViewportPoint(q[i],q[i+1]));const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);return {x:Math.min(...xs)/viewportNow.width,y:Math.min(...ys)/viewportNow.height,w:(Math.max(...xs)-Math.min(...xs))/viewportNow.width,h:(Math.max(...ys)-Math.min(...ys))/viewportNow.height};});
  }
  function popupMode(object){el('pdfDictionary').hidden=object || !window.dictionaryLookup?.canLookup(getSelection().toString());['pdfTextCopy','pdfTextHighlight','pdfTextUnderline'].forEach(id=>el(id).hidden=object);floating.querySelector('span').hidden=object;el('pdfDeleteAnnotation').hidden=!object;}
  function placePopup(anchor){
    const area=scroll.getBoundingClientRect();if(anchor.bottom<area.top || anchor.top>area.bottom){floating.hidden=true;return;}
    floating.hidden=false;const w=floating.offsetWidth,h=floating.offsetHeight;
    floating.style.left=`${Math.max(area.left+8,Math.min(anchor.left+anchor.width/2-w/2,Math.min(area.right,innerWidth)-w-8))}px`;
    const above=anchor.top-h-10;floating.style.top=`${Math.max(area.top+6,Math.min(above>=area.top+6?above:anchor.bottom+10,Math.min(area.bottom,innerHeight)-h-6))}px`;
  }
  function updateSelectionToolbar() {
    if(loading || !active || tool!=='select' || selecting || window.dictionaryLookup?.isOpen()) { hideSelectionToolbar();return; }
    if(selectedAnnotation){const a=actions.find(a=>a.id===selectedAnnotation);if(a && a.page===page){const r=annotationRects(a)[0],b=base.getBoundingClientRect();popupMode(true);placePopup({left:b.left+r.x*b.width,top:b.top+r.y*b.height,bottom:b.top+(r.y+r.h)*b.height,width:r.w*b.width});return;}}
    const selection=window.getSelection();
    if(!selection.rangeCount || selection.isCollapsed || !selection.toString().trim()) {hideSelectionToolbar();return;}
    const range=selection.getRangeAt(0);
    if(!textLayer.contains(range.startContainer) || !textLayer.contains(range.endContainer)) {hideSelectionToolbar();return;}
    const area=scroll.getBoundingClientRect();
    const visible=[...range.getClientRects()].filter(r=>r.width && r.height && r.bottom>area.top && r.top<area.bottom && r.right>area.left && r.left<area.right);
    if(!visible.length){hideSelectionToolbar();return;}
    selectedRange=range.cloneRange();popupMode(false);placePopup(visible[0]);
  }
  function restoreSelection() {
    if(!selectedRange)return;
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(selectedRange.cloneRange());
  }
  floating.addEventListener('mousedown',event=>event.preventDefault());
  scroll.addEventListener('pointerdown',event=>{const entry=pages.find(p=>p.textLayer.contains(event.target));if(!entry || loading || !entry.renderedKey)return;bindPage(entry);paint();selecting=true;pointerStart={x:event.clientX,y:event.clientY};hideSelectionToolbar();});
  document.addEventListener('pointerup',event=>{if(selecting){selecting=false;const click=pointerStart && Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)<4;requestAnimationFrame(()=>{if(click && window.getSelection().isCollapsed && !loading){const b=base.getBoundingClientRect(),x=(event.clientX-b.left)/b.width,y=(event.clientY-b.top)/b.height;const hit=[...actions].reverse().find(a=>a.page===page && annotationRects(a).some(r=>x>=r.x && x<=r.x+r.w && y>=r.y-3/b.height && y<=r.y+r.h+3/b.height));if(hit)selectedAnnotation=hit.id;}updateSelectionToolbar();paint();});}});
  document.addEventListener('selectionchange',()=>{if(!selecting)updateSelectionToolbar();});
  scroll.addEventListener('scroll',()=>{updateSelectionToolbar();queueScrollRender();});
  window.addEventListener('resize',()=>{updateSelectionToolbar();queueScrollRender();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')hideSelectionToolbar();});
  document.addEventListener('pointerdown',event=>{if(!floating.contains(event.target) && !textLayer.contains(event.target))hideSelectionToolbar();});
  el('pdfTextCopy').onclick=async()=>{
    restoreSelection();const text=window.getSelection().toString();if(!text)return;
    try {const result=await window.mdAPI.copyText(text);if(!result.ok)throw new Error(result.error);status('已复制所选文字');hideSelectionToolbar();}
    catch(error){status('复制失败：'+error.message);}
  };
  el('pdfDictionary').onclick=()=>{restoreSelection();const text=getSelection().toString(),rect=floating.getBoundingClientRect();hideSelectionToolbar();window.dictionaryLookup.show(text,rect);};
  const native = a => a.tool === 'textHighlight' || a.tool === 'textUnderline';
  const fitText = () => {
    if (!viewportNow) return;
    const turns = {0:'',90:'rotate(90deg) translateY(-100%)',180:'rotate(180deg) translate(-100%, -100%)',270:'rotate(270deg) translateX(-100%)'};
    textLayer.style.transform = `scale(${base.getBoundingClientRect().width / viewportNow.width}) ${turns[viewportNow.rotation] || ''}`;
  };
  new ResizeObserver(fitText).observe(base);
  let savedActions = '[]';
  const dirty = () => JSON.stringify(actions) !== savedActions;
  const status = message => { el('pdfAnnotationStatus').textContent=message;el('pdfAnnotationStatus').title=message; };
  function controls() {
    if(loading || !active || tool!=='select')hideSelectionToolbar();
    el('pdfPrevious').disabled = loading || page <= 1;
    el('pdfNext').disabled = loading || !documentPDF || page >= documentPDF.numPages;
    el('pdfUndo').disabled = loading || !history.length;
    el('pdfClearAnnotations').disabled=loading || !actions.length;
    el('pdfDeleteAnnotation').disabled=loading;
    el('pdfSaveAnnotations').disabled = loading || !dirty();
    el('pdfAnnotate').disabled = loading;
    el('pdfPageNumber').textContent = documentPDF ? `/ ${documentPDF.numPages}` : '';
    el('pdfPageJump').value=page;el('pdfPageJump').max=documentPDF?.numPages || 1;
    ['pdfPageJump','pdfZoomIn','pdfZoomOut','pdfZoomFit'].forEach(id=>{el(id).disabled=loading || !documentPDF;});
    for(const entry of pages){entry.overlay.style.pointerEvents=loading || tool==='select'?'none':'';entry.textLayer.style.pointerEvents=!loading && tool==='select'?'auto':'none';}
    ['pdfTextHighlight','pdfTextUnderline'].forEach(id => { el(id).disabled = loading; });
  }
  function draw(ctx,a,w,h) {
    ctx.save();ctx.scale(w,h);ctx.fillStyle=a.color;ctx.globalAlpha=a.tool==='textHighlight'?0.3:1;
    for(const r of a.rects)ctx.fillRect(r.x,a.tool==='textHighlight'?r.y:r.y+r.h-2/a.pageHeight,r.w,a.tool==='textHighlight'?r.h:2/a.pageHeight);
    ctx.restore();
  }
  function paint() {
    for(const entry of pages) {
      if(!entry.renderedKey)continue;
      const canvas=entry.overlay,ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
      for(const annotation of actions.filter(a=>a.page===entry.number && !a.existing))draw(ctx,annotation,canvas.width,canvas.height);
      const selected=actions.find(a=>a.id===selectedAnnotation);
      if(selected && selected.page===entry.number && entry.number===page){ctx.save();ctx.strokeStyle='#347552';ctx.lineWidth=2;ctx.setLineDash([6,4]);for(const r of annotationRects(selected))ctx.strokeRect(r.x*canvas.width,r.y*canvas.height,r.w*canvas.width,r.h*canvas.height);ctx.restore();}
    }
    controls();
  }
  function pageAtScroll() {
    const top=scroll.getBoundingClientRect().top+Math.min(100,scroll.clientHeight/3);
    return pages.find(entry=>entry.wrap.getBoundingClientRect().bottom>top) || pages.at(-1);
  }
  function queueScrollRender() {
    clearTimeout(scrollTimer);
    if(!active || !documentPDF)return;
    scrollTimer=setTimeout(()=>{
      if(loading || state.busy || selecting){queueScrollRender();return;}
      const entry=pageAtScroll();if(!entry)return;
      if(entry.number!==page){hideSelectionToolbar();bindPage(entry);}
      runAction(()=>render());
    },80);
  }
  async function preparePages(token) {
    if(pages.length)return;
    for(let n=1;n<=documentPDF.numPages;n++) {
      const pdfPage=await documentPDF.getPage(n);if(token!==generation)return;
      let entry;
      if(n===1)entry=firstPage;
      else {
        const wrap=document.createElement('div'),canvas=document.createElement('canvas'),marks=document.createElement('canvas'),text=document.createElement('div');
        wrap.append(canvas,marks,text);scroll.append(wrap);
        entry={number:n,wrap,base:canvas,overlay:marks,textLayer:text};
      }
      entry.wrap.className='pdf-page-wrap';entry.wrap.dataset.page=n;
      entry.wrap.setAttribute('aria-label','第 '+n+' 页');
      entry.base.className='pdf-page-canvas';entry.overlay.className='pdf-overlay-canvas';entry.textLayer.className='textLayer pdf-text-layer';
      entry.natural=pdfPage.getViewport({scale:1});entry.renderedKey='';pages.push(entry);
    }
  }
  async function render() {
    const token=generation;
    loading=true;controls();
    try {
      await preparePages(token);if(token!==generation)return;
      const available=Math.max(200,scroll.clientWidth-48),key=available+':'+zoom+':'+sourceRemoved;
      const anchor=pages[page-1],oldTop=anchor.wrap.getBoundingClientRect().top-scroll.getBoundingClientRect().top;
      const oldHeight=anchor.wrap.offsetHeight || 1;
      if(key!==layoutKey){
        hideSelectionToolbar();window.getSelection().removeAllRanges();
        for(const entry of pages){
          const scale=available/entry.natural.width*zoom;
          entry.wrap.style.width=entry.natural.width*scale+'px';entry.wrap.style.height=entry.natural.height*scale+'px';
          entry.base.width=entry.overlay.width=0;entry.base.height=entry.overlay.height=0;
          entry.textLayer.replaceChildren();entry.renderedKey='';entry.viewport=null;
        }
        if(layoutKey)scroll.scrollTop+=anchor.wrap.getBoundingClientRect().top-scroll.getBoundingClientRect().top-oldTop*anchor.wrap.offsetHeight/oldHeight;
        layoutKey=key;
      }
      const area=scroll.getBoundingClientRect();
      const wanted=pages.filter(entry=>{const rect=entry.wrap.getBoundingClientRect();return entry.number===page || (rect.bottom>area.top-scroll.clientHeight && rect.top<area.bottom+scroll.clientHeight);});
      // Render visible pages and a screen of look-ahead; release distant canvases on long documents.
      for(const entry of pages){if(!wanted.includes(entry) && entry.renderedKey){entry.base.width=entry.overlay.width=0;entry.base.height=entry.overlay.height=0;entry.textLayer.replaceChildren();entry.renderedKey='';}}
      for(const entry of wanted){
        if(entry.renderedKey===key)continue;
        status('正在加载第 '+entry.number+' 页…');
        const pdfPage=await documentPDF.getPage(entry.number);if(token!==generation)return;
        const viewport=pdfPage.getViewport({scale:available/entry.natural.width*zoom}),density=Math.min(window.devicePixelRatio || 1,2,Math.sqrt(16000000/(viewport.width*viewport.height)));
        entry.viewport=viewport;pageSizes.set(entry.number,{width:viewport.width,height:viewport.height});
        entry.base.width=entry.overlay.width=Math.ceil(viewport.width*density);entry.base.height=entry.overlay.height=Math.ceil(viewport.height*density);
        await pdfPage.render({canvasContext:entry.base.getContext('2d'),viewport,transform:[density,0,0,density,0,0]}).promise;if(token!==generation)return;
        const content=await pdfPage.getTextContent();if(token!==generation)return;
        entry.textLayer.replaceChildren();entry.textLayer.style.setProperty('--scale-factor',viewport.scale);
        await new pdfjs.TextLayer({textContentSource:content,container:entry.textLayer,viewport}).render();if(token!==generation)return;
        entry.renderedKey=key;entry.hasText=content.items.some(item=>item.str?.trim());
        bindPage(entry);fitText();
      }
      bindPage(anchor);
      status(dirty()?'标注未保存':anchor.hasText?'上下滚动阅读 · 选中文字即可标注':'本页无可选文字，需要先做 OCR');
    } finally {if(token===generation){loading=false;paint();}}
  }
  async function goToPage(value) {
    if(!documentPDF)return;
    const number=Math.max(1,Math.min(documentPDF.numPages,Math.trunc(Number(value)) || 1));
    hideSelectionToolbar();bindPage(pages[number-1]);
    const entry=pages[number-1];
    scroll.scrollTop+=entry.wrap.getBoundingClientRect().top-scroll.getBoundingClientRect().top-24;
    await render();
  }
  async function start() {
    if (active) { hideSelectionToolbar();active=false;el('pdfAnnotationPanel').hidden=true;el('pdfViewer').style.display='';el('pdfAnnotate').textContent='返回阅读与标注';return; }
    if (!bytes) return;
    loading=true;controls(); const token=generation;
    try {
      if (!documentPDF) {
        pdfjs = await import('../node_modules/pdfjs-dist/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs', location.href).href;
        const inspected=await window.mdAPI.inspectPDFAnnotations(bytes);if(!inspected.ok)throw new Error(inspected.error);
        originalAnnotations=inspected.data;actions=originalAnnotations.slice();savedActions=JSON.stringify(actions);
        documentPDF = await pdfjs.getDocument({ data: bytes.slice(), cMapUrl: new URL('../node_modules/pdfjs-dist/cmaps/', location.href).href, cMapPacked:true, standardFontDataUrl:new URL('../node_modules/pdfjs-dist/standard_fonts/', location.href).href }).promise;
      }
      if (token !== generation) return;
      active=true;el('pdfAnnotationPanel').hidden=false;el('pdfViewer').style.display='none';el('pdfAnnotate').textContent='原版阅读器';
      await render();
    } catch (e) { active=false;el('pdfAnnotationPanel').hidden=true;el('pdfViewer').style.display='';el('pdfAnnotate').textContent='重试阅读与标注';status('加载失败：'+e.message); throw e; }
    finally { loading=false;controls(); }
  }
  function commit(a) { history.push(actions.slice());actions=[...actions,{...a,id:crypto.randomUUID()}];paint(); }
  async function rebuildSource(){
    const removed=removedIds(),key=JSON.stringify(removed);if(key===sourceRemoved)return;
    const result=await window.mdAPI.previewPDFAnnotations({bytes,removed});if(!result.ok)throw new Error(result.error);
    const next=await pdfjs.getDocument({data:new Uint8Array(result.data),cMapUrl:new URL('../node_modules/pdfjs-dist/cmaps/',location.href).href,cMapPacked:true,standardFontDataUrl:new URL('../node_modules/pdfjs-dist/standard_fonts/',location.href).href}).promise;
    await documentPDF.destroy();documentPDF=next;sourceRemoved=key;await render();
  }
  async function replaceActions(next,undo=false){
    if(loading)return;const previous=actions;loading=true;controls();hideSelectionToolbar();
    actions=next;
    try {await rebuildSource();if(undo)history.pop();else history.push(previous);status(dirty()?'标注未保存 · ⌘S 保存':'已恢复到保存状态');}
    catch(error){actions=previous;throw error;}
    finally {loading=false;paint();}
  }
  const undo=()=>history.length?replaceActions(history[history.length-1],true):undefined;
  el('pdfDeleteAnnotation').onclick=()=>{const id=selectedAnnotation;if(id)runAction(()=>replaceActions(actions.filter(a=>a.id!==id)));};
  el('pdfClearAnnotations').onclick=()=>{el('pdfReadingMenu').open=false;runAction(()=>replaceActions([]));};
  document.addEventListener('keydown',event=>{
    if(state.currentFile?.kind!=='pdf' || !active || event.target.closest?.('input,textarea,[contenteditable=true]') || document.querySelector('dialog[open]'))return;
    if((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase()==='z'){event.preventDefault();runAction(undo);}
  });
  function markSelection(kind) {
    restoreSelection();
    const selection = window.getSelection();
    if (!selection.rangeCount || selection.isCollapsed) {
      status('请先拖选 PDF 中的文字，再点击文字高亮或下划线。');return;
    }
    const range = selection.getRangeAt(0);
    if (!textLayer.contains(range.startContainer) || !textLayer.contains(range.endContainer)) {status('请选择当前 PDF 页面中的文字。');return;}
    const bounds = base.getBoundingClientRect(), rects = [];
    const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;if (!range.intersectsNode(node)) continue;
      const part = document.createRange();part.selectNodeContents(node);
      if(node===range.startContainer)part.setStart(node,range.startOffset);
      if(node===range.endContainer)part.setEnd(node,range.endOffset);
      if(part.collapsed)continue;
      for(const r of part.getClientRects()) if(r.width>0 && r.height>0) rects.push({x:(r.left-bounds.left)/bounds.width,y:(r.top-bounds.top)/bounds.height,w:r.width/bounds.width,h:r.height/bounds.height});
    }
    if(!rects.length)return;
    const quads=rects.map(r=>[[r.x,r.y],[r.x+r.w,r.y],[r.x,r.y+r.h],[r.x+r.w,r.y+r.h]].flatMap(([x,y])=>viewportNow.convertToPdfPoint(x*viewportNow.width,y*viewportNow.height)));
    commit({page,tool:kind,color:kind==='textHighlight' ? '#ffdd33' : '#e64c4c',rects,quads,text:selection.toString(),pageWidth:viewportNow.width,pageHeight:viewportNow.height});
    selection.removeAllRanges();hideSelectionToolbar();status('标注未保存 · ⌘S 保存');
  }
  for(const [id,kind] of [['pdfTextHighlight','textHighlight'],['pdfTextUnderline','textUnderline']]) {
    el(id).onmousedown=event=>event.preventDefault();el(id).onclick=()=>markSelection(kind);
  }
  async function changeZoom(value){zoom=window.viewZoom.clamp(value,0.1,4);await render();el('pdfZoomFit').textContent=zoom===1?'适宽':`${Number((zoom*100).toFixed(1))}%`;}
  let wheelZoom = null;
  scroll.addEventListener('wheel', event => {
    if (!active || !documentPDF || !event.ctrlKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.deltaY || ((loading || state.busy) && wheelZoom === null)) return;
    const target = window.viewZoom.clamp((wheelZoom ?? zoom) + window.viewZoom.delta(event, scroll), 0.1, 4);
    if (wheelZoom !== null) { wheelZoom = target; return; }
    if (target === zoom) return;
    wheelZoom = target;
    const token = generation;
    // Serialize canvas renders while retaining wheel input received during rendering.
    runAction(async () => {
      try {
        while (token === generation && active && wheelZoom !== zoom) await changeZoom(wheelZoom);
      } finally { wheelZoom = null; }
    });
  }, { passive: false });
  el('pdfZoomOut').onclick=()=>runAction(()=>changeZoom(zoom-0.05));
  el('pdfZoomIn').onclick=()=>runAction(()=>changeZoom(zoom+0.05));
  el('pdfZoomFit').onclick=()=>runAction(()=>changeZoom(1));
  el('pdfPageJump').onchange=()=>runAction(()=>goToPage(el('pdfPageJump').value));
  el('pdfPrevious').onclick=()=>runAction(()=>goToPage(page-1));
  el('pdfNext').onclick=()=>runAction(()=>goToPage(page+1));
  el('pdfUndo').onclick=()=>runAction(undo);
  el('pdfAnnotate').onclick=()=>{el('pdfReadingMenu').open=false;runAction(start);};
  el('pdfSaveAnnotations').onclick=()=>{el('pdfReadingMenu').open=false;runAction(save);};
  document.addEventListener('pointerdown',event=>{if(!el('pdfReadingMenu').contains(event.target))el('pdfReadingMenu').open=false;});
  async function save() {
    if(!dirty())return;
    loading=true;controls();status('正在保存当前 PDF…');
    try {
      const result=await window.mdAPI.saveAnnotatedPDF({bytes,annotations:actions.filter(a=>!a.existing && native(a)),removed:removedIds(),path:state.currentFile.path,expected:expectedBytes});
      if(!result.ok)throw new Error(result.error);
      expectedBytes=new Uint8Array(result.data);savedActions=JSON.stringify(actions);
      const url=URL.createObjectURL(new Blob([expectedBytes],{type:'application/pdf'}));if(state.pdfUrl)URL.revokeObjectURL(state.pdfUrl);state.pdfUrl=url;el('pdfViewer').src=url;
      status('已保存到原文件');
    }finally{loading=false;controls();}
  }
  window.pdfAnnotations={position(){const entry=pages[page-1];return {page,zoom,offset:entry?(scroll.getBoundingClientRect().top-entry.wrap.getBoundingClientRect().top)/Math.max(1,entry.wrap.offsetHeight):0};},async restorePosition(value){if(!documentPDF)return;await changeZoom(Number(value.zoom)||1);await goToPage(Number(value.page)||1);const entry=pages[page-1];if(entry)scroll.scrollTop+=entry.wrap.getBoundingClientRect().top-scroll.getBoundingClientRect().top+(Number(value.offset)||0)*entry.wrap.offsetHeight;queueScrollRender();},dirty,save,open:start,load(data){this.clear();bytes=new Uint8Array(data);expectedBytes=bytes.slice();},clear(){
    clearTimeout(scrollTimer);scroll.scrollTop=0;pages=[];layoutKey='';firstPage.viewport=null;firstPage.renderedKey='';scroll.replaceChildren(firstPage.wrap);firstPage.wrap.style.height='';bindPage(firstPage);
    hideSelectionToolbar();selecting=false;history=[];originalAnnotations=[];sourceRemoved='[]';expectedBytes=null;generation++;documentPDF?.destroy();documentPDF=null;bytes=null;actions=[];pending=null;active=false;savedActions='[]';page=1;zoom=1;el('pdfZoomFit').textContent='适宽';pageSizes.clear();viewportNow=null;textLayer.replaceChildren();
    el('pdfAnnotationPanel').hidden=true;el('pdfViewer').style.display='';el('pdfAnnotate').textContent='原版阅读器';
  }};
})();
