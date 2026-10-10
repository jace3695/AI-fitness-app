import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { languageWriterFixture } from './helpers/languageWriterFixture.ts';
import { deferred, nodes, textOf, type UiNode } from './helpers/storage-ui-fixture.ts';
import type { LanguageBytes } from '../app/data/languageStorageBoundary.ts';
import type * as Mutations from '../app/data/languageRecordMutations.ts';
const course = { id: 'f01:0', lessonId: 'f01', lessonTitle: '합성 수업', prompt: '합성 문제', explanation: '설명', createdAt: '2026-10-01T00:00:00.000Z', wrongCount: 1, intervalDays: 1 };
const savedWord = { word: '猫', meaning: '고양이', category: '일상', example: '猫です' };
function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
async function fixture(t: TestContext, seed: LanguageBytes = {}) {
  const f = await languageWriterFixture(seed); t.after(f.dispose);
  f.tab.setModule('data/grammar.ts', { GRAMMAR_LESSONS: [{ id: 'g1', title: '문법 제목' }], GRAMMAR_PROGRESS_KEY: 'grammarProgress' });
  f.tab.setModule('components/language/learning-focus.module.css.ts', { default: {} });
  f.tab.setModule('components/language/LearningCompanion.tsx', { default: 'aside' });
  f.tab.setModule('components/language/LearningQuestion.tsx', { default: 'learning-question' });
  f.tab.setModule('components/language/useLearningAudio.ts', { useLearningAudio: () => ({ stop() {}, async play() {}, playing: false, audioError: '' }) });
  f.tab.setModule('components/useYeoniPreferences.ts', { useYeoniPreferences: () => ({ visible: false, motion: 'off' }) });
  return f;
}
function cardButton(view: { render(): UiNode }, text: string, label: string, ordinal = 0) {
  const card = nodes(view.render()).filter(node => node.type === 'li' && (textOf(node).includes(text) || nodes(node).some(child => child.props.item && JSON.stringify(child.props.item).includes(text))))[ordinal]; assert.ok(card, text);
  const button = nodes(card).find(node => node.type === 'button' && textOf(node) === label); assert.ok(button, label); return button;
}
function vmValue(f: Awaited<ReturnType<typeof fixture>>, value: unknown) { const api = f.tab.loadModule('app/data/languageRecordDocuments.ts') as { languageDocument(raw: string, kind: 'object'): { get(): unknown } }; return api.languageDocument(JSON.stringify(value), 'object').get(); }
function click(node: UiNode) { assert.ok(!node.props.disabled); (node.props.onClick as (event: unknown) => void)({ stopPropagation() {} }); }
function courseNode(view: { render(): UiNode }) { const node = nodes(view.render()).find(node => typeof node.type === 'function' && node.props.handle && node.props.onSchedule); assert.ok(node); return node; }

test('W3 shipping every noncourse review tab uses the same atomic completion writer and preserves historical IDs', async t => {
  const f = await fixture(t, { savedWords: JSON.stringify([savedWord]), savedSentences: '[{"japanese":"こんにちは","meaning":"안녕","category":"일상","note":""}]', wrongWords: '[{"word":"犬","meaning":"개","quizType":"meaning"}]', wrongSentences: '[{"japanese":"またね","meaning":"또 봐"}]', wrongKana: '["あ"]', wrongKanaChars: '["い"]', grammarProgress: '[{"lessonId":"g1","title":"문법 제목","category":"조사","pattern":"は","correctCount":0,"wrongCount":1,"lastResult":"wrong"}]' });
  const view = f.tab.mount('app/language/review/page.tsx'); t.after(view.dispose); await view.settle();
  for (const label of ['고양이', '안녕', '犬', 'またね', 'あ', '문법 제목']) { click(cardButton(view, label, '복습 완료')); await view.settle(); }
  const legacyChar = nodes(view.render()).find(node => node.type === 'div' && textOf(node).startsWith('い복습 완료') && nodes(node).some(child => child.type === 'button')); assert.ok(legacyChar);
  click(nodes(legacyChar).find(node => node.type === 'button' && textOf(node) === '복습 완료')!); await view.settle();
  const ids = JSON.parse(f.tab.local.getItem('reviewCompletedItemsByDate')!).find((entry: { date: string }) => entry.date === today()).items as string[];
  assert.ok(ids.includes('saved-word:猫')); assert.ok(ids.includes('saved-sentence:こんにちは')); assert.ok(ids.includes('wrong-kana:あ')); assert.ok(ids.includes('grammar:g1')); assert.ok(ids.includes('kana-char:い')); assert.ok(ids.some(id => id.startsWith('wrong-word:犬|'))); assert.ok(ids.some(id => id.startsWith('wrong-sentence:|またね|')));
  assert.deepEqual(JSON.parse(f.tab.local.getItem('dailyRoutineProgress')!).completedIds, ['review']);
});
test('W3 shipping mount replay restores persisted review completion without rewriting date entries', async t => {
  const raw = `[{"date":"${today()}","items":["a","b","c"],"u":90071992547409933333}]`;
  const f = await fixture(t, { reviewCompletedItemsByDate: raw }); const view = f.tab.mount('app/language/review/page.tsx'); t.after(view.dispose); await view.settle();
  assert.equal(f.tab.local.getItem('reviewCompletedItemsByDate'), raw); assert.deepEqual(JSON.parse(f.tab.local.getItem('dailyRoutineProgress')!).completedIds, ['review']);
});
test('W3 shipping deletion quota failure keeps saved group displayed and retries exact deletion', async t => {
  const raw = `[${JSON.stringify(savedWord)},${JSON.stringify({ ...savedWord, meaning: '동물' })},{"opaque":1e999}]`;
  const f = await fixture(t, { savedWords: raw }); const view = f.tab.mount('app/language/review/page.tsx'); t.after(view.dispose); await view.settle();
  f.browser.rejectNextWrite('savedWords'); click(cardButton(view, '고양이', '삭제')); await view.settle();
  assert.equal(f.tab.local.getItem('savedWords'), raw); assert.match(view.text(), /고양이/); view.click('저장 다시 확인'); await view.settle();
  assert.equal(f.tab.local.getItem('savedWords'), '[{"opaque":1e999}]'); assert.doesNotMatch(view.text(), /고양이/);
});
test('W3 shipping wrong-kana deletion commits coupled cleanup and legacy-char occurrence preserves opaque rows', async t => {
  const f = await fixture(t, { wrongKana: '[{"char":"あ","romaji":"a"}]', wrongKanaChars: '["あ",{"u":1e999},"い","い"]' });
  const view = f.tab.mount('app/language/review/page.tsx'); t.after(view.dispose); await view.settle();
  click(cardButton(view, 'あ', '삭제')); await view.settle(); assert.equal(f.tab.local.getItem('wrongKana'), '[]'); assert.equal(f.tab.local.getItem('wrongKanaChars'), '[{"u":1e999},"い","い"]');
  const chips = nodes(view.render()).filter(node => node.type === 'div' && textOf(node) === 'い복습 완료삭제'); assert.equal(chips.length, 2);
  click(nodes(chips[1]).find(node => node.type === 'button' && textOf(node) === '삭제')!); await view.settle(); assert.equal(f.tab.local.getItem('wrongKanaChars'), '[{"u":1e999},"い"]');
});
test('W3 shipping dirty course card stays mounted across pause/tab changes and retains original handle after refresh', async t => {
  const f = await fixture(t, { japaneseCurriculumReviewV1: JSON.stringify([course]), integratedLearningSettingsV1: '{"learnerMode":"reader"}' });
  const parent = f.tab.mount('app/language/review/page.tsx'); t.after(parent.dispose); await parent.settle();
  const original = courseNode(parent), props = { ...original.props };
  const child = f.tab.mount('components/language/CourseReviewQuestion.tsx', props); t.after(child.dispose); await child.settle();
  (child.render().props.onInputCapture as () => void)();
  const question = nodes(child.render()).find(node => node.type === 'learning-question'); assert.ok(question);
  (question.props.onHint as () => void)(); (question.props.onAnswer as (correct: boolean, response: string, observation: unknown) => void)(true, 'retained answer', vmValue(f, { responseMs: 900, neededHelp: true, modality: 'meaning' })); child.render(); parent.render();
  const originalHandle = original.props.handle;
  parent.click('단어'); assert.equal(courseNode(parent).key, original.key, 'Dirty child survives hidden tab');
  f.pause(); parent.render(); assert.equal(courseNode(parent).key, original.key, 'Dirty child survives hidden unavailable gate');
  assert.ok(nodes(parent.render()).some(node => node.props.hidden === true && node.props.inert === true));
  await f.resume(); await parent.settle(); parent.click('새 과정'); Object.assign(props, courseNode(parent).props); child.render();
  const retained = nodes(child.render()).find(node => node.type === 'learning-question')!; assert.equal(retained.props.response, 'retained answer'); assert.equal(retained.props.answer, true);
  await f.language.updateLanguageRecords(f.context, () => ({ japaneseCurriculumReviewV1: JSON.stringify([{ ...course, wrongCount: 9 }]) })); await parent.settle(); Object.assign(props, courseNode(parent).props); child.render();
  await f.language.updateLanguageRecords(f.context, () => ({ integratedLearningSettingsV1: '{"learnerMode":"starter"}' })); await parent.settle(); Object.assign(props, courseNode(parent).props); child.render();
  assert.equal(nodes(child.render()).find(node => node.type === 'learning-question')!.props.mode, 'reader');
  assert.equal(courseNode(parent).props.handle, originalHandle);
  child.click('복습 결과 저장 · 다음 문제'); await child.settle(); await parent.settle();
  assert.equal(JSON.parse(f.tab.local.getItem('japaneseCurriculumReviewV1')!)[0].wrongCount, 9);
  assert.equal(nodes(child.render()).find(node => node.type === 'learning-question')!.props.response, 'retained answer'); assert.match(parent.text(), /다른 화면|변경|입력|원본/);
});
test('W3 shipping course callback awaits commit, preserves answer on quota failure, then atomically schedules and counts review', async t => {
  const f = await fixture(t, { japaneseCurriculumReviewV1: JSON.stringify([course]), reviewCompletedItemsByDate: `[{"date":"${today()}","items":["a","b"]}]` });
  const parent = f.tab.mount('app/language/review/page.tsx'); t.after(parent.dispose); await parent.settle(); const props = { ...courseNode(parent).props };
  const child = f.tab.mount('components/language/CourseReviewQuestion.tsx', props); t.after(child.dispose); await child.settle();
  const question = nodes(child.render()).find(node => node.type === 'learning-question')!;
  (question.props.onAnswer as (correct: boolean, value: string, observation: unknown) => void)(true, 'answer', vmValue(f, { modality: 'meaning', neededHelp: false, responseMs: 500 })); child.render(); parent.render();
  f.browser.rejectNextWrite('dailyLearningHistory'); child.click('복습 결과 저장 · 다음 문제'); await child.settle(); await parent.settle();
  assert.equal(JSON.parse(f.tab.local.getItem('japaneseCurriculumReviewV1')!)[0].intervalDays, 1); assert.equal(f.tab.local.getItem('dailyRoutineProgress'), null);
  assert.equal(nodes(child.render()).find(node => node.type === 'learning-question')!.props.response, 'answer');
  parent.click('저장 다시 확인'); await parent.settle(); assert.equal(JSON.parse(f.tab.local.getItem('japaneseCurriculumReviewV1')!)[0].intervalDays, 3); assert.deepEqual(JSON.parse(f.tab.local.getItem('dailyRoutineProgress')!).completedIds, ['review']);
});
test('W3 shipping review precommit pause requires explicit new save, not automatic authority renewal', async t => {
  const f = await fixture(t, { savedWords: JSON.stringify([savedWord]) });
  const api = f.tab.loadModule('app/data/languageRecordMutations.ts') as typeof Mutations;
  const hold = deferred<void>(), started = deferred<void>(); let held = false;
  f.tab.setModule('app/data/languageRecordMutations.ts', { ...api, async runLanguageMutation(...args: Parameters<typeof api.runLanguageMutation>) {
    if ((args[0].payload as { kind: string }).kind === 'reviewed' && !held) { held = true; started.resolve(); await hold.promise; } return api.runLanguageMutation(...args);
  } });
  const view = f.tab.mount('app/language/review/page.tsx'); t.after(view.dispose); await view.settle(); click(cardButton(view, '고양이', '복습 완료')); await started.promise;
  f.pause(); view.render(); await f.resume(); view.render(); hold.resolve(); await view.settle(); assert.equal(f.tab.local.getItem('reviewCompletedItemsByDate'), null);
  view.click('최신 상태에서 새로 저장'); await view.settle(); assert.ok(f.tab.local.getItem('reviewCompletedItemsByDate')!.includes('saved-word:猫'));
});
test('W3 new review actions use action-time day after midnight while failed retries retain original day', async t => {
  const NativeDate = globalThis.Date; let now = new NativeDate(2026, 9, 10, 23, 59, 50).getTime();
  class TestDate extends NativeDate { constructor(value?: string | number) { super(value ?? now); } static now() { return now; } }
  globalThis.Date = TestDate as DateConstructor; t.after(() => { globalThis.Date = NativeDate; });
  const f = await fixture(t, { savedWords: JSON.stringify([savedWord, { ...savedWord, word: '犬', meaning: '개', example: '犬です' }]) });
  const view = f.tab.mount('app/language/review/page.tsx'); t.after(view.dispose); await view.settle();
  f.browser.rejectNextWrite('reviewCompletedItemsByDate'); click(cardButton(view, '고양이', '복습 완료')); await view.settle();
  now = new NativeDate(2026, 9, 11, 0, 0, 10).getTime(); view.render(); view.click('저장 다시 확인'); await view.settle();
  let days = JSON.parse(f.tab.local.getItem('reviewCompletedItemsByDate')!); assert.equal(days[0].date, '2026-10-10'); assert.deepEqual(days[0].items, ['saved-word:猫']);
  click(cardButton(view, '개', '복습 완료')); await view.settle(); days = JSON.parse(f.tab.local.getItem('reviewCompletedItemsByDate')!);
  assert.equal(days.find((entry: { date: string }) => entry.date === '2026-10-11').items[0], 'saved-word:犬');
});

test('W3 shipping review completion stays pending until its verified acknowledgement publishes', async t => {
  const f = await fixture(t, { savedWords: JSON.stringify([savedWord]) });
  const api = f.tab.loadModule('app/data/languageRecordMutations.ts') as typeof Mutations;
  const hold = deferred<void>(), committed = deferred<void>();
  f.tab.setModule('app/data/languageRecordMutations.ts', { ...api, async runLanguageMutation(...args: Parameters<typeof api.runLanguageMutation>) {
    const result = await api.runLanguageMutation(...args);
    if ((args[0].payload as { kind: string }).kind === 'reviewed') { committed.resolve(); await hold.promise; }
    return result;
  } });
  const view = f.tab.mount('app/language/review/page.tsx'); t.after(view.dispose); await view.settle();
  click(cardButton(view, '고양이', '복습 완료')); await committed.promise;
  assert.ok(f.tab.local.getItem('reviewCompletedItemsByDate')!.includes('saved-word:猫'));
  assert.ok(cardButton(view, '고양이', '복습 완료').props.disabled, 'Durable bytes alone do not publish completed UI');
  hold.resolve(); await view.settle(); assert.ok(cardButton(view, '고양이', '복습 완료됨'));
});
