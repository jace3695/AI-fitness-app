import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {createSpeechRetentionScheduledRunner,SPEECH_RETENTION_FINALIZE_SQL} from './speech-retention-scheduled.ts';
import {speechRetentionPolicyHash} from './speech-retention-proof.ts';
const schema='yeoni_speech_retention_candidate',G='00000000-0000-4000-8000-000000000009',H='00000000-0000-4000-8000-000000000008',A='00000000-0000-4000-8000-000000000001',R='00000000-0000-4000-8000-000000000003';
const sql=readFileSync(new URL('../docs/azure-pronunciation-usage/retention-contract-candidate.sql',import.meta.url),'utf8');
type Lease={policyHash:string;generation:string;token:string|null;dueAtMs:number;deadlineAtMs:number|null;validUntilMs:number|null;deletedRows:number};
test('nominal-due certified health gate uses actual isolated SQL, no live scheduler or database',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});
 try{
  await db.exec(`create schema extensions;create extension pgcrypto with schema extensions;create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.owner',true),'')::uuid$$;insert into auth.users values('${A}');create schema vault;create table vault.decrypted_secrets(id uuid primary key,decrypted_secret text);`);
  await db.exec(sql);
  const policy={metadataRetentionSeconds:120,authorizationExpiresAt:Math.floor(Date.now()/1000)+3600,reviewArtifactSHA256:'b'.repeat(64),cleanupIntervalSeconds:1,cleanupStartDelaySeconds:10,cleanupRunTimeoutSeconds:5};
  const hash=speechRetentionPolicyHash(policy),now=async()=>(await db.query<{n:number}>('select floor(extract(epoch from clock_timestamp())*1000)::float8 n')).rows[0].n;
  const ready=async()=>(await db.query<{r:boolean}>(`select coalesce(${schema}.cleanup_ready($1),false) r`,[hash])).rows[0].r;
  const begin=async(due:number,generation=G,h=hash)=>(await db.query<{r:Lease}>(`select ${schema}.maintenance_begin($1,$2,$3) r`,[h,generation,due])).rows[0].r;
  const finish=async(l:Lease,healthy=true,generation=G,token=l.token,h=hash)=>(await db.query<{r:{confirmed:boolean;validUntilMs:number|null}}>(`select ${schema}.maintenance_finalize($1,$2,$3,$4,$5) r`,[h,generation,token,l.dueAtMs,healthy])).rows[0].r;
  const health=async()=>(await db.query<{state:string;healthy_until_ms:number|null;attempt_token:string|null}>(`select state,healthy_until_ms::float8,attempt_token from ${schema}.cleanup_health`)).rows[0];
  const spent=async()=>(await db.query<{r:boolean}>(`select consumed r from ${schema}.total`)).rows[0].r;
  async function configure(due:number){
   await db.query(`update ${schema}.policy set metadata_retention_seconds=120,authorization_expires_at=to_timestamp($1),review_artifact_sha256=$2,cleanup_interval_seconds=1,cleanup_start_delay_seconds=10,cleanup_run_timeout_seconds=5,cleanup_schedule_generation=$3`,[policy.authorizationExpiresAt,policy.reviewArtifactSHA256,G]);
   await db.query(`update ${schema}.cleanup_health set policy_hash=$1,generation=$2,next_due_ms=$3,state='closed'`,[hash,G,due]);
  }
  async function scenario(name:string,run:(due:number)=>Promise<void>){await t.test(name,async()=>{await db.exec('begin');try{const due=await now();await configure(due);await run(due);}finally{await db.exec('rollback;reset role');}});}
  await t.test('installation has no chosen schedule/generation/health and no API maintenance authority',async()=>{
   assert.equal(await ready(),false);assert.equal(await spent(),true);
   assert.deepEqual((await db.query(`select policy_hash,generation,next_due_ms,state from ${schema}.cleanup_health`)).rows[0],{policy_hash:null,generation:null,next_due_ms:null,state:'unconfigured'});
   for(const role of ['anon','authenticated','service_role']){
    assert.equal((await db.query<{r:boolean}>("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') r",[role,`${schema}.cleanup_health`])).rows[0].r,false);
    for(const fn of ['cleanup_ready(text)','maintenance_begin(text,uuid,bigint)','maintenance_finalize(text,uuid,uuid,bigint,boolean)'])assert.equal((await db.query<{r:boolean}>("select has_function_privilege($1,$2,'EXECUTE') r",[role,`${schema}.${fn}`])).rows[0].r,false);
   }
  });
  await scenario('normal begin closes readiness; exact finalize certifies nominal due not completion time',async due=>{
   assert.equal(await ready(),false);const l=await begin(due);assert.ok(l.token);assert.equal(l.validUntilMs,due+16000);assert.ok(l.deadlineAtMs!<=due+15000);assert.equal(await ready(),false);
   assert.deepEqual(await finish(l),{confirmed:true,validUntilMs:due+16000});assert.equal(await ready(),true);assert.equal(await spent(),true);
  });
  await scenario('recent legacy maintenance or standalone purge cannot manufacture certified health',async()=>{
   const r=(await db.query<{r:{policyHash:string}}>(`select ${schema}.maintenance($1) r`,[hash])).rows[0].r;assert.equal(r.policyHash,hash);assert.equal(await ready(),false);
   await db.exec(`select ${schema}.purge_expired()`);assert.equal(await ready(),false);assert.equal(await spent(),true);
  });
  await scenario('delayed, skipped, future and invalid nominal ticks cannot open readiness',async due=>{
   for(const target of [due-10001,due+1000,due-1000]){
    await db.exec('savepoint tick');if(target===due-10001)await db.query(`update ${schema}.cleanup_health set next_due_ms=$1`,[target]);
    const l=await begin(target);assert.equal(l.token,null);assert.equal(await ready(),false);await db.exec('rollback to tick;release tick');
   }
  });
  await scenario('replayed or overlapping begin invalidates old attempt and cannot reuse its finalize',async due=>{
   const first=await begin(due);assert.ok(first.token);assert.equal((await begin(due)).token,null);assert.equal((await finish(first)).confirmed,false);assert.equal(await ready(),false);
  });
  await scenario('successful finalize cannot be replayed to extend its finite lease',async due=>{
   const l=await begin(due);assert.equal((await finish(l)).confirmed,true);const before=await health();assert.equal((await finish(l)).confirmed,false);assert.deepEqual(await health(),before);assert.equal(await ready(),true);
  });
  await scenario('wrong token/generation cannot finalize an active attempt or revoke a newer certificate',async due=>{
   const l=await begin(due);assert.equal((await finish(l,true,H)).confirmed,false);assert.equal((await finish(l,true,G,H)).confirmed,false);assert.equal((await finish(l)).confirmed,true);
   const before=await health();assert.equal((await begin(due,H)).token,null);assert.deepEqual(await health(),before);
  });
  await scenario('generation rotation fences old token even when policy hash is unchanged (ABA)',async due=>{
   const l=await begin(due);await db.query(`update ${schema}.policy set cleanup_schedule_generation=$1`,[H]);await db.query(`update ${schema}.cleanup_health set generation=$1,state='closed',attempt_token=null,healthy_until_ms=null`,[H]);
   assert.equal((await finish(l)).confirmed,false);assert.equal(await ready(),false);assert.equal(await spent(),true);
  });
  await scenario('local unhealthy report and elapsed original deadline both stay closed',async due=>{
   const l=await begin(due);assert.equal((await finish(l,false)).confirmed,false);assert.equal(await ready(),false);
   await db.query(`update ${schema}.cleanup_health set next_due_ms=$1`,[due]);const again=await begin(due);assert.ok(again.token);
   await db.query(`update ${schema}.cleanup_health set attempt_deadline_ms=$1`,[(await now())-1]);assert.equal((await finish(again)).confirmed,false);assert.equal(await ready(),false);
  });
  await scenario('null/inconsistent lease cannot pass or be implicitly repaired by repeated readiness reads',async due=>{
   for(const patch of ['attempt_started_ms=null','attempt_deadline_ms=null','last_observed_ms=null',`attempt_started_ms=${due-1}`,`attempt_deadline_ms=${due+15001}`,`last_observed_ms=${due-1}`]){
    await db.exec('savepoint malformed');const l=await begin(due);assert.ok(l.token);await db.exec(`update ${schema}.cleanup_health set ${patch}`);
    assert.equal((await finish(l)).confirmed,false);assert.equal(await ready(),false);await db.exec('rollback to malformed;release malformed');
   }
   await db.exec('savepoint malformed_healthy');const completed=await begin(due);assert.equal((await finish(completed)).confirmed,true);
   await db.exec(`update ${schema}.cleanup_health set last_observed_ms=null`);
   assert.equal(await ready(),false);assert.equal(await ready(),false);assert.equal((await health()).state,'faulted');
   await db.exec('rollback to malformed_healthy;release malformed_healthy');
  });
  await scenario('no traffic does not renew health or imply deletion: expired lease closes by DB time',async due=>{
   const l=await begin(due);await finish(l);const expired=(await now())-16001;
   // Synthetic time passage encoded in an internally consistent prior certificate;
   // no scheduler/timer is run and no clock dependency is replaced.
   await db.query(`update ${schema}.cleanup_health set last_due_ms=$1::bigint,next_due_ms=$1::bigint+1000,healthy_until_ms=$1::bigint+16000,attempt_started_ms=$1::bigint,attempt_deadline_ms=$1::bigint+5000,last_observed_ms=$1::bigint+1`,[expired]);
   assert.equal(await ready(),false);assert.equal(await spent(),true);
  });
  await scenario('observed DB clock regression latches fault and cannot silently become healthy',async due=>{
   const l=await begin(due);await finish(l);await db.query(`update ${schema}.cleanup_health set last_observed_ms=$1`,[(await now())+1000]);assert.equal(await ready(),false);assert.equal((await health()).state,'faulted');assert.equal((await begin(due)).token,null);assert.equal(await ready(),false);
  });
  await scenario('inner purge exception preserves outer closed state rather than rolling it back',async due=>{
   const firstDue=due-1000;await db.query(`update ${schema}.cleanup_health set next_due_ms=$1`,[firstDue]);const l=await begin(firstDue);await finish(l);assert.equal(await ready(),true);
   await db.query(`insert into ${schema}.receipt values(true,$1,$2,repeat('a',64),1000,now()-interval '121 seconds',now()-interval '1 second')`,[A,R]);
   await db.exec(`create function public.synthetic_purge_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic purge failure';end$$;create trigger synthetic_purge_failure before delete on ${schema}.receipt for each row execute function public.synthetic_purge_failure()`);
   const failed=await begin(due);assert.equal(failed.token,null);assert.equal(await ready(),false);assert.equal((await health()).state,'closed');assert.equal(await spent(),true);
   assert.equal((await db.query<{n:number}>(`select count(*)::int n from ${schema}.receipt`)).rows[0].n,1);
  });
  await scenario('policy/key OFF allows metadata purge but never restores the consumed marker',async due=>{
   await db.query(`insert into ${schema}.receipt values(true,$1,$2,repeat('a',64),1000,now()-interval '121 seconds',now()-interval '1 second')`,[A,R]);
   const l=await begin(due);assert.equal(l.deletedRows,1);assert.equal(await spent(),true);assert.equal((await db.query<{n:number}>(`select count(*)::int n from ${schema}.receipt`)).rows[0].n,0);
  });
  await scenario('hard account delete removes policy and clears its operational generation, never the consumed marker',async due=>{
   await db.query(`update ${schema}.policy set allowed_owner=$1`,[A]);const l=await begin(due);await finish(l);await db.query('delete from auth.users where id=$1',[A]);assert.equal(await ready(),false);assert.equal(await spent(),true);assert.equal((await db.query<{n:number}>(`select count(*)::int n from ${schema}.cleanup_health`)).rows[0].n,1);assert.deepEqual((await db.query(`select policy_hash,generation,next_due_ms,last_due_ms,attempt_token,attempt_started_ms,attempt_deadline_ms,healthy_until_ms,last_observed_ms,state from ${schema}.cleanup_health`)).rows[0],{policy_hash:null,generation:null,next_due_ms:null,last_due_ms:null,attempt_token:null,attempt_started_ms:null,attempt_deadline_ms:null,healthy_until_ms:null,last_observed_ms:null,state:'unconfigured'});
  });
  await scenario('policy deletion with null/other generation cannot erase newer schedule state',async due=>{
   const l=await begin(due);await finish(l);for(const generation of [null,H]){
    await db.exec('savepoint deletion');await db.query(`update ${schema}.policy set cleanup_schedule_generation=$1`,[generation]);await db.exec(`delete from ${schema}.policy`);assert.equal((await health()).state,'healthy');assert.equal(await ready(),false);assert.equal(await spent(),true);await db.exec('rollback to deletion;release deletion');
   }
  });
  await scenario('discarded finalize response does not imply SQL state rollback; certificate remains finite',async due=>{
   const l=await begin(due);await finish(l); // Discard SQL acknowledgement in this rollback-isolated scenario; autocommit is covered below.
   assert.equal(await ready(),true);assert.equal((await health()).healthy_until_ms,due+16000);assert.equal((await finish(l)).confirmed,false);assert.equal((await health()).healthy_until_ms,due+16000);
  });
  await t.test('actual new runner/bridge plus separately autocommitted PGlite calls, including lost finalize acknowledgement',async()=>{
   for(const lose of [false,true]){
    const due=await now();await configure(due);let calls=0;
    const runner=createSpeechRetentionScheduledRunner({policyHash:hash,generation:G,intervalSeconds:1,startDelaySeconds:10,runTimeoutSeconds:5},{
     clock:()=>({wallTimeMs:due,monotonicTimeMs:1000}),timers:{setTimeout:()=>1,clearTimeout(){}},
     execute:async(statement,values,signal)=>{signal.throwIfAborted();calls++;const rows=(await db.query(statement,[...values])).rows;if(lose&&statement===SPEECH_RETENTION_FINALIZE_SQL)throw Error('synthetic committed response lost');return rows;},
    });
    try{
     const result=await runner.tick(due);assert.equal(calls,2);assert.equal(result.healthy,!lose);assert.equal(result.finalizeOutcome,lose?'unknown':'confirmed');
     assert.equal(await ready(),true);assert.equal((await health()).healthy_until_ms,due+16000);assert.equal(await spent(),true);
    }finally{runner.dispose();}
   }
  });
  await t.test('autocommit purge failure durably closes a prior certificate without refunding consumption',async()=>{
   const due=await now();await configure(due-1000);const previous=await begin(due-1000);await finish(previous);assert.equal(await ready(),true);
   await db.query(`insert into ${schema}.receipt values(true,$1,$2,repeat('a',64),1000,now()-interval '121 seconds',now()-interval '1 second')`,[A,R]);
   await db.exec(`create function public.autocommit_purge_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic purge failure';end$$;create trigger autocommit_purge_failure before delete on ${schema}.receipt for each row execute function public.autocommit_purge_failure()`);
   assert.equal((await begin(due)).token,null);assert.equal(await ready(),false);assert.equal((await health()).state,'closed');assert.equal(await spent(),true);
  });
 }finally{await db.close();}
});
