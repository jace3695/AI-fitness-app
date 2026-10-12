import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { emptySentenceTypingDraft, makeSentenceTypingSession } from '../lib/sentence-typing-draft.ts';

// Exercise the actual disposable browser schema, rather than substituting the
// fuller production tables used by sentence-typing-migration.test.ts.
const db = new PGlite();
const owner = '00000000-0000-4000-8000-000000000711';
const other = '00000000-0000-4000-8000-000000000712';
const routine = '00000000-0000-4000-8000-000000000713';
const markerKey = 'ai-fitness-record-reset-growth';
const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
function payload() {
  const startedAt = Date.parse('2026-10-09T10:00:00Z');
  const session = makeSentenceTypingSession({ ...emptySentenceTypingDraft(owner, null), typed: 'xx', startedAt },
    { id: routine, target_minutes: 15 }, randomUUID(), '2026-10-09', startedAt + 1000);
  return { id: session.id, user_id: owner, routine_id: routine, session_date: session.sessionDate, status: session.status,
    planned_minutes: session.plannedMinutes, actual_minutes: session.actualMinutes, memo: session.memo, source: session.source,
    metrics: session.metrics, started_at: session.startedAt, ended_at: session.endedAt, updated_at: session.endedAt };
}
const save = (value: ReturnType<typeof payload>, marker: string | null = null) =>
  db.query('select public.save_sentence_typing_session($1,$2,$3)', [value, owner, marker]);
const reset = async () => (await db.query<{ result: { marker: string } }>(
  "select public.reset_my_app_records('growth',$1,'초기화') result", [randomUUID()],
)).rows[0].result;
const rows = async (table: string) => (await db.query<Record<string, unknown>>(`select * from public.${table} order by id`)).rows;

before(async () => {
  await db.exec(`create role authenticated; create role anon; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  await db.exec(read('./e2e/schema.sql'));
  await db.exec(read('./e2e/growth-reset-contract.sql'));
  const latestReset = read('../supabase/migrations/20260915034857_assistant_task_command_history.sql');
  await db.exec(latestReset.slice(latestReset.indexOf('create or replace function public.reset_my_app_records')));
  await db.exec(read('../supabase/migrations/20261009183602_save_sentence_typing_session.sql'));
});
beforeEach(async () => {
  await db.exec(`reset role; truncate auth.users cascade;
    insert into auth.users values('${owner}'),('${other}');
    insert into public.growth_routines(id,user_id,category,title) values('${routine}','${owner}','typing','Fixture typing');
    insert into public.growth_sessions(user_id,session_date,status) values('${owner}','2001-01-01','partial'),('${other}','2001-01-01','partial');
    insert into public.growth_ai_reviews(user_id,period_start,period_end,source) values('${owner}','2001-01-01','2001-01-01','local'),('${other}','2001-01-01','2001-01-01','local');
    insert into public.user_app_state(user_id,state) values('${owner}','{"keep":"original"}'),('${other}','{"keep":"other"}');
    set app.test_user='${owner}'; set role authenticated;`);
});
after(async () => db.close());

test('browser fixture saves exact sentence payload and a real invoker reset deletes only the owner records', async () => {
  const value = payload(); await save(value);
  const saved = (await db.query<{ value: Record<string, unknown> }>('select to_jsonb(t) value from public.growth_sessions t where id=$1', [value.id])).rows[0].value;
  for (const [key, expected] of Object.entries(value)) {
    if (['started_at','ended_at','updated_at'].includes(key)) assert.equal(new Date(saved[key] as string).toISOString(), expected);
    else assert.deepEqual(saved[key], expected, key);
  }
  await db.exec('reset role;');
  const sessions = await rows('growth_sessions'), reviews = await rows('growth_ai_reviews'), routines = await rows('growth_routines');
  await db.exec('set role authenticated;');
  const receipt = await reset();
  assert.deepEqual(await rows('growth_sessions'), []); assert.deepEqual(await rows('growth_ai_reviews'), []);
  await assert.rejects(save(value), /typing_reset_changed/);
  await db.exec('reset role;');
  assert.deepEqual(await rows('growth_sessions'), sessions.filter(row => row.user_id === other));
  assert.deepEqual(await rows('growth_ai_reviews'), reviews.filter(row => row.user_id === other));
  assert.deepEqual(await rows('growth_routines'), routines);
  const states = (await db.query<{ user_id: string; state: unknown }>('select user_id,state from public.user_app_state')).rows;
  assert.deepEqual(states.find(row => row.user_id === owner)?.state, { keep: 'original', [markerKey]: receipt.marker });
  assert.deepEqual(states.find(row => row.user_id === other)?.state, { keep: 'other' });
});

test('browser fixture reset before sentence save rejects the stale generation but allows a new one', async () => {
  const receipt = await reset();
  await assert.rejects(save(payload()), /typing_reset_changed/);
  assert.deepEqual(await rows('growth_sessions'), []);
  await save(payload(), receipt.marker); assert.equal((await rows('growth_sessions')).length, 1);
});

test('browser fixture review DELETE stays owner-scoped and unavailable to anon', async () => {
  await db.query('delete from public.growth_ai_reviews where user_id=$1', [other]);
  await db.exec('reset role;'); assert.equal((await rows('growth_ai_reviews')).length, 2);
  await db.exec('set role anon;');
  await assert.rejects(db.exec('delete from public.growth_ai_reviews'), /permission denied/);
});
