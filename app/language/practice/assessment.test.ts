import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AssessmentSession,validateAssessmentPolicy,validateAssessmentRequest,validateAssessmentResult,type AssessmentRequest,type AssessmentPolicy} from './assessment.ts';
const policy:AssessmentPolicy={providerId:'synthetic-test',version:'v1',language:'ja-JP',mimeTypes:['audio/webm'],metrics:['accuracy','fluency']};
const request:AssessmentRequest={requestId:'r1',language:'ja-JP',referenceText:'合成',audio:new Blob(['synthetic bytes, not recorded audio'],{type:'audio/webm'}),durationMs:1000};
const consent={confirmed:true,requestId:'r1',providerId:'synthetic-test',policyVersion:'v1'};
const result={requestId:'r1',providerId:'synthetic-test',language:'ja-JP',source:'provider-assessment',metrics:[{name:'accuracy',value:3,min:0,max:5}]};
const deferred=()=>{let resolve!:(v:unknown)=>void;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
test('default session is unavailable and never dispatches without configured transport and policy',async()=>{
 let calls=0;for(const session of [new AssessmentSession('A'),new AssessmentSession('A',async()=>{calls++;return result;})]){assert.equal((await session.assess(request,consent)).status,'unavailable');}assert.equal(calls,0);
});
test('policy accepts only Japanese supported formats and implemented metric names',()=>{
 for(const p of [{...policy,language:'en-US'},{...policy,metrics:['prosody']},{...policy,mimeTypes:['text/plain']},{...policy,metrics:['accuracy','accuracy']},{...policy,key:'private'}])assert.throws(()=>validateAssessmentPolicy(p));
 assert.equal(validateAssessmentPolicy(policy).language,'ja-JP');
});
test('audio size duration language and extra-record fields are rejected before dispatch',async()=>{
 let calls=0;const s=new AssessmentSession('A',async()=>{calls++;return result;},policy);
 for(const r of [{...request,durationMs:30001},{...request,durationMs:NaN},{...request,durationMs:0},{...request,language:'ko-KR'},{...request,audio:new Blob([],{type:'audio/webm'})},{...request,audio:new Blob([new Uint8Array(5*1024*1024+1)],{type:'audio/webm'})},{...request,audio:new Blob(['x'],{type:'text/plain'})},{...request,referenceText:' '},{...request,referenceText:'x'.repeat(1001)},{...request,health:{}}])assert.equal((await s.assess(r,consent)).status,'error');
 assert.equal(calls,0);assert.equal(validateAssessmentRequest(request,policy).referenceText,'合成');
});
test('consent is explicit and bound to request and current provider policy',async()=>{
 let calls=0;const s=new AssessmentSession('A',async()=>{calls++;return result;},policy);
 for(const c of [undefined,{...consent,confirmed:false},{...consent,requestId:'old'},{...consent,providerId:'other'},{...consent,policyVersion:'old'}])assert.equal((await s.assess(request,c)).status,'error');assert.equal(calls,0);
});
test('valid result keeps provider scale and no account or extra records enter transport',async()=>{
 const s=new AssessmentSession('A',async r=>{assert.deepEqual(Object.keys(r).sort(),['requestId','language','referenceText','audio','durationMs'].sort());return result;},policy);
 const done=await s.assess(request,consent);assert.equal(done.status,'ready');assert.equal(done.result?.metrics[0].max,5);assert.equal(done.result?.metrics[0].value,3);assert.equal(Object.isFrozen(done.result?.metrics),true);
});
test('wrong attribution unsupported metrics duplicate metrics and bad numbers cannot become scores',()=>{
 for(const r of [{...result,requestId:'other'},{...result,providerId:'other'},{...result,source:'transcript'},{...result,language:'ko-KR'},{...result,metrics:[]},{...result,metrics:[{name:'prosody',value:1,min:0,max:5}]},{...result,metrics:[...result.metrics,...result.metrics]},{...result,metrics:[{name:'accuracy',value:6,min:0,max:5}]},{...result,metrics:[{name:'accuracy',value:NaN,min:0,max:5}]},{...result,metrics:[{name:'accuracy',value:0,min:0,max:0}]},{...result,recording:'private'}])assert.throws(()=>validateAssessmentResult(r,request,policy));
});
test('duplicate clicks and reused dispatched ID never redispatch',async()=>{
 const wait=deferred();let calls=0;const s=new AssessmentSession('A',()=>{calls++;return wait.promise;},policy);const first=s.assess(request,consent);assert.equal((await s.assess(request,consent)).status,'waiting');wait.resolve(result);await first;assert.equal((await s.assess(request,consent)).status,'error');assert.equal(calls,1);
});
test('cancel rejects late success without automatic retry or retained result',async()=>{
 const wait=deferred();let calls=0;let signal:AbortSignal|undefined;const s=new AssessmentSession('A',(_r,a)=>{calls++;signal=a;return wait.promise;},policy);
 const pending=s.assess(request,consent);s.cancel();assert.equal((await pending).status,'cancelled');assert.equal(signal?.aborted,true);wait.resolve(result);await new Promise(r=>setImmediate(r));assert.equal(s.snapshot().result,null);assert.equal(calls,1);
});
test('account switch clears result and old pending caller never receives new account result',async()=>{
 const wait=deferred();const s=new AssessmentSession('A',r=>r.requestId==='r1'?wait.promise:Promise.resolve({...result,requestId:'r2'}),policy);
 const old=s.assess(request,consent);s.setOwner('B');const fresh=await s.assess({...request,requestId:'r2'},{...consent,requestId:'r2'});assert.equal(fresh.status,'ready');const stale=await old;assert.equal(stale.result,null);wait.resolve(result);await new Promise(r=>setImmediate(r));assert.equal(s.snapshot().result?.requestId,'r2');s.setOwner(null);assert.equal(s.snapshot().result,null);
});
test('dispose prevents future requests and late result retention',async()=>{
 const wait=deferred();let calls=0;const s=new AssessmentSession('A',()=>{calls++;return wait.promise;},policy);const old=s.assess(request,consent);s.dispose();assert.equal((await old).result,null);wait.resolve(result);await s.assess(request,consent);assert.equal(calls,1);assert.equal(s.snapshot().result,null);
});
test('bounded wait aborts noncooperative transport and clears timer after early success',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let signal:AbortSignal|undefined;let calls=0;const s=new AssessmentSession('A',(_r,a)=>{calls++;signal=a;return new Promise(()=>{});},policy);const pending=s.assess(request,consent);t.mock.timers.tick(30000);assert.equal((await pending).status,'error');assert.equal(signal?.aborted,true);assert.equal(calls,1);
 let early:AbortSignal|undefined;const fast=new AssessmentSession('A',async(_r,a)=>{early=a;return result;},policy);await fast.assess(request,consent);t.mock.timers.tick(30000);assert.equal(early?.aborted,false);assert.equal(fast.snapshot().status,'ready');
});
test('malformed and failed responses give no score and expose no provider details',async()=>{
 for(const transport of [async()=>({source:'fake',score:100}),async()=>{throw Error('private provider diagnostic');}]){const s=new AssessmentSession('A',transport,policy);const state=await s.assess(request,consent);assert.equal(state.status,'error');assert.equal(state.result,null);assert.ok(!state.notice.includes('private'));}
});
test('local recorder remains unconnected to assessment and makes no upload or score claim',()=>{
 const source=readFileSync(new URL('./Recorder.tsx',import.meta.url),'utf8');assert.ok(source.includes('발음 평가 서비스는 아직 정하지 않았어요'));assert.ok(!source.includes('AssessmentSession'));assert.ok(!source.includes('fetch('));assert.ok(source.includes('내 녹음 듣기'));assert.ok(source.includes('지금은 점수를 매기지 않아요'));
});
