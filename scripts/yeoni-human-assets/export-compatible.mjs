// CSS/native-radio review surface: useful even when all JavaScript is disabled.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root));
const spec=JSON.parse(read('public/yeoni/human/poc-atlas-v2.json'));
const uris=Object.fromEntries(Object.entries(spec.images).map(([id,value])=>[id,'data:image/webp;base64,'+read('public'+value.webp).toString('base64')]));
const part=(id,kind='')=>{
  const p=spec.parts[id];
  const [x,y,w,h]=p.sourceRect,[dx,dy,dw,dh]=p.destinationRect;
  const [iw,ih]=spec.images[p.image].sourceSize;
  const styles={left:dx/760*100,top:dy/1150*100,width:dw/760*100,height:dh/1150*100};
  const style=Object.entries(styles).map(([k,v])=>`${k}:${v}%`).join(';')+`;background-image:var(--yeoni-${p.image});background-size:${iw/w*100}% ${ih/h*100}%;background-position:${x/(iw-w)*100}% ${y/(ih-h)*100}%`;
  return `<div aria-hidden="true" class="yeoni-part ${id} ${kind}" style="${style}"></div>`;
};
const parts=[part('torso'),part('head')];
for(const id of ['eyesOpen','eyesHalf','eyesClosed'])parts.push(part(id,'yeoni-eye'));
for(const id of ['closed','a','i','u','e','o'])parts.push(part(id,'yeoni-mouth'));
const fragment=read('scripts/yeoni-human-assets/compatible-fragment.html').toString().replace('@@BASE@@',uris.base).replace('@@FACE@@',uris.face).replace('@@PARTS@@',parts.join('\n'));
assert.ok(Buffer.byteLength(fragment)<1_000_000);
assert.ok(!/<script|<canvas|@@|\\"|\\n/.test(fragment));
writeFileSync(new URL('docs/yeoni-phase7/Yeoni_Human_A_Compatible_Fragment.html',root),fragment);
const shell=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'"><title>연이 눈·입 모양 확인</title><style>:root{color-scheme:light dark;--background:light-dark(#faf8fd,#221d29);--foreground:light-dark(#362b43,#f6f0ff);--card:light-dark(#fff,#30283b);--secondary:light-dark(#eee6fa,#4a3c5d)}body{margin:0;padding:20px;background:var(--background);color:var(--foreground);font:16px/1.6 system-ui,sans-serif}main{max-width:760px;margin:auto}input{accent-color:#8059a4}.form-check{min-height:44px;display:inline-flex;align-items:center;gap:6px}h1{font-size:24px}</style></head><body><main><h1>연이 눈·입 모양 확인</h1><p>소리와 자동 움직임 없이 모양을 선택해 볼 수 있습니다.</p>${fragment}</main></body></html>`;
writeFileSync(new URL('docs/yeoni-phase7/Yeoni_Human_A_Compatible_Preview.html',root),shell);
console.log(`Compatible preview exported: ${Buffer.byteLength(fragment)} bytes; no JavaScript or Canvas.`);
