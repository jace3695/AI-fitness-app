// Synthetic, in-memory SQL only. No live server, cron extension, role grants,
// credentials or provider. Parent reserves one serial execution slot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
const S='yeoni_speech_retention_candidate';
const baseSQL=readFileSync(new URL('../docs/azure-pronunciation-usage/retention-contract-candidate.sql',import.meta.url),'utf8');
const candidateSQL=readFileSync(new URL('../docs/azure-pronunciation-usage/retention-db-executor-candidate.sql',import.meta.url),'utf8');
const instant=(value:unknown)=>value instanceof Date?value.getTime():new Date(String(value)).getTime();
const A='00000000-0000-4000-8000-000000000001', R='00000000-0000-4000-8000-000000000002', G='00000000-0000-4000-8000-000000000003';
// One instance and sequential subtests, not a concurrent/hosted pg_cron test.
test('DB executor candidate: real isolated SQL and separate top-level CALL commits',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});
 const q=async(sql:string,args:unknown[]=[]) => (await db.query<Record<string,unknown>>(sql,args)).rows;
 const call=()=>db.exec(`CALL ${S}.db_executor_tick_candidate()`);
 const snapshot=async()=>({health:(await q(`select state,attempt_token,healthy_until_ms,next_due_ms,last_due_ms from ${S}.cleanup_health`))[0],spent:(await q(`select consumed from ${S}.total`))[0].consumed,receipts:(await q(`select count(*)::int n from ${S}.receipt`))[0].n});
 async function reset(){
  await db.exec(`reset role;set statement_timeout=0;drop trigger if exists fixture_purge_error on ${S}.receipt;delete from ${S}.receipt;update ${S}.policy set enabled=false,allowed_owner=null,active_key_id=null,policy_id=null,metadata_retention_seconds=null,authorization_expires_at=null,review_artifact_sha256=null,api_boundary_reviewed_at=null,deletion_path_reviewed_at=null,cleanup_interval_seconds=null,cleanup_start_delay_seconds=null,cleanup_run_timeout_seconds=null,cleanup_schedule_generation=null;update ${S}.cleanup_health set policy_hash=null,generation=null,next_due_ms=null,last_due_ms=null,attempt_token=null,attempt_started_ms=null,attempt_deadline_ms=null,healthy_until_ms=null,last_observed_ms=null,state='unconfigured'`);
 }
 async function arm(offset=0){
  // Synthetic local values only, not selected live policy/schedule values.
  await db.exec(`update ${S}.policy set metadata_retention_seconds=120,authorization_expires_at=date_trunc('second',clock_timestamp())+interval '1 hour',review_artifact_sha256=repeat('b',64),cleanup_interval_seconds=60,cleanup_start_delay_seconds=10,cleanup_run_timeout_seconds=5,cleanup_schedule_generation='${G}';set statement_timeout='4000ms'`);
  const due=Number((await q(`select floor(extract(epoch from clock_timestamp())*1000)::float8 n`))[0].n)+offset;
  await db.query(`update ${S}.cleanup_health set policy_hash=(select ${S}.policy_hash(metadata_retention_seconds,authorization_expires_at,review_artifact_sha256,cleanup_interval_seconds,cleanup_start_delay_seconds,cleanup_run_timeout_seconds) from ${S}.policy),generation=$1,next_due_ms=$2,state='closed'`,[G,due]);
  return due;
 }
 async function receipt(){await db.query(`insert into ${S}.receipt values(true,$1,$2,repeat('a',64),5000,clock_timestamp()-interval '121 seconds',clock_timestamp()-interval '1 second')`,[A,R]);}
 async function scenario(name:string,fn:()=>Promise<void>){await t.test(name,async()=>{await reset();await fn();assert.equal((await snapshot()).spent,true);});}
 try {
  await db.exec(`create schema extensions;create extension pgcrypto with schema extensions;create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;insert into auth.users values('${A}');create schema vault;create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text);`);
  await db.exec(baseSQL);
  await t.test('inherited default EXECUTE makes candidate installation roll back without broad permission repair',async()=>{
   await db.exec(`create role fixture_executor_inherited nologin;grant fixture_executor_inherited to authenticated;alter default privileges grant execute on functions to fixture_executor_inherited`);
   try{await assert.rejects(db.exec(candidateSQL),/Unexpected API executor access/);}finally{await db.exec('rollback');}
   assert.equal((await q(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname like 'db_executor_%'`,[S]))[0].n,0);
   await db.exec('alter default privileges revoke execute on functions from fixture_executor_inherited;revoke fixture_executor_inherited from authenticated');
  });
  await db.exec(candidateSQL);
  await t.test('actual routine metadata: invoker/no SET driver, private helper permissions, no role installation',async()=>{
   const rows=await q(`select proname,prokind,prosecdef,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and proname like 'db_executor_%' order by proname`,[S]);
   assert.equal(rows.length,3);assert.deepEqual(rows.find(r=>r.prokind==='p'),{proname:'db_executor_tick_candidate',prokind:'p',prosecdef:false,proconfig:null});
   for(const role of ['anon','authenticated','service_role'])for(const fn of ['db_executor_begin_candidate()','db_executor_finalize_candidate(jsonb)','db_executor_tick_candidate()'])assert.equal((await q(`select has_function_privilege($1,$2,'EXECUTE') v`,[role,`${S}.${fn}`]))[0].v,false);
  });
  await scenario('unconfigured policy purges expired metadata while flags OFF, but does not certify or reopen budget',async()=>{
   await receipt();await assert.rejects(call(),/Retention maintenance unconfirmed/);const s=await snapshot();assert.equal(s.receipts,0);assert.equal(s.health.state,'unconfigured');assert.equal(s.health.healthy_until_ms,null);
  });
  await scenario('normal top-level CALL commits purge then finite exact nominal certificate; provider/key remain OFF',async()=>{
   const due=await arm();await receipt();
   await db.exec(`create table public.fixture_phase_observations(phase text,statement_at timestamptz,observed_at timestamptz,configured_timeout text);create function public.fixture_phase_observer() returns trigger language plpgsql as $$begin if new.state in ('running','healthy') then insert into public.fixture_phase_observations values(new.state,statement_timestamp(),clock_timestamp(),current_setting('statement_timeout'));end if;return new;end$$;create trigger fixture_phase_observer after update on ${S}.cleanup_health for each row execute function public.fixture_phase_observer()`);
   try{await call();const phases=await q('select phase,statement_at,observed_at,configured_timeout from public.fixture_phase_observations order by observed_at');assert.equal(phases.length,2);assert.deepEqual(phases.map(r=>r.phase),['running','healthy']);assert.equal(instant(phases[0].statement_at),instant(phases[1].statement_at));assert.ok(instant(phases[1].observed_at)>=instant(phases[0].observed_at));assert.deepEqual(phases.map(r=>r.configured_timeout),['4s','4s']);}
   finally{await db.exec(`drop trigger fixture_phase_observer on ${S}.cleanup_health`);}
   const s=await snapshot();assert.equal(s.receipts,0);assert.equal(s.health.state,'healthy');assert.equal(Number(s.health.healthy_until_ms),due+75000);assert.equal(s.health.attempt_token,null);assert.equal(Number(s.health.next_due_ms),due+60000);
   assert.equal((await q(`select enabled from ${S}.policy`))[0].enabled,false);assert.equal((await q(`select count(*)::int n from ${S}.keys`))[0].n,0);
  });
  await scenario('timeout unset: phase one deletion commits, phase two denies and commits closed',async()=>{
   await arm();await db.exec('set statement_timeout=0');await receipt();await assert.rejects(call(),/Retention maintenance unconfirmed/);const s=await snapshot();assert.equal(s.receipts,0);assert.equal(s.health.state,'closed');assert.equal(s.health.attempt_token,null);
  });
  await scenario('missed nominal due does not catch up to now or renew, but purge commits',async()=>{
   const due=await arm(-20000);await receipt();await assert.rejects(call(),/Retention maintenance unconfirmed/);const s=await snapshot();assert.equal(s.receipts,0);assert.equal(s.health.state,'closed');assert.equal(Number(s.health.next_due_ms),due);assert.equal(s.health.healthy_until_ms,null);
  });
  await scenario('ordinary purge failure preserves previously committed close, no automatic retry or refund',async()=>{
   await arm();await receipt();await db.exec(`update ${S}.cleanup_health set state='healthy',healthy_until_ms=floor(extract(epoch from clock_timestamp())*1000)::bigint+75000;create or replace function public.fixture_purge_error() returns trigger language plpgsql as $$begin raise exception 'synthetic purge failure';end$$;create trigger fixture_purge_error before delete on ${S}.receipt for each row execute function public.fixture_purge_error()`);
   await assert.rejects(call(),/Retention maintenance unconfirmed/);const s=await snapshot();assert.equal(s.receipts,1);assert.equal(s.health.state,'closed');assert.equal(s.health.healthy_until_ms,null);
  });
  await scenario('phase-two ordinary failure does not roll back phase-one purge/closed admission',async()=>{
   await arm();await receipt();await db.exec(`alter function ${S}.db_executor_finalize_candidate(jsonb) rename to fixture_saved_finalize;create function ${S}.db_executor_finalize_candidate(jsonb) returns boolean language plpgsql as $$begin raise exception 'synthetic final failure';end$$`);
   try{await assert.rejects(call(),/Retention maintenance unconfirmed/);const s=await snapshot();assert.equal(s.receipts,0);assert.equal(s.health.state,'running');assert.equal(s.health.healthy_until_ms,null);}
   finally{await db.exec(`drop function ${S}.db_executor_finalize_candidate(jsonb);alter function ${S}.fixture_saved_finalize(jsonb) rename to db_executor_finalize_candidate`);}
  });
  await scenario('phase-two query cancellation escapes OTHERS without rolling back committed purge/closed admission',async()=>{
   await arm();await receipt();await db.exec(`alter function ${S}.db_executor_finalize_candidate(jsonb) rename to fixture_saved_finalize;create function ${S}.db_executor_finalize_candidate(jsonb) returns boolean language plpgsql as $$begin raise exception using errcode='57014',message='Synthetic query cancellation';end$$`);
   try{await assert.rejects(call(),/Synthetic query cancellation/);const s=await snapshot();assert.equal(s.receipts,0);assert.equal(s.health.state,'running');assert.equal(s.health.healthy_until_ms,null);}
   finally{await db.exec(`drop function ${S}.db_executor_finalize_candidate(jsonb);alter function ${S}.fixture_saved_finalize(jsonb) rename to db_executor_finalize_candidate`);}
  });
  await scenario('actual successful final commit plus synthetic acknowledgement loss preserves finite certificate, not rollback',async()=>{
   const due=await arm();await receipt();await assert.rejects((async()=>{await call();throw Error('Synthetic commit acknowledgement lost');})(),/acknowledgement lost/);
   const s=await snapshot();assert.equal(s.receipts,0);assert.equal(s.health.state,'healthy');assert.equal(Number(s.health.healthy_until_ms),due+75000);assert.equal(s.health.attempt_token,null);
  });
  await scenario('CALL within explicit transaction cannot COMMIT; rollback is not claimed as committed deletion',async()=>{
   await arm();await receipt();await db.exec('begin');try{await assert.rejects(call(),/invalid transaction termination/);}finally{await db.exec('rollback');}const s=await snapshot();assert.equal(s.receipts,1);assert.equal(s.health.state,'closed');
  });
  await scenario('SECURITY DEFINER or procedure SET clause prohibits transaction control',async()=>{
   await db.exec(`create procedure public.fixture_definer_commit() language plpgsql security definer as $$begin commit;end$$;create procedure public.fixture_set_commit() language plpgsql set search_path='' as $$begin commit;end$$;`);
   await assert.rejects(db.exec('call public.fixture_definer_commit()'),/invalid transaction termination/);await assert.rejects(db.exec('call public.fixture_set_commit()'),/invalid transaction termination/);
  });
  await scenario('worker restart/repeat before next due cannot silently rearm healthy lease',async()=>{
   await arm();await call();await assert.rejects(call(),/Retention maintenance unconfirmed/);const s=await snapshot();assert.equal(s.health.state,'closed');assert.equal(s.health.healthy_until_ms,null);
  });
 } finally {await db.close();}
});
