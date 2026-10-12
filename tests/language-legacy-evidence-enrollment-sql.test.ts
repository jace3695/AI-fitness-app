/** Actual additive SQL on disposable single-connection PGlite; not locking/Auth/hosted acceptance. */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createLegacyEvidenceSqlFixture, readSql, LEGACY_EVIDENCE_ENROLLMENT_MIGRATION } from './helpers/legacy-evidence-sql.ts';
import { LEGACY_EVIDENCE_MANIFEST_DIGEST as digest, LEGACY_EVIDENCE_MANIFEST_RELEASE as release, SERVER_EVIDENCE_PROTOCOL as protocol } from '../lib/language-legacy-evidence/identity-manifest.ts';

type Marker={present:boolean;value:unknown};
type Context={ownerId:string;generationId:string;resetMarker:Marker;studyDayTimezone:string;protocol:string;manifestRelease:string;manifestDigest:string;highWater:number;prospectiveStartedAt:string;serverTime:string};
type Enrollment={creationRequestId:string;initialGenerationId:string};
type Status={version:1;status:'unenrolled'|'enrolled'|'enrolled_generation_missing';ownerId:string;protocol:string;manifestRelease:string;manifestDigest:string;statePresent:true;resetMarker:Marker;enrollment:Enrollment|null;currentContext:Context|null};
type Receipt=Enrollment & {version:1;status:'enrolled'|'existing_enrollment';currentContext:Context};
const absent={present:false,value:null};
const writeEntries=[
 'public.get_language_legacy_evidence_context(uuid,jsonb,text,text,text)',
 'language_legacy_evidence_private.get_context(uuid,jsonb,text,text,text)',
 'public.enroll_language_legacy_evidence_v1(uuid,uuid,jsonb,text,text,text,text)',
 'language_legacy_evidence_private.enroll_v1(uuid,uuid,jsonb,text,text,text,text)',
 'public.append_language_legacy_evidence(uuid,uuid,text,uuid,text,jsonb,text[])',
 'language_legacy_evidence_private.append_events(uuid,uuid,text,uuid,text,jsonb,text[])',
];
let f:Awaited<ReturnType<typeof createLegacyEvidenceSqlFixture>>,owner:string,other:string;
before(async()=>{f=await createLegacyEvidenceSqlFixture();});
after(async()=>{await f.close();});
beforeEach(async()=>{
 await f.db.exec(`reset role; revoke all on function ${writeEntries.join(',')} from public,anon,authenticated,service_role; truncate auth.users cascade;`);
 other=await f.addOwner();owner=await f.addOwner();
});
async function activate() {
 await f.db.exec(`reset role; grant execute on function ${writeEntries.join(',')} to authenticated;`);
 await f.asOwner(owner);
}
function request(nonce=randomUUID(),changes:Record<string,unknown>={}) {
 return {expected_owner:owner,creation_request_id:nonce,expected_marker:absent,proposed_timezone:'UTC',protocol,manifest_release:release,manifest_digest:digest,...changes};
}
async function enroll(args:Record<string,unknown>=request()) { return await f.rpc('enroll_language_legacy_evidence_v1',args) as Receipt; }
async function status(marker?:Marker) { return await f.rpc('read_language_legacy_evidence_status',{expected_owner:owner,...marker===undefined?{}:{expected_marker:marker}}) as Status; }
async function counts() {
 await f.db.exec('reset role');
 const result=(await f.db.query<{w:number;g:number;e:number}>(`select (select count(*)::int from public.language_legacy_evidence_enrollments) w,(select count(*)::int from public.language_legacy_evidence_generations) g,(select count(*)::int from public.language_legacy_evidence_events) e`)).rows[0];
 await f.asOwner(owner);return result;
}
async function loseGeneration() {
 await f.db.query('delete from public.language_user_state where user_id=$1',[owner]);
 await f.db.query("insert into public.language_user_state(user_id,state) values($1,'{}')",[owner]);
}

test('installation denies every public/private initializer, enrollment and append entry but preserves authenticated read/status/reset',async()=>{
 await f.db.exec('reset role');
 for(const role of ['authenticated','anon','service_role']) for(const entry of writeEntries) {
  assert.equal((await f.db.query<{allowed:boolean}>('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,entry])).rows[0].allowed,false,`${role}: ${entry}`);
 }
 const functions=(await f.db.query<{name:string;allowed:boolean}>(`select n.nspname||'.'||p.proname name,has_function_privilege('authenticated',p.oid,'EXECUTE') allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='language_legacy_evidence_private' order by p.proname`)).rows;
 assert.deepEqual(functions.filter(x=>x.allowed).map(x=>x.name),['read_context','read_events','read_page','read_status'].map(x=>`language_legacy_evidence_private.${x}`));
 await f.asOwner(owner);
 await assert.rejects(enroll(),/permission denied/);
 await assert.rejects(f.context(owner),/permission denied/);
 for(const entry of ['get_context','enroll_v1','append_events']) {
  const args=entry==='get_context'?[owner,absent,'UTC',protocol,digest]:entry==='enroll_v1'?Object.values(request()):[owner,randomUUID(),digest,randomUUID(),'slot',null,[]];
  await assert.rejects(f.db.query(`select language_legacy_evidence_private.${entry}(${args.map((_,i)=>`$${i+1}`).join(',')})`,args),/permission denied/);
 }
 assert.equal((await status()).status,'unenrolled');
 await assert.rejects(f.rpc('read_language_legacy_evidence_context',{expected_owner:owner,expected_generation:null,manifest_digest:digest}),/legacy_stale_generation/);
 const reset=(await f.db.query<{r:{marker:string}}>("select public.reset_my_app_records('language',$1,'초기화') r",[randomUUID()])).rows[0].r;
 assert.equal((await status({present:true,value:reset.marker})).status,'unenrolled');
 assert.deepEqual(await counts(),{w:0,g:0,e:0});
});

test('status is strict, authenticated and noninitializing, including explicit absent versus JSON-null marker',async()=>{
 assert.deepEqual(await status(),{version:1,status:'unenrolled',ownerId:owner,protocol,manifestRelease:release,manifestDigest:digest,statePresent:true,resetMarker:absent,enrollment:null,currentContext:null});
 await assert.rejects(status({present:true,value:null}),/legacy_marker_conflict/);
 await f.db.query("update public.language_user_state set state='{\"languageRecordResetV1\":null}' where user_id=$1",[owner]);
 assert.deepEqual((await status({present:true,value:null})).resetMarker,{present:true,value:null});
 await assert.rejects(status(absent),/legacy_marker_conflict/);
 await f.asOwner(other);await assert.rejects(status(),/legacy_auth_mismatch/);
 await f.asOwner(null);await assert.rejects(status(),/legacy_auth_mismatch/);
 await f.asOwner(owner);await f.db.query('delete from public.language_user_state where user_id=$1',[owner]);
 await assert.rejects(status(),/legacy_state_not_ready/);
 assert.deepEqual(await counts(),{w:0,g:0,e:0});
 assert.equal((await f.db.query('select * from public.language_user_state')).rows.length,0);
});

test('first enrollment creates one immutable witness and exact current context in the same transaction',async()=>{
 await activate();const args=request(),r=await enroll(args),s=await status();
 assert.equal(r.status,'enrolled');assert.equal(r.creationRequestId,args.creation_request_id);
 assert.equal(r.initialGenerationId,r.currentContext.generationId);assert.equal(r.currentContext.ownerId,owner);
 assert.equal(r.currentContext.studyDayTimezone,'UTC');assert.equal(r.currentContext.highWater,0);
 assert.deepEqual(s.enrollment,{creationRequestId:r.creationRequestId,initialGenerationId:r.initialGenerationId});
 assert.equal(s.currentContext?.generationId,r.initialGenerationId);
 assert.deepEqual(await counts(),{w:1,g:1,e:0});
 await f.db.exec('reset role');
 const columns=(await f.db.query<{column_name:string}>("select column_name from information_schema.columns where table_schema='public' and table_name='language_legacy_evidence_enrollments' order by ordinal_position")).rows.map(x=>x.column_name);
 assert.deepEqual(columns,['owner_id','creation_request_id','initial_generation_id']);
});

test('failed witness insert or rollback never leaves a partial generation or enrollment',async()=>{
 await activate();await f.db.exec('reset role; alter table public.language_legacy_evidence_enrollments add constraint injected_failure check(false);');await f.asOwner(owner);
 await assert.rejects(enroll(),/injected_failure/);assert.deepEqual(await counts(),{w:0,g:0,e:0});
 await f.db.exec('reset role; alter table public.language_legacy_evidence_enrollments drop constraint injected_failure;');await f.asOwner(owner);
 await f.db.exec('begin');await enroll();await f.db.exec('rollback');
 assert.deepEqual(await counts(),{w:0,g:0,e:0});assert.equal((await status()).status,'unenrolled');
});

test('full frozen request validation rejects unsupported or mismatched requests without creating anything',async()=>{
 await activate();
 for(const changes of [{expected_owner:other},{creation_request_id:null},{expected_marker:null},{expected_marker:{present:true,value:null}},{proposed_timezone:'bogus'},{protocol:'future'},{manifest_release:'future'},{manifest_digest:'f'.repeat(64)}]) {
  await assert.rejects(enroll(request(undefined,changes)),/legacy_(auth_mismatch|invalid_enrollment|marker_conflict|unsupported_protocol|unsupported_manifest)/);
  assert.deepEqual(await counts(),{w:0,g:0,e:0});
 }
});

test('lost-response read-first and exact nonce replay attest only their original unrotated context',async()=>{
 await activate();const args=request();await enroll(args);const s=await status();
 assert.equal(s.enrollment?.creationRequestId,args.creation_request_id);assert.equal(s.enrollment?.initialGenerationId,s.currentContext?.generationId);
 const r=await enroll(args);assert.equal(r.status,'enrolled');assert.equal(r.initialGenerationId,s.currentContext?.generationId);
 for(const changes of [{expected_owner:other},{expected_marker:{present:true,value:null}},{proposed_timezone:'Asia/Seoul'},{protocol:'future'},{manifest_release:'future'},{manifest_digest:'f'.repeat(64)}]) {
  await assert.rejects(enroll({...args,...changes}),/legacy_(auth_mismatch|marker_conflict|enrollment_conflict|unsupported_protocol|unsupported_manifest)/);
 }
 assert.deepEqual(await counts(),{w:1,g:1,e:0});
});

test('competing requests report existing enrollment after validation, never first success for a different nonce',async()=>{
 await activate();const first=await enroll(),secondArgs=request();const second=await enroll(secondArgs);
 assert.equal(second.status,'existing_enrollment');assert.equal(second.creationRequestId,first.creationRequestId);
 assert.notEqual(second.creationRequestId,secondArgs.creation_request_id);assert.equal(second.currentContext.generationId,first.initialGenerationId);
 for(const changes of [{expected_owner:other},{expected_marker:{present:true,value:null}},{proposed_timezone:'bogus'},{protocol:'future'},{manifest_release:'future'},{manifest_digest:'f'.repeat(64)}]) {
  await assert.rejects(enroll({...secondArgs,...changes}),/legacy_(auth_mismatch|marker_conflict|invalid_enrollment|unsupported_protocol|unsupported_manifest)/);
 }
});

test('reset rotates only current generation; old enrollment remains stale even after marker rollback',async()=>{
 await activate();const args=request(),first=await enroll(args);const resetId=randomUUID();
 const reset=(await f.db.query<{r:{marker:string}}>("select public.reset_my_app_records('language',$1,'초기화') r",[resetId])).rows[0].r;
 const s=await status({present:true,value:reset.marker});assert.notEqual(s.currentContext?.generationId,first.initialGenerationId);assert.equal(s.enrollment?.initialGenerationId,first.initialGenerationId);
 await assert.rejects(enroll(args),/legacy_marker_conflict/);
 await assert.rejects(enroll({...args,expected_marker:s.resetMarker}),/legacy_enrollment_stale/);
 const newer=await enroll(request(undefined,{expected_marker:s.resetMarker}));assert.equal(newer.status,'existing_enrollment');assert.equal(newer.currentContext.generationId,s.currentContext?.generationId);
 await f.db.query("update public.language_user_state set state='{}' where user_id=$1",[owner]);
 assert.deepEqual((await status()).resetMarker,absent);await assert.rejects(enroll(args),/legacy_enrollment_stale/);
 assert.equal((await status()).enrollment?.initialGenerationId,first.initialGenerationId);
});

test('deleted/reinserted language state keeps loss witness; both initializers refuse recovery; explicit reset cannot invent generation',async()=>{
 await activate();const args=request(),r=await enroll(args);await loseGeneration();
 let s=await status();assert.equal(s.status,'enrolled_generation_missing');assert.equal(s.currentContext,null);assert.equal(s.enrollment?.initialGenerationId,r.initialGenerationId);
 await assert.rejects(enroll(args),/legacy_enrollment_stale/);await assert.rejects(enroll(),/legacy_enrolled_generation_missing/);
 await assert.rejects(f.context(owner),/legacy_enrolled_generation_missing/);
 const reset=(await f.db.query<{r:{marker:string}}>("select public.reset_my_app_records('language',$1,'초기화') r",[randomUUID()])).rows[0].r;
 s=await status({present:true,value:reset.marker});assert.equal(s.status,'enrolled_generation_missing');assert.deepEqual(await counts(),{w:1,g:0,e:0});
});

test('compatibility initializer creates a witness atomically and does not change its response shape',async()=>{
 await activate();const context=await f.context(owner) as Context,s=await status();
 assert.equal(s.status,'enrolled');assert.equal(s.enrollment?.initialGenerationId,context.generationId);
 assert.deepEqual(Object.keys(context).sort(),['ownerId','generationId','resetMarker','prospectiveStartedAt','studyDayTimezone','protocol','manifestRelease','manifestDigest','serverTime','highWater'].sort());
 assert.equal((await f.context(owner,absent,'Asia/Seoul') as Context).studyDayTimezone,'UTC');
 await loseGeneration();await assert.rejects(f.context(owner),/legacy_enrolled_generation_missing/);
});

test('existing A2.1 generations are adopted exactly, with server nonce and no state/event rewrite',async()=>{
 const adoptedOwner=randomUUID(),initial=randomUUID();let before:unknown;
 const fixture=await createLegacyEvidenceSqlFixture({beforeEnrollmentMigration:async db=>{
  await db.query('insert into auth.users(id) values($1)',[adoptedOwner]);
  await db.query("insert into public.language_user_state(user_id,state) values($1,'{\"preserve\":true}')",[adoptedOwner]);
  await db.query('insert into public.language_legacy_evidence_generations(owner_id,generation_id,study_day_timezone,protocol) values($1,$2,$3,$4)',[adoptedOwner,initial,'Asia/Seoul',protocol]);
  before=(await db.query('select * from public.language_legacy_evidence_generations where owner_id=$1',[adoptedOwner])).rows[0];
 }});
 try {
  const after=(await fixture.db.query('select * from public.language_legacy_evidence_generations where owner_id=$1',[adoptedOwner])).rows[0];assert.deepEqual(after,before);
  await fixture.asOwner(adoptedOwner);const s=await fixture.rpc('read_language_legacy_evidence_status',{expected_owner:adoptedOwner}) as Status;
  assert.equal(s.status,'enrolled');assert.equal(s.enrollment?.initialGenerationId,initial);assert.match(s.enrollment!.creationRequestId,/^[0-9a-f-]{36}$/);
  assert.deepEqual((await fixture.db.query<{state:unknown}>('select state from public.language_user_state')).rows[0].state,{preserve:true});
 } finally {await fixture.close();}
});

test('witness ACL is immutable, exact-owner and account cascade is the only normal deletion path',async()=>{
 await activate();await enroll();
 for(const role of ['authenticated','anon','service_role']) {
  await f.db.exec(`reset role; set role ${role}`);
  for(const statement of ['select * from','insert into','update','delete from','truncate']) {
   const sql=statement==='insert into'?'insert into public.language_legacy_evidence_enrollments default values':statement==='update'?'update public.language_legacy_evidence_enrollments set creation_request_id=creation_request_id':`${statement} public.language_legacy_evidence_enrollments`;
   await assert.rejects(f.db.exec(sql),/permission denied/);
  }
 }
 await f.asOwner(other);await f.db.exec('reset role; set role language_legacy_evidence_executor');
 assert.equal((await f.db.query('select * from public.language_legacy_evidence_enrollments')).rows.length,0);
 await assert.rejects(f.db.query('insert into public.language_legacy_evidence_enrollments values($1,$2,$3)',[owner,randomUUID(),randomUUID()]),/row-level security/);
 await assert.rejects(f.db.exec('update public.language_legacy_evidence_enrollments set creation_request_id=gen_random_uuid()'),/permission denied/);
 await assert.rejects(f.db.exec('delete from public.language_legacy_evidence_enrollments'),/permission denied/);
 await f.db.exec("reset role; set app.test_user=''; set role synthetic_auth_admin");await f.db.query('delete from auth.users where id=$1',[owner]);
 assert.deepEqual(await counts(),{w:0,g:0,e:0});
});

test('R4 witness probe is key-only and enforces exact owner even after generation loss',async()=>{
 await activate();await enroll();await loseGeneration();
 await f.db.exec("reset role; set app.test_user=''; set role language_legacy_evidence_reset_executor");
 assert.deepEqual((await f.db.query<{owner_id:string}>('select owner_id from public.language_legacy_evidence_enrollments')).rows,[{owner_id:owner}]);
 for(const column of ['creation_request_id','initial_generation_id']) await assert.rejects(f.db.query(`select ${column} from public.language_legacy_evidence_enrollments`),/permission denied/);
 for(const verb of ['update public.language_legacy_evidence_enrollments set owner_id=owner_id','delete from public.language_legacy_evidence_enrollments']) await assert.rejects(f.db.exec(verb),/permission denied/);
 for(const claim of ['',other]) {
  await f.db.exec('reset role');await f.db.query("select set_config('app.test_user',$1,false)",[claim]);
  await assert.rejects(f.db.query("update public.language_user_state set state='{\"languageRecordResetV1\":\"bad\"}' where user_id=$1",[owner]),/legacy_auth_mismatch/);
  await f.db.query("update public.language_user_state set state='{\"languageRecordResetV1\":\"unenrolled-ok\"}' where user_id=$1",[other]);
 }
 await f.asOwner(owner);await f.db.query("update public.language_user_state set state='{\"languageRecordResetV1\":\"owner-ok\"}' where user_id=$1",[owner]);
 assert.equal((await status()).status,'enrolled_generation_missing');assert.deepEqual(await counts(),{w:1,g:0,e:0});
});

test('status rejects inconsistent generation marker or protocol metadata instead of labeling absence unenrolled',async()=>{
 await activate();await enroll();await f.db.exec('reset role');
 await f.db.query("update public.language_legacy_evidence_generations set reset_marker='\"mismatch\"' where owner_id=$1",[owner]);
 await f.asOwner(owner);await assert.rejects(status(),/legacy_enrollment_integrity/);
 await f.db.exec('reset role');await f.db.query('update public.language_legacy_evidence_generations set reset_marker=null,study_day_timezone=$1 where owner_id=$2',['invalid-zone',owner]);
 await f.asOwner(owner);await assert.rejects(status(),/legacy_enrollment_integrity/);
});

test('status refuses a witness-less generation inside an uncommitted deferred-FK transaction',async()=>{
 await f.db.exec('reset role; begin');
 await f.db.query('insert into public.language_legacy_evidence_generations(owner_id,study_day_timezone,protocol) values($1,$2,$3)',[owner,'UTC',protocol]);
 await f.asOwner(owner);await assert.rejects(status(),/legacy_enrollment_integrity/);
 await f.db.exec('rollback');assert.deepEqual(await counts(),{w:0,g:0,e:0});
});

test('deferred owner FK rejects a queued legacy witness-less generation at commit and never binds initial generation to rotation',async()=>{
 await f.db.exec('reset role; begin');
 await f.db.query('insert into public.language_legacy_evidence_generations(owner_id,study_day_timezone,protocol) values($1,$2,$3)',[owner,'UTC',protocol]);
 await assert.rejects(f.db.exec('commit'),/legacy_evidence_generation_enrollment_owner_fk/);
 await f.db.exec('rollback');await f.asOwner(owner);assert.deepEqual(await counts(),{w:0,g:0,e:0});
 await f.db.exec('reset role');
 const constraints=(await f.db.query<{condeferrable:boolean;condeferred:boolean;definition:string}>("select condeferrable,condeferred,pg_get_constraintdef(oid) definition from pg_constraint where conname='legacy_evidence_generation_enrollment_owner_fk'")).rows;
 assert.equal(constraints.length,1);assert.equal(constraints[0].condeferrable,true);assert.equal(constraints[0].condeferred,true);assert.match(constraints[0].definition,/FOREIGN KEY \(owner_id\) REFERENCES language_legacy_evidence_enrollments\(owner_id\)/);
 assert.equal((await f.db.query("select * from pg_constraint where conrelid='public.language_legacy_evidence_enrollments'::regclass and contype='f' and pg_get_constraintdef(oid) like '%initial_generation_id%'")).rows.length,0);
});

test('new private definers keep exact narrow ownership and hardened paths without broad helper grants',async()=>{
 await f.db.exec('reset role');
 const funcs=(await f.db.query<{proname:string;owner:string;proconfig:string[];prosecdef:boolean}>("select p.proname,r.rolname owner,p.proconfig,p.prosecdef from pg_proc p join pg_roles r on r.oid=p.proowner join pg_namespace n on n.oid=p.pronamespace where n.nspname='language_legacy_evidence_private' and p.proname in ('read_status','enroll_v1','get_context','marker_reset')")).rows;
 assert.equal(funcs.length,4);assert.ok(funcs.every(x=>x.prosecdef&&x.proconfig.includes('search_path=""')&&x.owner===(x.proname==='marker_reset'?'language_legacy_evidence_reset_executor':'language_legacy_evidence_executor')));
 const table=(await f.db.query<{relrowsecurity:boolean;relforcerowsecurity:boolean;owner:string}>("select c.relrowsecurity,c.relforcerowsecurity,r.rolname owner from pg_class c join pg_roles r on r.oid=c.relowner where c.oid='public.language_legacy_evidence_enrollments'::regclass")).rows[0];
 assert.equal(table.relrowsecurity,true);assert.equal(table.relforcerowsecurity,true);assert.ok(!table.owner.startsWith('language_legacy_evidence_'));
 assert.equal((await f.db.query("select * from pg_auth_members m join pg_roles r on r.oid=m.member or r.oid=m.roleid where r.rolname like 'language_legacy_evidence_%'")).rows.length,0);
 const sql=readSql(`supabase/migrations/${LEGACY_EVIDENCE_ENROLLMENT_MIGRATION}`);const trigger=sql.slice(sql.indexOf('create or replace function language_legacy_evidence_private.marker_reset()'),sql.indexOf('create function public.read_language_legacy_evidence_status'));
 assert.doesNotMatch(trigger,/pg_advisory/);assert.doesNotMatch(sql,/bypassrls|grant\s+.*\s+to\s+service_role/i);
});
