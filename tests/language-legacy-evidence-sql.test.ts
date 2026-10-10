import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createLegacyEvidenceSqlFixture, readSql, LEGACY_EVIDENCE_MIGRATION } from './helpers/legacy-evidence-sql.ts';
import { LEGACY_EVIDENCE_CATALOGUE } from '../lib/language-legacy-evidence/catalogue.ts';
import { LEGACY_EVIDENCE_MANIFEST_CANONICAL, LEGACY_EVIDENCE_MANIFEST_DIGEST as digest, LEGACY_EVIDENCE_MANIFEST_RELEASE, SERVER_EVIDENCE_PROTOCOL } from '../lib/language-legacy-evidence/identity-manifest.ts';
import { canonicalEvidence, makeSourceSlotKey } from '../lib/language-legacy-evidence/validation.ts';
import type { EvidenceEvent } from '../lib/language-legacy-evidence/types.ts';
import type { Predecessor } from '../lib/language-legacy-evidence/persistence-types.ts';
import { context as goldenContext, episode as goldenEpisode, typedTask, uuid } from '../lib/language-legacy-evidence/test-fixtures.ts';
type Context = { ownerId:string;generationId:string;prospectiveStartedAt:string;studyDayTimezone:string;highWater:number;serverTime:string;resetMarker:{present:boolean;value:unknown};manifestDigest:string;manifestRelease:string;protocol:string };
type Receipt = {ownerId:string;event:EvidenceEvent;canonicalEvent:string;payloadHash:string;receivedAt:string;serverSequence:number;manifestDigest:string;manifestRelease:string};
type Read = {context:Context;records:Receipt[];missingEventIds:string[]};
let f:Awaited<ReturnType<typeof createLegacyEvidenceSqlFixture>>,owner:string,other:string,c:Context;
const task=LEGACY_EVIDENCE_CATALOGUE.find(t=>t.legacyQuestionId==='f01:2')!;
const hash=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
function event(sequence=0,changes:Partial<EvidenceEvent>={}):EvidenceEvent {
 const value={schemaVersion:1,eventId:randomUUID(),generationId:c.generationId,episodeId:randomUUID(),sourceSlotKey:'',sequence,source:'course_review',lessonId:task.lessonId,legacyQuestionId:task.legacyQuestionId,itemId:task.itemId,contentRevision:task.contentRevision,taskId:task.taskId,gradingVersion:'legacy-choice-v1',taskFormat:'meaning_choice',occurredAt:c.prospectiveStartedAt,recordTimezone:'UTC',hintUsed:false,answerPreviouslyRevealed:false,isRetry:sequence>1,responseMs:sequence?100:null,timingComplete:sequence>0,audio:{status:'not_requested',promptMatchesTask:null},textVisibility:{targetText:false,reading:false,meaning:false,choices:true},kind:sequence?'answer_submitted':'exercise_presented',correct:sequence?true:null,...changes} as EvidenceEvent;
 value.sourceSlotKey=makeSourceSlotKey(owner,value);return value;
}
function continuation(p:EvidenceEvent,sequence=p.sequence+1,changes:Partial<EvidenceEvent>={}) {return event(sequence,{episodeId:p.episodeId,...changes});}
const predecessor=(e:EvidenceEvent):Predecessor=>({eventId:e.eventId,sequence:e.sequence,payloadHash:hash(canonicalEvidence(e))});
const args=(events:EvidenceEvent[],prev:Predecessor=null)=>({expected_owner:owner,expected_generation:c.generationId,manifest_digest:digest,batch_id:randomUUID(),source_slot:events[0].sourceSlotKey,expected_predecessor:prev,canonical_events:events.map(canonicalEvidence)});
const append=async(events:EvidenceEvent[],prev:Predecessor=null)=>(await f.rpc('append_language_legacy_evidence',args(events,prev))) as Read;
const current=async()=>await f.rpc('read_language_legacy_evidence_context',{expected_owner:owner,expected_generation:c.generationId,manifest_digest:digest}) as Context;
const read=async(ids:string[])=>await f.rpc('read_language_legacy_evidence_events',{expected_owner:owner,expected_generation:c.generationId,manifest_digest:digest,event_ids:ids}) as Read;
const page=async(h:number,after=0,limit=200)=>await f.rpc('read_language_legacy_evidence_page',{expected_owner:owner,expected_generation:c.generationId,manifest_digest:digest,through_sequence:h,after_sequence:after,page_limit:limit}) as Read & {throughSequence:number;afterSequence:number;lastSequence:number;rowCount:number;payloadBytes:number;exhausted:boolean};
before(async()=>{f=await createLegacyEvidenceSqlFixture({activateWrites:true});});
after(async()=>{await f.close();});
beforeEach(async()=>{await f.db.exec('reset role; truncate auth.users cascade;');other=await f.addOwner();owner=await f.addOwner();c=await f.context(owner) as Context;});

test('496 authored identities and SQL release bytes exactly reproduce immutable generator',async()=>{
 assert.deepEqual(f.afterInstallation,f.beforeInstallation);
 execFileSync(process.execPath,['--experimental-strip-types','scripts/generate-legacy-evidence-manifest.mjs','--check'],{stdio:'pipe'});
 assert.equal(JSON.parse(LEGACY_EVIDENCE_MANIFEST_CANONICAL).tasks.length,496);assert.equal(hash(LEGACY_EVIDENCE_MANIFEST_CANONICAL),digest);
 await f.db.exec('reset role');
 const row=(await f.db.query<{canonical_manifest:string;n:number}>(`select canonical_manifest,(select count(*)::int from public.language_legacy_evidence_manifest_tasks) n from public.language_legacy_evidence_manifests`)).rows[0];
 assert.equal(row.canonical_manifest,LEGACY_EVIDENCE_MANIFEST_CANONICAL);assert.equal(row.n,496);
 assert.equal(c.manifestRelease,LEGACY_EVIDENCE_MANIFEST_RELEASE);assert.equal(c.protocol,SERVER_EVIDENCE_PROTOCOL);
});

test('real append, exact immutable readback, original receipts after later replay and partial known-prefix suffix',async()=>{
 const p=event(),a=continuation(p),retry=continuation(p,2);const first=await append([p]);
 assert.equal(first.context.highWater,1);assert.equal(first.records[0].canonicalEvent,canonicalEvidence(p));assert.equal(first.records[0].payloadHash,hash(canonicalEvidence(p)));
 const next=await append([p,a]);assert.deepEqual(next.records[0],first.records[0]);assert.equal(next.context.highWater,2);
 await append([retry],predecessor(a));const replay=await append([p,a]);assert.deepEqual(replay.records,next.records);assert.equal(replay.context.highWater,3);
 const missing=randomUUID(),r=await read([a.eventId,missing,p.eventId]);assert.deepEqual(r.records,[next.records[1],next.records[0]]);assert.deepEqual(r.missingEventIds,[missing]);
 assert.equal((await current()).highWater,3);
});

test('same ID, semantic position, slot-episode bijection, predecessor and missing-prefix conflicts never allocate',async()=>{
 const p=event(),a=continuation(p);await append([p,a]);
 await assert.rejects(append([{...p,hintUsed:true}]),/legacy_event_id_conflict/);
 await assert.rejects(append([{...p,eventId:randomUUID()}]),/legacy_source_slot_conflict/);
 await assert.rejects(append([continuation(p,2)],{...predecessor(a)!,payloadHash:'0'.repeat(64)}),/legacy_predecessor_conflict/);
 await assert.rejects(append([continuation(p,3)],predecessor(a)),/legacy_predecessor_conflict/);
 await assert.rejects(append([{...p,eventId:randomUUID()},a]),/legacy_predecessor_conflict/);
 const lesson=event(0,{source:'course_lesson',lessonSessionId:'original/session'});await append([lesson]);
 await assert.rejects(append([{...lesson,eventId:randomUUID(),episodeId:randomUUID()}]),/legacy_source_slot_conflict/);
 const changed=event(0,{episodeId:p.episodeId,source:'course_lesson',lessonSessionId:'other/session'});await assert.rejects(append([changed]),/legacy_source_slot_conflict/);
 assert.equal((await current()).highWater,3);
});

test('strict schema rejects malformed nested/optional/null/numeric/time/source values atomically',async()=>{
 const p=event();const invalid:unknown[]=[
 {...p,rawAnswer:'PRIVATE_SENTINEL'}, {...p,eventId:p.eventId.toUpperCase()}, {...p,contentRevision:0}, {...p,contentRevision:1.1}, {...p,sequence:9007199254740992},
 {...p,correct:false}, {...p,isRetry:true}, {...p,responseMs:1}, {...p,timingComplete:true}, {...p,sequence:1},
 {...p,hintUsed:'false'}, {...p,answerPreviouslyRevealed:0}, {...p,lessonSessionId:'not-permitted'}, {...p,legacyQuestionId:null},
 {...p,source:'item_practice'}, {...p,source:'course_lesson'}, {...p,itemId:'wrong-item'}, {...p,gradingVersion:'invented'},
 {...p,audio:{status:'started',promptMatchesTask:true}}, {...p,audio:{status:'not_requested',requestId:randomUUID(),promptMatchesTask:null}},
 {...p,audio:{status:'not_requested',promptMatchesTask:false}}, {...p,audio:{status:'unknown',promptMatchesTask:null,extra:null}},
 {...p,textVisibility:{targetText:false,reading:null,meaning:false}}, {...p,textVisibility:{...p.textVisibility,choices:0}},
 {...p,occurredAt:'2026-02-30T00:00:00.000Z'}, {...p,occurredAt:'2026-01-01T00:00:00.000Z'}, {...p,occurredAt:'9999-01-01T00:00:00.000Z'},
 {...p,occurredAt:c.prospectiveStartedAt.replace('Z','+00:00')}, {...p,recordTimezone:'KST'}, {...p,recordTimezone:'-00:00'}, {...p,recordTimezone:'+14:01'},
 {...p,sourceSlotKey:p.sourceSlotKey+' '}, {...p,lessonId:'x'.repeat(201)}, {...p,taskFormat:'typed_answer'},
 ];
 for(const value of invalid) await assert.rejects(f.rpc('append_language_legacy_evidence',{...args([p]),canonical_events:[canonicalEvidence(value)]}),/legacy_invalid_event|legacy_source_slot_conflict/);
 for(const raw of [' '+canonicalEvidence(p),canonicalEvidence(p).replace('{','{"schemaVersion":1,'),canonicalEvidence(p).replace('"sequence":0','"sequence":0.0'),canonicalEvidence(p).replace('"sequence":0','"sequence":0e0'),canonicalEvidence(p).replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1'),canonicalEvidence(p).replace('course_review','course_\\u0072eview')]) await assert.rejects(f.rpc('append_language_legacy_evidence',{...args([p]),canonical_events:[raw]}),/legacy_invalid_event/);
 assert.equal((await current()).highWater,0);
 const a=continuation(p);await assert.rejects(append([p,{...a,responseMs:600001}]),/legacy_invalid_event/);assert.equal((await current()).highWater,0);
});

test('SQL compact bytes and SHA match fixed browser/Node golden and UTF8 vectors',async()=>{
 await f.db.exec('reset role');
 const golden=goldenEpisode(0,{task:typedTask,format:'typed_answer'})[0];Object.assign(golden,{eventId:uuid(77),episodeId:uuid(78),source:'course_lesson',lessonSessionId:'session/alpha:01',hintUsed:null,answerPreviouslyRevealed:null,recordTimezone:'+14:00',audio:{status:'unknown',promptMatchesTask:null},textVisibility:{targetText:null,reading:false,meaning:true,choices:false}});golden.sourceSlotKey=makeSourceSlotKey(goldenContext().ownerId,golden);
 for(const v of [golden,{z:[null,false,true,0,9007199254740991],a:'日本語 🙂\n\t\r\b\f\\"\u0001\u2028'}, {absent:false,present:null}]) {
  const raw=canonicalEvidence(v);const row=(await f.db.query<{canonical:string;hash:string}>(`select language_legacy_evidence_private.canonical($1::jsonb) canonical,encode(sha256(convert_to(language_legacy_evidence_private.canonical($1::jsonb),'UTF8')),'hex') hash`,[raw])).rows[0];assert.equal(row.canonical,raw);assert.equal(row.hash,hash(raw));
 }
 assert.equal(hash(canonicalEvidence(golden)),'d2853bac1cd6e578c6b6e3bc3f4c6b6976a9209092b0d9f5e292e17919ac5089');
 assert.equal((await f.db.query<{hash:string}>("select encode(sha256(convert_to($1,'UTF8')),'hex') hash",['日本語 🙂\n'])).rows[0].hash,'34a4df889cbe77891ee7b30721a98f4c912c9e2636cbd8f9e2f7fbb35097497f');
 for(const raw of ['{"n":9007199254740992}','{"n":1.5}','{"s":"\\u0000"}','{"s":"\\ud800"}']) await assert.rejects(f.db.query('select language_legacy_evidence_private.canonical($1::jsonb)',[raw]));
});

test('request counts and bytes are bounded before writes; 50-event exact boundary succeeds',async()=>{
 const p=event();const events=Array.from({length:50},(_,i)=>i?continuation(p,i):p);assert.equal((await append(events)).context.highWater,50);
 for(const request of [{canonical_events:[]},{canonical_events:Array(51).fill(canonicalEvidence(p))},{canonical_events:[null]},{canonical_events:['x'.repeat(16385)]},{canonical_events:Array(17).fill('x'.repeat(16384))},{canonical_events:Array(16).fill('x'.repeat(16384))}]) await assert.rejects(f.rpc('append_language_legacy_evidence',{...args([p]),...request}),/legacy_invalid_event/);
 for(const ids of [[],[p.eventId,p.eventId],[null],Array.from({length:51},()=>randomUUID())]) await assert.rejects(read(ids as string[]),/legacy_invalid_event/);
 assert.equal((await current()).highWater,50);
});

test('statement-snapshot zero and 1/200/201-row pages, fixed H with later writes, strict cursor bounds',async()=>{
 let r=await page(0);assert.equal(r.exhausted,true);assert.equal(r.rowCount,0);assert.equal(r.lastSequence,0);
 const p=event();let previous:EvidenceEvent|null=null;
 for(let start=0;start<201;start+=50) {const events=Array.from({length:Math.min(50,201-start)},(_,i)=>start+i===0?p:continuation(p,start+i));await append(events,previous?predecessor(previous):null);previous=events.at(-1)!;}
 r=await page(1);assert.equal(r.records.length,1);assert.equal(r.exhausted,true);
 r=await page(200);assert.equal(r.records.length,200);assert.equal(r.exhausted,true);assert.deepEqual(r.records.map(x=>x.serverSequence),Array.from({length:200},(_,i)=>i+1));
 r=await page(201);assert.equal(r.records.length,200);assert.equal(r.exhausted,false);assert.equal(r.lastSequence,200);
 const tail=await page(201,200);assert.equal(tail.records.length,1);assert.equal(tail.exhausted,true);assert.equal(tail.payloadBytes,Buffer.byteLength(tail.records[0].canonicalEvent));
 await append([continuation(p,201)],predecessor(previous!));assert.equal((await page(201)).context.highWater,202);assert.equal((await page(201,200)).records.length,1);
 for(const [h,a,l] of [[203,0,200],[9007199254740992,0,200],[1,2,200],[1,-1,200],[1,0,0],[1,0,201]]) await assert.rejects(page(h,a,l),/legacy_invalid_event/);
});

test('payload-capped page explicitly continues without false exhaustion',async()=>{
 const p=event(0,{source:'course_lesson',lessonSessionId:'s'.repeat(200)});const previous:EvidenceEvent[]=[];
 // Longer valid canonical bytes with a max-length authored-independent session identity.
 for(let start=0;start<201;start+=50) {const ev=Array.from({length:Math.min(50,201-start)},(_,i)=>event(start+i,{source:'course_lesson',lessonSessionId:'s'.repeat(200),episodeId:p.episodeId,audio:{status:'unknown',requestId:randomUUID(),promptMatchesTask:null},textVisibility:{targetText:null,reading:null,meaning:null,choices:null}}));await append(ev,previous.length?predecessor(previous.at(-1)!):null);previous.push(...ev);}
 const r=await page(201);assert.ok(r.payloadBytes<=262144);assert.ok(r.records.length<200);assert.equal(r.exhausted,false);assert.ok(r.lastSequence>0);
 const tail=await page(201,r.lastSequence);assert.equal(tail.exhausted,true);assert.equal(r.records.length+tail.records.length,201);
});

test('late insert failure and explicit append rollback leave gap-free transactional counters',async()=>{
 const p=event(),a=continuation(p);await f.db.exec('reset role; alter table public.language_legacy_evidence_events add constraint injected_failure check(event_sequence<>1); set role authenticated;');
 await assert.rejects(append([p,a]),/injected_failure/);assert.equal((await current()).highWater,0);assert.deepEqual((await read([p.eventId,a.eventId])).missingEventIds,[p.eventId,a.eventId]);
 await f.db.exec('reset role; alter table public.language_legacy_evidence_events drop constraint injected_failure; set role authenticated;');await f.db.exec('begin');await append([p,a]);await f.db.exec('rollback');assert.equal((await current()).highWater,0);
 const result=await append([p,a]);assert.deepEqual(result.records.map(r=>r.serverSequence),[1,2]);
});

test('restricted roles deny direct DML/TRUNCATE/manifest/counter/helpers and preserve owner RLS',async()=>{
 const p=event();await append([p]);
 for(const role of ['authenticated','anon','service_role']) {
  await f.db.exec(`reset role; set role ${role}`);
  for(const table of ['manifests','manifest_tasks','generations','events']) for(const verb of [`select * from`,`insert into`,`delete from`,`update`,`truncate`]) {
   const sql=verb==='update'?`update public.language_legacy_evidence_${table} set ${table==='events'?'payload=payload':table==='generations'?'last_server_sequence=0':table==='manifests'?'release_id=release_id':'task_id=task_id'}`:`${verb} public.language_legacy_evidence_${table}${verb==='insert into'?' default values':''}`;
   await assert.rejects(f.db.exec(sql),/permission denied/);
  }
  await assert.rejects(f.db.query('select language_legacy_evidence_private.canonical($1::jsonb)',['{}']),/permission denied/);
  await assert.rejects(f.db.exec('select language_legacy_evidence_private.marker_reset()'),/permission denied/);
  await assert.rejects(f.db.exec('create table language_legacy_evidence_private.unauthorized(value text)'),/permission denied/);
  if(role!=='authenticated') {
   await assert.rejects(current(),/permission denied/);
   await assert.rejects(f.db.query('select language_legacy_evidence_private.read_context($1,$2,$3)',[owner,c.generationId,digest]),/permission denied/);
  }
 }
 await f.asOwner(other);await assert.rejects(current(),/legacy_auth_mismatch/);await assert.rejects(f.db.query('select language_legacy_evidence_private.read_context($1,$2,$3)',[owner,c.generationId,digest]),/legacy_auth_mismatch/);
 await f.asOwner(null);await assert.rejects(current(),/legacy_auth_mismatch/);
 await f.db.exec(`reset role; set role language_legacy_evidence_executor`);await assert.rejects(f.db.exec('update public.language_legacy_evidence_events set payload=payload'),/permission denied/);await assert.rejects(f.db.exec('update public.language_user_state set state=state'),/permission denied/);
});

test('catalogue ACL and function owner/search path inventory has no memberships or bypass',async()=>{
 await f.db.exec('reset role');
 const roles=(await f.db.query<{rolname:string;rolsuper:boolean;rolcanlogin:boolean;rolbypassrls:boolean;rolinherit:boolean}>("select rolname,rolsuper,rolcanlogin,rolbypassrls,rolinherit from pg_roles where rolname like 'language_legacy_evidence_%'")).rows;assert.equal(roles.length,2);assert.ok(roles.every(r=>!r.rolsuper&&!r.rolcanlogin&&!r.rolbypassrls&&!r.rolinherit));
 assert.equal((await f.db.query("select * from pg_auth_members m join pg_roles r on r.oid=m.member or r.oid=m.roleid where r.rolname like 'language_legacy_evidence_%'")).rows.length,0);
 const tables=(await f.db.query<{relrowsecurity:boolean;relforcerowsecurity:boolean;owner:string}>("select c.relrowsecurity,c.relforcerowsecurity,r.rolname owner from pg_class c join pg_roles r on r.oid=c.relowner where c.relname in ('language_legacy_evidence_manifests','language_legacy_evidence_manifest_tasks','language_legacy_evidence_generations','language_legacy_evidence_events')")).rows;assert.equal(tables.length,4);assert.ok(tables.every(r=>r.relrowsecurity&&r.relforcerowsecurity&&!r.owner.startsWith('language_legacy')));
 const funcs=(await f.db.query<{proname:string;prosecdef:boolean;proconfig:string[];owner:string}>("select p.proname,p.prosecdef,p.proconfig,r.rolname owner from pg_proc p join pg_roles r on r.oid=p.proowner join pg_namespace n on n.oid=p.pronamespace where n.nspname='language_legacy_evidence_private'")).rows;assert.ok(funcs.every(r=>r.proconfig.includes('search_path=""')));
 assert.equal(funcs.filter(r=>r.prosecdef).length,8);assert.ok(funcs.filter(r=>r.prosecdef).every(r=>r.owner===(r.proname==='marker_reset'?'language_legacy_evidence_reset_executor':'language_legacy_evidence_executor')));
 const triggers=(await f.db.query<{tgname:string}>("select tgname from pg_trigger where tgrelid='public.language_user_state'::regclass and not tgisinternal order by tgname")).rows.map(r=>r.tgname);assert.ok(triggers.includes('assistant_language_history_language_reset'));assert.ok(triggers.includes('chatgpt_reset_language'));assert.ok(triggers.includes('language_legacy_evidence_marker_reset'));
 const sql=readSql(`supabase/migrations/${LEGACY_EVIDENCE_MIGRATION}`);const trigger=sql.slice(sql.indexOf('create function language_legacy_evidence_private.marker_reset()'),sql.indexOf('create trigger language_legacy_evidence_marker_reset'));assert.doesNotMatch(trigger,/pg_advisory/);assert.doesNotMatch(sql,/nextval\(|serial\b|generated.*identity/i);
});

test('timezone remains generation-stable; missing state and mismatched marker never create state/generation',async()=>{
 assert.equal((await f.context(owner,c.resetMarker,'Asia/Seoul') as Context).studyDayTimezone,'UTC');
 await assert.rejects(f.context(owner,{present:true,value:null}),/legacy_marker_conflict/);
 await f.db.query('delete from public.language_user_state where user_id=$1',[owner]);await assert.rejects(f.context(owner),/legacy_state_not_ready/);await assert.rejects(current(),/legacy_state_not_ready/);
 assert.equal((await f.db.query('select * from public.language_user_state')).rows.length,0);
});

test('actual reset rotates generation/purges receipts; exact request retry preserves new generation events',async()=>{
 const p=event();await append([p]);const old=c;const request=randomUUID();const reset=(await f.db.query<{r:{marker:string}}>("select public.reset_my_app_records('language',$1,'초기화') r",[request])).rows[0].r;
 await assert.rejects(append([p]),/legacy_stale_generation/);await assert.rejects(current(),/legacy_stale_generation/);
 c=await f.rpc('read_language_legacy_evidence_context',{expected_owner:owner,expected_generation:null,manifest_digest:digest}) as Context;assert.notEqual(c.generationId,old.generationId);assert.equal(c.highWater,0);assert.deepEqual(c.resetMarker,{present:true,value:reset.marker});
 const fresh=event();await append([fresh]);await f.db.query("select public.reset_my_app_records('language',$1,'초기화')",[request]);assert.equal((await current()).highWater,1);assert.equal((await read([fresh.eventId])).records.length,1);
});

test('raw marker missing/null/string/type transitions rotate, same marker and rollback do not',async()=>{
 for(const marker of [null,'older|opaque',{'malformed':true},22,false,'older|opaque',undefined]) {
  const before=(await current()).generationId;
  await f.db.query("update public.language_user_state set state=$1 where user_id=$2",[marker===undefined?{}:{languageRecordResetV1:marker},owner]);
  c=await f.rpc('read_language_legacy_evidence_context',{expected_owner:owner,expected_generation:null,manifest_digest:digest}) as Context;assert.notEqual(c.generationId,before);assert.deepEqual(c.resetMarker,{present:marker!==undefined,value:marker??null});
  await f.db.query('update public.language_user_state set state=state where user_id=$1',[owner]);assert.equal((await current()).generationId,c.generationId);
 }
 await f.db.exec('begin');await f.db.query("update public.language_user_state set state='{"+'"languageRecordResetV1":"rolled-back"'+"}' where user_id=$1",[owner]);await f.db.exec('rollback');assert.equal((await current()).generationId,c.generationId);
});

test('state reinsertion retains enrollment loss and auth-admin account cascade works without owner DELETE trigger',async()=>{
 const p=event();await append([p]);const old=c.generationId;
 await f.db.query('delete from public.language_user_state where user_id=$1',[owner]);await f.db.query("insert into public.language_user_state(user_id,state) values($1,'{}')",[owner]);await assert.rejects(f.context(owner),/legacy_enrolled_generation_missing/);
 const status=await f.rpc('read_language_legacy_evidence_status',{expected_owner:owner}) as {status:string;enrollment:{initialGenerationId:string}};assert.equal(status.status,'enrolled_generation_missing');assert.equal(status.enrollment.initialGenerationId,old);
 await f.db.exec("reset role; set app.test_user=''; set role synthetic_auth_admin");await f.db.query('delete from auth.users where id=$1',[owner]);await f.db.exec('reset role');assert.equal((await f.db.query('select * from public.language_legacy_evidence_events')).rows.length,0);assert.equal((await f.db.query('select * from public.language_legacy_evidence_generations')).rows.length,0);
});

test('R4 administrative marker compatibility: unenrolled no-op, enrolled null/foreign auth fail closed',async()=>{
 await f.db.exec("reset role; set app.test_user=''");
 await f.db.query("update public.language_user_state set state='{"+'"languageRecordResetV1":"unenrolled-admin"'+"}' where user_id=$1",[other]);
 await f.db.query("select set_config('app.test_user',$1,false)",[owner]);
 await f.db.query("update public.language_user_state set state='{"+'"languageRecordResetV1":"unenrolled-foreign"'+"}' where user_id=$1",[other]);
 for(const populated of [false,true]) {
  if(populated) {await f.asOwner(owner);await append([event()]);}
  for(const claim of ['',other]) {
   await f.db.exec('reset role');await f.db.query("select set_config('app.test_user',$1,false)",[claim]);
   await assert.rejects(f.db.query("update public.language_user_state set state='{"+'"languageRecordResetV1":"must-rollback"'+"}' where user_id=$1",[owner]),/legacy_auth_mismatch/);
   assert.deepEqual((await f.db.query<{state:unknown}>('select state from public.language_user_state where user_id=$1',[owner])).rows[0].state,{});
   const g=(await f.db.query<{generation_id:string;last_server_sequence:number}>('select generation_id,last_server_sequence from public.language_legacy_evidence_generations where owner_id=$1',[owner])).rows[0];assert.equal(g.generation_id,c.generationId);assert.equal(g.last_server_sequence,populated?1:0);
  }
 }
});

test('R4 reset role has cross-owner key-only probe, no secret/context/payload read or mutation escape',async()=>{
 await f.asOwner(other);await f.context(other);await f.asOwner(owner);await append([event()]);
 await f.db.exec("reset role; set app.test_user=''; set role language_legacy_evidence_reset_executor");
 assert.equal((await f.db.query('select owner_id,generation_id from public.language_legacy_evidence_generations')).rows.length,2);
 for(const column of ['reset_marker','prospective_started_at','study_day_timezone','protocol','last_server_sequence']) await assert.rejects(f.db.query(`select ${column} from public.language_legacy_evidence_generations`),/permission denied/);
 for(const column of ['event_id','payload','payload_hash','canonical_payload','received_at','server_sequence','manifest_digest']) await assert.rejects(f.db.query(`select ${column} from public.language_legacy_evidence_events`),/permission denied/);
 assert.equal((await f.db.query('select owner_id,generation_id from public.language_legacy_evidence_events')).rows.length,0);
 await f.db.exec('update public.language_legacy_evidence_generations set generation_id=gen_random_uuid(); delete from public.language_legacy_evidence_events;');
 await f.asOwner(owner);assert.equal((await current()).generationId,c.generationId);assert.equal((await current()).highWater,1);
 const sessionFixture=await createLegacyEvidenceSqlFixture({activateWrites:true});
 try {
  await sessionFixture.db.exec('set session authorization authenticated');
  await assert.rejects(sessionFixture.db.exec('set role language_legacy_evidence_reset_executor'),/permission denied/);
  await assert.rejects(sessionFixture.db.exec('set role language_legacy_evidence_executor'),/permission denied/);
 } finally { await sessionFixture.close(); }
});

test('real assistant and connector effects roll back with rejected marker; same-marker command succeeds',async()=>{
 await append([event()]);const grant=randomUUID(),session=randomUUID(),advice=randomUUID();
 await f.db.exec('reset role');
 await f.db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,owner]);
 await f.db.query("insert into yeoni_connector.grants(id,user_id,session_id,client_id,resource,scopes,areas,code_hash,challenge) values($1,$2,$3,'synthetic','synthetic',array['yeoni:records:read'],array['language'],'synthetic-code','synthetic-challenge')",[grant,owner,session]);
 await f.db.query("insert into public.chatgpt_advice(user_id,id,payload_hash,title,body,area,summary,snapshot_at) values($1,$2,'synthetic','Synthetic','Synthetic','language','{}',now())",[owner,advice]);
 await f.db.query("insert into yeoni_connector.snapshots(user_id,grant_id,area,summary) values($1,$2,'language','{}')",[owner,grant]);
 await f.db.query("insert into public.assistant_language_command_history(user_id,id,routine_id,record_date,payload_hash,before_values,after_values) values($1,$2,'kana',current_date,'synthetic','{}','{}')",[owner,randomUUID()]);
 await f.db.exec("set app.test_user=''");
 await assert.rejects(f.db.query("update public.language_user_state set state='{"+'"languageRecordResetV1":"rejected"'+"}' where user_id=$1",[owner]),/legacy_auth_mismatch/);
 assert.equal((await f.db.query('select * from yeoni_connector.grants where revoked_at is null')).rows.length,1);assert.equal((await f.db.query('select * from yeoni_connector.snapshots')).rows.length,1);assert.equal((await f.db.query('select * from public.chatgpt_advice')).rows.length,1);assert.equal((await f.db.query('select * from public.assistant_language_command_history')).rows.length,1);
 await f.asOwner(owner);
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 await f.db.query('select public.apply_assistant_language_command($1,$2,$3,$4,$5,$6)',[randomUUID(),'words',day,{},{language:null,assistant:null},new Date(Date.now()+60000).toISOString()]);
 assert.equal((await current()).highWater,1);
 await f.db.query("select public.reset_my_app_records('language',$1,'초기화')",[randomUUID()]);
 await f.db.exec('reset role');assert.equal((await f.db.query('select * from yeoni_connector.grants where revoked_at is null')).rows.length,0);assert.equal((await f.db.query('select * from yeoni_connector.snapshots')).rows.length,0);assert.equal((await f.db.query('select * from public.chatgpt_advice')).rows.length,0);assert.equal((await f.db.query('select * from public.assistant_language_command_history')).rows.length,0);assert.equal((await f.db.query('select * from public.language_legacy_evidence_events')).rows.length,0);
});

test('all authored bindings validate, item_practice and invented historical binding cannot append',async()=>{
 await f.db.exec('reset role');
 const generation=(await f.db.query<{g:unknown}>('select to_jsonb(g) g from public.language_legacy_evidence_generations g where owner_id=$1',[owner])).rows[0].g;
 let count=0;
 for(const descriptor of LEGACY_EVIDENCE_CATALOGUE) for(const binding of descriptor.bindings) {
  const p=event(0,{...binding,itemId:descriptor.itemId,taskId:descriptor.taskId,contentRevision:descriptor.contentRevision,lessonId:descriptor.lessonId,legacyQuestionId:descriptor.legacyQuestionId,...binding.source==='course_lesson'?{lessonSessionId:'authored/session'}:{}});
  await f.db.query('select language_legacy_evidence_private.validate_event($1,$2,jsonb_populate_record(null::public.language_legacy_evidence_generations,$3::jsonb),clock_timestamp(),$4)',[canonicalEvidence(p),owner,generation,digest]);count++;
 }
 assert.ok(count>=992);
});

test('malicious search_path/temp names cannot redirect fixed functions or leak foreign owner rows',async()=>{
 const p=event();await f.db.exec('create temporary table language_legacy_evidence_events(payload jsonb); create temporary table language_user_state(state jsonb); set search_path=pg_temp,public;');
 assert.equal((await append([p])).context.highWater,1);assert.equal((await read([p.eventId])).records[0].event.eventId,p.eventId);
 await f.asOwner(other);await assert.rejects(read([p.eventId]),/legacy_auth_mismatch/);
 await f.db.exec('reset search_path; drop table pg_temp.language_legacy_evidence_events; drop table pg_temp.language_user_state;');
});
