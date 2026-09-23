import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { newDocument, parseAttempt, parsePack, type Attempt } from './model.ts';
import { memoryHintLines, memorySource, memoryState, memoryStep, memoryVisible, recallEligible } from './memory.ts';
import { confirmedStage } from './recommend.ts';
const raw = JSON.parse(readFileSync(new URL('../../content/drawing/foundations-v1.json', import.meta.url), 'utf8'));
const pack = parsePack(raw);
const owner = crypto.randomUUID();
function attempt(n: number, variant=0): Attempt {
  const l=pack.lessons[n-1];
  return { id:crypto.randomUUID(), user_id:owner, revision:1, status:'draft', created_at:'2026-09-23', updated_at:'2026-09-23', document:newDocument(l,l.examples[variant],pack.version) };
}
test('recall phases hide original including after saving and restoring; D33 starts hidden',()=>{
  for(let n=29;n<=34;n++) for(let variant=0;variant<2;variant++) {
    const a=attempt(n,variant);
    assert.equal(memoryVisible(a.document),n!==33);
    for(let i=0;i<a.document.lesson.steps.length;i++) {
      a.document={...a.document,...memoryStep(a.document,i)};
      assert.equal(memoryVisible(parseAttempt(JSON.parse(JSON.stringify(a))).document),a.document.lesson.steps[i].memoryPhase!=='recall');
    }
    a.document={...a.document,step:2,memory:{...memoryState(a.document),peeking:true,peeks:1}};
    assert.equal(memoryVisible(a.document),true);
    a.document={...a.document,...memoryStep(a.document,1)};assert.equal(memoryVisible(a.document),false);
    assert.equal(a.document.memory!.peeks,1);
  }
});
test('memory hints never show eyes or ears; normal recall is blank',()=>{
  for(let n=29;n<=34;n++) {
    const d=attempt(n).document;
    assert.equal(memoryHintLines(d.lesson,d.example,false).length,0);
    assert.ok(memoryHintLines(d.lesson,d.example,true).every(l=>!/^eye|ear|mouth|nose/.test(l.id)));
  }
  assert.deepEqual(memoryHintLines(attempt(30).document.lesson,attempt(30).document.example,true).map(l=>l.id),['faceL','faceR']);
});
test('saved source supplies a snapshot but never copies or mutates old ink; foreign sources rejected',()=>{
  const source=attempt(31), a=attempt(33), before=structuredClone(source);
  const patch=memorySource(a,source);const saved=parseAttempt({...a,document:{...a.document,...patch}});
  assert.deepEqual(source,before);assert.deepEqual(saved.document.strokes,[]);
  assert.equal(saved.document.example.id,source.document.example.id);
  assert.equal(saved.document.memory!.source!.revision,1);assert.equal(memoryVisible(saved.document),false);
  source.document.example.name='Changed later';assert.notEqual(saved.document.example.name,source.document.example.name);
  assert.throws(()=>memorySource(a,{...source,user_id:crypto.randomUUID()}));
  assert.throws(()=>memorySource(attempt(29),source));assert.throws(()=>memorySource(a,attempt(28)));
});
test('memory completion requires recall and comparison evidence and excludes copy fallback',()=>{
  const a=attempt(34);a.status='completed';a.document.check='independent';
  assert.equal(recallEligible(a.document),false);
  a.document.step=4;a.document.memory={...memoryState(a.document),selected:['body','eyes'],compared:'다리 위치를 다시 봤어요.'};
  assert.equal(recallEligible(a.document),true);
  const b=attempt(34,1);b.status='completed';b.document={...b.document,step:4,check:'independent',memory:structuredClone(a.document.memory)};
  assert.equal(confirmedStage(pack,[a,b],4),true);
  b.document.memory!.copyMode=true;assert.equal(confirmedStage(pack,[a,b],4),false);
  const c=attempt(33);c.document.step=4;c.document.memory={...memoryState(c.document),selected:['face','ears'],compared:'귀'};assert.equal(recallEligible(c.document),false);
});
test('unknown memory features or invalid lesson line links are rejected',()=>{
  const a=attempt(29);a.document.memory={...memoryState(a.document),selected:['missing']};assert.throws(()=>parseAttempt(a));
  const broken=structuredClone(raw);broken.lessons[28].memoryPractice.features[0].lines=['missing'];assert.throws(()=>parsePack(broken));
});
