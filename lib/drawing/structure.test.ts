import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {newDocument,parsePack,parseAttempt,type Attempt} from './model.ts';
import {structureState,structureEligible,copyAnalysis} from './structure.ts';
import {recommend,confirmedStage} from './recommend.ts';
const pack=parsePack(JSON.parse(readFileSync(new URL('../../content/drawing/foundations-v1.json',import.meta.url),'utf8')));
function attempt(n=52,i=0):Attempt {const l=pack.lessons[n-1];return {id:crypto.randomUUID(),user_id:crypto.randomUUID(),revision:1,status:'completed',created_at:'2026-09-24',updated_at:'2026-09-24',document:newDocument(l,l.examples[i],pack.version)};}
const ink={points:[[100,100,.5],[110,120,.6]] as [number,number,number][],color:'#34314b',width:2,erase:false};
test('20 structure examples have linked progressive frames and stable snapshot roundtrips',()=>{
 for(let n=43;n<=52;n++)for(let i=0;i<2;i++) {const a=attempt(n,i),e=a.document.example,st=e.structure!;assert.ok(st);assert.equal(st.frames.length,a.document.lesson.steps.length);assert.equal(st.frames[0].length,0);assert.deepEqual(new Set(st.frames[4]),new Set(st.lines.map(l=>l.id)));assert.deepEqual(parseAttempt(JSON.parse(JSON.stringify(a))).document.example,e);for(const l of [...e.lines,...st.lines,...st.hidden])for(const num of [...l.start,...l.direction])assert.equal(num,Number(num.toFixed(3)));}
});
test('D46 copies saved analysis without editing source or assembly strokes; wrong sources rejected',()=>{
 const a=attempt(46),source=attempt(45,1);source.document.strokes=[structuredClone(ink)];a.document.strokes=[structuredClone(ink)];const before=structuredClone(source);a.document={...a.document,...copyAnalysis(a.document,source)};assert.deepEqual(source,before);assert.equal(a.document.example.id,source.document.example.id);assert.equal(a.document.structure!.analysis.length,1);assert.equal(a.document.strokes.length,1);a.document.structure!.analysis[0].points[0][0]=1;assert.equal(source.document.strokes[0].points[0][0],100);assert.equal(parseAttempt(a).document.references[0],source.id);assert.throws(()=>copyAnalysis(attempt(43).document,source));assert.throws(()=>copyAnalysis(a.document,attempt(45)));source.document.tool='paper';assert.throws(()=>copyAnalysis(a.document,source));
});
test('both independent canvases, choice, source, checks and explanation survive saved JSON',()=>{
 const a=attempt();a.document.structure={...structureState(a.document),analysis:[ink],surface:'assembly',choice:'oval',identified:true,compared:true,note:'머리와 몸의 붙는 곳'};a.document.strokes=[{...ink,color:'#7750c4'}];assert.deepEqual(parseAttempt(JSON.parse(JSON.stringify(a))).document,a.document);a.document.structure.choice='unknown';assert.throws(()=>parseAttempt(a));
});
test('stage6 completion and recommendation require final relationship checks on distinct examples',()=>{
 const a=attempt(),b=attempt(52,1);for(const x of [a,b]){x.document.check='independent';x.document.step=4;x.document.structure={...structureState(x.document),identified:true,compared:true};}assert.equal(confirmedStage(pack,[a,b],6),true);b.document.structure!.compared=false;assert.equal(confirmedStage(pack,[a,b],6),false);assert.match(recommend(pack,[b])!.reason,/앞뒤/);b.document.structure!.compared=true;b.document.step=2;assert.equal(structureEligible(b.document),false);assert.equal(structureEligible(attempt(1).document),true);
});
test('occlusion examples preserve hidden paths outside finished contours; directions mirror correctly',()=>{
 for(const n of [47,48])for(const e of pack.lessons[n-1].examples){assert.ok(e.structure!.hidden.length);for(const h of e.structure!.hidden)assert.ok(!e.lines.some(l=>l.d===h.d));}
 for(const e of pack.lessons[49].examples){const st=e.structure!;assert.deepEqual(st.easyLines,['near-eye','far-eye']);assert.ok(st.frames[2].includes('near-eye'));assert.ok(!st.frames[2].includes('far-eye'));assert.ok(st.frames[3].includes('far-eye'));}
});
