import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { newDocument, parseAttempt, parsePack, type Attempt } from './model.ts';
import { chooseVariation, variationEligible, variationState, variationTarget } from './variation.ts';
import { confirmedStage, recommend } from './recommend.ts';
const raw=JSON.parse(readFileSync(new URL('../../content/drawing/foundations-v1.json',import.meta.url),'utf8'));
const pack=parsePack(raw);
function attempt(n=42,i=0):Attempt { const l=pack.lessons[n-1];return {id:crypto.randomUUID(),user_id:crypto.randomUUID(),revision:1,status:'completed',created_at:'2026-09-24',updated_at:'2026-09-24',document:newDocument(l,l.examples[i],pack.version)}; }
test('all variation targets change only declared lines and preserve baseline and saved snapshots',()=>{
  for(const l of pack.lessons.slice(34,42))for(const e of l.examples)for(const v of e.variations!) {
    const a=attempt(Number(l.id.slice(1)));a.document=newDocument(l,e,pack.version);
    const before=structuredClone(a.document);a.document={...a.document,...chooseVariation(a.document,v.id)};
    const target=variationTarget(a.document);
    for(const line of [...e.lines,...v.lines]) {
      for(const n of [...line.start,...line.direction])assert.equal(n,Number(n.toFixed(3)));
      if(line.fill!=='ink')assert.deepEqual(/^M\s*([\d.]+)[ ,]+([\d.]+)/.exec(line.d)?.slice(1).map(Number),line.start);
    }
    assert.deepEqual(a.document.example,before.example);
    for(const line of e.lines.filter(x=>!v.remove.includes(x.id)))assert.deepEqual(target.lines.find(x=>x.id===line.id),line);
    for(const line of v.lines)assert.notEqual(line.d,e.lines.find(x=>x.id===line.id)?.d);
    assert.equal(new Set(target.lines.map(x=>x.id)).size,target.lines.length);
    const saved=parseAttempt(JSON.parse(JSON.stringify(a)));assert.deepEqual(variationTarget(saved.document),target);
  }
});
test('ear length and fold preserve attachment points; waving preserves the shoulder',()=>{
 for(const n of [37,40,41])for(const e of pack.lessons[n-1].examples){const v=e.variations![0],old=e.lines.find(l=>l.id===v.lines[0].id)!;assert.deepEqual(v.lines[0].start,old.start);if(n!==40)assert.deepEqual(v.lines[0].d.split(' ').slice(-2).map(Number),old.d.split(' ').slice(-2).map(Number));}
});
test('changing choice preserves ink but resets old comparison and prevents premature completion',()=>{
 const a=attempt();a.document.strokes=[{points:[[20,30,.5]],width:2,color:'#34314b',erase:false}];a.document.step=4;a.document.check='independent';a.document.variation={...variationState(a.document),changedChecked:true,keptChecked:true,note:'입'};
 assert.equal(variationEligible(a.document),true);const patch=chooseVariation(a.document,'eyes');const d={...a.document,...patch};assert.equal(variationEligible(d),false);assert.equal(d.strokes.length,1);assert.equal(d.check,'unconfirmed');assert.equal(d.variation!.note,'');assert.throws(()=>chooseVariation(d,'arm'));
});
test('stage five and recommendation require both comparison checks on two distinct examples',()=>{
 const a=attempt(),b=attempt(42,1);for(const x of [a,b]){x.document.check='independent';x.document.step=4;x.document.variation={...variationState(x.document),changedChecked:true,keptChecked:true,note:''};}
 assert.equal(confirmedStage(pack,[a,b],5),true);b.document.variation!.keptChecked=false;assert.equal(confirmedStage(pack,[a,b],5),false);assert.match(recommend(pack,[b])!.reason,/유지한/);b.document.variation!.keptChecked=true;b.document.short=true;assert.equal(confirmedStage(pack,[a,b],5),false);
});
test('unknown choices and dangling replacement paths are rejected; old lessons remain readable',()=>{
 const a=attempt();a.document.variation={choice:'missing',changedChecked:true,keptChecked:true,note:''};assert.throws(()=>parseAttempt(a));const p=structuredClone(raw);p.lessons[34].examples[0].variations[0].remove=['missing'];assert.throws(()=>parsePack(p));assert.equal(parseAttempt(attempt(1)).document.variation,undefined);
});
