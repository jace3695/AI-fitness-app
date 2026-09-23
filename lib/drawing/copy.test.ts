import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { copyGuide, copyWorksheetSvg, correctionCopy } from './copy.ts';
import { newDocument, parseAttempt, parsePack, type Attempt } from './model.ts';
const raw = JSON.parse(readFileSync(new URL('../../content/drawing/foundations-v1.json', import.meta.url), 'utf8'));
const pack = parsePack(raw);
const lesson = (id: string) => pack.lessons.find(l => l.id === id)!;
const guide = (id: string, easy = false) => { const l=lesson(id);return copyGuide(l,l.examples[0],l.help as 0|1|2|3,0,easy); };

test('copy lessons reduce scaffolds deliberately: blank body, four anchors, two anchors, blank page', () => {
  assert.deepEqual(guide('D17').lines.map(l=>l.id),['bodyL','bodyR']);
  assert.equal(guide('D18').lines.length,0);assert.equal(guide('D18').anchors.length,4);
  assert.equal(guide('D19').anchors.length,2);assert.equal(guide('D19',true).anchors.length,4);
  assert.equal(guide('D20').lines.length+guide('D20').anchors.length,0);
  assert.equal(guide('D20',true).anchors.length,4);
  assert.deepEqual(guide('D21',true).lines.map(l=>l.id),['faceL','faceR']);
  assert.equal(guide('D26').scale,.65);
  for(const l of pack.lessons.slice(16,28)) {
    assert.equal(l.examples.length,2);assert.equal(l.practice?.mode,'copy');
    for(const ex of l.examples) assert.ok(l.steps.some(s=>s.action==='compare') && ex.lines.some(l=>l.group==='shape'));
  }
});
test('the correction demonstration actually removes the low eye before replacing it', () => {
  const l=lesson('D27'),ex=l.examples[0];
  assert.ok(copyGuide(l,ex,3,1,false).lines.some(l=>l.id==='lowEye'));
  const after=copyGuide(l,ex,3,3,false).lines.map(l=>l.id);
  assert.ok(after.includes('eyeR'));assert.ok(!after.includes('lowEye'));
});
test('printing uses the starting scaffold and keeps the solution off the learner side', () => {
  for(const id of ['D17','D18','D20','D26']) {
    const l=lesson(id),ex=l.examples[0],svg=copyWorksheetSvg(l,ex),target=svg.split('translate(430 45)')[1];
    assert.ok(target);assert.ok(!target.includes(ex.lines.find(l=>l.id==='eyeR')!.d));
    assert.equal(target.includes(ex.lines[0].d),id==='D17');
  }
});
test('correction copies preserve source strokes, source reference and version through save/restore', () => {
  const owner=crypto.randomUUID();
  const make=(id:string):Attempt=>{const l=lesson(id);return {id:crypto.randomUUID(),user_id:owner,revision:1,status:'completed',created_at:'2026-09-23',updated_at:'2026-09-23',document:newDocument(l,l.examples[0],pack.version)};};
  const source=make('D26');source.document.strokes=[{points:[[100,100,.5],[130,140,.6]],width:2.6,color:'#34314b',erase:false}];
  const unchanged=structuredClone(source),target=make('D27');
  const doc=correctionCopy(target,source);doc.strokes[0].points[0][0]=120;
  doc.comparison={focus:'ears',reason:'얼굴에 비해 귀가 크게 보여요.'};
  const restored=parseAttempt({...target,document:doc});
  assert.deepEqual(source,unchanged);assert.equal(restored.document.correctionSource?.scale,.65);
  assert.equal(restored.document.correctionSource?.revision,source.revision);
  assert.deepEqual(restored.document.comparison,doc.comparison);
  assert.throws(()=>correctionCopy(target,{...source,user_id:crypto.randomUUID()}));
  assert.throws(()=>correctionCopy(target,make('D17')));
  assert.throws(()=>parseAttempt({...target,document:{...doc,references:[]}}));
});
test('remote packs with missing copy guidance or correction line pointers are rejected', () => {
  for(const change of [(p:typeof raw)=>p.lessons[16].practice.baseLines.push('missing'),(p:typeof raw)=>p.lessons[26].steps[2].hideLines.push('missing')]) {
    const broken=structuredClone(raw);change(broken);assert.throws(()=>parsePack(broken));
  }
});
