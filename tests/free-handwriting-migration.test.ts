import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { emptyFreeDraft, freezeRaster, hashBytes, makeFreeSave } from '../lib/free-handwriting-draft.ts';

// Actual PostgreSQL/RLS, one PGlite connection, synthetic pixels only. Ordered
// reset/save and real lock identity are covered, not competing connections,
// hosted PostgREST/Storage, browser persistence, or physical-device recovery.
const db = new PGlite();
const owner = '00000000-0000-4000-8000-000000000711';
const other = '00000000-0000-4000-8000-000000000712';
const routine = '00000000-0000-4000-8000-000000000713';
const otherRoutine = '00000000-0000-4000-8000-000000000714';
const initialTime = '2026-10-01T00:00:00.000Z';
const frozenTime = '2026-10-09T10:00:00.000Z';
const markerKey = 'ai-fitness-record-reset-growth';
const originalState = { preferences: { font: 'large' }, 'ai-fitness-record-reset-diet': 'keep-diet-generation' };
const tables = ['user_app_state', 'growth_routines', 'growth_sessions', 'growth_ai_reviews', 'growth_resources'] as const;
const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20261009210000_save_free_handwriting_attempt.sql');
let installationBefore: unknown;
let installationAfter: unknown;

async function payload(account = owner, routineId = routine) {
  const resourceId = randomUUID();
  const guideText = '오늘도 한 글자씩 차분하게 써 봅니다.';
  return {
    session: {
      id: randomUUID(), user_id: account, routine_id: routineId,
      session_date: '2026-10-09', status: 'completed', source: 'handwriting',
      planned_minutes: 15, actual_minutes: 1, memo: guideText,
      metrics: {
        practiceKind: 'free-handwriting-v1', resourceId, guideText,
        strokes: 3, activeSeconds: 62, occupiedWidth: 43, occupiedHeight: 28,
        pressureRange: [0.2, 0.7] as number[] | null, pngSha256: 'a'.repeat(64),
      },
      started_at: null, ended_at: null, updated_at: frozenTime,
    },
    resource: {
      id: resourceId, user_id: account, routine_id: routineId,
      title: '손글씨 연습 2026-10-09', category: 'handwriting',
      storage_path: `${account}/2026-10-09/free-handwriting-${resourceId}.png`,
      mime_type: 'image/png', size_bytes: 27, classification: 'direct',
      notes: guideText, created_at: frozenTime, updated_at: frozenTime,
    },
  };
}
type Attempt = Awaited<ReturnType<typeof payload>>;
const save = (value: Attempt, generation: string | null = null, expectedOwner: string | null = owner) =>
  rawSave(value.session, value.resource, generation, expectedOwner);
const rawSave = (session: unknown, resource: unknown, generation: string | null = null, expectedOwner: string | null = owner) =>
  db.query('select public.save_free_handwriting_attempt($1,$2,$3,$4)', [session, resource, expectedOwner, generation]);
async function insertResource(resource: Attempt['resource']) {
  await db.query(`insert into public.growth_resources (${Object.keys(resource).join(',')}) values (${Object.keys(resource).map((_, i) => `$${i + 1}`).join(',')})`, Object.values(resource));
}
function assertPayload(expected: Record<string, unknown>, actual: Record<string, unknown> | undefined) {
  assert.ok(actual);
  for (const [key, value] of Object.entries(expected)) {
    if (key === 'updated_at' || key === 'created_at') assert.equal(new Date(actual[key] as string).toISOString(), value, key);
    else assert.deepEqual(actual[key], value, key);
  }
}
const reset = async (requestId = randomUUID()) => (await db.query<{ result: { marker: string } }>(
  "select public.reset_my_app_records('growth', $1, '초기화') result", [requestId],
)).rows[0].result;
const rows = async (table = 'growth_sessions') => (await db.query<{ value: Record<string, unknown> }>(
  `select to_jsonb(t) value from public.${table} t order by to_jsonb(t)::text`,
)).rows.map(row => row.value);
const row = async (id: string, table = 'growth_sessions') => (await db.query<{ value: Record<string, unknown> }>(
  `select to_jsonb(t) value from public.${table} t where id=$1`, [id],
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
    columns: (await db.query("select table_name,column_name,data_type,column_default,is_nullable from information_schema.columns where table_schema='public' order by table_name,ordinal_position")).rows,
    columnGrants: (await db.query("select * from information_schema.column_privileges where table_schema='public' order by table_name,column_name,grantee,privilege_type")).rows,
    course: (await db.query("select pg_get_functiondef('public.save_handwriting_attempt(jsonb,jsonb,uuid,text)'::regprocedure) definition")).rows,
    reset: (await db.query("select pg_get_functiondef('public.reset_my_app_records(text,uuid,text)'::regprocedure) definition")).rows,
  };
}
async function seed() {
  await db.exec(`reset role; truncate auth.users cascade;
    insert into auth.users values('${owner}'),('${other}');
    insert into public.growth_routines(id,user_id,category,title)
      values('${routine}','${owner}','handwriting','A handwriting'),('${otherRoutine}','${other}','handwriting','B handwriting');
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
  await db.exec(read('../supabase/migrations/20260917084426_growth_resource_usage.sql'));
  await db.exec(read('./e2e/schema.sql').split('create table public.language_user_state')[0]);
  const initialReset = read('../supabase/migrations/20260906141943_add_app_record_resets.sql');
  const deletePolicy = initialReset.slice(initialReset.indexOf('create policy "Users can delete own growth AI reviews"'), initialReset.indexOf('create or replace function'));
  await db.exec(`grant delete on public.growth_ai_reviews to authenticated; ${deletePolicy}`);
  // Execute the latest existing reset function verbatim. Its growth branch needs
  // only user_app_state, growth_sessions, and growth_ai_reviews; no rewritten mock.
  const latestReset = read('../supabase/migrations/20260915034857_assistant_task_command_history.sql');
  await db.exec(latestReset.slice(latestReset.indexOf('create or replace function public.reset_my_app_records')));
  await db.exec(read('../supabase/migrations/20261009193716_save_handwriting_attempt.sql'));
  await seed();
  await db.exec('reset role;');
  installationBefore = await installationSnapshot();
  await db.exec(migration);
  installationAfter = await installationSnapshot();
});
beforeEach(seed);
after(async () => { await db.close(); });

test('additive installation preserves all records, table columns/grants, RLS, reset and course RPC definitions', () => {
  assert.deepEqual(installationAfter, installationBefore);
});

test('free-handwriting round-trips every frozen field and leaves unrelated data unchanged', async () => {
  await db.exec('reset role;'); const before = await snapshot(); await db.exec('set role authenticated;');
  const value = await payload(); await save(value);
  assertPayload(value.session, await row(value.session.id));
  assertPayload(value.resource, await row(value.resource.id, 'growth_resources'));
  await db.exec('reset role;'); const after = await snapshot();
  after.growth_sessions = (after.growth_sessions as Record<string, unknown>[]).filter(item => item.id !== value.session.id);
  after.growth_resources = (after.growth_resources as Record<string, unknown>[]).filter(item => item.id !== value.resource.id);
  assert.deepEqual(after, before);
});

test('actual client makeFreeSave payload round-trips through the isolated RPC and replays exactly', async () => {
  const draft = emptyFreeDraft(owner, null);
  draft.frames = [{
    raster: await freezeRaster(1, 1, new Uint8ClampedArray([12, 34, 56, 255])),
    evidence: { strokes: 3, activeMs: 62500, minX: 0.1, maxX: 0.53, minY: 0.2, maxY: 0.48, penMin: 0.2, penMax: 0.7 },
  }];
  draft.historyIndex = 0;
  const png = new TextEncoder().encode('synthetic-png-no-private-data');
  const value = makeFreeSave(draft, routine, 15, '2026-10-09', frozenTime, randomUUID(), randomUUID(), png, await hashBytes(png));
  await rawSave(value.session, value.resource);
  assertPayload(value.session, await row(value.session.id));
  assertPayload(value.resource, await row(value.resource.id, 'growth_resources'));
  const before = await snapshot();
  await rawSave(value.session, value.resource);
  assert.deepEqual(await snapshot(), before);
});

test('exact lost-response replay is a read-only no-op preserving IDs, timestamps and non-requested columns', async () => {
  const value = await payload(); await save(value);
  await db.query('update public.growth_resources set last_used_on=$1 where id=$2', ['2026-10-01', value.resource.id]);
  await db.exec('reset role;');
  await db.query('update public.growth_sessions set created_at=$1 where id=$2', [initialTime, value.session.id]);
  await db.exec('set role authenticated;');
  const before = await snapshot();
  await save(value); await save(value);
  assert.deepEqual(await snapshot(), before);
});

test('timestamp spelling may normalize on replay but resource timestamps must exactly match the submitted session', async () => {
  const value = await payload(); await save(value); const before = await snapshot();
  const equivalent = '2026-10-09T19:00:00+09:00';
  await rawSave({ ...value.session, updated_at: equivalent }, { ...value.resource, created_at: equivalent, updated_at: equivalent });
  assert.deepEqual(await snapshot(), before);
  await assert.rejects(rawSave(value.session, { ...value.resource, created_at: equivalent, updated_at: equivalent }), /free_handwriting_invalid_payload/);
});

test('an exact resource-only attempt finishes without changing its resource or non-requested usage date', async () => {
  const value = await payload(); await insertResource(value.resource);
  await db.query('update public.growth_resources set last_used_on=$1 where id=$2', ['2026-10-01', value.resource.id]);
  const before = await row(value.resource.id, 'growth_resources');
  await save(value);
  assertPayload(value.session, await row(value.session.id));
  assert.deepEqual(await row(value.resource.id, 'growth_resources'), before);
});

test('resource-only metadata conflicts never insert a session or overwrite prior data', async () => {
  const value = await payload(); await insertResource({ ...value.resource, notes: 'Keep existing notes.' });
  const before = await snapshot();
  await assert.rejects(save(value), /free_handwriting_resource_conflict/);
  assert.deepEqual(await snapshot(), before);
});

test('a storage path claimed by another ID fails closed', async () => {
  const value = await payload(); await insertResource({ ...value.resource, id: randomUUID() });
  const before = await snapshot();
  await assert.rejects(save(value), /free_handwriting_resource_conflict/);
  assert.deepEqual(await snapshot(), before);
});

test('reusing a resource under a new session UUID cannot clone a completion', async () => {
  const value = await payload(); await save(value); const before = await snapshot();
  await assert.rejects(rawSave({ ...value.session, id: randomUUID() }, value.resource), /free_handwriting_resource_conflict/);
  assert.deepEqual(await snapshot(), before);
});

test('resources linked to legacy or course handwriting sessions also cannot be reused', async () => {
  const value = await payload(); await insertResource(value.resource);
  await db.query("insert into public.growth_sessions(user_id,routine_id,status,source,metrics) values($1,$2,'completed','handwriting',$3)",
    [owner, routine, { resourceId: value.resource.id, courseId: 'film-handwriting-v1' }]);
  const before = await snapshot();
  await assert.rejects(save(value), /free_handwriting_resource_conflict/);
  assert.deepEqual(await snapshot(), before);
});

test('missing resource on an existing session rejects without recreating metadata', async () => {
  const value = await payload(); await save(value);
  await db.query('delete from public.growth_resources where id=$1', [value.resource.id]);
  const before = await snapshot();
  await assert.rejects(save(value), /free_handwriting_resource_missing/);
  assert.deepEqual(await snapshot(), before);
});

test('valid same-ID changes conflict without overwriting any immutable session field', async () => {
  const value = await payload(); await save(value); const before = await snapshot();
  const variants = [
    { ...value, session: { ...value.session, planned_minutes: 16 } },
    { ...value, session: { ...value.session, metrics: { ...value.session.metrics, pngSha256: 'b'.repeat(64) } } },
    { ...value, session: { ...value.session, metrics: { ...value.session.metrics, occupiedWidth: 44 } } },
    { ...value, session: { ...value.session, metrics: { ...value.session.metrics, pressureRange: null } } },
    { ...value, session: { ...value.session, actual_minutes: 2, metrics: { ...value.session.metrics, activeSeconds: 120 } } },
    { session: { ...value.session, memo: 'Changed', metrics: { ...value.session.metrics, guideText: 'Changed' } }, resource: { ...value.resource, notes: 'Changed' } },
    { session: { ...value.session, session_date: '2026-10-08' }, resource: { ...value.resource, title: '손글씨 연습 2026-10-08', storage_path: `${owner}/2026-10-08/free-handwriting-${value.resource.id}.png` } },
  ];
  for (const variant of variants) {
    await assert.rejects(save(variant), /free_handwriting_session_conflict/);
    assert.deepEqual(await snapshot(), before);
  }
});

test('newer saved session or resource timestamps block stale retry and preserve newer records', async () => {
  const newer = '2026-10-09T10:00:01.000Z';
  const session = await payload(); await save(session);
  await db.query('update public.growth_sessions set updated_at=$1 where id=$2', [newer, session.session.id]);
  let before = await snapshot();
  await assert.rejects(save(session), /free_handwriting_session_conflict/);
  assert.deepEqual(await snapshot(), before);
  const resource = await payload(); await save(resource);
  await db.query('update public.growth_resources set updated_at=$1 where id=$2', [newer, resource.resource.id]);
  before = await snapshot();
  await assert.rejects(save(resource), /free_handwriting_resource_conflict/);
  assert.deepEqual(await snapshot(), before);
});

test('resource replay compares all frozen fields while refusing valid changed byte size', async () => {
  const value = await payload(); await save(value); const before = await snapshot();
  await assert.rejects(rawSave(value.session, { ...value.resource, size_bytes: 28 }), /free_handwriting_resource_conflict/);
  assert.deepEqual(await snapshot(), before);
});

test('initial null generation permits absent marker or absent state without creating app state', async () => {
  await save(await payload());
  await db.query('delete from public.user_app_state where user_id=$1', [owner]);
  await save(await payload());
  assert.equal((await rows('user_app_state')).length, 0);
  await assert.rejects(save(await payload(), 'invented-generation'), /free_handwriting_reset_changed/);
});

test('save then real reset removes sessions and reviews, preserving resources, routines and unrelated owner data', async () => {
  const value = await payload(); await save(value);
  await db.exec('reset role;'); const before = await snapshot(); await db.exec('set role authenticated;');
  const receipt = await reset();
  assert.equal(await row(value.session.id), undefined);
  assert.equal((await rows()).length, 0);
  assertPayload(value.resource, await row(value.resource.id, 'growth_resources'));
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

test('reset then stale save rejects before inserting either row', async () => {
  const value = await payload(), checked = await marker();
  const receipt = await reset(), before = await snapshot();
  await assert.rejects(save(value, checked), /free_handwriting_reset_changed/);
  assert.deepEqual(await snapshot(), before); assert.equal(await marker(), receipt.marker);
});

test('reset after a resource-only save preserves it while blocking stale session completion', async () => {
  const value = await payload(); await insertResource(value.resource);
  await reset(); const before = await snapshot();
  await assert.rejects(save(value), /free_handwriting_reset_changed/);
  assert.deepEqual(await snapshot(), before);
  assert.equal(await row(value.session.id), undefined);
});

test('authoritative marker is checked before exact replay, even while both rows still exist', async () => {
  const value = await payload(); await save(value);
  await db.query('update public.user_app_state set state=state || $1::jsonb where user_id=$2', [{ [markerKey]: 'changed-generation' }, owner]);
  const before = await snapshot();
  await assert.rejects(save(value), /free_handwriting_reset_changed/);
  assert.deepEqual(await snapshot(), before);
});

test('fresh marker saves, later reset rejects stale replay, and reset receipt replay preserves a fresh save', async () => {
  const request = randomUUID(), first = await reset(request), value = await payload();
  await save(value, first.marker); const before = await snapshot();
  assert.deepEqual(await reset(request), first); assert.deepEqual(await snapshot(), before);
  const second = await reset();
  await assert.rejects(save(value, first.marker), /free_handwriting_reset_changed/);
  assert.equal(await row(value.session.id), undefined);
  assertPayload(value.resource, await row(value.resource.id, 'growth_resources'));
  await save(value, second.marker); assertPayload(value.session, await row(value.session.id));
});

test('owned handwriting routine is required; missing, other-owner, wrong category and null routines reject', async () => {
  const value = await payload(), wrongCategory = randomUUID();
  await db.query("insert into public.growth_routines(id,user_id,category,title) values($1,$2,'typing','Typing')", [wrongCategory, owner]);
  const before = await snapshot();
  for (const routine_id of [otherRoutine, randomUUID(), wrongCategory]) {
    await assert.rejects(rawSave({ ...value.session, routine_id }, { ...value.resource, routine_id }), /free_handwriting_routine_invalid/);
  }
  await assert.rejects(rawSave({ ...value.session, routine_id: null }, value.resource), /free_handwriting_invalid_payload/);
  assert.deepEqual(await snapshot(), before);
});

test('expected-owner, session-owner, resource-owner spoofing and missing auth reject without mutation', async () => {
  const value = await payload(), before = await snapshot();
  for (const expected of [other, null]) await assert.rejects(save(value, null, expected), /free_handwriting_owner_changed/);
  for (const user_id of [other, null, 1]) {
    await assert.rejects(rawSave({ ...value.session, user_id }, value.resource), /free_handwriting_owner_changed/);
    await assert.rejects(rawSave(value.session, { ...value.resource, user_id }), /free_handwriting_owner_changed/);
  }
  await db.exec("set app.test_user='';"); await assert.rejects(save(value), /free_handwriting_owner_changed/);
  await db.exec(`set app.test_user='${owner}';`); assert.deepEqual(await snapshot(), before);
});

test('RLS hides A records from B; hidden session ID collision atomically rolls back the new resource', async () => {
  const a = await payload(); await save(a);
  await db.exec(`set app.test_user='${other}';`);
  assert.equal(await row(a.session.id), undefined); assert.equal(await row(a.resource.id, 'growth_resources'), undefined);
  await assert.rejects(save(a), /free_handwriting_owner_changed/);
  const b = await payload(other, otherRoutine); b.session.id = a.session.id;
  const before = await snapshot();
  await assert.rejects(save(b, 'B-generation', other), /duplicate key/);
  assert.equal(await row(b.resource.id, 'growth_resources'), undefined);
  assert.deepEqual(await snapshot(), before);
  b.session.id = randomUUID(); await save(b, 'B-generation', other);
  assertPayload(b.session, await row(b.session.id));
  await db.exec(`set app.test_user='${owner}';`);
  assertPayload(a.session, await row(a.session.id)); assertPayload(a.resource, await row(a.resource.id, 'growth_resources'));
});

test('hidden global resource ID collision rejects without inserting a session', async () => {
  const a = await payload(); await save(a);
  await db.exec(`set app.test_user='${other}';`);
  const b = await payload(other, otherRoutine);
  b.resource.id = a.resource.id; b.session.metrics.resourceId = a.resource.id;
  b.resource.storage_path = `${other}/${b.session.session_date}/free-handwriting-${a.resource.id}.png`;
  const before = await snapshot();
  await assert.rejects(save(b, 'B-generation', other), /duplicate key/);
  assert.deepEqual(await snapshot(), before);
});

test('anon has neither RPC execution nor table access', async () => {
  await db.exec('set role anon;');
  await assert.rejects(save(await payload()), /permission denied for function save_free_handwriting_attempt/);
  await assert.rejects(rows(), /permission denied/);
});

test('malformed, incomplete or extended session/resource payloads reject without mutation', async () => {
  const value = await payload(), before = await snapshot();
  const invalidSessions: unknown[] = [null, [], 'bad', { ...value.session, extra: true },
    ...Object.keys(value.session).map(key => Object.fromEntries(Object.entries(value.session).filter(([field]) => field !== key))),
    ...[
      { id: 'bad' }, { status: 'partial' }, { source: 'typing' }, { routine_id: 7 },
      { planned_minutes: '15' }, { planned_minutes: 1.5 }, { planned_minutes: -1 }, { planned_minutes: 241 },
      { actual_minutes: null }, { actual_minutes: 1.5 }, { actual_minutes: -1 }, { actual_minutes: 1441 }, { actual_minutes: 60 },
      { memo: null }, { memo: 'Changed' }, { started_at: frozenTime }, { ended_at: frozenTime }, { metrics: [] },
    ].map(patch => ({ ...value.session, ...patch })),
  ];
  for (const candidate of invalidSessions) await assert.rejects(rawSave(candidate, value.resource));
  const invalidResources: unknown[] = [null, [], 'bad', { ...value.resource, extra: true },
    ...Object.keys(value.resource).map(key => Object.fromEntries(Object.entries(value.resource).filter(([field]) => field !== key))),
    ...[
      { id: randomUUID() }, { routine_id: otherRoutine }, { title: '' }, { title: 'Changed title' },
      { category: 'reference' }, { storage_path: `${owner}/elsewhere.png` }, { mime_type: 'image/webp' },
      { size_bytes: '1' }, { size_bytes: 1.5 }, { size_bytes: 0 }, { size_bytes: 10485761 },
      { classification: 'reference' }, { notes: null }, { notes: 'Changed notes' },
      { created_at: 'now', updated_at: 'now' }, { updated_at: '2026-10-09T10:00:01.000Z' },
      { created_at: '2026-10-09T10:00:01.000Z' }, { last_used_on: '2026-10-01' },
    ].map(patch => ({ ...value.resource, ...patch })),
  ];
  for (const candidate of invalidResources) await assert.rejects(rawSave(value.session, candidate));
  await assert.rejects(save(value, 'x'.repeat(201)), /free_handwriting_invalid_payload/);
  assert.deepEqual(await snapshot(), before);
});

test('strict real calendar dates and finite ISO timestamps reject impossible and normalized rollover inputs', async () => {
  const value = await payload(), before = await snapshot();
  for (const session_date of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-01', '2026-10-00', '0000-01-01', '2026-2-01', 'today']) {
    await assert.rejects(rawSave({ ...value.session, session_date }, {
      ...value.resource, title: `손글씨 연습 ${session_date}`, storage_path: `${owner}/${session_date}/free-handwriting-${value.resource.id}.png`,
    }), /free_handwriting_invalid_payload/, session_date);
  }
  for (const updated_at of ['now', 'infinity', '2026-10-09T10:00:00', '2026-02-30T10:00:00Z', '2026-10-09T24:00:00Z',
    '2026-10-09T10:60:00Z', '2026-10-09T10:00:60Z', '2026-10-09T10:00:00+25:00', '2026-10-09T10:00:00+09:60']) {
    await assert.rejects(rawSave({ ...value.session, updated_at }, { ...value.resource, updated_at, created_at: updated_at }), /free_handwriting_invalid_payload/, updated_at);
  }
  assert.deepEqual(await snapshot(), before);
});

test('exact free metrics reject missing keys, unknown data, course/lesson evidence and metric tampering', async () => {
  const value = await payload(), metrics = value.session.metrics, before = await snapshot();
  const patches = [
    { extra: 1 }, { practiceKind: 'other' }, { resourceId: randomUUID() }, { guideText: '' }, { guideText: null },
    { guideText: 'Changed' }, { guideText: 'x'.repeat(301) }, { pngSha256: 'A'.repeat(64) }, { pngSha256: 1 }, { pngSha256: 'a'.repeat(63) },
    { strokes: 0 }, { strokes: 1_000_001 }, { strokes: 1.1 }, { strokes: '3' },
    { activeSeconds: -1 }, { activeSeconds: 86401 }, { activeSeconds: 1.1 }, { activeSeconds: '62' },
    { occupiedWidth: -1 }, { occupiedWidth: 101 }, { occupiedWidth: 2.5 }, { occupiedWidth: '43' },
    { occupiedHeight: -1 }, { occupiedHeight: 101 }, { occupiedHeight: 2.5 }, { occupiedHeight: null },
    { courseId: 'film-handwriting-v1' }, { lessonId: 'film-p2' }, { lessonCompleted: true }, { pdfPage: 2 },
    { lessonSnapshot: {} }, { worksheet: {} }, { mode: 'screen' }, { practiceMode: 'copy' }, { selfChecks: [true, true] },
    { pressureRange: [] }, { pressureRange: [0.2] }, { pressureRange: [0.2, 0.7, 1] },
    { pressureRange: [0, 0.7] }, { pressureRange: [-0.1, 0.7] }, { pressureRange: [0.7, 0.2] },
    { pressureRange: [0.2, 0.2] }, { pressureRange: [0.2, 1.1] }, { pressureRange: ['0.2', 0.7] },
    { pressureRange: [0.2, null] }, { pressureRange: {} }, { pressureRange: 0.5 },
  ];
  for (const patch of patches) await assert.rejects(rawSave({ ...value.session, metrics: { ...metrics, ...patch } }, value.resource), /free_handwriting_invalid_payload/, JSON.stringify(patch));
  for (const key of Object.keys(metrics)) await assert.rejects(rawSave({
    ...value.session, metrics: Object.fromEntries(Object.entries(metrics).filter(([field]) => field !== key)),
  }, value.resource), /free_handwriting_invalid_payload/, key);
  assert.deepEqual(await snapshot(), before);
});

test('bounded measurements accept edge values, null pressure, exact guide text and truthful rounded minutes', async () => {
  for (const [seconds, minutes] of [[0, 0], [29, 0], [30, 1], [89, 1], [90, 2], [86400, 1440]]) {
    const value = await payload();
    value.session.actual_minutes = minutes; value.session.metrics.activeSeconds = seconds;
    value.session.planned_minutes = seconds === 0 ? 0 : 240;
    value.session.metrics.strokes = seconds === 0 ? 1 : 1000000;
    value.session.metrics.occupiedWidth = 0; value.session.metrics.occupiedHeight = 100;
    value.session.metrics.pressureRange = seconds === 0 ? null : [0.001, 1];
    const guideText = seconds === 0 ? '가' : '한'.repeat(300);
    value.session.memo = guideText; value.session.metrics.guideText = guideText; value.resource.notes = guideText;
    value.resource.size_bytes = seconds === 0 ? 1 : 10485760;
    await save(value); assertPayload(value.session, await row(value.session.id));
    assertPayload(value.resource, await row(value.resource.id, 'growth_resources'));
  }
});

test('course RPC rejects free payload; free RPC rejects a course-shaped attempt', async () => {
  const value = await payload(), before = await snapshot();
  await assert.rejects(db.query('select public.save_handwriting_attempt($1,$2,$3,$4)', [value.session, value.resource, owner, null]), /handwriting_invalid_payload/);
  await assert.rejects(rawSave({ ...value.session, metrics: {
    courseId: 'film-handwriting-v1', lessonId: 'film-p2', pdfPage: 2, lessonCompleted: true,
    mode: 'screen', practiceMode: 'copy', selfChecks: [true, true], lessonSnapshot: {}, worksheet: {},
    resourceId: value.resource.id, strokes: 3, activeSeconds: 62, pngSha256: 'a'.repeat(64),
  } }, value.resource), /free_handwriting_invalid_payload/);
  assert.deepEqual(await snapshot(), before);
});

test('explicit transaction rollback restores both rows and releases the real reset lock', async () => {
  const value = await payload(), before = await snapshot();
  await db.exec('begin;');
  try { await save(value); assert.ok(await row(value.session.id)); assert.ok(await row(value.resource.id, 'growth_resources')); }
  finally { await db.exec('rollback;'); }
  assert.deepEqual(await snapshot(), before);
});

test('RPC is invoker with empty search_path, authenticated-only execution and reset lock before marker/replay/inserts', async () => {
  const functions = (await db.query<{ proname: string; prosecdef: boolean; provolatile: string; proconfig: string[]; definition: string }>(
    "select proname,prosecdef,provolatile,proconfig,pg_get_functiondef(oid) definition from pg_proc where proname in ('save_free_handwriting_attempt','reset_my_app_records') order by proname",
  )).rows;
  assert.equal(functions.length, 2);
  for (const fn of functions) {
    assert.equal(fn.prosecdef, false); assert.equal(fn.provolatile, 'v'); assert.ok(fn.proconfig.includes('search_path=""'));
    assert.match(fn.definition, /pg_advisory_xact_lock\(hashtextextended\('app-record-reset:' \|\| owner_id::text, 0\)\)/);
  }
  const definition = functions.find(fn => fn.proname === 'save_free_handwriting_attempt')!.definition;
  assert.ok(definition.indexOf('pg_advisory_xact_lock') < definition.indexOf("select state->>'ai-fitness-record-reset-growth'"));
  assert.ok(definition.indexOf('free_handwriting_reset_changed') < definition.indexOf('if session_exists then return;'));
  assert.ok(definition.indexOf('free_handwriting_reset_changed') < definition.indexOf('insert into public.growth_resources'));
  assert.doesNotMatch(definition, /on conflict|update public\.|delete from|storage\./i);
  assert.deepEqual((await db.query(
    "select has_function_privilege('authenticated','public.save_free_handwriting_attempt(jsonb,jsonb,uuid,text)','EXECUTE') authenticated, has_function_privilege('anon','public.save_free_handwriting_attempt(jsonb,jsonb,uuid,text)','EXECUTE') anon",
  )).rows[0], { authenticated: true, anon: false });
});

test('free save, course save and real reset use the same transaction advisory lock identity', async () => {
  const locks = async () => (await db.query(
    "select classid::text,objid::text,objsubid,mode,granted from pg_locks where locktype='advisory' and pid=pg_backend_pid() order by classid,objid",
  )).rows;
  let saveLocks: Awaited<ReturnType<typeof locks>>;
  await db.exec('begin;');
  try { await save(await payload()); saveLocks = await locks(); assert.equal(saveLocks.length, 1); }
  finally { await db.exec('rollback;'); }
  assert.deepEqual(await locks(), []);
  await db.exec('begin;');
  try { await reset(); assert.deepEqual(await locks(), saveLocks!); }
  finally { await db.exec('rollback;'); }
  assert.deepEqual(await locks(), []);
  const course = (await db.query<{ definition: string }>("select pg_get_functiondef('public.save_handwriting_attempt(jsonb,jsonb,uuid,text)'::regprocedure) definition")).rows[0].definition;
  assert.match(course, /pg_advisory_xact_lock\(hashtextextended\('app-record-reset:' \|\| owner_id::text, 0\)\)/);
});

test('scope boundary: legacy direct INSERT remains unchanged and outside the new reset fence', async () => {
  await reset();
  await db.query("insert into public.growth_sessions(user_id,routine_id,status,source,memo) values($1,$2,'partial','handwriting','legacy residual')", [owner, routine]);
  assert.equal((await rows()).length, 1);
});
