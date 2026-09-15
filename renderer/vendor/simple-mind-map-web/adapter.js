'use strict';
window.$bus.$on('app_inited',map=>{
  window.officialMindMap=map;
  map.updateConfig({...mdHost.config,isLimitMindMapInCanvas:false,isLimitMindMapInCanvasWhenHasScrollbar:false,mousewheelAction:'zoom',mousewheelZoomActionReverse:true,useLeftKeySelectionRightKeyDrag:true});

  let editing=null;
  const changed=()=>{if(map.demonstrate?.isInDemonstrate)return;const data=map.getData(true);if(editing?.node){const uid=editing.node.getData('uid');const visit=n=>{if(n.data.uid===uid){n.data.text=editing.text;n.data.richText=editing.richText;}for(const c of n.children||[])visit(c);};visit(data.root);}mdHost.changed(data);};
  map.on('node_text_edit_change',value=>{editing=value;changed();});map.on('hide_text_edit',()=>{editing=null;changed();});
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopImmediatePropagation();changed();mdHost.save();}},true);
  document.addEventListener('pointerdown',()=>mdHost.activate(),true);
  const canvas=document.getElementById('mindMapContainer');
  const hitNode=target=>{const hit=target.closest?.('.smm-node');let found=null;const visit=n=>{if(n.group?.node===hit)found=n;for(const c of n.children||[])visit(c);};if(hit)visit(map.renderer.root);return found;};
  canvas.addEventListener('dragenter',event=>{if(event.dataTransfer.types.includes('text/plain')&&!event.dataTransfer.types.includes('Files')){event.preventDefault();event.stopImmediatePropagation();}},true);
  canvas.addEventListener('dragover',event=>{if(event.dataTransfer.types.includes('text/plain')&&!event.dataTransfer.types.includes('Files')){event.preventDefault();event.stopImmediatePropagation();event.dataTransfer.dropEffect='copy';}},true);
  canvas.addEventListener('drop',event=>{if(event.dataTransfer.types.includes('Files'))return;const text=event.dataTransfer.getData('text/plain');if(!text)return;event.preventDefault();event.stopImmediatePropagation();const target=hitNode(event.target)||map.renderer.activeNodeList[0]||map.renderer.root;map.execCommand('INSERT_CHILD_NODE',false,[target],{text:mdHost.sanitize(text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\r?\n/g,'<br>'))});},true);
  canvas.addEventListener('contextmenu',event=>{event.preventDefault();const node=hitNode(event.target);if(!node)return;event.stopImmediatePropagation();if(!map.renderer.activeNodeList.includes(node)){map.execCommand('CLEAR_ACTIVE_NODE');node.active();}window.$bus.$emit('node_contextmenu',event,node);},true);
  // The upstream component is mounted on the following Vue tick.
  setTimeout(()=>{
    const root=document.getElementById('app').__vue__;
    const components=[];const visit=c=>{components.push(c);for(const child of c.$children||[])visit(child);};visit(root);
    window.officialComponents=components;
    const nav=components.find(c=>c.$options._componentTag==='NavigatorToolbar');
    if(nav){
      nav.lang='zh';nav.langList=[{name:'简体中文',value:'zh'}];nav.onLangChange=()=>{};
      const add=(id,label,action)=>{const button=document.createElement('button');button.id=id;button.type='button';button.className='md-nav-button';button.textContent=label;button.title=label;button.onclick=action;nav.$el.append(button);};
      add('mindFitCanvas','适应画布',()=>map.view.fit());
      add('mindShortcutKeys','快捷键',()=>nav.handleCommand('shortcutKey'));
    }
    window.$bus.$off('localStorageExceeded');
    window.$bus.$off('showDownloadTip');
    window.dismissMindPanels=target=>{
      const protectedArea=target?.closest?.('.sidebarContainer,.sidebarTriggerContainer,.el-dialog,.el-message-box,.el-select-dropdown,.el-color-dropdown,.el-popover,.el-picker-panel,.el-dropdown-menu,.navigatorContainer,.toolbarContainer');
      if(!protectedArea)window.$bus.$emit('closeSideBar');
      for(const c of components){
        if(c.$options.name==='ElDialog'&&c.visible&&(!target||!target.closest?.('.el-dialog,.el-select-dropdown,.el-color-dropdown,.el-popover,.el-picker-panel')))c.handleClose();
        if(c.$options._componentTag==='Contextmenu'&&(!target||!c.$el.contains(target)))c.hide();
      }
    };
    const toolbar=components.find(c=>typeof c.createNewLocalFile==='function'&&typeof c.saveLocalFile==='function');
    if(toolbar){toolbar.createNewLocalFile=()=>mdHost.create();toolbar.saveLocalFile=()=>{changed();mdHost.save();};toolbar.openLocalFile=()=>window.$bus.$emit('showImport');toolbar.openDirectory=()=>mdHost.browse();toolbar.$i18n.mergeLocaleMessage('zh',{toolbar:{saveAs:'保存'}});}
    window.$bus.$off('setData');window.$bus.$on('setData',data=>mdHost.create(data));
    map.resize();if(mdHost.data.view)map.view.setTransformData(mdHost.data.view);else map.view.fit();
    mdHost.ready(map);
  },0);
});
window.initApp();
