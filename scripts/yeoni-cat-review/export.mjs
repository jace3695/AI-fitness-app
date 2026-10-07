import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const root=new URL('../../',import.meta.url),asset=new URL('public/yeoni/cat/reference-v2/',root);
const spec=JSON.parse(readFileSync(new URL('manifest.json',asset)));
const read=name=>readFileSync(new URL(name,asset));
const hash=b=>createHash('sha256').update(b).digest('hex');
const original=readFileSync(new URL('public/yeoni-cat-sprite-v1.webp',root));
assert.equal(hash(original),spec.source.sha256);
const crop=await sharp(original).extract({left:0,top:0,width:313,height:313}).raw().toBuffer();
assert.deepEqual(await sharp(read(spec.base.image)).raw().toBuffer(),crop);
const uri=name=>'data:image/webp;base64,'+read(name).toString('base64');
const vars=[`--reference-base:url("${uri(spec.base.preview)}");`],patches=[],selectors=[];
for(const[id,parts]of Object.entries(spec.parts)){
 selectors.push(`#yeoni-cat-reference-v2:has(#reference-${id.startsWith('eyes')?'eye':'mouth'}-${id}:checked) .patch-${id}{display:block}`);
 for(const[n,p]of parts.entries()){
  assert.equal(hash(read(p.image)),p.sha256);
  vars.push(`--reference-${id}-${n}:url("${uri(p.image)}");`);
  const[x,y,w,h]=p.rect,f=p.feather;
  const mask=(direction,size)=>`linear-gradient(${direction},transparent 0%,transparent ${2/size*100}%,#000 ${f/size*100}%,#000 ${(1-f/size)*100}%,transparent ${(1-2/size)*100}%,transparent 100%)`;
  const style=`left:${x/313*100}%;top:${y/313*100}%;width:${w/313*100}%;height:${h/313*100}%;background-image:var(--reference-${id}-${n});mask-image:${mask('to right',w)},${mask('to bottom',h)};mask-composite:intersect`;
  patches.push(`<div aria-hidden="true" class="reference-patch patch-${id}" style="${style}"></div>`);
 }
}
const labels={closed:'기본 · 닫힘',a:'아',i:'이',u:'우',e:'에',o:'오',small:'작게 열기'};
const options=Object.entries(labels).map(([id,label])=>`<label class="form-check"><input id="reference-mouth-${id}" name="cat-reference-mouth" type="radio" class="form-check-input"${id==='closed'?' checked':''}><span class="form-check-label">${label}</span></label>`).join('\n');
const fragment=readFileSync(new URL('scripts/yeoni-cat-review/reference-fragment.html',root),'utf8').replace('@@IMAGE_VARS@@',vars.join('\n')).replace('@@SELECTION_CSS@@',selectors.join('\n')).replace('@@PATCHES@@',patches.join('\n')).replace('@@MOUTH_OPTIONS@@',options);
assert.ok(Buffer.byteLength(fragment)<1_000_000);assert.ok(!/<script|<canvas|@@|\\"|\\n/.test(fragment));
mkdirSync(new URL('docs/yeoni-cat-review/',root),{recursive:true});
writeFileSync(new URL('docs/yeoni-cat-review/Yeoni_Cat_Reference_Fragment.html',root),fragment);
const page=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'"><title>고양이 연이 원본 대조</title><style>:root{color-scheme:light dark;--background:light-dark(#faf8fd,#221d29);--foreground:light-dark(#362b43,#f6f0ff)}body{margin:0;padding:20px;background:var(--background);color:var(--foreground);font:16px/1.6 system-ui,sans-serif}main{max-width:900px;margin:auto}.form-check{min-height:44px;display:inline-flex;align-items:center;gap:6px}h1{font-size:24px}</style></head><body><main><h1>고양이 연이 · 원본과 직접 비교</h1><p>정지 외형 검수입니다. 기본 모습과 배경은 원본 그대로이며 자동 움직임과 소리는 없습니다.</p>${fragment}</main></body></html>`;
writeFileSync(new URL('docs/yeoni-cat-review/Yeoni_Cat_Reference_Preview.html',root),page);
console.log(`Cat reference preview: ${Buffer.byteLength(fragment)} bytes; original crop pixels match.`);
