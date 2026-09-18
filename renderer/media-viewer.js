(() => {
  const el=id=>document.getElementById(id),audio=el('mediaAudio'),video=el('mediaVideo'),picture=el('mediaImage');
  let item=null,ticket=null,playlist=[],zoom=1,rotation=0,loop=false,shuffle=false;
  const durations=new Map();
  try{loop=localStorage.getItem('md-browser.audioLoop')==='true';}catch{}
  function loopUI(){audio.loop=loop;el('audioLoop').title='单曲循环：'+(loop?'开':'关');el('audioLoop').setAttribute('aria-pressed',String(loop));el('audioLoop').classList.toggle('active',loop);}
  const icons={play:'<path d="m9 5 11 7-11 7Z"/>',pause:'<path d="M8 5v14M16 5v14"/>',previous:'<path d="M5 5v14M19 5 8 12l11 7Z"/>',next:'<path d="M19 5v14M5 5l11 7-11 7Z"/>',repeat:'<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3"/>',volume:'<path d="M11 5 6 9H3v6h3l5 4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',mute:'<path d="M11 5 6 9H3v6h3l5 4ZM16 9l6 6m0-6-6 6"/>',shuffle:'<path d="m17 3 4 4-4 4M3 17h3L17 7h4M3 7h3l4 4m4 4 3 2h4m-4-4 4 4-4 4"/>'};
  const icon=name=>'<svg viewBox="0 0 24 24" aria-hidden="true">'+icons[name]+'</svg>';
  for(const [id,name]of [['audioPrevious','previous'],['audioNext','next'],['audioToggle','play'],['audioLoop','repeat'],['audioMute','volume']])el(id).innerHTML=icon(name);
  el('audioPlayAll').innerHTML=icon('play')+'播放';el('audioShuffle').innerHTML=icon('shuffle')+'随机播放';
  const cleanName=name=>name.replace(/\.[^.]+$/,'');
  const clock=value=>{if(!Number.isFinite(value)||value<0)return '0:00';const seconds=Math.floor(value);return (seconds>=3600?Math.floor(seconds/3600)+':':'')+String(Math.floor(seconds/60)%60).padStart(seconds>=3600?2:1,'0')+':'+String(seconds%60).padStart(2,'0');};
  const durationKey=path=>JSON.stringify([state.connectionKey,path]);
  function playbackUI(){
    const playing=!audio.paused&&!audio.ended;
    el('audioToggle').innerHTML=icon(playing?'pause':'play');el('audioToggle').title=playing?'暂停':'播放';el('audioToggle').setAttribute('aria-label',el('audioToggle').title);
    el('audioNowState').textContent=playing?'正在播放':audio.ended?'播放结束':'已暂停';
    el('audioElapsed').textContent=clock(audio.currentTime);el('audioDuration').textContent=clock(audio.duration);
    const valid=Number.isFinite(audio.duration)&&audio.duration>0;
    el('audioSeek').disabled=!valid;el('audioSeek').value=valid?audio.currentTime/audio.duration*1000:0;
    el('audioSeek').setAttribute('aria-valuetext',clock(audio.currentTime)+' / '+clock(audio.duration));
    el('audioVolume').value=audio.muted?0:audio.volume;el('audioMute').innerHTML=icon(audio.muted||audio.volume===0?'mute':'volume');el('audioMute').title=audio.muted?'取消静音':'静音';el('audioMute').setAttribute('aria-label',el('audioMute').title);
  }
  function play(){if(item?.kind==='audio')audio.play().catch(()=>{el('mediaMessage').textContent='无法播放，请重新加载后重试';});}
  el('audioToggle').onclick=()=>audio.paused?play():audio.pause();
  el('audioPlayAll').onclick=()=>{shuffle=false;el('audioShuffle').setAttribute('aria-pressed','false');play();};
  el('audioShuffle').onclick=()=>{shuffle=!shuffle;el('audioShuffle').setAttribute('aria-pressed',String(shuffle));if(shuffle){loop=false;loopUI();try{localStorage.setItem('md-browser.audioLoop','false');}catch{}}if(shuffle&&playlist.length>1)adjacent(1);else play();};
  el('audioPrevious').onclick=()=>adjacent(-1);el('audioNext').onclick=()=>adjacent(1);
  el('audioSeek').oninput=()=>{if(Number.isFinite(audio.duration)&&audio.duration>0){audio.currentTime=Number(el('audioSeek').value)/1000*audio.duration;playbackUI();}};
  el('audioVolume').oninput=()=>{audio.muted=false;audio.volume=Number(el('audioVolume').value);};el('audioMute').onclick=()=>{audio.muted=!audio.muted;};
  for(const event of ['play','pause','ended','timeupdate','durationchange','volumechange','emptied'])audio.addEventListener(event,playbackUI);
  audio.addEventListener('loadedmetadata',()=>{if(item?.kind==='audio'&&Number.isFinite(audio.duration)){durations.set(durationKey(item.path),audio.duration);queueUI();}playbackUI();});
  loopUI();
  el('audioLoop').onclick=()=>{loop=!loop;loopUI();try{localStorage.setItem('md-browser.audioLoop',String(loop));}catch{}};
  function clear(){
    if(document.fullscreenElement===el('videoStage'))document.exitFullscreen().catch(()=>{});
    item=null;playlist=[];el('imageToolbar').hidden=true;
    for(const player of [audio,video]){player.pause();player.removeAttribute('src');player.load();}
    picture.removeAttribute('src');
    if(ticket){window.mdAPI.releaseMedia(ticket.url).catch(()=>{});ticket=null;}
    el('audioPlaylist').replaceChildren();
  }
  function queueUI(){
    const index=playlist.findIndex(entry=>entry.path===item?.path);
    el('mediaPosition').textContent=playlist.length?(index+1)+' / '+playlist.length:'';
    el('mediaPrevious').disabled=playlist.length<2;el('mediaNext').disabled=playlist.length<2;
    el('audioPlaylist').replaceChildren();
    el('audioPrevious').disabled=playlist.length<2;el('audioNext').disabled=playlist.length<2;
    el('audioAlbumCount').textContent=playlist.length+' 首音频';
    const known=playlist.map(e=>durations.get(durationKey(e.path)));el('audioQueueSummary').textContent=playlist.length+' 首音频'+(known.length&&known.every(Number.isFinite)?' · '+clock(known.reduce((a,b)=>a+b,0)):'');
    if(item?.kind==='audio')for(const entry of playlist){
      const button=document.createElement('button');button.className='audio-track'+(entry.path===item.path?' active':'');button.title=entry.name;button.setAttribute('aria-current',String(entry.path===item.path));
      const title=document.createElement('span');title.className='audio-track-name';const art=document.createElement('span');art.className='audio-track-art';art.textContent=entry.path===item.path?'♫':String(playlist.indexOf(entry)+1).padStart(2,'0');const name=document.createElement('span');name.textContent=cleanName(entry.name);title.append(art,name);
      const format=document.createElement('span');format.className='audio-track-format';format.textContent=entry.name.split('.').pop().toUpperCase();const duration=document.createElement('span');duration.className='audio-track-duration';const known=durations.get(durationKey(entry.path));duration.textContent=known===undefined?'—':clock(known);button.append(title,format,duration);
      button.onclick=()=>runAction(()=>openMedia(entry,playlist.slice()));el('audioPlaylist').appendChild(button);
    }
  }
  function adjacent(direction,wrap=true){
    if(!item||!playlist.length||state.busy)return;
    const current=playlist.findIndex(entry=>entry.path===item.path);let next=current+direction;
    if(item.kind==='audio'&&shuffle&&playlist.length>1){next=(current+1+Math.floor(Math.random()*(playlist.length-1)))%playlist.length;wrap=true;}
    if(!wrap&&(next<0||next>=playlist.length)){setStatus('播放列表已结束');return;}
    next=(next+playlist.length)%playlist.length;
    runAction(()=>openMedia(playlist[next],playlist.slice()));
  }
  el('mediaPrevious').onclick=()=>adjacent(-1);el('mediaNext').onclick=()=>adjacent(1);
  audio.addEventListener('ended',()=>{if(item?.kind==='audio'&&!audio.loop)adjacent(1,false);});
  for(const player of [audio,video]) {
    player.addEventListener('error',()=>{if(!item||player!== (item.kind==='audio'?audio:item.kind==='video'?video:null))return;setStatus('无法播放：请检查网络及文件权限；当前格式或音视频编码也可能不受支持','error');el('mediaMessage').textContent='播放失败，请重试或使用其他编码的文件。';});
    player.addEventListener('loadedmetadata',()=>{if(item&&((item.kind==='audio'&&player===audio)||(item.kind==='video'&&player===video)))el('mediaMessage').textContent='';});
    player.addEventListener('waiting',()=>{if(item&&player.currentSrc)el('mediaMessage').textContent='正在缓冲…';});
    player.addEventListener('playing',()=>{if(item)el('mediaMessage').textContent='';});
  }
  async function fullscreen(){
    if(item?.kind!=='video')return;
    try{if(document.fullscreenElement)await document.exitFullscreen();else await el('videoStage').requestFullscreen();}
    catch{setStatus('无法进入全屏，请再次点击全屏按钮','error');}
  }
  el('videoFullscreen').onclick=fullscreen;video.addEventListener('dblclick',fullscreen);
  document.addEventListener('fullscreenchange',()=>{el('videoFullscreen').textContent=document.fullscreenElement?'退出全屏':'全屏';});
  function imageLayout(){
    if(!picture.naturalWidth||item?.kind!=='image')return;
    const rotated=rotation%180!==0,width=rotated?picture.naturalHeight:picture.naturalWidth,height=rotated?picture.naturalWidth:picture.naturalHeight;
    const area=el('imageScroll'),padding=getComputedStyle(area);
    const fit=Math.min(Math.max(1,area.clientWidth-parseFloat(padding.paddingLeft)-parseFloat(padding.paddingRight))/width,Math.max(1,area.clientHeight-parseFloat(padding.paddingTop)-parseFloat(padding.paddingBottom))/height,1),scale=fit*zoom;
    el('imageCanvas').style.width=width*scale+'px';el('imageCanvas').style.height=height*scale+'px';
    picture.style.width=picture.naturalWidth*scale+'px';picture.style.height=picture.naturalHeight*scale+'px';
    picture.style.transform='translate(-50%, -50%) rotate('+rotation+'deg)';el('imageScale').textContent=Number((scale*100).toFixed(1))+'%';
  }
  function imageZoom(value){zoom=window.viewZoom.clamp(value,0.05,8);imageLayout();}
  el('imageZoomIn').onclick=()=>imageZoom(zoom+0.05);el('imageZoomOut').onclick=()=>imageZoom(zoom-0.05);
  el('imageFit').onclick=()=>{zoom=1;imageLayout();};el('imageRotate').onclick=()=>{rotation=(rotation+90)%360;imageLayout();};
  el('imageScroll').addEventListener('wheel',event=>{if(item?.kind==='image'&&event.ctrlKey){event.preventDefault();event.stopPropagation();imageZoom(zoom+window.viewZoom.delta(event,el('imageScroll')));}},{passive:false});
  picture.onload=()=>{imageLayout();el('mediaMessage').textContent='';};picture.onerror=()=>{if(item?.kind==='image'){el('mediaMessage').textContent='图片加载失败，请检查网络、权限或图片格式。';setStatus('图片加载失败','error');}};
  window.addEventListener('resize',imageLayout);
  new ResizeObserver(imageLayout).observe(el('imageScroll'));
  function load(next,descriptor,queue){
    clear();item={...next,kind:descriptor.kind};ticket=descriptor;playlist=queue.slice();zoom=1;rotation=0;
    el('imageToolbar').hidden=item.kind!=='image';
    el('audioPanel').hidden=item.kind!=='audio';el('videoStage').hidden=item.kind!=='video';el('imagePanel').hidden=item.kind!=='image';
    el('mediaLabel').textContent={audio:'音乐播放',video:'视频播放',image:'图片查看'}[item.kind];
    el('mediaPrevious').textContent={audio:'上一首',video:'上个视频',image:'上一张'}[item.kind];el('mediaNext').textContent={audio:'下一首',video:'下个视频',image:'下一张'}[item.kind];
    for(const id of ['mediaPrevious','mediaNext']){const button=el(id);button.title=button.textContent;button.setAttribute('aria-label',button.textContent);if(item.kind==='image')button.textContent=id==='mediaPrevious'?'‹':'›';}
    el('audioTitle').textContent=cleanName(item.name);el('audioTitle').title=item.name;el('audioAlbumTitle').textContent=item.path.split('/').slice(0,-1).filter(Boolean).pop()||'我的音乐';el('mediaMessage').textContent='正在加载…';queueUI();
    if(item.kind==='image'){picture.alt=item.name;picture.src=ticket.url;}
    else {const player=item.kind==='audio'?audio:video;player.src=ticket.url;player.load();loopUI();player.play().catch(error=>{if(error.name==='NotAllowedError')el('mediaMessage').textContent='点击播放按钮开始播放';});}
  }
  async function relocated(from,to){
    if(!item)return;
    const remap=p=>p===from||p.startsWith(from+'/')?to+p.slice(from.length):p;
    playlist=playlist.map(entry=>({...entry,path:remap(entry.path),name:remap(entry.path).split('/').pop()}));
    const next={...item,path:remap(item.path)};next.name=next.path.split('/').pop();
    const result=await window.mdAPI.openMedia(next.path);if(!result.ok){clear();setStatus('媒体重新加载失败：'+result.error,'error');return;}
    const player=item.kind==='audio'?audio:item.kind==='video'?video:null,time=player?.currentTime||0,paused=player?.paused;
    if(player)player.addEventListener('loadedmetadata',()=>{player.currentTime=time;if(paused)player.pause();},{once:true});
    load(next,result.data,playlist.slice());
  }
  el('mediaRetry').onclick=()=>{if(item&&!state.busy)runAction(()=>openMedia(item,playlist.slice()));};
  window.mediaViewer={load,clear,relocated,position:()=>({zoom,rotation}),restorePosition(value){zoom=window.viewZoom.clamp(value.zoom||1,0.05,8);rotation=Number(value.rotation)||0;imageLayout();}};
})();
