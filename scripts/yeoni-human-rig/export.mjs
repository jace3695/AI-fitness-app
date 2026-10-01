import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url),dir=new URL('public/yeoni/human/rig-v4/',root);
const spec=JSON.parse(readFileSync(new URL('manifest.json',dir)));
const uri=f=>'data:image/webp;base64,'+readFileSync(new URL(f,dir)).toString('base64');
const vars=[`--rig-original:url("${uri(spec.preview.originalImage)}");`,`--rig-assembled:url("${uri(spec.preview.image)}");`],patches=[],selectors=[];
for(const[id,parts]of Object.entries(spec.faceParts)){
  selectors.push(`#yeoni-human-rig-v4:has(#rig-${id.startsWith('eyes')?'eye':'mouth'}-${id}:checked) .patch-${id}{display:block}`);
  for(const[n,p]of parts.entries()){
    vars.push(`--rig-${id}-${n}:url("${uri(p.image)}");`);
    const[x,y,w,h]=p.rect,f=p.feather;
    const mask=(direction,n)=>`linear-gradient(${direction},transparent 0%,transparent ${2/n*100}%,#000 ${f/n*100}%,#000 ${(1-f/n)*100}%,transparent ${(1-2/n)*100}%,transparent 100%)`;
    patches.push(`<div aria-hidden="true" class="rig-patch patch-${id}" style="left:${x/1024*100}%;top:${y/1536*100}%;width:${w/1024*100}%;height:${h/1536*100}%;background-image:var(--rig-${id}-${n});mask-image:${mask('to right',w)},${mask('to bottom',h)};mask-composite:intersect"></div>`);
  }
}
const labels={closed:'기본 미소',a:'아',i:'이',u:'우',e:'에',o:'오',small:'작게 열기'};
const options=Object.entries(labels).map(([id,label])=>`<label class="form-check"><input id="rig-mouth-${id}" name="rig-mouth" type="radio" class="form-check-input"${id==='closed'?' checked':''}><span class="form-check-label">${label}</span></label>`).join('\n');
const fragment=readFileSync(new URL('fragment.html',import.meta.url),'utf8').replace('@@IMAGE_VARS@@',vars.join('\n')).replace('@@SELECTION_CSS@@',selectors.join('\n')).replace('@@PATCHES@@',patches.join('\n')).replace('@@MOUTH_OPTIONS@@',options);
assert.ok(Buffer.byteLength(fragment)<1_000_000);assert.ok(!/<script|<canvas|@@|\\"|\\n/.test(fragment));
const out=new URL('docs/yeoni-phase7/rig-v4/',root);
writeFileSync(new URL('Human_A_Rig_Fragment.html',out),fragment);
const page=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'"><title>인간형 원본 보존 자산 비교</title><style>:root{color-scheme:light dark;--background:light-dark(#f4f0fa,#252232);--foreground:light-dark(#30283d,#f4f0fa)}body{margin:0;padding:20px;background:var(--background);color:var(--foreground);font:16px/1.6 system-ui}main{max-width:900px;margin:auto}.form-check{min-height:44px;display:inline-flex;align-items:center;gap:6px}h1{font-size:24px}</style><main><h1>원본의 얼굴과 의상을 그대로</h1><p>배경을 분리한 정지 자산입니다. 움직임과 음성 연결은 다음 단계입니다.</p>${fragment}</main></html>`;
writeFileSync(new URL('Human_A_Rig_Preview.html',out),page);
console.log('Human asset comparison fragment:',Buffer.byteLength(fragment),'bytes');
