'use strict';
const { PDFDocument, degrees, PDFHexString, PDFName, PDFArray, PDFDict } = require('pdf-lib');
const { validatePDF } = require('./pdf-file');
async function annotatePDF(bytes, overlays = [], annotations = [], removed = []) {
  const source = Buffer.from(bytes);
  validatePDF(source);
  const pdf = await PDFDocument.load(source);
  removeAnnotations(pdf, removed);
  for (const overlay of overlays) {
    if (!Number.isInteger(overlay.page) || overlay.page < 1 || overlay.page > pdf.getPageCount()) throw new Error('无效的标注页码');
    const page = pdf.getPage(overlay.page - 1);
    const png = await pdf.embedPng(overlay.png);
    const { x, y, width: w, height: h } = page.getCropBox();
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    const positions = { 0: [x,y,w,h], 90: [x+w,y,h,w], 180: [x+w,y+h,w,h], 270: [x,y+h,h,w] };
    const [px,py,width,height] = positions[rotation];
    page.drawImage(png, { x:px, y:py, width, height, rotate:degrees(rotation) });
  }
  for (const annotation of annotations) {
    const { page: number, tool, color, quads, text } = annotation;
    if (!Number.isInteger(number) || number<1 || number>pdf.getPageCount() || !['textHighlight','textUnderline'].includes(tool) || !/^#[0-9a-f]{6}$/i.test(color) || !Array.isArray(quads) || !quads.length || quads.some(q=>!Array.isArray(q) || q.length!==8 || q.some(v=>!Number.isFinite(v)))) throw new Error('无效的文本标注');
    const page=pdf.getPage(number-1), values=quads.flat();
    const xs=values.filter((_,i)=>i%2===0),ys=values.filter((_,i)=>i%2===1);
    const x=Math.min(...xs)-1,y=Math.min(...ys)-1,w=Math.max(...xs)-x+1,h=Math.max(...ys)-y+1;
    const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255);
    const highlight=tool==='textHighlight',opacity=highlight ? 0.3 : 1;
    const commands=['q','/GS gs',rgb.join(' ')+(highlight?' rg':' RG'),'1.2 w'];
    for(const q of quads) {
      const pt=i=>`${q[i]-x} ${q[i+1]-y}`;
      commands.push(highlight ? `${pt(0)} m ${pt(2)} l ${pt(6)} l ${pt(4)} l h f` : `${pt(4)} m ${pt(6)} l S`);
    }
    commands.push('Q');
    const appearance=pdf.context.register(pdf.context.flateStream(commands.join('\n'), {
      Type:'XObject',Subtype:'Form',BBox:[0,0,w,h],Resources:{ExtGState:{GS:{Type:'ExtGState',ca:opacity,CA:opacity,BM:highlight?'Multiply':'Normal'}}},
    }));
    const entry=pdf.context.obj({Type:'Annot',Subtype:highlight?'Highlight':'Underline',Rect:[x,y,x+w,y+h],QuadPoints:values,C:rgb,CA:opacity,F:4,P:page.ref,
      Contents:PDFHexString.fromText(String(text || '')),T:PDFHexString.fromText('MD Browser'),AP:{N:appearance}});
    const key=PDFName.of('Annots');
    let list=page.node.lookupMaybe(key,PDFArray);
    if(!list){list=pdf.context.obj([]);page.node.set(key,list);}
    list.push(pdf.context.register(entry));
  }
  return pdf.save();
}
const markupTypes = new Set(['Text','FreeText','Line','Square','Circle','Polygon','PolyLine','Highlight','Underline','Squiggly','StrikeOut','Stamp','Caret','Ink','FileAttachment','Sound','Redact']);
function removeAnnotations(pdf, removed) {
  const ids = new Set(removed);
  pdf.getPages().forEach((page,p) => {
    const list=page.node.lookupMaybe(PDFName.of('Annots'),PDFArray);if(!list)return;
    const removedRefs=new Set();
    for(let i=0;i<list.size();i++)if(ids.has(`${p+1}:${i}`)) {
      const entry=list.lookup(i,PDFDict),kind=entry.get(PDFName.of('Subtype'))?.toString().slice(1);
      if(markupTypes.has(kind))removedRefs.add(list.get(i).toString());
    }
    for(let i=list.size()-1;i>=0;i--) {
      const entry=list.lookup(i,PDFDict);
      if(removedRefs.has(list.get(i).toString()) || (entry.get(PDFName.of('Subtype'))?.toString()==='/Popup' && removedRefs.has(entry.get(PDFName.of('Parent'))?.toString())))list.remove(i);
    }
  });
}
async function inspectAnnotations(bytes) {
  const pdf=await PDFDocument.load(Buffer.from(bytes)),result=[];
  pdf.getPages().forEach((page,p)=>{
    const list=page.node.lookupMaybe(PDFName.of('Annots'),PDFArray);if(!list)return;
    for(let i=0;i<list.size();i++) {
      const entry=list.lookup(i,PDFDict),kind=entry.get(PDFName.of('Subtype'))?.toString().slice(1);
      if(!markupTypes.has(kind))continue;
      const rect=entry.lookupMaybe(PDFName.of('Rect'),PDFArray)?.asArray().map(n=>n.asNumber());
      const points=entry.lookupMaybe(PDFName.of('QuadPoints'),PDFArray)?.asArray().map(n=>n.asNumber());
      if(!rect || rect.length!==4)continue;
      const quads=[];for(let j=0;points && j+7<points.length;j+=8)quads.push(points.slice(j,j+8));
      result.push({id:`${p+1}:${i}`,existing:true,page:p+1,rectPdf:rect,quads,kind});
    }
  });return result;
}
module.exports = { annotatePDF, inspectAnnotations };

