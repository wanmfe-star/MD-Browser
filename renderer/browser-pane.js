(() => {
  const pane=document.getElementById('primaryPane'),section=document.createElement('section');
  section.className='browser-pane';section.hidden=true;
  section.innerHTML='<form class="browser-toolbar"><button type="button" data-action="back" title="后退" aria-label="后退">←</button><button type="button" data-action="forward" title="前进" aria-label="前进">→</button><button type="button" data-action="reload" title="刷新" aria-label="刷新">↻</button><input class="browser-address" aria-label="网页地址" placeholder="输入网址，例如 https://example.com" autocomplete="off"><button type="submit">访问</button><button type="button" data-action="password" title="保存、填充或管理网站密码" aria-label="网站密码">密码</button><button type="button" data-action="external" title="用系统浏览器打开" aria-label="用系统浏览器打开">↗</button><button type="button" data-action="close" title="关闭网页（保留网站登录状态）" aria-label="关闭网页">×</button></form><div class="browser-message" role="status">输入网址开始浏览；切换文件后可点击地球图标返回。</div><div class="browser-stage"></div>';
  pane.append(section);
  const address=section.querySelector('input'),message=section.querySelector('.browser-message'),stage=section.querySelector('.browser-stage');
  let guest=null,ready=false,url='',showing=false,opening=false;
  const overlay=window.isPaneChild?parent.document.createElement('div'):null;
  if(overlay){overlay.className='browser-guest-overlay';overlay.hidden=true;parent.document.body.append(overlay);}
  function layout(){if(!overlay)return;overlay.hidden=!showing;if(!showing)return;const frame=window.frameElement.getBoundingClientRect(),rect=stage.getBoundingClientRect();Object.assign(overlay.style,{left:(frame.left+rect.left)+'px',top:(frame.top+rect.top)+'px',width:rect.width+'px',height:rect.height+'px'});}
  new ResizeObserver(layout).observe(stage);window.addEventListener('resize',layout);
  function activate(){(window.workspace||window.paneHost)?.activate(window.paneClient.id);}
  function hide(){showing=false;section.hidden=true;pane.classList.remove('show-browser');layout();if(guest&&ready)guest.setAudioMuted(true);}
  async function show(){
    if(opening||state.busy)return;opening=true;
    try {if(!showing){if(!await window.paneClient.canLeave())return;window.paneClient.reset();}
      activate();showing=true;section.hidden=false;pane.classList.add('show-browser');layout();
      if(guest&&ready)guest.setAudioMuted(false);else address.focus();
    }finally{opening=false;}
  }
  const bookmarks=window.createBrowserBookmarks({section,current:()=>({url:ready&&guest?guest.getURL():address.value,title:ready&&guest?guest.getTitle():''}),navigate});
  function update(){if(!guest||!ready)return;url=guest.getURL();bookmarks.update();if(document.activeElement!==address)address.value=url;section.querySelector('[data-action=back]').disabled=!guest.canGoBack();section.querySelector('[data-action=forward]').disabled=!guest.canGoForward();}
  function navigate(input){
    let target;try{const value=input.trim();target=new URL(/^[a-z][a-z\d+.-]*:/i.test(value)?value:'https://'+value);if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw Error();}catch{message.textContent='请输入有效的 HTTP 或 HTTPS 网页地址。';return;}
    url=target.href;address.value=url;message.textContent='正在加载…';
    if(!guest){
      ready=false;guest=(window.isPaneChild?parent.document:document).createElement('webview');guest.setAttribute('partition','persist:md-browser-web');guest.setAttribute('webpreferences','contextIsolation=yes,sandbox=yes,nodeIntegration=no');
      guest.addEventListener('dom-ready',()=>{ready=true;guest.setAudioMuted(!showing);update();});
      guest.addEventListener('focus',activate);
      guest.addEventListener('did-start-loading',()=>message.textContent='正在加载…');
      guest.addEventListener('did-stop-loading',()=>{update();if(message.textContent==='正在加载…')message.textContent='';});
      guest.addEventListener('did-navigate',update);guest.addEventListener('did-navigate-in-page',update);
      guest.addEventListener('did-fail-load',event=>{if(event.errorCode!==-3&&event.isMainFrame)message.textContent='网页加载失败：'+event.errorDescription+'，可修改网址或重试。';});
      guest.src=url;(overlay||stage).append(guest);layout();
    }else if(ready)guest.loadURL(url).catch(error=>message.textContent='加载失败：'+error.message);else guest.src=url;
  }
  section.querySelector('form').onsubmit=event=>{event.preventDefault();navigate(address.value);};
  section.addEventListener('pointerdown',activate);
  section.addEventListener('click',event=>{
    const action=event.target.closest('[data-action]')?.dataset.action;if(!action)return;
    if(action==='close'){guest?.remove();guest=null;ready=false;url='';address.value='';message.textContent='输入网址开始浏览；切换文件后可点击地球图标返回。';hide();window.paneClient.reset();return;}
    if(action==='password'){window.mdAPI.browserPassword('menu',guest&&ready?guest.getWebContentsId():null).then(result=>{if(!result.ok)message.textContent=result.error;else if(result.data)message.textContent=result.data;}).catch(()=>message.textContent='密码操作失败，请重试');return;}
    if(!guest||!ready)return;
    if(action==='back'&&guest.canGoBack())guest.goBack();
    if(action==='forward'&&guest.canGoForward())guest.goForward();
    if(action==='reload')guest.reload();
    if(action==='external')window.mdAPI.openExternal(guest.getURL());
  });
  window.browserPane={show,hide,layout,view:()=>guest,inspect:()=>({showing,url,retained:!!guest})};
})();
