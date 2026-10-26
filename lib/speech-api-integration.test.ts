import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Buffer} from 'node:buffer';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {createSpeechApiUsageLedger} from './speech-api-usage.ts';
import {createAzureAssessmentHandler,AZURE_ASSESSMENT_POLICY} from './azure-pronunciation-server.ts';
import {createSpeechApiAssessmentRoute} from './speech-api-route.ts';
import vm from 'node:vm';
import ts from 'typescript';

const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002',R='00000000-0000-4000-8000-000000000003',S='00000000-0000-4000-8000-000000000004';
// Deliberately synthetic fixtures, never loaded from environment or credentials.
const key=new Uint8Array(32).fill(7);
function wav(ms:number){const b=Buffer.alloc(44+ms*32);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
function post(id=R,ms=5000,signal?:AbortSignal,consent=true){return new Request('https://fixture.example/api/language/assessment',{method:'POST',headers:{origin:'https://fixture.example','content-type':'application/json'},signal,body:JSON.stringify({requestId:id,language:'ja-JP',referenceText:'こんにちは。',audioMime:'audio/wav',audioBase64:wav(ms).toString('base64'),consent:{confirmed:consent,requestId:id,providerId:'azure-speech',policyVersion:AZURE_ASSESSMENT_POLICY}})});}
const score=()=>Response.json({RecognitionStatus:'Success',NBest:[{AccuracyScore:80,FluencyScore:70}]});
async function fixture(){
 const db=new PGlite({extensions:{pgcrypto}});let calls=0,provider=0,owner=A,authCalls=0;
 const behavior={loseConsume:false,loseFinish:false,boundaryReviewed:true,afterConsume:undefined as undefined|(()=>void),authenticate:undefined as undefined|((count:number)=>string)};
 await db.exec(`create schema extensions;create extension pgcrypto with schema extensions;create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.owner',true),'')::uuid$$;insert into auth.users values('${A}'),('${B}');create schema vault;create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text);`);
 await db.exec(readFileSync(new URL('../docs/azure-pronunciation-usage/api-proof-contract-draft.sql',import.meta.url),'utf8'));
 await db.query('insert into vault.decrypted_secrets values($1,$2)',[R,Buffer.from(key).toString('base64')]);await db.query('insert into yeoni_speech_proof_candidate.keys values($1,$2,true)',['synthetic',R]);
 await db.query("update yeoni_speech_proof_candidate.policy set enabled=true,allowed_owner=$1,active_key_id='synthetic',policy_id='trial-metadata-policy-v1',api_boundary_reviewed_at=now()",[A]);
 const client=(uid:string)=>({schema:(schema:string)=>({rpc:(action:string,args:Record<string,string|number>)=>{
  assert.equal(schema,'yeoni_speech_proof_candidate');assert.ok(['ready','consume','finish'].includes(action));
  let signal:AbortSignal;
  const run=async()=>{
   signal.throwIfAborted();calls++;
   const result=await db.transaction(async tx=>{
    await tx.query("select set_config('test.owner',$1,true)",[uid]);await tx.exec('set local role authenticated');
    const names=Object.keys(args);assert.ok(names.every(n=>/^p_[a-z_]+$/.test(n)));
    return(await tx.query<{r:unknown}>(`select ${schema}.${action}(${names.map((n,i)=>n+'=> $'+(i+1)).join(',')}) r`,Object.values(args))).rows[0].r;
   });
   if(action==='consume'){behavior.afterConsume?.();if(behavior.loseConsume)throw Error('synthetic committed response lost');}
   if(action==='finish'&&behavior.loseFinish)throw Error('synthetic finish response lost');
   return{data:result,error:null};
  };
  const q={abortSignal:(s:AbortSignal)=>{signal=s;return q;},then:<TResult1={data:unknown;error:null},TResult2=never>(resolve?:((value:{data:unknown;error:null})=>TResult1|PromiseLike<TResult1>)|null,reject?:((reason:unknown)=>TResult2|PromiseLike<TResult2>)|null)=>run().then(resolve,reject)};return q;
 }})});
 const env={AZURE_SPEECH_ASSESSMENT_TEST_OWNER_ID:A,AZURE_SPEECH_ASSESSMENT_DATA_POLICY_ID:'trial-metadata-policy-v1',AZURE_SPEECH_ASSESSMENT_ENABLED:'true',AZURE_SPEECH_KEY:'syntheticKeyNotReal000',AZURE_SPEECH_REGION:'koreacentral',AZURE_SPEECH_RESOURCE_NAME:'yeoni-speech-jace',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'agent/fitness-record-priority'};
 const handle=(request:typeof fetch=async()=>score())=>createAzureAssessmentHandler({env,authenticate:async()=>behavior.authenticate?behavior.authenticate(++authCalls):owner,usageForOwner:uid=>createSpeechApiUsageLedger(uid,client(uid),{keyId:'synthetic',key,boundaryReviewed:behavior.boundaryReviewed}),request:async(...args)=>{provider++;return request(...args);}});
 const route=(providerRequest:typeof fetch=async()=>score())=>{
  const routeEnv={...env,NEXT_PUBLIC_SUPABASE_URL:'https://piqqukiiacncfbztktga.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_not_real',YEONI_SPEECH_API_BOUNDARY_REVIEWED:behavior.boundaryReviewed?'trial-api-boundary-v1':'',YEONI_SPEECH_API_SCHEMA:'yeoni_speech_proof_candidate',YEONI_SPEECH_PROOF_KEY_ID:'synthetic',YEONI_SPEECH_PROOF_KEY_BASE64:Buffer.from(key).toString('base64')};
  const modules:Record<string,unknown>={'@/lib/speech-api-route':{createSpeechApiAssessmentRoute},'@/lib/supabase-server':{createServerSupabaseClient:async()=>({...client(owner),auth:{getUser:async()=>({data:{user:{id:behavior.authenticate?behavior.authenticate(++authCalls):owner}},error:null})}})}};
  const context={exports:{},process:{env:routeEnv},fetch:async(...args:Parameters<typeof fetch>)=>{provider++;return providerRequest(...args);},require:(name:string)=>{assert.ok(name in modules);return modules[name];}};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/api/language/assessment/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  return (context.exports as {POST:(request:Request)=>Promise<Response>}).POST;
 };
 return{db,behavior,handle,route,counts:()=>({calls,provider}),setOwner:(id:string)=>{owner=id;},total:async()=>(await db.query<{consumed:boolean;finished:boolean;duration_ms:number|null}>('select consumed,finished,duration_ms from yeoni_speech_proof_candidate.total')).rows[0]};
}

test('actual handler + proof adapter + pgcrypto SQL: 5-second request consumes once; no proof/secret in response',async()=>{
 const f=await fixture();try{
  const handle=f.route();const response=await handle(post());assert.equal(response.status,200);const text=await response.text();assert.ok(text.includes('accuracy'));for(const secret of ['syntheticKeyNotReal000',Buffer.from(key).toString('hex'),Buffer.from(key).toString('base64'),'p_mac','key_bytes'])assert.equal(text.includes(secret),false);
  assert.deepEqual(await f.total(),{consumed:true,finished:true,duration_ms:5000});
  assert.equal((await handle(post())).status,409);assert.equal((await handle(post(S))).status,409);assert.equal(f.counts().provider,1);
  await f.db.query('delete from auth.users where id=$1',[A]);await f.db.query('update yeoni_speech_proof_candidate.policy set allowed_owner=$1',[B]);
  // SQL total survives deletion; HTTP trial owner remains A and cannot silently move.
  f.setOwner(B);assert.equal((await handle(post(S))).status,403);assert.equal((await f.total()).consumed,true);assert.equal(f.counts().provider,1);
 }finally{await f.db.close();}
});
test('actual handler blocks >5 seconds, absent consent, wrong account and unreviewed API boundary before provider dispatch',async()=>{
 const f=await fixture();try{
  const handle=f.handle();assert.equal((await handle(post(R,5001))).status,422);assert.equal((await handle(post(R,1000,undefined,false))).status,400);assert.equal(f.counts().calls,0);
  f.setOwner(B);assert.equal((await handle(post())).status,403);assert.equal(f.counts().calls,0);f.setOwner(A);
  f.behavior.boundaryReviewed=false;assert.equal((await handle(post())).status,503);assert.equal(f.counts().calls,0);assert.equal(f.counts().provider,0);assert.equal((await f.total()).consumed,false);
 }finally{await f.db.close();}
});
test('committed consume with lost response never calls provider or refunds; explicit retry remains blocked',async()=>{
 const f=await fixture();try{
  f.behavior.loseConsume=true;const handle=f.route();assert.equal((await handle(post())).status,503);assert.equal(f.counts().provider,0);assert.equal((await f.total()).consumed,true);
  f.behavior.loseConsume=false;assert.equal((await handle(post())).status,409);assert.equal((await handle(post(S))).status,409);assert.equal(f.counts().provider,0);
 }finally{await f.db.close();}
});
test('abort/account change after consume cannot start provider, and cannot restore quota',async()=>{
 for(const mode of ['abort','account']){
  const f=await fixture();try{
   const controller=new AbortController();if(mode==='abort')f.behavior.afterConsume=()=>controller.abort();else f.behavior.authenticate=count=>count===1?A:B;
   assert.equal((await f.route()(post(R,5000,controller.signal))).status,mode==='abort'?504:401);assert.equal(f.counts().provider,0);assert.equal((await f.total()).consumed,true);
  }finally{await f.db.close();}
 }
});
test('parallel request and cancellation during provider keep total blocked; late result does not become a score',async()=>{
 const f=await fixture();let finish!:(value:Response)=>void;try{
  let entered!:()=>void;const active=new Promise<void>(r=>entered=r),pending=new Promise<Response>(r=>finish=r),controller=new AbortController();
  const handle=f.route(async()=>{entered();return pending;});const first=handle(post(R,5000,controller.signal));
  await Promise.race([active,first.then(r=>{throw Error('provider did not start '+r.status);})]);
  assert.equal((await handle(post(S))).status,409);controller.abort();const result=await first;assert.equal(result.status,504);assert.equal((await result.text()).includes('metrics'),false);
  finish(score());await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(f.counts().provider,1);assert.equal((await f.total()).consumed,true);assert.equal((await f.total()).finished,false);
 }finally{finish?.(score());await f.db.close();}
});
test('finish response loss suppresses score without retrying/refunding consumed quota',async()=>{
 const f=await fixture();try{
  f.behavior.loseFinish=true;const r=await f.route()(post());assert.equal(r.status,503);assert.equal((await r.text()).includes('metrics'),false);assert.equal(f.counts().provider,1);assert.deepEqual(await f.total(),{consumed:true,finished:true,duration_ms:5000});
  assert.equal((await f.route()(post(S))).status,409);assert.equal(f.counts().provider,1);
 }finally{await f.db.close();}
});
