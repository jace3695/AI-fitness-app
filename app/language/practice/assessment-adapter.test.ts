import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssessmentAdapter, type AssessmentDriver, type DecodedAssessmentAudio } from './assessment-adapter.ts';
import { AssessmentSession, type AssessmentRequest, type AssessmentPolicy } from './assessment.ts';

const policy: AssessmentPolicy = { providerId: 'fixture-only', version: 'v1', language: 'ja-JP', mimeTypes: ['audio/wav'], metrics: ['accuracy', 'fluency'] };
const request: AssessmentRequest = { requestId: 'one', language: 'ja-JP', referenceText: 'synthetic reference', audio: new Blob(['fixture, not microphone audio'], {type:'audio/wav'}), durationMs: 1000 };
const consent = {confirmed:true,requestId:'one',providerId:policy.providerId,policyVersion:policy.version};
const pcm = (): DecodedAssessmentAudio => ({samples:new Float32Array(16000).fill(.1),sampleRate:16000,channels:1});
const result = () => ({requestId:'one',providerId:policy.providerId,language:'ja-JP',source:'provider-assessment',metrics:[{name:'accuracy',value:70,min:0,max:100},{name:'fluency',value:60,min:0,max:100}]});
const deferred = <T,>() => { let resolve!: (v:T)=>void; const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve}; };

test('configured seam carries only reference and decoded Japanese audio; preserves both metric scales',async()=>{
 let calls=0;
 const transport=createAssessmentAdapter({policy,decode:async()=>pcm(),evaluate:async(input,signal)=>{calls++;assert.deepEqual(Object.keys(input).sort(),['audio','language','referenceText']);assert.equal(input.language,'ja-JP');assert.equal(signal.aborted,false);return result();}});
 const state=await new AssessmentSession('A',transport,policy).assess(request,consent);
 assert.equal(state.status,'ready');assert.deepEqual(state.result?.metrics.map(x=>x.name),['accuracy','fluency']);assert.equal(calls,1);
});
test('no consent means no decode or evaluation, and duplicate clicks never duplicate dispatch',async()=>{
 let decode=0,calls=0;const wait=deferred<unknown>();const transport=createAssessmentAdapter({policy,decode:async()=>{decode++;return pcm();},evaluate:async()=>{calls++;return wait.promise;}});
 const session=new AssessmentSession('A',transport,policy);await session.assess(request,{...consent,confirmed:false});assert.equal(decode,0);
 const pending=session.assess(request,consent);await Promise.resolve();await session.assess(request,consent);assert.equal(calls,1);wait.resolve(result());await pending;assert.equal(calls,1);
});
test('unsupported prosody policy, incomplete results and fabricated extra metrics never become scores',async()=>{
 assert.throws(()=>createAssessmentAdapter({policy:{...policy,metrics:['prosody']} as unknown as AssessmentPolicy,decode:async()=>pcm(),evaluate:async()=>result()}));
 for(const raw of [{...result(),metrics:[result().metrics[0]]},{...result(),metrics:[...result().metrics,{name:'prosody',value:100,min:0,max:100}]}]){
  const transport=createAssessmentAdapter({policy,decode:async()=>pcm(),evaluate:async()=>raw});const state=await new AssessmentSession('A',transport,policy).assess(request,consent);assert.equal(state.status,'error');assert.equal(state.result,null);
 }
});
test('decoded duration, sample format and amplitude checked independently from Blob metadata',async()=>{
 for(const audio of [{...pcm(),samples:new Float32Array(16000*31)},{...pcm(),samples:new Float32Array([])},{...pcm(),sampleRate:0},{...pcm(),channels:2},{...pcm(),samples:new Float32Array([NaN])},{...pcm(),samples:new Float32Array([2])}]){
  let calls=0;const transport=createAssessmentAdapter({policy,decode:async()=>audio as DecodedAssessmentAudio,evaluate:async()=>{calls++;return result();}});const state=await new AssessmentSession('A',transport,policy).assess(request,consent);assert.equal(state.status,'error');assert.equal(calls,0);
 }
});
test('cancel, dispose and A-B-A during decoder wait prevent evaluation even when decoder ignores abort',async()=>{
 for(const boundary of ['cancel','dispose','account']){
  const wait=deferred<DecodedAssessmentAudio>();let calls=0;const transport=createAssessmentAdapter({policy,decode:()=>wait.promise,evaluate:async()=>{calls++;return result();}});const session=new AssessmentSession('A',transport,policy);const pending=session.assess(request,consent);
  if(boundary==='cancel')session.cancel();else if(boundary==='dispose')session.dispose();else {session.setOwner('B');session.setOwner('A');}
  assert.equal((await pending).result,null);wait.resolve(pcm());await new Promise(r=>setImmediate(r));assert.equal(calls,0);assert.equal(session.snapshot().result,null);
 }
});
test('timeout forwards abort across decoder and provider; late result stays absent',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const stage of ['decode','evaluate']){
  let observed:AbortSignal|undefined;const wait=deferred<unknown>();const driver:AssessmentDriver={policy,decode:async(_blob,signal)=>{observed=signal;return stage==='decode'?await wait.promise as DecodedAssessmentAudio:pcm();},evaluate:async(_input,signal)=>{observed=signal;return wait.promise;}};
  const session=new AssessmentSession('A',createAssessmentAdapter(driver),policy);const pending=session.assess(request,consent);await Promise.resolve();t.mock.timers.tick(30000);assert.equal((await pending).status,'error');assert.equal(observed?.aborted,true);wait.resolve(stage==='decode'?pcm():result());await new Promise(r=>setImmediate(r));assert.equal(session.snapshot().result,null);
 }
});
test('decoder or provider errors expose no internal details and never retry automatically',async()=>{
 for(const stage of ['decode','evaluate']){let calls=0;const transport=createAssessmentAdapter({policy,decode:async()=>{if(stage==='decode')throw Error('private');return pcm();},evaluate:async()=>{calls++;throw Error('private');}});const state=await new AssessmentSession('A',transport,policy).assess(request,consent);assert.equal(state.status,'error');assert.equal(state.result,null);assert.ok(!state.notice.includes('private'));assert.equal(calls,stage==='decode'?0:1);}
});
