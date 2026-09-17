const assert=require('node:assert/strict'),{marked}=require('marked'),{split}=require('../shared/markdown-sections');
const parse=s=>split(s,t=>marked.lexer(t));
const text='前言\r\n\r\n# 第一页\r\n内容\r\n\r\n```md\r\n# 假标题\r\n```\r\n\r\n> # 引用标题\r\n\r\n# 第二页\r\n正文';
const sections=parse(text);assert.deepEqual(sections.map(s=>s.title),['前言','第一页','第二页']);assert.equal(sections.map(s=>text.slice(s.start,s.end)).join(''),text);assert.ok(text.slice(sections[2].start).startsWith('# 第二页'));
assert.equal(parse('普通内容').length,0);assert.deepEqual(parse('# 相同\n一\n# 相同\n二').map(s=>s.title),['相同','相同']);assert.deepEqual(parse('<!--\n# 隐藏\n-->\n\n# 显示').map(s=>s.title),['前言','显示']);console.log('MARKDOWN_SECTIONS_OK');
