(() => {
  const bar=document.createElement('div');bar.className='document-search';bar.hidden=true;
  bar.innerHTML='<input type="search" aria-label="搜索当前文档" placeholder="搜索当前文档（Ctrl+F）"><span role="status" aria-live="polite"></span><button type="button" title="上一处（Shift+Enter）" aria-label="上一处">↑</button><button type="button" title="下一处（Enter）" aria-label="下一处">↓</button><button type="button" title="清空搜索（Esc）" aria-label="清空搜索">×</button>';
  document.getElementById('moreMenu').before(bar);
  const input=bar.querySelector('input'),label=bar.querySelector('span'),buttons=bar.querySelectorAll('button');
  const pdfRanges=new Map();
  let matches=[],current=-1,serial=0,timer,pdfIndex=null,pdfTask=null,lastFile=null;
  const highlights=new Highlight(),chosen=new Highlight();CSS.highlights.set('document-find',highlights);CSS.highlights.set('document-find-current',chosen);
  const kind=()=>state.currentFile?.kind;
  function supported(){return !!state.currentFile&&[undefined,'docx','pdf','mindmap'].includes(kind());}
  function root(){return kind()==='docx'?document.getElementById('wordPage'):previewEl;}
  function sourceMode(){return kind()===undefined&&state.viewMode!=='preview';}
  function indexDOM(el){const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement.closest('script,style,small,[aria-hidden="true"]')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});let text='',nodes=[],n;while(n=walker.nextNode()){nodes.push({node:n,start:text.length});text+=n.data;}return {text,nodes};}
  function rangeFor(index,start,end){const a=index.nodes.find(n=>n.start+n.node.length>start),b=index.nodes.find(n=>n.start+n.node.length>=end);if(!a||!b)return null;const r=document.createRange();r.setStart(a.node,start-a.start);r.setEnd(b.node,end-b.start);return r;}
  function occurrences(text,q){const result=[],escaped=q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),regex=new RegExp(escaped,'giu');for(const m of text.matchAll(regex))result.push({start:m.index,end:m.index+m[0].length});return result;}
  function status(message){bar.classList.toggle('has-query',!!input.value);label.textContent=message??(matches.length?`${current+1} / ${matches.length}`:input.value?'无匹配':'');buttons[0].disabled=buttons[1].disabled=!matches.length;}
  function clear(){serial++;clearTimeout(timer);input.value='';matches=[];current=-1;pdfIndex=null;pdfTask=null;pdfRanges.clear();highlights.clear();chosen.clear();window.mindMapPane?.instance?.search?.endSearch();status();}
  function sync(){bar.hidden=!supported();if(lastFile!==state.currentFile){clear();lastFile=state.currentFile;}else if(input.value)schedule();}
  function paintPDF(el,page){for(const r of pdfRanges.get(page)||[]){highlights.delete(r);chosen.delete(r);}const ranges=[];pdfRanges.set(page,ranges);if(kind()!=='pdf'||!input.value)return;const index=indexDOM(el);for(const m of matches.filter(m=>m.page===page)){const r=rangeFor(index,m.start,m.end);if(r){ranges.push(r);highlights.add(r);if(m===matches[current])chosen.add(r);}}}
  async function search(jump=true){
    const token=++serial,q=input.value;matches=[];current=-1;highlights.clear();chosen.clear();if(!q||!supported()){window.mindMapPane?.instance?.search?.endSearch();status();return;}
    status('搜索中…');
    try{
      if(kind()==='pdf'){
        if(!pdfIndex){pdfTask??=window.pdfAnnotations.searchIndex();const data=await pdfTask;if(token!==serial)return;pdfIndex=data;}
        for(const p of pdfIndex)matches.push(...occurrences(p.text,q).map(m=>({...m,page:p.page})));
        if(!pdfIndex.some(p=>p.text.trim())){status('没有文字层，需要 OCR');return;}
      }else if(kind()==='mindmap'){
        const plugin=window.mindMapPane?.instance?.search;if(!plugin){status('画布加载中');return;}plugin.endSearch();plugin.search(q);matches=plugin.matchNodeList.map((_,i)=>({node:i}));
      }else if(sourceMode())matches=occurrences(editorEl.value,q);
      else{const index=indexDOM(root());matches=occurrences(index.text,q).map(m=>({...m,range:rangeFor(index,m.start,m.end)}));for(const m of matches)if(m.range)highlights.add(m.range);}
      if(token!==serial)return;current=matches.length?0:-1;status();if(jump&&matches.length)await navigate(0);else repaintPDF();
    }catch(e){if(token===serial){pdfTask=null;status('搜索失败，请重试');console.error('Document search',e);}}
  }
  function repaintPDF(){if(kind()==='pdf'){highlights.clear();chosen.clear();for(const p of window.pdfAnnotations.searchLayers())paintPDF(p.root,p.page);}}
  async function navigate(delta){
    if(!matches.length)return;current=(current+delta+matches.length)%matches.length;const m=matches[current],token=serial;chosen.clear();status();
    if(kind()==='mindmap'){window.mindMapPane.instance.search.searchNext(()=>{},current);return;}
    if(sourceMode()){
      // Measure wrapped text without changing its contents or undo history.
      editorEl.setSelectionRange(m.start,m.end);const mirror=document.createElement('div'),style=getComputedStyle(editorEl);
      for(const prop of ['font','lineHeight','letterSpacing','tabSize','padding','boxSizing','wordBreak','overflowWrap'])mirror.style[prop]=style[prop];
      Object.assign(mirror.style,{position:'fixed',visibility:'hidden',whiteSpace:style.whiteSpace,width:editorEl.clientWidth+'px'});mirror.textContent=editorEl.value.slice(0,m.start);const mark=document.createElement('span');mark.textContent=editorEl.value.slice(m.start,m.end)||' ';mirror.append(mark);document.body.append(mirror);editorEl.scrollTop=Math.max(0,mark.offsetTop-editorEl.clientHeight/3);mirror.remove();return;
    }
    let r=m.range;
    if(kind()==='pdf'){const el=await window.pdfAnnotations.searchPage(m.page);if(token!==serial||m!==matches[current])return;repaintPDF();r=rangeFor(indexDOM(el),m.start,m.end);}
    if(r){chosen.add(r);const rect=r.getBoundingClientRect(),container=kind()==='pdf'?document.querySelector('.pdf-canvas-scroll'):root();let scroller=container;while(scroller&&scroller.scrollHeight<=scroller.clientHeight)scroller=scroller.parentElement;if(scroller){const box=scroller.getBoundingClientRect();scroller.scrollTop+=rect.top-box.top-scroller.clientHeight/3;}}
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>search(false),200);}
  input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>search(),180);});
  input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();navigate(e.shiftKey?-1:1);}if(e.key==='Escape'){e.preventDefault();clear();}});
  buttons[0].onclick=()=>navigate(-1);buttons[1].onclick=()=>navigate(1);buttons[2].onclick=()=>{clear();input.focus();};
  editorEl.addEventListener('input',()=>{if(input.value)schedule();});
  for(const el of [previewEl,document.getElementById('wordPage')])new MutationObserver(()=>{if(input.value&&kind()!=='pdf'&&!sourceMode())schedule();}).observe(el,{subtree:true,childList:true,characterData:true});
  function show(){sync();if(!bar.hidden){input.focus();input.select();}}
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'&&supported()){e.preventDefault();e.stopPropagation();show();}},true);
  window.documentSearch={show,clear,sync,paintPDF,search,navigate,inspect:()=>({count:matches.length,current,query:input.value})};sync();
})();
