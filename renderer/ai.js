(() => {
  const root=window.isPaneChild?parent:window;
  const sourceId=()=>JSON.stringify([state.connectionKey,state.currentFile?.path]);
  window.aiDocument={
    identity:()=>state.currentFile?sourceId():null,
    currentText:()=>state.currentFile?.kind==='docx'?window.wordEditor.extractText():state.currentFile&&!state.currentFile.kind?documentText().split(/\n\s*\n/).map((p,i)=>'[段落 '+(i+1)+']\n'+p).join('\n\n'):null,
    async snapshot(mode='full',selection=''){
      const file=state.currentFile;if(!file)throw Error('请先打开文档');const id=sourceId();let text=selection,warning='';
      if(mode==='full'){
        if(file.kind==='docx'){text=window.wordEditor.extractText();warning='仅提取文字和表格文字，不分析嵌入图片';}
        else if(file.kind==='pdf'){const result=await window.pdfAnnotations.extractText();text=result.text;warning=result.warning||'仅分析 PDF 文字层，不包含图片内容';}
        else if(!file.kind&&/\.(md|markdown|mdown|mkd|txt|text)$/i.test(file.name)){text=documentText().split(/\n\s*\n/).map((p,i)=>'[段落 '+(i+1)+']\n'+p).join('\n\n');}
        else throw Error('全文分析支持 Markdown、TXT、Word 和文字型 PDF');
      }
      if(!text?.trim())throw Error('没有可分析的文字');if(text.length>500000)throw Error('全文超过 50 万字，请选择部分内容');
      if(state.currentFile!==file)throw Error('文档已切换，请重新选择引用');return {id,name:file.name,path:file.path,mode,text,warning};
    }
  };
  window.aiSelection=text=>{if(!text?.trim())return;window.aiDocument.snapshot('selection',text).then(s=>root.aiAssist.fromSelection(s)).catch(e=>setStatus(e.message,'error'));};
  $('aiAnalyzeDocument').onclick=()=>{ $('moreMenu').open=false;root.aiAssist.attachWindow(window);};
  if(window.isPaneChild)return;
  const call=async(action,payload)=>{const result=await mdAPI.ai(action,payload);if(!result.ok)throw Error(result.error);return result.data;};
  const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  const win=make('section','ai-window');win.id='aiWindow';win.hidden=true;win.setAttribute('role','dialog');win.setAttribute('aria-label','AI 助手');
  win.innerHTML=`<header class="ai-header"><strong>✦ AI 助手</strong><small>DeepSeek</small><button data-ai="history">历史</button><button data-ai="new">＋ 新对话</button><button data-ai="settings" title="AI 设置">⚙</button><button data-ai="hide" title="收起，保留会话">－</button></header><div class="ai-body"><aside class="ai-history" hidden><div class="ai-history-tools"><span>历史会话</span><button data-ai="clear" class="ai-icon-button" title="清空历史" aria-label="清空历史"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></button></div><div id="aiHistoryList"></div></aside><main class="ai-main"><div class="ai-messages" aria-live="polite"></div><div class="ai-references"></div><form class="ai-compose"><div class="ai-actions"><div class="ai-reference-picker"><button type="button" class="ai-icon-button" id="aiReferenceToggle" aria-label="添加全文引用" title="添加全文引用" aria-expanded="false" aria-controls="aiReferenceMenu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button><div class="ai-reference-menu" id="aiReferenceMenu" hidden><button type="button" data-ai="attach">引用当前文档全文</button><button type="button" data-ai="other">引用另一栏全文</button></div></div><label class="ai-web-toggle" title="DeepSeek 联网"><input type="checkbox" id="aiWebSearch" aria-label="DeepSeek 联网"><span class="ai-icon-button"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg></span></label><button type="button" data-preset="请解释这段内容。">解释</button><button type="button" data-preset="请总结要点，并标明依据。">总结</button><button type="button" data-preset="请润色这段内容，保留原意。">润色</button></div><textarea aria-label="向 AI 提问" placeholder="输入需求，或继续追问… Enter 发送，Shift+Enter 换行"></textarea><div class="ai-send-row"><small>历史保存在本机</small><button type="button" data-ai="stop" hidden>停止生成</button><button type="submit" class="primary" id="aiSend">发送 ↑</button></div></form><div class="ai-progress" role="status"></div></main></div>`;
  document.body.append(win);
  const messages=win.querySelector('.ai-messages'),refs=win.querySelector('.ai-references'),input=win.querySelector('textarea'),progress=win.querySelector('.ai-progress'),historyList=$('aiHistoryList');
  const webToggle=$('aiWebSearch');webToggle.checked=localStorage.getItem('ai-web-search')==='true';webToggle.onchange=()=>localStorage.setItem('ai-web-search',String(webToggle.checked));
  const referenceToggle=$('aiReferenceToggle'),referenceMenu=$('aiReferenceMenu'),referencePicker=referenceToggle.parentElement;
  function closeReferenceMenu(){referenceMenu.hidden=true;referenceToggle.setAttribute('aria-expanded','false');}
  referenceToggle.onclick=()=>{const open=referenceMenu.hidden;referenceMenu.hidden=!open;referenceToggle.setAttribute('aria-expanded',String(open));};
  document.addEventListener('pointerdown',e=>{if(!referencePicker.contains(e.target))closeReferenceMenu();});
  document.addEventListener('focusin',e=>{if(!referencePicker.contains(e.target))closeReferenceMenu();});
  win.addEventListener('keydown',e=>{if(e.key==='Escape'&&!referenceMenu.hidden){e.preventDefault();e.stopPropagation();closeReferenceMenu();referenceToggle.focus();}});
  let current=null,attachments=[],lastAttachments=new Map(),previousSelection=null;const running=new Set(),pending=new Set();let renderTimer=null,sequence=0;
  const activeWindow=()=>{const id=window.workspace?.inspect().active;return id==='secondary'?document.querySelector('.secondary-pane')?.contentWindow:window;};
  const windows=()=>[window,document.querySelector('.secondary-pane')?.contentWindow].filter(Boolean);
  function status(text,error=false){progress.textContent=text;progress.classList.toggle('error',error);}
  function visible(){win.hidden=false;return win;}
  function sync(){const busy=!!current&&(running.has(current.id)||pending.has(current.id));$('aiSend').disabled=busy;win.querySelector('[data-ai=stop]').hidden=!busy;input.disabled=busy;webToggle.disabled=busy;referenceToggle.disabled=busy;if(busy)closeReferenceMenu();for(const action of ['attach','other'])win.querySelector('[data-ai='+action+']').disabled=busy;}
  const historyMenu=make('div','ai-history-menu');historyMenu.hidden=true;historyMenu.setAttribute('role','menu');historyMenu.setAttribute('aria-label','会话操作');
  historyMenu.innerHTML='<button type="button" role="menuitem" data-history-action="rename">重命名会话</button><button type="button" role="menuitem" data-history-action="delete">删除会话</button>';win.append(historyMenu);
  let menuConversation=null,menuTrigger=null;
  function closeHistoryMenu(){historyMenu.hidden=true;menuConversation=null;}
  function openHistoryMenu(event,conversation,trigger){
    event.preventDefault();closeReferenceMenu();menuConversation=conversation;menuTrigger=trigger;historyMenu.hidden=false;
    const bounds=win.getBoundingClientRect(),row=trigger.getBoundingClientRect();
    const x=event.clientX||row.left,y=event.clientY||row.bottom;
    historyMenu.style.left=Math.max(bounds.left+8,Math.min(x,bounds.right-historyMenu.offsetWidth-8))+'px';
    historyMenu.style.top=Math.max(bounds.top+8,Math.min(y,bounds.bottom-historyMenu.offsetHeight-8))+'px';
    historyMenu.querySelector('button').focus();
  }
  historyMenu.onclick=event=>{
    const action=event.target.closest('[data-history-action]')?.dataset.historyAction,conversation=menuConversation;
    if(!action||!conversation)return;closeHistoryMenu();
    safe(async()=>{
      if(action==='rename'){
        const title=await promptName('会话名称',conversation.title);
        if(title){const renamed=await call('rename',{id:conversation.id,title});if(current?.id===conversation.id)current.title=renamed.title;await history();}
      }else if(confirm('删除会话“'+conversation.title+'”及其历史记录？')){
        await call('delete',{id:conversation.id});lastAttachments.delete(conversation.id);
        if(previousSelection?.id===conversation.id){previousSelection=null;renderRefs();}
        if(current?.id===conversation.id){current=null;await newChat();}else await history();
      }
    });
  };
  historyMenu.onkeydown=event=>{
    const buttons=Array.from(historyMenu.querySelectorAll('button')),index=buttons.indexOf(document.activeElement);
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeHistoryMenu();menuTrigger?.focus();}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();buttons[(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length].focus();}
  };
  document.addEventListener('pointerdown',event=>{if(!historyMenu.contains(event.target))closeHistoryMenu();});
  document.addEventListener('focusin',event=>{if(!historyMenu.contains(event.target))closeHistoryMenu();});
  document.addEventListener('scroll',closeHistoryMenu,true);window.addEventListener('resize',closeHistoryMenu);
  async function history(){const list=await call('list');historyList.replaceChildren();for(const c of list){const b=make('button',c.id===current?.id?'active':'',c.title);b.title=c.title;b.oncontextmenu=e=>openHistoryMenu(e,c,b);const small=make('small','',new Date(c.updatedAt).toLocaleString('zh-CN'));b.append(small);b.onclick=()=>safe(()=>load(c.id));historyList.append(b);}}
  function saveAttachments(){if(current)lastAttachments.set(current.id,attachments);}
  function renderRefs(){refs.replaceChildren();for(const [index,s]of attachments.entries()){const row=make('div','ai-reference'),label=make('span','',`📄 ${s.name} · ${s.mode==='full'?'全文':'选文'} · ${s.text.length.toLocaleString()} 字`);label.title=s.warning||s.name;row.append(label);if(s.mode==='full'){const refresh=make('button','','更新引用');refresh.type='button';refresh.onclick=()=>safe(async()=>{const owner=windows().find(w=>w.aiDocument.identity()===s.id);if(!owner)throw Error('请先在任一栏打开该文件');attachments[index]=await owner.aiDocument.snapshot();saveAttachments();renderRefs();status('已更新引用，下一次发送时使用新版本');});row.append(refresh);}const remove=make('button','','×');remove.type='button';remove.title='移除引用';remove.onclick=()=>{attachments.splice(index,1);saveAttachments();renderRefs();};row.append(remove);refs.append(row);if(s.warning)refs.append(make('small','',s.warning));}
   if(previousSelection){const b=make('button','','将这段选文加入上一会话');b.onclick=()=>safe(async()=>{const {id,source}=previousSelection;previousSelection=null;await load(id);addReference(source);});refs.append(b);}
  }
  function render(scroll=true){messages.replaceChildren();if(!current?.messages.length)messages.append(make('div','ai-empty','可以直接提问，也可以引用选文或全文。\n开启联网搜索后，会检索相关网页并列出来源。'));
   for(const m of current?.messages||[]){const item=make('article','ai-message '+m.role);if(m.role==='user'){item.append(make('div','',m.content));if(m.sources?.length){const detail=make('details'),summary=make('summary','',m.sources.map(s=>s.name+' · '+(s.mode==='full'?'全文':'选文')).join('、'));detail.append(summary,make('div','',m.sources.map(s=>s.text.slice(0,600)+(s.text.length>600?'…':'')).join('\n\n')));item.append(detail);}}else{const body=make('div');body.innerHTML=DOMPurify.sanitize(marked.parse(m.content||'正在准备…'),{ALLOWED_TAGS:['p','br','strong','em','ul','ol','li','blockquote','code','pre','h1','h2','h3','h4','table','thead','tbody','tr','th','td','a'],ALLOWED_ATTR:['href']});item.append(body);if(m.status!=='streaming'){const b=make('button','','复制');b.onclick=()=>mdAPI.copyText(m.content);item.append(b);}if(m.status!=='streaming'&&m===current.messages.at(-1)){const retry=make('button','','重新生成');retry.disabled=running.has(current.id)||pending.has(current.id);retry.onclick=()=>{const question=current.messages.filter(x=>x.role==='user').at(-1);if(question){input.value=question.content;attachments=structuredClone(question.sources||[]);webToggle.checked=!!question.webSearch;saveAttachments();renderRefs();safe(send);}};item.append(retry);}if(m.error)item.append(make('small','',m.error));if(m.searchWarning)item.append(make('small','',m.searchWarning));if(m.webSearch)item.append(renderWebSources(m.webSearch));if(m.analysisMode)item.append(make('small','',m.analysisMode));}messages.append(item);}
   renderRefs();sync();if(scroll)messages.scrollTop=messages.scrollHeight;
  }
  function renderWebSources(search){
   const detail=make('details','ai-web-sources'),summary=make('summary','',`${search.provider==='deepseek'?'DeepSeek 联网':'联网来源'} · ${search.results.length} 条`);detail.append(summary);
   detail.append(make('small','',`检索：${search.query} · ${new Date(search.searchedAt).toLocaleString('zh-CN')}`));
   if(!search.results.length)detail.append(make('small','',search.performed===false?'尚未返回实际检索记录':'未找到有效搜索结果'));
   for(const source of search.results){
    if(!/^https?:\/\//i.test(source.url))continue;
    const link=make('a','',source.title);link.href=source.url;link.title=source.url;detail.append(link);
    if(source.publishedDate)detail.append(make('small','','发布时间：'+source.publishedDate));
   }return detail;
  }
  async function load(id){saveAttachments();const token=++sequence;const c=await call('get',{id});if(token!==sequence)return;current=c;previousSelection=null;attachments=lastAttachments.get(id)||[];attachments=structuredClone(attachments);if(c.messages.at(-1)?.status==='streaming')running.add(id);render();await history();status('已载入会话 · 已发送的引用保留在历史消息中');visible();}
  async function newChat(){saveAttachments();sequence++;current=await call('create');input.value='';attachments=[];previousSelection=null;render();await history();status('新会话 · 仅在点击发送时提交问题与引用内容');visible();input.focus();}
  function addReference(source){if(running.has(current?.id))throw Error('请等待回答完成或停止生成后再添加引用');const i=attachments.findIndex(s=>s.id===source.id);if(i>=0)attachments[i]=source;else{if(attachments.length>=2)throw Error('最多引用两份文档，请先移除一个');attachments.push(source);}saveAttachments();renderRefs();status(source.warning||'已添加引用，点击发送后才会提交给 DeepSeek');}
  async function attachWindow(owner){visible();status('正在提取文档文字…');try{const source=await owner.aiDocument.snapshot();if(!current)await newChat();addReference(source);}catch(e){status(e.message,true);}}
  async function safe(fn){try{await fn();}catch(e){status(e.message,true);}}
  async function send(){const text=input.value.trim();if(!text)return;if(!current)await newChat();const id=current.id;if(running.has(id)||pending.has(id))return;pending.add(id);sync();status('正在提交…');try{const c=await call('send',{id,text,sources:attachments,webSearch:webToggle.checked});running.add(id);lastAttachments.set(id,[]);if(current?.id===id){current=c;input.value='';attachments=[];previousSelection=null;render();}await history();}catch(e){status(e.message,true);}finally{pending.delete(id);sync();}}
  win.querySelector('form').onsubmit=e=>{e.preventDefault();safe(send);};input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();safe(send);}};
  messages.addEventListener('click',e=>{const link=e.target.closest('a');if(link){e.preventDefault();if(/^https?:\/\//i.test(link.href))mdAPI.openExternal(link.href);}});
  win.addEventListener('click',e=>{const preset=e.target.closest('[data-preset]');if(preset){input.value=preset.dataset.preset;input.focus();return;}const action=e.target.closest('[data-ai]')?.dataset.ai;if(!action)return;closeReferenceMenu();closeHistoryMenu();safe(async()=>{switch(action){case 'hide':win.hidden=true;break;case 'history':win.querySelector('.ai-history').hidden=!win.querySelector('.ai-history').hidden;await history();break;case 'new':await newChat();break;case 'settings':await showSettings();break;case 'attach':await attachWindow(activeWindow());break;case 'other':{const other=windows().find(w=>w!==activeWindow());if(!other)throw Error('请先开启双栏');await attachWindow(other);break;}case 'stop':await call('cancel',{id:current.id});status('正在停止…');break;case 'clear':if(confirm('清空所有 AI 会话和引用记录？')){await call('clear');lastAttachments.clear();current=null;await newChat();}break;}});});
  mdAPI.onAI(event=>{if(event.type==='done'){running.delete(event.id);pending.delete(event.id);if(current?.id===event.id){current=event.conversation;clearTimeout(renderTimer);renderTimer=null;render();status(current.messages.at(-1)?.error||'回答完成 · 历史已保存',current.messages.at(-1)?.status==='error');}void history().catch(()=>{});sync();return;}if(current?.id!==event.id)return;if(event.type==='progress')status(event.text);if(event.type==='search'){const m=current.messages.find(m=>m.id===event.messageId);if(m){m.webSearch=event.webSearch;render();}}if(event.type==='delta'){const m=current.messages.find(m=>m.id===event.messageId);if(m){m.content+=event.text;if(!renderTimer)renderTimer=setTimeout(()=>{renderTimer=null;render();},65);}}});
  const entry=make('button','ai-entry','✦ AI 助手');entry.id='openAI';entry.onclick=()=>safe(async()=>{visible();if(!current)await newChat();else{await load(current.id);input.focus();}});document.querySelector('.sidebar-footer').before(entry);
  const topEntry=make('button','workspace-icon ai-top-entry','✦');topEntry.title='AI 助手';topEntry.setAttribute('aria-label','AI 助手');topEntry.onclick=entry.onclick;$('toggleSidebar').after(topEntry);
  let drag=null;const header=win.querySelector('header');header.onpointerdown=e=>{if(e.target.closest('button'))return;const r=win.getBoundingClientRect();drag={x:e.clientX-r.left,y:e.clientY-r.top};header.setPointerCapture(e.pointerId);};header.onpointermove=e=>{if(!drag)return;win.style.left=Math.max(0,Math.min(innerWidth-win.offsetWidth,e.clientX-drag.x))+'px';win.style.top=Math.max(0,Math.min(innerHeight-80,e.clientY-drag.y))+'px';win.style.right='auto';};header.onpointerup=header.onpointercancel=()=>drag=null;
  window.addEventListener('resize',()=>{if(win.hidden)return;win.style.maxWidth=(innerWidth-20)+'px';win.style.maxHeight=(innerHeight-30)+'px';const r=win.getBoundingClientRect();win.style.left=Math.max(0,Math.min(r.left,innerWidth-win.offsetWidth))+'px';win.style.top=Math.max(0,Math.min(r.top,innerHeight-win.offsetHeight))+'px';});
  const settings=make('dialog','ai-settings');settings.id='aiSettings';settings.innerHTML='<h2>AI 设置</h2><small>密钥加密保存在本机。联网搜索复用 DeepSeek API Key，通过 DeepSeek 原生服务检索。测试连接会调用对应接口。</small>'+['deepseek','volcengine'].map(p=>`<fieldset data-provider="${p}"><legend>${p==='deepseek'?'DeepSeek · 文本助手':'火山引擎 · 图片接口预留'}</legend><label>接口地址<input name="baseURL" type="url"></label><label>模型名称 / 接入点 ID<input name="model" placeholder="${p==='deepseek'?'deepseek-flash':'填写已开通的 Seedream 模型或接入点 ID'}"></label><label>API Key<input name="key" type="password" autocomplete="off" placeholder="留空保留已保存的密钥"></label><label><input name="clearKey" type="checkbox"> 清除已保存密钥</label><button type="button" data-test="${p}">保存并测试连接</button></fieldset>`).join('')+'<p class="ai-settings-status" role="status"></p><nav><button id="aiSettingsCancel">关闭</button><button id="aiSettingsSave" class="primary">保存设置</button></nav>';document.body.append(settings);
  settings.addEventListener('close',()=>{for(const field of settings.querySelectorAll('[name=key]'))field.value='';});
  async function showSettings(){const config=await call('settings');for(const field of settings.querySelectorAll('fieldset')){const v=config[field.dataset.provider];field.querySelector('[name=baseURL]').value=v.baseURL;field.querySelector('[name=model]').value=v.model;field.querySelector('[name=key]').value='';field.querySelector('[name=key]').placeholder=v.hasKey?'已保存密钥；留空保持不变':'输入 API Key';field.querySelector('[name=clearKey]').checked=false;}settings.querySelector('.ai-settings-status').textContent='';if(!settings.open)settings.showModal();}
  async function saveSettings(){const data={};for(const field of settings.querySelectorAll('fieldset')){data[field.dataset.provider]=Object.fromEntries(['baseURL','model','key'].map(k=>[k,field.querySelector('[name='+k+']').value]));data[field.dataset.provider].clearKey=field.querySelector('[name=clearKey]').checked;}await call('configure',data);for(const field of settings.querySelectorAll('fieldset')){field.querySelector('[name=key]').value='';field.querySelector('[name=clearKey]').checked=false;}}
  settings.onclick=async e=>{const test=e.target.dataset.test;if(e.target.id==='aiSettingsCancel'){settings.close();return;}if(e.target.id!=='aiSettingsSave'&&!test)return;const label=settings.querySelector('.ai-settings-status');e.target.disabled=true;try{await saveSettings();label.textContent=test?'正在测试连接…':'设置已保存';if(test)label.textContent=await call('test',{provider:test});}catch(error){label.textContent=error.message;}finally{e.target.disabled=false;}};
  const settingsMenu=make('div','ai-settings-menu');settingsMenu.hidden=true;for(const [label,fn]of [['远程存储设置',()=>showConnection()],['AI 设置',()=>safe(showSettings)]]){const button=make('button','',label);button.onclick=()=>{settingsMenu.hidden=true;fn();};settingsMenu.append(button);}document.body.append(settingsMenu);
  $('connectionSettings').addEventListener('click',e=>{e.stopImmediatePropagation();settingsMenu.hidden=!settingsMenu.hidden;},true);
  setInterval(()=>{if(win.hidden||!current)return;for(const [i,s]of attachments.entries()){const row=refs.querySelectorAll('.ai-reference')[i];if(!row)continue;const owner=windows().find(w=>w.aiDocument.identity()===s.id),text=owner?.aiDocument.currentText();if(s.mode==='full'&&text!=null&&text!==s.text){row.querySelector('span').textContent='📄 '+s.name+' · 文档已更新（当前引用仍为旧版本）';}for(const b of row.querySelectorAll('button'))b.disabled=running.has(current.id)||pending.has(current.id);}},1200);
  window.aiAssist={attachWindow,showSettings,async fromSelection(source){const previous=current?.messages.length?current.id:null;await newChat();addReference(source);if(previous){previousSelection={id:previous,source};renderRefs();}input.focus();},dismiss(target){if(!target||!historyMenu.contains(target))closeHistoryMenu();if(!target||!referencePicker.contains(target))closeReferenceMenu();if(!target||(!win.contains(target)&&!settings.contains(target)&&!target.closest?.('#openAI,.ai-top-entry,.selection-actions,#pdfSelectionToolbar,dialog'))){win.hidden=true;}if(!target||(!settingsMenu.contains(target)&&!target.closest?.('#connectionSettings')))settingsMenu.hidden=true;},inspect:()=>({id:current?.id,attachments:attachments.map(s=>({name:s.name,mode:s.mode,text:s.text})),running:running.has(current?.id)})};
})();
