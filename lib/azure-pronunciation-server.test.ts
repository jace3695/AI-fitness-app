import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {createSpeechRetentionApiAssessmentRoute} from './speech-retention-api-route.ts';
import { getEventListeners } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { AZURE_ASSESSMENT_POLICY, createAzureAssessmentHandler, mapAzureAssessment, validateAssessmentWav, type AzureAssessmentDependencies } from './azure-pronunciation-server.ts';
import { ASSESSMENT_TRIAL } from '../app/language/practice/assessment-trial.ts';

const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
const env={AZURE_SPEECH_ASSESSMENT_TEST_OWNER_ID:A,AZURE_SPEECH_ASSESSMENT_DATA_POLICY_ID:'trial-metadata-policy-v1',AZURE_SPEECH_ASSESSMENT_ENABLED:'true',AZURE_SPEECH_KEY:'syntheticOnlyNotARealKey000',AZURE_SPEECH_REGION:'koreacentral',AZURE_SPEECH_RESOURCE_NAME:'synthetic-resource',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'agent/fitness-record-priority'};
function wav(ms=1000){const b=Buffer.alloc(44+ms*32);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
const envelope=()=>({requestId:'r1',language:'ja-JP',referenceText:'こんにちは。',audioMime:'audio/wav',audioBase64:wav().toString('base64'),consent:{confirmed:true,requestId:'r1',providerId:'azure-speech',policyVersion:AZURE_ASSESSMENT_POLICY}});
const response=()=>({RecognitionStatus:'Success',NBest:[{AccuracyScore:81,FluencyScore:72,ProsodyScore:99,PronScore:98,Display:'do not return transcript'}]});
const req=(body:unknown=envelope(),signal?:AbortSignal,origin='https://preview.example')=>new Request('https://preview.example/api/language/assessment',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body),signal});
const deferred=<T,>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return{promise,resolve};};
function setup(overrides:Partial<AzureAssessmentDependencies>={}){
 const seen=new Set<string>();const counts={auth:0,usage:0,requests:0};
 const baseUsage:NonNullable<AzureAssessmentDependencies['usage']>={durable:true,isReady:async()=>true,settle:async()=>true,consume:async input=>{counts.usage++;const key=input.owner+input.requestId;if(seen.has(key))return'duplicate';seen.add(key);return'accepted'}};
 const usage='usage'in overrides?(overrides.usage?{...baseUsage,...overrides.usage}:undefined):baseUsage;
 const deps:AzureAssessmentDependencies={env,authenticate:async()=>{counts.auth++;return A},request:async()=>{counts.requests++;return Response.json(response())},...overrides,usage};return{counts,deps,handle:createAzureAssessmentHandler(deps)};
}

test('live route remains blocked without reviewed API settings even when Azure activation envs exist',async()=>{
 let sideEffects=0;const source=readFileSync(new URL('../app/api/language/assessment/route.ts',import.meta.url),'utf8');const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;const modules:Record<string,unknown>={'@/lib/speech-retention-api-route':{createSpeechRetentionApiAssessmentRoute},'@/lib/supabase-server':{createServerSupabaseClient:()=>{sideEffects++;throw Error('auth forbidden')}}};const context={exports:{},Response,process:{env},fetch:()=>{sideEffects++;throw Error('network forbidden')},require:(name:string)=>{assert.ok(name in modules);return modules[name];}};vm.runInNewContext(compiled,context);const route=context.exports as{POST:(r:Request)=>Promise<Response>};assert.equal((await route.POST(req())).status,503);assert.equal(sideEffects,0);
});
test('default disabled, Production, wrong branch/region/missing key fail before auth, body or network',async()=>{
 for(const patch of [{AZURE_SPEECH_ASSESSMENT_ENABLED:undefined},{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'main'},{AZURE_SPEECH_REGION:'eastus'},{AZURE_SPEECH_KEY:undefined}]){const s=setup({env:{...env,...patch}});assert.equal((await s.handle(req())).status,503);assert.deepEqual(s.counts,{auth:0,usage:0,requests:0});}
});

test('trial requires configured owner/data-policy and rejects another owner, other reference or over-five-second audio before reservation',async()=>{
 for(const patch of [{AZURE_SPEECH_ASSESSMENT_TEST_OWNER_ID:undefined},{AZURE_SPEECH_ASSESSMENT_DATA_POLICY_ID:undefined},{AZURE_SPEECH_ASSESSMENT_TEST_OWNER_ID:'invalid'}]){const s=setup({env:{...env,...patch}});assert.equal((await s.handle(req())).status,503);assert.equal(s.counts.auth,0);}
 const other=setup({authenticate:async()=>B});assert.equal((await other.handle(req())).status,403);assert.equal(other.counts.usage,0);
 for(const body of [{...envelope(),referenceText:'おはよう。'},{...envelope(),audioBase64:wav(5001).toString('base64')}]){const s=setup();const response=await s.handle(req(body));assert.equal(response.status,422);assert.equal((await response.json()).code,'trial-only');assert.equal(s.counts.usage,0);assert.equal(s.counts.requests,0);}
 const exact=setup();assert.equal((await exact.handle(req({...envelope(),audioBase64:wav(5000).toString('base64')}))).status,200);
});
test('origin and missing authentication rejected without provider dispatch',async()=>{
 const s=setup();assert.equal((await s.handle(req(envelope(),undefined,'https://other.example'))).status,403);assert.equal(s.counts.auth,0);const no=setup({authenticate:async()=>null});assert.equal((await no.handle(req())).status,401);assert.equal(no.counts.requests,0);
});
test('consent binding, extras, language, text and unsupported audio fail before usage/network',async()=>{
 for(const body of [{...envelope(),user_id:'B'},{...envelope(),language:'en-US'},{...envelope(),referenceText:' '},{...envelope(),referenceText:'a'.repeat(1001)},{...envelope(),audioMime:'audio/webm'},{...envelope(),audioBase64:'not wav'},{...envelope(),consent:{...envelope().consent,confirmed:false}},{...envelope(),consent:{...envelope().consent,requestId:'old'}},{...envelope(),consent:{...envelope().consent,policyVersion:'old'}}]){const s=setup();assert.ok((await s.handle(req(body))).status>=400);assert.equal(s.counts.usage,0);assert.equal(s.counts.requests,0);}
});
test('canonical WAV bytes determine duration; compressed/stereo/rate/chunk/oversize/truncation rejected',()=>{
 assert.equal(validateAssessmentWav(wav(30000)),30000);for(const mutate of [(b:Buffer)=>{b.writeUInt16LE(3,20)},(b:Buffer)=>{b.writeUInt16LE(2,22)},(b:Buffer)=>{b.writeUInt32LE(48000,24)},(b:Buffer)=>{b.write('JUNK',36)},(b:Buffer)=>{b.writeUInt32LE(999999,40)}]){const b=wav();mutate(b);assert.throws(()=>validateAssessmentWav(b));}assert.throws(()=>validateAssessmentWav(wav(30001)));assert.throws(()=>validateAssessmentWav(wav().subarray(0,43)));
});
test('format and size failures name the accepted WAV format and actual trial cap, not the generic decoder ceiling',async()=>{
 const malformed=wav();malformed.writeUInt16LE(3,20);
 for(const audio of [malformed,wav(30001),wav().subarray(0,43)]){
  const s=setup();const r=await s.handle(req({...envelope(),audioBase64:audio.toString('base64')}));
  assert.equal(r.status,422);const body=await r.json();assert.equal(body.code,'audio-format');
  assert.match(body.error,/형식이나 크기/);assert.match(body.error,/PCM16·모노·16kHz WAV/);
  assert.ok(body.error.includes(`${ASSESSMENT_TRIAL.maxDurationMs/1000}초 이내`));
  assert.match(body.error,/Microsoft 발음 평가 서비스로는 보내지 않았어요/);
  assert.doesNotMatch(body.error,/(?:녹음|다른 음성)을 보내지 않았어요/);
  assert.doesNotMatch(body.error,/30초|시험 한도 복구/);
  assert.deepEqual(s.counts,{auth:1,usage:0,requests:0});
 }
});
test('trial eligibility remains separate from WAV shape and uses the same exact five-second boundary as the client',async()=>{
 assert.equal(validateAssessmentWav(wav(30000)),30000); // General WAV support is not trial permission.
 const exact=setup();assert.equal((await exact.handle(req({...envelope(),referenceText:ASSESSMENT_TRIAL.referenceText,audioBase64:wav(ASSESSMENT_TRIAL.maxDurationMs).toString('base64')}))).status,200);
 for(const body of [
  {...envelope(),audioBase64:wav(ASSESSMENT_TRIAL.maxDurationMs+1/16).toString('base64')},
  {...envelope(),audioBase64:wav(30000).toString('base64')},
  {...envelope(),referenceText:'おはよう。'},
 ]){
  const s=setup();const r=await s.handle(req(body));assert.equal(r.status,422);const result=await r.json();
  assert.equal(result.code,'trial-only');assert.ok(result.error.includes(ASSESSMENT_TRIAL.referenceText));
  assert.ok(result.error.includes(`${ASSESSMENT_TRIAL.maxDurationMs/1000}초 이내`));
  assert.match(result.error,/Microsoft 발음 평가 서비스로는 보내지 않았어요/);
  assert.doesNotMatch(result.error,/(?:녹음|다른 음성)을 보내지 않았어요/);
  assert.doesNotMatch(result.error,/30초|형식이나 크기/);assert.equal(s.counts.usage,0);assert.equal(s.counts.requests,0);
 }
});
test('bounded chunked body prevents huge allocation/usage even without Content-Length',async()=>{
 const s=setup();const r=new Request('https://preview.example/api/language/assessment',{method:'POST',headers:{origin:'https://preview.example','content-type':'application/json'},body:'x'.repeat(1400000)});assert.equal((await s.handle(r)).status,413);assert.equal(s.counts.usage,0);assert.equal(s.counts.requests,0);
});
test('mock provider gets pinned endpoint/PCM/ja-JP/no prosody; returns only two real response metrics',async()=>{
 const s=setup({request:async(url,init)=>{assert.equal(new URL(String(url)).hostname,'synthetic-resource.cognitiveservices.azure.com');assert.equal(new URL(String(url)).searchParams.get('language'),'ja-JP');assert.equal(init?.redirect,'error');const h=new Headers(init?.headers);assert.equal(h.get('Ocp-Apim-Subscription-Key'),env.AZURE_SPEECH_KEY);const config=JSON.parse(Buffer.from(h.get('Pronunciation-Assessment')!,'base64').toString());assert.equal(config.EnableProsodyAssessment,false);assert.equal(config.Dimension,'Comprehensive');assert.deepEqual(Object.keys(config).sort(),['Dimension','EnableProsodyAssessment','GradingSystem','Granularity','ReferenceText']);return Response.json(response())}});const r=await s.handle(req());assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');const body=await r.json();assert.deepEqual(body.metrics.map((x:{name:string})=>x.name),['accuracy','fluency']);assert.ok(!JSON.stringify(body).includes('do not return'));assert.ok(!JSON.stringify(body).includes('99'));
});
test('atomic mock reservation blocks simultaneous duplicates and quota before provider; no refunds/retries',async()=>{
 const s=setup();const results=await Promise.all([s.handle(req()),s.handle(req())]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(s.counts.requests,1);const no=setup({usage:{durable:true,consume:async()=> 'limit'}});assert.equal((await no.handle(req())).status,409);assert.equal(no.counts.requests,0);
});
test('authentication changes after reservation prevent Azure request; no new account data returned',async()=>{
 let count=0;const s=setup({authenticate:async()=>++count===1?A:B});const r=await s.handle(req());assert.equal(r.status,401);assert.equal(s.counts.requests,0);assert.ok(!JSON.stringify(await r.json()).includes('synthetic reference'));
});
test('cancel during authentication or usage prevents late dispatch despite noncooperative dependencies',async()=>{
 for(const stage of ['auth','usage']){const wait=deferred<never>();const s=setup(stage==='auth'?{authenticate:()=>wait.promise}:{usage:{durable:true,consume:()=>wait.promise}});const ctrl=new AbortController();const pending=s.handle(req(envelope(),ctrl.signal));await new Promise(r=>setImmediate(r));ctrl.abort();assert.equal((await pending).status,504);wait.resolve((stage==='auth'?A:'accepted') as never);await new Promise(r=>setImmediate(r));assert.equal(s.counts.requests,0);}
});
test('30s total covers auth/provider/response body, signal propagates and late scores never escape',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const stage of ['auth','fetch','body']){const wait=deferred<never>();let signal:AbortSignal|undefined;let closed=false;const s=setup(stage==='auth'?{authenticate:s=>{signal=s;return wait.promise}}:{request:async(_u,init)=>{signal=init?.signal as AbortSignal;return stage==='fetch'?wait.promise:new Response(new ReadableStream({start(){},cancel(){closed=true}}))}});const pending=s.handle(req());await new Promise(r=>setImmediate(r));t.mock.timers.tick(30000);const r=await pending;assert.equal(r.status,504);assert.equal(signal?.aborted,true);assert.ok(!JSON.stringify(await r.json()).includes('metrics'));if(stage==='body')assert.equal(closed,true);}
});
test('no-match, malformed/missing/nonfinite scores and HTTP errors give no fabricated result or diagnostics',async()=>{
 for(const value of [{RecognitionStatus:'NoMatch'},{...response(),NBest:[{AccuracyScore:90}]},{...response(),NBest:[{AccuracyScore:200,FluencyScore:20}]},{...response(),NBest:[{AccuracyScore:'90',FluencyScore:20}]}]){assert.throws(()=>mapAzureAssessment(value,'r1'));const s=setup({request:async()=>Response.json(value)});const r=await s.handle(req());assert.equal(r.status,422);assert.ok(!JSON.stringify(await r.json()).includes('metrics'));}
 let sends=0;const s=setup({request:async()=>{sends++;return new Response('private diagnostic with secret',{status:429})}});const r=await s.handle(req());assert.equal(r.status,503);assert.ok(!JSON.stringify(await r.json()).includes('private'));assert.equal(s.counts.usage,1);assert.equal((await s.handle(req())).status,409);assert.equal(sends,1);
});
test('early success removes incoming abort listener and pending timer cannot change returned result',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const ctrl=new AbortController();const request=req(envelope(),ctrl.signal);const before=getEventListeners(request.signal,'abort').length;const s=setup();const r=await s.handle(request);assert.equal(r.status,200);assert.equal(getEventListeners(request.signal,'abort').length,before);t.mock.timers.tick(60000);ctrl.abort();assert.equal((await r.json()).metrics.length,2);
});
test('GET readiness has no audio/reservation/provider side effect and missing lease lifecycle stays unavailable',async()=>{
 const s=setup();const r=await s.handle(new Request('https://preview.example/api/language/assessment',{headers:{origin:'https://preview.example'}}));assert.equal(r.status,200);assert.equal((await r.json()).available,true);assert.equal(s.counts.usage,0);assert.equal(s.counts.requests,0);
 const raw=createAzureAssessmentHandler({...s.deps,usage:{durable:true,consume:async()=> 'accepted'}});assert.equal((await raw(req())).status,503);
});
test('confirmed response settles once; failed cleanup or uncertain dispatched request never auto releases/retries',async()=>{
 let settles=0;const s=setup({usage:{durable:true,consume:async()=> 'accepted',settle:async()=>{settles++;return false}}});const r=await s.handle(req());assert.equal(r.status,503);assert.equal((await r.json()).code,'usage-pending');assert.equal(settles,1);
 const uncertain=setup({usage:{durable:true,consume:async()=> 'accepted',settle:async()=>{settles++;return true}},request:async()=>{throw Error('network unknown')}});assert.equal((await uncertain.handle(req())).status,503);assert.equal(settles,1);
});
