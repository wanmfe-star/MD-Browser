'use strict';
const {randomUUID}=require('node:crypto');
const {Readable}=require('node:stream');
const types=require('../shared/media-types');
function createMediaService(webdav) {
  const tickets=new Map();
  function release(url) {
    let id;try{id=new URL(url).pathname.slice(1);}catch{return;}
    const ticket=tickets.get(id);if(!ticket)return;
    for(const controller of ticket.controllers)controller.abort();tickets.delete(id);
  }
  function clear(){for(const id of tickets.keys())release('mdmedia://file/'+id);}
  function open(path){
    const type=types.type(path);if(!type||typeof path!=='string'||!path.startsWith('/'))throw Error('不支持此媒体文件');
    const reader=webdav.mediaReader(path),id=randomUUID();
    if(tickets.size>=8)release('mdmedia://file/'+tickets.keys().next().value);
    tickets.set(id,{reader,type,controllers:new Set()});return {url:'mdmedia://file/'+id,...type};
  }
  async function handle(request){
    const url=new URL(request.url),ticket=url.hostname==='file'&&tickets.get(url.pathname.slice(1));
    if(!ticket)return new Response('媒体连接已失效',{status:404});
    if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
    const range=request.headers.get('range');
    if(range&&!/^bytes=(?:\d+-\d*|-\d+)$/.test(range))return new Response(null,{status:416});
    const controller=new AbortController();ticket.controllers.add(controller);
    const abort=()=>controller.abort();request.signal?.addEventListener('abort',abort,{once:true});
    const cleanup=()=>{ticket.controllers.delete(controller);request.signal?.removeEventListener('abort',abort);};
    try{
      if(request.signal?.aborted)controller.abort();
      const response=await ticket.reader({method:request.method,range,signal:controller.signal});
      const headers=new Headers({'Content-Type':ticket.type.mime,'Cache-Control':'no-store','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'});
      for(const name of ['content-length','content-range','accept-ranges']){const value=response.headers.get(name);if(value)headers.set(name,value);}
      if(request.method==='HEAD'||!response.body){cleanup();return new Response(null,{status:response.status,headers});}
      const upstream=response.body.getReader?response.body:Readable.toWeb(response.body);
      const reader=upstream.getReader();
      const stream=new ReadableStream({
        async pull(out){try{const chunk=await reader.read();if(chunk.done){cleanup();out.close();}else out.enqueue(chunk.value);}catch(error){cleanup();out.error(error);}},
        async cancel(){controller.abort();cleanup();try{await reader.cancel();}catch{}}
      });
      return new Response(stream,{status:response.status,headers});
    }catch(error){cleanup();return new Response(error.name==='AbortError'?'已停止读取':'媒体读取失败',{status:error.status>=400&&error.status<=599?error.status:502});}
  }
  return {open,release,clear,handle};
}
module.exports={createMediaService};
