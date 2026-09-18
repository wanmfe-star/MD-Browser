(() => {
  const bar=document.createElement('nav');bar.className='section-tabs';bar.setAttribute('aria-label','文档章节');bar.hidden=true;
  document.querySelector('.document-header').after(bar);
  let owner=null,full='',sections=[],active=-1,start=0,end=0;
  const eligible=()=>state.currentFile&&!state.currentFile.kind&&isMarkdown(state.currentFile.name);
  function text(){
    if(owner!==state.currentFile||active<0)return editorEl.value;
    const edited=editorEl.value,suffix=full.slice(end);
    return full.slice(0,start)+edited+(suffix&&edited&&!edited.endsWith('\n')?'\n\n':'')+suffix;
  }
  function parse(){sections=markdownSections.split(full,s=>marked.lexer(s));}
  function paint(){
    bar.hidden=!eligible();bar.replaceChildren();if(bar.hidden)return;
    const make=(label,index)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.title=label;b.className=index===active?'active':'';b.setAttribute('aria-pressed',String(index===active));b.disabled=state.editorLocked;b.onclick=()=>select(index);bar.append(b);};
    make('全文',-1);sections.forEach((section,i)=>make(section.title,i));
    const add=document.createElement('button');add.type='button';add.className='section-add';add.textContent='＋';add.title='新增标签页';add.setAttribute('aria-label','新增标签页');add.disabled=state.busy;add.onclick=create;bar.append(add);
  }
  function show(){
    if(active<0){start=0;end=full.length;editorEl.value=full;}
    else{const section=sections[active];start=section.start;end=section.end;editorEl.value=full.slice(start,end);}
    editorEl.scrollTop=0;previewEl.scrollTop=0;editorEl.setSelectionRange(0,0);paint();renderPreview();updateMetrics();window.documentSearch?.clear();
  }
  function select(index){
    if(state.editorLocked||!eligible()||owner!==state.currentFile)return;
    const position=index>=0?sections[index]?.start:null;
    // Rebuild section boundaries after edits, retaining the requested heading when possible.
    const oldEnd=end,delta=text().length-full.length;
    full=text();parse();
    const target=position===null?-1:position+(active>=0&&position>=oldEnd?delta:0);
    active=target<0?-1:sections.findIndex(s=>s.start===target);
    show();updateDirty();
  }
  function load(){owner=state.currentFile;full=editorEl.value;active=-1;start=0;end=full.length;parse();paint();}
  async function create(){
    const file=state.currentFile;const title=await promptName('新标签页名称','');
    if(!title||file!==state.currentFile||state.busy||!eligible())return;
    const name=title.trim();if(/[\r\n]/.test(name)){setStatus('标签页名称不能包含换行','error');return;}
    full=text();full+=(full&&!full.endsWith('\n\n')?(full.endsWith('\n')?'\n':'\n\n'):'')+'# '+name+'\n\n';
    parse();active=sections.length-1;show();editorEl.dispatchEvent(new Event('input',{bubbles:true}));editorEl.focus();editorEl.setSelectionRange(editorEl.value.length,editorEl.value.length);
  }
  editorEl.addEventListener('input',()=>{
    if(owner!==state.currentFile||!eligible())return;
    if(active<0){full=editorEl.value;parse();paint();}
    else{const heading=/^ {0,3}#(?:[ \t]+(.*))?(?:\r?\n|$)/.exec(editorEl.value);if(heading){sections[active].title=(heading[1]||'未命名').replace(/[ \t]+#+[ \t]*$/,'');paint();}}
  });
  window.sectionTabs={text,load,sync:paint,clear(){owner=null;full='';sections=[];active=-1;bar.hidden=true;},inspect:()=>({active,titles:sections.map(s=>s.title)})};
  if(eligible())load();
})();
