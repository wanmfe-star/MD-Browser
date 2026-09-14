(() => {
  const el=id=>document.getElementById(id),audio=el('mediaAudio'),video=el('mediaVideo'),picture=el('mediaImage');
  let item=null,ticket=null,playlist=[],zoom=1,rotation=0,loop=false;
  try{loop=localStorage.getItem('md-browser.audioLoop')==='true';}catch{}
  function loopUI(){audio.loop=loop;el('audioLoop').textContent='单曲循环：'+(loop?'开':'关');el('audioLoop').setAttribute('aria-pressed',String(loop));el('audioLoop').classList.toggle('active',loop);}
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
    if(item?.kind==='audio')for(const entry of playlist){
      const button=document.createElement('button');button.textContent=entry.name;button.className='audio-track'+(entry.path===item.path?' active':'');
      button.onclick=()=>runAction(()=>openMedia(entry,playlist.slice()));el('audioPlaylist').appendChild(button);
    }
  }
  function adjacent(direction,wrap=true){
    if(!item||!playlist.length||state.busy)return;
    const current=playlist.findIndex(entry=>entry.path===item.path);let next=current+direction;
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
    el('audioTitle').textContent=item.name;el('mediaMessage').textContent='正在加载…';queueUI();
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
