import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { buildGrowthProgressionSuggestion, growthSuggestionCanApply } from '../app/data/growthRoutineProgression.ts';
import type { GrowthAiReviewRow, GrowthCoachSuggestion, GrowthRoutineRow, GrowthSessionRow } from '../app/data/growthPlatform.ts';

const db = new PGlite();
const owner = randomUUID(), other = randomUUID();
const migrationName = '20261009190454_validate_growth_progression_evidence';
const migration = readFileSync(new URL(`../supabase/migrations/${migrationName}.sql`, import.meta.url), 'utf8');
let today: string;
const day = (ago: number) => { const value = new Date(`${today}T12:00:00Z`); value.setUTCDate(value.getUTCDate() - ago); return value.toISOString().slice(0, 10); };
const decode = <T>(value: unknown): T => JSON.parse(JSON.stringify(value));
const routineRow = async (id: string) => decode<GrowthRoutineRow>((await db.query('select * from public.growth_routines where id=$1', [id])).rows[0]);
const sessionRows = async (routineId: string) => decode<GrowthSessionRow[]>((await db.query("select id,user_id,routine_id,session_date::text,status,planned_minutes,actual_minutes,memo,source,metrics,started_at,ended_at,created_at,updated_at from public.growth_sessions where routine_id=$1 order by session_date,id", [routineId])).rows);
const reviewRow = async (id: string) => decode<GrowthAiReviewRow>((await db.query('select * from public.growth_ai_reviews where id=$1', [id])).rows[0]);
const review = async (suggestions: unknown[]) => {
  const result = await db.query<{ id: string }>('insert into public.growth_ai_reviews(user_id,period_start,period_end,source,suggestions) values($1,$2,$2,\'local\',$3) returning id', [owner, today, suggestions]);
  return result.rows[0].id;
};
const decide = async (id: string, suggestions: GrowthCoachSuggestion[], routines: GrowthRoutineRow[]) => decode<GrowthAiReviewRow>((await db.query<{ result: unknown }>(
  'select public.decide_growth_review($1,$2,$3) result', [id, suggestions.map(item => item.id), Object.fromEntries(routines.map(row => [row.id, row.updated_at]))],
)).rows[0].result);
async function seed(target = 10, ago = [2, 1, 0]) {
  const id = randomUUID();
  await db.query("insert into public.growth_routines(id,user_id,category,title,target_minutes) values($1,$2,'typing','합성 타자',$3)", [id, owner, target]);
  for (const offset of ago) await db.query("insert into public.growth_sessions(user_id,routine_id,session_date,status,planned_minutes,actual_minutes,metrics) values($1,$2,$3,'completed',$4,$4,$5)", [owner, id, day(offset), target, { routineDifficulty: 'too_easy', untouched: true }]);
  const routine = await routineRow(id), sessions = await sessionRows(id);
  const suggestion = buildGrowthProgressionSuggestion(routine, sessions, today)!;
  assert.ok(suggestion);
  return { routine, sessions, suggestion };
}
async function unchanged(id: string, routine: GrowthRoutineRow) {
  assert.equal((await routineRow(routine.id)).target_minutes, routine.target_minutes);
  assert.equal((await reviewRow(id)).decision, null);
}

before(async () => {
  await db.exec(`create role authenticated; create role anon; create role service_role; create schema auth;
    create table auth.users(id uuid primary key); insert into auth.users values('${owner}'),('${other}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  const base = readFileSync(new URL('../supabase/migrations/20260902120000_add_growth_platform.sql', import.meta.url), 'utf8');
  await db.exec(base.split('insert into storage.buckets')[0]);
  await db.exec(readFileSync(new URL('../supabase/migrations/20260902223000_harden_growth_routine_links.sql', import.meta.url), 'utf8'));
  await db.exec(migration);
  await db.exec(migration); // A replay changes no rows or permissions.
  today = (await db.query<{ today: string }>("select (current_timestamp at time zone 'Asia/Seoul')::date::text today")).rows[0].today;
});
after(async () => db.close());
beforeEach(async () => {
  await db.exec(`reset role; truncate public.growth_routines,public.growth_ai_reviews cascade; set app.test_user='${owner}'; set role authenticated;`);
});

test('valid current-goal evidence atomically applies +5 and preserves exact review and original sessions', async () => {
  const state = await seed(), id = await review([state.suggestion]);
  const result = await decide(id, [state.suggestion], [state.routine]);
  assert.equal(result.decision, 'applied'); assert.deepEqual(result.suggestions, [state.suggestion]);
  assert.equal((await routineRow(state.routine.id)).target_minutes, 15);
  assert.deepEqual(await sessionRows(state.routine.id), state.sessions);
  assert.deepEqual((await reviewRow(id)).decision_selection, [state.suggestion.id]);
});

test('cap is 240, and current Seoul day plus the exact 14-day boundary are included', async () => {
  const state = await seed(238, [13, 1, 0]), id = await review([state.suggestion]);
  await decide(id, [state.suggestion], [state.routine]);
  assert.equal((await routineRow(state.routine.id)).target_minutes, 240);
  assert.ok(state.suggestion.progression!.dates.includes(today));
});

test('keep ignores invalid or disappeared progression evidence and changes no target', async () => {
  const state = await seed(), id = await review([{ ...state.suggestion, progression: null }]);
  await db.query('delete from public.growth_sessions where routine_id=$1', [state.routine.id]);
  assert.equal((await decide(id, [], [])).decision, 'kept');
  assert.equal((await routineRow(state.routine.id)).target_minutes, 10);
});

test('immutable same-selection replay succeeds after evidence deletion and target changes without reapplying', async () => {
  const state = await seed(), id = await review([state.suggestion]);
  const original = await decide(id, [state.suggestion], [state.routine]);
  await db.query('delete from public.growth_sessions where routine_id=$1', [state.routine.id]);
  await db.query('update public.growth_routines set target_minutes=20,updated_at=now() where id=$1', [state.routine.id]);
  assert.deepEqual(await decide(id, [state.suggestion], [state.routine]), original);
  assert.equal((await routineRow(state.routine.id)).target_minutes, 20);
  await assert.rejects(decide(id, [], []), /이미 결정/);
});

test('deletion after successful client preflight is rejected by the RPC and replacement IDs cannot stand in', async () => {
  const state = await seed(), id = await review([state.suggestion]);
  assert.equal(growthSuggestionCanApply(state.suggestion, state.routine, state.sessions, today), true);
  const row = state.sessions[0];
  await db.query('delete from public.growth_sessions where id=$1', [row.id]);
  await db.query("insert into public.growth_sessions(user_id,routine_id,session_date,status,planned_minutes,actual_minutes,metrics) values($1,$2,$3,'completed',10,10,$4)", [owner, state.routine.id, row.session_date, row.metrics]);
  await assert.rejects(decide(id, [state.suggestion], [state.routine]), /근거/);
  await unchanged(id, state.routine);
});

for (const [name, change] of [
  ['target', { targetMinutes: 9 }], ['timestamp', { routineUpdatedAt: '2000-01-01T00:00:00Z' }],
  ['null object', null], ['missing dates', { dates: undefined }], ['non-array IDs', { sessionIds: {} }],
  ['invalid date', { dates: ['2026-02-30', '2026-02-28', '2026-02-27'] }],
  ['wrong value types', { dates: [1, 2, 3] }], ['wrong UUID types', { sessionIds: [1, 2, 3] }],
] as const) {
  test(`malformed or stale saved ${name} fails closed`, async () => {
    const state = await seed();
    const bad = { ...state.suggestion, progression: change === null ? null : { ...state.suggestion.progression, ...change } } as unknown as GrowthCoachSuggestion;
    const id = await review([bad]); await assert.rejects(decide(id, [bad], [state.routine])); await unchanged(id, state.routine);
  });
}

for (const field of ['dates', 'sessionIds'] as const) {
  test(`duplicated ${field} cannot inflate evidence`, async () => {
    const state = await seed(), bad = structuredClone(state.suggestion);
    bad.progression![field].push(bad.progression![field][0]);
    const id = await review([bad]); await assert.rejects(decide(id, [bad], [state.routine]), /근거/); await unchanged(id, state.routine);
  });
}

test('missing progression metadata and a larger-than-five-minute increase are rejected', async () => {
  const state = await seed();
  for (const bad of [{ ...state.suggestion, progression: undefined }, { ...state.suggestion, recommendedMinutes: 20 }]) {
    const id = await review([bad]); await assert.rejects(decide(id, [bad], [state.routine])); await unchanged(id, state.routine);
  }
});

test('saved dates must exactly match the saved session IDs, with at least three distinct recent days', async () => {
  const state = await seed();
  for (const dates of [[day(3), day(1), today], [day(14), day(1), today], [day(-1), day(1), today], [today, day(1)]]) {
    const bad = { ...state.suggestion, progression: { ...state.suggestion.progression!, dates } };
    const id = await review([bad]); await assert.rejects(decide(id, [bad], [state.routine]), /근거/); await unchanged(id, state.routine);
  }
  await db.query('update public.growth_sessions set session_date=$1 where routine_id=$2', [today, state.routine.id]);
  const id = await review([state.suggestion]); await assert.rejects(decide(id, [state.suggestion], [state.routine]), /근거/); await unchanged(id, state.routine);
});

for (const [name, sql] of [
  ['short completion', 'actual_minutes=9'], ['different planned target', 'planned_minutes=5'],
  ['partial', "status='partial'"], ['stopped', "status='stopped'"],
  ['missing feedback', "metrics='{}'"], ['unknown feedback', `metrics='{"routineDifficulty":"unknown"}'`],
  ['appropriate', `metrics='{"routineDifficulty":"appropriate"}'`], ['difficult', `metrics='{"routineDifficulty":"difficult"}'`],
  ['expired', "session_date=(current_timestamp at time zone 'Asia/Seoul')::date-14"],
  ['future', "session_date=(current_timestamp at time zone 'Asia/Seoul')::date+1"],
] as const) {
  test(`changed evidence: ${name} blocks the entire decision`, async () => {
    const state = await seed(), id = await review([state.suggestion]);
    await db.query(`update public.growth_sessions set ${sql} where id=$1`, [state.sessions[0].id]);
    await assert.rejects(decide(id, [state.suggestion], [state.routine]), /근거/); await unchanged(id, state.routine);
  });
}

for (const [status, difficulty, planned] of [['partial', null, 5], ['stopped', null, 20], ['completed', 'appropriate', 10], ['completed', 'difficult', 10]] as const) {
  test(`recent contrary ${status}/${difficulty} blocks despite valid saved easy sessions`, async () => {
    const state = await seed(), id = await review([state.suggestion]);
    await db.query('insert into public.growth_sessions(user_id,routine_id,session_date,status,planned_minutes,actual_minutes,metrics) values($1,$2,$3,$4,$5,1,$6)', [owner, state.routine.id, day(13), status, planned, difficulty ? { routineDifficulty: difficulty } : {}]);
    await assert.rejects(decide(id, [state.suggestion], [state.routine]), /근거/); await unchanged(id, state.routine);
  });
}

test('unrecorded feedback and difficulty at another target do not become contrary evidence', async () => {
  const state = await seed(), id = await review([state.suggestion]);
  for (const [planned, metrics] of [[10, {}], [5, { routineDifficulty: 'difficult' }]] as const) await db.query("insert into public.growth_sessions(user_id,routine_id,session_date,status,planned_minutes,actual_minutes,metrics) values($1,$2,$3,'completed',$4,1,$5)", [owner, state.routine.id, today, planned, metrics]);
  await decide(id, [state.suggestion], [state.routine]); assert.equal((await routineRow(state.routine.id)).target_minutes, 15);
});

test('other owners cannot decide, and foreign or another routine session IDs cannot supply evidence', async () => {
  const state = await seed(), id = await review([state.suggestion]);
  await db.exec(`set app.test_user='${other}';`);
  await assert.rejects(decide(id, [state.suggestion], [state.routine]), /코칭을 찾을/);
  assert.equal((await db.query('select id from public.growth_ai_reviews')).rows.length, 0);
  await db.exec(`set app.test_user='${owner}';`);
  const separate = await seed();
  for (const sessionId of [separate.sessions[0].id, randomUUID()]) {
    const bad = structuredClone(state.suggestion); bad.progression!.sessionIds[0] = sessionId;
    const badId = await review([bad]); await assert.rejects(decide(badId, [bad], [state.routine]), /근거/); await unchanged(badId, state.routine);
  }
  await db.exec('reset role;');
  await db.query('update public.growth_sessions set user_id=$1 where id=$2', [other, state.sessions[0].id]);
  await db.exec('set role authenticated;');
  await assert.rejects(decide(id, [state.suggestion], [state.routine]), /근거/); await unchanged(id, state.routine);
});

test('current target or schedule timestamp changes invalidate a saved review, even with refreshed expected versions', async () => {
  const state = await seed();
  for (const sql of ['target_minutes=15', "target_minutes=10,updated_at=updated_at+interval '1 second'"]) {
    const id = await review([state.suggestion]); await db.query(`update public.growth_routines set ${sql} where id=$1`, [state.routine.id]);
    const current = await routineRow(state.routine.id);
    await assert.rejects(decide(id, [state.suggestion], [current]), /현재 목표/); await unchanged(id, current);
  }
});

test('a later invalid progression rolls back an earlier selected legacy change and the decision', async () => {
  const legacy = await seed(), state = await seed();
  const decrease = { id: 'legacy-reduction', routineId: legacy.routine.id, title: 'reduce', reason: 'prior rule', recommendedMinutes: 5 };
  const id = await review([decrease, state.suggestion]);
  await db.query('delete from public.growth_sessions where id=$1', [state.sessions[0].id]);
  await assert.rejects(decide(id, [decrease, state.suggestion], [legacy.routine, state.routine]), /근거/);
  await unchanged(id, legacy.routine); await unchanged(id, state.routine);
});

test('legacy review semantics, including previous increase suggestions and idempotency, remain unchanged', async () => {
  const state = await seed(), legacy = { id: 'legacy-ai-increase', routineId: state.routine.id, title: 'old', reason: 'old', recommendedMinutes: 20 };
  await db.query('delete from public.growth_sessions where routine_id=$1', [state.routine.id]);
  const id = await review([legacy]), applied = await decide(id, [legacy], [state.routine]);
  assert.equal((await routineRow(state.routine.id)).target_minutes, 20);
  assert.deepEqual(await decide(id, [legacy], [state.routine]), applied);
});

test('migration preserves invoker/ACL and ordered fail-closed locks before target writes', async () => {
  const info = (await db.query<{ invoker: boolean; config: string[]; anon: boolean; owner: boolean }>("select not prosecdef invoker, proconfig config, has_function_privilege('anon',oid,'execute') anon, has_function_privilege('authenticated',oid,'execute') owner from pg_proc where proname='decide_growth_review'")).rows[0];
  assert.equal(info.invoker, true); assert.equal(info.anon, false); assert.equal(info.owner, true); assert.ok(info.config.some(value => value.startsWith('search_path=')));
  const ordered = ["pg_advisory_xact_lock", 'select * into review', 'if review.decision is not null', 'order by id for update;', 'order by id for share nowait;', 'update public.growth_routines'];
  for (let index = 1; index < ordered.length; index++) assert.ok(migration.indexOf(ordered[index - 1]) < migration.indexOf(ordered[index]));
  assert.match(migration, /exception when lock_not_available then[\s\S]*?errcode='40001'/);
  assert.match(migration, /current_timestamp at time zone 'Asia\/Seoul'/);
});

// These mutation cases are single-connection PGlite regressions. They do not
// claim to exercise competing PostgreSQL connections or NOWAIT contention.
test('unselected malformed suggestions and unrelated contrary sessions do not reject a selected progression', async () => {
  const state = await seed(), unrelated = await seed();
  await db.query("update public.growth_sessions set status='stopped' where routine_id=$1", [unrelated.routine.id]);
  const unrelatedSuggestion = { ...unrelated.suggestion, progression: null };
  const malformed = { id: 'local-next-step-unselected', routineId: 'not-a-uuid', recommendedMinutes: 15, progression: null };
  const id = await review([unrelatedSuggestion, malformed, state.suggestion]);
  const result = await decide(id, [state.suggestion], [state.routine]);
  assert.equal(result.decision, 'partial');
  assert.equal((await routineRow(state.routine.id)).target_minutes, 15);
  assert.equal((await routineRow(unrelated.routine.id)).target_minutes, 10);
});

test('selected legacy decisions ignore fresh-evidence rules and unselected malformed progression metadata', async () => {
  const state = await seed();
  await db.query("update public.growth_sessions set status='stopped' where routine_id=$1", [state.routine.id]);
  const legacy = { id: 'legacy-saved-increase', routineId: state.routine.id, title: 'old', reason: 'old', recommendedMinutes: 20 };
  const malformed = { id: 'local-next-step-unselected', routineId: 'not-a-uuid', recommendedMinutes: 15, progression: null };
  const id = await review([malformed, legacy]);
  assert.equal((await decide(id, [legacy], [state.routine])).decision, 'partial');
  assert.equal((await routineRow(state.routine.id)).target_minutes, 20);
});

test('newer easy records do not replace or invalidate an intact saved three-day evidence subset', async () => {
  const state = await seed(10, [5, 4, 3]), id = await review([state.suggestion]);
  for (const ago of [2, 1, 0]) await db.query("insert into public.growth_sessions(user_id,routine_id,session_date,status,planned_minutes,actual_minutes,metrics) values($1,$2,$3,'completed',10,10,$4)", [owner, state.routine.id, day(ago), { routineDifficulty: 'too_easy' }]);
  const currentSessions = await sessionRows(state.routine.id);
  const newer = buildGrowthProgressionSuggestion(state.routine, currentSessions, today)!;
  assert.notDeepEqual(newer.progression!.sessionIds, state.suggestion.progression!.sessionIds);
  assert.equal(growthSuggestionCanApply(state.suggestion, state.routine, currentSessions, today), true);
  const result = await decide(id, [state.suggestion], [state.routine]);
  assert.deepEqual(result.suggestions, [state.suggestion]);
  assert.equal((await routineRow(state.routine.id)).target_minutes, 15);
});

for (const move of ['another routine', 'no routine'] as const) {
  test(`saved evidence moved to ${move} blocks the decision`, async () => {
    const state = await seed(), unrelated = await seed(), id = await review([state.suggestion]);
    await db.query('update public.growth_sessions set routine_id=$1 where id=$2', [move === 'another routine' ? unrelated.routine.id : null, state.sessions[0].id]);
    await assert.rejects(decide(id, [state.suggestion], [state.routine]), /근거/);
    await unchanged(id, state.routine);
  });
}

test('an older contrary session moved into the current window blocks progression', async () => {
  const state = await seed();
  const inserted = await db.query<{ id: string }>("insert into public.growth_sessions(user_id,routine_id,session_date,status,planned_minutes,actual_minutes) values($1,$2,$3,'stopped',10,1) returning id", [owner, state.routine.id, day(14)]);
  const id = await review([state.suggestion]);
  await db.query('update public.growth_sessions set session_date=$1 where id=$2', [today, inserted.rows[0].id]);
  await assert.rejects(decide(id, [state.suggestion], [state.routine]), /근거/);
  await unchanged(id, state.routine);
});

test('a contrary session moved from another routine blocks progression', async () => {
  const state = await seed(), unrelated = await seed(), id = await review([state.suggestion]);
  await db.query("update public.growth_sessions set status='stopped',routine_id=$1 where id=$2", [state.routine.id, unrelated.sessions[0].id]);
  await assert.rejects(decide(id, [state.suggestion], [state.routine]), /근거/);
  await unchanged(id, state.routine);
});

test('replacement preserves original function owner, exact ACL, empty search path, table grants, and RLS policies', async () => {
  await db.exec('reset role;');
  const oldMigration = readFileSync(new URL('../supabase/migrations/20260908233141_app_wide_reliability.sql', import.meta.url), 'utf8');
  const previousRpc = oldMigration.slice(oldMigration.indexOf('create or replace function public.decide_growth_review'));
  const snapshot = async () => ({
    rpc: (await db.query<{ owner: string; acl: string | null; prosecdef: boolean; proconfig: string[] | null }>("select proowner::regrole::text owner,proacl::text acl,prosecdef,proconfig from pg_proc where oid='public.decide_growth_review(uuid,jsonb,jsonb)'::regprocedure")).rows,
    tables: (await db.query("select relname,relowner::regrole::text owner,relacl::text acl,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname in ('growth_routines','growth_sessions','growth_ai_reviews','growth_resources') order by relname")).rows,
    policies: (await db.query("select * from pg_policies where schemaname='public' and tablename in ('growth_routines','growth_sessions','growth_ai_reviews','growth_resources') order by tablename,policyname")).rows,
  });
  await db.exec(previousRpc);
  const original = await snapshot();
  await db.exec(migration);
  assert.deepEqual(await snapshot(), original);
  assert.deepEqual(original.rpc[0].proconfig, ['search_path=""']);
  assert.equal(original.rpc[0].prosecdef, false);
  await db.exec('set role authenticated;');
});
