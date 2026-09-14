'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {normalize,canLookup}=require('../shared/dictionary-query');
const source=path.resolve(process.argv[2]||''),destination=path.join(__dirname,'../assets/dictionary');
function rows(name){return JSON.parse(fs.readFileSync(path.join(source,name),'utf8'));}
const words=rows('word.json'),idioms=rows('idiom.json');
if(words.length<300000 || idioms.length<40000)throw new Error('Phrase download is incomplete');
const shards=Array.from({length:256},()=>Object.create(null));
function plain(value){
  if(typeof value==='string')return value.trim();
  if(Array.isArray(value))return value.map(plain).filter(Boolean).join('；');
  if(value && typeof value==='object')return [plain(value.book),plain(value.text)].filter(Boolean).join('：');
  return '';
}
for(const [items,kind] of [[words,'word'],[idioms,'idiom']]){
  for(const item of items){
    const char=normalize(item.word);
    if(!canLookup(char)||[...char].length<2)continue;
    const shard=shards[char.codePointAt(0)%256];
    const entry=shard[char]||{char,kind,pinyin:[],definitions:[]};
    if(kind==='idiom')entry.kind=kind;
    for(const reading of Array.isArray(item.pinyin)?item.pinyin:[item.pinyin])if(typeof reading==='string' && reading.trim() && !entry.pinyin.includes(reading.trim()))entry.pinyin.push(reading.trim());
    const definition=plain(item.explanation);
    if(definition && !entry.definitions.includes(definition))entry.definitions.push(definition);
    for(const key of ['source','example','usage','similar','opposite'])if(plain(item[key]))entry[key]=plain(item[key]);
    shard[char]=entry;
  }
}
fs.mkdirSync(path.join(destination,'phrases'),{recursive:true});
for(const [i,shard] of shards.entries())fs.writeFileSync(path.join(destination,'phrases',i+'.json'),JSON.stringify(shard));
const entries=shards.flatMap(shard=>Object.values(shard));
const metadata={project:'mapull/chinese-dictionary',url:'https://github.com/mapull/chinese-dictionary',license:'MIT',retrieved:new Date().toISOString().slice(0,10),entries:entries.length,idioms:entries.filter(e=>e.kind==='idiom').length,withDefinitions:entries.filter(e=>e.definitions.length).length,files:Object.fromEntries(['word.json','idiom.json'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(source,name))).digest('hex')])),changes:'Merged Chinese words and idioms by normalized term; retained source readings, definitions, origins, examples, usage, synonyms and antonyms where present. Split into 256 buckets by first code point modulo 256. Non-Chinese terms and terms exceeding 32 characters excluded.',notice:'Upstream states that some original data sources are uncertain and data accuracy has not been strictly verified.'};
fs.writeFileSync(path.join(destination,'PHRASES-SOURCE.json'),JSON.stringify(metadata,null,2)+'\n');
console.log(JSON.stringify({entries:metadata.entries,idioms:metadata.idioms,withDefinitions:metadata.withDefinitions}));
