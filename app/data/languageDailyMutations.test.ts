import assert from 'node:assert/strict';
import test from 'node:test';
import { languageFixture } from '../../tests/helpers/languageFixture.ts';
import { commitLanguageSyncResponse, readLanguageRecordSnapshot, updateLanguageRecords } from './languageCloudSync.ts';
import { createLanguageMutation, reconcileLanguageMutation } from './languageRecordMutations.ts';
import { planRoutineChange, runRoutineChange, type RoutineChangePayload } from './languageDailyMutations.ts';
import type { LanguageBytes } from './languageStorageBoundary.ts';
import { STORAGE_PROTOCOL_KEY } from './storageTransaction.ts';
const date = '2026-10-09', timestamp = '2026-10-09T23:59:59.000Z';
async function fixture(seed: LanguageBytes = {}) { const f = languageFixture(), request = await f.request(); const context = (await commitLanguageSyncResponse(request.request, seed)).context; return { ...f, ...request, context, intent(payload: RoutineChangePayload) { return createLanguageMutation(context, readLanguageRecordSnapshot(context), payload, { date, timestamp }); } }; }
const parsed = (raw: string | null) => JSON.parse(raw ?? '{}');
test('completion unions two fresh documents, preserves unknown tokens/fields/days, and freezes event day/time', async t => {
  const f = await fixture({ dailyRoutineProgress: '{ "date":"2026-10-09", "completedIds":["kana", 9007199254740993123,"\\u672a"], "future":1e999,"future":2 }', dailyLearningHistory: '{"2026-10-08":{"opaque":9007199254740993123},"2026-10-09":{"completedIds":["words",{"future":1e999}],"tag":"\\u3042"}}' }); t.after(f.restore);
  const result = await runRoutineChange(f.intent({ id: 'sentences', mode: 'complete' }));
  assert.deepEqual(result.result.completedIds, ['kana', 'words', 'sentences']);
  const raw = f.storage.getItem('dailyRoutineProgress')!; assert.ok(raw.includes('9007199254740993123')); assert.ok(raw.includes('"\\u672a"')); assert.ok(raw.includes('"future":1e999,"future":2'));
  const history = f.storage.getItem('dailyLearningHistory')!; assert.ok(history.includes('"2026-10-08":{"opaque":9007199254740993123}')); assert.ok(history.includes('{"future":1e999}')); assert.ok(history.includes('"tag":"\\u3042"')); assert.equal(parsed(history)[date].updatedAt, timestamp);
});
test('completion reads lock-time membership and never resurrects a deliberately removed stale member', async t => {
  const f = await fixture({ dailyRoutineProgress: '{"date":"2026-10-09","completedIds":["kana"]}', dailyLearningHistory: '{"2026-10-09":{"completedIds":["kana"],"completedCount":1,"totalCount":5,"updatedAt":"2026-10-09T01:00:00Z"}}' }); t.after(f.restore);
  const old = f.intent({ id: 'words', mode: 'complete' });
  await runRoutineChange(f.intent({ id: 'kana', mode: 'toggle' }));
  await runRoutineChange(old); assert.deepEqual(parsed(f.storage.getItem('dailyRoutineProgress')).completedIds, ['words']);
});
test('already-consistent completion is exact byte no-op including timestamp and numeric spelling', async t => {
  const pair = { dailyRoutineProgress: '{ "date":"2026-10-09","completedIds":["kana"] }', dailyLearningHistory: '{"2026-10-09":{"completedIds":["kana"],"completedCount":1e0,"totalCount":5e0,"updatedAt":"2026-10-09T00:00:00Z"}}' };
  const f = await fixture(pair); t.after(f.restore); const plan = planRoutineChange(pair, f.intent({ id: 'kana', mode: 'complete' })); assert.deepEqual(plan.changes, {});
  await runRoutineChange(f.intent({ id: 'kana', mode: 'complete' })); assert.equal(f.storage.getItem('dailyLearningHistory'), pair.dailyLearningHistory);
});
test('completion repairs legacy pair disagreement instead of early returning on routine membership', async t => {
  const f = await fixture({ dailyRoutineProgress: '{"date":"2026-10-09","completedIds":["review"]}' }); t.after(f.restore);
  await runRoutineChange(f.intent({ id: 'review', mode: 'complete' })); assert.deepEqual(parsed(f.storage.getItem('dailyLearningHistory'))[date].completedIds, ['review']);
});
for (const [key, raw] of [ ['dailyRoutineProgress', 'null'], ['dailyRoutineProgress', '{"date":"2026-10-09","completedIds":{}}'], ['dailyRoutineProgress', '{"date":"2026-10-09","date":"2026-10-09"}'], ['dailyLearningHistory', '[]'], ['dailyLearningHistory', '{"2026-10-09":null}'], ['dailyLearningHistory', '{"2026-10-09":{"completedCount":"2"}}'], ['dailyLearningHistory', '{"2026-10-09":{"completedIds":true}}'], ['dailyLearningHistory', '{"2026-10-09":{},"2026-10-09":{}}'] ] as const) test(`invalid daily source blocks entire pair: ${key} ${raw}`, async t => {
  const f = await fixture({ [key]: raw }); t.after(f.restore); const before = readLanguageRecordSnapshot(f.context).records;
  await assert.rejects(runRoutineChange(f.intent({ id: 'kana', mode: 'complete' }))); assert.deepEqual(readLanguageRecordSnapshot(f.context).records, before);
});
test('old-day queued action refuses newer routine head, while rollover preserves unknown memberships', async t => {
  const f = await fixture({ dailyRoutineProgress: '{"date":"2026-10-08","completedIds":["kana","future",1e999]}' }); t.after(f.restore);
  const old = f.intent({ id: 'words', mode: 'complete' });
  await runRoutineChange(old); assert.deepEqual(parsed(f.storage.getItem('dailyRoutineProgress')).completedIds.slice(0, 1), ['future']);
  const next = createLanguageMutation(f.context, readLanguageRecordSnapshot(f.context), { id: 'kana' as const, mode: 'complete' as const }, { date: '2026-10-10', timestamp: '2026-10-10T00:01:00Z' });
  await runRoutineChange(next); await assert.rejects(runRoutineChange(f.intent({ id: 'sentences', mode: 'complete' })));
});
test('toggle duplicate callback is once-only; participating ABA and unrelated later source changes reject', async t => {
  const f = await fixture(); t.after(f.restore); const action = f.intent({ id: 'kana', mode: 'toggle' });
  await Promise.all([runRoutineChange(action), runRoutineChange(action)]); assert.deepEqual(parsed(f.storage.getItem('dailyRoutineProgress')).completedIds, ['kana']);
  const stale = f.intent({ id: 'words', mode: 'toggle' });
  const before = f.storage.getItem('dailyRoutineProgress')!;
  await updateLanguageRecords(f.context, () => ({ dailyRoutineProgress: '{"date":"2026-10-09","completedIds":["grammar"]}' }));
  await updateLanguageRecords(f.context, () => ({ dailyRoutineProgress: before })); await assert.rejects(runRoutineChange(stale));
  await runRoutineChange(f.intent({ id: 'kana', mode: 'toggle' })); assert.throws(() => reconcileLanguageMutation(action, f.context));
});
for (const target of ['dailyRoutineProgress', 'dailyLearningHistory', 'prepared', 'committed']) test(`daily atomic rollback at ${target}`, async t => {
  const f = await fixture(); t.after(f.restore); const action = f.intent({ id: 'kana', mode: 'complete' }); let failed = false; const set = f.storage.setItem;
  f.storage.setItem = (key, value) => { if (!failed && (key === target || key === STORAGE_PROTOCOL_KEY && value.includes(`"state":"${target}"`))) { failed = true; throw new Error('synthetic quota'); } set(key, value); };
  await assert.rejects(runRoutineChange(action)); assert.equal(f.storage.getItem('dailyRoutineProgress'), null); assert.equal(f.storage.getItem('dailyLearningHistory'), null);
  await runRoutineChange(action); assert.deepEqual(parsed(f.storage.getItem('dailyRoutineProgress')).completedIds, ['kana']);
});
