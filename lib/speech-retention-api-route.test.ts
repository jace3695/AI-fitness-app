import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {readSpeechRetentionApiConfig,createSpeechRetentionApiAssessmentRoute} from './speech-retention-api-route.ts';
const syntheticPolicy={metadataRetentionSeconds:120,authorizationExpiresAt:Math.floor(Date.now()/1000)+3600,reviewArtifactSHA256:'b'.repeat(64),cleanupIntervalSeconds:60,cleanupStartDelaySeconds:10,cleanupRunTimeoutSeconds:5};
const env={YEONI_SPEECH_RETENTION_POLICY_JSON:JSON.stringify(syntheticPolicy),NEXT_PUBLIC_SUPABASE_URL:'https://piqqukiiacncfbztktga.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_not_real',YEONI_SPEECH_API_BOUNDARY_REVIEWED:'trial-retention-api-boundary-v2',YEONI_SPEECH_API_SCHEMA:'yeoni_speech_retention_candidate',YEONI_SPEECH_PROOF_KEY_ID:'synthetic',YEONI_SPEECH_PROOF_KEY_BASE64:Buffer.alloc(32,7).toString('base64')};
test('route config accepts only exact reviewed API schema/project, public API key and canonical server proof secret',()=>{
 const c=readSpeechRetentionApiConfig(env);assert.equal(c.key.length,32);c.key.fill(0);
 for(const name of Object.keys(env))assert.throws(()=>readSpeechRetentionApiConfig({...env,[name]:undefined}),/unavailable/);
 for(const patch of [{NEXT_PUBLIC_SUPABASE_URL:'https://other.supabase.co'},{YEONI_SPEECH_API_SCHEMA:'public'},{NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_secret_synthetic'},{YEONI_SPEECH_PROOF_KEY_BASE64:Buffer.alloc(31).toString('base64')},{YEONI_SPEECH_PROOF_KEY_BASE64:env.YEONI_SPEECH_PROOF_KEY_BASE64+'\n'},{NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'x.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.x'}])assert.throws(()=>readSpeechRetentionApiConfig({...env,...patch}),/unavailable/);
});
test('missing actual settings returns unavailable without creating an auth client, SQL, provider or leaking credentials',async()=>{
 let created=0,network=0;const route=createSpeechRetentionApiAssessmentRoute({env:{},createClient:async()=>{created++;throw Error('must not run');},request:async()=>{network++;throw Error('must not run');}});
 const response=await route(new Request('https://fixture.example/api/language/assessment'));assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(created,0);assert.equal(network,0);assert.equal((await response.text()).includes('key'),false);
});
test('v1 boundary/schema or null, incomplete and expired retention policy cannot enable the v2 route',async()=>{
 let calls=0;
 for(const patch of [
  {YEONI_SPEECH_API_BOUNDARY_REVIEWED:'trial-api-boundary-v1'},
  {YEONI_SPEECH_API_SCHEMA:'yeoni_speech_proof_candidate'},
  {YEONI_SPEECH_RETENTION_POLICY_JSON:'null'},
  {YEONI_SPEECH_RETENTION_POLICY_JSON:JSON.stringify({...syntheticPolicy,cleanupIntervalSeconds:null})},
  {YEONI_SPEECH_RETENTION_POLICY_JSON:JSON.stringify({...syntheticPolicy,authorizationExpiresAt:0})},
 ]){
  const route=createSpeechRetentionApiAssessmentRoute({env:{...env,...patch},createClient:async()=>{calls++;throw Error('must not create client');},request:async()=>{calls++;throw Error('must not call provider');}});
  assert.equal((await route(new Request('https://fixture.example/api/language/assessment'))).status,503);
 }
 assert.equal(calls,0);
});
test('v2 source route retains exact preview branch, activation, owner/policy and region guard before auth or RPC',async()=>{
 let calls=0;
 const active={...env,AZURE_SPEECH_ASSESSMENT_ENABLED:'true',AZURE_SPEECH_ASSESSMENT_TEST_OWNER_ID:'00000000-0000-4000-8000-000000000001',AZURE_SPEECH_ASSESSMENT_DATA_POLICY_ID:'trial-retention-policy-v2',AZURE_SPEECH_KEY:'syntheticKeyNotReal000',AZURE_SPEECH_REGION:'koreacentral',AZURE_SPEECH_RESOURCE_NAME:'yeoni-speech-jace',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'agent/fitness-record-priority'};
 for(const patch of [{AZURE_SPEECH_ASSESSMENT_ENABLED:undefined},{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'main'},{VERCEL_GIT_COMMIT_REF:'agent/yeoni-cloud-browser-qa-20261027'},{AZURE_SPEECH_REGION:'eastus'},{AZURE_SPEECH_ASSESSMENT_TEST_OWNER_ID:undefined},{AZURE_SPEECH_ASSESSMENT_DATA_POLICY_ID:'trial-metadata-policy-v1'}]){
  const route=createSpeechRetentionApiAssessmentRoute({env:{...active,...patch},createClient:async()=>{calls++;throw Error('must not authenticate');},request:async()=>{calls++;throw Error('must not call provider');}});
  assert.equal((await route(new Request('https://fixture.example/api/language/assessment',{headers:{origin:'https://fixture.example'}}))).status,503);
 }
 assert.equal(calls,0);
});
test('route client creation and auth are inside total timeout; late completion starts no RPC or provider',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 for(const stage of ['client','auth']){
  let release!:()=>void,auth=0,rpc=0,provider=0;const held=new Promise<void>(r=>release=r);
  const route=createSpeechRetentionApiAssessmentRoute({env:{...env,AZURE_SPEECH_ASSESSMENT_ENABLED:'true',AZURE_SPEECH_ASSESSMENT_TEST_OWNER_ID:'00000000-0000-4000-8000-000000000001',AZURE_SPEECH_ASSESSMENT_DATA_POLICY_ID:'trial-retention-policy-v2',AZURE_SPEECH_KEY:'syntheticKeyNotReal000',AZURE_SPEECH_REGION:'koreacentral',AZURE_SPEECH_RESOURCE_NAME:'yeoni-speech-jace',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'agent/fitness-record-priority'},createClient:async()=>{if(stage==='client')await held;return{schema:()=>({rpc:()=>{rpc++;throw Error('must not run');}}),auth:{getUser:async()=>{auth++;if(stage==='auth')await held;return{data:{user:{id:'00000000-0000-4000-8000-000000000001'}},error:null};}}};},request:async()=>{provider++;throw Error('must not run');}});
  const pending=route(new Request('https://fixture.example/api/language/assessment',{headers:{origin:'https://fixture.example'}}));await new Promise<void>(r=>setImmediate(r));t.mock.timers.tick(30000);assert.equal((await pending).status,504);release();await new Promise<void>(r=>setImmediate(r));assert.equal(auth,stage==='client'?0:1);assert.equal(rpc,0);assert.equal(provider,0);
 }
});
