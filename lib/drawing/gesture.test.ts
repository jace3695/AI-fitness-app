import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {newDocument,parsePack,parseAttempt,type Attempt} from './model.ts';
import {gestureState,gestureEligible} from './gesture.ts';
import {confirmedStage} from './recommend.ts';
const pack=parsePack(JSON.parse(readFileSync(new URL('../../content/drawing/foundations-v1.json',import.meta.url),'utf8')));
function attempt(n=60,i=0):Attempt {const l=pack.lessons[n-1];return {id:crypto.randomUUID(),user_id:crypto.randomUUID(),revision:1,status:'completed',created_at:'2026-09-24',updated_at:'2026-09-24',document:newDocument(l,l.examples[i],pack.version)};}
const ink={points:[[100,100,.5],[110,120,.6]] as [number,number,number][],color:'#34314b',width:2,erase:false};
test('18 gesture examples preserve independent snapshots and linked progressive frames',()=>{
 let count=0;
 for(let n=53;n<=60;n++)for(let i=0;i<pack.lessons[n-1].examples.length;i++) {count++;const a=attempt(n,i),e=a.document.example,g=e.gesture!;assert.equal(g.frames.length,5);assert.deepEqual(new Set(g.frames[4]),new Set(g.lines.map(l=>l.id)));assert.deepEqual(parseAttempt(JSON.parse(JSON.stringify(a))).document.example,e);assert.deepEqual(g.frames[0],g.baseLines);for(const ids of [...g.frames,g.baseLines,g.easyLines])for(const id of ids)assert.ok(g.lines.some(l=>l.id===id));}
 assert.equal(count,18);
});
test('traced and free ink, direction choice and checks roundtrip independently; bad choices rejected',()=>{
 const a=attempt(54);a.document.gesture={...gestureState(a.document),trace:[structuredClone(ink)],choice:'left',directionChecked:true,compared:true,note:'머리가 왼쪽'};a.document.strokes=[structuredClone(ink)];const b=parseAttempt(JSON.parse(JSON.stringify(a)));assert.deepEqual(b.document,a.document);b.document.gesture!.trace[0].points[0][0]=3;assert.equal(b.document.strokes[0].points[0][0],100);assert.equal(a.document.gesture.trace[0].points[0][0],100);a.document.gesture.choice='invalid';assert.throws(()=>parseAttempt(a));assert.equal(parseAttempt(attempt(1)).document.gesture,undefined);
});
test('stage7 confirmation requires final direction checks on distinct examples',()=>{
 const a=attempt(),b=attempt(60,1);for(const x of [a,b]){x.document.check='independent';x.document.step=4;x.document.gesture={...gestureState(x.document),directionChecked:true,compared:true};}assert.equal(confirmedStage(pack,[a,b],7),true);b.document.gesture!.compared=false;assert.equal(confirmedStage(pack,[a,b],7),false);b.document.gesture!.compared=true;b.document.step=2;assert.equal(gestureEligible(b.document),false);assert.equal(gestureEligible(attempt(1).document),true);
});
test('pose goals have distinct directions, bent sitting knees, two foot anchors and unchanged D59 skeleton',()=>{
 for(let n=53;n<=60;n++){const es=pack.lessons[n-1].examples;assert.notDeepEqual(es[0].lines.map(l=>l.d),es[1].lines.map(l=>l.d));}
 const sitting=pack.lessons[55].examples[0].gesture!;assert.equal(sitting.lines.find(l=>l.id==='thigh')!.d,'M165 226 L263 226');assert.equal(sitting.lines.find(l=>l.id==='shin')!.d,'M263 226 L263 327');
 for(const e of pack.lessons[57].examples){assert.equal(e.gesture!.anchors.length,2);assert.deepEqual(e.gesture!.easyLines,[]);}
 for(const [i,n] of [55,57].entries()){const source=pack.lessons[n-1].examples[0].gesture!,g=pack.lessons[58].examples[i].gesture!;assert.deepEqual(g.lines.filter(l=>g.baseLines.includes(l.id)),source.lines);assert.ok(g.frames[1].includes('mass-torso'));assert.ok(!g.frames[1].some(id=>id.startsWith('mass-arm')));}
});
