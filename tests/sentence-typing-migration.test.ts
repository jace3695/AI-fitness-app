import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { emptySentenceTypingDraft, makeSentenceTypingSession } from '../lib/sentence-typing-draft.ts';

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
const migration = read('../supabase/migrations/20261009183602_save_sentence_typing_session.sql');
let installationBefore: unknown;
let installationAfter: unknown;

function payload(overrides: Record<string, unknown> = {}) {
  const startedAt = Date.parse('2026-10-09T10:00:00.000Z');
  const draft = { ...emptySentenceTypingDraft(owner, null), typed: '천천xx', startedAt };
  const session = makeSentenceTypingSession(draft, { id: routine, target_minutes: 15 }, randomUUID(), '2026-10-09', startedAt + 62_000);
  return {
    id: session.id, user_id: owner, routine_id: session.routineId,
    session_date: session.sessionDate, status: session.status,
    planned_minutes: session.plannedMinutes, actual_minutes: session.actualMinutes,
    memo: session.memo, source: session.source, metrics: session.metrics,
    started_at: session.startedAt, ended_at: session.endedAt, updated_at: session.endedAt,
    ...overrides,
  };
}
const save = (value: unknown, marker: string | null = null, expectedOwner: string | null = owner) =>
  db.query('select public.save_sentence_typing_session($1, $2, $3)', [value, expectedOwner, marker]);
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

test('additive installation preserves every seeded record, policy, table grant and existing reset definition', () => {
  assert.deepEqual(installationAfter, installationBefore);
});

test('frozen sentence payload round-trips all 13 fields; save changes no unrelated records or state', async () => {
  await db.exec('reset role;'); const before = await snapshot(); await db.exec('set role authenticated;');
  const value = payload(); await save(value);
  const saved = await row(value.id);
  assert.ok(saved);
  for (const [field, expected] of Object.entries(value)) {
    if (['started_at','ended_at','updated_at'].includes(field)) assert.equal(new Date(saved[field] as string).toISOString(), expected);
    else assert.deepEqual(saved[field], expected, field);
  }
  await db.exec('reset role;'); const after = await snapshot();
  after.growth_sessions = (after.growth_sessions as Record<string, unknown>[]).filter(item => item.id !== value.id);
  assert.deepEqual(after, before);
});

test('null initial generation works both with a missing marker and a missing app-state row', async () => {
  await save(payload());
  await db.query('delete from public.user_app_state where user_id=$1', [owner]);
  await save(payload());
  assert.equal((await rows('user_app_state')).length, 0, 'save must not create or mutate app state');
  assert.equal((await rows()).length, 3);
  await assert.rejects(save(payload(), 'invented-generation'), /typing_reset_changed/);
});

test('save then real growth reset removes the saved row; unrelated state, routines, resources and B rows survive', async () => {
  await db.exec('reset role;'); const before = await snapshot(); await db.exec('set role authenticated;');
  const value = payload(); await save(value); assert.ok(await row(value.id));
  const receipt = await reset(); assert.equal(await row(value.id), undefined); assert.equal((await rows()).length, 0);
  await db.exec('reset role;'); const after = await snapshot();
  assert.deepEqual(after.growth_routines, before.growth_routines);
  assert.deepEqual(after.growth_resources, before.growth_resources);
  for (const table of ['growth_sessions', 'growth_ai_reviews']) {
    assert.deepEqual(after[table], (before[table] as Record<string, unknown>[]).filter(item => item.user_id === other));
  }
  const states = after.user_app_state as { user_id: string; state: Record<string, unknown> }[];
  assert.deepEqual(states.find(item => item.user_id === other), (before.user_app_state as { user_id: string }[]).find(item => item.user_id === other));
  assert.deepEqual(states.find(item => item.user_id === owner)?.state, { ...originalState, [markerKey]: receipt.marker });
});

test('real reset then stale save rejects the previously checked generation; no deleted row is resurrected', async () => {
  const value = payload();
  const checkedBeforeReset = await marker(); assert.equal(checkedBeforeReset, null);
  const receipt = await reset();
  await assert.rejects(save(value, checkedBeforeReset), /typing_reset_changed/);
  assert.equal(await row(value.id), undefined); assert.equal((await rows()).length, 0);
  assert.equal(await marker(), receipt.marker);
});

test('the fresh reset marker saves successfully; next reset rejects that now-stale marker', async () => {
  const first = await reset(); const value = payload();
  await save(value, first.marker); assert.ok(await row(value.id));
  const second = await reset(); assert.notEqual(second.marker, first.marker);
  await assert.rejects(save(value, first.marker), /typing_reset_changed/);
  assert.equal(await row(value.id), undefined);
  await save(value, second.marker); assert.ok(await row(value.id));
});

test('retrying the existing reset receipt does not delete a fresh-generation save', async () => {
  const request = randomUUID(), receipt = await reset(request), value = payload();
  await save(value, receipt.marker); const saved = await row(value.id);
  assert.deepEqual(await reset(request), receipt); assert.deepEqual(await row(value.id), saved);
});

test('same-ID identical retry raises uniqueness and exact readback remains available; conflicting retry never updates', async () => {
  const value = payload(); await save(value); const saved = await row(value.id);
  await assert.rejects(save(value), /duplicate key/); assert.deepEqual(await row(value.id), saved);
  for (const patch of [{ memo: 'changed' }, { metrics: { accuracy: 0 } }, { actual_minutes: 9 }]) {
    await assert.rejects(save({ ...value, ...patch }), /duplicate key/);
    assert.deepEqual(await row(value.id), saved);
  }
  assert.equal((await rows()).length, 2);
});

test('authenticated expected-owner and payload-owner checks stop A/B spoofing and missing auth', async () => {
  const before = await rows();
  for (const expected of [other, null]) await assert.rejects(save(payload(), null, expected), /typing_owner_changed/);
  for (const user_id of [other, null, 1]) await assert.rejects(save(payload({ user_id })), /typing_owner_changed/);
  await db.exec("set app.test_user='';"); await assert.rejects(save(payload()), /typing_owner_changed/);
  await db.exec(`set app.test_user='${owner}';`); assert.deepEqual(await rows(), before);
});

test('B cannot read A session or save as A; B can save only with its own routine and generation', async () => {
  const value = payload(); await save(value); const saved = await row(value.id);
  await db.exec(`set app.test_user='${other}';`);
  assert.equal(await row(value.id), undefined);
  await assert.rejects(save(payload()), /typing_owner_changed/);
  await assert.rejects(save(payload({ user_id: other, routine_id: otherRoutine }), null, other), /typing_reset_changed/);
  const own = payload({ user_id: other, routine_id: otherRoutine });
  await save(own, 'B-generation', other); assert.ok(await row(own.id));
  // A globally conflicting primary key still cannot overwrite the hidden row.
  await assert.rejects(save({ ...own, id: value.id }, 'B-generation', other), /duplicate key/);
  await db.exec(`set app.test_user='${owner}';`); assert.deepEqual(await row(value.id), saved);
});

test('real routine-link RLS rejects another owner or missing routine without bypass through the RPC', async () => {
  const before = await rows();
  for (const routine_id of [otherRoutine, randomUUID()]) {
    await assert.rejects(save(payload({ routine_id })), /row-level security/);
  }
  assert.deepEqual(await rows(), before);
});

test('anon has neither execute permission nor session read access', async () => {
  await db.exec('set role anon;');
  await assert.rejects(save(payload()), /permission denied for function save_sentence_typing_session/);
  await assert.rejects(rows(), /permission denied/);
});

test('malformed payloads, omitted/extra fields and non-sentence writes fail without mutations', async () => {
  const value = payload(), before = await rows();
  const invalid: unknown[] = [null, [], 'bad', { ...value, extra: true },
    ...Object.keys(value).filter(key => key !== 'user_id').map(key => Object.fromEntries(Object.entries(value).filter(([field]) => field !== key))),
    ...[
      { source: 'manual' }, { source: 'handwriting' }, { status: 'stopped' }, { status: null },
      { id: 'bad-uuid' }, { routine_id: null }, { metrics: [] }, { metrics: null }, { metrics: { huge: 'x'.repeat(4000) } },
      { planned_minutes: '15' }, { planned_minutes: 1.5 }, { planned_minutes: -1 }, { planned_minutes: 241 },
      { actual_minutes: null }, { actual_minutes: 1441 }, { memo: null }, { memo: 'x'.repeat(501) },
      { session_date: '2026-02-30' }, { session_date: '2026-1-02' },
      { started_at: null }, { started_at: 'now' }, { ended_at: 'infinity' },
      { started_at: '2026-10-09T10:02:00Z' }, { ended_at: '2026-10-09T10:01:02' },
      { updated_at: '2026-10-09T10:02:00Z' },
    ].map(patch => ({ ...value, ...patch })),
  ];
  for (const candidate of invalid) await assert.rejects(save(candidate), JSON.stringify(candidate));
  await assert.rejects(save(value, 'x'.repeat(201)), /typing_invalid_payload/);
  assert.deepEqual(await rows(), before);
});

test('RPC is invoker with empty search path, authenticated-only EXECUTE and the same owner lock as reset', async () => {
  const functions = (await db.query<{ proname: string; prosecdef: boolean; provolatile: string; proconfig: string[]; definition: string }>(
    "select proname,prosecdef,provolatile,proconfig,pg_get_functiondef(oid) definition from pg_proc where proname in ('save_sentence_typing_session','reset_my_app_records') order by proname",
  )).rows;
  assert.equal(functions.length, 2);
  for (const fn of functions) {
    assert.equal(fn.prosecdef, false); assert.equal(fn.provolatile, 'v'); assert.ok(fn.proconfig.includes('search_path=""'));
    assert.match(fn.definition, /pg_advisory_xact_lock\(hashtextextended\('app-record-reset:' \|\| (?:auth\.uid\(\)|owner_id)::text, 0\)\)/);
  }
  const definition = functions.find(fn => fn.proname === 'save_sentence_typing_session')!.definition;
  assert.ok(definition.indexOf('pg_advisory_xact_lock') < definition.indexOf("select state->>'ai-fitness-record-reset-growth'"));
  assert.ok(definition.indexOf('typing_reset_changed') < definition.indexOf('insert into public.growth_sessions'));
  assert.doesNotMatch(definition, /on conflict|update public\.|delete from public\./i);
  const permissions = (await db.query<{ authenticated: boolean; anon: boolean }>(
    "select has_function_privilege('authenticated','public.save_sentence_typing_session(jsonb,uuid,text)','EXECUTE') authenticated, has_function_privilege('anon','public.save_sentence_typing_session(jsonb,uuid,text)','EXECUTE') anon",
  )).rows[0];
  assert.deepEqual(permissions, { authenticated: true, anon: false });
});

test('both functions hold the same real transaction-scoped advisory lock, released after rollback (single connection)', async () => {
  const locks = async () => (await db.query(
    "select classid::text,objid::text,objsubid,mode,granted from pg_locks where locktype='advisory' and pid=pg_backend_pid() order by classid,objid",
  )).rows;
  let saveLocks: Awaited<ReturnType<typeof locks>>;
  await db.exec('begin;');
  try { await save(payload()); saveLocks = await locks(); assert.equal(saveLocks.length, 1); }
  finally { await db.exec('rollback;'); }
  assert.deepEqual(await locks(), []);
  await db.exec('begin;');
  try { await reset(); assert.deepEqual(await locks(), saveLocks!); }
  finally { await db.exec('rollback;'); }
  assert.deepEqual(await locks(), []);
});

test('scope boundary: unchanged legacy direct INSERT can still write after reset without the new generation fence', async () => {
  await reset();
  await db.query("insert into public.growth_sessions(user_id,routine_id,status,source,memo) values($1,$2,'partial','typing','legacy residual')", [owner, routine]);
  assert.equal((await rows()).length, 1);
});
