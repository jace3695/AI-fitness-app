import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {createSpeechRetentionUsageLedger} from './speech-retention-usage.ts';
import {createSpeechRetentionProof,speechRetentionPolicyHash} from './speech-retention-proof.ts';
import {createSpeechRetentionMaintenancePurge} from './speech-retention-maintenance.ts';
import {createSpeechRetentionCleanupRunner} from './speech-retention-cleanup.ts';
import {createSpeechServerProof} from './speech-server-proof.ts';
import {createAzureAssessmentHandler,AZURE_ASSESSMENT_POLICY} from './azure-pronunciation-server.ts';
const schema='yeoni_speech_retention_candidate';
const sql=readFileSync(new URL('../docs/azure-pronunciation-usage/retention-contract-candidate.sql',import.meta.url),'utf8');
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002',R='00000000-0000-4000-8000-000000000003',S='00000000-0000-4000-8000-000000000004';
const key=new Uint8Array(32).fill(7),audio='a'.repeat(64),hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const input={owner:A,requestId:R,fingerprint:audio,durationMs:5000,resourceName:'yeoni-speech-jace',region:'koreacentral'};
const G='00000000-0000-4000-8000-000000000009';
const signal=()=>new AbortController().signal;
function wav(){const b=Buffer.alloc(44+5000*32);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
function post(id=R){return new Request('https://fixture.example/api/language/assessment',{method:'POST',headers:{origin:'https://fixture.example','content-type':'application/json'},body:JSON.stringify({requestId:id,language:'ja-JP',referenceText:'こんにちは。',audioMime:'audio/wav',audioBase64:wav().toString('base64'),consent:{confirmed:true,requestId:id,providerId:'azure-speech',policyVersion:AZURE_ASSESSMENT_POLICY}})});}

// One in-memory PGlite instance, sequential subtests and rollback-isolated fixture
// state. Not a live Supabase migration or multi-session PostgreSQL race test.
test('isolated retention contract, actual SQL/proof/handler with synthetic inputs',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(`create schema extensions;create extension pgcrypto with schema extensions;create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.owner',true),'')::uuid$$;insert into auth.users values('${A}'),('${B}');create schema vault;create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text);create sequence public.existing_sequence start 7;grant usage,select,update on sequence public.existing_sequence to public;`);
  await db.exec(sql);
  const count=async(table:string)=>(await db.query<{n:number}>(`select count(*)::int n from ${schema}.${table}`)).rows[0].n;
  const spent=async()=>(await db.query<{consumed:boolean}>(`select consumed from ${schema}.total where singleton`)).rows[0]?.consumed;
  const policy={metadataRetentionSeconds:120,authorizationExpiresAt:Math.floor(Date.now()/1000)+3600,reviewArtifactSHA256:'b'.repeat(64),cleanupIntervalSeconds:60,cleanupStartDelaySeconds:10,cleanupRunTimeoutSeconds:5};
  const config={keyId:'synthetic',key,boundaryReviewed:true,policy};
  async function certify(){
   const due=(await db.query<{n:number}>(`select floor(extract(epoch from clock_timestamp())*1000)::float8 n`)).rows[0].n;
   await db.query(`update ${schema}.policy set cleanup_schedule_generation=$1`,[G]);
   await db.query(`update ${schema}.cleanup_health set policy_hash=$1,generation=$2,next_due_ms=$3,last_due_ms=null,attempt_token=null,healthy_until_ms=null,last_observed_ms=null,state='closed'`,[speechRetentionPolicyHash(policy),G,due]);
   const lease=(await db.query<{r:{token:string}}>(`select ${schema}.maintenance_begin($1,$2,$3) r`,[speechRetentionPolicyHash(policy),G,due])).rows[0].r;
   assert.ok(lease.token);assert.equal((await db.query<{r:{confirmed:boolean}}>(`select ${schema}.maintenance_finalize($1,$2,$3,$4,true) r`,[speechRetentionPolicyHash(policy),G,lease.token,due])).rows[0].r.confirmed,true);
  }
  async function provision(){
   // Synthetic fixture ONLY. Never an activation/migration recipe. The install
   // deliberately starts spent; a real transition must preserve existing state.
   await db.query('insert into vault.decrypted_secrets values($1,$2)',[R,Buffer.from(key).toString('base64')]);
   await db.query(`insert into ${schema}.keys values('synthetic',$1,true)`,[R]);
   await db.query(`update ${schema}.policy set enabled=true,allowed_owner=$1,active_key_id='synthetic',policy_id='trial-retention-policy-v2',metadata_retention_seconds=$2,authorization_expires_at=to_timestamp($3),review_artifact_sha256=$4,api_boundary_reviewed_at=now(),deletion_path_reviewed_at=now(),cleanup_interval_seconds=60,cleanup_start_delay_seconds=10,cleanup_run_timeout_seconds=5`,[A,policy.metadataRetentionSeconds,policy.authorizationExpiresAt,policy.reviewArtifactSHA256]);
   await db.exec(`update ${schema}.total set consumed=false`);
   await certify();
  }
  const behavior={loseConsume:false,loseFinish:false};let calls=0;
  const client=(owner=A)=>({schema:(name:string)=>({rpc:(action:string,args:Record<string,string|number>)=>{
   assert.equal(name,schema);assert.ok(['ready','consume','finish'].includes(action));let abort:AbortSignal;
   const run=async()=>{
    abort.throwIfAborted();calls++;
    await db.query("select set_config('test.owner',$1,false)",[owner]);await db.exec('set role authenticated');
    let result:unknown;
    try{const names=Object.keys(args);assert.ok(names.every(n=>/^p_[a-z_]+$/.test(n)));result=(await db.query<{result:unknown}>(`select ${schema}.${action}(${names.map((n,i)=>`${n}=>$${i+1}`).join(',')}) result`,Object.values(args))).rows[0].result;}
    finally{await db.exec('reset role');}
    if((action==='consume'&&behavior.loseConsume)||(action==='finish'&&behavior.loseFinish))throw Error('synthetic committed response lost');
    return{data:result,error:null};
   };
   const q={abortSignal:(s:AbortSignal)=>{abort=s;return q;},then:<TResult1={data:unknown;error:null},TResult2=never>(resolve?:((value:{data:unknown;error:null})=>TResult1|PromiseLike<TResult1>)|null,reject?:((reason:unknown)=>TResult2|PromiseLike<TResult2>)|null)=>run().then(resolve,reject)};return q;
  }})});
  const ledger=()=>createSpeechRetentionUsageLedger(A,client(),config);
  async function scenario(name:string,action:()=>Promise<void>,prepare=true){await t.test(name,async()=>{await db.exec('begin');try{behavior.loseConsume=false;behavior.loseFinish=false;calls=0;if(prepare)await provision();await action();}finally{await db.exec('rollback;reset role');}});}
  await scenario('install is disabled, marker spent, TTL/review absent; tables and maintenance are inaccessible to API roles',async()=>{
   assert.equal(await spent(),true);assert.equal(await count('receipt'),0);assert.equal(await count('keys'),0);
   assert.deepEqual((await db.query(`select enabled,allowed_owner,metadata_retention_seconds,authorization_expires_at,review_artifact_sha256 from ${schema}.policy`)).rows[0],{enabled:false,allowed_owner:null,metadata_retention_seconds:null,authorization_expires_at:null,review_artifact_sha256:null});
   assert.deepEqual((await db.query<{column_name:string}>("select column_name from information_schema.columns where table_schema=$1 and table_name='total' order by ordinal_position",[schema])).rows.map(r=>r.column_name),['singleton','consumed']);
   for(const role of ['anon','authenticated','service_role']){
    for(const table of ['keys','policy','total','receipt','cleanup_health'])assert.equal((await db.query<{v:boolean}>('select has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER\') v',[role,`${schema}.${table}`])).rows[0].v,false);
    assert.equal((await db.query<{v:boolean}>('select has_function_privilege($1,$2,\'EXECUTE\') v',[role,`${schema}.purge_expired()`])).rows[0].v,false);
   }
   assert.equal((await db.query<{v:boolean}>("select has_sequence_privilege('authenticated','public.existing_sequence','USAGE,SELECT,UPDATE') v")).rows[0].v,true);
   assert.equal(await ledger().isReady!(signal()),false);
  },false);
  await scenario('consume commits receipt and budget together; finish erases receipt/owner without refund',async()=>{
   const l=ledger();assert.equal(await l.isReady!(signal()),true);assert.equal(await l.consume(input,signal()),'accepted');
   assert.equal(await spent(),true);assert.equal(await count('receipt'),1);assert.equal(await l.consume(input,signal()),'duplicate');
   assert.equal(await l.settle!({owner:A,requestId:R},signal()),true);assert.equal(await count('receipt'),0);assert.equal(await spent(),true);
   assert.deepEqual((await db.query(`select enabled,allowed_owner from ${schema}.policy`)).rows[0],{enabled:false,allowed_owner:null});
   assert.equal(await ledger().isReady!(signal()),false);assert.notEqual(await ledger().consume({...input,requestId:S},signal()),'accepted');
  });
  await scenario('hard account delete cascades receipt/policy; deleted-user JWT and a new allowed owner cannot reopen consumed trial',async()=>{
   const l=ledger();assert.equal(await l.consume(input,signal()),'accepted');await db.query('delete from auth.users where id=$1',[A]);
   assert.equal(await count('receipt'),0);assert.equal(await count('policy'),0);assert.equal(await spent(),true);assert.equal(await l.settle!({owner:A,requestId:R},signal()),false);
   await db.query(`insert into ${schema}.policy(singleton,enabled,allowed_owner,active_key_id,policy_id,metadata_retention_seconds,authorization_expires_at,review_artifact_sha256,api_boundary_reviewed_at,deletion_path_reviewed_at,cleanup_interval_seconds,cleanup_start_delay_seconds,cleanup_run_timeout_seconds) values(true,true,$1,'synthetic','trial-retention-policy-v2',$2,to_timestamp($3),$4,now(),now(),60,10,5)`,[B,120,policy.authorizationExpiresAt,policy.reviewArtifactSHA256]);
   await certify();const other=createSpeechRetentionUsageLedger(B,client(B),config);assert.equal(await other.isReady!(signal()),false);assert.equal(await other.consume({...input,owner:B,requestId:S},signal()),'limit');assert.equal(await count('receipt'),0);
  });
  await scenario('expiry blocks finish; explicit purge runs while disabled and erases owner but never opens the budget',async()=>{
   const l=ledger();assert.equal(await l.consume(input,signal()),'accepted');
   assert.equal((await db.query<{n:number}>(`select ${schema}.purge_expired() n`)).rows[0].n,0);assert.equal(await count('receipt'),1);
   await db.exec(`update ${schema}.receipt set consumed_at=now()-interval '121 seconds',expires_at=now()-interval '1 second'`);
   // Policy/key remain ON here: this failure is specifically the expired receipt.
   assert.equal(await l.settle!({owner:A,requestId:R},signal()),false);assert.equal(await count('receipt'),1); // TTL is not a scheduler.
   await db.exec(`update ${schema}.policy set enabled=false;update ${schema}.keys set enabled=false;`);
   assert.equal((await db.query<{n:number}>(`select ${schema}.purge_expired() n`)).rows[0].n,1);assert.equal(await count('receipt'),0);assert.equal(await spent(),true);
   assert.equal((await db.query<{allowed_owner:string|null}>(`select allowed_owner from ${schema}.policy`)).rows[0].allowed_owner,null);
   assert.equal((await db.query<{n:number}>(`select ${schema}.purge_expired() n`)).rows[0].n,0);assert.equal(await spent(),true);
  });
  await scenario('lost consume response retains spent state; cleanup cannot refund or authorize a retry',async()=>{
   behavior.loseConsume=true;await assert.rejects(ledger().consume(input,signal()),/lost/);assert.equal(await spent(),true);assert.equal(await count('receipt'),1);
   behavior.loseConsume=false;assert.equal(await ledger().consume({...input,requestId:S},signal()),'limit');
   await db.exec(`delete from ${schema}.receipt`);assert.equal(await ledger().consume(input,signal()),'limit');assert.equal(await spent(),true);
  });
  await scenario('lost finish response still deletes metadata and blocks all new dispatch',async()=>{
   const l=ledger();assert.equal(await l.consume(input,signal()),'accepted');behavior.loseFinish=true;await assert.rejects(l.settle!({owner:A,requestId:R},signal()),/lost/);
   assert.equal(await count('receipt'),0);assert.equal(await spent(),true);behavior.loseFinish=false;assert.equal(await l.settle!({owner:A,requestId:R},signal()),false);assert.notEqual(await ledger().consume({...input,requestId:S},signal()),'accepted');
  });
  await scenario('missing marker fails closed; no insertion or consume reconstruction',async()=>{
   await db.exec(`delete from ${schema}.total`);assert.equal(await ledger().isReady!(signal()),false);assert.notEqual(await ledger().consume(input,signal()),'accepted');assert.equal(await count('receipt'),0);assert.equal(await count('total'),0);
  });
  await scenario('unset policy/review fields and changed reviewed TTL cannot be made ready by old signed values',async()=>{
   for(const field of ['metadata_retention_seconds','authorization_expires_at','review_artifact_sha256','api_boundary_reviewed_at','deletion_path_reviewed_at','cleanup_interval_seconds','cleanup_start_delay_seconds','cleanup_run_timeout_seconds','cleanup_schedule_generation']){
    await db.exec('savepoint policy_case');await db.exec(`update ${schema}.policy set ${field}=null`);assert.equal(await ledger().isReady!(signal()),false);assert.notEqual(await ledger().consume(input,signal()),'accepted');await db.exec('rollback to policy_case;release policy_case');
   }
   await db.exec(`update ${schema}.policy set metadata_retention_seconds=121`);assert.equal(await ledger().isReady!(signal()),false);assert.equal(await spent(),false);assert.equal(await count('receipt'),0);
  });
  await scenario('recent purge alone is not a certified schedule; missing/stale/other-generation health closes new trials',async()=>{
   for(const patch of ["healthy_until_ms=null","healthy_until_ms=0","generation=null","policy_hash=repeat('c',64)","state='closed'","last_observed_ms=9007199254740991"]){
    await db.exec('savepoint health_case');await db.exec(`update ${schema}.cleanup_health set ${patch}`);assert.equal(await ledger().isReady!(signal()),false);assert.notEqual(await ledger().consume(input,signal()),'accepted');assert.equal(await spent(),false);await db.exec('rollback to health_case;release health_case');
   }
   await db.exec(`update ${schema}.cleanup_health set state='closed',healthy_until_ms=null`);
   const hash=speechRetentionPolicyHash(policy);assert.deepEqual((await db.query<{r:unknown}>(`select ${schema}.maintenance($1) r`,[hash])).rows[0].r,{policyHash:hash,deletedRows:0});
   assert.equal(await ledger().isReady!(signal()),false);await certify();assert.equal(await ledger().isReady!(signal()),true);
   for(const role of ['anon','authenticated','service_role'])for(const fn of ['maintenance(text)','maintenance_begin(text,uuid,bigint)','maintenance_finalize(text,uuid,uuid,bigint,boolean)','cleanup_ready(text)'])assert.equal((await db.query<{v:boolean}>("select has_function_privilege($1,$2,'EXECUTE') v",[role,`${schema}.${fn}`])).rows[0].v,false);
   await db.exec(`update ${schema}.cleanup_health set state='closed',healthy_until_ms=null`);
   assert.deepEqual((await db.query<{r:unknown}>(`select ${schema}.maintenance($1) r`,['c'.repeat(64)])).rows[0].r,{policyHash:null,deletedRows:0});assert.equal(await ledger().isReady!(signal()),false);
  });
  await scenario('in-flight finish erases receipt when only the certified cleanup lease expires',async()=>{
   const l=ledger();assert.equal(await l.consume(input,signal()),'accepted');
   await db.exec(`update ${schema}.cleanup_health set healthy_until_ms=0`);
   assert.equal(await l.isReady!(signal()),false);assert.equal(await l.settle!({owner:A,requestId:R},signal()),true);
   assert.equal(await count('receipt'),0);assert.equal(await spent(),true);
  });
  await scenario('injected runner + fixed maintenance bridge execute actual synthetic SQL without restoring spent budget',async()=>{
   const l=ledger();assert.equal(await l.consume(input,signal()),'accepted');
   await db.exec(`update ${schema}.receipt set consumed_at=now()-interval '121 seconds',expires_at=now()-interval '1 second';update ${schema}.policy set enabled=false;update ${schema}.keys set enabled=false;`);
   let executions=0;const wall=Date.now();
   const purge=createSpeechRetentionMaintenancePurge(speechRetentionPolicyHash(policy),async(statement,values,abort)=>{
    abort.throwIfAborted();executions++;return(await db.query(statement,[...values])).rows;
   });
   const runner=createSpeechRetentionCleanupRunner({policyHash:speechRetentionPolicyHash(policy),intervalSeconds:60,startDelaySeconds:10,runTimeoutSeconds:5},{clock:()=>({wallTimeMs:wall,monotonicTimeMs:1000}),purge,timers:{setTimeout:()=>1,clearTimeout(){}}});
   try{assert.equal((await runner.tick(wall)).healthy,true);assert.equal(executions,1);assert.equal(await count('receipt'),0);assert.equal(await spent(),true);assert.equal(await ledger().isReady!(signal()),false);}finally{runner.dispose();}
  });
  await scenario('SQL and TypeScript policy digests agree; v1/forged/replayed cross-action proof denied',async()=>{
   assert.equal((await db.query<{v:string}>(`select ${schema}.policy_hash($1,to_timestamp($2),$3,60,10,5) v`,[120,policy.authorizationExpiresAt,policy.reviewArtifactSHA256])).rows[0].v,speechRetentionPolicyHash(policy));
   const p={action:'consume' as const,keyId:'synthetic',owner:A,requestId:R,payloadHash:hash(['trial-v1','5000','こんにちは。',audio].join('\n')),policyHash:speechRetentionPolicyHash(policy)};
   for(const proof of [createSpeechServerProof(p,key),{...createSpeechRetentionProof(p,key),mac:'0'.repeat(64)},createSpeechRetentionProof({...p,action:'finish'},key),createSpeechRetentionProof(p,key,()=>Date.now()-60000),createSpeechRetentionProof(p,key,()=>Date.now()+60000)]){
    const q=client().schema(schema).rpc('consume',{p_request_id:R,p_duration:5000,p_text:'こんにちは。',p_audio_hash:audio,p_policy_hash:p.policyHash,p_issued_at:proof.issuedAt,p_expires_at:proof.expiresAt,p_key_id:proof.keyId,p_mac:proof.mac});assert.equal((await q.abortSignal(signal())).data,'denied');
   }
   assert.equal(await spent(),false);assert.equal(await count('receipt'),0);
  });
  await scenario('expiry without consumption clears owner authorization and never fabricates a receipt',async()=>{
   await db.exec(`update ${schema}.policy set authorization_expires_at=date_trunc('second',now()-interval '1 second')`);assert.equal(await ledger().isReady!(signal()),false);assert.equal((await db.query<{n:number}>(`select ${schema}.purge_expired() n`)).rows[0].n,0);assert.equal(await count('receipt'),0);assert.equal(await spent(),false);assert.equal((await db.query<{allowed_owner:string|null}>(`select allowed_owner from ${schema}.policy`)).rows[0].allowed_owner,null);
  });
  await scenario('legacy-compatible handler + v2 adapter + SQL: synthetic score only, immediate metadata deletion, one dispatch',async()=>{
   let provider=0;
   const env={AZURE_SPEECH_ASSESSMENT_TEST_OWNER_ID:A,AZURE_SPEECH_ASSESSMENT_DATA_POLICY_ID:'trial-metadata-policy-v1',AZURE_SPEECH_ASSESSMENT_ENABLED:'true',AZURE_SPEECH_KEY:'syntheticKeyNotReal000',AZURE_SPEECH_REGION:'koreacentral',AZURE_SPEECH_RESOURCE_NAME:'yeoni-speech-jace',VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'agent/fitness-record-priority'};
   const handle=createAzureAssessmentHandler({env,authenticate:async()=>A,usageForOwner:()=>ledger(),request:async()=>{provider++;return Response.json({RecognitionStatus:'Success',NBest:[{AccuracyScore:80,FluencyScore:70}]});}});
   const result=await handle(post());assert.equal(result.status,200);assert.match(await result.text(),/accuracy/);assert.equal(provider,1);assert.equal(await count('receipt'),0);assert.equal(await spent(),true);
   assert.equal((await handle(post(S))).status,409);assert.equal(provider,1);
   // This case isolates legacy handler compatibility. The separate actual-Next
   // integration file verifies the candidate v2 route and v2 consent boundary.
  });
  await t.test('existing schema is never overwritten; inherited table/function grants fail atomic install',async()=>{
   await assert.rejects(db.exec(sql),/already exists/);await db.exec('rollback');assert.equal(await spent(),true);
   await db.exec(`drop schema ${schema} cascade;create role synthetic_reader nologin;grant synthetic_reader to authenticated;`);
   for(const kind of ['table','function']){
    await db.exec(kind==='table'?'alter default privileges grant select on tables to synthetic_reader':'alter default privileges grant execute on functions to synthetic_reader');
    await assert.rejects(db.exec(sql),/Unexpected direct usage table access|Unexpected API function access/);await db.exec('rollback');
    assert.equal((await db.query<{n:number}>("select count(*)::int n from pg_namespace where nspname=$1",[schema])).rows[0].n,0);
    assert.deepEqual((await db.query('select last_value::int,is_called from public.existing_sequence')).rows[0],{last_value:7,is_called:false});
    await db.exec(kind==='table'?'alter default privileges revoke select on tables from synthetic_reader':'alter default privileges revoke execute on functions from synthetic_reader');
   }
  });
 }finally{await db.close();}
});
