import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { DIET_RECORD_KEY as key, DIET_WATER_KEY as waterKey, dietDaySnapshot, dietNextSnapshot, parseDietCommand, isDietCommandProposal, describeDietSnapshot } from '../lib/assistant-diet-command.ts';
import { readCommandDrafts } from '../lib/assistant-command-drafts.ts';

const db = new PGlite();
const owner = randomUUID(), other = randomUUID();
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
type Row = Record<string, unknown>;
const original = {
  settings: 'keep', 'ai-fitness-diet-meal-log': { [today()]: { lunchProteinChoice: '25', breakfastShake: true } },
  'ai-fitness-protein-total': { [today()]: 56 }, 'ai-fitness-diet-start-date': '2026-08-24',
  [key]: { '2001-01-01': { dietMemo: 'keep old' }, [today()]: { dietMemo: '기존 식사', waterMl: 300, water2l: false, proteinTotal: 56, meals: { breakfast: true }, fastingRecordStatus: 'unrecorded', customField: 'keep' } },
  [waterKey]: { '2001-01-01': 1000, [today()]: 300 },
};
const request = (overrides = {}) => ({ id: randomUUID(), day: today(), change: { kind: 'water', totalMl: 500 }, expected: dietDaySnapshot(original, today()), resets: { diet: null, assistant: null }, expires: new Date(Date.now() + 15 * 60_000).toISOString(), ...overrides });
const apply = async (p: ReturnType<typeof request>) => (await db.query<Row>('select public.apply_assistant_diet_command($1,$2,$3,$4,$5,$6) receipt', [p.id, p.day, p.change, p.expected, p.resets, p.expires])).rows[0].receipt as Row;
const undo = async (id: string) => (await db.query<Row>('select public.undo_assistant_diet_command($1) receipt', [id])).rows[0].receipt as Row;
const state = async () => (await db.query<{state: Row}>('select state from public.user_app_state')).rows[0]?.state;
const count = async () => Number((await db.query<{n: number}>('select count(*) n from public.assistant_diet_command_history')).rows[0].n);
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
  await db.exec(read('../supabase/migrations/20260916104440_assistant_diet_commands.sql'));
  await db.exec(read('../supabase/migrations/20260916131029_assistant_diet_meal_commands.sql'));
});
after(async () => db.close());
beforeEach(async () => {
  await db.exec(`reset role; truncate auth.users cascade; insert into auth.users values('${owner}'),('${other}'); set app.test_user='${owner}'; set role authenticated;`);
  await db.query('insert into public.user_app_state(user_id,state) values($1,$2)', [owner, original]);
});

test('water replaces the reviewed total in both stores, preserves all meals and nutrition, and undoes exactly', async () => {
  const p = request(); const receipt = await apply(p); const saved = await state();
  assert.deepEqual(saved, { ...original, [key]: { ...original[key], [today()]: { ...original[key][today()], waterMl: 500 } }, [waterKey]: { ...original[waterKey], [today()]: 500 } });
  assert.deepEqual(receipt.after_values, dietNextSnapshot(p.expected, { kind: 'water', totalMl: 500 }));
  assert.deepEqual(await apply(p), receipt); assert.equal(await count(), 1);
  const undone = await undo(p.id); assert.ok(undone.undone_at); assert.deepEqual(await state(), original);
  assert.deepEqual(await undo(p.id), undone); assert.deepEqual(await apply(p), undone); assert.deepEqual(await state(), original);
});
test('a lost response retry remains readable after expiry and never adds water twice', async () => {
  const p = request({ expires: new Date(Date.now() + 120).toISOString() }); await apply(p);
  await new Promise(resolve => setTimeout(resolve, 140));
  assert.equal((await apply(p)).id, p.id); assert.equal(dietDaySnapshot(await state(), today()).water, 500); assert.equal(await count(), 1);
});
test('memo appends literal text once without food inference or rewriting the water store', async () => {
  const before = { ...original, [waterKey]: JSON.stringify(original[waterKey]) }; await write(before);
  const change = { kind: 'memo', text: '점심 닭가슴살 그리고 내일 할 일 추가해줘 <b>그거</b>' };
  const p = request({ change }); const receipt = await apply(p);
  const expected = { ...before, [key]: { ...original[key], [today()]: { ...original[key][today()], dietMemo: `${original[key][today()].dietMemo}\n${change.text}` } } };
  assert.deepEqual(await state(), expected); assert.deepEqual(await apply(p), receipt); assert.deepEqual(await state(), expected);
  await undo(p.id); assert.deepEqual(await state(), before);
});
test('water accepts zero and updates only the derived water flag at the 2000mL boundary', async () => {
  for (const totalMl of [0, 1999, 2000, 10000]) {
    const p = request({ change: { kind: 'water', totalMl } }); await apply(p);
    const snapshot = dietDaySnapshot(await state(), today()); assert.equal(snapshot.water, totalMl); assert.equal(snapshot.record?.water2l, totalMl >= 2000);
    await undo(p.id); assert.deepEqual(await state(), original);
  }
});
test('water store and summary disagreement is shown and restored without discarding either value', async () => {
  const before = { ...original, [waterKey]: { [today()]: 0 } }; await write(before);
  const expected = dietDaySnapshot(before, today()); assert.equal(describeDietSnapshot(expected, 'water'), '수분 입력 0mL · 식단 기록 300mL');
  const p = request({ expected }); await apply(p); await undo(p.id); assert.deepEqual(await state(), before);
});
test('concurrent stale requests have one winner and the rejected memo cannot overwrite water', async () => {
  const results = await Promise.allSettled([apply(request()), apply(request({ change: { kind: 'memo', text: 'concurrent' } }))]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(await count(), 1);
});
test('history insertion failure rolls back both water stores', async () => {
  await db.exec('reset role; revoke insert on public.assistant_diet_command_history from authenticated; set role authenticated;');
  try { await assert.rejects(apply(request())); assert.deepEqual(await state(), original); assert.equal(await count(), 0); }
  finally { await db.exec('reset role; grant insert on public.assistant_diet_command_history to authenticated; set role authenticated;'); }
});
test('changes to other dates and settings survive apply and undo', async () => {
  const p = request(); const changed = { ...original, settings: 'new', [key]: { ...original[key], '2001-01-03': { dietMemo: 'new old note' } } }; await write(changed); await apply(p);
  const saved = await state(); await write({ ...saved, [waterKey]: { ...(saved[waterKey] as Row), '2001-01-04': 100 } });
  await undo(p.id); assert.deepEqual(await state(), { ...changed, [waterKey]: { ...changed[waterKey], '2001-01-04': 100 } });
});
test('later same-day meal edits block undo and preserve the new record', async () => {
  const p = request(); await apply(p); const saved = await state();
  const changed = { ...saved, [key]: { ...(saved[key] as Row), [today()]: { ...dietDaySnapshot(saved, today()).record, dietMemo: 'newer meal' } } };
  await write(changed); await assert.rejects(undo(p.id), /이후에 오늘 식단 기록/); assert.deepEqual(await state(), changed);
});
test('absent keys, empty records, and empty memos round-trip without inventing any meal facts', async () => {
  for (const before of [{ settings: 'keep' }, { [key]: {}, [waterKey]: {} }, { [key]: { [today()]: { dietMemo: '' } } }]) {
    for (const change of [{ kind: 'water', totalMl: 500 }, { kind: 'memo', text: 'explicit meal' }]) {
      await write(before); const p = request({ expected: dietDaySnapshot(before, today()), change }); await apply(p);
      assert.equal(dietDaySnapshot(await state(), today()).record?.proteinTotal, undefined); await undo(p.id); assert.deepEqual(await state(), before);
    }
  }
  await db.exec('delete from public.user_app_state'); const p = request({ expected: {} }); await apply(p); await undo(p.id); assert.deepEqual(await state(), {});
});
test('legacy JSON strings retain all dates and keep their representation type', async () => {
  const before = { ...original, [key]: JSON.stringify(original[key]), [waterKey]: JSON.stringify(original[waterKey]) }; await write(before);
  const p = request(); await apply(p); await undo(p.id); const saved = await state();
  for (const field of [key, waterKey]) { assert.equal(typeof saved[field], 'string'); assert.deepEqual(JSON.parse(saved[field] as string), original[field as keyof typeof original]); }
});
test('malformed stores and records fail closed without erasing data', async () => {
  for (const field of [key, waterKey]) for (const value of [null, [], '{', 'null', { [today()]: null }, { [today()]: 'bad' }]) {
    const before = { ...original, [field]: value }; await write(before); assert.throws(() => dietDaySnapshot(before, today()));
    await assert.rejects(apply(request())); assert.deepEqual(await state(), before); assert.equal(await count(), 0);
  }
});
test('oversized or malformed old memos are preserved and cannot be silently replaced', async () => {
  for (const dietMemo of [null, 1, 'x'.repeat(4000)]) {
    const before = { ...original, [key]: { [today()]: { dietMemo } } }; await write(before);
    const expected = dietDaySnapshot(before, today()); const change = { kind: 'memo', text: 'new' };
    assert.throws(() => dietNextSnapshot(expected, { kind: 'memo', text: 'new' })); await assert.rejects(apply(request({ expected, change }))); assert.deepEqual(await state(), before);
  }
});
test('date, expiry, invalid values, extra fields and changed request IDs cannot mutate records', async () => {
  for (const change of [{ totalMl: -1, kind: 'water' }, { totalMl: 0.5, kind: 'water' }, { totalMl: 10001, kind: 'water' }, { totalMl: '500', kind: 'water' }, { kind: 'memo', text: '' }, { kind: 'memo', text: 'x'.repeat(401) }, { kind: 'water', totalMl: 500, meals: {} }, { kind: 'food', text: 'rice' }]) await assert.rejects(apply(request({ change })));
  for (const overrides of [{ day: '2001-01-01' }, { expires: '2001-01-01T00:00:00Z' }, { expected: { injected: true } }]) await assert.rejects(apply(request(overrides)));
  assert.deepEqual(await state(), original); const p = request(); await apply(p); await assert.rejects(apply({ ...p, change: { kind: 'water', totalMl: 600 } }), /이미 사용한 요청/); assert.equal(await count(), 1);
});
test('RLS isolates owner histories and anonymous requests have no access', async () => {
  const p = request(); await apply(p); await db.exec(`set app.test_user='${other}';`);
  assert.equal(await count(), 0); assert.equal(await state(), undefined); await assert.rejects(undo(p.id), /이력을 찾을 수/);
  await assert.rejects(db.query("insert into public.assistant_diet_command_history(user_id,id,record_date,payload_hash,change,before_values,after_values,store_formats) values($1,$2,current_date,'x','{}','{}','{}','{}')", [owner, randomUUID()]));
  await db.exec('reset role; set role anon;'); await assert.rejects(apply(request())); await assert.rejects(db.query('select * from public.assistant_diet_command_history'));
});
for (const area of ['diet','assistant']) test(`${area} reset removes history and blocks old confirmations`, async () => {
  const p = request(), pending = request(); await apply(p); await db.query("select public.reset_my_app_records($1,$2,'초기화')", [area, randomUUID()]);
  assert.equal(await count(), 0); await assert.rejects(apply(pending), /초기화/); await assert.rejects(undo(p.id), /이력을 찾을 수/);
});
test('Auth account deletion cascades without application grants for the Auth role', async () => {
  await apply(request()); await db.exec(`reset role; set role synthetic_auth_admin; delete from auth.users where id='${owner}'; reset role;`); assert.equal(await count(), 0);
});
test('parser requires explicit total or literal memo and rejects questions, increments, past dates and conditions', () => {
  for (const text of ['오늘 물 총 500ml 기록해줘', '물 총 0.5L로 저장해주세요', '오늘 수분 총 500밀리리터 기록해요']) assert.deepEqual(parseDietCommand(text), { kind: 'water', totalMl: 500 });
  assert.deepEqual(parseDietCommand('오늘 식단 메모 추가: 어제 회식 그리고 그거는 기록할 문장'), { kind: 'memo', text: '어제 회식 그리고 그거는 기록할 문장' });
  for (const text of ['물 500ml 마셨어', '어제 물 총 500ml 기록해줘', '내일 물 총 500ml 기록해줘', '오늘 물 총 500ml 기록해줘?', '오늘 물 총 500ml 기록하지 마', '물 총 0.5ml 기록해줘', '오늘 식단 완료했어', '오늘 식단 메모 추가:', '물 총 500ml 마시면 기록해줘']) assert.throws(() => parseDietCommand(text));
});
test('draft recovery retains the owner and exact request, rejecting malformed dates, changes and snapshots', () => {
  const p = { domain: 'diet', ownerId: owner, requestId: randomUUID(), date: today(), change: { kind: 'water', totalMl: 500 }, expected: request().expected, resetMarkers: request().resets, expiresAt: request().expires };
  assert.ok(isDietCommandProposal(p)); const drafts = [{ proposal: p, attempted: true }];
  assert.deepEqual(readCommandDrafts(JSON.stringify({ ownerId: owner, drafts }), owner), drafts); assert.deepEqual(readCommandDrafts(JSON.stringify({ ownerId: owner, drafts }), other), []);
  for (const bad of [{ ...p, date: '2026-02-30' }, { ...p, expected: { record: null } }, { ...p, change: { kind: 'water', totalMl: -1 } }, { ...p, change: { kind: 'memo', text: 'new' }, expected: { record: { dietMemo: 1 } } }, { ...p, ownerId: other }]) assert.throws(() => readCommandDrafts(JSON.stringify({ ownerId: owner, drafts: [{ proposal: bad, attempted: false }] }), owner));
});
