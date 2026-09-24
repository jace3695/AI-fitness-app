import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {newDocument,parsePack,parseAttempt,type Attempt} from './model.ts';
import {recommend,confirmedStage} from './recommend.ts';
import {identityState,identityLines,identityCandidates,identitySnapshot,identityEligible,identityReferences} from './identity.ts';
const pack=parsePack(JSON.parse(readFileSync(new URL('../../content/drawing/foundations-v1.json',import.meta.url),'utf8')));
const owner=crypto.randomUUID();
function attempt(n=61,f=0):Attempt {const lesson=pack.lessons[n-1];const a:Attempt={id:crypto.randomUUID(),user_id:owner,revision:1,status:'completed',created_at:'2026-09-24',updated_at:'2026-09-24',document:newDocument(lesson,lesson.examples[f],pack.version)};a.document.strokes=[{points:[[100,100,.5],[150,140,.5]],color:'#34314b',width:2,erase:false}];a.document.identity={...identityState(a.document),features:['ears','spacing'],compared:true};a.document.step=4;return a;}
test('character emotion variants preserve all unselected features and 28 complete linked targets',()=>{
 let count=0;for(const l of pack.lessons.slice(60,70))for(const ex of l.examples){const m=ex.identity!;for(const o of m.options){count++;assert.deepEqual(new Set(o.frames.at(-1)),new Set(o.lines.map(x=>x.id)));if(['D62','D63','D64'].includes(l.id)){const excluded=o.id==='eyes'?['eyes-left','eyes-right']:['mouth'];assert.deepEqual(o.lines.filter(x=>!excluded.includes(x.id)),m.baseline.filter(x=>!excluded.includes(x.id)));}}}assert.equal(count,28);
});
test('source picker excludes another owner, wrong family, unsaved/empty/paper and unrelated lesson',()=>{
 const current=attempt(65),good=attempt(62),other=attempt(63);other.user_id=crypto.randomUUID();const paper=attempt(64);paper.document.tool='paper';const empty=attempt(62);empty.document.strokes=[];assert.deepEqual(identityCandidates(current,[good,other,paper,empty,attempt(62,1),attempt(66)],'collection').map(x=>x.id),[good.id]);
});
test('collection copy preserves source and survives source deletion without mutating snapshot',()=>{
 const a=attempt(65),sources=[attempt(62),attempt(63),attempt(64)],before=structuredClone(sources);const state={...identityState(a.document),collection:sources.map(identitySnapshot),editing:sources[0].id,note:'귀를 같은 자리에'};a.document.identity=state;a.document.references=identityReferences(state);a.document.strokes=structuredClone(state.collection[0].strokes);a.document.strokes[0].points[0][0]=20;assert.deepEqual(sources,before);assert.equal(state.collection[0].strokes[0].points[0][0],100);assert.equal(identityEligible(a.document),true);const roundtrip=parseAttempt(JSON.parse(JSON.stringify(a)));assert.deepEqual(roundtrip.document,a.document);assert.equal(identityCandidates(a,[],'collection').length,0);assert.deepEqual(identityLines(a.document),state.collection[0].lines);state.collection.pop();assert.equal(identityEligible(a.document),false);
});
test('pose collection requires baseline, distinct lesson sources, final comparison and note',()=>{
 const a=attempt(70),base=attempt(61),p=attempt(66),q=attempt(67);a.document.identity={...identityState(a.document),baseline:identitySnapshot(base),collection:[p,q].map(identitySnapshot),editing:p.id,note:'귀 모양을 유지'};a.document.references=identityReferences(a.document.identity);assert.equal(identityEligible(a.document),true);a.document.identity.baseline=undefined;assert.equal(identityEligible(a.document),false);a.document.tool='paper';assert.equal(identityEligible(a.document),true);a.document.identity.note='';assert.equal(identityEligible(a.document),false);assert.equal(identityEligible(attempt(69).document),false);
});
test('malformed choices, duplicate features and wrong source relations are rejected',()=>{
 const a=attempt(61);a.document.identity!.features=['ears','ears'];assert.throws(()=>parseAttempt(a));a.document.identity!.features=['ears','spacing'];a.document.identity!.choice='missing';assert.throws(()=>parseAttempt(a));a.document.identity!.choice='main';a.document.identity!.baseline=identitySnapshot(attempt(61,1));a.document.references=[a.document.identity!.baseline.attemptId];assert.throws(()=>parseAttempt(a));assert.equal(parseAttempt(attempt()).document.lesson.id,'D61');
});

test('one complete same-character collection advances D65 and confirms stage8 without forcing another mascot',()=>{
 for(const n of [65,70]){const a=attempt(n),base=attempt(61),sources=(n===65?[62,63,64]:[66,67]).map(x=>attempt(x));a.document.check='independent';a.document.identity={...identityState(a.document),baseline:identitySnapshot(base),collection:sources.map(identitySnapshot),editing:sources[0].id,note:'같은 귀 모양을 유지'};a.document.references=identityReferences(a.document.identity);assert.equal(identityEligible(a.document),true);if(n===65)assert.equal(recommend(pack,[a])?.lessonId,'D66');else assert.equal(confirmedStage(pack,[a],8),true);}
});
