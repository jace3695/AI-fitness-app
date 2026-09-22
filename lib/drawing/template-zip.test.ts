import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { readTemplateZip, sha256, templatePath, type TemplateAsset } from './template-zip.ts';
const picture = Uint8Array.from([137,80,78,71,13,10,26,10]);
async function fixture() {
 const name='동물가이드/곰.png';const asset:TemplateAsset={id:'tpl-012345abcdef',path:name,label:'곰',group:'동물가이드',sha256:await sha256(picture),size:picture.length,lessonIds:['D03'],note:'귀만 봐요.'};
 const n=Buffer.from(name),body=deflateRawSync(picture),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
 local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(body.length,18);local.writeUInt32LE(picture.length,22);local.writeUInt16LE(n.length,26);
 central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(body.length,20);central.writeUInt32LE(picture.length,24);central.writeUInt16LE(n.length,28);
 const start=local.length+n.length+body.length;end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+n.length,12);end.writeUInt32LE(start,16);
 const bytes=Buffer.concat([local,n,body,central,n,end]);
 return {asset,buffer:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),start};
}
test('ZIP decoder reads original bytes and validates their SHA before any upload',async()=>{
 const {asset,buffer}=await fixture();const result=await readTemplateZip(buffer,[asset]);assert.deepEqual(result[0].bytes,picture);
 await assert.rejects(readTemplateZip(buffer,[{...asset,sha256:'0'.repeat(64)}]));
 await assert.rejects(readTemplateZip(buffer,[asset,{...asset,path:'missing.png'}]));
});
test('truncated, encrypted and oversized archives fail closed',async()=>{
 const {asset,buffer,start}=await fixture();await assert.rejects(readTemplateZip(buffer.slice(0,-1),[asset]));
 const encrypted=buffer.slice(0);new DataView(encrypted).setUint16(start+8,1,true);await assert.rejects(readTemplateZip(encrypted,[asset]));
 const bomb=buffer.slice(0);new DataView(bomb).setUint32(start+24,500_000_000,true);await assert.rejects(readTemplateZip(bomb,[asset]));
});
test('catalog contains 150 originals and exact lesson references; paths remain owner-scoped',()=>{
 const c=JSON.parse(readFileSync(new URL('../../content/drawing/template-catalog.json',import.meta.url),'utf8'));
 assert.equal(c.assets.length,150);assert.equal(new Set(c.assets.map((a:TemplateAsset)=>a.id)).size,150);
 const bear=c.assets.find((a:TemplateAsset)=>a.path==='동물가이드/동물가이드_곰.png');assert.ok(bear.lessonIds.includes('D03'));
 const owner='00000000-0000-4000-8000-000000000001';assert.ok(templatePath(owner,bear).startsWith(owner+'/learning/drawing/'));
 assert.throws(()=>templatePath('../other',bear));
});
