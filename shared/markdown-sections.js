(function(root){
  'use strict';
  function split(text,lexer){
    // marked recognizes only top-level headings, excluding code, quotes and HTML blocks.
    const normalized=text.replace(/\r\n?/g,'\n'),offsets=[];let source=0;
    for(let i=0;i<normalized.length;i++){offsets[i]=source;source+=text[source]==='\r'&&text[source+1]==='\n'?2:1;}offsets[normalized.length]=text.length;
    const headings=[];let offset=0;
    for(const token of lexer(normalized)){
      if(token.type==='heading'&&token.depth===1&&/^ {0,3}#(?:[ \t]|$)/.test(token.raw))headings.push({start:offsets[offset],title:token.text||'未命名'});
      offset+=token.raw.length;
    }
    const result=[];
    if(headings.length&&headings[0].start>0)result.push({start:0,end:headings[0].start,title:'前言'});
    headings.forEach((h,i)=>result.push({...h,end:headings[i+1]?.start??text.length}));
    return result;
  }
  if(typeof module==='object'&&module.exports)module.exports={split};else root.markdownSections={split};
})(typeof window==='object'?window:globalThis);
