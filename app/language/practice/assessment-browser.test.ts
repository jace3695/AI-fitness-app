import test from 'node:test';
import assert from 'node:assert/strict';
import {AssessmentBrowserClient,type AssessmentHttp} from './assessment-browser.ts';
import {encodeAssessmentWav} from './assessment-audio.ts';
import {createAzureAssessmentHandler,AZURE_ASSESSMENT_POLICY,type AssessmentUsageLedger} from '../../../lib/azure-pronunciation-server.ts';
const signal=()=>new AbortController().signal;
const readiness=()=>Response.json({available:true,providerId:'azure-speech',policyVersion:AZURE_ASSESSMENT_POLICY,region:'koreacentral'});
const wav=()=>encodeAssessmentWav({duration:.01,sampleRate:16000,length:160,numberOfChannels:1,getChannelData:()=>new Float32Array(160)},signal());
const deferred=<T,>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return{promise,resolve};};
test('client defaults unavailable, verifies exact server readiness and never dispatches without explicit consent',async()=>{
 let calls=0;const c=new AssessmentBrowserClient('A',async()=>{calls++;return readiness()});await assert.rejects(c.assess(await wav(),'text','r1',true,signal()));assert.equal(calls,0);assert.equal(await c.check(signal()),true);await assert.rejects(c.assess(await wav(),'text','r1',false,signal()));assert.equal(calls,1);
 for(const value of [{available:true},{available:true,providerId:'other',policyVersion:AZURE_ASSESSMENT_POLICY,region:'koreacentral'},{available:true,providerId:'azure-speech',policyVersion:'old',region:'koreacentral'}]){const bad=new AssessmentBrowserClient('A',async()=>Response.json(value));assert.equal(await bad.check(signal()),false);}
});
test('actual browser client -> actual server handler -> mock ledger/provider returns only validated scores once',async()=>{
 let provider=0,release=0,held=false;const used=new Set<string>();const usage:AssessmentUsageLedger={durable:true,isReady:async()=>!held,settle:async()=>{release++;held=false;return true},consume:async input=>{if(used.has(input.requestId))return'duplicate';if(held)return'busy';used.add(input.requestId);held=true;return'accepted'}};
 const handler=createAzureAssessmentHandler({env:{AZURE_SPEECH_ASSESSMENT_TEST_OWNER_ID:'00000000-0000-4000-8000-000000000001',AZURE_SPEECH_ASSESSMENT_DATA_POLICY_ID:'trial-metadata-policy-v1',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'agent/fitness-record-priority',AZURE_SPEECH_ASSESSMENT_ENABLED:'true',AZURE_SPEECH_KEY:'syntheticOnlyKey000000',AZURE_SPEECH_REGION:'koreacentral',AZURE_SPEECH_RESOURCE_NAME:'synthetic-resource'},authenticate:async()=> '00000000-0000-4000-8000-000000000001',usage,request:async()=>{provider++;return Response.json({RecognitionStatus:'Success',NBest:[{AccuracyScore:80,FluencyScore:70,ProsodyScore:100}]})}});
 const http:AssessmentHttp=(path,init,owner,s)=>{assert.equal(owner,'A');const headers=new Headers(init.headers);headers.set('origin','https://fixture.example');return handler(new Request('https://fixture.example'+path,{...init,headers,signal:s}))};
 const c=new AssessmentBrowserClient('A',http);assert.equal(await c.check(signal()),true);const audio=await wav();const result=await c.assess(audio,'こんにちは。','r1',true,signal());assert.deepEqual(result.metrics.map(m=>m.name),['accuracy','fluency']);assert.equal(provider,1);assert.equal(release,1);await assert.rejects(c.assess(audio,'synthetic','r1',true,signal()));assert.equal(provider,1);
});
test('cancel/dispose during readiness or authorization wait rejects late success and never starts POST',async()=>{
 for(const boundary of ['cancel','dispose']){const wait=deferred<Response>();let posts=0;const c=new AssessmentBrowserClient('A',async(_p,init)=>{if(init.method==='POST')posts++;return wait.promise});const pending=c.check(signal());if(boundary==='cancel')c.cancel();else c.dispose();await assert.rejects(pending);wait.resolve(readiness());await new Promise(r=>setImmediate(r));await assert.rejects(c.assess(await wav(),'text','r1',true,signal()));assert.equal(posts,0);}
});
test('client total budget bounds noncooperative HTTP/auth and rejects late score body without retry',async t=>{
 const audio=await wav();t.mock.timers.enable({apis:['setTimeout']});let calls=0;const c=new AssessmentBrowserClient('A',async()=>{calls++;return new Promise(()=>{})});const pending=c.check(signal());t.mock.timers.tick(30000);await assert.rejects(pending);assert.equal(calls,1);
 // A new client must pass its own readiness; no stale shared readiness survives.
 const fresh=new AssessmentBrowserClient('B',async()=>readiness());await assert.rejects(fresh.assess(audio,'text','r1',true,signal()));
});
test('server unavailability, malformed results and failed responses never fabricate a score or auto-repeat',async()=>{
 for(const response of [()=>Response.json({error:'private'},{status:503}),()=>Response.json({requestId:'r1',providerId:'azure-speech',language:'ja-JP',source:'provider-assessment',metrics:[{name:'prosody',value:100,min:0,max:100}]})]){let posts=0;const c=new AssessmentBrowserClient('A',async(_p,init)=>init.method==='GET'?readiness():(posts++,response()));await c.check(signal());await assert.rejects(c.assess(await wav(),'text','r1',true,signal()));await assert.rejects(c.assess(await wav(),'text','r1',true,signal()));assert.equal(posts,1);}
});
