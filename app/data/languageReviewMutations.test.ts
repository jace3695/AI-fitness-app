import assert from 'node:assert/strict';
import test from 'node:test';
import { languageFixture } from '../../tests/helpers/languageFixture.ts';
import { commitLanguageSyncResponse, readLanguageRecordSnapshot, readLanguageSyncRequest } from './languageCloudSync.ts';
import { captureLanguageRows } from './languageRecordIdentity.ts';
import { createLanguageMutation } from './languageRecordMutations.ts';
import { updateStorageBatch } from './storageTransaction.ts';
import { planReviewMutation, runReviewMutation, projectReviewedItems, type ReviewMutationPayload } from './languageReviewMutations.ts';
const date = '2026-10-10', timestamp = '2026-10-10T12:00:00.000Z';
const row = '{"id":"f01:0","lessonId":"f01","lessonTitle":"기초","prompt":"문제","explanation":"설명","createdAt":"2026-10-01T00:00:00.000Z","wrongCount":1,"intervalDays":1,"u":90071992547409933333,"u":"\\u0041"}';
async function fixture(seed: Record<string, string> = {}) {
  const f = languageFixture(); const { request, lease, lifecycle } = await f.request(); const { context } = await commitLanguageSyncResponse(request, seed);
  const snapshot = () => readLanguageRecordSnapshot(context);
  return { ...f, lease, lifecycle, context, snapshot, action(payload: ReviewMutationPayload, source = snapshot()) { return createLanguageMutation(context, source, payload, { timestamp, date }); } };
}
test('W3 reviewed date union preserves duplicates/opaque tokens and atomically completes the threshold daily pair', async t => {
  const raw = `[{"date":"${date}","items":["a",90071992547409933333],"u":"\\u0041"},{"date":"${date}","items":["b"]},{"unknown":1e999}]`;
  const f = await fixture({ reviewCompletedItemsByDate: raw }); t.after(f.restore);
  await runReviewMutation(f.action({ kind: 'reviewed', itemId: 'c' }));
  assert.deepEqual(projectReviewedItems(f.storage.getItem('reviewCompletedItemsByDate'), date).items, ['a', 'c', 'b']);
  const saved = f.storage.getItem('reviewCompletedItemsByDate')!; assert.ok(saved.includes('90071992547409933333')); assert.ok(saved.includes('"u":"\\u0041"')); assert.ok(saved.includes('{"unknown":1e999}'));
  assert.deepEqual(JSON.parse(f.storage.getItem('dailyRoutineProgress')!).completedIds, ['review']);
  assert.deepEqual(JSON.parse(f.storage.getItem('dailyLearningHistory')!)[date].completedIds, ['review']);
});
test('W3 mount replay is no-op below threshold, restores an unchecked daily pair above threshold, then is idempotent', async t => {
  const f = await fixture({ reviewCompletedItemsByDate: `[{"date":"${date}","items":["a","b"]}]` }); t.after(f.restore);
  const low = f.action({ kind: 'reconcile-completion' }); assert.deepEqual(planReviewMutation(f.snapshot().records, low).changes, {});
  await updateStorageBatch(f.storage, () => ({ reviewCompletedItemsByDate: `[{"date":"${date}","items":["a","b","c"]}]` }));
  await runReviewMutation(f.action({ kind: 'reconcile-completion' }));
  const again = f.action({ kind: 'reconcile-completion' }); assert.deepEqual(planReviewMutation(f.snapshot().records, again).changes, {});
  await updateStorageBatch(f.storage, () => ({ dailyRoutineProgress: `{"date":"${date}","completedIds":[]}`, dailyLearningHistory: `{"${date}":{"completedIds":[],"completedCount":0,"totalCount":5}}` }));
  await runReviewMutation(f.action({ kind: 'reconcile-completion' })); assert.deepEqual(JSON.parse(f.storage.getItem('dailyRoutineProgress')!).completedIds, ['review']);
});
for (const target of ['japaneseCurriculumReviewV1', 'reviewCompletedItemsByDate', 'dailyRoutineProgress', 'dailyLearningHistory']) test(`W3 course schedule four-key rollback on ${target}`, async t => {
  const source = `[${row}]`, dates = `[{"date":"${date}","items":["a","b"]}]`;
  const f = await fixture({ japaneseCurriculumReviewV1: source, reviewCompletedItemsByDate: dates }); t.after(f.restore);
  const snap = f.snapshot(), handle = captureLanguageRows(snap, 'japaneseCurriculumReviewV1')[0].handle;
  const intent = f.action({ kind: 'schedule', handle, correct: true, neededHelp: false, hadWrong: false, observation: { modality: 'meaning', neededHelp: false, responseMs: 1000 }, response: 'answer' }, snap);
  const set = f.storage.setItem; let fail = true;
  f.storage.setItem = (key, value) => { if (key === target && fail) { fail = false; throw new Error('synthetic quota'); } set(key, value); };
  await assert.rejects(runReviewMutation(intent));
  assert.equal(f.storage.getItem('japaneseCurriculumReviewV1'), source); assert.equal(f.storage.getItem('reviewCompletedItemsByDate'), dates); assert.equal(f.storage.getItem('dailyRoutineProgress'), null); assert.equal(f.storage.getItem('dailyLearningHistory'), null);
  await runReviewMutation(intent); assert.equal(JSON.parse(f.storage.getItem('japaneseCurriculumReviewV1')!)[0].intervalDays, 3);
});
test('W3 schedule preserves opaque row tokens, immediate receipt verifies exact after-row, later changed row rejects bounded retry', async t => {
  const f = await fixture({ japaneseCurriculumReviewV1: `[${row},{"opaque":1e999}]` }); t.after(f.restore);
  const snap = f.snapshot(), handle = captureLanguageRows(snap, 'japaneseCurriculumReviewV1')[0].handle;
  const intent = f.action({ kind: 'schedule', handle, correct: true, neededHelp: true, hadWrong: true, observation: { neededHelp: false, modality: 'typing', responseMs: 34000 }, response: '私' }, snap);
  await runReviewMutation(intent); const saved = f.storage.getItem('japaneseCurriculumReviewV1')!;
  assert.ok(saved.includes('"u":90071992547409933333,"u":"\\u0041"')); assert.ok(saved.includes('{"opaque":1e999}'));
  const parsed = JSON.parse(saved)[0]; assert.equal(parsed.intervalDays, 1); assert.equal(parsed.wrongCount, 2); assert.equal(parsed.lastNeededHelp, true);
  assert.equal(planReviewMutation(f.snapshot().records, intent).alreadyApplied, true);
  const request = readLanguageSyncRequest(f.lease, f.lifecycle, f.storage), context = (await commitLanguageSyncResponse(request, request.local)).context;
  assert.equal((await runReviewMutation(intent, context)).status, 'already-applied');
  await updateStorageBatch(f.storage, () => ({ japaneseCurriculumReviewV1: saved.replace('"wrongCount":2', '"wrongCount":3') }));
  await assert.rejects(async () => runReviewMutation(intent, context));
});
test('W3 deferred course review never creates reviewed dates or daily completion', async t => {
  const f = await fixture({ japaneseCurriculumReviewV1: `[${row}]` }); t.after(f.restore);
  const snap = f.snapshot(), handle = captureLanguageRows(snap, 'japaneseCurriculumReviewV1')[0].handle;
  await runReviewMutation(f.action({ kind: 'schedule', handle, correct: false, neededHelp: true, hadWrong: false }, snap));
  for (const key of ['reviewCompletedItemsByDate', 'dailyRoutineProgress', 'dailyLearningHistory']) assert.equal(f.storage.getItem(key), null);
});
for (const bad of ['"wrongCount":null', '"nextReviewAt":false', '"lastWrongAt":"bad"', '"lastModality":"future"', '"lastResponseMs":-1', '"lastNeededHelp":3', '"reviewCount":1.5', '"successStreak":1,"successStreak":2', '"languageLastOperationV1":{"version":2}']) test(`W3 schedule blocks unsupported touched metadata ${bad}`, async t => {
  const original = `[${row.replace('"wrongCount":1,', '') .slice(0, -1)},${bad}}]`;
  const f = await fixture({ japaneseCurriculumReviewV1: original }); t.after(f.restore); const snap = f.snapshot();
  const handle = captureLanguageRows(snap, 'japaneseCurriculumReviewV1')[0].handle;
  await assert.rejects(runReviewMutation(f.action({ kind: 'schedule', handle, correct: true, neededHelp: false, hadWrong: true, observation: { modality: 'meaning', neededHelp: false } }, snap)));
  assert.equal(f.storage.getItem('japaneseCurriculumReviewV1'), original);
});
test('W3 supported broad saved group deletion preserves unrelated opaque rows and rejects hidden matching rows', async t => {
  const visible = '{"word":"猫","meaning":"고양이","category":"일상","example":"猫です"}';
  const f = await fixture({ savedWords: `[${visible},{"word":"犬","meaning":"개","category":"일상","example":"犬です","u":1e999},${visible}]` }); t.after(f.restore);
  let snap = f.snapshot(), handle = captureLanguageRows(snap, 'savedWords')[0].handle;
  await runReviewMutation(f.action({ kind: 'delete-group', key: 'savedWords', handle }, snap)); assert.equal(f.storage.getItem('savedWords'), '[{"word":"犬","meaning":"개","category":"일상","example":"犬です","u":1e999}]');
  const hidden = `[${visible},{"word":"猫","meaning":"숨김","category":"일상"}]`;
  await updateStorageBatch(f.storage, () => ({ savedWords: hidden })); snap = f.snapshot(); handle = captureLanguageRows(snap, 'savedWords')[0].handle;
  await assert.rejects(runReviewMutation(f.action({ kind: 'delete-group', key: 'savedWords', handle }, snap))); assert.equal(f.storage.getItem('savedWords'), hidden);
});
test('W3 wrong-kana cleanup preserves repeated chars until last row and removes only matching legacy strings atomically', async t => {
  const f = await fixture({ wrongKana: '["あ",{"char":"あ","romaji":"a","u":1e999}]', wrongKanaChars: '["あ",{"char":"あ","u":1e999},"い","あ"]' }); t.after(f.restore);
  let snap = f.snapshot(), handle = captureLanguageRows(snap, 'wrongKana')[0].handle;
  await runReviewMutation(f.action({ kind: 'delete-row', key: 'wrongKana', handle, cleanupKana: true }, snap)); assert.equal(f.storage.getItem('wrongKanaChars'), '["あ",{"char":"あ","u":1e999},"い","あ"]');
  snap = f.snapshot(); handle = captureLanguageRows(snap, 'wrongKana')[0].handle;
  await runReviewMutation(f.action({ kind: 'delete-row', key: 'wrongKana', handle, cleanupKana: true }, snap)); assert.equal(f.storage.getItem('wrongKanaChars'), '[{"char":"あ","u":1e999},"い"]');
});
test('W3 direct legacy-character and progress occurrence deletion remove exactly the captured duplicate', async t => {
  const f = await fixture({ wrongKanaChars: '["あ",{"u":1e999},"あ"]', wrongWords: '[{"word":"猫","meaning":"a"},{"word":"猫","meaning":"a"},{"opaque":1e999}]' }); t.after(f.restore);
  let snap = f.snapshot(), handle = captureLanguageRows(snap, 'wrongKanaChars')[2].handle;
  await runReviewMutation(f.action({ kind: 'delete-row', key: 'wrongKanaChars', handle }, snap)); assert.equal(f.storage.getItem('wrongKanaChars'), '["あ",{"u":1e999}]');
  snap = f.snapshot(); handle = captureLanguageRows(snap, 'wrongWords')[1].handle;
  await runReviewMutation(f.action({ kind: 'delete-row', key: 'wrongWords', handle }, snap)); assert.equal(f.storage.getItem('wrongWords'), '[{"word":"猫","meaning":"a"},{"opaque":1e999}]');
});
test('W3 key-mismatched handle, concurrent array changes and duplicate course IDs reject without writes', async t => {
  const f = await fixture({ wrongKana: '["あ"]', wrongWords: '["x"]', japaneseCurriculumReviewV1: `[${row},${row}]` }); t.after(f.restore);
  let snap = f.snapshot(), handle = captureLanguageRows(snap, 'wrongKana')[0].handle;
  await assert.rejects(runReviewMutation(f.action({ kind: 'delete-row', key: 'wrongWords', handle }, snap)));
  const stale = f.action({ kind: 'delete-row', key: 'wrongKana', handle }, snap); await updateStorageBatch(f.storage, () => ({ wrongKana: '["あ","い"]' })); await assert.rejects(runReviewMutation(stale));
  snap = f.snapshot(); handle = captureLanguageRows(snap, 'japaneseCurriculumReviewV1')[0].handle;
  await assert.rejects(runReviewMutation(f.action({ kind: 'schedule', handle, correct: false, neededHelp: true, hadWrong: false }, snap)));
});
test('W3 whole-section clear blocks hidden rows and generation ABA, preserves legacy chars', async t => {
  const f = await fixture({ wrongKana: '["あ",{"opaque":1e999}]', wrongKanaChars: '["あ"]' }); t.after(f.restore);
  await assert.rejects(runReviewMutation(f.action({ kind: 'clear-progress', key: 'wrongKana' })));
  await updateStorageBatch(f.storage, () => ({ wrongKana: '["あ"]' }));
  const stale = f.action({ kind: 'clear-progress', key: 'wrongKana' });
  await updateStorageBatch(f.storage, () => ({ wrongKana: '["い"]' })); await updateStorageBatch(f.storage, () => ({ wrongKana: '["あ"]' })); await assert.rejects(runReviewMutation(stale));
  await runReviewMutation(f.action({ kind: 'clear-progress', key: 'wrongKana' })); assert.equal(f.storage.getItem('wrongKana'), null); assert.equal(f.storage.getItem('wrongKanaChars'), '["あ"]');
});
