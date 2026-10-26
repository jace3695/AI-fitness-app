import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {readSpeechApiConfig,createSpeechApiAssessmentRoute} from './speech-api-route.ts';
const env={NEXT_PUBLIC_SUPABASE_URL:'https://piqqukiiacncfbztktga.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_not_real',YEONI_SPEECH_API_BOUNDARY_REVIEWED:'trial-api-boundary-v1',YEONI_SPEECH_API_SCHEMA:'yeoni_speech_proof_candidate',YEONI_SPEECH_PROOF_KEY_ID:'synthetic',YEONI_SPEECH_PROOF_KEY_BASE64:Buffer.alloc(32,7).toString('base64')};
test('route config accepts only exact reviewed API schema/project, public API key and canonical server proof secret',()=>{
 const c=readSpeechApiConfig(env);assert.equal(c.key.length,32);c.key.fill(0);
 for(const name of Object.keys(env))assert.throws(()=>readSpeechApiConfig({...env,[name]:undefined}),/unavailable/);
 for(const patch of [{NEXT_PUBLIC_SUPABASE_URL:'https://other.supabase.co'},{YEONI_SPEECH_API_SCHEMA:'public'},{NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_secret_synthetic'},{YEONI_SPEECH_PROOF_KEY_BASE64:Buffer.alloc(31).toString('base64')},{YEONI_SPEECH_PROOF_KEY_BASE64:env.YEONI_SPEECH_PROOF_KEY_BASE64+'\n'},{NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'x.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.x'}])assert.throws(()=>readSpeechApiConfig({...env,...patch}),/unavailable/);
});
test('missing actual settings returns unavailable without creating an auth client, SQL, provider or leaking credentials',async()=>{
 let created=0,network=0;const route=createSpeechApiAssessmentRoute({env:{},createClient:async()=>{created++;throw Error('must not run');},request:async()=>{network++;throw Error('must not run');}});
 const response=await route(new Request('https://fixture.example/api/language/assessment'));assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(created,0);assert.equal(network,0);assert.equal((await response.text()).includes('key'),false);
});
test('route client creation and auth are inside total timeout; late completion starts no RPC or provider',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const stage of ['client','auth']){
  let release!:()=>void,auth=0,rpc=0,provider=0;const held=new Promise<void>(r=>release=r);
  const route=createSpeechApiAssessmentRoute({env:{...env,AZURE_SPEECH_ASSESSMENT_ENABLED:'true',AZURE_SPEECH_ASSESSMENT_TEST_OWNER_ID:'00000000-0000-4000-8000-000000000001',AZURE_SPEECH_ASSESSMENT_DATA_POLICY_ID:'trial-metadata-policy-v1',AZURE_SPEECH_KEY:'syntheticKeyNotReal000',AZURE_SPEECH_REGION:'koreacentral',AZURE_SPEECH_RESOURCE_NAME:'yeoni-speech-jace',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'agent/fitness-record-priority'},createClient:async()=>{if(stage==='client')await held;return{schema:()=>({rpc:()=>{rpc++;throw Error('must not run');}}),auth:{getUser:async()=>{auth++;if(stage==='auth')await held;return{data:{user:{id:'00000000-0000-4000-8000-000000000001'}},error:null};}}};},request:async()=>{provider++;throw Error('must not run');}});
  const pending=route(new Request('https://fixture.example/api/language/assessment',{headers:{origin:'https://fixture.example'}}));await new Promise<void>(r=>setImmediate(r));t.mock.timers.tick(30000);assert.equal((await pending).status,504);release();await new Promise<void>(r=>setImmediate(r));assert.equal(auth,stage==='client'?0:1);assert.equal(rpc,0);assert.equal(provider,0);
 }
});
