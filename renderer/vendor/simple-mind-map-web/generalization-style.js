'use strict';
window.installGeneralizationStyle=(map,components)=>{
 if(!map.renderer.root){const ready=()=>{map.off('node_tree_render_end',ready);window.installGeneralizationStyle(map,components);};map.on('node_tree_render_end',ready);return;}
 const shapeKey='mdGeneralizationShape',patternKey='mdGeneralizationPattern';
 const proto=Object.getPrototypeOf(map.renderer.root),original=proto.renderGeneralization;
 function decorate(node){
  const shape=map.getThemeConfig(shapeKey)||'curve',pattern=map.getThemeConfig(patternKey)||'solid';
  for(const item of node._generalizationList||[]){
   const line=item.generalizationLine;if(!line)continue;
   line.attr({'stroke-dasharray':pattern==='dashed'?'7 5':pattern==='dotted'?'2 4':'none','stroke-linecap':'round'});
   const data=line.array(),segments=Array.isArray(data)?data:data.value;if(shape==='curve'||!segments||segments.length!==2||segments[0][0]!=='M'||segments[1][0]!=='Q')continue;
   const [,x,y]=segments[0],[,cx,cy,ex,ey]=segments[1],nx=(cx-(x+ex)/2)*0.5,ny=(cy-(y+ey)/2)*0.5;
   const p=(t,n=0)=>`${x+(ex-x)*t+nx*n},${y+(ey-y)*t+ny*n}`;
   if(shape==='bracket')line.plot(`M ${p(0)} L ${p(0,1)} L ${p(1,1)} L ${p(1)}`);
   if(shape==='brace')line.plot(`M ${p(0)} C ${p(.12)} ${p(0,1)} ${p(.25,1)} C ${p(.42,1)} ${p(.5,1)} ${p(.5,1.5)} C ${p(.5,1)} ${p(.58,1)} ${p(.75,1)} C ${p(1,1)} ${p(.88)} ${p(1)}`);
  }
 }
 proto.renderGeneralization=function(...args){const result=original.apply(this,args);decorate(this);return result;};
 const base=components.find(c=>typeof c.updateMargin==='function');
 if(base){
  const controls=document.createElement('div');controls.className='md-generalization-controls';
  for(const [key,label,options] of [[patternKey,'线型',[['solid','实线'],['dashed','虚线'],['dotted','点线']]],[shapeKey,'形状',[['curve','曲线'],['bracket','方括号 ］'],['brace','花括号 ｝']]]]){
   const row=document.createElement('label');row.textContent=label;const select=document.createElement('select');select.id=key;select.setAttribute('aria-label','概要连线'+label);
   for(const [value,text] of options){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}
   const sync=()=>{select.value=map.getThemeConfig(key)||options[0][0];};sync();map.on('data_change',sync);map.on('theme_change',sync);
   select.onchange=()=>{base.update(key,select.value);mdHost.changed(map.getData(true));};row.append(select);controls.append(row);
  }
  const mount=()=>{if(controls.isConnected)return;const title=[...base.$el.querySelectorAll('.title')].find(e=>e.textContent.trim()==='概要的连线');if(title?.nextElementSibling)title.nextElementSibling.after(controls);};
  mount();new MutationObserver(mount).observe(base.$el,{childList:true,subtree:true});
 }
 map.render();
};
