import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { isLanguageCommandProposal, languageCompletedIds, languageRecords, parseLanguageCompletion } from '../lib/assistant-language-command.ts';
import { readCommandDrafts } from '../lib/assistant-command-drafts.ts';

const db = new PGlite();
const owner = randomUUID(), other = randomUUID();
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
type Row = Record<string, unknown>;
const original = { settings: 'keep', wrongWords: '["keep"]', dailyRoutineProgress: JSON.stringify({ date: today(), completedIds: ['kana'] }), dailyLearningHistory: JSON.stringify({ '2001-01-01': { completedIds: ['grammar'], memo: 'preserve' }, [today()]: { completedIds: ['kana'], completedCount: 1, totalCount: 5, memo: 'keep' } }) };
const request = (overrides = {}) => ({ id: randomUUID(), routine: 'words', day: today(), expected: languageRecords(original), resets: { language: null, assistant: null }, expires: new Date(Date.now() + 15 * 60_000).toISOString(), ...overrides });
const apply = async (p: ReturnType<typeof request>) => (await db.query<Row>('select public.apply_assistant_language_command($1,$2,$3,$4,$5,$6) receipt', [p.id, p.routine, p.day, p.expected, p.resets, p.expires])).rows[0].receipt as Row;
const undo = async (id: string) => (await db.query<Row>('select public.undo_assistant_language_command($1) receipt', [id])).rows[0].receipt as Row;
const state = async () => (await db.query<{state: Row}>('select state from public.language_user_state')).rows[0]?.state;
const count = async () => Number((await db.query<{n: number}>('select count(*) n from public.assistant_language_command_history')).rows[0].n);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
before(async () => {
  await db.exec(`create role authenticated; create role anon; create role service_role; create role synthetic_auth_admin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_user',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    grant usage on schema auth to synthetic_auth_admin; grant select,delete on auth.users to synthetic_auth_admin;`);
  await db.exec(read('./e2e/schema.sql'));
  await db.exec(read('../supabase/migrations/20260915034857_assistant_task_command_history.sql'));
  await db.exec(read('../supabase/migrations/20260916043619_assistant_language_commands.sql'));
  await db.exec(read('../supabase/migrations/20260916045546_language_history_reset_triggers.sql'));
});
after(async () => db.close());
beforeEach(async () => {
  await db.exec(`reset role; truncate auth.users cascade; insert into auth.users values('${owner}'),('${other}'); set app.test_user='${owner}'; set role authenticated;`);
  await db.query('insert into public.language_user_state(user_id,state) values($1,$2)', [owner, original]);
});

test('atomic completion records both keys, preserves old days/settings, retries once, and undo restores exact original values', async () => {
  const p = request(); const receipt = await apply(p);
  const saved = await state();
  assert.deepEqual(languageCompletedIds(languageRecords(saved), today()), ['kana', 'words']);
  const history = JSON.parse(saved.dailyLearningHistory as string);
  assert.deepEqual(history['2001-01-01'], { completedIds: ['grammar'], memo: 'preserve' });
  assert.equal(history[today()].memo, 'keep'); assert.equal(saved.settings, 'keep');
  assert.deepEqual(await apply(p), receipt); assert.equal(await count(), 1);
  const undone = await undo(p.id); assert.ok(undone.undone_at);
  assert.deepEqual(await state(), original); assert.deepEqual(await undo(p.id), undone);
  assert.deepEqual(await apply(p), undone); assert.deepEqual(await state(), original);
});
test('history insert failure rolls back the learning record and same request remains retryable', async () => {
  const p = request();
  await db.exec("reset role; alter table public.assistant_language_command_history add constraint injected_failure check(routine_id<>'words'); set role authenticated;");
  await assert.rejects(apply(p)); assert.deepEqual(await state(), original); assert.equal(await count(), 0);
  await db.exec('reset role; alter table public.assistant_language_command_history drop constraint injected_failure; set role authenticated;');
  await apply(p); assert.equal(await count(), 1);
});
test('two stale proposals cannot replace learning completed since review', async () => {
  const a = request(), b = request({ routine: 'grammar' });
  const results = await Promise.allSettled([apply(a), apply(b)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(await count(), 1);
  assert.deepEqual(languageCompletedIds(languageRecords(await state()), today()), ['kana', 'words']);
});
test('later settings are preserved by apply and undo; later learning blocks undo without partial changes', async () => {
  const p = request();
  await db.query("update public.language_user_state set state=state||$1::jsonb", [{ settings: 'new' }]);
  await apply(p); await undo(p.id); assert.equal((await state()).settings, 'new');
  const next = request(); await apply(next);
  const changed = { ...(await state()), dailyRoutineProgress: JSON.stringify({ date: today(), completedIds: ['kana', 'words', 'grammar'] }) };
  await db.query('update public.language_user_state set state=$1', [changed]);
  await assert.rejects(undo(next.id), /이후에 학습 기록/); assert.deepEqual(await state(), changed);
});
test('missing row and missing keys are supported, and undo removes only newly created record keys', async () => {
  await db.exec('delete from public.language_user_state');
  const p = request({ expected: {} }); await apply(p);
  assert.deepEqual(languageCompletedIds(await state(), today()), ['words']);
  await db.query("update public.language_user_state set state=state||'{\"settings\":\"new\"}'::jsonb");
  await undo(p.id); assert.deepEqual(await state(), { settings: 'new' });
});
test('object-valued records are supported and progress/history discrepancies retain every completed routine', async () => {
  const records = { dailyRoutineProgress: { date: today(), completedIds: ['kana'] }, dailyLearningHistory: { [today()]: { completedIds: ['grammar'] } } };
  await db.query('update public.language_user_state set state=$1', [records]);
  const p = request({ expected: records }); await apply(p);
  assert.deepEqual(languageCompletedIds(await state(), today()), ['kana', 'grammar', 'words']);
  await undo(p.id); assert.deepEqual(await state(), records);
});
test('malformed JSON or completion lists cannot erase old records', async () => {
  for (const bad of [{ dailyRoutineProgress: '{' }, { dailyLearningHistory: '[]' }, { dailyRoutineProgress: { date: today(), completedIds: ['unknown'] } }, { dailyLearningHistory: { [today()]: null } }]) {
    const invalid = { ...original, ...bad }; await db.query('update public.language_user_state set state=$1', [invalid]);
    await assert.rejects(apply(request({ expected: languageRecords(invalid) })));
    assert.deepEqual(await state(), invalid); assert.equal(await count(), 0);
  }
});
test('expired/cross-day/already-completed/invalid requests fail without a write', async () => {
  for (const change of [{ expires: '2001-01-01T00:00:00Z' }, { day: '2001-01-01' }, { routine: 'kana' }, { routine: 'unknown' }, { expected: { ...languageRecords(original), settings: 'overwrite' } }]) await assert.rejects(apply(request(change)));
  assert.deepEqual(await state(), original); assert.equal(await count(), 0);
  const p = request(); await apply(p); await assert.rejects(apply({ ...p, routine: 'grammar' }), /이미 사용한 요청/);
});
test('RLS protects another owner and anon has no command or history access', async () => {
  const p = request(); await apply(p);
  await db.exec(`set app.test_user='${other}';`);
  assert.equal(await count(), 0); assert.equal(await state(), undefined);
  await assert.rejects(undo(p.id), /이력을 찾을 수/);
  await assert.rejects(db.query('insert into public.assistant_language_command_history(user_id,id,routine_id,record_date,payload_hash,before_values,after_values) values($1,$2,\'words\',current_date,\'x\',\'{}\',\'{}\')', [owner, randomUUID()]));
  await db.exec('reset role; set role anon;');
  await assert.rejects(apply(request())); await assert.rejects(db.query('select * from public.assistant_language_command_history'));
});
for (const area of ['language', 'assistant']) test(`${area} reset removes snapshots and invalidates all earlier pending commands`, async () => {
  const saved = request(), pending = request({ routine: 'grammar' }); await apply(saved);
  await db.query("select public.reset_my_app_records($1,$2,'초기화')", [area, randomUUID()]);
  assert.equal(await count(), 0);
  await assert.rejects(apply(pending), /초기화/); await assert.rejects(undo(saved.id), /이력을 찾을 수/);
});
test('Auth admin account deletion cascades snapshots without permission on application history', async () => {
  await apply(request());
  await db.exec(`reset role; set role synthetic_auth_admin; delete from auth.users where id='${owner}'; reset role;`);
  assert.equal(await count(), 0);
});
test('ambiguous, negated and non-today language commands do not become completion proposals', () => {
  assert.equal(parseLanguageCompletion('오늘 단어 학습 완료했어'), 'words');
  assert.equal(parseLanguageCompletion('히라가나 카타카나 완료했어'), 'kana');
  for (const text of ['단어와 문법 완료했어', '어제 단어 완료했어', '9월 12일 단어 완료', '단어 완료 안했어', '단어 아직 못했어', '단어 미완료', '단어 완료하지 마', '복습 완료 취소', '일본어 완료했어']) assert.throws(() => parseLanguageCompletion(text));
});
test('language drafts recover same request only for their owner and reject malformed snapshots', () => {
  const p = { domain: 'language', ownerId: owner, requestId: randomUUID(), routineId: 'words', date: today(), expected: languageRecords(original), resetMarkers: { language: null, assistant: null }, expiresAt: new Date().toISOString() };
  assert.ok(isLanguageCommandProposal(p));
  const drafts = [{ proposal: p, attempted: true }], raw = JSON.stringify({ ownerId: owner, drafts });
  assert.deepEqual(readCommandDrafts(raw, owner), drafts); assert.deepEqual(readCommandDrafts(raw, other), []);
  for (const bad of [{ ...p, expected: { dailyRoutineProgress: [] } }, { ...p, date: '2026-02-30' }, { ...p, ownerId: other }]) assert.throws(() => readCommandDrafts(JSON.stringify({ ownerId: owner, drafts: [{ proposal: bad, attempted: false }] }), owner));
});
