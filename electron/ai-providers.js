'use strict';
function createProviders(fetcher=globalThis.fetch){
 async function request(config,suffix,body,signal){
  if(!config?.key)throw Error('请先在 AI 设置中填写 API Key');
  const response=await fetcher(config.baseURL.replace(/\/+$/,'')+suffix,{method:body?'POST':'GET',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(180000)]):AbortSignal.timeout(180000),headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok){let message='';try{const data=await response.json();message=String(data.error?.message||data.message||'').slice(0,350).split(config.key).join('[已隐藏]');}catch{}throw Error('AI 接口返回 '+response.status+(message?'：'+message:''));}return response;
 }
 async function chat(config,messages,{signal,onDelta,maxTokens=2048}={}){
  if(!config.model)throw Error('请先设置 DeepSeek 模型名称');
  const res=await request(config,'/chat/completions',{model:config.model,messages,stream:!!onDelta,max_tokens:maxTokens,...(config.model.startsWith('deepseek')?{thinking:{type:'disabled'}}:{})},signal);
  if(!onDelta){const data=await res.json();const text=data.choices?.[0]?.message?.content;if(typeof text!=='string'||!text.trim())throw Error('AI 未返回文字，请检查模型配置');return text;}
  let buffer='',answer='',done=false,finished=false;const decoder=new TextDecoder();
  function event(block){for(const line of block.split('\n')){if(!line.startsWith('data:'))continue;const raw=line.slice(5).trim();if(raw==='[DONE]'){done=true;continue;}if(!raw)continue;const item=JSON.parse(raw);if(item.error)throw Error('AI 流式回答失败');const choice=item.choices?.[0];if(choice?.finish_reason){finished=true;if(choice.finish_reason==='length')onDelta('\n\n〔回答达到输出长度限制，可继续追问〕');}const text=choice?.delta?.content;if(text){answer+=text;if(answer.length>200000)throw Error('回答过长，已停止');onDelta(text);}}}
  for await(const part of res.body){buffer+=decoder.decode(part,{stream:true}).replace(/\r/g,'');let at;while((at=buffer.indexOf('\n\n'))>=0){event(buffer.slice(0,at));buffer=buffer.slice(at+2);}if(buffer.length>2000000)throw Error('接口返回的数据格式不正确');}
  buffer+=decoder.decode();if(buffer.trim())event(buffer);if(!done&&!finished)throw Error('连接中断，回答尚未完成');if(!answer.trim())throw Error('AI 未返回文字，请重试');return answer;
 }
 return {chat,webChat:(config,messages,options)=>require('./ai-deepseek-search').deepseekSearch(fetcher,config,messages,options),
  async test(config,provider){const signal=AbortSignal.timeout(20000);if(provider==='deepseek'){await chat(config,[{role:'user',content:'请只回复 OK'}],{signal,maxTokens:32});return '文本接口连接成功';}await request(config,'/models',null,signal);return '鉴权连接成功；未生成图片，模型可用性将在实际生成时验证';},
  async image(config,{prompt,size='2K',referenceImages=[]},signal=AbortSignal.timeout(180000)){
   if(!config.model)throw Error('请配置火山引擎图片模型或推理接入点 ID');if(typeof prompt!=='string'||!prompt.trim()||prompt.length>20000)throw Error('图片提示词无效');if(!/^\d{3,5}x\d{3,5}$|^[124]K$/.test(size))throw Error('图片尺寸无效');if(!Array.isArray(referenceImages)||referenceImages.length>10||referenceImages.some(x=>typeof x!=='string'||!(x.startsWith('https://')||/^data:image\/(png|jpeg|webp);base64,/.test(x))))throw Error('参考图片格式无效');
   const response=await request(config,'/images/generations',{model:config.model,prompt,size,response_format:'url',stream:false,watermark:true,...(referenceImages.length?{image:referenceImages}:{})},signal);const data=await response.json();if(!data.data?.length)throw Error('图片接口未返回图片');return {images:data.data.map(x=>({url:x.url,b64_json:x.b64_json,size:x.size})),usage:data.usage};
  }
 };
}
module.exports={createProviders};
