(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.mediaTypes=api;})(typeof globalThis==='object'?globalThis:this,()=>{
  const formats={
    mp3:['audio','audio/mpeg'],wav:['audio','audio/wav'],ogg:['audio','audio/ogg'],oga:['audio','audio/ogg'],opus:['audio','audio/ogg'],flac:['audio','audio/flac'],m4a:['audio','audio/mp4'],aac:['audio','audio/aac'],
    mp4:['video','video/mp4'],m4v:['video','video/mp4'],webm:['video','video/webm'],ogv:['video','video/ogg'],mov:['video','video/quicktime'],mkv:['video','video/x-matroska'],
    jpg:['image','image/jpeg'],jpeg:['image','image/jpeg'],png:['image','image/png'],gif:['image','image/gif'],webp:['image','image/webp'],bmp:['image','image/bmp'],avif:['image','image/avif']
  };
  const type=name=>{const match=/\.([a-z0-9]+)$/i.exec(name||''),entry=match&&formats[match[1].toLowerCase()];return entry?{kind:entry[0],mime:entry[1]}:null;};
  return {type,extensions:Object.keys(formats),isKind:kind=>['audio','video','image'].includes(kind)};
});
