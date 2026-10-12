import assert from 'node:assert/strict';
import test from 'node:test';
import { languageFixture } from '../../tests/helpers/languageFixture.ts';
import { commitLanguageSyncResponse, readLanguageRecordSnapshot, updateLanguageRecords } from './languageCloudSync.ts';
import { createLanguageMutation } from './languageRecordMutations.ts';
import { planLegacyMutation, runLegacyMutation, verifyLegacyMutation, type LegacyMutationPayload } from './languageLegacyMutations.ts';
import type { LanguageBytes } from './languageStorageBoundary.ts';
import { STORAGE_PROTOCOL_KEY } from './storageTransaction.ts';
const date = '2026-10-09', timestamp = '2026-10-09T12:30:00.000Z';
const word = { word: '猫', meaning: '고양이', category: '일상', example: '猫です。' };
const lesson = { lessonId: 'g1', title: '인사', category: 'です/ます', pattern: 'です' };
async function fixture(seed: LanguageBytes = {}) { const f = languageFixture(), request = await f.request(); const context = (await commitLanguageSyncResponse(request.request, seed)).context; return { ...f, ...request, context, intent(payload: LegacyMutationPayload) { return createLanguageMutation(context, readLanguageRecordSnapshot(context), payload, { date, timestamp }); } }; }
const parsed = (raw: string | null) => JSON.parse(raw ?? '[]');
for (const key of ['savedWords', 'savedSentences'] as const) test(`${key} narrow catalogue toggle retains opaque rows and untouched exact tokens`, async t => {
  const row = key === 'savedWords' ? word : { japanese: '猫です。', meaning: '고양이입니다.', category: '일상' };
  const opaque = '90071992547409931234, {"future":1e999,"future":2}, "\\u3042"';
  const f = await fixture({ [key]: `[${opaque}]` }); t.after(f.restore);
  await runLegacyMutation(f.intent({ kind: 'toggle-saved', key, row })); assert.ok(f.storage.getItem(key)!.includes(opaque));
  await runLegacyMutation(f.intent({ kind: 'toggle-saved', key, row })); assert.ok(f.storage.getItem(key)!.includes(opaque)); assert.equal(parsed(f.storage.getItem(key)).length, 3);
});
test('saved word tuple removal keeps same word in a different meaning/category, deletes all original exact tuple matches', async t => {
  const match = JSON.stringify(word), other = JSON.stringify({ ...word, meaning: '다른 뜻', future: 4 });
  const f = await fixture({ savedWords: `[${match},${other},${match},false]` }); t.after(f.restore);
  await runLegacyMutation(f.intent({ kind: 'toggle-saved', key: 'savedWords', row: word })); assert.equal(f.storage.getItem('savedWords'), `[${other},false]`);
});
for (const key of ['wrongKana', 'wrongWords', 'wrongSentences'] as const) test(`${key} fresh dedupe retains opaque rows and writes original timestamp once`, async t => {
  const row = key === 'wrongKana' ? { char: 'あ', romaji: 'a', type: 'hiragana', mode: 'quiz' } : key === 'wrongWords' ? { ...word, quizType: 'jp-to-kr' } : { japanese: '猫です。', meaning: '고양이', category: '일상', quizType: 'jp-to-kr' };
  const raw = '[1e999,{"future":90071992547409931234,"future":2}]';
  const f = await fixture({ [key]: raw }); t.after(f.restore);
  const a = f.intent({ kind: 'answer', wrong: { key, row } }), b = f.intent({ kind: 'answer', wrong: { key, row } });
  await Promise.all([runLegacyMutation(a), runLegacyMutation(b)]);
  const result = f.storage.getItem(key)!; assert.ok(result.includes(raw.slice(1,-1))); assert.equal(parsed(result).length, 3); assert.equal(parsed(result)[2].createdAt, timestamp);
});
test('wrong queue identities preserve char+mode, word tuple+quiz type and sentence Japanese+quiz type', async t => {
  const f = await fixture(); t.after(f.restore);
  for (const mode of ['quiz', 'confusing']) await runLegacyMutation(f.intent({ kind: 'answer', wrong: { key: 'wrongKana', row: { char: 'あ', mode } } }));
  for (const quizType of ['jp-to-kr', 'kr-to-jp']) await runLegacyMutation(f.intent({ kind: 'answer', wrong: { key: 'wrongSentences', row: { japanese: '猫です。', meaning: quizType, quizType } } }));
  await runLegacyMutation(f.intent({ kind: 'answer', wrong: { key: 'wrongSentences', row: { japanese: '猫です。', meaning: 'changed', quizType: 'jp-to-kr' } } }));
  assert.equal(parsed(f.storage.getItem('wrongKana')).length, 2); assert.equal(parsed(f.storage.getItem('wrongSentences')).length, 2); assert.equal(f.storage.getItem('dailyRoutineProgress'), null);
});
for (const target of ['wrongWords', 'dailyRoutineProgress', 'dailyLearningHistory', 'prepared', 'committed']) test(`wrong answer plus threshold rollback all keys at ${target}`, async t => {
  const f = await fixture({ wrongWords: '[90071992547409931234]' }); t.after(f.restore); const action = f.intent({ kind: 'answer', wrong: { key: 'wrongWords', row: { ...word, quizType: 'jp-to-kr' } }, routine: 'words' }); let failed = false; const set = f.storage.setItem;
  f.storage.setItem = (key, value) => { if (!failed && (key === target || key === STORAGE_PROTOCOL_KEY && value.includes(`"state":"${target}"`))) { failed = true; throw new Error('synthetic quota'); } set(key, value); };
  await assert.rejects(runLegacyMutation(action)); assert.equal(f.storage.getItem('wrongWords'), '[90071992547409931234]'); assert.equal(f.storage.getItem('dailyRoutineProgress'), null); assert.equal(f.storage.getItem('dailyLearningHistory'), null);
  await runLegacyMutation(action); assert.equal(parsed(f.storage.getItem('wrongWords')).length, 2); assert.ok(f.storage.getItem('dailyLearningHistory'));
});
test('grammar exact immediate proof deduplicates, changed same lesson rejects and different lesson coexists', async t => {
  const initial = '{"lessonId":"g1","title":"old","category":"old","pattern":"old","correctCount":2,"wrongCount":1,"future":90071992547409931234,"future":1e999}';
  const f = await fixture({ grammarProgress: `[${initial},null]` }); t.after(f.restore);
  const a = f.intent({ kind: 'grammar-answer', lesson, correct: true }), competing = f.intent({ kind: 'grammar-answer', lesson, correct: false }), other = f.intent({ kind: 'grammar-answer', lesson: { ...lesson, lessonId: 'g2' }, correct: false });
  await runLegacyMutation(a); const once = f.storage.getItem('grammarProgress')!; assert.ok(once.includes('"future":90071992547409931234,"future":1e999')); assert.equal(parsed(once)[0].correctCount, 3);
  assert.deepEqual(planLegacyMutation(readLanguageRecordSnapshot(f.context).records, a).changes, {}); assert.equal(verifyLegacyMutation(readLanguageRecordSnapshot(f.context).records, a).correctCount, 3);
  await assert.rejects(runLegacyMutation(competing)); await runLegacyMutation(other); assert.equal(parsed(f.storage.getItem('grammarProgress')).length, 3);
  await updateLanguageRecords(f.context, fresh => ({ grammarProgress: fresh.grammarProgress!.replace('"title":"인사"', '"title":"changed"') }));
  assert.throws(() => verifyLegacyMutation(readLanguageRecordSnapshot(f.context).records, a));
});
test('grammar same operation with changed payload conflicts, unknown reserved receipt and invalid counter never mark daily', async t => {
  const f = await fixture(); t.after(f.restore); const original = f.intent({ kind: 'grammar-answer', lesson, correct: true }); await runLegacyMutation(original);
  const changed = createLanguageMutation(f.context, original.source, { kind: 'grammar-answer' as const, lesson, correct: false }, { operationId: original.operationId, date, timestamp }); await assert.rejects(runLegacyMutation(changed));
  const before = f.storage.getItem('dailyRoutineProgress');
  await updateLanguageRecords(f.context, () => ({ grammarProgress: '[{"lessonId":"g1","correctCount":"1","wrongCount":0}]' })); await assert.rejects(runLegacyMutation(f.intent({ kind: 'grammar-answer', lesson, correct: true }))); assert.equal(f.storage.getItem('dailyRoutineProgress'), before);
  await updateLanguageRecords(f.context, () => ({ grammarProgress: '[{"lessonId":"g1","correctCount":1,"wrongCount":0,"languageLastOperationV1":{"version":2}}]' })); await assert.rejects(runLegacyMutation(f.intent({ kind: 'grammar-answer', lesson, correct: true })));
});
for (const [key, raw, action] of [
  ['wrongWords', '[{"word":"cat","word":"猫","meaning":"고양이","category":"일상","quizType":"jp-to-kr"}]', { kind: 'answer', wrong: { key: 'wrongWords', row: { ...word, quizType: 'jp-to-kr' } } }],
  ['savedWords', 'null', { kind: 'toggle-saved', key: 'savedWords', row: word }],
  ['grammarProgress', '[{"lessonId":"x","lessonId":"g1","correctCount":1,"wrongCount":0}]', { kind: 'grammar-answer', lesson, correct: true }],
] as const) test(`malformed/duplicate known identity blocks ${key}`, async t => {
  const f = await fixture({ [key]: raw }); t.after(f.restore); await assert.rejects(runLegacyMutation(f.intent(action))); assert.equal(f.storage.getItem(key), raw); assert.equal(f.storage.getItem('dailyRoutineProgress'), null);
});
for (const target of ['grammarProgress', 'dailyRoutineProgress', 'dailyLearningHistory', 'committed']) test(`grammar counter and daily pair rollback at ${target}`, async t => {
  const f = await fixture(); t.after(f.restore); const action = f.intent({ kind: 'grammar-answer', lesson, correct: false }); const set = f.storage.setItem; let failed = false;
  f.storage.setItem = (key, value) => { if (!failed && (key === target || key === STORAGE_PROTOCOL_KEY && value.includes(`"state":"${target}"`))) { failed = true; throw new Error('synthetic quota'); } set(key, value); };
  await assert.rejects(runLegacyMutation(action)); assert.equal(f.storage.getItem('grammarProgress'), null); assert.equal(f.storage.getItem('dailyRoutineProgress'), null);
  await runLegacyMutation(action); assert.equal(parsed(f.storage.getItem('grammarProgress'))[0].wrongCount, 1);
});
for (const extra of [
  '"languageLastOperationV1":{"version":1,"operationId":"old","payload":"old","result":{"lessonId":"g1","correctCount":1,"wrongCount":0},"future":1e999}',
  '"languageLastOperationV1":{"version":1,"operationId":"old","payload":"old","result":{"lessonId":"g1","correctCount":1,"wrongCount":0,"future":9007199254740993123}}',
  '"languageLastOperationV1":{"version":1,"operationId":"old","payload":"old","result":{"lessonId":"g1","correctCount":"1","wrongCount":0}}',
  '"languageLastOperationV1":{"version":1,"version":1,"operationId":"old","payload":"old","result":{"lessonId":"g1","correctCount":1,"wrongCount":0}}',
  '"title":null', '"category":false', '"pattern":{}', '"lastAnsweredAt":"not-a-date"', '"lastResult":"unsupported"',
]) test(`grammar unsupported receipt/metadata blocks entire action: ${extra}`, async t => {
  const raw = `[{"lessonId":"g1","correctCount":1,"wrongCount":0,${extra}}]`;
  const f = await fixture({ grammarProgress: raw }); t.after(f.restore);
  await assert.rejects(runLegacyMutation(f.intent({ kind: 'grammar-answer', lesson, correct: true })));
  assert.equal(f.storage.getItem('grammarProgress'), raw); assert.equal(f.storage.getItem('dailyRoutineProgress'), null); assert.equal(f.storage.getItem('dailyLearningHistory'), null);
});
test('grammar untouched known counter spelling and arbitrary opaque tokens survive answer increment', async t => {
  const f = await fixture({ grammarProgress: '[{"lessonId":"g1","correctCount":2e0,"wrongCount":1e0,"future":90071992547409931234}]' }); t.after(f.restore);
  await runLegacyMutation(f.intent({ kind: 'grammar-answer', lesson, correct: true })); const raw = f.storage.getItem('grammarProgress')!;
  assert.ok(raw.includes('"correctCount":3')); assert.ok(raw.includes('"wrongCount":1e0')); assert.ok(raw.includes('"future":90071992547409931234'));
});
for (const extra of ['', ',"example":null', ',"example":false', ',"example":""', ',"example":{},"future":1e999']) test(`savedWords toggle refuses hidden matching row instead of deleting it: ${extra || 'missing example'}`, async t => {
  const raw = `[{"word":"猫","meaning":"고양이","category":"일상"${extra}},90071992547409931234]`;
  const f = await fixture({ savedWords: raw }); t.after(f.restore);
  await assert.rejects(runLegacyMutation(f.intent({ kind: 'toggle-saved', key: 'savedWords', row: word })));
  assert.equal(f.storage.getItem('savedWords'), raw);
});
test('saved sentence malformed identity stays opaque and is not removed by a catalogue addition', async t => {
  const opaque = '{"japanese":"猫です。","meaning":null,"category":"일상","future":1e999}';
  const f = await fixture({ savedSentences: `[${opaque}]` }); t.after(f.restore);
  await runLegacyMutation(f.intent({ kind: 'toggle-saved', key: 'savedSentences', row: { japanese: '猫です。', meaning: '고양이입니다.', category: '일상' } }));
  assert.ok(f.storage.getItem('savedSentences')!.includes(opaque)); assert.equal(parsed(f.storage.getItem('savedSentences')).length, 2);
});
