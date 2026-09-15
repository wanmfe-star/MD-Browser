(() => {
  const pane=document.createElement('section');pane.id='mindMapPane';pane.hidden=true;
  $('primaryPane').insertBefore(pane,$('primaryPane').querySelector('.statusbar'));
  let map=null,frame=null,initial=null,resolveReady=null,rejectReady=null,readyTimer=null;
  function validate(value){
    if(!value||typeof value!=='object')throw Error('不是有效的思维导图文件');
    const full=value.root?value:{root:value};let count=0;
    full.theme=full.theme||{template:'default',config:{}};full.layout=full.layout||'mindMap';
    function visit(node,depth){
      if(depth>150||++count>10000)throw Error('导图过大：最多支持 10000 个节点、150 层');
      if(!node||!node.data||typeof node.data.text!=='string'||(node.children!==undefined&&!Array.isArray(node.children)))throw Error('导图节点数据不完整');
      node.data.text=window.DOMPurify.sanitize(node.data.text);
      if(node.data.hyperlink&&!/^https?:\/\//i.test(node.data.hyperlink))delete node.data.hyperlink;
      for(const child of node.children||[])visit(child,depth+1);
    }visit(full.root,0);return full;
  }
  const empty=title=>({layout:'mindMap',root:{data:{text:title},children:[{data:{text:'分支主题'},children:[]}]}});

  function changed(data){
    if(!map||map.demonstrate?.isInDemonstrate||state.currentFile?.kind!=='mindmap')return;
    editorEl.value=JSON.stringify(data||map.getData(true));persistDraft();updateDirty();scheduleSave();
  }
  function clear(){clearTimeout(readyTimer);resolveReady?.();resolveReady=null;rejectReady=null;map=null;frame?.remove();frame=null;pane.replaceChildren();}
  function mount(data){
    initial=data;frame=document.createElement('iframe');frame.id='mindWebFrame';frame.title='思绪思维导图完整编辑器';frame.allowFullscreen=true;
    const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;readyTimer=setTimeout(()=>reject(Error('思维导图编辑器加载超时')),20000);});
    frame.src='./vendor/simple-mind-map-web/index.html';pane.append(frame);return ready;
  }
  function attach(child){
    if(child!==frame?.contentWindow)throw Error('无效的编辑器窗口');
    const valid=()=>child===frame?.contentWindow;
    const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem('mind-web-'+key))||fallback;}catch{return fallback;}};
    return {
      data:JSON.parse(JSON.stringify(initial)),
      config:read('config',{}),local:read('local',{openNodeRichText:true,useLeftKeySelectionRightKeyDrag:true,isShowScrollbar:false,enableAi:false}),
      settings:(key,value)=>{if(valid())localStorage.setItem('mind-web-'+key,JSON.stringify(value));},
      ready:instance=>{if(!valid())return;map=instance;clearTimeout(readyTimer);resolveReady?.();resolveReady=null;},
      changed:data=>{if(valid())changed(data);},
      save:()=>{if(valid()){changed();return runAction(save);}},
      create:data=>{if(valid())return runAction(()=>create(true,data?validate(JSON.parse(JSON.stringify(data))):null));},
      activate:()=>{if(valid())(window.workspace||window.paneHost)?.activate(window.isPaneChild?'secondary':'primary');},
      browse:()=>{if(valid())setStatus('请从左侧文件列表选择导图，或使用导入按钮');},
      error:message=>{if(valid()){clearTimeout(readyTimer);rejectReady?.(Error(message));rejectReady=null;setStatus(message,'error');}},
      sanitize:text=>window.DOMPurify.sanitize(text)
    };
  }
  async function open(item){
    const res=await window.mdAPI.read(item.path);if(!res.ok)throw Error(res.error);
    let content=res.data;const draft=readDraft(item.path);
    if(draft&&draft.content!==content){const choice=await window.mdAPI.recoverDraft(draft.base!==content);if(!choice.ok||choice.data==='cancel')return;if(choice.data==='restore')content=draft.content;else removeDraft(item.path);}
    const data=validate(JSON.parse(content));
    releasePDF();clearTimeout(autoSaveTimer);clearTimeout(previewTimer);
    state.currentFile={...item,kind:'mindmap'};state.savedContent=res.data;editorEl.value=content;state.saveError=false;docNameEl.textContent=item.name;
    applyViewMode();await mount(data);updateDirty();renderList();$('wordCount').textContent='思维导图';$('cursorPosition').textContent='';setStatus('已打开：'+item.name);await new Promise(requestAnimationFrame);await window.readingProgress?.restore();if(isDirty())scheduleSave();
  }
  async function create(local=false,data=null){
    if(!state.connected)return;
    if(!await(!local&&window.workspace?window.workspace.canReplaceActive():canDiscard()))return;
    let name=await promptName('新建思维导图（自动补全 .smm 后缀）：','未命名.smm');if(!name)return;if(!/\.smm$/i.test(name))name+='.smm';
    const path=joinPath(state.currentDir,name),result=await window.mdAPI.create(path,JSON.stringify(data||empty(name.replace(/\.smm$/i,''))));if(!result.ok)throw Error(result.error);
    await refreshDir();await openFile({path,name,type:'file'},true,local);setStatus('已新建：'+name,'ok');
  }
  $('newMindMap').addEventListener('click',()=>{ $('newDocumentMenu').open=false;runAction(()=>create());});
  $('newFile').addEventListener('click',()=>{$('newDocumentMenu').open=false;});
  previewEl.addEventListener('click',e=>{if(e.target.closest('#emptyCreateMindMap')){(window.workspace||window.paneHost)?.activate(window.isPaneChild?'secondary':'primary');runAction(()=>create(true));}});

  async function exportData(type){if(type==='smm')return new Blob([JSON.stringify(map.getData(true),null,2)],{type:'application/json'});return map.export(type,false);}
  window.mindMapPane={open,create,clear,validate,exportData,changed,attach,get instance(){return map;}};
})();
