(() => {
  const id=window.isPaneChild?'secondary':'primary';
  previewEl.addEventListener('click',event=>{
    if(!event.target.closest('#emptyCreateMarkdown')||state.currentFile)return;
    (window.workspace||window.paneHost)?.activate(id);
    runAction(()=>createFile(true));
  });
  window.paneClient={
    id, state,
    file:()=>state.currentFile,
    busy:()=>state.busy||state.saving,
    dirty:()=>isDirty()||!!window.pdfAnnotations?.dirty(),
    draft:persistDraft,
    async canLeave(){if(state.busy||state.saving){setStatus('操作进行中，请稍后再试');return false;}let allowed=false;await runAction(async()=>{allowed=await canDiscard();});return allowed;},
    open:(item,nested=false,approved=false)=>nested?openFile(item,approved,true):runAction(()=>openFile(item,approved,true)),
    focus:()=>{if(state.currentFile?.kind===undefined&&state.currentFile)editorEl.focus();else $('primaryPane').focus();},
    reset(){clearTimeout(autoSaveTimer);clearTimeout(previewTimer);state.currentFile=null;state.savedContent='';editorEl.value='';updateEditorUI(false);docNameEl.textContent='选择文件打开';previewEl.innerHTML='<div class="placeholder">从左侧文件列表选择文件打开<div class="empty-pane-actions"><button id="emptyCreateMarkdown" class="primary" type="button">＋ 新建 Markdown 文件</button></div></div>';state.viewMode='preview';applyViewMode();syncControls();},
    adopt(data){state.connected=data.connected;state.connectionKey=data.connectionKey;state.currentDir=data.currentDir;state.entries=data.entries;setConnUI(state.connected);renderCrumb();renderList();syncControls();},
    async moved(from,to){if(state.currentFile&&containsPath(from,state.currentFile.path)){state.currentFile.path=to+state.currentFile.path.slice(from.length);state.currentFile.name=state.currentFile.path.split('/').pop();docNameEl.textContent=state.currentFile.name;if(window.mediaTypes?.isKind(state.currentFile.kind))await window.mediaViewer.relocated(from,to);persistDraft();}if(containsPath(from,state.currentDir))state.currentDir=to+normalizedPath(state.currentDir).slice(from.length);renderList();},
    deleted(from){if(state.currentFile&&containsPath(from,state.currentFile.path))this.reset();},
    pause(){clearTimeout(autoSaveTimer);state.busy=true;syncControls();return ()=>{state.busy=false;syncControls();if(isDirty()&&!state.saveError)scheduleSave();};},
    save:()=>runAction(save),
  };
  if(window.isPaneChild){window.paneClient.reset();document.addEventListener('pointerdown',()=>parent.workspace.activate(id),true);document.addEventListener('focusin',()=>parent.workspace.activate(id));window.addEventListener('focus',()=>parent.workspace.activate(id));}
})();
