import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { emptyRoutineForm, makeRoutineAttempt } from '../lib/routine-record-recovery.ts';
import type { GrowthRoutineRow } from '../app/data/growthPlatform.ts';

// Real PostgreSQL SQL/RLS execution in a single-connection PGlite fixture.
// These are serialization-order and lock-contract checks, NOT proof of lock
// contention across concurrent connections, hosted PostgREST, or browser flows.
const db = new PGlite();
const owner = '00000000-0000-4000-8000-000000000701';
const other = '00000000-0000-4000-8000-000000000702';
const routine = '00000000-0000-4000-8000-000000000703';
const otherRoutine = '00000000-0000-4000-8000-000000000704';
const initialTime = '2026-10-01T00:00:00.000Z';
const markerKey = 'ai-fitness-record-reset-growth';
const originalState = { preferences: { font: 'large' }, 'ai-fitness-record-reset-diet': 'keep-diet-generation' };
const tables = ['user_app_state', 'growth_routines', 'growth_sessions', 'growth_ai_reviews', 'growth_resources'] as const;
const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261009210500_save_routine_session.sql');
let installationBefore: unknown;
let installationAfter: unknown;

function payload(overrides: Record<string, unknown> = {}, mode: 'active' | 'manual' | 'quick' = 'manual') {
  const form = { ...emptyRoutineForm('2026-10-09'), routineId: routine, minutes: '17', memo: 'synthetic routine', difficulty: 'too_easy', startedAt: '2026-10-09T10:00:00.000Z' };
  return { ...makeRoutineAttempt(owner, mode, mode === 'quick' ? null : form, { id: routine, user_id: owner, target_minutes: 15 } as GrowthRoutineRow, randomUUID(), '2026-10-09', '2026-10-09T10:01:02.000Z').payload, ...overrides };
}
const save = (value: unknown, marker: string | null = null, expectedOwner: string | null = owner) =>
  db.query('select public.save_routine_session($1, $2, $3)', [typeof value === 'string' ? JSON.stringify(value) : value, expectedOwner, marker]);
const reset = async (requestId = randomUUID()) => (await db.query<{ result: { marker: string } }>(
  "select public.reset_my_app_records('growth', $1, '초기화') result", [requestId],
)).rows[0].result;
const rows = async (table = 'growth_sessions') => (await db.query<{ value: Record<string, unknown> }>(
  `select to_jsonb(t) value from public.${table} t order by to_jsonb(t)::text`,
)).rows.map(row => row.value);
const row = async (id: string) => (await db.query<{ value: Record<string, unknown> }>(
  'select to_jsonb(t) value from public.growth_sessions t where id=$1', [id],
)).rows[0]?.value;
const marker = async () => (await db.query<{ marker: string | null }>(
  `select state->>'${markerKey}' marker from public.user_app_state where user_id=$1`, [owner],
)).rows[0]?.marker ?? null;
async function snapshot() {
  const result: Record<string, unknown> = {};
  for (const table of tables) result[table] = await rows(table);
  return result;
}
async function installationSnapshot() {
  return {
    records: await snapshot(),
    policies: (await db.query('select * from pg_policies where schemaname=\'public\' order by tablename,policyname')).rows,
    grants: (await db.query("select * from information_schema.table_privileges where table_schema='public' order by table_name,grantee,privilege_type")).rows,
    reset: (await db.query("select pg_get_functiondef('public.reset_my_app_records(text,uuid,text)'::regprocedure) definition")).rows,
  };
}
async function seed() {
  await db.exec(`reset role; truncate auth.users cascade;
    insert into auth.users values('${owner}'),('${other}');
    insert into public.growth_routines(id,user_id,category,title)
      values('${routine}','${owner}','typing','A typing'),('${otherRoutine}','${other}','typing','B typing');
    insert into public.growth_sessions(user_id,routine_id,session_date,status,memo,source)
      values('${owner}','${routine}','2001-01-01','partial','A original','manual'),
            ('${other}','${otherRoutine}','2001-01-01','completed','B original','manual');
    insert into public.growth_ai_reviews(user_id,period_start,period_end,source)
      values('${owner}','2001-01-01','2001-01-02','local'),('${other}','2001-01-01','2001-01-02','local');
    insert into public.growth_resources(user_id,routine_id,title,storage_path,mime_type,size_bytes)
      values('${owner}','${routine}','keep resource','${owner}/keep.txt','text/plain',5);`);
  await db.query('insert into public.user_app_state(user_id,state,updated_at) values($1,$2,$3),($4,$5,$3)',
    [owner, originalState, initialTime, other, { [markerKey]: 'B-generation', preferences: 'keep B' }]);
  await db.exec(`set app.test_user='${owner}'; set role authenticated;`);
}

before(async () => {
  await db.exec(`create role authenticated; create role anon; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;`);
  // Use the real growth tables, constraints, table privileges, and policies.
  // Only the Storage bucket/policies (unrelated to this save) are omitted.
  await db.exec(read('../supabase/migrations/20260902120000_add_growth_platform.sql').split('insert into storage.buckets')[0]);
  await db.exec(read('../supabase/migrations/20260902223000_harden_growth_routine_links.sql'));
  await db.exec(read('./e2e/schema.sql').split('create table public.language_user_state')[0]);
  const initialReset = read('../supabase/migrations/20260906141943_add_app_record_resets.sql');
  const deletePolicy = initialReset.slice(initialReset.indexOf('create policy "Users can delete own growth AI reviews"'), initialReset.indexOf('create or replace function'));
  await db.exec(`grant delete on public.growth_ai_reviews to authenticated; ${deletePolicy}`);
  // Execute the latest existing reset function verbatim. Its growth branch needs
  // only user_app_state, growth_sessions, and growth_ai_reviews; no rewritten mock.
  const latestReset = read('../supabase/migrations/20260915034857_assistant_task_command_history.sql');
  await db.exec(latestReset.slice(latestReset.indexOf('create or replace function public.reset_my_app_records')));
  await seed();
  await db.exec('reset role;');
  installationBefore = await installationSnapshot();
  await db.exec(migration);
  installationAfter = await installationSnapshot();
});
beforeEach(seed);
after(async () => { await db.close(); });

test('routine RPC additive install preserves seeded rows, RLS, table grants, and reset function', () => {
  assert.deepEqual(installationAfter, installationBefore);
});
for (const mode of ['active','manual','quick'] as const) test(`${mode} exact payload round-trips all fields and replay is an immutable no-op`, async () => {
  const value = payload({}, mode); await save(value); await save(value);
  const result = await row(value.id); assert.ok(result);
  for (const [key, expected] of Object.entries(value)) {
    if (['updated_at','started_at','ended_at'].includes(key) && expected !== null) assert.equal(new Date(result[key] as string).toISOString(), expected);
    else assert.deepEqual(result[key], expected, key);
  }
  assert.equal((await rows()).filter(item => item.id === value.id).length, 1);
});
test('changed same-ID payload is never updated, even for a one-microsecond timestamp difference', async () => {
  const value = payload(); await save(value); const original = await row(value.id);
  for (const changes of [{ memo: 'changed' }, { actual_minutes: 16 }, { updated_at: '2026-10-09T10:01:02.000001Z' }, { routine_id: otherRoutine }]) {
    await assert.rejects(save({ ...value, ...changes }), /routine_save_conflict|routine_routine_invalid/);
    assert.deepEqual(await row(value.id), original);
  }
});
test('real reset after save removes row and fences exact replay and stale absent-row insert', async () => {
  const value = payload(); await save(value); const receipt = await reset(); assert.equal(await row(value.id), undefined);
  await assert.rejects(save(value), /routine_reset_changed/); await assert.rejects(save(payload()), /routine_reset_changed/);
  await save(payload(), receipt.marker); assert.equal((await rows()).length, 1);
});
test('reset before save blocks stale generation without changing routines/resources/other-owner records', async () => {
  await db.exec('reset role;'); const before = await snapshot(); await db.exec('set role authenticated;'); await reset();
  await assert.rejects(save(payload()), /routine_reset_changed/);
  await db.exec('reset role;'); const after = await snapshot();
  assert.deepEqual(after.growth_routines, before.growth_routines); assert.deepEqual(after.growth_resources, before.growth_resources);
  assert.deepEqual((after.growth_sessions as Record<string, unknown>[]).filter(item => item.user_id === other), (before.growth_sessions as Record<string, unknown>[]).filter(item => item.user_id === other));
});
test('null generation works with missing state row and does not manufacture user app state', async () => {
  await db.query('delete from public.user_app_state where user_id=$1', [owner]); await save(payload()); assert.equal((await rows('user_app_state')).length, 0);
});
test('server requires auth owner, exact payload owner and owned routine', async () => {
  await assert.rejects(save(payload(), null, other), /routine_owner_changed/);
  await assert.rejects(save(payload({ user_id: other })), /routine_owner_changed/);
  await assert.rejects(save(payload({ routine_id: otherRoutine })), /routine_routine_invalid/);
  await assert.rejects(save(payload({ routine_id: randomUUID() })), /routine_routine_invalid/);
  await db.exec('set role anon;'); await assert.rejects(save(payload()), /permission denied/);
});
const invalid: Record<string, unknown>[] = [
  { source: 'typing' }, { status: 'unknown' }, { actual_minutes: -1 }, { actual_minutes: 1441 }, { actual_minutes: 1.5 }, { actual_minutes: '17' }, { actual_minutes: null },
  { planned_minutes: 241 }, { routine_id: null }, { id: 'bad' }, { session_date: '2026-02-30' }, { session_date: '2026-1-01' }, { memo: 'x'.repeat(501) }, { memo: null },
  { updated_at: 'infinity' }, { updated_at: null }, { updated_at: '2026-10-09' }, { unexpected: 'never inserted' }, { started_at: '2026-10-09T10:00:00Z' },
  { metrics: null }, { metrics: [] }, { metrics: {} }, { metrics: { recordMode: null, actualMinutesRecorded: true } },
  { metrics: { recordMode: 'manual', actualMinutesRecorded: null } }, { metrics: { recordMode: 'manual', actualMinutesRecorded: false } },
  { metrics: { recordMode: 'manual', actualMinutesRecorded: true, extra: 'x' } },
  { metrics: { recordMode: 'manual', actualMinutesRecorded: true, stopReason: 'tired' } },
  { metrics: { recordMode: 'manual', actualMinutesRecorded: true, routineDifficulty: 'unrecorded' } },
  { metrics: { recordMode: 'manual', actualMinutesRecorded: true, routineDifficulty: null } },
];
for (const [index, value] of invalid.entries()) test(`invalid general routine payload ${index + 1} is rejected without insert`, async () => {
  const before = await rows(); await assert.rejects(save(payload(value)), /routine_invalid_payload|routine_owner_changed/); assert.deepEqual(await rows(), before);
});
test('missing fields and nonobject JSON are rejected rather than defaulted', async () => {
  for (const value of [null, [], 'x', ...Object.keys(payload()).map(key => { const value = payload() as Record<string, unknown>; delete value[key]; return value; })]) await assert.rejects(save(value), /routine_invalid_payload|routine_owner_changed/);
});
test('active time must be finite ordered exact evidence; sub-minute zero remains zero', async () => {
  const base = payload({}, 'active');
  for (const changes of [{ started_at: null }, { ended_at: null }, { actual_minutes: 2 }, { started_at: '2026-10-09T11:00:00Z' }, { updated_at: '2026-10-09T10:01:03Z' }]) await assert.rejects(save({ ...base, ...changes }), /routine_invalid_payload/);
  const zero = payload({ started_at: '2026-10-09T10:01:02.000Z', actual_minutes: 0 }, 'active'); await save(zero); assert.equal((await row(zero.id))!.actual_minutes, 0);
});
test('quick completion forbids invented time, difficulty, status and timestamps', async () => {
  const base = payload({}, 'quick');
  for (const changes of [{ actual_minutes: 15 }, { status: 'partial' }, { started_at: '2026-10-09T10:00:00Z' }, { metrics: { recordMode: 'quick', actualMinutesRecorded: true } }, { metrics: { recordMode: 'quick', actualMinutesRecorded: false, routineDifficulty: 'too_easy' } }]) await assert.rejects(save({ ...base, ...changes }), /routine_invalid_payload/);
});
test('stopped and partial feedback is explicit while completed feedback remains optional', async () => {
  for (const status of ['partial','stopped']) {
    await save(payload({ status, metrics: { recordMode: 'manual', actualMinutesRecorded: true, stopReason: 'unrecorded' } }));
    await assert.rejects(save(payload({ status, metrics: { recordMode: 'manual', actualMinutesRecorded: true } })), /routine_invalid_payload/);
  }
  await save(payload({ metrics: { recordMode: 'manual', actualMinutesRecorded: true } }));
});
test('routine SQL explicitly shares reset owner transaction lock and has no UPDATE/upsert', () => {
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('app-record-reset:'/);
  assert.ok(migration.indexOf('perform pg_advisory_xact_lock') < migration.indexOf("select state->>'ai-fitness-record-reset-growth'"));
  assert.doesNotMatch(migration, /\bon conflict\b|\bupdate public\./i);
});
