import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { WORKOUT_RECORD_KEY as key, workoutDaySnapshot, workoutRecordStatus, parseWorkoutCompletion, isWorkoutCommandProposal } from '../lib/assistant-workout-command.ts';
import { readCommandDrafts } from '../lib/assistant-command-drafts.ts';

const db = new PGlite();
const owner = randomUUID(), other = randomUUID();
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
type Row = Record<string, unknown>;
const original = {
  settings: 'keep', 'ai-fitness-selected-weekly-workout-plan': 'custom-plan',
  'ai-fitness-user-workout-settings': { dateOverrides: { [today()]: { groupId: 'rest' } } },
  [key]: { '2001-01-01': { workoutStatus: 'partial', workoutPain: true }, [today()]: { cardioDone: true, cardioMinutes: 20, foamRollerMemo: 'keep', pullupDone: true } },
};
const request = (overrides = {}) => ({ id: randomUUID(), day: today(), expected: workoutDaySnapshot(original, today()), resets: { fitness: null, assistant: null }, expires: new Date(Date.now() + 15 * 60_000).toISOString(), ...overrides });
const apply = async (p: ReturnType<typeof request>) => (await db.query<Row>('select public.apply_assistant_workout_command($1,$2,$3,$4,$5) receipt', [p.id, p.day, p.expected, p.resets, p.expires])).rows[0].receipt as Row;
const undo = async (id: string) => (await db.query<Row>('select public.undo_assistant_workout_command($1) receipt', [id])).rows[0].receipt as Row;
const state = async () => (await db.query<{state: Row}>('select state from public.user_app_state')).rows[0]?.state;
const count = async () => Number((await db.query<{n: number}>('select count(*) n from public.assistant_workout_command_history')).rows[0].n);
const write = async (value: Row) => db.query('update public.user_app_state set state=$1', [value]);
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
  await db.exec(read('../supabase/migrations/20260916094552_assistant_workout_commands.sql'));
  await db.exec(read('../supabase/migrations/20260916232300_assistant_workout_cardio_commands.sql'));
});
after(async () => db.close());
beforeEach(async () => {
  await db.exec(`reset role; truncate auth.users cascade; insert into auth.users values('${owner}'),('${other}'); set app.test_user='${owner}'; set role authenticated;`);
  await db.query('insert into public.user_app_state(user_id,state) values($1,$2)', [owner, original]);
});

test('completion is atomic and idempotent, preserves other records and custom plans, and never invents performed sets or pain answers', async () => {
  const p = request(); const receipt = await apply(p); const saved = await state();
  const record = workoutDaySnapshot(saved, today()).record as Row;
  assert.deepEqual(Object.keys(record).sort(), [...Object.keys(original[key][today()]), 'workoutDone','workoutStatus','workoutRoutineName','workoutRecordedAt'].sort());
  assert.equal(record.workoutDone, true); assert.equal(record.workoutStatus, 'completed');
  assert.equal(record.cardioMinutes, 20); assert.equal(record.foamRollerMemo, 'keep');
  assert.deepEqual(saved['ai-fitness-user-workout-settings'], original['ai-fitness-user-workout-settings']);
  assert.equal(saved['ai-fitness-selected-weekly-workout-plan'], 'custom-plan');
  assert.deepEqual((saved[key] as Row)['2001-01-01'], original[key]['2001-01-01']);
  assert.deepEqual(await apply(p), receipt); assert.equal(await count(), 1);
  const undone = await undo(p.id); assert.ok(undone.undone_at); assert.deepEqual(await state(), original);
  assert.deepEqual(await undo(p.id), undone); assert.deepEqual(await apply(p), undone); assert.deepEqual(await state(), original);
});
test('a ledger failure rolls back the workout and the same request is retryable', async () => {
  const p = request();
  await db.exec('reset role; alter table public.assistant_workout_command_history add constraint injected_failure check(false); set role authenticated;');
  await assert.rejects(apply(p)); assert.deepEqual(await state(), original); assert.equal(await count(), 0);
  await db.exec('reset role; alter table public.assistant_workout_command_history drop constraint injected_failure; set role authenticated;');
  await apply(p); assert.equal(await count(), 1);
});
test('two reviewed requests cannot both complete the same day', async () => {
  const results = await Promise.allSettled([apply(request()), apply(request())]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(await count(), 1);
});
test('later changes on other dates and settings survive both apply and undo', async () => {
  const p = request(); const changed = { ...original, settings: 'new', [key]: { ...original[key], '2001-01-03': { workoutMemo: 'new historical note' } } };
  await write(changed); await apply(p);
  const saved = await state(); await write({ ...saved, [key]: { ...(saved[key] as Row), '2001-01-04': false } });
  await undo(p.id); assert.deepEqual(await state(), { ...changed, [key]: { ...changed[key], '2001-01-04': false } });
});
test('later edits on the same date block undo, even when only cardio changed', async () => {
  const p = request(); await apply(p); const saved = await state();
  const changed = { ...saved, [key]: { ...(saved[key] as Row), [today()]: { ...(workoutDaySnapshot(saved, today()).record as Row), cardioMinutes: 30 } } };
  await write(changed); await assert.rejects(undo(p.id), /이후에 오늘 운동 기록/); assert.deepEqual(await state(), changed);
});
test('partial, stopped, pain, actual sets, and unknown workout fields never become completed', async () => {
  for (const record of [{ workoutStatus: 'partial', workoutDone: true }, { workoutStatus: 'stopped', workoutPain: true }, { workoutPain: false }, { workoutExerciseRecords: [{ exerciseName: 'actual', sets: [{ reps: 3 }] }] }, { exerciseRecords: [{ reps: 3 }] }, { workoutNewField: 'future data' }]) {
    const changed = { ...original, [key]: { ...original[key], [today()]: record } }; await write(changed);
    assert.equal(workoutRecordStatus({ record }), 'detailed');
    await assert.rejects(apply(request({ expected: workoutDaySnapshot(changed, today()) })), /기록/);
    assert.deepEqual(await state(), changed); assert.equal(await count(), 0);
  }
});
test('missing state, absent dates and legacy false values are reversible', async () => {
  for (const before of [{ settings: 'keep' }, { [key]: {} }, { [key]: { [today()]: false } }]) {
    await write(before); const p = request({ expected: workoutDaySnapshot(before, today()) }); await apply(p); await undo(p.id); assert.deepEqual(await state(), before);
  }
  await db.exec('delete from public.user_app_state'); const p = request({ expected: {} }); await apply(p); await undo(p.id); assert.deepEqual(await state(), {});
});
test('legacy JSON string stores retain every date and remain strings', async () => {
  const before = { ...original, [key]: JSON.stringify(original[key]) }; await write(before);
  const p = request(); await apply(p); await undo(p.id); const after = await state();
  assert.equal(typeof after[key], 'string'); assert.deepEqual(JSON.parse(after[key] as string), original[key]);
});
test('malformed records fail without erasing saved data', async () => {
  for (const value of [null, [], '{', 'null', { [today()]: null }, { [today()]: 'bad' }]) {
    const before = { ...original, [key]: value }; await write(before);
    assert.throws(() => workoutDaySnapshot(before, today()));
    await assert.rejects(apply(request())); assert.deepEqual(await state(), before); assert.equal(await count(), 0);
  }
});
test('expiry, date changes, reused IDs, and already completed records cannot create extra writes', async () => {
  for (const change of [{ expires: '2001-01-01T00:00:00Z' }, { day: '2001-01-01' }, { expected: { injected: true } }]) await assert.rejects(apply(request(change)));
  assert.deepEqual(await state(), original); const p = request(); await apply(p);
  await assert.rejects(apply({ ...p, expires: '2001-01-01T00:00:00Z' }), /이미 사용한 요청/);
  await assert.rejects(apply(request({ expected: workoutDaySnapshot(await state(), today()) })), /이미 완료/); assert.equal(await count(), 1);
});
test('RLS and anonymous grants isolate each owner and their receipts', async () => {
  const p = request(); await apply(p); await db.exec(`set app.test_user='${other}';`);
  assert.equal(await count(), 0); assert.equal(await state(), undefined); await assert.rejects(undo(p.id), /이력을 찾을 수/);
  await assert.rejects(db.query("insert into public.assistant_workout_command_history(user_id,id,record_date,payload_hash,before_values,after_values,store_format) values($1,$2,current_date,'x','{}','{}','object')", [owner, randomUUID()]));
  await db.exec('reset role; set role anon;'); await assert.rejects(apply(request())); await assert.rejects(db.query('select * from public.assistant_workout_command_history'));
});
for (const area of ['fitness','assistant']) test(`${area} reset erases snapshots and rejects older pending requests`, async () => {
  const saved = request(), pending = request(); await apply(saved);
  await db.query("select public.reset_my_app_records($1,$2,'초기화')", [area, randomUUID()]);
  assert.equal(await count(), 0); await assert.rejects(apply(pending), /초기화/); await assert.rejects(undo(saved.id), /이력을 찾을 수/);
});
test('Auth account deletion cascades history without granting the Auth role application permissions', async () => {
  await apply(request()); await db.exec(`reset role; set role synthetic_auth_admin; delete from auth.users where id='${owner}'; reset role;`); assert.equal(await count(), 0);
});
test('only explicit today completion is accepted; details, questions and conditions require the workout UI', () => {
  for (const text of ['오늘 운동 완료했어','운동 다 했어요','오늘 운동을 마쳤습니다','오늘 운동 완료로 기록해줘']) assert.doesNotThrow(() => parseWorkoutCompletion(text));
  for (const text of ['어제 운동 완료했어','내일 운동 끝낼거야','운동 완료 안했어','운동 완료하지 마','운동 일부 완료','운동 완료했어?','운동 끝나면 기록해줘','스쿼트 운동 3세트 완료했어','오늘 운동 완료했어 허리가 아파']) assert.throws(() => parseWorkoutCompletion(text));
});
test('workout draft recovery keeps the request and owner, rejecting malformed dates and snapshots', () => {
  const p = { domain: 'workout', ownerId: owner, requestId: randomUUID(), date: today(), expected: request().expected, resetMarkers: request().resets, expiresAt: request().expires };
  assert.ok(isWorkoutCommandProposal(p)); const drafts = [{ proposal: p, attempted: true }];
  assert.deepEqual(readCommandDrafts(JSON.stringify({ ownerId: owner, drafts }), owner), drafts);
  assert.deepEqual(readCommandDrafts(JSON.stringify({ ownerId: owner, drafts }), other), []);
  for (const bad of [{ ...p, date: '2026-02-30' }, { ...p, expected: { record: null } }, { ...p, ownerId: other }]) assert.throws(() => readCommandDrafts(JSON.stringify({ ownerId: owner, drafts: [{ proposal: bad, attempted: false }] }), owner));
});
