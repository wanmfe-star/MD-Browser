'use strict';
const assert=require('node:assert/strict');
const {PDFDocument,PDFName,PDFArray,PDFDict,degrees}=require('pdf-lib');
const {annotatePDF,inspectAnnotations}=require('../electron/pdf-annotations');
(async()=>{
 const pdf=await PDFDocument.create();
 for(const angle of [0,90,180,270]){const p=pdf.addPage([400,600]);p.setRotation(degrees(angle));p.setCropBox(20,30,350,500);p.drawText('Original selectable text',{x:50,y:400,size:18});}
 const original=await pdf.save(), annotations=[0,1,2,3].map(i=>({page:i+1,tool:i%2?'textUnderline':'textHighlight',color:'#ffcc00',text:'Original selectable text',quads:[[50,418,240,418,50,398,240,398]]}));
 const result=await PDFDocument.load(await annotatePDF(original,[],annotations));
 const source=await PDFDocument.load(original);
 for(let i=0;i<4;i++){
  const p=result.getPage(i),before=source.getPage(i);
  assert.equal(p.getRotation().angle,before.getRotation().angle);assert.deepEqual(p.getCropBox(),before.getCropBox());
  const content=page=>{const a=page.node.lookup(PDFName.of('Contents'),PDFArray);return Array.from({length:a.size()},(_,j)=>Buffer.from(a.lookup(j).getContents()));};
  assert.deepEqual(content(p),content(before),'original page content streams are unchanged');
  const list=p.node.lookup(PDFName.of('Annots'),PDFArray);assert.equal(list.size(),1);
  const a=list.lookup(0,PDFDict);assert.deepEqual(a.lookup(PDFName.of('QuadPoints'),PDFArray).asArray().map(n=>n.asNumber()),annotations[i].quads[0]);
  assert.ok(a.lookup(PDFName.of('AP'),PDFDict).get(PDFName.of('N')));
 }
 const second=await PDFDocument.load(await annotatePDF(await result.save(),[],[annotations[0]]));
 assert.equal(second.getPage(0).node.lookup(PDFName.of('Annots'),PDFArray).size(),2,'preserves existing annotations');
 const withLink=await PDFDocument.load(await result.save());
 const page=withLink.getPage(0),list=page.node.lookup(PDFName.of('Annots'),PDFArray);
 list.push(withLink.context.register(withLink.context.obj({Type:'Annot',Subtype:'Link',Rect:[20,20,60,40],A:{S:'URI',URI:require('pdf-lib').PDFString.of('https://example.com')}})));
 list.push(withLink.context.register(withLink.context.obj({Type:'Annot',Subtype:'Widget',Rect:[70,20,110,40],FT:'Tx'})));
 const input=await withLink.save(),editable=await inspectAnnotations(input);
 assert.equal(editable.length,4,'enumerates markup on every page without treating links/forms as markup');
 const cleared=await PDFDocument.load(await annotatePDF(input,[],[],editable.map(a=>a.id)));
 assert.equal(cleared.getPage(0).node.lookup(PDFName.of('Annots'),PDFArray).size(),2,'clear preserves links and forms');
 assert.equal((await inspectAnnotations(await cleared.save())).length,0,'all markup removed');
 const removedOne=await annotatePDF(input,[],[],[editable[1].id]);
 assert.equal((await inspectAnnotations(removedOne)).length,3,'individual saved annotation removed');
 await assert.rejects(annotatePDF(original,[],[{...annotations[0],page:9}]));
 console.log('Native PDF annotation checks passed: preserved text, rotations, crop boxes and existing annotations');
})().catch(e=>{console.error(e);process.exitCode=1;});
