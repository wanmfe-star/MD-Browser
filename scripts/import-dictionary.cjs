'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const source=path.resolve(process.argv[2] || ''),destination=path.join(__dirname,'../assets/dictionary');
function rows(name){const text=fs.readFileSync(path.join(source,name),'utf8').trim();return text.startsWith('[')?JSON.parse(text):text.split(/\r?\n/).filter(s=>s.trim()).map(s=>JSON.parse(s.trim().replace(/,$/,'')));}
const basic=rows('char_base.json'),details=rows('char_detail.json');
if(basic.length<20000 || details.length<15000)throw new Error('Dictionary download is incomplete');
const map=new Map(basic.map(e=>[e.char,{char:e.char,pinyin:e.pinyin||[],strokes:e.strokes||null,radicals:e.radicals||'',traditional:e.traditional||'',definitions:[]} ]));
for(const item of details){
  const entry=map.get(item.char)||{char:item.char,pinyin:[],strokes:null,radicals:'',traditional:'',definitions:[]};
  for(const reading of item.pronunciations||[]){
    if(reading.pinyin && !entry.pinyin.includes(reading.pinyin))entry.pinyin.push(reading.pinyin);
    const meanings=(reading.explanations||[]).map(e=>e.content).filter(text=>typeof text==='string' && text.trim());
    if(meanings.length)entry.definitions.push((reading.pinyin?reading.pinyin+'\n':'')+meanings.map((text,i)=>`${i+1}. ${text}`).join('\n'));
  }
  map.set(item.char,entry);
}
fs.mkdirSync(destination,{recursive:true});
fs.writeFileSync(path.join(destination,'characters.json'),JSON.stringify(Object.fromEntries(map)));
fs.copyFileSync(path.join(source,'LICENSE'),path.join(destination,'LICENSE'));
fs.writeFileSync(path.join(destination,'SOURCE.json'),JSON.stringify({project:'mapull/chinese-dictionary',url:'https://github.com/mapull/chinese-dictionary',license:'MIT',retrieved:new Date().toISOString().slice(0,10),entries:map.size,withDefinitions:[...map.values()].filter(e=>e.definitions.length).length,files:Object.fromEntries(['char_base.json','char_detail.json'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(source,name))).digest('hex')])),changes:'Merged single-character readings and basic metadata; retained definition content grouped by pronunciation; omitted examples and word lists.',notice:'Upstream states that some original data sources are uncertain and data accuracy has not been strictly verified.'},null,2)+'\n');
console.log(`Dictionary generated: ${map.size} characters, ${[...map.values()].filter(e=>e.definitions.length).length} with definitions`);
