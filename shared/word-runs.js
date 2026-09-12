(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.wordRuns=api;})(typeof window==='object'?window:globalThis,()=>{
 const copy=r=>({...r,origin:r.origin?{...r.origin}:undefined,overrides:{...r.overrides}});
 const slice=(runs,start,end)=>{let at=0;const out=[];for(const run of runs||[]){const next=at+run.text.length,text=run.text.slice(Math.max(0,start-at),Math.max(0,Math.min(run.text.length,end-at)));if(next>start&&at<end&&text)out.push({...copy(run),text});at=next;}return out;};
 const at=(runs,pos)=>{let n=0;for(const run of runs||[]){n+=run.text.length;if(n>=pos)return copy(run);}return copy(runs?.at(-1)||{text:''});};
 const insert=(runs,start,end,text)=>[...slice(runs,0,start),...(text?[{...at(runs,start),text}]:[]),...slice(runs,end,Infinity)];
 function update(block,text){const old=block.text;let a=0,z=0;while(a<old.length&&a<text.length&&old[a]===text[a])a++;while(z<old.length-a&&z<text.length-a&&old[old.length-z-1]===text[text.length-z-1])z++;block.runs=insert(block.runs,a,old.length-z,text.slice(a,text.length-z));block.text=text;}
 function format(block,start,end,values){block.runs=[...slice(block.runs,0,start),...slice(block.runs,start,end).map(r=>({...r,...values,overrides:{...r.overrides,...values}})),...slice(block.runs,end,Infinity)];}
 return {copy,slice,at,insert,update,format};
});
