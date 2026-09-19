import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { isGrowthCompletionIntent, parseGrowthCompletion, selectGrowthRoutine, growthSessionTimeLabel, isGrowthCommandProposal, type GrowthRoutineSnapshot } from '../lib/assistant-growth-command.ts';
import { readCommandDrafts } from '../lib/assistant-command-drafts.ts';

const db = new PGlite();
const owner = randomUUID(), other = randomUUID(), routineId = randomUUID(), otherRoutine = randomUUID();
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
type Row = Record<string, unknown>;
const original = { settings: 'keep', 'ai-fitness-record-reset-fitness': 'old-fitness-reset' };
const routine: GrowthRoutineSnapshot = { id: routineId, title: '정확도 중심 타자 연습', category: 'typing', target_minutes: 10, preferred_days: [1,3,5], target_sessions_per_week: 2, enabled: true, updated_at: '2026-01-01T00:00:00+00:00' };
const request = (overrides = {}) => ({ id: randomUUID(), day: today(), expected: routine, minutes: null as number | null, resets: { growth: null, assistant: null }, expires: new Date(Date.now() + 15 * 60_000).toISOString(), ...overrides });
const apply = async (p: ReturnType<typeof request>) => (await db.query<Row>('select public.apply_assistant_growth_command($1,$2,$3,$4,$5,$6) receipt', [p.id,p.day,p.expected,p.minutes,p.resets,p.expires])).rows[0].receipt as Row;
const undo = async (id: string) => (await db.query<Row>('select public.undo_assistant_growth_command($1) receipt', [id])).rows[0].receipt as Row;
const sessions = async () => (await db.query<{value: Row}>('select to_jsonb(s) value from public.growth_sessions s order by id')).rows.map(row => row.value);
const count = async () => Number((await db.query<{n: number}>('select count(*) n from public.assistant_growth_command_history')).rows[0].n);
const state = async () => (await db.query<{state: Row}>('select state from public.user_app_state')).rows[0]?.state;
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
before(async () => {
  await db.exec(`create role authenticated; create role anon; create role service_role; create role synthetic_auth_admin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    grant usage on schema auth to synthetic_auth_admin; grant select,delete on auth.users to synthetic_auth_admin;`);
  await db.exec(read('./e2e/schema.sql'));
  await db.exec(read('../supabase/migrations/20260901125340_add_fitness_ai_review_history.sql'));
  await db.exec(read('../supabase/migrations/20260906141943_add_app_record_resets.sql'));
  await db.exec(read('../supabase/migrations/20260915034857_assistant_task_command_history.sql'));
  await db.exec(read('../supabase/migrations/20260916113939_assistant_growth_commands.sql'));
});
after(async () => db.close());
beforeEach(async () => {
  await db.exec(`reset role; truncate auth.users cascade; insert into auth.users values('${owner}'),('${other}'); set app.test_user='${owner}'; set role authenticated;`);
  await db.query('insert into public.user_app_state(user_id,state) values($1,$2)', [owner,original]);
  await db.query("insert into public.growth_routines(id,user_id,title,category,target_minutes,preferred_days,target_sessions_per_week,updated_at) values($1,$2,$3,'typing',10,'{1,3,5}',2,$4)", [routineId,owner,routine.title,routine.updated_at]);
  await db.query("insert into public.growth_routines(id,user_id,title,category) values($1,$2,'손글씨 교정 연습','handwriting')", [otherRoutine,owner]);
  await db.query("insert into public.growth_sessions(user_id,routine_id,session_date,status,actual_minutes,memo,metrics) values($1,$2,'2001-01-01','partial',3,'original','{\"accuracy\":77}')", [owner,routineId]);
});
test('confirmation stores only the completion fact, atomically journals it, retries once and restores every original row', async () => {
  const before = await sessions(), p = request(), receipt = await apply(p);
  const newRow = (await sessions()).find(row => row.session_date === today())!;
  assert.equal(newRow.actual_minutes,0); assert.equal(newRow.planned_minutes,10); assert.equal(newRow.status,'completed');
  assert.deepEqual(newRow.metrics,{ actualMinutesRecorded:false }); assert.equal(newRow.memo,''); assert.equal(newRow.started_at,null); assert.equal(newRow.ended_at,null);
  assert.deepEqual(await apply(p),receipt); assert.equal(await count(),1); assert.deepEqual(await state(),original);
  const undone = await undo(p.id); assert.ok(undone.undone_at); assert.deepEqual(await sessions(),before);
  assert.deepEqual(await undo(p.id),undone); assert.deepEqual(await apply(p),undone); assert.deepEqual(await sessions(),before);
});
test('explicit actual minutes are distinct from planned minutes; upper input boundary is supported', async () => {
  for (const minutes of [1,15,1440]) {
    const p=request({minutes}); const saved=await apply(p); const row=saved.session_snapshot as Row;
    assert.equal(row.actual_minutes,minutes); assert.equal(row.planned_minutes,10); assert.deepEqual(row.metrics,{actualMinutesRecorded:true}); await undo(p.id);
  }
});
test('ledger failure rolls back the session and allows the same request to retry', async () => {
  const before=await sessions(),p=request();
  await db.exec('reset role; alter table public.assistant_growth_command_history add constraint injected_failure check(false); set role authenticated;');
  await assert.rejects(apply(p)); assert.deepEqual(await sessions(),before); assert.equal(await count(),0);
  await db.exec('reset role; alter table public.assistant_growth_command_history drop constraint injected_failure; set role authenticated;');
  await apply(p); assert.equal(await count(),1);
});
test('separately confirmed requests cannot both complete the same routine and date', async () => {
  const results=await Promise.allSettled([apply(request()),apply(request())]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1); assert.equal(await count(),1);
});
test('existing completed, partial and stopped sessions remain byte-for-byte unchanged', async () => {
  for (const status of ['completed','partial','stopped']) {
    await db.query('insert into public.growth_sessions(user_id,routine_id,session_date,status,memo) values($1,$2,$3,$4,$5)',[owner,routineId,today(),status,'preserve']);
    const before=await sessions(); await assert.rejects(apply(request()),/기록이 이미/); assert.deepEqual(await sessions(),before);
    await db.query('delete from public.growth_sessions where session_date=$1',[today()]);
  }
  assert.equal(await count(),0);
});
test('changed routine names, plans and schedules invalidate confirmation even without an updated timestamp', async () => {
  for (const sql of ["title='renamed'",'target_minutes=20',"preferred_days='{2,4}'",'enabled=false']) {
    await db.exec(`update public.growth_routines set ${sql} where id='${routineId}'`);
    await assert.rejects(apply(request()),/루틴/); assert.equal(await count(),0);
    await db.query("update public.growth_routines set title=$1,target_minutes=10,preferred_days='{1,3,5}',enabled=true where id=$2",[routine.title,routineId]);
  }
});
test('other routines and dates can change before and after confirmation and survive undo', async () => {
  const p=request();
  await db.query("insert into public.growth_sessions(user_id,routine_id,session_date,status,actual_minutes) values($1,$2,$3,'completed',15)",[owner,otherRoutine,today()]);
  const before=await sessions(); await apply(p);
  await db.exec("update public.growth_sessions set memo='new historical memo' where session_date='2001-01-01'");
  await undo(p.id); assert.deepEqual(await sessions(),before.map(row=>row.session_date==='2001-01-01'?{...row,memo:'new historical memo'}:row));
});
test('editing the command session blocks undo and preserves that edit', async () => {
  const p=request(); await apply(p); await db.query("update public.growth_sessions set memo='later edit' where session_date=$1",[today()]);
  const before=await sessions(); await assert.rejects(undo(p.id),/이후에 자기계발 기록/); assert.deepEqual(await sessions(),before);
});
test('a later additional session in the same routine blocks undo without deleting either', async () => {
  const p=request(); await apply(p); await db.query("insert into public.growth_sessions(user_id,routine_id,session_date,status) values($1,$2,$3,'partial')",[owner,routineId,today()]);
  const before=await sessions(); await assert.rejects(undo(p.id),/이후에 자기계발 기록/); assert.deepEqual(await sessions(),before);
});
test('routine deletion detaches the session and undo refuses to delete the detached record', async () => {
  const p=request(); await apply(p); await db.query('delete from public.growth_routines where id=$1',[routineId]);
  const before=await sessions(); await assert.rejects(undo(p.id),/이후에 자기계발 기록/); assert.deepEqual(await sessions(),before);
});
test('missing app state remains absent after apply and undo', async () => {
  await db.exec('delete from public.user_app_state'); const p=request(); await apply(p); await undo(p.id); assert.equal(await state(),undefined);
});
test('expiry, dates, invalid minutes, unexpected fields and reused IDs cannot create extra sessions', async () => {
  const before=await sessions();
  for (const change of [{expires:'2001-01-01T00:00:00Z'},{day:'2001-01-01'},{minutes:0},{minutes:-1},{minutes:1441},{expected:{...routine,extra:true}},{resets:{growth:null}},{expected:{...routine,id:otherRoutine}},{expected:{...routine,updated_at:null}}]) await assert.rejects(apply(request(change)));
  assert.deepEqual(await sessions(),before); const p=request(); await apply(p);
  await assert.rejects(apply({...p,minutes:15}),/이미 사용한/); assert.equal(await count(),1);
});
test('an expired committed request still returns its original receipt and never duplicates a session', async () => {
  const p=request(),receipt=await apply(p);
  // Simulate the same durable payload after its validity window, without a wall-clock wait.
  await db.exec('reset role;'); const expired={...p,expires:'2001-01-01T00:00:00Z'};
  await db.query("update public.assistant_growth_command_history set payload_hash=md5(jsonb_build_object('day',$1::date,'expected',$2::jsonb,'minutes',$3::integer,'resets',$4::jsonb,'expires',$5::timestamptz)::text) where user_id=$6 and id=$7",[expired.day,expired.expected,expired.minutes,expired.resets,expired.expires,owner,p.id]);
  await db.exec('set role authenticated;'); const replay=await apply(expired); assert.deepEqual(replay.session_snapshot,receipt.session_snapshot); assert.equal(await count(),1);
});
test('owners and anonymous users cannot read or undo one another’s commands', async () => {
  const p=request();await apply(p);await db.exec(`set app.test_user='${other}';`);
  assert.equal(await count(),0);assert.deepEqual(await sessions(),[]);await assert.rejects(undo(p.id),/이력을 찾을 수/);await assert.rejects(apply(request()),/루틴/);
  await assert.rejects(db.query("insert into public.assistant_growth_command_history(user_id,id,record_date,payload_hash,routine_snapshot,session_snapshot) values($1,$2,current_date,'x','{}','{}')",[owner,randomUUID()]));
  await db.exec('reset role;set role anon;');await assert.rejects(apply(request()));await assert.rejects(db.query('select * from public.assistant_growth_command_history'));
});
for(const area of ['growth','assistant']) test(`${area} reset removes history and invalidates pending confirmations`,async()=>{
  const saved=request(),pending=request();await apply(saved);
  await db.query("select public.reset_my_app_records($1,$2,'초기화')",[area,randomUUID()]);
  assert.equal(await count(),0);await assert.rejects(apply(pending),/초기화/);await assert.rejects(undo(saved.id),/이력을 찾을 수/);
});
test('deleting an Auth account cascades receipts with the restricted Auth role',async()=>{
  await apply(request());await db.exec(`reset role;set role synthetic_auth_admin;delete from auth.users where id='${owner}';reset role;`);assert.equal(await count(),0);
});
test('parser accepts one explicit today completion and optional real minutes',()=>{
  assert.equal(isGrowthCompletionIntent('오늘 개발 할 일 완료해줘'),false);
  assert.equal(isGrowthCompletionIntent('오늘 자기계발 할 일 정리 완료했어'),true);
  assert.deepEqual(parseGrowthCompletion('오늘 타자 연습 완료했어'),{target:'타자 연습',actualMinutes:null});
  assert.deepEqual(parseGrowthCompletion('오늘 손글씨 15분 완료했어'),{target:'손글씨',actualMinutes:15});
  assert.deepEqual(parseGrowthCompletion('오늘 자기계발 독서 20분 완료로 기록해줘'),{target:'독서',actualMinutes:20});
  for(const text of ['어제 타자 완료했어','내일 개발 완료했어','타자 완료했어?','타자 완료하지 마','타자 안 했어','타자 일부 완료','타자 끝나면 기록해줘','타자 0분 완료했어','타자 1441분 완료했어']) assert.throws(()=>parseGrowthCompletion(text),text);
});
test('exact routine names take precedence; ambiguous aliases, retired and disabled routines are rejected',()=>{
  const second={...routine,id:otherRoutine,title:'속도 중심 타자 연습'};
  assert.deepEqual(selectGrowthRoutine([routine,second],routine.title),routine);
  assert.throws(()=>selectGrowthRoutine([routine,second],'타자'),/여러 개/);
  assert.throws(()=>selectGrowthRoutine([routine, {...routine,id:otherRoutine}],routine.title),/여러 개/);
  assert.throws(()=>selectGrowthRoutine([{...routine,enabled:false}],'타자'),/찾지 못/);
  assert.throws(()=>selectGrowthRoutine([{...routine,title:'28회 그림 기초 연습'}],'28회 그림 기초 연습'),/찾지 못/);
  assert.throws(()=>selectGrowthRoutine([routine],'타자 1.5분'),/찾지 못/);
});
test('draft recovery preserves the request and rejects other accounts, malformed records and dates',()=>{
  const p={domain:'growth',ownerId:owner,requestId:randomUUID(),date:today(),expected:routine,actualMinutes:null,resetMarkers:request().resets,expiresAt:request().expires};
  assert.ok(isGrowthCommandProposal(p));const drafts=[{proposal:p,attempted:true}];
  assert.deepEqual(readCommandDrafts(JSON.stringify({ownerId:owner,drafts}),owner),drafts);assert.deepEqual(readCommandDrafts(JSON.stringify({ownerId:owner,drafts}),other),[]);
  for(const bad of [{...p,date:'2026-02-30'},{...p,actualMinutes:0},{...p,expected:{...routine,title:null}},{...p,expected:{...routine,preferred_days:[1,1]}},{...p,ownerId:other}]) assert.throws(()=>readCommandDrafts(JSON.stringify({ownerId:owner,drafts:[{proposal:bad,attempted:false}]}),owner));
  assert.equal(growthSessionTimeLabel({actual_minutes:0,metrics:{actualMinutesRecorded:false}}),'시간 미기록');
  assert.equal(growthSessionTimeLabel({actual_minutes:10,metrics:{}}),'10분');
});
