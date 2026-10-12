import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Actual PostgreSQL SQL/RLS execution, synthetic data, one PGlite connection.
// Ordered competing saves/reset races and SQL contracts are covered here, NOT
// live connection contention, hosted PostgREST, or authenticated browser QA.
const db = new PGlite();
const owner = '00000000-0000-4000-8000-000000000721';
const other = '00000000-0000-4000-8000-000000000722';
const initialTime = '2026-10-01T00:00:00.000001Z';
const markerKey = 'ai-fitness-record-reset-diet';
const originalState = {
  'ai-fitness-diet-meal-log': { '2026-10-01': [{ id: 'synthetic-meal', amount: 12 }] },
  'ai-fitness-preferences': { textSize: 'large', enabled: true },
};
const otherState = { 'ai-fitness-preferences': { textSize: 'small' } };
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261009212500_save_cloud_state_if_unchanged.sql');
const signature = 'public.save_cloud_state_if_unchanged(uuid,jsonb,timestamptz,jsonb)';
let installationBefore: unknown;
let installationAfter: unknown;
type Row = { user_id: string; state: Record<string, unknown>; updated_at: string };
const json = (value: unknown) => value === undefined ? null : JSON.stringify(value);
async function save(state: unknown, expectedTime: string | null = null, expectedState: unknown = undefined, expectedOwner: string | null = owner) {
  return (await db.query<{ saved: boolean }>(
    'select public.save_cloud_state_if_unchanged($1,$2::jsonb,$3::timestamptz,$4::jsonb) saved',
    [expectedOwner, json(state), expectedTime, json(expectedState)],
  )).rows[0].saved;
}
async function row(account = owner) {
  return (await db.query<Row>('select user_id, state, updated_at::text updated_at from public.user_app_state where user_id=$1', [account])).rows[0];
}
async function records() {
  return (await db.query<Row>('select user_id, state, updated_at::text updated_at from public.user_app_state order by user_id')).rows;
}
async function reset() {
  return (await db.query<{ receipt: { marker: string } }>(
    "select public.reset_my_app_records('diet',$1,'초기화') receipt", [randomUUID()],
  )).rows[0].receipt;
}
async function installationSnapshot() {
  return {
    rows: await records(),
    policies: (await db.query("select * from pg_policies where schemaname='public' order by tablename,policyname")).rows,
    tables: (await db.query("select relname,relrowsecurity,relforcerowsecurity,relacl from pg_class where relnamespace='public'::regnamespace and relkind='r' order by relname")).rows,
    columns: (await db.query("select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public' order by table_name,ordinal_position")).rows,
    grants: (await db.query("select * from information_schema.table_privileges where table_schema='public' order by table_name,grantee,privilege_type")).rows,
    columnGrants: (await db.query("select * from information_schema.column_privileges where table_schema='public' order by table_name,column_name,grantee,privilege_type")).rows,
    reset: (await db.query("select pg_get_functiondef('public.reset_my_app_records(text,uuid,text)'::regprocedure) definition")).rows,
  };
}
async function seed() {
  await db.exec(`reset role; truncate auth.users cascade;
    insert into auth.users values('${owner}'),('${other}');`);
  await db.query('insert into public.user_app_state(user_id,state,updated_at) values($1,$2,$3),($4,$5,$3)',
    [owner, originalState, initialTime, other, otherState]);
  await db.exec(`set app.test_user='${owner}'; set role authenticated;`);
}
before(async () => {
  await db.exec(`create role authenticated; create role anon; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;`);
  // Reuse the checked-in app-state table/grants/RLS fixture, unchanged.
  await db.exec(read('./e2e/schema.sql').split('create table public.language_user_state')[0]);
  // Execute the latest real reset function verbatim. The diet branch operates
  // solely on user_app_state, so unrelated private tables are not fabricated.
  const resetMigration = read('../supabase/migrations/20260915034857_assistant_task_command_history.sql');
  await db.exec(resetMigration.slice(resetMigration.indexOf('create or replace function public.reset_my_app_records')));
  await seed();
  await db.exec('reset role;');
  installationBefore = await installationSnapshot();
  await db.exec(migration);
  installationAfter = await installationSnapshot();
});
beforeEach(seed);
after(async () => { await db.close(); });

test('cloud CAS additive installation leaves existing records, schema, RLS, grants and reset unchanged', () => {
  assert.deepEqual(installationAfter, installationBefore);
});
test('RPC is invoker-scoped, has an empty search path, and is executable only by authenticated users', async () => {
  const result = (await db.query<{ prosecdef: boolean; proconfig: string[]; defaults: number; authenticated: boolean; anon: boolean; public: boolean }>(`
    select prosecdef,proconfig,pronargdefaults defaults,
      has_function_privilege('authenticated',oid,'execute') authenticated,
      has_function_privilege('anon',oid,'execute') anon,
      exists(select 1 from aclexplode(proacl) where grantee=0 and privilege_type='EXECUTE') public
    from pg_proc where oid=$1::regprocedure`, [signature])).rows[0];
  assert.deepEqual(result, { prosecdef: false, proconfig: ['search_path=""'], defaults: 2, authenticated: true, anon: false, public: false });
  await db.exec('set role anon;');
  await assert.rejects(save({}), /permission denied/);
});
test('both default SQL NULLs insert an absent row once, never overwrite a competing first save', async () => {
  await db.query('delete from public.user_app_state where user_id=$1', [owner]);
  const first = { 'ai-fitness-preferences': { winner: 'first' } };
  assert.equal((await db.query<{ saved: boolean }>('select public.save_cloud_state_if_unchanged($1,$2) saved', [owner, first])).rows[0].saved, true);
  const winner = await row();
  assert.deepEqual(winner.state, first);
  assert.equal(await save({ 'ai-fitness-preferences': { winner: 'second' } }), false);
  assert.equal(await save(first), false);
  assert.deepEqual(await row(), winner);
});
test('absent-row token does not mean empty state, SQL null timestamp, or JSON null state', async () => {
  assert.equal(await save({}), false);
  assert.deepEqual((await row()).state, originalState);
  await db.query('update public.user_app_state set state=$2 where user_id=$1', [owner, {}]);
  const empty = await row();
  assert.equal(await save({ 'ai-fitness-preferences': 'new' }), false);
  assert.deepEqual(await row(), empty);
  // The real table forbids SQL NULL state/timestamp; JSON null is still a row.
  await db.query("update public.user_app_state set state='null'::jsonb where user_id=$1", [owner]);
  const nullState = await row();
  assert.equal(await save({}), false);
  await assert.rejects(save({}, nullState.updated_at, null), /cloud_sync_invalid_expected/);
  assert.deepEqual(await row(), nullState);
});
test('exact timestamp AND exact JSONB are required, and only one ordered competing writer wins', async () => {
  const evidence = await row();
  const next = { ...originalState, 'ai-fitness-water-intake': { today: 2 } };
  assert.equal(await save(next, evidence.updated_at, evidence.state), true);
  const winner = await row();
  assert.deepEqual(winner.state, next);
  assert.notEqual(winner.updated_at, evidence.updated_at);
  assert.equal(await save({ 'ai-fitness-water-intake': 9 }, evidence.updated_at, evidence.state), false);
  assert.deepEqual(await row(), winner);
});
test('JSONB-equivalent object ordering succeeds but array order and missing-vs-null content do not', async () => {
  const first = await row();
  const reordered = { 'ai-fitness-preferences': { enabled: true, textSize: 'large' }, 'ai-fitness-diet-meal-log': first.state['ai-fitness-diet-meal-log'] };
  const target = { 'ai-fitness-values': { list: [1, 2], explicit: null } };
  assert.equal(await save(target, first.updated_at, reordered), true);
  const evidence = await row();
  assert.equal(await save({}, evidence.updated_at, { 'ai-fitness-values': { list: [2, 1], explicit: null } }), false);
  assert.equal(await save({}, evidence.updated_at, { 'ai-fitness-values': { list: [1, 2] } }), false);
  assert.deepEqual(await row(), evidence);
});
test('same-timestamp content change from an older client is not overwritten by a stale review', async () => {
  const evidence = await row();
  const changed = { ...originalState, 'ai-fitness-water-intake': 3 };
  await db.query('update public.user_app_state set state=$2 where user_id=$1', [owner, changed]);
  const before = await row();
  assert.equal(before.updated_at, evidence.updated_at);
  assert.equal(await save({}, evidence.updated_at, evidence.state), false);
  assert.deepEqual(await row(), before);
});
test('unchanged content with a newer timestamp still invalidates old evidence', async () => {
  const evidence = await row();
  await db.query("update public.user_app_state set updated_at=updated_at+interval '1 microsecond' where user_id=$1", [owner]);
  const before = await row();
  assert.equal(await save({}, evidence.updated_at, evidence.state), false);
  assert.deepEqual(await row(), before);
});
test('a present-row CAS never inserts after that row was deleted', async () => {
  const evidence = await row();
  await db.query('delete from public.user_app_state where user_id=$1', [owner]);
  assert.equal(await save({}, evidence.updated_at, evidence.state), false);
  assert.equal(await row(), undefined);
});
test('same-content saves use a fresh server timestamp and reject replayed evidence', async () => {
  const evidence = await row();
  assert.equal(await save(evidence.state, evidence.updated_at, evidence.state), true);
  const after = await row();
  assert.notEqual(after.updated_at, evidence.updated_at);
  assert.equal(await save(evidence.state, evidence.updated_at, evidence.state), false);
  const serverDelta = (await db.query<{ recent: boolean }>('select abs(extract(epoch from clock_timestamp()-updated_at))<30 recent from public.user_app_state where user_id=$1', [owner])).rows[0];
  assert.equal(serverDelta.recent, true);
});
test('a legacy future timestamp advances by one microsecond instead of reusing an older revision', async () => {
  await db.query("update public.user_app_state set updated_at='2099-01-01T00:00:00.123456Z' where user_id=$1", [owner]);
  const evidence = await row();
  assert.equal(await save(evidence.state, evidence.updated_at, evidence.state), true);
  const after = await row();
  assert.equal((await db.query<{ advanced: boolean }>(
    "select $1::timestamptz=$2::timestamptz+interval '1 microsecond' advanced", [after.updated_at, evidence.updated_at],
  )).rows[0].advanced, true);
  assert.equal(await save(evidence.state, evidence.updated_at, evidence.state), false);
});
test('maximum-finite legacy timestamp overflow returns a fixed error and preserves the row', async () => {
  await db.query("update public.user_app_state set updated_at='294276-12-31T23:59:59.999999Z' where user_id=$1", [owner]);
  const evidence = await row();
  await assert.rejects(save({}, evidence.updated_at, evidence.state), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'cloud_sync_invalid_expected');
    return true;
  });
  assert.deepEqual(await row(), evidence);
});
test('the SQL clock-collision expression always advances an equal clock tick', async () => {
  // Execute the exact expression from the migration with deterministic evidence;
  // the real volatile clock is not mocked and no multi-connection claim is made.
  const expression = migration.match(/updated_at = (greatest\([^\n]+\))/)?.[1];
  assert.ok(expression);
  const result = (await db.query<{ advanced: boolean }>(`
    select ${expression}=server_timestamp+interval '1 microsecond' advanced
    from (select $1::timestamptz updated_at, $1::timestamptz server_timestamp) current_state`, [initialTime])).rows[0];
  assert.equal(result.advanced, true);
});
test('owner mismatch, SQL null owner and unauthenticated caller fail without changing either owner', async () => {
  const evidence = await row();
  await db.exec('reset role;'); const before = await records(); await db.exec('set role authenticated;');
  for (const expectedOwner of [other, null]) {
    await assert.rejects(save({}, evidence.updated_at, evidence.state, expectedOwner), /cloud_sync_owner_changed/);
    await assert.rejects(save({}, null, undefined, expectedOwner), /cloud_sync_owner_changed/);
  }
  assert.equal(await row(other), undefined);
  await db.exec("set app.test_user='';");
  await assert.rejects(save({}), /cloud_sync_owner_changed/);
  await db.exec('reset role;'); assert.deepEqual(await records(), before);
});
test('another authenticated owner can save only their own row', async () => {
  await db.exec(`set app.test_user='${other}';`);
  assert.equal(await row(), undefined);
  const evidence = await row(other);
  assert.equal(await save({}, evidence.updated_at, evidence.state, other), true);
  await db.exec('reset role;');
  assert.deepEqual((await row()).state, originalState);
  assert.deepEqual((await row(other)).state, {});
});
test('real reset before stale CAS preserves its marker and removed records', async () => {
  const evidence = await row();
  const receipt = await reset();
  const resetRow = await row();
  assert.equal(resetRow.state[markerKey], receipt.marker);
  assert.equal('ai-fitness-diet-meal-log' in resetRow.state, false);
  assert.equal(await save(evidence.state, evidence.updated_at, evidence.state), false);
  assert.deepEqual(await row(), resetRow);
  const next = { ...resetRow.state, 'ai-fitness-water-intake': { today: 1 } };
  assert.equal(await save(next, resetRow.updated_at, resetRow.state), true);
});
test('save before real reset is cleared and its earlier evidence cannot restore deleted records', async () => {
  const evidence = await row();
  assert.equal(await save({ ...evidence.state, 'ai-fitness-water-intake': 2 }, evidence.updated_at, evidence.state), true);
  const saved = await row();
  const receipt = await reset();
  const resetRow = await row();
  assert.equal(resetRow.state[markerKey], receipt.marker);
  assert.equal('ai-fitness-water-intake' in resetRow.state, false);
  assert.equal(await save(saved.state, saved.updated_at, saved.state), false);
  assert.deepEqual(await row(), resetRow);
});
test('absent-row read followed by real reset cannot insert over the reset-created row', async () => {
  await db.query('delete from public.user_app_state where user_id=$1', [owner]);
  const receipt = await reset();
  const resetRow = await row();
  assert.equal(resetRow.state[markerKey], receipt.marker);
  assert.equal(await save(originalState), false);
  assert.deepEqual(await row(), resetRow);
});
test('malformed expected evidence fails closed, including SQL NULL/JSON null and nonfinite timestamps', async () => {
  const evidence = await row();
  for (const [time, state] of [
    [null, {}], [evidence.updated_at, undefined], [null, null], [evidence.updated_at, null],
    [evidence.updated_at, []], [evidence.updated_at, 'object'], [evidence.updated_at, 1],
    ['infinity', {}], ['-infinity', {}],
  ] as const) await assert.rejects(save({}, time, state), /cloud_sync_invalid_expected/);
  assert.deepEqual(await row(), evidence);
});
test('legacy nonfinite row timestamps fail closed instead of preserving the same revision', async () => {
  for (const timestamp of ['infinity', '-infinity']) {
    await db.query('update public.user_app_state set updated_at=$2::timestamptz where user_id=$1', [owner, timestamp]);
    const evidence = await row();
    await assert.rejects(save({}, evidence.updated_at, evidence.state), /cloud_sync_invalid_expected/);
    assert.equal(await save({}), false);
    assert.deepEqual(await row(), evidence);
  }
});
test('state must be an object in the ai-fitness namespace with safe nested property names', async () => {
  const evidence = await row();
  const dangerous = ['__proto__', 'prototype', 'constructor'].map(key => JSON.parse(`{"ai-fitness-values":[{"nested":{"${key}":{"secret":"synthetic"}}}]}`));
  for (const state of [undefined, null, [], 'text', 42, true, { other: 1 }, { 'ai-fitness': 1 }, ...dangerous]) {
    await assert.rejects(save(state, evidence.updated_at, evidence.state), /cloud_sync_invalid_state/);
  }
  assert.deepEqual(await row(), evidence);
  assert.equal(await save({ 'ai-fitness-values': [null, true, 1, '__proto__', { ok: ['constructor'] }] }, evidence.updated_at, evidence.state), true);
});
test('state size is bounded to 5 MiB of JSONB text bytes, including multibyte strings', async () => {
  const evidence = await row();
  const ascii = { 'ai-fitness-value': 'x'.repeat(5 * 1024 * 1024) };
  const multibyte = { 'ai-fitness-value': '가'.repeat(2 * 1024 * 1024) };
  for (const state of [ascii, multibyte]) {
    await assert.rejects(save(state, evidence.updated_at, evidence.state), /cloud_sync_invalid_state/);
  }
  assert.deepEqual(await row(), evidence);
  // JSONB emits a space after the colon; compute the real server byte overhead.
  const overhead = (await db.query<{ size: number }>("select octet_length('{\"ai-fitness-value\":\"\"}'::jsonb::text) size")).rows[0].size;
  const boundary = { 'ai-fitness-value': 'x'.repeat(5 * 1024 * 1024 - overhead) };
  assert.equal(await save(boundary, evidence.updated_at, evidence.state), true);
});
test('error messages are fixed codes, with no private keys or values interpolated', async () => {
  const evidence = await row();
  await assert.rejects(save({ 'private-synthetic-key': 'private-synthetic-value' }, evidence.updated_at, evidence.state), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'cloud_sync_invalid_state');
    assert.doesNotMatch(error.message, /private-synthetic/);
    return true;
  });
  assert.doesNotMatch(migration, /\braise\s+(?:notice|log|warning|info|debug)\b|raise exception[^;]*%/i);
});
test('source contract uses one atomic exact predicate, guarded insert, server time and the existing reset lock', () => {
  assert.match(migration, /p_owner uuid,\s+p_state jsonb,\s+p_expected_updated_at timestamptz default null,\s+p_expected_state jsonb default null/i);
  assert.match(migration, /returns boolean language plpgsql security invoker set search_path = ''/i);
  assert.match(migration, /on conflict \(user_id\) do nothing/i);
  assert.doesNotMatch(migration, /\bon conflict[^;]*do update|\bsecurity definer\b|\bcreate(?: or replace)? table\b|\balter table\b|\b(?:create|alter|drop) policy\b|\b(?:grant|revoke)[^;]*on table\b/i);
  assert.match(migration, /where current_state\.user_id = owner_id\s+and current_state\.updated_at = p_expected_updated_at\s+and current_state\.state = p_expected_state/i);
  assert.match(migration, /server_timestamp := clock_timestamp\(\)/);
  assert.match(migration, /greatest\(server_timestamp, current_state\.updated_at \+ interval '1 microsecond'\)/i);
  assert.equal((migration.match(/clock_timestamp\(\)/g) ?? []).length, 1);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('app-record-reset:' \|\| owner_id::text, 0\)\)/);
  assert.ok(migration.indexOf('perform pg_advisory_xact_lock') < migration.indexOf('insert into public.user_app_state'));
  assert.match(migration, /Older timestamp-only\/direct[\s\S]*rollout\s*-- remains blocked/i);
});
