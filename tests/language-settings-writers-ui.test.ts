import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { languageWriterFixture } from './helpers/languageWriterFixture.ts';
import { deferred, nodes, textOf, type UiNode } from './helpers/storage-ui-fixture.ts';
import type * as Settings from '../app/data/languageSettingsMutations.ts';
import type { LanguageBytes } from '../app/data/languageStorageBoundary.ts';

async function fixture(t: TestContext, seed: LanguageBytes = {}) {
  const f = await languageWriterFixture(seed); t.after(f.dispose);
  f.tab.setModule('components/YeoniPreferencesPanel.tsx', { default: 'appearance-preferences' });
  f.tab.setModule('app/components/RecordResetPanel.tsx', { default: 'reset-panel' });
  f.tab.setModule('components/language/LearningCompanion.tsx', { default: 'aside' });
  f.tab.setModule('components/language/learning-focus.module.css.ts', { default: {} });
  f.tab.setModule('lucide-react', { Pause: 'pause', Play: 'play' });
  f.tab.setModule('components/useYeoniPreferences.ts', { useYeoniPreferences: () => ({ visible: false, motion: 'off' }), updateYeoniPreferences() {} });
  return f;
}
function change(view: { render(): UiNode }, id: string, value: string) {
  const select = nodes(view.render()).find(node => node.type === 'select' && node.props.id === id); assert.ok(select, id);
  (select.props.onChange as (event: unknown) => void)({ target: { value } }); view.render();
}
function integratedChange(view: { render(): UiNode }, label: string, value: string) {
  const parent = nodes(view.render()).find(node => node.type === 'label' && textOf(node).startsWith(label)); assert.ok(parent, label);
  const select = nodes(parent).find(node => node.type === 'select'); assert.ok(select);
  (select.props.onChange as (event: unknown) => void)({ target: { value } }); view.render();
}
function selected(view: { render(): UiNode }, id: string) { return nodes(view.render()).find(node => node.type === 'select' && node.props.id === id)?.props.value; }

test('W4 shipping settings mount and snapshot refresh perform no writes or legacy normalization', async t => {
  const original = ' {"ttsRate":0.8,"unknown":90071992547409933333} ';
  const f = await fixture(t, { japaneseAppSettings: original, integratedLearningSettingsV1: '{"future":1e999}' });
  const before = f.browser.writes.length;
  const view = f.tab.mount('app/language/settings/page.tsx'); t.after(view.dispose); await view.settle();
  assert.equal(selected(view, 'words-tts-rate'), 0.8); assert.equal(f.browser.writes.length, before);
  f.tab.dispatch({ type: 'storage', key: 'japaneseAppSettings' }); await view.settle();
  assert.equal(f.browser.writes.length, before); assert.equal(f.tab.local.getItem('japaneseAppSettings'), original);
  change(view, 'words-tts-rate', '0.6'); await view.settle();
  assert.ok(f.tab.local.getItem('japaneseAppSettings')!.includes('"unknown":90071992547409933333'));
  assert.deepEqual(JSON.parse(f.tab.local.getItem('japaneseAppSettings')!).sections, { words: { ttsRate: 0.6 } });
});
test('W4 shipping serialized section revision N never clears newer N+1 during a held lock', async t => {
  const f = await fixture(t, { japaneseAppSettings: '{"sections":{"words":{"ttsRate":1}},"u":1e999}' });
  const view = f.tab.mount('app/language/settings/page.tsx'); t.after(view.dispose); await view.settle();
  const release = f.browser.holdLock();
  change(view, 'words-tts-rate', '0.8'); change(view, 'words-tts-rate', '0.6');
  assert.equal(selected(view, 'words-tts-rate'), 0.6);
  assert.equal(JSON.parse(f.tab.local.getItem('japaneseAppSettings')!).sections.words.ttsRate, 1);
  release(); await view.settle(8);
  assert.equal(selected(view, 'words-tts-rate'), 0.6);
  assert.equal(f.tab.local.getItem('japaneseAppSettings'), '{"sections":{"words":{"ttsRate":0.6}},"u":1e999}');
  assert.doesNotMatch(view.text(), /다시 저장|확인이 필요/);
});
test('W4 shipping section lost acknowledgement retains N separately and never renews queued N+1 authority', async t => {
  const f = await fixture(t, { japaneseAppSettings: '{"sections":{"words":{"ttsRate":1}}}' });
  const api = f.tab.loadModule('app/data/languageSettingsMutations.ts') as typeof Settings;
  const committed = deferred<void>(), publication = deferred<void>(); let first = true;
  f.tab.setModule('app/data/languageSettingsMutations.ts', { ...api, async runLanguageSettingsMutation(...args: Parameters<typeof api.runLanguageSettingsMutation>) {
    const result = await api.runLanguageSettingsMutation(...args);
    if (first) { first = false; committed.resolve(); await publication.promise; }
    return result;
  } });
  const view = f.tab.mount('app/language/settings/page.tsx'); t.after(view.dispose); await view.settle();
  change(view, 'words-tts-rate', '0.8'); await committed.promise;
  change(view, 'words-tts-rate', '0.6'); await f.rotate(); view.render(); publication.resolve(); await view.settle();
  assert.equal(selected(view, 'words-tts-rate'), 0.6); assert.match(view.text(), /계정 상태가 바뀌었/);
  const before = f.browser.writes.filter(write => write.key === 'japaneseAppSettings').length;
  view.click('개별 설정 다시 저장'); await view.settle(8);
  assert.equal(JSON.parse(f.tab.local.getItem('japaneseAppSettings')!).sections.words.ttsRate, 0.8);
  assert.equal(f.browser.writes.filter(write => write.key === 'japaneseAppSettings').length, before, 'Reconciliation must not renew queued N+1 authority');
  assert.equal(selected(view, 'words-tts-rate'), 0.6);
  change(view, 'words-tts-rate', '0.6'); await view.settle();
  assert.equal(JSON.parse(f.tab.local.getItem('japaneseAppSettings')!).sections.words.ttsRate, 0.6);
});
test('W4 shipping goal save is atomic on quota failure and retains both edited groups', async t => {
  const goal = '{"dailyGoalCount":5,"u":1e999}', integrated = '{"dailyMinutes":10,"showMeaning":false,"u":90071992547409933333}';
  const f = await fixture(t, { learningSettings: goal, integratedLearningSettingsV1: integrated });
  const view = f.tab.mount('app/language/settings/page.tsx'); t.after(view.dispose); await view.settle();
  view.click('2개'); integratedChange(view, '하루 학습 시간', '20');
  f.browser.rejectNextWrite('integratedLearningSettingsV1'); view.click('학습 설정 저장'); await view.settle();
  assert.equal(f.tab.local.getItem('learningSettings'), goal); assert.equal(f.tab.local.getItem('integratedLearningSettingsV1'), integrated);
  assert.equal(selected(view, 'daily-goal-count'), 2); assert.match(view.text(), /quota/);
  view.click('학습 설정 저장'); await view.settle();
  assert.equal(f.tab.local.getItem('learningSettings'), '{"dailyGoalCount":2,"u":1e999}');
  assert.equal(f.tab.local.getItem('integratedLearningSettingsV1'), '{"dailyMinutes":20,"showMeaning":false,"u":90071992547409933333}');
});
test('W4 shipping goal N acknowledgement cannot clear N+1 entered during saving', async t => {
  const f = await fixture(t, { learningSettings: '{"dailyGoalCount":5}' });
  const view = f.tab.mount('app/language/settings/page.tsx'); t.after(view.dispose); await view.settle();
  view.click('2개'); const release = f.browser.holdLock(); view.click('학습 설정 저장'); view.click('3개');
  release(); await view.settle();
  assert.equal(JSON.parse(f.tab.local.getItem('learningSettings')!).dailyGoalCount, 2);
  assert.equal(selected(view, 'daily-goal-count'), 3); assert.match(view.text(), /새로 바꾼 설정은 다시 저장/);
  view.click('학습 설정 저장'); await view.settle();
  assert.equal(JSON.parse(f.tab.local.getItem('learningSettings')!).dailyGoalCount, 3);
});
test('W4 shipping dirty goal retains its source through refresh and refuses competing goal change', async t => {
  const f = await fixture(t, { learningSettings: '{"dailyGoalCount":5,"u":1e999}' });
  const view = f.tab.mount('app/language/settings/page.tsx'); t.after(view.dispose); await view.settle();
  view.click('2개');
  await f.language.updateLanguageRecords(f.context, () => ({ learningSettings: '{"dailyGoalCount":4,"u":1e999}' })); await view.settle();
  assert.equal(selected(view, 'daily-goal-count'), 2);
  view.click('학습 설정 저장'); await view.settle();
  assert.equal(f.tab.local.getItem('learningSettings'), '{"dailyGoalCount":4,"u":1e999}'); assert.equal(selected(view, 'daily-goal-count'), 2);
  assert.doesNotMatch(view.text(), /설정이 저장됐어요/);
});
test('W4 shipping welcome waits for settings commit before navigating', async t => {
  const f = await fixture(t, { integratedLearningSettingsV1: '{"future":90071992547409933333}' });
  const view = f.tab.mount('components/language/LearningWelcome.tsx'); t.after(view.dispose); await view.settle();
  const release = f.browser.holdLock(); view.click('글자를 처음 배워요あ・い・う・え・お부터 함께');
  assert.deepEqual(f.routes, []); assert.match(view.text(), /저장하고/); release(); await view.settle();
  assert.deepEqual(f.routes, ['/language/start']); assert.ok(f.tab.local.getItem('integratedLearningSettingsV1')!.includes('"future":90071992547409933333'));
});
test('W4 shipping welcome failure keeps choice and does not navigate until explicit successful retry', async t => {
  const f = await fixture(t); const view = f.tab.mount('components/language/LearningWelcome.tsx'); t.after(view.dispose); await view.settle();
  f.browser.rejectNextWrite('integratedLearningSettingsV1'); view.click('조금 읽을 수 있어요짧은 표현과 대화부터'); await view.settle();
  assert.deepEqual(f.routes, []); view.button('선택 다시 저장');
  view.click('선택 다시 저장'); await view.settle();
  assert.equal(f.routes.length, 1); assert.match(f.routes[0], /^\/language\/learn\?lesson=/);
});
test('W4 shipping welcome retires navigation on pause after durable save and reconciles only on explicit retry', async t => {
  const f = await fixture(t);
  const api = f.tab.loadModule('app/data/languageSettingsMutations.ts') as typeof Settings;
  const committed = deferred<void>(), publication = deferred<void>(); let first = true;
  f.tab.setModule('app/data/languageSettingsMutations.ts', { ...api, async runLanguageSettingsMutation(...args: Parameters<typeof api.runLanguageSettingsMutation>) {
    const result = await api.runLanguageSettingsMutation(...args); if (first) { first = false; committed.resolve(); await publication.promise; } return result;
  } });
  const view = f.tab.mount('components/language/LearningWelcome.tsx'); t.after(view.dispose); await view.settle();
  view.click('조금 읽을 수 있어요짧은 표현과 대화부터'); await committed.promise; f.pause(); view.render(); publication.resolve(); await view.settle();
  assert.deepEqual(f.routes, []); const raw = f.tab.local.getItem('integratedLearningSettingsV1');
  await f.resume(); await view.settle(); assert.deepEqual(f.routes, []);
  view.click('선택 다시 저장'); await view.settle(); assert.equal(f.routes.length, 1); assert.equal(f.tab.local.getItem('integratedLearningSettingsV1'), raw);
});
test('W4 shipping settings reset respects cancellation, preserves goal draft/unknowns, and cancels failed older autosave', async t => {
  const f = await fixture(t, { japaneseAppSettings: '{"sections":{"words":{"ttsRate":0.8,"u":1e999}}}', integratedLearningSettingsV1: '{"dailyMinutes":20,"u":90071992547409933333}', learningSettings: '{"dailyGoalCount":4,"u":"\\u0041"}' });
  const view = f.tab.mount('app/language/settings/page.tsx'); t.after(view.dispose); await view.settle();
  const before = f.browser.writes.length; view.click('학습 설정만 기본값으로'); await view.settle(); assert.equal(f.browser.writes.length, before);
  view.click('2개'); f.browser.rejectNextLock(); change(view, 'words-tts-rate', '0.6'); await view.settle();
  view.button('개별 설정 다시 저장'); f.tab.setConfirm(true); view.click('학습 설정만 기본값으로'); await view.settle();
  assert.equal(selected(view, 'words-tts-rate'), 1); assert.equal(selected(view, 'daily-goal-count'), 2);
  assert.equal(f.tab.local.getItem('learningSettings'), '{"dailyGoalCount":4,"u":"\\u0041"}');
  assert.ok(f.tab.local.getItem('japaneseAppSettings')!.includes('"u":1e999')); assert.ok(f.tab.local.getItem('integratedLearningSettingsV1')!.includes('"u":90071992547409933333'));
  assert.doesNotMatch(view.text(), /개별 설정 다시 저장/);
  view.click('학습 설정 저장'); await view.settle(); assert.equal(JSON.parse(f.tab.local.getItem('learningSettings')!).dailyGoalCount, 2);
});
test('W4 shipping undispatched dirty goal keeps its proof across harmless acknowledgement rotation', async t => {
  const f = await fixture(t, { learningSettings: '{"dailyGoalCount":5}' });
  const view = f.tab.mount('app/language/settings/page.tsx'); t.after(view.dispose); await view.settle();
  view.click('2개'); await f.rotate(); await view.settle(); assert.equal(selected(view, 'daily-goal-count'), 2);
  view.click('학습 설정 저장'); await view.settle(); assert.equal(JSON.parse(f.tab.local.getItem('learningSettings')!).dailyGoalCount, 2);
});
test('W4 shipping goal retains an unacknowledged N while N+1 awaits a separate save', async t => {
  const f = await fixture(t, { learningSettings: '{"dailyGoalCount":5}' });
  const api = f.tab.loadModule('app/data/languageSettingsMutations.ts') as typeof Settings;
  const committed = deferred<void>(), publication = deferred<void>(); let first = true;
  f.tab.setModule('app/data/languageSettingsMutations.ts', { ...api, async runLanguageSettingsMutation(...args: Parameters<typeof api.runLanguageSettingsMutation>) {
    const result = await api.runLanguageSettingsMutation(...args); if (first) { first = false; committed.resolve(); await publication.promise; } return result;
  } });
  const view = f.tab.mount('app/language/settings/page.tsx'); t.after(view.dispose); await view.settle();
  view.click('2개'); view.click('학습 설정 저장'); await committed.promise; view.click('3개'); await f.rotate(); view.render(); publication.resolve(); await view.settle();
  assert.equal(selected(view, 'daily-goal-count'), 3); const before = f.browser.writes.length;
  view.click('학습 설정 저장'); await view.settle(); assert.equal(f.browser.writes.length, before, 'First retry only reconciles N');
  assert.equal(selected(view, 'daily-goal-count'), 3); assert.match(view.text(), /새로 바꾼 설정은 다시 저장/);
  view.click('학습 설정 저장'); await view.settle(); assert.equal(JSON.parse(f.tab.local.getItem('learningSettings')!).dailyGoalCount, 3);
});
for (const target of ['section', 'goal', 'welcome', 'reset'] as const) test(`W4 shipping ${target} precommit retirement retains its envelope until explicit source-proved NEW save`, async t => {
  const f = await fixture(t, { japaneseAppSettings: '{"sections":{"words":{"ttsRate":1}}}', integratedLearningSettingsV1: '{"dailyMinutes":20}', learningSettings: '{"dailyGoalCount":5}' });
  const api = f.tab.loadModule('app/data/languageSettingsMutations.ts') as typeof Settings;
  const dispatch = deferred<void>(), release = deferred<void>(); let first = true;
  const intents: Settings.LanguageSettingsMutation[] = [];
  f.tab.setModule('app/data/languageSettingsMutations.ts', { ...api, async runLanguageSettingsMutation(...args: Parameters<typeof api.runLanguageSettingsMutation>) {
    intents.push(args[0]); if (first) { first = false; dispatch.resolve(); await release.promise; } return api.runLanguageSettingsMutation(...args);
  } });
  const view = f.tab.mount(target === 'welcome' ? 'components/language/LearningWelcome.tsx' : 'app/language/settings/page.tsx'); t.after(view.dispose); await view.settle();
  if (target === 'section') change(view, 'words-tts-rate', '0.8');
  else if (target === 'goal') { view.click('2개'); view.click('학습 설정 저장'); }
  else if (target === 'welcome') view.click('5분');
  else { f.tab.setConfirm(true); view.click('학습 설정만 기본값으로'); }
  await dispatch.promise; f.pause(); view.render(); await f.resume(); view.render();
  const before = f.browser.writes.length; release.resolve(); await view.settle();
  assert.equal(f.browser.writes.length, before, 'Retired captured action must not dispatch under resumed authority');
  assert.equal(intents.length, 1);
  const originalContext = intents[0].context, originalId = intents[0].operationId;
  const label = target === 'section' ? '현재 연결에서 개별 설정 새로 저장' : target === 'goal' ? '현재 연결에서 학습 설정 새로 저장' : target === 'welcome' ? '현재 연결에서 선택 새로 저장' : '현재 연결에서 초기화 새로 요청';
  view.click(label); await view.settle();
  assert.equal(intents.length, 2); assert.notEqual(intents[1].operationId, originalId); assert.equal(intents[0].context, originalContext); assert.notEqual(intents[1].context, originalContext);
  if (target === 'section') assert.equal(JSON.parse(f.tab.local.getItem('japaneseAppSettings')!).sections.words.ttsRate, 0.8);
  else if (target === 'goal') assert.equal(JSON.parse(f.tab.local.getItem('learningSettings')!).dailyGoalCount, 2);
  else assert.equal(JSON.parse(f.tab.local.getItem('integratedLearningSettingsV1')!).dailyMinutes, target === 'welcome' ? 5 : 10);
});
test('W4 shipping explicit NEW save cannot bless a competing changed source', async t => {
  const f = await fixture(t, { learningSettings: '{"dailyGoalCount":5,"u":1e999}' });
  const view = f.tab.mount('app/language/settings/page.tsx'); t.after(view.dispose); await view.settle();
  view.click('2개'); f.browser.rejectNextLock(); view.click('학습 설정 저장'); await view.settle();
  await f.language.updateLanguageRecords(f.context, () => ({ learningSettings: '{"dailyGoalCount":4,"u":1e999}' })); await f.rotate(); await view.settle();
  view.click('현재 연결에서 학습 설정 새로 저장'); await view.settle();
  assert.equal(f.tab.local.getItem('learningSettings'), '{"dailyGoalCount":4,"u":1e999}'); assert.equal(selected(view, 'daily-goal-count'), 2);
  assert.doesNotMatch(view.text(), /설정이 저장됐어요/);
});
for (const source of ['japaneseCurriculumProgressV1', 'japaneseCurriculumReviewV1'] as const) test(`W4 shipping welcome displays unreadable ${source} warning without writes`, async t => {
  const f = await fixture(t, { [source]: '{broken' }); const before = f.browser.writes.length;
  const view = f.tab.mount('components/language/LearningWelcome.tsx'); t.after(view.dispose); await view.settle();
  assert.match(view.text(), /일부 학습 기록을 읽지 못했어요/); assert.equal(f.browser.writes.length, before); assert.equal(f.tab.local.getItem(source), '{broken');
});
