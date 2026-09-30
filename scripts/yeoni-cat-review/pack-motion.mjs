// Lossless packaging only: artwork is the user-approved reference-v2 base and patches.
import sharp from 'sharp';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url),dir=new URL('public/yeoni/cat/reference-v2/',root);
const spec=JSON.parse(readFileSync(new URL('manifest.json',dir)));
const hash=b=>createHash('sha256').update(b).digest('hex');
const layers=[{input:readFileSync(new URL(spec.base.image,dir)),left:0,top:0}],parts={};
let n=0;
for(const[id,patches]of Object.entries(spec.parts)){
 parts[id]=[];
 for(const p of patches){
  const input=readFileSync(new URL(p.image,dir));assert.equal(hash(input),p.sha256);
  const x=336+n%6*64,y=Math.floor(n/6)*64;n++;
  layers.push({input,left:x,top:y});
  parts[id].push({source:[x,y,p.rect[2],p.rect[3]],rect:p.rect,feather:p.feather});
 }
}
const output=await sharp({create:{width:768,height:384,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(layers).png().toBuffer();
assert.deepEqual(await sharp(output).extract({left:0,top:0,width:313,height:313}).removeAlpha().raw().toBuffer(),await sharp(layers[0].input).removeAlpha().raw().toBuffer());
writeFileSync(new URL('public/yeoni/cat/preserved-motion-v3.png',root),output);
writeFileSync(new URL('public/yeoni/cat/preserved-motion-v3.json',root),JSON.stringify({version:3,size:[768,384],sourceSize:[313,313],padding:24,stageSize:360,baseSha256:spec.base.sha256,atlasSha256:hash(output),parts,scope:'Approved opaque original and local patches. Continuous 2D deformation; not transparent part segmentation.'},null,2)+'\n');
console.log('Packed approved artwork without repainting:',output.length,'bytes');
