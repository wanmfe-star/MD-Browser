'use strict';
const assert=require('node:assert/strict');
const {lookupCharacter}=require('../electron/dictionary');
const source=require('../assets/dictionary/SOURCE.json');
assert.ok(source.entries>=20000);
for(const char of ['学','學','佛','中','龘']){const entry=lookupCharacter(char);assert.equal(entry.found,true,char);assert.ok(entry.pinyin.length,char);}
assert.equal(lookupCharacter('⾏').char,'行','PDF compatibility character normalized');
const study=lookupCharacter(' 学 ');assert.ok(study.pinyin.includes('xué'));assert.ok(study.definitions.length);
const poly=lookupCharacter('行');assert.ok(poly.pinyin.includes('xíng') && poly.pinyin.includes('háng'));assert.ok(poly.definitions.length>=2);
assert.equal(lookupCharacter('𰻞').char,'𰻞');
assert.equal(lookupCharacter('學\uFE00').char,'學');
for(const input of ['',null,'abc','../file','<script>'])assert.throws(()=>lookupCharacter(input));
console.log('Dictionary tests passed: offline data, definitions, traditional characters, polyphones, Unicode and input validation');

const query=require('../shared/dictionary-query');
assert.equal(query.canLookup('学习'),true);
assert.equal(query.canLookup('画蛇添足'),true);
assert.equal(query.canLookup('学'.repeat(33)),false);
assert.equal(query.canLookup('你好！'),false);
assert.equal(lookupCharacter('学\n习').char,'学习');
assert.equal(lookupCharacter('学习').kind,'word');
assert.ok(lookupCharacter('学习').definitions.length);
const idiom=lookupCharacter('画蛇添足');assert.equal(idiom.kind,'idiom');assert.ok(idiom.pinyin.length);assert.ok(idiom.definitions.some(s=>s.includes('蛇')));assert.ok(idiom.source);
assert.equal(lookupCharacter('龘龘龘龘龘龘').found,false);
for(const c of ['学习','成长','知识','天文','电脑','阅读','生活','工作','家庭','世界','文化','艺术'])assert.equal(lookupCharacter(c).found,true,c);
assert.equal(lookupCharacter('学习').found,true,'cache eviction preserves lookup');
console.log('Phrase tests passed: words, idioms, provenance, unknown terms, PDF line breaks and bounded queries');
