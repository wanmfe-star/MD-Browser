'use strict';
// DeepSeek's Anthropic-compatible endpoint executes web_search on the server.
async function deepseekSearch(fetcher,config,messages,{signal,onDelta,onSearch,maxTokens=4096}={}){
 const base=new URL(config.baseURL);base.pathname=base.pathname.replace(/\/$/,'').replace(/\/(v1|anthropic)$/,'')+'/anthropic/v1/messages';
 const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n'),turns=messages.filter(m=>m.role!=='system').map(m=>({...m}));
 const search={provider:'deepseek',query:'',searchedAt:Date.now(),results:[],performed:false},seen=new Set();let answer='';
 function source(item){let url;try{url=new URL(item.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return;}catch{return;}if(seen.has(url.href))return;seen.add(url.href);search.results.push({title:String(item.title||url.hostname).slice(0,300),url:url.href,publishedDate:String(item.page_age||'').slice(0,100)});}
 function inspect(block){
  if(block.type==='server_tool_use'&&block.name==='web_search'&&block.input?.query){const q=String(block.input.query).slice(0,400);if(!search.query.includes(q))search.query+=(search.query?'；':'')+q;}
  if(block.type==='web_search_tool_result'){
   if(!Array.isArray(block.content))throw Error('DeepSeek 联网搜索失败：'+String(block.content?.error_code||'未知错误'));
   search.performed=true;for(const item of block.content)source(item);
  }
  for(const c of block.citations||[])if(c.type==='web_search_result_location')source(c);
  onSearch?.(structuredClone(search));
 }
 function append(text){if(!text)return;answer+=text;if(answer.length>200000)throw Error('回答过长，已停止');onDelta?.(text);}
 for(let round=0;round<4;round++){
  signal?.throwIfAborted();
  const res=await fetcher(base.href,{method:'POST',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(180000)]):AbortSignal.timeout(180000),headers:{Authorization:'Bearer '+config.key,'x-api-key':config.key,'anthropic-version':'2023-06-01','Content-Type':'application/json'},body:JSON.stringify({model:config.model,system,messages:turns,max_tokens:maxTokens,stream:true,thinking:{type:'disabled'},tools:[{type:'web_search_20250305',name:'web_search',max_uses:5}]})});
  if(!res.ok)throw Error('DeepSeek 联网接口返回 '+res.status+'，请检查模型、接口地址和账号权限');
  let blocks=[],stop=null,ended=false;
  if((res.headers.get('content-type')||'').includes('application/json')){
   const data=await res.json();if(data.type==='error')throw Error('DeepSeek 联网接口错误');blocks=data.content||[];stop=data.stop_reason;ended=true;for(const b of blocks){if(b.type==='text')append(b.text);inspect(b);}
  }else{
   let buffer='';const decoder=new TextDecoder(),partial=new Map();
   function event(raw){for(const line of raw.split('\n')){if(!line.startsWith('data:'))continue;const data=line.slice(5).trim();if(!data)continue;const item=JSON.parse(data);
    if(item.type==='error')throw Error('DeepSeek 联网生成失败');
    if(item.type==='content_block_start'){blocks[item.index]=structuredClone(item.content_block);if(item.content_block.type==='text')append(item.content_block.text);}
    if(item.type==='content_block_delta'){
     const b=blocks[item.index];if(!b)continue;const d=item.delta;
     if(d.type==='text_delta'){b.text=(b.text||'')+d.text;append(d.text);}
     if(d.type==='input_json_delta')partial.set(item.index,(partial.get(item.index)||'')+d.partial_json);
     if(d.type==='citations_delta'){b.citations??=[];b.citations.push(d.citation);}
    }
    if(item.type==='content_block_stop'){const b=blocks[item.index];if(partial.has(item.index))b.input=JSON.parse(partial.get(item.index));if(b)inspect(b);}
    if(item.type==='message_delta')stop=item.delta?.stop_reason;
    if(item.type==='message_stop')ended=true;
   }}
   for await(const chunk of res.body){buffer+=decoder.decode(chunk,{stream:true}).replace(/\r/g,'');let at;while((at=buffer.indexOf('\n\n'))>=0){event(buffer.slice(0,at));buffer=buffer.slice(at+2);}if(buffer.length>2000000)throw Error('DeepSeek 联网响应格式异常');}
   buffer+=decoder.decode();if(buffer.trim())event(buffer);
  }
  if(!ended)throw Error('联网回答连接中断，请重试');
  if(stop==='pause_turn'){turns.push({role:'assistant',content:blocks});continue;}
  if(stop==='tool_use')throw Error('DeepSeek 未执行服务端联网工具，请检查接口兼容性');
  if(stop==='max_tokens')append('\n\n〔回答达到输出长度限制，可继续追问〕');
  if(!answer.trim())throw Error('DeepSeek 未返回回答');
  return {text:answer,search};
 }
 throw Error('联网检索轮次达到上限，请缩小问题范围后重试');
}
module.exports={deepseekSearch};
