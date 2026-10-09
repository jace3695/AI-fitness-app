import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { emptyTypingBasicsDraft, makeTypingBasicsSession } from '../lib/typing-basics-draft.ts';
import { pressTypingKey, TYPING_KEYS } from '../app/data/typingBasics.ts';

// Exercise the unchanged production RPC and real growth RLS with the shipping
// basics payload. No SQL changes, hosted connection or multi-connection claims.
const db = new PGlite();
const owner = '00000000-0000-4000-8000-000000000721', other = '00000000-0000-4000-8000-000000000722';
const routine = '00000000-0000-4000-8000-000000000723', otherRoutine = '00000000-0000-4000-8000-000000000724';
const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
function payload() {
  const draft = emptyTypingBasicsDraft(owner, null, 5);
  draft.startedAt = Date.parse('2026-10-09T10:00:00Z'); draft.endedAt = draft.startedAt + 65000; draft.checks = [true, true];
  draft.attempt = pressTypingKey(draft.attempt, draft.lesson.keys, 'KeyF');
  for (const char of draft.lesson.keys) draft.attempt = pressTypingKey(draft.attempt, draft.lesson.keys, TYPING_KEYS[char].code);
  const session = makeTypingBasicsSession(draft, routine, randomUUID(), '2026-10-09');
  return { id: session.id, user_id: owner, routine_id: routine, session_date: session.sessionDate, status: session.status,
    planned_minutes: session.plannedMinutes, actual_minutes: session.actualMinutes, memo: session.memo, source: session.source,
    metrics: session.metrics, started_at: session.startedAt, ended_at: session.endedAt, updated_at: session.endedAt };
}
const save = (value: ReturnType<typeof payload>, marker: string | null = null) => db.query('select public.save_sentence_typing_session($1,$2,$3)', [value, owner, marker]);
const rows = async () => (await db.query<{ value: Record<string, unknown> }>('select to_jsonb(t) value from public.growth_sessions t order by id')).rows.map(row => row.value);
before(async () => {
  await db.exec(`create role authenticated; create role anon; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  await db.exec(read('../supabase/migrations/20260902120000_add_growth_platform.sql').split('insert into storage.buckets')[0]);
  await db.exec(read('../supabase/migrations/20260902223000_harden_growth_routine_links.sql'));
  await db.exec(read('./e2e/schema.sql').split('create table public.language_user_state')[0]);
  const initial = read('../supabase/migrations/20260906141943_add_app_record_resets.sql');
  await db.exec('grant delete on public.growth_ai_reviews to authenticated;' + initial.slice(initial.indexOf('create policy "Users can delete own growth AI reviews"'), initial.indexOf('create or replace function')));
  const latest = read('../supabase/migrations/20260915034857_assistant_task_command_history.sql');
  await db.exec(latest.slice(latest.indexOf('create or replace function public.reset_my_app_records')));
  await db.exec(read('../supabase/migrations/20261009183602_save_sentence_typing_session.sql'));
});
beforeEach(async () => {
  await db.exec(`reset role; truncate auth.users cascade; insert into auth.users values('${owner}'),('${other}');
    insert into public.growth_routines(id,user_id,category,title) values('${routine}','${owner}','typing','A'),('${otherRoutine}','${other}','typing','B');
    insert into public.growth_sessions(user_id,routine_id,session_date,status,memo) values('${owner}','${routine}','2001-01-01','partial','original A'),('${other}','${otherRoutine}','2001-01-01','partial','original B');
    insert into public.user_app_state(user_id,state) values('${owner}','{"keep":"A"}'),('${other}','{"keep":"B"}');
    set app.test_user='${owner}'; set role authenticated;`);
});
after(async () => db.close());
test('unchanged typing RPC accepts exact basics lesson, mistake, check and timestamp payload without changing originals', async () => {
  await db.exec('reset role;'); const before = await rows(); await db.exec('set role authenticated;');
  const value = payload(); await save(value);
  const saved = (await rows()).find(row => row.id === value.id)!;
  for (const [key, expected] of Object.entries(value)) {
    if (['started_at', 'ended_at', 'updated_at'].includes(key)) assert.equal(new Date(saved[key] as string).toISOString(), expected);
    else assert.deepEqual(saved[key], expected, key);
  }
  assert.equal(value.metrics.courseId, 'typing-position-v1'); assert.equal(value.metrics.lessonId, 'home');
  await assert.rejects(save(value), /duplicate key/); await assert.rejects(save({ ...value, metrics: { changed: true } }), /duplicate key/);
  await db.exec('reset role;'); assert.deepEqual((await rows()).filter(row => row.id !== value.id), before);
});
test('existing reset generation fence rejects old basics payload after reset and keeps B intact', async () => {
  const value = payload(); await save(value);
  const reset = (await db.query<{ result: { marker: string } }>("select public.reset_my_app_records('growth',$1,'초기화') result", [randomUUID()])).rows[0].result;
  await assert.rejects(save(value), /typing_reset_changed/); assert.deepEqual(await rows(), []);
  await save(payload(), reset.marker); assert.equal((await rows()).length, 1);
  await assert.rejects(save({ ...payload(), routine_id: otherRoutine }, reset.marker), /row-level security/);
  await db.exec(`set app.test_user='${other}';`); assert.equal((await rows()).length, 1); assert.equal((await rows())[0].memo, 'original B');
});
