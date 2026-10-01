// Asset packing: opaque character RGB comes from the approved original.
import sharp from 'sharp';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url),out=new URL('public/yeoni/human/rig-v4/',root);
const source=new URL('public/yeoni/human/reference-v3/',root);
const ref=JSON.parse(readFileSync(new URL('manifest.json',source)));
const hash=b=>createHash('sha256').update(b).digest('hex');
const original=readFileSync(new URL('base.png',source));assert.equal(hash(original),ref.base.sha256);
const rgb=await sharp(original).removeAlpha().raw().toBuffer();
const matteSource=readFileSync(new URL('matte-source.png',out));
const edgeSource=readFileSync(new URL('edge-colors.png',out));
const edges=await sharp(edgeSource).ensureAlpha().raw().toBuffer();
const {data:matte,info}=await sharp(matteSource).greyscale().raw().toBuffer({resolveWithObject:true});
assert.deepEqual([info.width,info.height,info.channels],[1024,1536,1]);
const pixels=1024*1536,rgba=Buffer.alloc(pixels*4);let opaque=0,transparent=0,partial=0;
for(let i=0;i<pixels;i++){
  // Generated alpha has a 252-254 plateau even within the character. Restore opacity.
  const a=matte[i]<=4?0:matte[i]>=250?255:matte[i];
  rgba[i*4]=rgb[i*3];rgba[i*4+1]=rgb[i*3+1];rgba[i*4+2]=rgb[i*3+2];rgba[i*4+3]=a;
  // Only semitransparent silhouette edges use the cutout's decontaminated RGB.
  if(a>0&&a<255){assert.equal(edges[i*4+3],matte[i]);for(let c=0;c<3;c++)rgba[i*4+c]=edges[i*4+c];}
  if(a===255)opaque++;else if(a===0)transparent++;else partial++;
}
assert.ok(opaque>900000&&transparent>350000&&partial>1000);
// Face edits and the neck seam must never become transparent.
for(const [x,y,w,h] of [...Object.values(ref.parts).flat().map(p=>p.rect),[425,650,190,170]])
  for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)assert.equal(rgba[(row*1024+col)*4+3],255,`Protected alpha ${col},${row}`);
const neckRow=740;
const files={};mkdirSync(out,{recursive:true});
for(const [name,top,height] of [['head',0,neckRow],['body',neckRow,1536-neckRow]]){
  const bytes=await sharp(rgba,{raw:{width:1024,height:1536,channels:4}}).extract({left:0,top,width:1024,height}).png().toBuffer();
  writeFileSync(new URL(name+'.png',out),bytes);
  files[name]={image:name+'.png',sha256:hash(bytes),rect:[0,top,1024,height],parent:name==='head'?'body':null};
}
// Verify the stored pieces, not just the buffers used to produce them.
const joined=Buffer.concat(await Promise.all(['head','body'].map(name=>sharp(new URL(name+'.png',out).pathname).raw().toBuffer())));
assert.deepEqual(joined,rgba);
const preview=await sharp(rgba,{raw:{width:1024,height:1536,channels:4}}).resize(448,672).webp({lossless:true,effort:6}).toBuffer();
writeFileSync(new URL('assembled-preview.webp',out),preview);
const originalPreview=await sharp(original).resize(448,672).webp({lossless:true,effort:6}).toBuffer();
writeFileSync(new URL('original-preview.webp',out),originalPreview);
for(const parts of Object.values(ref.parts))for(const p of parts)assert.equal(hash(readFileSync(new URL(p.image,source))),p.sha256);
const spec={version:4,status:'original-rgb-preserving-static-rig-preparation',size:ref.size,source:{image:'../reference-v3/base.png',sha256:ref.base.sha256},matte:{image:'matte-source.png',sha256:hash(matteSource),edgeImage:'edge-colors.png',edgeSha256:hash(edgeSource),normalization:{transparentAtOrBelow:4,opaqueAtOrAbove:250},rgbPolicy:'Opaque RGB from approved original; generated RGB used only at semitransparent silhouette edges to remove the old backdrop fringe',counts:{opaque,transparent,partial}},layers:files,faceParts:Object.fromEntries(Object.entries(ref.parts).map(([k,v])=>[k,v.map(p=>({...p,image:'../reference-v3/'+p.image,parent:'head'}))])),faceViewport:ref.faceViewport,pivots:{head:[524,696],body:[512,1280],neckSeamY:neckRow,neckBlendBand:[632,816]},controllerBinding:{eyes:{open:'original',half:'eyesHalf',closed:'eyesClosed'},mouth:{rest:'original',closed:'original',a:'a',i:'i',u:'u',e:'e',o:'o',small:'small'}},preview:{image:'assembled-preview.webp',originalImage:'original-preview.webp',size:[448,672],sha256:hash(preview),originalSha256:hash(originalPreview)},motionConstraints:{status:'not-motion-validated',joint:'continuous shared neck deformation required',independentRigidHeadRotation:false,hiddenNeckInpainting:false,largeTurn:false},scope:'Static head/body packing. Exact original opaque foreground RGB; changed alpha/background and semitransparent edge RGB. Not a completed independent-part rig, human animation, or speech validation.'};
writeFileSync(new URL('manifest.json',out),JSON.stringify(spec,null,2)+'\n');
console.log(JSON.stringify({layers:files,alpha:spec.matte.counts,opaqueRgbChangedPixels:0,reassemblyChangedPixels:0,edgeRgbMayDiffer:partial}));
