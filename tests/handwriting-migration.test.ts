import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { HANDWRITING_LESSONS } from '../app/data/handwritingCourse.ts';
import { HANDWRITING_PACKAGE_FORMAT, handwritingMaterialPath } from '../app/data/handwritingMaterials.ts';
import { emptyHandwritingDraft, freezeRaster, hashBytes, makeHandwritingSave, type FrozenHandwritingSave } from '../lib/handwriting-draft.ts';

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
const migration = read('../supabase/migrations/20261009193716_save_handwriting_attempt.sql');
let installationBefore: unknown;
let installationAfter: unknown;

async function payload(mode: 'paper' | 'screen' = 'screen', lesson = HANDWRITING_LESSONS[0], account = owner, routineId = routine) {
  const draft = emptyHandwritingDraft(account, null, lesson);
  draft.mode = mode; draft.checks = [true, true]; draft.minutes = '15'; draft.reflection = 'Keep the original wording.';
  draft.worksheet = { path: handwritingMaterialPath(account, `page-${String(lesson.pdfPage).padStart(2, '0')}.webp`), version: HANDWRITING_PACKAGE_FORMAT, sha256: 'a'.repeat(64) };
  draft.raster = await freezeRaster(1, 1, new Uint8ClampedArray([12, 34, 56, 255]));
  draft.strokes = 3; draft.activeMs = 62_000;
  const png = mode === 'screen' ? new Blob(['synthetic-png-no-private-data'], { type: 'image/png' }) : null;
  return makeHandwritingSave(draft, routineId, '2026-10-09', frozenTime, randomUUID(), mode === 'screen' ? randomUUID() : null, png, png ? await hashBytes(png) : null);
}
const save = (value: Pick<FrozenHandwritingSave, 'session' | 'resource'>, generation: string | null = null, expectedOwner: string | null = owner) =>
  rawSave(value.session, value.resource, generation, expectedOwner);
const rawSave = (session: unknown, resource: unknown, generation: string | null = null, expectedOwner: string | null = owner) =>
  db.query('select public.save_handwriting_attempt($1,$2,$3,$4)', [session, resource, expectedOwner, generation]);
async function insertResource(resource: NonNullable<FrozenHandwritingSave['resource']>) {
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
  await seed();
  await db.exec('reset role;');
  installationBefore = await installationSnapshot();
  await db.exec(migration);
  installationAfter = await installationSnapshot();
});
beforeEach(seed);
after(async () => { await db.close(); });

test('additive installation preserves all seeded records, table columns/grants, RLS and reset definition', () => {
  assert.deepEqual(installationAfter, installationBefore);
});

test('client paper/screen payloads round-trip every frozen field and leave unrelated data unchanged', async () => {
  await db.exec('reset role;'); const before = await snapshot(); await db.exec('set role authenticated;');
  const screen = await payload(), paper = await payload('paper');
  await save(screen); await save(paper);
  assertPayload(screen.session, await row(screen.session.id));
  assertPayload(screen.resource!, await row(screen.resource!.id, 'growth_resources'));
  assertPayload(paper.session, await row(paper.session.id));
  await db.exec('reset role;'); const after = await snapshot();
  after.growth_sessions = (after.growth_sessions as Record<string, unknown>[]).filter(item => ![screen.session.id, paper.session.id].includes(item.id as string));
  after.growth_resources = (after.growth_resources as Record<string, unknown>[]).filter(item => item.id !== screen.resource!.id);
  assert.deepEqual(after, before);
});

test('all 53 full lesson snapshots fit the existing metrics constraint and save at the correct page', async () => {
  for (const lesson of HANDWRITING_LESSONS) {
    const value = await payload('screen', lesson);
    await save(value);
    assertPayload(value.session, await row(value.session.id));
  }
  assert.equal((await rows()).length, 54);
});

test('exact replay is a no-op, including after a lost response, with no new IDs or timestamps', async () => {
  for (const mode of ['paper', 'screen'] as const) {
    const value = await payload(mode); await save(value); const before = await snapshot();
    await save(value); await save(value);
    assert.deepEqual(await snapshot(), before);
  }
});

test('an exact existing resource-only attempt finishes its session atomically without updating the resource', async () => {
  const value = await payload(); await insertResource(value.resource!);
  const before = await row(value.resource!.id, 'growth_resources');
  await save(value);
  assertPayload(value.session, await row(value.session.id));
  assert.deepEqual(await row(value.resource!.id, 'growth_resources'), before);
});

test('existing resource-only conflicts never insert a session or modify the resource', async () => {
  const value = await payload(); await insertResource({ ...value.resource!, notes: 'Another frozen attempt' });
  const before = await snapshot();
  await assert.rejects(save(value), /handwriting_resource_conflict/);
  assert.deepEqual(await snapshot(), before);
});

test('a resource path already claimed by a different ID fails closed', async () => {
  const value = await payload();
  await insertResource({ ...value.resource!, id: randomUUID() });
  const before = await snapshot();
  await assert.rejects(save(value), /handwriting_resource_conflict/);
  assert.deepEqual(await snapshot(), before);
});

test('a screen resource already linked to another handwriting session cannot clone a completion under a new UUID', async () => {
  const value = await payload(); await save(value); const before = await snapshot();
  await assert.rejects(rawSave({ ...value.session, id: randomUUID() }, value.resource), /handwriting_resource_conflict/);
  assert.deepEqual(await snapshot(), before);
});

test('an existing screen session whose expected resource was removed is rejected without recreating it', async () => {
  const value = await payload(); await save(value);
  await db.query('delete from public.growth_resources where id=$1', [value.resource!.id]);
  const before = await snapshot();
  await assert.rejects(save(value), /handwriting_resource_missing/);
  assert.deepEqual(await snapshot(), before);
});

test('same-ID session conflicts compare all immutable payload values without overwriting', async () => {
  const value = await payload(); await save(value); const before = await snapshot();
  const patches = [
    { memo: 'changed' }, { planned_minutes: 16 }, { session_date: '2026-10-08' },
    { updated_at: '2026-10-09T10:00:01.000Z' },
    { metrics: { ...value.session.metrics, pngSha256: 'b'.repeat(64) } },
    { metrics: { ...value.session.metrics, practiceMode: 'copy' } },
    { metrics: { ...value.session.metrics, worksheet: { ...value.session.metrics.worksheet as object, sha256: 'b'.repeat(64) } } },
    { metrics: { ...value.session.metrics, lessonSnapshot: { ...value.session.metrics.lessonSnapshot as object, goal: 'Original lesson changed' } } },
    { actual_minutes: 2, metrics: { ...value.session.metrics, activeSeconds: 120 } },
  ];
  for (const patch of patches) {
    const session = { ...value.session, ...patch };
    const resource = { ...value.resource!, storage_path: `${owner}/${session.session_date}/handwriting-${value.resource!.id}.png` };
    await assert.rejects(rawSave(session, resource), /handwriting_session_conflict/);
    assert.deepEqual(await snapshot(), before);
  }
});

test('resource replay compares title, notes, size, and both frozen timestamps', async () => {
  const value = await payload(); await save(value); const before = await snapshot();
  for (const patch of [
    { title: 'changed' }, { notes: 'changed' }, { size_bytes: value.resource!.size_bytes + 1 },
    { created_at: '2026-10-09T10:00:01.000Z', updated_at: '2026-10-09T10:00:01.000Z' },
  ]) {
    await assert.rejects(rawSave(value.session, { ...value.resource!, ...patch }), /handwriting_resource_conflict/);
    assert.deepEqual(await snapshot(), before);
  }
});

test('null initial generation works with missing marker or missing state row, without creating app state', async () => {
  await save(await payload());
  await db.query('delete from public.user_app_state where user_id=$1', [owner]);
  await save(await payload('paper'));
  assert.equal((await rows('user_app_state')).length, 0);
  await assert.rejects(save(await payload(), 'invented-generation'), /handwriting_reset_changed/);
});

test('save then real growth reset removes sessions and reviews while preserving resource metadata and other owner data', async () => {
  const value = await payload(); await save(value); await save(await payload('paper'));
  await db.exec('reset role;'); const before = await snapshot(); await db.exec('set role authenticated;');
  const receipt = await reset();
  assert.equal(await row(value.session.id), undefined);
  assert.equal((await rows()).length, 0);
  assertPayload(value.resource!, await row(value.resource!.id, 'growth_resources'));
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

test('reset then stale save rejects before inserting metadata, for both paper and screen attempts', async () => {
  const value = await payload(), paper = await payload('paper');
  const checked = await marker(); const receipt = await reset(); const before = await snapshot();
  await assert.rejects(save(value, checked), /handwriting_reset_changed/);
  await assert.rejects(save(paper, checked), /handwriting_reset_changed/);
  assert.deepEqual(await snapshot(), before); assert.equal(await marker(), receipt.marker);
});

test('reset after a resource-only write preserves it and blocks stale session completion', async () => {
  const value = await payload(); await insertResource(value.resource!);
  await reset(); const before = await snapshot();
  await assert.rejects(save(value), /handwriting_reset_changed/);
  assert.deepEqual(await snapshot(), before);
  assert.equal(await row(value.session.id), undefined);
  assertPayload(value.resource!, await row(value.resource!.id, 'growth_resources'));
});

test('fresh marker may save, then another reset blocks old replay even though resource metadata survives', async () => {
  const first = await reset(), value = await payload();
  await save(value, first.marker);
  const second = await reset();
  await assert.rejects(save(value, first.marker), /handwriting_reset_changed/);
  assert.equal(await row(value.session.id), undefined);
  assertPayload(value.resource!, await row(value.resource!.id, 'growth_resources'));
  await save(value, second.marker); assertPayload(value.session, await row(value.session.id));
});

test('retrying the original reset receipt leaves a subsequent fresh-generation save intact', async () => {
  const request = randomUUID(), receipt = await reset(request), value = await payload();
  await save(value, receipt.marker); const before = await snapshot();
  assert.deepEqual(await reset(request), receipt); assert.deepEqual(await snapshot(), before);
});

test('owned handwriting routine is required; missing, other-owner, wrong category and null routines reject', async () => {
  const value = await payload(); const wrongCategory = randomUUID();
  await db.query("insert into public.growth_routines(id,user_id,category,title) values($1,$2,'typing','Typing')", [wrongCategory, owner]);
  const before = await snapshot();
  for (const routine_id of [otherRoutine, randomUUID(), wrongCategory]) {
    await assert.rejects(rawSave({ ...value.session, routine_id }, { ...value.resource!, routine_id }), /handwriting_routine_invalid/);
  }
  await assert.rejects(rawSave({ ...value.session, routine_id: null }, value.resource), /handwriting_invalid_payload/);
  assert.deepEqual(await snapshot(), before);
});

test('owner checks reject expected-owner, session-owner, resource-owner spoofing and missing auth', async () => {
  const value = await payload(), before = await snapshot();
  for (const expected of [other, null]) await assert.rejects(save(value, null, expected), /handwriting_owner_changed/);
  for (const user_id of [other, null, 1]) {
    await assert.rejects(rawSave({ ...value.session, user_id }, value.resource), /handwriting_owner_changed/);
    await assert.rejects(rawSave(value.session, { ...value.resource!, user_id }), /handwriting_owner_changed/);
  }
  await db.exec("set app.test_user='';"); await assert.rejects(save(value), /handwriting_owner_changed/);
  await db.exec(`set app.test_user='${owner}';`); assert.deepEqual(await snapshot(), before);
});

test('B cannot read A rows; a hidden session-ID collision rolls back the resource inserted first', async () => {
  const a = await payload(); await save(a);
  await db.exec(`set app.test_user='${other}';`);
  assert.equal(await row(a.session.id), undefined); assert.equal(await row(a.resource!.id, 'growth_resources'), undefined);
  await assert.rejects(save(a), /handwriting_owner_changed/);
  const b = await payload('screen', HANDWRITING_LESSONS[0], other, otherRoutine);
  b.session.id = a.session.id;
  const before = await snapshot();
  await assert.rejects(save(b, 'B-generation', other), /duplicate key/);
  assert.equal(await row(b.resource!.id, 'growth_resources'), undefined);
  assert.deepEqual(await snapshot(), before);
  b.session.id = randomUUID(); await save(b, 'B-generation', other);
  assertPayload(b.session, await row(b.session.id));
  await db.exec(`set app.test_user='${owner}';`);
  assertPayload(a.session, await row(a.session.id)); assertPayload(a.resource!, await row(a.resource!.id, 'growth_resources'));
});

test('a hidden global resource-ID collision rejects without inserting a session', async () => {
  const a = await payload(); await save(a);
  await db.exec(`set app.test_user='${other}';`);
  const b = await payload('screen', HANDWRITING_LESSONS[0], other, otherRoutine);
  b.resource!.id = a.resource!.id; b.session.metrics.resourceId = a.resource!.id;
  b.resource!.storage_path = `${other}/${b.session.session_date}/handwriting-${a.resource!.id}.png`;
  const before = await snapshot();
  await assert.rejects(save(b, 'B-generation', other), /duplicate key/);
  assert.deepEqual(await snapshot(), before);
});

test('anon has neither RPC execution nor table access; no unauthenticated fallback exists', async () => {
  await db.exec('set role anon;');
  await assert.rejects(save(await payload()), /permission denied for function save_handwriting_attempt/);
  await assert.rejects(rows(), /permission denied/);
});

test('malformed or extended session/resource payloads fail without mutation', async () => {
  const value = await payload(), before = await snapshot();
  const invalidSessions: unknown[] = [null, [], 'bad', { ...value.session, extra: true },
    ...Object.keys(value.session).filter(key => key !== 'user_id').map(key => Object.fromEntries(Object.entries(value.session).filter(([field]) => field !== key))),
    ...[
      { id: 'bad' }, { status: 'partial' }, { source: 'typing' }, { routine_id: 7 },
      { planned_minutes: '15' }, { planned_minutes: 1.5 }, { planned_minutes: -1 }, { planned_minutes: 241 },
      { actual_minutes: null }, { actual_minutes: 1441 }, { actual_minutes: 60 },
      { memo: null }, { memo: 'x'.repeat(501) }, { session_date: '2026-02-30' }, { session_date: '2026-2-01' },
      { started_at: frozenTime }, { ended_at: frozenTime }, { updated_at: 'now' }, { updated_at: 'infinity' },
      { updated_at: '2026-10-09T10:00:00' }, { updated_at: '2026-02-30T10:00:00Z' }, { metrics: [] },
    ].map(patch => ({ ...value.session, ...patch })),
  ];
  for (const candidate of invalidSessions) await assert.rejects(rawSave(candidate, value.resource));
  const invalidResources: unknown[] = [null, [], 'bad', { ...value.resource!, extra: true },
    ...Object.keys(value.resource!).filter(key => key !== 'user_id').map(key => Object.fromEntries(Object.entries(value.resource!).filter(([field]) => field !== key))),
    ...[
      { id: randomUUID() }, { routine_id: otherRoutine }, { title: '' }, { title: 'x'.repeat(121) },
      { category: 'reference' }, { storage_path: `${owner}/elsewhere.png` }, { mime_type: 'image/webp' },
      { size_bytes: '1' }, { size_bytes: 1.5 }, { size_bytes: 0 }, { size_bytes: 10485761 },
      { classification: 'reference' }, { notes: null }, { notes: 'x'.repeat(501) },
      { created_at: 'now', updated_at: 'now' }, { updated_at: '2026-10-09T10:00:01.000Z' },
    ].map(patch => ({ ...value.resource!, ...patch })),
  ];
  for (const candidate of invalidResources) await assert.rejects(rawSave(value.session, candidate));
  await assert.rejects(save(value, 'x'.repeat(201)), /handwriting_invalid_payload/);
  assert.deepEqual(await snapshot(), before);
});

test('metrics enforce course, lesson/page, completion, mode/checks, bounded full snapshots and hash linkage', async () => {
  const value = await payload(), m = value.session.metrics, before = await snapshot();
  const patches = [
    { extra: 1 }, { courseId: 'other-course' }, { lessonId: 'film-p3' }, { pdfPage: 1 }, { pdfPage: 55 }, { pdfPage: '2' },
    { lessonCompleted: false }, { selfChecks: [true, false] }, { selfChecks: [true] }, { selfChecks: ['true', 'true'] },
    { mode: 'other' }, { practiceMode: 'paper' }, { resourceId: randomUUID() }, { pngSha256: 'A'.repeat(64) },
    { pngSha256: 1 }, { strokes: 0 }, { strokes: 1_000_001 }, { strokes: 1.1 }, { activeSeconds: -1 }, { activeSeconds: 86401 },
    { activeSeconds: '62' }, { timeSource: 'self-reported' }, { lessonSnapshot: null }, { worksheet: null },
    { lessonSnapshot: { ...m.lessonSnapshot as object, id: 'film-p3' } },
    { lessonSnapshot: { ...m.lessonSnapshot as object, number: 2 } },
    { lessonSnapshot: { ...m.lessonSnapshot as object, pdfPage: 3 } },
    { lessonSnapshot: { ...m.lessonSnapshot as object, checks: ['one'] } },
    { lessonSnapshot: { ...m.lessonSnapshot as object, steps: [''] } },
    { lessonSnapshot: { ...m.lessonSnapshot as object, steps: [true] } },
    { lessonSnapshot: { ...m.lessonSnapshot as object, goal: 'x'.repeat(4000) } },
    { lessonSnapshot: { ...m.lessonSnapshot as object, title: '' } },
    { worksheet: { ...m.worksheet as object, path: `${other}/learning/film-v1/page-02.webp` } },
    { worksheet: { ...m.worksheet as object, path: handwritingMaterialPath(owner, 'page-03.webp') } },
    { worksheet: { ...m.worksheet as object, version: '' } },
    { worksheet: { ...m.worksheet as object, sha256: 'bad' } },
  ];
  for (const patch of patches) await assert.rejects(rawSave({ ...value.session, metrics: { ...m, ...patch } }, value.resource), JSON.stringify(patch));
  for (const key of Object.keys(m)) await assert.rejects(rawSave({ ...value.session, metrics: Object.fromEntries(Object.entries(m).filter(([field]) => field !== key)) }, value.resource), key);
  assert.deepEqual(await snapshot(), before);
});

test('paper payload forbids screen resource/evidence and requires positive truthful self-reported minutes', async () => {
  const value = await payload('paper'), screen = await payload(), before = await snapshot();
  await assert.rejects(rawSave(value.session, screen.resource), /handwriting_invalid_payload/);
  for (const minutes of [0, 241]) await assert.rejects(rawSave({ ...value.session, actual_minutes: minutes }, null), /handwriting_invalid_payload/);
  for (const patch of [{ timeSource: 'measured' }, { resourceId: randomUUID() }, { practiceMode: 'copy' }, { strokes: 1 }]) {
    await assert.rejects(rawSave({ ...value.session, metrics: { ...value.session.metrics, ...patch } }, null), /handwriting_invalid_payload/);
  }
  assert.deepEqual(await snapshot(), before);
});

test('boundary values accept a zero-rounded measured minute and a maximum-size private PNG', async () => {
  const value = await payload(); value.session.actual_minutes = 0; value.session.metrics.activeSeconds = 0;
  value.resource!.size_bytes = 10485760;
  await save(value); assertPayload(value.session, await row(value.session.id));
  assertPayload(value.resource!, await row(value.resource!.id, 'growth_resources'));
});

test('explicit transaction rollback restores both session/resource rows and releases the reset lock', async () => {
  const value = await payload(), before = await snapshot();
  await db.exec('begin;');
  try { await save(value); assert.ok(await row(value.session.id)); assert.ok(await row(value.resource!.id, 'growth_resources')); }
  finally { await db.exec('rollback;'); }
  assert.deepEqual(await snapshot(), before);
});

test('RPC is invoker, empty search_path, authenticated-only EXECUTE, with reset lock before marker/replay/inserts', async () => {
  const functions = (await db.query<{ proname: string; prosecdef: boolean; provolatile: string; proconfig: string[]; definition: string }>(
    "select proname,prosecdef,provolatile,proconfig,pg_get_functiondef(oid) definition from pg_proc where proname in ('save_handwriting_attempt','reset_my_app_records') order by proname",
  )).rows;
  assert.equal(functions.length, 2);
  for (const fn of functions) {
    assert.equal(fn.prosecdef, false); assert.equal(fn.provolatile, 'v'); assert.ok(fn.proconfig.includes('search_path=""'));
    assert.match(fn.definition, /pg_advisory_xact_lock\(hashtextextended\('app-record-reset:' \|\| owner_id::text, 0\)\)/);
  }
  const definition = functions.find(fn => fn.proname === 'save_handwriting_attempt')!.definition;
  assert.ok(definition.indexOf('pg_advisory_xact_lock') < definition.indexOf("select state->>'ai-fitness-record-reset-growth'"));
  assert.ok(definition.indexOf('handwriting_reset_changed') < definition.indexOf('if session_exists then return;'));
  assert.ok(definition.indexOf('handwriting_reset_changed') < definition.indexOf('insert into public.growth_resources'));
  assert.doesNotMatch(definition, /on conflict|update public\.|delete from|storage\./i);
  assert.deepEqual((await db.query(
    "select has_function_privilege('authenticated','public.save_handwriting_attempt(jsonb,jsonb,uuid,text)','EXECUTE') authenticated, has_function_privilege('anon','public.save_handwriting_attempt(jsonb,jsonb,uuid,text)','EXECUTE') anon",
  )).rows[0], { authenticated: true, anon: false });
});

test('save and reset hold the same real transaction advisory lock (single connection)', async () => {
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
});

test('scope boundary: legacy direct INSERT remains unchanged and outside the new reset fence', async () => {
  await reset();
  await db.query("insert into public.growth_sessions(user_id,routine_id,status,source,memo) values($1,$2,'partial','handwriting','legacy residual')", [owner, routine]);
  assert.equal((await rows()).length, 1);
});
