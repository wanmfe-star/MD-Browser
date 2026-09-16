(() => {
  if(window.isPaneChild)return;
  const button=document.getElementById('toggleSidebar'),sidebar=document.getElementById('fileSidebar');
  const key='md-browser.sidebar-collapsed';
  let collapsed=false;
  try{collapsed=localStorage.getItem(key)==='true';}catch{}
  function apply(){
    document.body.classList.toggle('sidebar-collapsed',collapsed);
    sidebar.inert=collapsed;
    button.setAttribute('aria-expanded',String(!collapsed));
    button.title=collapsed?'展开侧栏':'收起侧栏';
    button.setAttribute('aria-label',button.title);
    requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
  }
  button.addEventListener('click',()=>{
    collapsed=!collapsed;
    try{localStorage.setItem(key,String(collapsed));}catch{}
    apply();
  });
  apply();
})();
