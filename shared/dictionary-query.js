(function(root){
  'use strict';
  function normalize(text){
    if(typeof text!=='string' || text.length>256)return '';
    return text.normalize('NFKC').replace(/[\s\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu,'').replace(/，/g,',');
  }
  function canLookup(text){return /^\p{Script=Han}{1,32}(?:,\p{Script=Han}{1,32})?$/u.test(normalize(text)) && [...normalize(text)].length<=32;}
  const api={normalize,canLookup};
  if(typeof module==='object' && module.exports)module.exports=api;else root.dictionaryQuery=api;
})(globalThis);
