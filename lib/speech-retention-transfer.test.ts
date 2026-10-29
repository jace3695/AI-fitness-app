import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Buffer} from 'node:buffer';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {renderRetentionTransferSQL,renderUnconfiguredRetentionTransferSQL} from './speech-retention-transfer.ts';
import {createSpeechServerProof} from './speech-server-proof.ts';
const v1='yeoni_speech_proof_candidate',v2='yeoni_speech_retention_candidate';
const read=(name:string)=>readFileSync(new URL(`../docs/azure-pronunciation-usage/${name}`,import.meta.url),'utf8');
const source=read('api-proof-contract-draft.sql'),destination=read('retention-contract-candidate.sql');
const context={legacyHistory:'reviewed-unused' as const,evidenceSHA256:'a'.repeat(64)}; // SYNTHETIC, NOT A REVIEW/APPROVAL
const sql=()=>renderRetentionTransferSQL(source,destination,context);
const A='00000000-0000-4000-8000-000000000001',R='00000000-0000-4000-8000-000000000003',S='00000000-0000-4000-8000-000000000004';
type LegacyTotal={consumed:boolean;request_id:string|null;payload_hash:string|null;duration_ms:number|null;consumed_at:string|null;finished:boolean};
test('offline transfer renderer rejects absent/context drift or nonexact contract bytes',()=>{
 assert.throws(()=>renderRetentionTransferSQL(source,destination),/context/);
 assert.throws(()=>renderRetentionTransferSQL(source+' ',destination,context),/identity/);
 assert.throws(()=>renderRetentionTransferSQL(source,destination+' ',context),/identity/);
 assert.throws(()=>renderRetentionTransferSQL(source,destination,{...context,legacyHistory:'bad'} as never),/context/);
 assert.throws(()=>renderRetentionTransferSQL(source,destination,{...context,evidenceSHA256:"';select 1;--"}),/context/);
 const s=sql();assert.equal(s.match(/^begin;$/gm)?.length,1);assert.equal(s.match(/^commit;$/gm)?.length,1);assert.match(s,/cannot open a trial\.\ndo \$\$/);
 assert.equal(read('retention-transfer-candidate.sql'),renderUnconfiguredRetentionTransferSQL(source,destination));
});
// One isolated in-memory PGlite instance. Migration cases COMMIT independently;
// only fixture resets delete synthetic schemas/reset synthetic budgets. This is
// actual SQL/DDL rollback validation, NOT concurrent sessions or hosted migration.
test('actual v1 -> fresh v2 atomic transfer on an isolated synthetic database',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(`create schema extensions;create extension pgcrypto with schema extensions;create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.owner',true),'')::uuid$$;insert into auth.users values('${A}');create schema vault;create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text);create table public.unrelated_synthetic_record(id integer primary key,value text);insert into public.unrelated_synthetic_record values(1,'keep');`);
  await db.exec(source);
  const exists=async()=>(await db.query<{v:boolean}>(`select to_regnamespace('${v2}') is not null v`)).rows[0].v;
  const old=async()=>(await db.query<LegacyTotal>(`select consumed,request_id,payload_hash,duration_ms,consumed_at,finished from ${v1}.total`)).rows[0];
  const spent=async()=>(await db.query<{v:boolean}>(`select consumed v from ${v2}.total`)).rows[0]?.v;
  const before=async()=>JSON.stringify({old:await old(),policy:(await db.query(`select * from ${v1}.policy`)).rows,keys:(await db.query(`select * from ${v1}.keys`)).rows}); // SYNTHETIC values only
  async function reset(){
   await db.exec('reset role;rollback');
   if(await exists())await db.exec(`drop schema ${v2} cascade`);
   await db.exec(`delete from ${v1}.policy;delete from ${v1}.keys;delete from vault.decrypted_secrets;insert into ${v1}.policy(singleton,allowed_owner) values(true,'${A}');delete from ${v1}.total;insert into ${v1}.total(singleton) values(true);`);
  }
  async function scenario(name:string,run:()=>Promise<void>){await t.test(name,async()=>{await reset();await run();assert.deepEqual((await db.query('select * from public.unrelated_synthetic_record')).rows,[{id:1,value:'keep'}]);});}
  const rejectTransfer=async(s=sql(),pattern:RegExp=/./)=>{await assert.rejects(db.exec(s),pattern);await db.exec('rollback');};
  await scenario('checked-in unconfigured SQL copy aborts before any legacy or destination write',async()=>{
   const snapshot=await before();await rejectTransfer(read('retention-transfer-candidate.sql'),/context not configured/);assert.equal(await exists(),false);assert.equal(await before(),snapshot);
  });
  await scenario('proven unused transfers once, retires old writer and leaves actual policy/config closed',async()=>{
   await db.exec(sql());assert.equal(await spent(),false);assert.deepEqual(await old(),{consumed:true,request_id:null,payload_hash:null,duration_ms:null,consumed_at:null,finished:false});
   assert.deepEqual((await db.query(`select enabled,allowed_owner from ${v1}.policy`)).rows[0],{enabled:false,allowed_owner:null});
   assert.deepEqual((await db.query(`select enabled,allowed_owner,metadata_retention_seconds,cleanup_schedule_generation,policy_id from ${v2}.policy`)).rows[0],{enabled:false,allowed_owner:null,metadata_retention_seconds:null,cleanup_schedule_generation:null,policy_id:null});
   assert.deepEqual((await db.query(`select legacy_classification,legacy_retired from ${v2}.transfer_claim`)).rows[0],{legacy_classification:'proven-unused',legacy_retired:true});
   assert.equal((await db.query<{v:number}>(`select count(*)::int v from ${v2}.receipt`)).rows[0].v,0);
   for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query<{v:boolean}>("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') v",[role,`${v2}.transfer_claim`])).rows[0].v,false);
  });
  await scenario('combined transfer then DB executor installation never opens an unconfigured trial or changes inherited budget',async()=>{
   for(const legacyHistory of ['reviewed-unused','unknown'] as const){
    await reset();await db.exec(renderRetentionTransferSQL(source,destination,{...context,legacyHistory}));
    const expectedSpent=legacyHistory!=='reviewed-unused';assert.equal(await spent(),expectedSpent);
    await db.exec(read('retention-db-executor-candidate.sql'));
    await assert.rejects(db.exec(`call ${v2}.db_executor_tick_candidate()`),/Retention maintenance unconfirmed/);
    assert.equal(await spent(),expectedSpent);assert.equal((await old()).consumed,true);
    assert.deepEqual((await db.query(`select enabled,metadata_retention_seconds,cleanup_interval_seconds,cleanup_start_delay_seconds,cleanup_run_timeout_seconds,cleanup_schedule_generation from ${v2}.policy`)).rows[0],{enabled:false,metadata_retention_seconds:null,cleanup_interval_seconds:null,cleanup_start_delay_seconds:null,cleanup_run_timeout_seconds:null,cleanup_schedule_generation:null});
    assert.deepEqual((await db.query(`select state,healthy_until_ms from ${v2}.cleanup_health`)).rows[0],{state:'unconfigured',healthy_until_ms:null});
    assert.equal((await db.query<{v:boolean}>(`select ${v2}.ready($1,null,0,0,null,null) v`,[R])).rows[0].v,false);
    assert.equal((await db.query<{v:number}>(`select count(*)::int v from ${v2}.keys`)).rows[0].v,0);
   }
  });
  await scenario('unknown legacy history imports spent even when current legacy row is false/empty',async()=>{
   await db.exec(renderRetentionTransferSQL(source,destination,{...context,legacyHistory:'unknown'}));assert.equal(await spent(),true);
   assert.equal((await db.query<{v:string}>(`select legacy_classification v from ${v2}.transfer_claim`)).rows[0].v,'spent-or-unknown');
  });
  await scenario('already used source stays spent and request metadata is erased rather than copied',async()=>{
   await db.exec(`update ${v1}.total set consumed=true,finished=true,request_id='${R}',payload_hash=repeat('b',64),duration_ms=5000,consumed_at=clock_timestamp()`);
   await db.exec(sql());assert.equal(await spent(),true);assert.deepEqual(await old(),{consumed:true,request_id:null,payload_hash:null,duration_ms:null,consumed_at:null,finished:true});
   assert.equal((await db.query<{v:number}>(`select count(*)::int v from ${v2}.receipt`)).rows[0].v,0);
  });
  await scenario('false marker with nonempty metadata or finished flag is not fabricated as unused',async()=>{
   for(const patch of ["finished=true",`request_id='${R}'`,"payload_hash=repeat('b',64)","duration_ms=1","consumed_at=clock_timestamp()"]){
    await reset();await db.exec(`update ${v1}.total set ${patch}`);await db.exec(sql());assert.equal(await spent(),true,patch);
   }
  });
  await scenario('rerunning transfer cannot clear used or unused initialized destination',async()=>{
   await db.exec(sql());const claim=(await db.query(`select * from ${v2}.transfer_claim`)).rows;
   for(const used of [false,true]){await db.query(`update ${v2}.total set consumed=$1`,[used]);await rejectTransfer(sql(),/already exists/);assert.equal(await spent(),used);assert.deepEqual((await db.query(`select * from ${v2}.transfer_claim`)).rows,claim);}
  });
  await scenario('a separately committed pristine install may not be inferred as fresh and reset',async()=>{
   await db.exec(destination);const snapshot=await before();await rejectTransfer(sql(),/already exists/);assert.equal(await spent(),true);assert.equal(await before(),snapshot);
  });
  await scenario('loss of synthetic destination cannot recover unused credit from a permanently retired source',async()=>{
   await db.exec(sql());assert.equal(await spent(),false);await db.exec(`drop schema ${v2} cascade`);
   // Failure/recovery exploration only, not an automatic production retry plan.
   await db.exec(sql());assert.equal(await spent(),true);assert.equal((await old()).consumed,true);
   assert.equal((await db.query<{v:string}>(`select legacy_classification v from ${v2}.transfer_claim`)).rows[0].v,'spent-or-unknown');
  });
  await scenario('missing legacy singleton aborts without creating target or inventing budget',async()=>{
   for(const table of ['total','policy']){await reset();await db.exec(`delete from ${v1}.${table}`);await rejectTransfer(sql(),/singleton/);assert.equal(await exists(),false);}
  });
  await scenario('enabled old policy or key blocks transfer instead of implicitly changing admission',async()=>{
   await db.exec(`update ${v1}.policy set enabled=true`);const snapshot=await before();await rejectTransfer(sql(),/disabled/);assert.equal(await before(),snapshot);assert.equal(await exists(),false);
   await reset();await db.exec(`insert into ${v1}.keys values('synthetic','${R}',true)`);await rejectTransfer(sql(),/disabled/);assert.equal(await exists(),false);
  });
  await scenario('partial failure after fresh install rolls back DDL and legacy changes',async()=>{
   const snapshot=await before(),bad=sql().replace('create table yeoni_speech_retention_candidate.transfer_claim',"do $failure$begin raise exception 'Synthetic failure after install';end $failure$;\ncreate table yeoni_speech_retention_candidate.transfer_claim");
   await rejectTransfer(bad,/Synthetic failure/);assert.equal(await exists(),false);assert.equal(await before(),snapshot);
  });
  await scenario('failure after retirement/bootstrap rolls back ALL changes, including erased synthetic metadata',async()=>{
   await db.exec(`update ${v1}.total set consumed=true,request_id='${R}',payload_hash=repeat('c',64),duration_ms=5,consumed_at=clock_timestamp()`);const snapshot=await before();
   const bad=sql().replace('end $transfer$;\ncommit;','end $transfer$;\ndo $failure$begin raise exception \'Synthetic failure after handoff\';end $failure$;\ncommit;');
   await rejectTransfer(bad,/Synthetic failure/);assert.equal(await exists(),false);assert.equal(await before(),snapshot);
  });
  await scenario('committed response loss does not authorize rerun or reset',async()=>{
   await assert.rejects((async()=>{await db.exec(sql());throw Error('Synthetic commit ack lost');})(),/ack lost/);assert.equal(await exists(),true);assert.equal(await spent(),false);
   await rejectTransfer(sql(),/already exists/);assert.equal(await spent(),false);assert.equal((await old()).consumed,true);
  });
  await scenario('disabled proof reference is retained without copying/reading a secret into new schema',async()=>{
   await db.exec(`insert into ${v1}.keys values('synthetic','${R}',false);update ${v1}.policy set active_key_id='synthetic'`);await db.exec(sql());
   assert.deepEqual((await db.query(`select key_id,enabled from ${v1}.keys`)).rows,[{key_id:'synthetic',enabled:false}]);
   assert.equal((await db.query<{v:number}>(`select count(*)::int v from ${v2}.keys`)).rows[0].v,0);
  });
  await scenario('current exact old consume cannot reserve again even if synthetic policy/key are later reenabled',async()=>{
   await db.exec(sql());
   const key=new Uint8Array(32).fill(7),audio='b'.repeat(64),duration=5000;
   await db.query('insert into vault.decrypted_secrets values($1,$2)',[R,Buffer.from(key).toString('base64')]);
   await db.exec(`insert into ${v1}.keys values('synthetic','${R}',true);update ${v1}.policy set enabled=true,allowed_owner='${A}',active_key_id='synthetic',policy_id='trial-metadata-policy-v1',api_boundary_reviewed_at=now()`);
   const payload=(await db.query<{v:string}>(`select ${v1}.payload($1,$2,$3) v`,[duration,'こんにちは。',audio])).rows[0].v;
   const proof=createSpeechServerProof({action:'consume',keyId:'synthetic',owner:A,requestId:S,payloadHash:payload},key);
   await db.query("select set_config('test.owner',$1,false)",[A]);await db.exec('set role authenticated');
   try{assert.equal((await db.query<{v:string}>(`select ${v1}.consume($1,$2,$3,$4,$5,$6,$7,$8) v`,[S,duration,'こんにちは。',audio,proof.issuedAt,proof.expiresAt,proof.keyId,proof.mac])).rows[0].v,'limit');}finally{await db.exec('reset role');}
   assert.equal(await spent(),false);assert.equal((await old()).consumed,true);
  });
  await scenario('exact legacy function drift aborts before mutation',async()=>{
   const body=(await db.query<{v:string}>(`select pg_get_functiondef('${v1}.ready(uuid,bigint,bigint,text,text)'::regprocedure) v`)).rows[0].v;
   const changed=body.replace(`return exists(select 1 from ${v1}.total where singleton and not consumed);`,'return true;');assert.notEqual(changed,body);await db.exec(changed);
   try{const snapshot=await before();await rejectTransfer(sql(),/contract drift/);assert.equal(await exists(),false);assert.equal(await before(),snapshot);}finally{await db.exec(body);}
  });
  await scenario('legacy direct table reset privilege or private helper exposure aborts without a transfer',async()=>{
   for(const grant of [`grant update on ${v1}.total to authenticated`,`grant execute on function ${v1}.payload(integer,text,text) to authenticated`]){
    const revoke=grant.replace(/^grant /,'revoke ').replace(/ to authenticated$/,' from authenticated');await db.exec(grant);
    try{const snapshot=await before();await rejectTransfer(sql(),/legacy API/);assert.equal(await exists(),false);assert.equal(await before(),snapshot);}finally{await db.exec(revoke);}
   }
  });
 }finally{await db.close();}
});
