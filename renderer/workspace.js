(() => {
  if(window.isPaneChild)return;
  const el=id=>document.getElementById(id),host=el('workspacePanes'),primary=el('primaryPane');
  const clients={primary:window.paneClient},nodes={primary};
  let active='primary',order=['primary','secondary'],split=false,ratio=0.5,working=false,ready,closing=false;
  const divider=document.createElement('div');divider.className='workspace-divider';divider.tabIndex=0;divider.setAttribute('role','separator');divider.setAttribute('aria-label','调整左右栏宽度');divider.setAttribute('aria-orientation','vertical');divider.hidden=true;host.append(divider);
  function connection(){return {connected:state.connected,connectionKey:state.connectionKey,currentDir:state.currentDir,entries:state.entries};}
  function layout(){
    for(const id of Object.keys(nodes)){nodes[id].hidden=!split&&id!==active;nodes[id].style.order=order.indexOf(id)*2;nodes[id].classList.toggle('active-pane',split&&id===active);nodes[id].style.flex=split?'0 0 calc('+((order[0]===id?ratio:1-ratio)*100)+'% - 4px)':'1';}
    divider.hidden=!split;divider.style.order=1;divider.setAttribute('aria-valuenow',Math.round(ratio*100));divider.setAttribute('aria-valuemin','20');divider.setAttribute('aria-valuemax','80');
    el('splitMenu').hidden=split;el('swapPanes').hidden=!split;el('collapsePanes').hidden=!split;
    el('workspaceHint').textContent=split?(order[0]===active?'左栏':'右栏')+' · 当前操作栏':'单栏';
    host.classList.toggle('is-split',split);primary.classList.toggle('inactive-pane',split&&active!=='primary');clients.secondary?.layoutBrowser();
  }
  async function ensureSecondary(){
    if(ready)return ready;
    const frame=document.createElement('iframe');frame.className='secondary-pane';frame.title='独立文件栏';frame.allow='fullscreen *';frame.addEventListener('focus',()=>activate('secondary'));frame.hidden=true;nodes.secondary=frame;host.append(frame);
    ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('第二栏加载超时，请重试')),15000);frame.onload=()=>{try{const client=frame.contentWindow.paneClient;if(!client)return;clients.secondary=client;client.adopt(connection());clearTimeout(timer);resolve(client);}catch(error){clearTimeout(timer);reject(error);}};frame.src='./index.html?pane=secondary';});
    try{return await ready;}catch(error){frame.remove();delete nodes.secondary;delete clients.secondary;ready=null;throw error;}
  }
  function activate(id){if(id===active)return;if(!clients[id]||(!split&&id!==active))return;active=id;layout();renderList();}
  function anyBusy(){return Object.values(clients).some(c=>c.busy());}
  async function action(fn){if(working||anyBusy()){setStatus('操作进行中，请稍后再试');return;}working=true;try{await fn();}catch(e){setStatus(e.message||String(e),'error');}finally{working=false;layout();}}
  async function enable(side='left'){await ensureSecondary();split=true;const other=active==='primary'?'secondary':'primary';order=side==='right'?[other,active]:[active,other];layout();}
  async function open(item,side,insidePrimaryAction=false,approved=false){
    if(side&&!split)await enable(side==='left'?'right':'left');
    const target=side?order[side==='left'?0:1]:active;
    const duplicate=Object.values(clients).find(c=>c.file()?.path===item.path&&c.id!==target);
    if(duplicate){activate(duplicate.id);duplicate.focus();setStatus('此文件已在另一栏打开，已切换到该栏');return;}
    if(clients[target].busy()&&!(insidePrimaryAction&&target==='primary')){setStatus('该栏正在处理文件，请稍后再试');return;}
    activate(target);await clients[target].open(item,insidePrimaryAction&&target==='primary',approved);renderList();
  }
  async function collapse(){const other=active==='primary'?'secondary':'primary';if(clients[other]&&!await clients[other].canLeave())return;clients[other]?.reset();split=false;layout();clients[active].focus();}
  primary.addEventListener('pointerdown',()=>activate('primary'),true);primary.addEventListener('focusin',()=>activate('primary'));
  const splitMenu=el('splitMenu'),trigger=el('splitTrigger');let hoverTimer;
  function closeSplitMenu(){clearTimeout(hoverTimer);splitMenu.open=false;}
  splitMenu.addEventListener('pointerenter',event=>{if(event.pointerType==='touch')return;clearTimeout(hoverTimer);hoverTimer=setTimeout(()=>{if(!split)splitMenu.open=true;},160);});
  splitMenu.addEventListener('pointerleave',()=>{clearTimeout(hoverTimer);hoverTimer=setTimeout(closeSplitMenu,180);});
  splitMenu.addEventListener('toggle',()=>trigger.setAttribute('aria-expanded',String(splitMenu.open)));
  splitMenu.addEventListener('focusout',()=>{setTimeout(()=>{if(!splitMenu.contains(document.activeElement))closeSplitMenu();},0);});
  trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();clearTimeout(hoverTimer);splitMenu.open=true;el('splitKeepLeft').focus();}});
  splitMenu.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeSplitMenu();trigger.focus();}if(['ArrowLeft','ArrowRight'].includes(event.key)&&event.target.closest('.split-choices')){event.preventDefault();el(event.key==='ArrowLeft'?'splitKeepLeft':'splitKeepRight').focus();}});
  document.addEventListener('pointerdown',event=>{if(!splitMenu.contains(event.target))closeSplitMenu();});
  el('splitKeepLeft').onclick=()=>{closeSplitMenu();action(()=>enable('left'));};el('splitKeepRight').onclick=()=>{el('splitMenu').open=false;action(()=>enable('right'));};
  el('openBrowser').onclick=()=>clients[active].openBrowser();
  el('swapPanes').onclick=()=>{order.reverse();layout();};el('collapsePanes').onclick=()=>action(collapse);
  divider.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();divider.setPointerCapture(event.pointerId);host.classList.add('resizing');});
  divider.addEventListener('pointermove',event=>{if(!divider.hasPointerCapture(event.pointerId))return;const rect=host.getBoundingClientRect();ratio=Math.max(0.2,Math.min(0.8,(event.clientX-rect.left)/rect.width));layout();});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])divider.addEventListener(type,()=>host.classList.remove('resizing'));
  divider.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home'].includes(event.key)){event.preventDefault();ratio=event.key==='Home'?0.5:Math.max(0.2,Math.min(0.8,ratio+(event.key==='ArrowRight'?0.02:-0.02)));layout();}});
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&active==='secondary'){event.preventDefault();event.stopImmediatePropagation();clients.secondary.save();}},true);
  window.workspace={activate,open,enable:side=>action(()=>enable(side)),collapse:()=>action(collapse),swap(){order.reverse();layout();},activeFile:()=>clients[active]?.file(),
    async canReplaceActive(){return active==='primary'?canDiscard():clients.secondary.canLeave();},
    showStatus(message){el('workspaceNotice').textContent=active==='secondary'?message:'';},
    beginMutation(from,caller){const affected=Object.values(clients).filter(c=>c.id!==caller&&c.file()&&containsPath(from,c.file().path));if(affected.some(c=>c.busy()))return null;const resume=affected.map(c=>c.pause());return ()=>resume.forEach(fn=>fn());},
    async waitForMutation(from,caller){
      const deadline=Date.now()+15000;
      while(!this.mutationAllowed(caller)){
        if(Date.now()>=deadline)return null;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      return this.beginMutation(from,caller);
    },
    sync(){clients.secondary?.adopt(connection());},
    async canChangeConnection(){if(clients.secondary&&!await clients.secondary.canLeave())return false;return true;},
    connectionChanged(){clients.secondary?.reset();this.sync();},
    anyDirtyPath(from){return Object.values(clients).some(c=>c.file()&&containsPath(from,c.file().path)&&c.dirty());},
    mutationAllowed(caller){return !Object.values(clients).some(c=>c.id!==caller&&c.busy());},
    async moved(from,to,caller){for(const c of Object.values(clients))if(c.id!==caller)await c.moved(from,to);},
    deleted(from,caller){for(const c of Object.values(clients))if(c.id!==caller)c.deleted(from);},
    refreshSidebar:()=>refreshDir(),
    requestClose(event){
      if(closing)return;
      if(anyBusy()){event.preventDefault();event.returnValue=false;setStatus('操作进行中，请完成后再关闭窗口');return;}
      if(!Object.values(clients).some(c=>c.dirty()))return;
      event.preventDefault();event.returnValue=false;if(working)return;
      action(async()=>{for(const c of Object.values(clients)){c.draft();if(!await c.canLeave())return;}closing=true;window.close();});
    },
    inspect:()=>({active,order:order.slice(),split,ratio}),
  };
  layout();
})();
