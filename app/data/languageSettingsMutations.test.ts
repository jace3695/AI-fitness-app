import assert from 'node:assert/strict';
import test from 'node:test';
import { commitLanguageSyncResponse, readLanguageRecordSnapshot } from './languageCloudSync.ts';
import { updateStorageBatch } from './storageTransaction.ts';
import { languageFixture } from '../../tests/helpers/languageFixture.ts';
import { DEFAULT_INTEGRATED_LEARNING_SETTINGS, loadIntegratedLearningSettings } from '../../utils/integratedLearningSettings.ts';
import { advanceLanguageSettingsDraftSource, createLearningSettingsMutation, createResetLanguageSettingsMutation, createSectionSettingMutation, loadJapaneseAppSettings, runLanguageSettingsMutation } from './languageSettingsMutations.ts';

async function fixture(seed: Record<string, string> = {}) {
  const f = languageFixture(); const { request } = await f.request();
  const { context } = await commitLanguageSyncResponse(request, seed);
  return { ...f, context, snapshot: () => readLanguageRecordSnapshot(context) };
}
test('W4 deliberate legacy field patch preserves exact unknown tokens and all untouched settings', async t => {
  const raw = ' { "ttsRate":0.8, "unknown":900719925474099312345, "unknown":"\\u0041", "sections":{"future":{"v":1e999}} } ';
  const f = await fixture({ japaneseAppSettings: raw, integratedLearningSettingsV1: '{"future":1e999}' }); t.after(f.restore);
  const intent = createSectionSettingMutation(f.context, f.snapshot(), 'words', 'ttsRate', 0.6);
  const result = await runLanguageSettingsMutation(intent); assert.equal(result.acknowledged, true);
  const saved = f.storage.getItem('japaneseAppSettings')!;
  assert.ok(saved.includes('"unknown":900719925474099312345, "unknown":"\\u0041"'));
  assert.ok(saved.includes('"future":{"v":1e999}')); assert.ok(saved.includes('"ttsRate":0.8'));
  assert.equal(JSON.parse(saved).sections.words.ttsRate, 0.6);
  assert.equal(f.storage.getItem('integratedLearningSettingsV1'), '{"future":1e999}');
});
test('W4 unrelated field edits merge, same-field edits and legacy dependencies conflict', async t => {
  const f = await fixture({ japaneseAppSettings: '{"ttsRate":1,"sections":{"words":{"repeatCount":1}}}' }); t.after(f.restore);
  const source = f.snapshot();
  const rate = createSectionSettingMutation(f.context, source, 'words', 'ttsRate', 0.8);
  const repeats = createSectionSettingMutation(f.context, source, 'words', 'repeatCount', 2);
  await runLanguageSettingsMutation(rate); await runLanguageSettingsMutation(repeats);
  await assert.rejects(runLanguageSettingsMutation(createSectionSettingMutation(f.context, source, 'words', 'ttsRate', 0.9)));
  const current = f.snapshot(), stale = createSectionSettingMutation(f.context, current, 'speaking', 'ttsRate', 0.6);
  await updateStorageBatch(f.storage, () => ({ japaneseAppSettings: f.storage.getItem('japaneseAppSettings')!.replace('"ttsRate":1', '"ttsRate":0.7') }));
  await assert.rejects(runLanguageSettingsMutation(stale));
});
test('W4 defaults projection and semantic no-op preserve complete absence', async t => {
  const f = await fixture(); t.after(f.restore);
  assert.equal(loadIntegratedLearningSettings().dailyMinutes, 10);
  assert.equal(loadJapaneseAppSettings().sections.words.ttsRate, 1);
  await runLanguageSettingsMutation(createSectionSettingMutation(f.context, f.snapshot(), 'words', 'ttsRate', 1));
  await runLanguageSettingsMutation(createLearningSettingsMutation(f.context, f.snapshot(), { dailyGoalCount: 5, integrated: { dailyMinutes: 10 } }));
  assert.equal(f.storage.getItem('japaneseAppSettings'), null); assert.equal(f.storage.getItem('learningSettings'), null); assert.equal(f.storage.getItem('integratedLearningSettingsV1'), null);
});
test('W4 fallback display copies cannot mutate defaults', () => {
  const first = loadJapaneseAppSettings('{bad'); first.sections.words.ttsRate = 0.5;
  assert.equal(loadJapaneseAppSettings('{bad').sections.words.ttsRate, 1);
  assert.deepEqual(loadIntegratedLearningSettings('null'), DEFAULT_INTEGRATED_LEARNING_SETTINGS);
});
for (const raw of ['null', '[]', '{broken', '{"sections":null}', '{"sections":{"words":{"ttsRate":null}}}', '{"sections":{"words":{"ttsRate":1,"ttsRate":0.8}}}', '{"ttsRate":1,"ttsRate":0.8}', '{"sections":{},"sections":{}}']) test(`W4 malformed/duplicate touched settings block exactly: ${raw}`, async t => {
  const f = await fixture({ japaneseAppSettings: raw }); t.after(f.restore);
  await assert.rejects(runLanguageSettingsMutation(createSectionSettingMutation(f.context, f.snapshot(), 'words', 'ttsRate', 0.6)));
  assert.equal(f.storage.getItem('japaneseAppSettings'), raw);
});
test('W4 learning save patches only deliberate integrated fields, preserving unrelated opaque tokens', async t => {
  const f = await fixture({ learningSettings: '{"dailyGoalCount":5,"future":90071992547409933333}', integratedLearningSettingsV1: '{"dailyMinutes":10,"showMeaning":false,"unknown":"\\u0041"}' }); t.after(f.restore);
  await runLanguageSettingsMutation(createLearningSettingsMutation(f.context, f.snapshot(), { dailyGoalCount: 3, integrated: { dailyMinutes: 20 } }));
  assert.equal(f.storage.getItem('learningSettings'), '{"dailyGoalCount":3,"future":90071992547409933333}');
  assert.equal(f.storage.getItem('integratedLearningSettingsV1'), '{"dailyMinutes":20,"showMeaning":false,"unknown":"\\u0041"}');
});
test('W4 two-key settings save quota failure restores both exact before images and retry reuses intent', async t => {
  const goal = '{"dailyGoalCount":5,"u":1e999}', integrated = '{"dailyMinutes":10,"u":"\\u0042"}';
  const f = await fixture({ learningSettings: goal, integratedLearningSettingsV1: integrated }); t.after(f.restore);
  const intent = createLearningSettingsMutation(f.context, f.snapshot(), { dailyGoalCount: 2, integrated: { dailyMinutes: 20 } });
  const set = f.storage.setItem; let fail = true;
  f.storage.setItem = (key, value) => { if (key === 'integratedLearningSettingsV1' && fail) { fail = false; throw new Error('synthetic quota'); } set(key, value); };
  await assert.rejects(runLanguageSettingsMutation(intent));
  assert.equal(f.storage.getItem('learningSettings'), goal); assert.equal(f.storage.getItem('integratedLearningSettingsV1'), integrated);
  await runLanguageSettingsMutation(intent); assert.equal(JSON.parse(f.storage.getItem('learningSettings')!).dailyGoalCount, 2);
});
test('W4 invalid second settings root cannot partially save the first key', async t => {
  const f = await fixture({ learningSettings: '{"dailyGoalCount":4}', integratedLearningSettingsV1: 'null' }); t.after(f.restore);
  await assert.rejects(runLanguageSettingsMutation(createLearningSettingsMutation(f.context, f.snapshot(), { dailyGoalCount: 2 })));
  assert.equal(f.storage.getItem('learningSettings'), '{"dailyGoalCount":4}'); assert.equal(f.storage.getItem('integratedLearningSettingsV1'), 'null');
});
test('W4 reset patches known fields only, preserving unknown members, goal and independent appearance', async t => {
  const f = await fixture({ japaneseAppSettings: '{"ttsRate":0.5,"sections":{"words":{"ttsRate":0.8,"u":90071992547409933333},"future":{"x":1e999}},"u":"\\u0041"}', integratedLearningSettingsV1: '{"dailyMinutes":20,"showMeaning":false,"u":1e999}', learningSettings: ' {"dailyGoalCount":2,"u":1e999} ' }); t.after(f.restore);
  f.storage.setItem('yeoniAppearanceSettingsV1', ' {"visible":false} ');
  await runLanguageSettingsMutation(createResetLanguageSettingsMutation(f.context, f.snapshot()));
  const saved = f.storage.getItem('japaneseAppSettings')!;
  assert.ok(saved.includes('"u":90071992547409933333')); assert.ok(saved.includes('"future":{"x":1e999}')); assert.ok(saved.includes('"u":"\\u0041"'));
  assert.equal(loadJapaneseAppSettings(saved).sections.words.ttsRate, 1);
  assert.equal(f.storage.getItem('learningSettings'), ' {"dailyGoalCount":2,"u":1e999} '); assert.equal(f.storage.getItem('yeoniAppearanceSettingsV1'), ' {"visible":false} ');
  assert.ok(f.storage.getItem('integratedLearningSettingsV1')!.includes('"u":1e999'));
});
test('W4 undispatched revision can advance over own exact acknowledged patch, never over competing changes', async t => {
  const f = await fixture({ learningSettings: '{"dailyGoalCount":5}', integratedLearningSettingsV1: '{"dailyMinutes":10}' }); t.after(f.restore);
  const source = f.snapshot(), first = createLearningSettingsMutation(f.context, source, { integrated: { dailyMinutes: 5 } });
  const result = await runLanguageSettingsMutation(first);
  const advanced = advanceLanguageSettingsDraftSource(source, { kind: 'learning', patch: { integrated: { dailyMinutes: 20 } } }, first, result);
  await runLanguageSettingsMutation(createLearningSettingsMutation(f.context, advanced, { integrated: { dailyMinutes: 20 } }));
  assert.equal(f.storage.getItem('integratedLearningSettingsV1'), '{"dailyMinutes":20}');
});
