import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createAzureUsageLedger} from './azure-pronunciation-usage.ts';
import {createAzureAssessmentHandler,AZURE_ASSESSMENT_POLICY} from './azure-pronunciation-server.ts';
import {Buffer} from 'node:buffer';
import vm from 'node:vm';
import ts from 'typescript';
import {createSpeechDatabasePool,createSpeechUsageDatabaseClient,type SpeechDatabaseFactory} from './speech-usage-database.ts';
import {rootCertificates} from 'node:tls';
import {X509Certificate} from 'node:crypto';
const db=new PGlite(),A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002',fingerprint='a'.repeat(64);
before(async()=>{await db.exec(`create role anon;create role authenticated;create role service_role;create role authenticator;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.owner',true),'')::uuid$$;grant usage on schema auth,public to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;insert into auth.users values('${A}'),('${B}');`);await db.exec(readFileSync(new URL('../docs/azure-pronunciation-usage/draft.sql',import.meta.url),'utf8'));});
after(async()=>db.close());
const token='synthetic-lease-token-00000000000000000001';

test('dedicated API role has no login/bypass/table access/operator reconciliation and cannot switch to service_role',async()=>{
 await db.exec('reset role');const role=(await db.query<{rolcanlogin:boolean;rolbypassrls:boolean}>("select rolcanlogin,rolbypassrls from pg_roles where rolname='yeoni_speech_usage_api'")).rows[0];assert.deepEqual(role,{rolcanlogin:false,rolbypassrls:false});await db.exec('set role yeoni_speech_usage_login');
 for(const table of ['policy','receipts','lease','shared_totals','reconciliations'])await assert.rejects(db.query('select * from yeoni_speech_usage.'+table),/permission denied/);
 await assert.rejects(db.query("select yeoni_speech_usage.reconcile($1,'r',now(),'x','verified-finished','fixture')",[A]),/permission denied/);
 // has_role checks the role's actual membership, independently of this fixture's superuser session.
 assert.equal((await db.query<{r:boolean}>("select pg_has_role('yeoni_speech_usage_api','service_role','MEMBER') r")).rows[0].r,false);
 await db.exec('reset role');const login=(await db.query<{rolcanlogin:boolean;rolbypassrls:boolean;rolcreaterole:boolean;rolconnlimit:number}>("select rolcanlogin,rolbypassrls,rolcreaterole,rolconnlimit from pg_roles where rolname='yeoni_speech_usage_login'")).rows[0];assert.deepEqual(login,{rolcanlogin:true,rolbypassrls:false,rolcreaterole:false,rolconnlimit:1});
 assert.equal((await db.query<{r:boolean}>("select pg_has_role('authenticator','yeoni_speech_usage_api','MEMBER') r")).rows[0].r,false);assert.equal((await db.query<{r:boolean}>("select pg_has_role('yeoni_speech_usage_login','yeoni_speech_usage_api','MEMBER') r")).rows[0].r,true);
});
async function reset(){await db.exec('reset role;truncate yeoni_speech_usage.receipts,yeoni_speech_usage.shared_totals,yeoni_speech_usage.reconciliations;update yeoni_speech_usage.lease set user_id=null,request_id=null,token_hash=null,claimed_at=null;update yeoni_speech_usage.policy set enabled=false,trial_consumed=false,f0_reviewed_at=null,trial_owner_id=null,data_policy_id=null,data_policy_reviewed_at=null,shared_month_ms=null,owner_month_ms=null,shared_month_requests=null,owner_month_requests=null;');}
async function enable(){await db.exec(`reset role;update yeoni_speech_usage.policy set enabled=true,f0_reviewed_at=now(),resource_name='yeoni-speech-jace',region='koreacentral',trial_owner_id='${A}',data_policy_id='trial-metadata-policy-v1',data_policy_reviewed_at=now(),shared_month_ms=5000,owner_month_ms=5000,shared_month_requests=1,owner_month_requests=1;`);}
async function consume(owner:string,id:string,ms=1000,finish=true){await db.query(`select set_config('test.owner',$1,false)`,[owner]);await db.exec('set role yeoni_speech_usage_login');const result=(await db.query<{result:string}>('select yeoni_speech_usage.consume($1,$2,$3,$4,$5,$6,$7) result',[owner,id,fingerprint,ms,'yeoni-speech-jace','koreacentral',token])).rows[0].result;if(result==='accepted'&&finish)await db.query('select yeoni_speech_usage.finish($1,$2,$3)',[owner,id,token]);return result;}
test('draft is disabled without numeric caps; service cannot read/change policy/receipts directly',async()=>{
 await reset();assert.equal(await consume(A,'disabled'),'limit');await assert.rejects(db.query('select * from yeoni_speech_usage.receipts'));await assert.rejects(db.query('update yeoni_speech_usage.policy set enabled=true'));await db.exec('reset role;set role anon');await assert.rejects(db.query(`select yeoni_speech_usage.consume('${A}','x',$1,1000,'yeoni-speech-jace','koreacentral',$2)`,[fingerprint,token]));
});

test('authenticated and anonymous direct RPC/private calls cannot occupy or release the global lease, even with a forged owner/token',async()=>{
 await reset();await enable();
 for(const role of ['authenticated','anon']){
  await db.exec('reset role;set role '+role);
  for(const name of ['yeoni_speech_usage.consume','yeoni_speech_usage.consume'])await assert.rejects(db.query(`select ${name}($1,'forged',$2,1,'yeoni-speech-jace','koreacentral',$3)`,[A,fingerprint,token]),/permission denied/);
  await assert.rejects(db.query('select yeoni_speech_usage.finish($1,$2,$3)',[A,'forged',token]),/permission denied/);
  await assert.rejects(db.query('select yeoni_speech_usage.ready($1,$2,$3)',[A,'yeoni-speech-jace','koreacentral']),/permission denied/);
 }
 await db.exec('reset role');assert.equal((await db.query<{n:number}>('select count(*)::int n from yeoni_speech_usage.receipts')).rows[0].n,0);assert.equal((await db.query<{n:number}>('select count(*)::int n from yeoni_speech_usage.lease where user_id is not null')).rows[0].n,0);
});

test('operator reconciliation requires disabled policy, exact lease snapshot and verified resolution; preserves quota/audit and rejects stale release',async()=>{
 await reset();await enable();assert.equal(await consume(A,'operator-held',1000,false),'accepted');await db.exec('reset role');
 const row=(await db.query<{claimed_at:string;token_hash:string}>('select claimed_at::text,token_hash from yeoni_speech_usage.lease')).rows[0];
 const run=(resolution='verified-finished',at=row.claimed_at)=>db.query<{r:boolean}>('select yeoni_speech_usage.reconcile($1,$2,$3,$4,$5,$6) r',[A,'operator-held',at,row.token_hash,resolution,'synthetic-evidence/closed-1']);
 await db.exec('set role authenticated');await assert.rejects(run(),/permission denied/);
 await db.exec('reset role;set role yeoni_speech_usage_login');await assert.rejects(run(),/permission denied/);await db.exec('reset role');assert.equal((await run()).rows[0].r,false);
 await db.exec('reset role;update yeoni_speech_usage.policy set enabled=false');
 assert.equal((await run('elapsed-only')).rows[0].r,false);assert.equal((await run('verified-finished','2000-01-01')).rows[0].r,false);
 assert.equal((await run()).rows[0].r,true);assert.equal((await run()).rows[0].r,false);
 await db.exec('reset role');assert.equal((await db.query<{n:number}>('select count(*)::int n from yeoni_speech_usage.receipts')).rows[0].n,1);assert.equal((await db.query<{n:number}>('select count(*)::int n from yeoni_speech_usage.reconciliations')).rows[0].n,1);
 await enable();await db.exec("reset role;truncate yeoni_speech_usage.shared_totals;update yeoni_speech_usage.policy set trial_consumed=false,trial_owner_id='"+B+"';");assert.equal(await consume(B,'next-lease',1,false),'accepted');await db.exec('reset role');assert.equal((await run()).rows[0].r,false);
});
test('shared and owner limits consume atomically and duplicate request never consumes again',async()=>{
 await reset();await enable();assert.equal(await consume(A,'one'),'accepted');assert.equal(await consume(A,'one'),'duplicate');assert.equal(await consume(A,'two'),'limit');assert.equal(await consume(B,'one'),'limit');assert.equal(await consume(B,'two',1),'limit');await db.exec('reset role');assert.equal((await db.query<{n:number}>('select count(*)::int n from yeoni_speech_usage.receipts')).rows[0].n,1);
});
test('concurrent same-account attempts deduplicate; monthly rollover never re-arms the one-shot trial',async()=>{
 await reset();await enable();await db.query(`select set_config('test.owner',$1,false)`,[A]);await db.exec('set role yeoni_speech_usage_login');const run=()=>db.query<{r:string}>('select yeoni_speech_usage.consume($1,$2,$3,$4,$5,$6,$7) r',[A,'same',fingerprint,1000,'yeoni-speech-jace','koreacentral',token]);const r=await Promise.all([run(),run()]);assert.deepEqual(r.map(x=>x.rows[0].r).sort(),['accepted','duplicate']);await db.query('select yeoni_speech_usage.finish($1,$2,$3)',[A,'same',token]);await db.exec("reset role;update yeoni_speech_usage.receipts set consumed_at=date_trunc('month',now())-interval '1 day';update yeoni_speech_usage.shared_totals set month_start=date_trunc('month',now())-interval '1 month';");assert.equal(await consume(A,'same'),'duplicate');assert.equal(await consume(A,'fresh'),'limit');
});
test('wrong resource/missing review/caps or invalid duration fail closed; receipts carry no voice/text/score',async()=>{
 for(const update of ["region='other'","f0_reviewed_at=null","shared_month_ms=null"]){await reset();await enable();await db.exec('update yeoni_speech_usage.policy set '+update);assert.equal(await consume(A,'wrong'),'limit');}
 await reset();await enable();assert.equal(await consume(A,'zero',0),'limit');assert.equal(await consume(A,'long',30001),'limit');await db.exec('reset role');const columns=(await db.query<{column_name:string}>("select column_name from information_schema.columns where table_schema='yeoni_speech_usage' and table_name='receipts' order by ordinal_position")).rows.map(x=>x.column_name);assert.deepEqual(columns,['user_id','request_id','fingerprint','duration_ms','consumed_at']);
});
test('RPC adapter binds owner, rounds duration upward, forwards abort and rejects missing/invalid RPC outcome',async()=>{
 let params:Record<string,string|number>|undefined,seen:AbortSignal|undefined,calls=0;const client={rpc:(name:string,p:Record<string,string|number>)=>{assert.equal(name,'consume_yeoni_speech_usage');params=p;calls++;const q={then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:'accepted',error:null}).then(resolve),abortSignal:(s:AbortSignal)=>{seen=s;return q}};return q;}};const ledger=createAzureUsageLedger(A,client as never),signal=new AbortController().signal;const input={owner:A,requestId:'one',fingerprint,durationMs:1000.01,resourceName:'yeoni-speech-jace',region:'koreacentral'};assert.equal(await ledger.consume(input,signal),'accepted');assert.equal(params?.p_duration_ms,1001);assert.equal(params?.p_owner_id,A);assert.equal(seen,signal);assert.equal(await ledger.consume({...input,owner:B},signal),'limit');assert.equal(calls,1);
 const bad=createAzureUsageLedger(A,{rpc:()=>{const q={then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:null,error:{message:'private'}}).then(resolve),abortSignal:()=>q};return q;}} as never);await assert.rejects(bad.consume(input,signal),/Shared usage/);
});
test('global in-flight lease blocks another request/account until exact owner token completes; no expiry',async()=>{
 await reset();await enable();assert.equal(await consume(A,'held',1000,false),'accepted');await db.exec("reset role;update yeoni_speech_usage.policy set trial_owner_id='"+B+"';");assert.equal(await consume(B,'other',1,false),'busy');assert.equal((await db.query<{r:boolean}>('select yeoni_speech_usage.finish($1,$2,$3) r',[B,'held',token])).rows[0].r,false);await db.query(`select set_config('test.owner',$1,false)`,[A]);assert.equal((await db.query<{r:boolean}>('select yeoni_speech_usage.finish($1,$2,$3) r',[A,'held','wrong-token-0000000000000000000000000000'])).rows[0].r,false);await db.exec("reset role;update yeoni_speech_usage.lease set claimed_at=now()-interval '3 days';");assert.equal(await consume(B,'still-blocked',1,false),'busy');await db.query(`select set_config('test.owner',$1,false)`,[A]);assert.equal((await db.query<{r:boolean}>('select yeoni_speech_usage.finish($1,$2,$3) r',[A,'held',token])).rows[0].r,true);assert.equal(await consume(B,'new',1),'limit');
});
test('actual server handler + RPC adapter + SQL share one lease across two synthetic accounts and release after full mock response',async()=>{
 await reset();await enable();
 const client=(owner:string)=>({rpc:(name:string,params:Record<string,string|number>)=>{let signal:AbortSignal;const run=()=>db.transaction(async tx=>{
  signal.throwIfAborted();await tx.query("select set_config('test.owner',$1,true)",[owner]);await tx.exec('set local role yeoni_speech_usage_login');
  const defs:Record<string,[string,(string|number)[]]>={
   is_yeoni_speech_usage_ready:['select yeoni_speech_usage.ready($1,$2,$3) r',[params.p_owner_id,params.p_resource_name,params.p_region]],
   consume_yeoni_speech_usage:['select yeoni_speech_usage.consume($1,$2,$3,$4,$5,$6,$7) r',[params.p_owner_id,params.p_request_id,params.p_fingerprint,params.p_duration_ms,params.p_resource_name,params.p_region,params.p_lease_token]],
   finish_yeoni_speech_usage:['select yeoni_speech_usage.finish($1,$2,$3) r',[params.p_owner_id,params.p_request_id,params.p_lease_token]],
  };const def=defs[name];if(!def)throw Error('unexpected RPC');const result=await tx.query<{r:unknown}>(def[0],def[1]);return{data:result.rows[0].r,error:null};});
  const q={abortSignal:(s:AbortSignal)=>{signal=s;return q},then:(resolve:(v:unknown)=>unknown,reject:(e:unknown)=>unknown)=>run().then(resolve,reject)};return q;}});
 const audio=Buffer.alloc(32044);audio.write('RIFF');audio.writeUInt32LE(32036,4);audio.write('WAVE',8);audio.write('fmt ',12);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(16000,24);audio.writeUInt32LE(32000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(32000,40);
 let provider=0,finish!:(r:Response)=>void,entered!:()=>void;const active=new Promise<void>(r=>entered=r);const pendingResponse=new Promise<Response>(r=>finish=r);
 const env={AZURE_SPEECH_ASSESSMENT_TEST_OWNER_ID:A,AZURE_SPEECH_ASSESSMENT_DATA_POLICY_ID:'trial-metadata-policy-v1',AZURE_SPEECH_KEY:'syntheticKeyNotReal000',AZURE_SPEECH_REGION:'koreacentral',AZURE_SPEECH_RESOURCE_NAME:'yeoni-speech-jace',AZURE_SPEECH_ASSESSMENT_ENABLED:'true',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'agent/fitness-record-priority'};
 const handle=(owner:string)=>createAzureAssessmentHandler({env,authenticate:async()=>owner,usage:createAzureUsageLedger(owner,client(owner) as never),request:async()=>{provider++;entered();return pendingResponse}});
 const request=(id:string)=>new Request('https://fixture.example/api/language/assessment',{method:'POST',headers:{origin:'https://fixture.example','content-type':'application/json'},body:JSON.stringify({requestId:id,language:'ja-JP',referenceText:'こんにちは。',audioMime:'audio/wav',audioBase64:audio.toString('base64'),consent:{confirmed:true,requestId:id,providerId:'azure-speech',policyVersion:AZURE_ASSESSMENT_POLICY}})});
 const first=handle(A)(request('integration-A'));await Promise.race([active,first.then(async response=>{throw Error('provider did not start: '+response.status+' '+await response.text())})]);const second=await handle(B)(request('integration-B'));assert.equal(second.status,403);assert.equal((await second.json()).code,'unavailable');assert.equal(provider,1);
 finish(Response.json({RecognitionStatus:'Success',NBest:[{AccuracyScore:75,FluencyScore:65}]}));assert.equal((await first).status,200);await db.exec('reset role');assert.equal((await db.query<{n:number}>('select count(*)::int n from yeoni_speech_usage.lease where user_id is not null')).rows[0].n,0);assert.equal((await db.query<{n:number}>('select count(*)::int n from yeoni_speech_usage.receipts')).rows[0].n,1);
});

test('account deletion and receipt housekeeping never restore already consumed shared time/count quota',async()=>{
 await reset();await enable();assert.equal(await consume(A,'before-account-delete',1000),'accepted');
 await db.exec('reset role');await db.query('delete from auth.users where id=$1',[A]);
 assert.equal((await db.query<{trial_owner_id:string|null}>('select trial_owner_id from yeoni_speech_usage.policy')).rows[0].trial_owner_id,null);
 assert.equal((await db.query<{n:number}>('select count(*)::int n from yeoni_speech_usage.receipts')).rows[0].n,0);
 const totals=(await db.query<{consumed_ms:number;consumed_requests:number}>('select consumed_ms::int,consumed_requests::int from yeoni_speech_usage.shared_totals')).rows[0];assert.deepEqual(totals,{consumed_ms:1000,consumed_requests:1});
 await db.query('update yeoni_speech_usage.policy set trial_consumed=false,trial_owner_id=$1',[B]);assert.equal(await consume(B,'after-delete',1),'limit');
 await db.exec('reset role;delete from yeoni_speech_usage.receipts;delete from yeoni_speech_usage.reconciliations;');assert.equal(await consume(B,'after-housekeeping',1),'limit');
 await db.exec('reset role');await db.query('insert into auth.users(id) values($1)',[A]);
 const columns=(await db.query<{column_name:string}>("select column_name from information_schema.columns where table_schema='yeoni_speech_usage' and table_name='shared_totals' order by ordinal_position")).rows.map(x=>x.column_name);assert.deepEqual(columns,['month_start','consumed_ms','consumed_requests']);
});

test('missing data review/owner/F0 freshness or non-trial limits cannot enable the trial',async()=>{
 for(const update of ["trial_owner_id=null","data_policy_id=null","data_policy_reviewed_at=null","f0_reviewed_at=now()-interval '2 days'"]){await reset();await enable();await db.exec('update yeoni_speech_usage.policy set '+update);assert.equal(await consume(A,'missing'),'limit');}
 await reset();await enable();await assert.rejects(db.exec('update yeoni_speech_usage.policy set shared_month_requests=2'));assert.equal(await consume(A,'too-long',5001),'limit');
});

test('account deletion anonymizes an unresolved lease without freeing it; only verified operator reconciliation can clear it',async()=>{
 await reset();await enable();assert.equal(await consume(A,'deleted-while-active',1000,false),'accepted');await db.exec('reset role');await db.query('delete from auth.users where id=$1',[A]);
 const held=(await db.query<{user_id:null;request_id:string;claimed_at:string;token_hash:string}>('select user_id,request_id,claimed_at::text,token_hash from yeoni_speech_usage.lease')).rows[0];assert.equal(held.user_id,null);assert.equal(held.request_id,'deleted-while-active');
 await db.query('update yeoni_speech_usage.policy set trial_owner_id=$1,trial_consumed=false',[B]);assert.equal(await consume(B,'still-active',1),'busy');
 await db.exec('reset role;update yeoni_speech_usage.policy set enabled=false');assert.equal((await db.query<{r:boolean}>('select yeoni_speech_usage.reconcile(null,$1,$2,$3,$4,$5) r',[held.request_id,held.claimed_at,held.token_hash,'verified-finished','synthetic-evidence/finished-after-delete'])).rows[0].r,true);
 await db.exec('update yeoni_speech_usage.policy set enabled=true');assert.equal(await consume(B,'after-verified-finish',1),'limit');await db.exec('reset role');await db.query('insert into auth.users(id) values($1)',[A]);
});

function databaseRoute(loseConsumedResponse=false){
 const ca=rootCertificates.find(value=>{const c=new X509Certificate(value);return c.ca&&Date.parse(c.validFrom)<=Date.now()&&Date.parse(c.validTo)>Date.now()})!;
 const env={AZURE_SPEECH_ASSESSMENT_TEST_OWNER_ID:A,AZURE_SPEECH_ASSESSMENT_DATA_POLICY_ID:'trial-metadata-policy-v1',AZURE_SPEECH_ASSESSMENT_ENABLED:'true',AZURE_SPEECH_KEY:'syntheticKeyNotReal000',AZURE_SPEECH_REGION:'koreacentral',AZURE_SPEECH_RESOURCE_NAME:'yeoni-speech-jace',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'agent/fitness-record-priority',NEXT_PUBLIC_SUPABASE_URL:'https://piqqukiiacncfbztktga.supabase.co',YEONI_SPEECH_USAGE_POOLER_HOST:'aws-0-ap-northeast-2.pooler.supabase.com',YEONI_SPEECH_USAGE_DATABASE_URL:'postgresql://yeoni_speech_usage_login.piqqukiiacncfbztktga:synthetic-password-not-real@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres',YEONI_SPEECH_USAGE_CA_CERT:ca};
 const counts={provider:0,sql:0,consume:0,connections:0},pool=createSpeechDatabasePool();
 const factory:SpeechDatabaseFactory=options=>{counts.connections++;assert.equal(options.username,'yeoni_speech_usage_login.piqqukiiacncfbztktga');return{unsafe:async(text,values)=>{
  counts.sql++;const rows=await db.transaction(async tx=>{await tx.exec('set local role yeoni_speech_usage_login');return(await tx.query<{result:unknown}>(text,values)).rows});
  if(text.includes('.consume(')){counts.consume++;if(loseConsumedResponse)throw Error('synthetic response lost after commit');}return rows;
 },end:async()=>{}}};
 const fetchMock:typeof fetch=async url=>{assert.equal(new URL(String(url)).hostname,'yeoni-speech-jace.cognitiveservices.azure.com');counts.provider++;return Response.json({RecognitionStatus:'Success',NBest:[{AccuracyScore:80,FluencyScore:70}]});};
 const modules:Record<string,unknown>={'@/lib/azure-pronunciation-server':{createAzureAssessmentHandler},'@/lib/azure-pronunciation-usage':{createAzureUsageLedger},'@/lib/speech-usage-database':{createSpeechUsageDatabaseClient:(env:Record<string,string|undefined>)=>createSpeechUsageDatabaseClient(env,{factory,pool})},'@/lib/supabase-server':{createServerSupabaseClient:async()=>({auth:{getUser:async()=>({data:{user:{id:A}},error:null})}})}};
 const context={exports:{},Response,process:{env},fetch:fetchMock,require:(name:string)=>{assert.ok(name in modules);return modules[name]}};
 const code=ts.transpileModule(readFileSync(new URL('../docs/azure-pronunciation-usage/legacy/direct-db-route.ts.fixture',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,context);
 const route=context.exports as{GET:(r:Request)=>Promise<Response>;POST:(r:Request)=>Promise<Response>},origin='https://fixture.example';
 const audio=Buffer.alloc(32044);audio.write('RIFF');audio.writeUInt32LE(32036,4);audio.write('WAVE',8);audio.write('fmt ',12);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(16000,24);audio.writeUInt32LE(32000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(32000,40);
 return{route,counts,get:()=>new Request(origin+'/api/language/assessment',{headers:{origin}}),post:(id:string)=>new Request(origin+'/api/language/assessment',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({requestId:id,language:'ja-JP',referenceText:'こんにちは。',audioMime:'audio/wav',audioBase64:audio.toString('base64'),consent:{confirmed:true,requestId:id,providerId:'azure-speech',policyVersion:AZURE_ASSESSMENT_POLICY}})})};
}

test('archived direct-DB route -> adapter -> dedicated LOGIN role SQL -> mock provider executes only one trial (not the active route)',async()=>{
 await reset();await enable();const f=databaseRoute();assert.equal((await(await f.route.GET(f.get())).json()).available,true);assert.equal(f.counts.provider,0);
 assert.equal((await f.route.POST(f.post('database-one'))).status,200);assert.equal((await f.route.POST(f.post('database-two'))).status,409);assert.equal(f.counts.provider,1);assert.equal(f.counts.connections,1);assert.equal(f.counts.sql,4);
 assert.equal((await(await f.route.GET(f.get())).json()).available,false);
});

test('consume committed but response lost never starts Azure or retries/refunds; subsequent readiness stays unavailable',async()=>{
 await reset();await enable();const f=databaseRoute(true);assert.equal((await f.route.POST(f.post('lost-reservation'))).status,503);assert.equal(f.counts.provider,0);assert.equal(f.counts.consume,1);
 await new Promise(r=>setImmediate(r));assert.equal((await(await f.route.GET(f.get())).json()).available,false);await db.exec('reset role');assert.equal((await db.query<{consumed_requests:number}>('select consumed_requests::int from yeoni_speech_usage.shared_totals')).rows[0].consumed_requests,1);
 assert.equal((await db.query<{request_id:string}>('select request_id from yeoni_speech_usage.lease')).rows[0].request_id,'lost-reservation');
});

test('draft aborts atomically if PUBLIC grants would expose an existing application table; it never fixes other apps permissions',async()=>{
 const isolated=new PGlite();try{
  await isolated.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table public.existing_private_record(value text);grant select on public.existing_private_record to public;`);
  await assert.rejects(isolated.exec(readFileSync(new URL('../docs/azure-pronunciation-usage/draft.sql',import.meta.url),'utf8')),/inherits application table access/);await isolated.exec('rollback');
  assert.equal((await isolated.query<{n:number}>("select count(*)::int n from pg_roles where rolname in ('yeoni_speech_usage_login','yeoni_speech_usage_api')")).rows[0].n,0);assert.equal((await isolated.query<{r:boolean}>("select has_table_privilege('anon','public.existing_private_record','SELECT') r")).rows[0].r,true);
 }finally{await isolated.close();}
});

test('PUBLIC sequence USAGE, SELECT or UPDATE alone and combined abort the whole draft, preserving old sequence state and grants',async()=>{
 for(const privilege of ['USAGE','SELECT','UPDATE','USAGE,SELECT,UPDATE']){
  const isolated=new PGlite();try{
   await isolated.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create sequence public.synthetic_other_app_sequence start 7;grant ${privilege} on sequence public.synthetic_other_app_sequence to public;`);
   await assert.rejects(isolated.exec(readFileSync(new URL('../docs/azure-pronunciation-usage/draft.sql',import.meta.url),'utf8')),/inherits application sequence access/);await isolated.exec('rollback');
   assert.equal((await isolated.query<{n:number}>("select count(*)::int n from pg_roles where rolname in ('yeoni_speech_usage_login','yeoni_speech_usage_api')")).rows[0].n,0);
   assert.equal((await isolated.query<{n:number}>("select count(*)::int n from pg_namespace where nspname='yeoni_speech_usage'")).rows[0].n,0);
   assert.equal((await isolated.query<{r:boolean}>('select has_sequence_privilege($1,$2,$3) r',['anon','public.synthetic_other_app_sequence',privilege])).rows[0].r,true);
   assert.deepEqual((await isolated.query<{last_value:number;is_called:boolean}>('select last_value::int,is_called from public.synthetic_other_app_sequence')).rows[0],{last_value:7,is_called:false});
  }finally{await isolated.close();}
 }
});

