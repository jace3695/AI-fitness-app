// Static asset assembly only. No animation, speech clock, account or network access.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../../', import.meta.url);
const read = p => readFileSync(new URL(p, root));
const uri = p => 'data:image/png;base64,' + read(p).toString('base64');
const old = JSON.parse(read('public/yeoni/human/poc-atlas-v1.json'));
// The original body/head stay unchanged. Facial artwork is versioned separately.
const facialRects = {
  eyesOpen: [0,240,427,265], eyesHalf: [406,240,427,265], eyesClosed: [810,240,427,265],
  closed: [52,610,360,266], a: [466,592,334,294], i: [852,616,357,261],
  u: [91,932,282,255], e: [459,933,351,258], o: [855,906,346,290],
};
// Landmarks align the centre of each mouth opening, not the variable crop box.
const mouthAnchors = {closed:[233,751],a:[631,748],i:[1035,751],u:[234,1057],e:[635,1057],o:[1040,1057]};
const mouthScale = 0.45;
const parts = Object.fromEntries(['torso','head','handLeft','handRight'].map(id=>[id,{...old.parts[id],image:'base',destinationRect:old.assembly[id]}]));
for (const [id,rect] of Object.entries(facialRects)) {
  const dest=id.startsWith('eyes') ? [263,262,260,162] : [395-(mouthAnchors[id][0]-rect[0])*mouthScale,467-(mouthAnchors[id][1]-rect[1])*mouthScale,rect[2]*mouthScale,rect[3]*mouthScale];
  parts[id]={sourceRect:rect,sourceRectNormalized:rect.map(v=>v/1254),image:'face',destinationRect:dest,parent:'head'};
}
const images={base:{image:'/yeoni/human/poc-atlas-v1.png',webp:'/yeoni/human/poc-atlas-v1.webp',sourceSize:[1024,1536]},face:{image:'/yeoni/human/face-parts-v2.png',webp:'/yeoni/human/face-parts-v2.webp',sourceSize:[1254,1254]}};
for(const value of Object.values(images))value.sha256=createHash('sha256').update(read('public'+value.image)).digest('hex');
const manifest = {
  version:2,status:'phase7-visual-revision-awaiting-review',form:'human-a',images,designSize:old.designSize,
  referenceSha256:old.referenceSha256,parts,pivotsNormalized:old.pivotsNormalized,layerOrder:old.layerOrder,
  controllerBinding:{blink:old.controllerBinding.blink,viseme:{rest:'closed',closed:'closed',a:'a',i:'i',u:'u',e:'e',o:'o'}},
  limitations:[...old.limitations,'Visual harmony is under user review; browser checks do not establish aesthetic approval.','The old optional small shape is omitted from v2 until matching artwork is prepared.']
};
writeFileSync(new URL('public/yeoni/human/poc-atlas-v2.json',root),JSON.stringify(manifest,null,2)+'\n');
const page = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'"><title>연이 인간형 A안 · 자산 검수</title><style>
*{box-sizing:border-box}body{margin:0;background:#f7f4fb;color:#342b43;font:16px/1.6 system-ui,sans-serif}main{max-width:1080px;margin:auto;padding:24px}h1{font-size:clamp(24px,4vw,36px);margin:8px 0}h2{font-size:20px}p{margin:8px 0 18px}.tag{color:#70578e}.layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px}.panel{padding:20px;background:white;border:1px solid #e7dfef;border-radius:20px;min-width:0}.stage{background:#fff;border:1px solid #ded3ea;border-radius:16px;overflow:hidden;max-width:430px;margin:auto}canvas{display:block;width:100%;height:auto}fieldset{border:0;padding:0;margin:18px 0}legend{font-weight:700}button{font:inherit;border:1px solid #c7b4df;color:#48345d;background:#fff;border-radius:10px;padding:8px 13px;margin:5px 4px 0 0;cursor:pointer;min-height:44px}button[aria-pressed=true]{background:#6f4f93;color:white}button:focus-visible{outline:3px solid #5a9b93;outline-offset:2px}.sheet{width:100%;display:block;border-radius:12px}.note{font-size:14px;color:#675d70}summary{cursor:pointer;padding:12px 0;font-weight:700}#status{font-weight:600}.comparison{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.comparison canvas{border:1px solid #eee;border-radius:10px}.comparison figure{margin:0;text-align:center}details{margin-top:20px}@media(max-width:650px){main{padding:14px}.layout{grid-template-columns:1fr}.panel{padding:14px}}
</style></head><body><main><div class="tag">PHASE 7 · 인간형 A안 · 눈·입 수정 검토본</div><h1>연이의 얼굴을 함께 살펴봐요</h1><p>눈과 입 모양을 눌러 비교할 수 있습니다. 소리와 자동 움직임은 없습니다.</p><div class="layout"><section class="panel"><div class="stage" id="stage"><canvas id="portrait" width="760" height="1150" aria-label="분리 파츠를 합성한 인간형 연이"></canvas></div><p id="status" role="status">자산을 불러오는 중입니다.</p></section><section class="panel"><h2>눈·입 파츠 비교</h2><fieldset id="eye"><legend>눈</legend><button data-id="eyesOpen" aria-pressed="true">뜸</button><button data-id="eyesHalf" aria-pressed="false">반쯤 감음</button><button data-id="eyesClosed" aria-pressed="false">감음</button></fieldset><fieldset id="mouth"><legend>입</legend>${Object.entries({closed:'닫힘',a:'아',i:'이',u:'우',e:'에',o:'오'}).map(([id,label])=>`<button data-id="${id}" aria-pressed="${id==='closed'}">${label}</button>`).join('')}</fieldset><fieldset id="background"><legend>배경</legend><button data-color="#ffffff" aria-pressed="true">흰색</button><button data-color="#eee6fa" aria-pressed="false">연보라</button><button data-color="#24202d" aria-pressed="false">어두운색</button></fieldset><button id="reset">기본 모습으로</button><p class="note">머리 바탕에서 눈·입을 제거하고 한 종류씩 합성합니다. 이 화면은 모양 검수용이며 발음에 맞춰 말하는 화면은 아닙니다.</p><p class="note">머리카락과 눈썹은 각각 머리·눈 파츠에 포함되어 있습니다. 손 파츠는 아직 합성하지 않았습니다.</p></section></div><section class="panel" style="margin-top:24px"><h2>여섯 가지 입 모양</h2><div class="comparison">${['closed','a','i','u','e','o'].map((id,i)=>`<figure><canvas data-mouth="${id}" width="340" height="320"></canvas><figcaption>${['닫힘','아','이','우','에','오'][i]}</figcaption></figure>`).join('')}</div></section><section class="panel" style="margin-top:24px"><h2>전신 4방향·표정 6종</h2><p class="note">원본 A안에 없던 하의와 신발은 크림색 바지·연보라 플랫슈즈로 제안했습니다. 회전도와 표정은 외형 참고 자료입니다.</p><img class="sheet" alt="인간형 A안의 전신 정면, 사선, 측면, 뒷면과 여섯 표정" src="${uri('docs/yeoni-phase7/human-a-model-sheet.png')}"><details><summary>선택한 A안 원본</summary><img class="sheet" style="max-width:420px" alt="기존에 선택한 인간형 A안 원본" src="${uri('docs/yeoni-phase7/reference/human-a-selected.png')}"></details><details><summary>수정한 눈·입 파츠</summary><img class="sheet" alt="수정한 눈 세 종류와 입 여섯 종류의 파츠 시트" id="atlas-original"></details></section></main><script>
const spec=${JSON.stringify(manifest)};const images={base:new Image(),face:new Image()};let eye='eyesOpen',mouth='closed';const canvas=document.querySelector('#portrait');const ctx=canvas.getContext('2d');
function part(id){const p=spec.parts[id];ctx.drawImage(images[p.image],...p.sourceRect,...p.destinationRect)}
function draw(){if(!Object.values(images).every(im=>im.complete&&im.naturalWidth))return;ctx.clearRect(0,0,760,1150);part('torso');part('head');part(eye);part(mouth);canvas.dataset.eye=eye;canvas.dataset.mouth=mouth;document.querySelector('#status').textContent='외형 수정 검토 · '+document.querySelector('#mouth [data-id="'+mouth+'"]').textContent;}
function pressed(group,button){document.querySelectorAll(group+' button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)))}
document.querySelectorAll('#eye button').forEach(b=>b.onclick=()=>{eye=b.dataset.id;pressed('#eye',b);draw()});document.querySelectorAll('#mouth button').forEach(b=>b.onclick=()=>{mouth=b.dataset.id;pressed('#mouth',b);draw()});document.querySelectorAll('#background button').forEach(b=>b.onclick=()=>{document.querySelector('#stage').style.background=b.dataset.color;pressed('#background',b)});document.querySelector('#reset').onclick=()=>{document.querySelector('#eye button').click();document.querySelector('#mouth button').click();document.querySelector('#background button').click()};
function ready(){if(!Object.values(images).every(im=>im.complete&&im.naturalWidth))return;draw();document.querySelectorAll('[data-mouth]').forEach(c=>{const saved=mouth;mouth=c.dataset.mouth;draw();c.getContext('2d').drawImage(canvas,230,245,340,320,0,0,340,320);mouth=saved});draw()}
for(const im of Object.values(images)){im.onload=ready;im.onerror=()=>document.querySelector('#status').textContent='자산을 불러오지 못했습니다. 파일을 다시 내려받아 주세요.'}
images.base.src=${JSON.stringify(uri('public/yeoni/human/poc-atlas-v1.png'))};images.face.src=${JSON.stringify(uri('public/yeoni/human/face-parts-v2.png'))};document.querySelector('#atlas-original').src=images.face.src;
</script></body></html>`;
writeFileSync(new URL('docs/yeoni-phase7/Yeoni_Human_A_Asset_Preview.html',root),page);
console.log('Exported human A asset manifest and offline preview.');
