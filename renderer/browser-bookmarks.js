(() => {
  const key='md-browser.bookmarks.v1';
  window.createBrowserBookmarks=({section,current,navigate})=>{
    const owner=window.isPaneChild?parent.document:document,host=window.isPaneChild?parent:window;
    const read=()=>{try{const list=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(list)?list.filter(b=>b&&typeof b.id==='string'&&typeof b.name==='string'&&typeof b.url==='string'):[];}catch{return [];}};
    const star=document.createElement('button');star.type='button';star.className='bookmark-add';star.textContent='☆';star.title='添加当前网页到书签';star.setAttribute('aria-label','添加书签');section.querySelector('.browser-address').after(star);
    const bar=document.createElement('div');bar.className='browser-bookmarks';section.querySelector('.browser-toolbar').after(bar);
    const dialog=owner.createElement('dialog');dialog.className='bookmark-dialog';
    dialog.innerHTML='<form><div class="dialog-heading"><h2>自定义书签</h2><button class="icon-btn bookmark-close" type="button" aria-label="关闭书签管理">×</button></div><label>书签名称<input class="bookmark-name" required maxlength="120" placeholder="输入书签名称"></label><label>网址<input class="bookmark-url" required maxlength="4096" placeholder="https://example.com"></label><p class="bookmark-error" role="status"></p><div class="dialog-actions"><button type="button" class="btn bookmark-new">新增书签</button><button type="submit" class="btn primary">保存书签</button></div></form><div class="bookmark-list"></div>';
    owner.body.append(dialog);
    const name=dialog.querySelector('.bookmark-name'),url=dialog.querySelector('.bookmark-url'),error=dialog.querySelector('.bookmark-error'),list=dialog.querySelector('.bookmark-list');let editing=null;
    function fill(bookmark){editing=bookmark?.id||null;name.value=bookmark?.name||'';url.value=bookmark?.url||'';error.textContent='';}
    function show(){const page=current(),existing=read().find(b=>b.url===page.url);fill(existing||{name:page.title||'',url:page.url||''});if(!dialog.open)dialog.showModal();render();name.focus();name.select();}
    function write(items){try{localStorage.setItem(key,JSON.stringify(items));host.dispatchEvent(new Event('md-bookmarks-changed'));return true;}catch{error.textContent='保存失败：本机存储空间不足，请重试。';return false;}}
    function render(){
      bar.replaceChildren();const manage=document.createElement('button');manage.type='button';manage.textContent='书签';manage.title='管理自定义书签';manage.onclick=show;bar.append(manage);
      const items=read();star.textContent=items.some(b=>b.url===current().url)?'★':'☆';
      for(const bookmark of items){const button=document.createElement('button');button.type='button';button.textContent=bookmark.name;button.title=bookmark.url;button.onclick=()=>navigate(bookmark.url);bar.append(button);}
      list.replaceChildren();if(!items.length){const empty=owner.createElement('p');empty.textContent='尚无书签。保存后将在地址栏下方显示，关闭软件后仍保留。';list.append(empty);}
      for(const bookmark of items){const row=owner.createElement('div');row.className='bookmark-row';const label=owner.createElement('span');label.textContent=bookmark.name;label.title=bookmark.url;row.append(label);
        for(const [text,action] of [['打开',()=>{dialog.close();navigate(bookmark.url);}],['编辑',()=>{fill(bookmark);name.focus();}],['删除',()=>{if(write(read().filter(b=>b.id!==bookmark.id))&&editing===bookmark.id)fill(null);}]] ) {const button=owner.createElement('button');button.type='button';button.className='btn';button.textContent=text;button.onclick=action;row.append(button);}list.append(row);
      }
    }
    dialog.querySelector('form').onsubmit=event=>{
      event.preventDefault();let target;try{const value=url.value.trim();target=new URL(/^[a-z][a-z\d+.-]*:/i.test(value)?value:'https://'+value);if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw Error();}catch{error.textContent='请输入有效的 HTTP 或 HTTPS 网址。';return;}
      const title=name.value.trim();if(!title){error.textContent='请输入书签名称。';return;}
      const items=read(),duplicate=items.find(b=>b.url===target.href&&b.id!==editing);
      if(editing&&duplicate){error.textContent='此网址已在书签中，请编辑已有书签。';return;}
      const bookmark={id:editing||duplicate?.id||crypto.randomUUID(),name:title,url:target.href};
      if(write([...items.filter(b=>b.id!==bookmark.id),bookmark])){fill(bookmark);dialog.close();}
    };
    star.onclick=show;dialog.querySelector('.bookmark-close').onclick=()=>dialog.close();dialog.querySelector('.bookmark-new').onclick=()=>{fill(null);name.focus();};
    host.addEventListener('md-bookmarks-changed',render);window.addEventListener('storage',event=>{if(event.key===key)render();});render();
    return {update:render};
  };
})();
