(() => {
  const card=document.createElement('section');card.className='dictionary-card';card.hidden=true;card.setAttribute('role','dialog');card.setAttribute('aria-label','汉语字典');
  card.innerHTML='<header><div><strong class="dictionary-character"></strong><div class="dictionary-pinyin"></div></div><button type="button" class="dictionary-close" aria-label="关闭字典">×</button></header><div class="dictionary-meta"></div><div class="dictionary-definitions" role="status"></div><footer>离线字典 · chinese-dictionary</footer>';
  document.body.append(card);
  let request=0;
  const {normalize,canLookup}=window.dictionaryQuery;
  function close(){request++;card.hidden=true;}
  function place(rect){
    const w=card.offsetWidth,h=card.offsetHeight;
    card.style.left=Math.max(8,Math.min(innerWidth-w-8,rect.left))+'px';
    card.style.top=Math.max(8,Math.min(innerHeight-h-8,rect.bottom+10+h<innerHeight?rect.bottom+10:rect.top-h-10))+'px';
  }
  async function show(text,anchor){
    if(!canLookup(text))return;
    const char=normalize(text),token=++request;
    card.classList.toggle('dictionary-phrase',[...char].length>1);
    const rect=anchor || {left:innerWidth/2-160,top:80,bottom:90};
    card.querySelector('.dictionary-character').textContent=char;
    card.querySelector('.dictionary-pinyin').textContent='';card.querySelector('.dictionary-meta').textContent='';
    const body=card.querySelector('.dictionary-definitions');body.textContent='正在查询…';card.hidden=false;place(rect);
    try {
      const result=await window.mdAPI.lookupCharacter(char);if(token!==request)return;
      if(!result.ok)throw new Error(result.error);
      const entry=result.data;
      if(!entry.found){body.textContent='字库暂未收录这个字词。';place(rect);return;}
      card.querySelector('.dictionary-pinyin').textContent=entry.pinyin.join(' · ') || '暂无拼音';
      card.querySelector('.dictionary-meta').textContent=[entry.kind==='idiom'?'成语':entry.kind==='word'?'词语':'汉字',entry.radicals&&`部首 ${entry.radicals}`,entry.strokes&&`${entry.strokes} 画`,entry.traditional&&`繁体 ${entry.traditional}`].filter(Boolean).join('　');
      body.replaceChildren();
      for(const definition of entry.definitions){const p=document.createElement('p');p.textContent=definition;body.append(p);}
      if(!entry.definitions.length)body.textContent='暂无释义。';
      for(const [key,label] of [['source','出处'],['example','例句'],['usage','用法'],['similar','近义词'],['opposite','反义词']]){
        if(!entry[key])continue;const p=document.createElement('p'),heading=document.createElement('strong');heading.textContent=label+'\n';p.append(heading,document.createTextNode(entry[key]));body.append(p);
      }
      place(rect);
    }catch(error){if(token===request){body.textContent='字典查询失败：'+error.message;place(rect);}}
  }
  card.querySelector('.dictionary-close').onclick=close;
  document.addEventListener('pointerdown',event=>{if(!card.contains(event.target))close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
  document.addEventListener('scroll',event=>{if(!card.contains(event.target))close();},true);
  window.addEventListener('resize',close);
  const title=document.getElementById('docName');if(title)new MutationObserver(close).observe(title,{childList:true,characterData:true,subtree:true});
  window.dictionaryLookup={canLookup,show,close,isOpen:()=>!card.hidden};
})();
