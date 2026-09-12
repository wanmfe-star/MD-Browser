'use strict';
const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { createHash } = require('node:crypto');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const children = node => Array.from(node?.childNodes || []).filter(n => n.nodeType === 1);
const child = (node, name) => children(node).find(n => n.namespaceURI === W && n.localName === name);
const all = (node, name) => Array.from(node.getElementsByTagNameNS(W, name));
const attr = (node, name) => node?.getAttributeNS(W, name) || '';
const val = (node, name) => attr(child(node, name), 'val');
const hash = bytes => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
function parse(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('不支持包含外部实体的 Word 文档');
  return new DOMParser({ onError: (level, message) => { if (level !== 'warning') throw new Error(message); } }).parseFromString(xml, 'application/xml');
}
async function unpack(bytes) {
  if (!bytes?.length || bytes.length > 20 * 1024 * 1024) throw new Error('请选择不超过 20 MB 的 DOCX 文件');
  let zip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new Error('Word 文件损坏或格式不受支持，请使用 .docx 文件'); }
  const entries = Object.values(zip.files);
  if (entries.length > 3000 || entries.reduce((n, e) => n + (e._data?.uncompressedSize || 0), 0) > 100 * 1024 * 1024) throw new Error('Word 解压内容过大');
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('不是有效的 DOCX 文件');
  const xml = parse(await entry.async('string'));
  const body = xml.getElementsByTagNameNS(W, 'body')[0];
  if (!body) throw new Error('不支持此 Word 文档结构');
  const settings = zip.file('word/settings.xml');
  if (settings && all(parse(await settings.async('string')), 'documentProtection').some(n => !['0', 'false', 'off'].includes(attr(n, 'enforcement')))) throw new Error('此 Word 文档设有编辑保护，请先在 Word 中解除保护');
  return { zip, xml, body };
}
function runText(run) { return children(run).map(n => n.localName === 't' ? n.textContent : n.localName === 'tab' ? '\t' : n.localName === 'br' || n.localName === 'cr' ? '\n' : '').join(''); }
function textOf(node) { return all(node, 'r').map(runText).join(''); }
function editable(p) {
  return p.localName === 'p' && !all(p, 'sectPr').length && !all(p, 'numPr').length && children(p).every(n => n.localName === 'pPr' || (n.localName === 'r' && children(n).every(r => ['rPr','t','tab','br','cr'].includes(r.localName) && !(r.localName === 'br' && attr(r, 'type') && attr(r, 'type') !== 'textWrapping'))));
}
function formatOf(p) {
  const props = child(p, 'pPr'), spacing = child(props, 'spacing'), indent = child(props, 'ind');
  const align = val(props, 'jc');
  return { align: ({ both:'justify', distribute:'justify', start:'left', end:'right' })[align] || (['left','center','right'].includes(align) ? align : 'left'),
    line: attr(spacing,'lineRule') === 'exact' || attr(spacing,'lineRule') === 'atLeast' ? 1.5 : Number(attr(spacing,'line') || 360) / 240,
    before: Number(attr(spacing,'before') || 0) / 20, after: Number(attr(spacing,'after') || 0) / 20,
    indent: (Number(attr(indent,'firstLine') || 0) - Number(attr(indent,'hanging') || 0)) / 20 };
}
function runStyle(run) {
  const p = child(run, 'rPr');
  const enabled = name => !!child(p, name) && !['0','false','off'].includes(val(p,name));
  const size = Number(val(p,'sz')) / 2, color = val(p,'color');
  return { bold:enabled('b'), italic:enabled('i'), strike:enabled('strike'), underline:!!child(p,'u') && val(p,'u') !== 'none', size:size >= 6 && size <= 96 ? size : null,
    font:attr(child(p,'rFonts'),'eastAsia') || attr(child(p,'rFonts'),'ascii') || null, color:/^[a-f\d]{6}$/i.test(color) ? '#' + color : null };
}
async function inspectDocx(bytes) {
  const { zip, body } = await unpack(bytes);
  const relEntry = zip.file('word/_rels/document.xml.rels');
  const rels = relEntry ? Array.from(parse(await relEntry.async('string')).getElementsByTagName('Relationship')) : [];
  const blocks = [];
  for (const [i,node] of children(body).entries()) {
    if (node.localName === 'sectPr') continue;
    const block = { id:'b'+i, editable:editable(node), text:textOf(node), format:formatOf(node), runs:children(node).filter(n=>n.localName==='r').map(r=>({text:runText(r),...runStyle(r)})) };
    if (!block.editable) {
      block.kind = node.localName === 'tbl' ? 'table' : 'protected';
      if (block.kind === 'table') block.rows = children(node).filter(n=>n.localName==='tr').map(row=>children(row).filter(n=>n.localName==='tc').map(cell=>all(cell,'p').map(textOf).join('\n')));
      block.images = [];
      for (const blip of Array.from(node.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main','blip'))) {
        const id = blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','embed');
        const rel = rels.find(r=>r.getAttribute('Id')===id && r.getAttribute('TargetMode')!=='External');
        if (!rel) continue;
        const relative = rel.getAttribute('Target');
        const target = require('node:path').posix.normalize(relative.startsWith('/') ? relative.slice(1) : 'word/' + relative);
        const ext = target.split('.').pop().toLowerCase(), mime = {png:'png',jpg:'jpeg',jpeg:'jpeg',gif:'gif',webp:'webp'}[ext];
        const entry = zip.file(target);
        if (mime && entry && entry._data.uncompressedSize < 10*1024*1024) block.images.push('data:image/'+mime+';base64,'+await entry.async('base64'));
      }
    }
    blocks.push(block);
  }
  return { blocks, fingerprint:hash(bytes), protectedCount:blocks.filter(b=>!b.editable).length };
}
function setW(node, name, value) { node.setAttributeNS(W, 'w:'+name, String(value)); }
function ensure(node, name) {
  let n = child(node,name);
  if(!n) {
    n=node.ownerDocument.createElementNS(W,'w:'+name);
    const order=node.localName==='rPr'?['rStyle','rFonts','b','bCs','i','iCs','caps','smallCaps','strike','dstrike','outline','shadow','emboss','imprint','noProof','snapToGrid','vanish','webHidden','color','spacing','w','kern','position','sz','szCs','highlight','u','effect','bdr','shd','fitText','vertAlign','rtl','cs','em','lang','eastAsianLayout','specVanish','oMath','rPrChange']:['pStyle','keepNext','keepLines','pageBreakBefore','framePr','widowControl','numPr','suppressLineNumbers','pBdr','shd','tabs','suppressAutoHyphens','kinsoku','wordWrap','overflowPunct','topLinePunct','autoSpaceDE','autoSpaceDN','bidi','adjustRightInd','snapToGrid','spacing','ind','contextualSpacing','mirrorIndents','suppressOverlap','jc','textDirection','textAlignment','textboxTightWrap','outlineLvl','divId','cnfStyle','rPr','sectPr','pPrChange'];
    const next=children(node).find(c=>order.indexOf(c.localName)>order.indexOf(name));
    node.insertBefore(n,next||null);
  }
  return n;
}
function writeRun(xml, prototype, text) {
  const run = prototype ? prototype.cloneNode(false) : xml.createElementNS(W,'w:r');
  const props=child(prototype,'rPr'); if(props)run.appendChild(props.cloneNode(true));
  for(const part of text.split(/(\t|\n)/)) {
    if(!part)continue;
    const n=xml.createElementNS(W, part==='\t'?'w:tab':part==='\n'?'w:br':'w:t');
    if(part!=='\t' && part!=='\n'){n.setAttribute('xml:space','preserve');n.appendChild(xml.createTextNode(part));} run.appendChild(n);
  }
  return run;
}
function replaceText(p,text) {
  const old=textOf(p); if(old===text)return;
  const runs=children(p).filter(n=>n.localName==='r');
  let prefix=0,suffix=0;
  while(prefix<old.length && prefix<text.length && old[prefix]===text[prefix])prefix++;
  while(suffix<old.length-prefix && suffix<text.length-prefix && old[old.length-1-suffix]===text[text.length-1-suffix])suffix++;
  const result=[]; let offset=0, inserted=false;
  for(const r of runs) {
    const value=runText(r),end=offset+value.length;
    const before=value.slice(0,Math.max(0,Math.min(value.length,prefix-offset)));
    if(before)result.push(writeRun(p.ownerDocument,r,before));
    if(!inserted && end>=prefix){const middle=text.slice(prefix,text.length-suffix);if(middle)result.push(writeRun(p.ownerDocument,r,middle));inserted=true;}
    const start=Math.max(0,old.length-suffix-offset);
    if(start<value.length)result.push(writeRun(p.ownerDocument,r,value.slice(start)));
    offset=end;
  }
  if(!inserted && text)result.push(writeRun(p.ownerDocument,runs[0],text));
  for(const r of runs)p.removeChild(r);
  for(const r of result)p.appendChild(r);
}
function setRunStyle(run, values) {
  if(!values || typeof values!=='object' || Array.isArray(values))throw new Error('无效的文字样式');
  let props=child(run,'rPr');
  for(const [key,value] of Object.entries(values)) {
    if(!['font','size','color','bold','italic','underline','strike'].includes(key))throw new Error('无效的文字样式');
    if(!props){props=run.ownerDocument.createElementNS(W,'w:rPr');run.insertBefore(props,run.firstChild);}
    if(key==='font') {
      if(typeof value!=='string'||!value.trim()||value.length>100||/[\x00-\x1f]/.test(value))throw new Error('无效的字体');
      const node=ensure(props,'rFonts');for(const name of ['asciiTheme','hAnsiTheme','eastAsiaTheme','cstheme'])node.removeAttributeNS(W,name);
      for(const name of ['ascii','hAnsi','eastAsia','cs'])setW(node,name,value);
    } else if(key==='size') {
      if(!Number.isFinite(value)||value<6||value>96||!Number.isInteger(value*2))throw new Error('字号须为 6–96 磅，支持半磅');
      for(const name of ['sz','szCs'])setW(ensure(props,name),'val',value*2);
    } else if(key==='color') {
      if(typeof value!=='string'||!/^#[a-f0-9]{6}$/i.test(value))throw new Error('无效的字体颜色');
      const node=ensure(props,'color');for(const name of ['themeColor','themeTint','themeShade'])node.removeAttributeNS(W,name);setW(node,'val',value.slice(1).toUpperCase());
    } else {
      if(typeof value!=='boolean')throw new Error('无效的文字样式开关');
      const names={bold:['b','bCs'],italic:['i','iCs'],underline:['u'],strike:['strike']}[key];
      for(const name of names)setW(ensure(props,name),'val',name==='u'?(value?'single':'none'):(value?'1':'0'));
    }
  }
}
function replaceRuns(p, block, byId) {
  if(!Array.isArray(block.runs)||block.runs.length>20000||block.runs.some(r=>!r||typeof r.text!=='string')||block.runs.map(r=>r.text).join('')!==block.text)throw new Error('文字样式与段落内容不一致');
  const result=block.runs.map(r=>{
    let prototype;
    if(r.origin){const source=byId.get(r.origin.id);if(!source||!editable(source)||!Number.isInteger(r.origin.index)||r.origin.index<0)throw new Error('无效的文字来源');prototype=children(source).filter(n=>n.localName==='r')[r.origin.index];if(!prototype)throw new Error('无效的文字来源');}
    const run=writeRun(p.ownerDocument,prototype,r.text);setRunStyle(run,r.overrides||{});return run;
  });
  for(const r of children(p).filter(n=>n.localName==='r'))p.removeChild(r);
  for(const r of result)p.appendChild(r);
}
function setFormat(p,format,previous) {
  for(const key of ['align','line','before','after','indent']) {
    if(format[key]===previous[key])continue;
    let props=child(p,'pPr'); if(!props){props=p.ownerDocument.createElementNS(W,'w:pPr');p.insertBefore(props,p.firstChild);}
    if(key==='align') { if(!['left','center','right','justify'].includes(format[key]))throw new Error('无效的对齐方式');setW(ensure(props,'jc'),'val',format[key]==='justify'?'both':format[key]); }
    else {
      const value=Number(format[key]),limit=key==='line'?3:120;
      if(!Number.isFinite(value)||value<(key==='line'?1:0)||value>limit)throw new Error('无效的段落间距');
      if(key==='indent'){const n=ensure(props,'ind');n.removeAttributeNS(W,'hanging');n.removeAttributeNS(W,'hangingChars');n.removeAttributeNS(W,'firstLineChars');setW(n,'firstLine',Math.round(value*20));}
      else {const n=ensure(props,'spacing');setW(n,key,Math.round(value*(key==='line'?240:20)));if(key==='line')setW(n,'lineRule','auto');else {n.removeAttributeNS(W,key+'Lines');n.removeAttributeNS(W,key+'Autospacing');}}
    }
  }
}
async function editDocx(bytes, blocks) {
  const {zip,xml,body}=await unpack(bytes);
  if(!Array.isArray(blocks)||blocks.length>20000)throw new Error('无效的 Word 编辑内容');
  const originals=children(body), byId=new Map(originals.map((n,i)=>['b'+i,n]));
  const locked=originals.map((n,i)=>({n,id:'b'+i})).filter(x=>x.n.localName!=='sectPr'&&!editable(x.n)).map(x=>x.id);
  if(JSON.stringify(blocks.filter(b=>locked.includes(b.id)).map(b=>b.id))!==JSON.stringify(locked))throw new Error('不能删除或移动受保护的图片、表格和复杂段落');
  const seen=new Set(), next=[];
  for(const block of blocks) {
    if(typeof block.id!=='string'||seen.has(block.id))throw new Error('段落标识重复');seen.add(block.id);
    const original=byId.get(block.id);
    if(original && original.localName==='sectPr')throw new Error('不能编辑分节设置');
    if(original&&!editable(original)){next.push(original);continue;}
    if(!original&&!block.id.startsWith('new-'))throw new Error('未知段落');
    if(typeof block.text!=='string'||block.text.length>1000000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(block.text))throw new Error('无效的段落文字');
    let node;
    if(original)node=original.cloneNode(true);
    else {node=xml.createElementNS(W,'w:p');const source=byId.get(block.sourceId);if(source&&editable(source)){const props=child(source,'pPr');if(props)node.appendChild(props.cloneNode(true));const run=children(source).find(n=>n.localName==='r');node.appendChild(writeRun(xml,run,''));}}
    setFormat(node,block.format || {},formatOf(node));if(block.richText)replaceRuns(node,block,byId);else replaceText(node,block.text);next.push(node);
  }
  if(!next.length)next.push(xml.createElementNS(W,'w:p'));
  for(const node of originals)body.removeChild(node);
  for(const node of next)body.appendChild(node);
  for(const node of originals.filter(n=>n.localName==='sectPr'))body.appendChild(node);
  zip.file('word/document.xml',new XMLSerializer().serializeToString(xml));
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
module.exports={inspectDocx,editDocx};
