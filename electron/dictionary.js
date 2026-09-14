'use strict';
const fs=require('node:fs'),path=require('node:path');
const query=require('../shared/dictionary-query');
let dictionary;
const shards=new Map();
function normalize(text){
  if(!query.canLookup(text))throw new Error('请选择汉字、词语或成语（最多 32 字）');
  return query.normalize(text);
}
function lookupCharacter(text){
  const char=normalize(text);
  if([...char].length>1){
    const key=String(char.codePointAt(0)%256);
    let shard=shards.get(key);
    if(!shard){
      shard=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/dictionary/phrases',key+'.json'),'utf8'));
      if(shards.size>=8)shards.delete(shards.keys().next().value);
    }
    shards.delete(key);shards.set(key,shard);
    const entry=Object.prototype.hasOwnProperty.call(shard,char)?shard[char]:null;
    return entry?{found:true,...entry}:{found:false,char};
  }
  if(!dictionary)dictionary=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/dictionary/characters.json'),'utf8'));
  const entry=Object.prototype.hasOwnProperty.call(dictionary,char)?dictionary[char]:null;
  return entry?{found:true,kind:'character',...entry}:{found:false,char};
}
module.exports={lookupCharacter};
