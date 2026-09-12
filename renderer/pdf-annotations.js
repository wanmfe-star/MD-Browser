/* Original annotations retain their PDF appearance; edits are undoable snapshots. */
(() => {
  const el = id => document.getElementById(id);
  const overlay = el('pdfOverlayCanvas'), base = el('pdfPageCanvas');
  let bytes, documentPDF, page = 1, tool = 'select', actions = [], pending = null, active = false, loading = false;
  let generation = 0, pageSizes = new Map();
  let originalAnnotations=[], history=[], expectedBytes, sourceRemoved='[]', selectedAnnotation=null, pointerStart=null;
  const removedIds=()=>originalAnnotations.filter(a=>!actions.some(b=>b.id===a.id)).map(a=>a.id);
  let pdfjs, viewportNow, zoom = 1;
  const scroll = document.querySelector('.pdf-canvas-scroll');
  const textLayer = el('pdfTextLayer');
  const floating = el('pdfSelectionToolbar');
  let selecting = false, selectedRange = null;
  function hideSelectionToolbar() { floating.hidden=true;selectedRange=null;selectedAnnotation=null; }
  function annotationRects(a){
    const quads=a.quads?.length?a.quads:[[a.rectPdf[0],a.rectPdf[3],a.rectPdf[2],a.rectPdf[3],a.rectPdf[0],a.rectPdf[1],a.rectPdf[2],a.rectPdf[1]]];
    return quads.map(q=>{const pts=[];for(let i=0;i<8;i+=2)pts.push(viewportNow.convertToViewportPoint(q[i],q[i+1]));const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);return {x:Math.min(...xs)/viewportNow.width,y:Math.min(...ys)/viewportNow.height,w:(Math.max(...xs)-Math.min(...xs))/viewportNow.width,h:(Math.max(...ys)-Math.min(...ys))/viewportNow.height};});
  }
  function popupMode(object){['pdfTextCopy','pdfTextHighlight','pdfTextUnderline'].forEach(id=>el(id).hidden=object);floating.querySelector('span').hidden=object;el('pdfDeleteAnnotation').hidden=!object;}
  function placePopup(anchor){
    const area=scroll.getBoundingClientRect();if(anchor.bottom<area.top || anchor.top>area.bottom){floating.hidden=true;return;}
    floating.hidden=false;const w=floating.offsetWidth,h=floating.offsetHeight;
    floating.style.left=`${Math.max(area.left+8,Math.min(anchor.left+anchor.width/2-w/2,Math.min(area.right,innerWidth)-w-8))}px`;
    const above=anchor.top-h-10;floating.style.top=`${Math.max(area.top+6,Math.min(above>=area.top+6?above:anchor.bottom+10,Math.min(area.bottom,innerHeight)-h-6))}px`;
  }
  function updateSelectionToolbar() {
    if(loading || !active || tool!=='select' || selecting) { hideSelectionToolbar();return; }
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
  textLayer.addEventListener('pointerdown',event=>{selecting=true;pointerStart={x:event.clientX,y:event.clientY};hideSelectionToolbar();});
  document.addEventListener('pointerup',event=>{if(selecting){selecting=false;const click=pointerStart && Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)<4;requestAnimationFrame(()=>{if(click && window.getSelection().isCollapsed && !loading){const b=base.getBoundingClientRect(),x=(event.clientX-b.left)/b.width,y=(event.clientY-b.top)/b.height;const hit=[...actions].reverse().find(a=>a.page===page && annotationRects(a).some(r=>x>=r.x && x<=r.x+r.w && y>=r.y-3/b.height && y<=r.y+r.h+3/b.height));if(hit)selectedAnnotation=hit.id;}updateSelectionToolbar();paint();});}});
  document.addEventListener('selectionchange',()=>{if(!selecting)updateSelectionToolbar();});
  scroll.addEventListener('scroll',updateSelectionToolbar);
  window.addEventListener('resize',updateSelectionToolbar);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')hideSelectionToolbar();});
  document.addEventListener('pointerdown',event=>{if(!floating.contains(event.target) && !textLayer.contains(event.target))hideSelectionToolbar();});
  el('pdfTextCopy').onclick=async()=>{
    restoreSelection();const text=window.getSelection().toString();if(!text)return;
    try {const result=await window.mdAPI.copyText(text);if(!result.ok)throw new Error(result.error);status('已复制所选文字');hideSelectionToolbar();}
    catch(error){status('复制失败：'+error.message);}
  };
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
    overlay.style.pointerEvents = loading || tool === 'select' ? 'none' : '';
    textLayer.style.pointerEvents = !loading && tool === 'select' ? 'auto' : 'none';
    ['pdfTextHighlight','pdfTextUnderline'].forEach(id => { el(id).disabled = loading; });
  }
  function draw(ctx,a,w,h) {
    ctx.save();ctx.scale(w,h);ctx.fillStyle=a.color;ctx.globalAlpha=a.tool==='textHighlight'?0.3:1;
    for(const r of a.rects)ctx.fillRect(r.x,a.tool==='textHighlight'?r.y:r.y+r.h-2/a.pageHeight,r.w,a.tool==='textHighlight'?r.h:2/a.pageHeight);
    ctx.restore();
  }
  function paint() {
    const ctx = overlay.getContext('2d');ctx.clearRect(0,0,overlay.width,overlay.height);
    for (const a of actions.filter(a => a.page === page && !a.existing)) draw(ctx,a,overlay.width,overlay.height);
    const selected=actions.find(a=>a.id===selectedAnnotation);if(selected && selected.page===page){ctx.save();ctx.strokeStyle='#347552';ctx.lineWidth=2;ctx.setLineDash([6,4]);for(const r of annotationRects(selected))ctx.strokeRect(r.x*overlay.width,r.y*overlay.height,r.w*overlay.width,r.h*overlay.height);ctx.restore();}
    if (pending) draw(ctx,pending,overlay.width,overlay.height);
    controls();
  }
  async function render() {
    loading = true; controls(); status('正在加载页面…');
    try {
      hideSelectionToolbar();
      const p = await documentPDF.getPage(page);
      const natural=p.getViewport({scale:1});
      const available=Math.max(200,scroll.clientWidth-48);
      const viewport=p.getViewport({scale:available/natural.width*zoom});
      viewportNow = viewport;
      window.getSelection().removeAllRanges();textLayer.replaceChildren();
      pageSizes.set(page, { width: viewport.width, height: viewport.height });
      const density=Math.min(window.devicePixelRatio || 1,2);
      base.width = overlay.width = Math.ceil(viewport.width*density); base.height = overlay.height = Math.ceil(viewport.height*density);
      el('pdfCanvasWrap').style.width = `${viewport.width}px`;
      await p.render({ canvasContext: base.getContext('2d'), viewport, transform:[density,0,0,density,0,0] }).promise;
      const content = await p.getTextContent();
      textLayer.style.setProperty('--scale-factor', viewport.scale);
      await new pdfjs.TextLayer({textContentSource:content,container:textLayer,viewport}).render();
      fitText();
      status(content.items.some(item => item.str?.trim()) ? (dirty()?'标注未保存':'选中文字即可标注') : '本页无可选文字，需要先做 OCR');
    } finally { loading = false; paint(); }
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
  async function changeZoom(value){zoom=Math.max(0.5,Math.min(3,value));await render();el('pdfZoomFit').textContent=zoom===1?'适宽':`${Math.round(zoom*100)}%`;}
  el('pdfZoomOut').onclick=()=>runAction(()=>changeZoom(zoom-0.25));
  el('pdfZoomIn').onclick=()=>runAction(()=>changeZoom(zoom+0.25));
  el('pdfZoomFit').onclick=()=>runAction(()=>changeZoom(1));
  el('pdfPageJump').onchange=()=>runAction(async()=>{page=Math.max(1,Math.min(documentPDF.numPages,Math.trunc(Number(el('pdfPageJump').value)) || 1));await render();scroll.scrollTop=0;});
  el('pdfPrevious').onclick=()=>runAction(async()=>{page--;await render();scroll.scrollTop=0;});
  el('pdfNext').onclick=()=>runAction(async()=>{page++;await render();scroll.scrollTop=0;});
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
  window.pdfAnnotations={dirty,save,open:start,load(data){this.clear();bytes=new Uint8Array(data);expectedBytes=bytes.slice();},clear(){
    hideSelectionToolbar();selecting=false;history=[];originalAnnotations=[];sourceRemoved='[]';expectedBytes=null;generation++;documentPDF?.destroy();documentPDF=null;bytes=null;actions=[];pending=null;active=false;savedActions='[]';page=1;zoom=1;el('pdfZoomFit').textContent='适宽';pageSizes.clear();viewportNow=null;textLayer.replaceChildren();
    el('pdfAnnotationPanel').hidden=true;el('pdfViewer').style.display='';el('pdfAnnotate').textContent='原版阅读器';
  }};
})();
