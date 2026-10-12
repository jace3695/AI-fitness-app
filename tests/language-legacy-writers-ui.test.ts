import assert from 'node:assert/strict';
import test from 'node:test';
import { languageWriterFixture } from './helpers/languageWriterFixture.ts';
import { nodes, textOf, type UiNode } from './helpers/storage-ui-fixture.ts';
import type { LanguageBytes } from '../app/data/languageStorageBoundary.ts';
const words = Array.from({ length: 4 }, (_, index) => ({ word: `JP${index}`, meaning: `KR${index}`, category: '일상', example: '예문', level: 'beginner' }));
const sentences = words.map(item => ({ japanese: item.word, meaning: item.meaning, category: item.category, note: '', level: 'beginner' }));
const lessons = ['g1', 'g2'].map(id => ({ id, title: `문법 ${id}`, category: 'です/ます', pattern: 'です', level: 'beginner', explanation: '설명', examples: [], quiz: { question: `문제 ${id}`, choices: [`맞음 ${id}`, `틀림 ${id}`], answer: `맞음 ${id}` } }));
async function fixture(route: 'words' | 'sentences' | 'grammar' | 'kana', seed: LanguageBytes = {}) {
  const f = await languageWriterFixture(seed);
  f.tab.setModule('next/image', { default: 'img' });
  f.tab.setModule('utils/speakJapanese.ts', { speakJapaneseWithPreferredTts: async () => {}, japaneseAudioErrorMessage: () => 'audio failed' });
  f.tab.setModule('components/WritingPracticePad.tsx', { default: 'writing-pad' });
  f.tab.setModule('data/words.ts', { WORDS: words }); f.tab.setModule('data/sentences.ts', { SENTENCES: sentences }); f.tab.setModule('data/grammar.ts', { GRAMMAR_LESSONS: lessons });
  const page = f.tab.mount(`app/language/${route}/page.tsx`);
  return { ...f, page, dispose() { page.dispose(); f.dispose(); } };
}
function clickNode(node: UiNode) { assert.equal(!!node.props.disabled, false); (node.props.onClick as () => void)(); }
function choice(page: Awaited<ReturnType<typeof fixture>>['page'], correct: boolean) {
  const all = nodes(page.render());
  const question = all.find(node => node.type === 'div' && /^(JP|KR)\d$/.test(textOf(node)));
  assert.ok(question, 'Actual shipped quiz exposes its displayed question');
  const id = textOf(question).slice(-1);
  const choices = all.filter(node => node.type === 'button' && /(?:JP|KR)\d/.test(textOf(node)));
  const result = choices.find(node => textOf(node).endsWith(id) === correct); assert.ok(result); return result;
}
function descendants(node: UiNode) { return nodes(node); }
test('shipping words never rewrites saved source on mount and narrow toggle keeps opaque rows', async t => {
  const raw = '[90071992547409931234,{"future":1e999,"future":2},{"word":"JP0","meaning":"KR0","category":"일상","example":"예문","future":1e999}]';
  const f = await fixture('words', { savedWords: raw }); t.after(f.dispose); const count = f.browser.writes.length;
  await f.page.settle(); assert.equal(f.browser.writes.length, count); assert.equal(f.tab.local.getItem('savedWords'), raw);
  const saved = nodes(f.page.render()).find(node => node.type === 'button' && /저장됨|저장 취소/.test(textOf(node))); assert.ok(saved); clickNode(saved); await f.page.settle();
  assert.equal(f.tab.local.getItem('savedWords'), '[90071992547409931234,{"future":1e999,"future":2}]');
});
for (const route of ['words', 'sentences'] as const) test(`shipping ${route} original threshold, duplicate answer guard, failed answer retry and blocked next`, async t => {
  const f = await fixture(route); t.after(f.dispose); f.page.click('퀴즈 모드');
  const threshold = route === 'words' ? 5 : 3;
  for (let count = 1; count < threshold; count++) {
    clickNode(choice(f.page, true)); await f.page.settle(); assert.equal(f.tab.local.getItem('dailyRoutineProgress'), null); f.page.click('다음 문제');
  }
  const selected = choice(f.page, false), beforeQuestion = nodes(f.page.render()).find(node => node.type === 'div' && /^(JP|KR)\d$/.test(textOf(node)));
  f.browser.rejectNextWrite('dailyLearningHistory'); const answer = selected.props.onClick as () => void; answer(); answer(); await f.page.settle();
  assert.match(f.page.text(), /synthetic quota refusal/); assert.match(f.page.text(), /저장 다시 확인/);
  assert.equal(f.tab.local.getItem(route === 'words' ? 'wrongWords' : 'wrongSentences'), null); assert.equal(f.tab.local.getItem('dailyRoutineProgress'), null);
  f.page.click('다음 문제'); assert.ok(f.page.text().includes(textOf(beforeQuestion!)), 'Actual next handler retains original question while failed');
  f.page.click('저장 다시 확인'); await f.page.settle(); assert.doesNotMatch(f.page.text(), /저장 다시 확인/);
  assert.equal(JSON.parse(f.tab.local.getItem(route === 'words' ? 'wrongWords' : 'wrongSentences')!).length, 1);
  assert.deepEqual(JSON.parse(f.tab.local.getItem('dailyRoutineProgress')!).completedIds, [route]);
  f.page.click('다음 문제'); clickNode(choice(f.page, true)); await f.page.settle();
  if (route === 'sentences') {
    const history = f.tab.local.getItem('dailyLearningHistory');
    f.page.click('다음 문제'); clickNode(choice(f.page, true)); await f.page.settle(); assert.equal(f.tab.local.getItem('dailyLearningHistory'), history, 'Sentences only triggers at total === 3');
  }
});
test('shipping grammar rejects two different answer callbacks before rerender; failure retains first answer only', async t => {
  const f = await fixture('grammar'); t.after(f.dispose);
  const first = f.page.button('틀림 g1').props.onClick as () => void, second = f.page.button('맞음 g2').props.onClick as () => void;
  f.browser.rejectNextWrite('grammarProgress'); first(); second(); await f.page.settle(); assert.equal(f.tab.local.getItem('grammarProgress'), null); assert.match(f.page.text(), /synthetic quota refusal/);
  const cards = nodes(f.page.render()).filter(node => node.type === 'article');
  assert.equal(descendants(cards[0]).filter(node => node.type === 'button' && textOf(node) === '다시 풀기').length, 1);
  assert.equal(descendants(cards[1]).filter(node => node.type === 'button' && textOf(node) === '다시 풀기').length, 0, 'Rejected second click does not show a completed answer');
  f.page.click('다시 풀기'); assert.match(f.page.text(), /저장 다시 확인/); f.page.click('저장 다시 확인'); await f.page.settle();
  const rows = JSON.parse(f.tab.local.getItem('grammarProgress')!); assert.equal(rows.length, 1); assert.equal(rows[0].lessonId, 'g1'); assert.equal(rows[0].wrongCount, 1);
  f.page.click('다시 풀기'); f.page.click('맞음 g1'); await f.page.settle(); const next = JSON.parse(f.tab.local.getItem('grammarProgress')!)[0]; assert.equal(next.correctCount, 1); assert.equal(next.wrongCount, 1);
});
test('shipping grammar frozen source rejects competing answer and retains choice until explicit discard', async t => {
  const f = await fixture('grammar'); t.after(f.dispose); const release = f.browser.holdLock();
  f.page.click('틀림 g1'); f.tab.local.setItem('grammarProgress', '[{"lessonId":"g1","correctCount":9,"wrongCount":2}]'); release(); await f.page.settle();
  assert.match(f.page.text(), /다른 창/); assert.equal(JSON.parse(f.tab.local.getItem('grammarProgress')!)[0].correctCount, 9); assert.equal(f.tab.local.getItem('dailyRoutineProgress'), null);
  assert.match(f.page.text(), /다시 풀기/); f.page.click('보류한 입력 버리기'); assert.doesNotMatch(f.page.text(), /저장 다시 확인/);
});
test('shipping grammar pause after queued answer never publishes score or loses retry input', async t => {
  const f = await fixture('grammar'); t.after(f.dispose); const release = f.browser.holdLock(); f.page.click('맞음 g1'); f.pause(); f.page.render(); release(); await f.page.settle();
  assert.equal(f.tab.local.getItem('grammarProgress'), null); assert.match(f.page.text(), /보류한 입력 버리기/); await f.resume(); await f.page.settle(); f.page.click('저장 다시 확인'); await f.page.settle(); assert.equal(f.tab.local.getItem('grammarProgress'), null); assert.match(f.page.text(), /보류한 입력 버리기/);
});
test('shipping kana keeps original 4→5 threshold, atomic wrong answer, and synchronous next guard', async t => {
  const f = await fixture('kana'); t.after(f.dispose); f.page.click('퀴즈 모드');
  const vowels: Record<string, string> = { 'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o' };
  const current = () => nodes(f.page.render()).find(node => node.type === 'span' && (node.props.style as { fontSize?: string })?.fontSize === '5rem');
  for (let count = 1; count < 5; count++) {
    const char = textOf(current()!); f.page.click(vowels[char]); await f.page.settle(); assert.equal(f.tab.local.getItem('dailyRoutineProgress'), null); f.page.click('다음 문제 →');
  }
  const char = textOf(current()!), wrong = ['a', 'i', 'u', 'e', 'o'].find(item => item !== vowels[char] && nodes(f.page.render()).some(node => node.type === 'button' && textOf(node) === item))!;
  f.browser.rejectNextWrite('dailyLearningHistory'); f.page.click(wrong); await f.page.settle(); assert.match(f.page.text(), /synthetic quota refusal/);
  assert.equal(f.tab.local.getItem('wrongKana'), null); assert.equal(f.tab.local.getItem('dailyRoutineProgress'), null); f.page.click('다음 문제 →'); assert.equal(textOf(current()!), char);
  f.page.click('저장 다시 확인'); await f.page.settle(); assert.deepEqual(JSON.parse(f.tab.local.getItem('dailyRoutineProgress')!).completedIds, ['kana']); assert.equal(JSON.parse(f.tab.local.getItem('wrongKana')!).length, 1); assert.equal(f.tab.local.getItem('wrongKanaChars'), null);
});
test('shipping kana confusing answers keep the existing no-daily and no-legacy-char semantics', async t => {
  const f = await fixture('kana'); t.after(f.dispose); f.page.click('헷갈리는 글자'); f.page.click('비교 퀴즈');
  // Two choices share the actual shipped handler; at least one of two distinct questions is not assumed correct.
  for (let index = 0; index < 6; index++) {
    const choices = nodes(f.page.render()).filter(node => node.type === 'button' && /^[a-z]+$/.test(textOf(node)));
    assert.ok(choices.length >= 2); clickNode(choices[index % choices.length]); await f.page.settle(); f.page.click('다음 문제 →');
  }
  assert.equal(f.tab.local.getItem('dailyRoutineProgress'), null); assert.equal(f.tab.local.getItem('dailyLearningHistory'), null); assert.equal(f.tab.local.getItem('wrongKanaChars'), null);
});
for (const [route, key, raw] of [
  ['words', 'savedWords', '{}'], ['words', 'savedWords', '[null,90071992547409931234]'],
  ['sentences', 'savedSentences', 'null'], ['sentences', 'savedSentences', '[{"future":1e999}]'],
  ['grammar', 'grammarProgress', 'null'], ['grammar', 'grammarProgress', '[{"lessonId":"g1","correctCount":"one","wrongCount":0},false]'],
  ['kana', 'wrongKana', '{}'], ['kana', 'wrongKana', '[{"future":1e999}]'],
] as const) test(`shipping ${route} distinguishes unsupported/partially readable ${key} from an empty record`, async t => {
  const f = await fixture(route, { [key]: raw }); t.after(f.dispose);
  const before = f.browser.writes.length; await f.page.settle();
  const alert = nodes(f.page.render()).find(node => node.props.role === 'alert'); assert.ok(alert, 'Unreadable and opaque records have a visible notice'); assert.match(textOf(alert), /형식|보존/);
  assert.equal(f.tab.local.getItem(key), raw); assert.equal(f.browser.writes.length, before);
});
test('shipping grammar explicitly recovers a proven uncommitted same-origin answer after resume', async t => {
  const f = await fixture('grammar'); t.after(f.dispose); const release = f.browser.holdLock(); f.page.click('맞음 g1'); f.pause(); f.page.render(); release(); await f.page.settle();
  await f.resume(); await f.page.settle(); f.page.click('최신 상태에서 새로 저장'); await f.page.settle();
  const rows = JSON.parse(f.tab.local.getItem('grammarProgress')!); assert.equal(rows[0].correctCount, 1); assert.equal(rows[0].wrongCount, 0); assert.doesNotMatch(f.page.text(), /저장 다시 확인/);
});
test('shipping grammar new-save recovery preserves original-source conflict and original draft feedback', async t => {
  const f = await fixture('grammar'); t.after(f.dispose); f.browser.rejectNextWrite('grammarProgress'); f.page.click('맞음 g1'); await f.page.settle();
  f.tab.local.setItem('grammarProgress', '[{"lessonId":"g1","correctCount":9,"wrongCount":0}]'); f.tab.dispatch({ type: 'storage', key: 'grammarProgress' }); await f.page.settle();
  f.page.click('최신 상태에서 새로 저장'); await f.page.settle(); assert.match(f.page.text(), /다른 창/); assert.equal(JSON.parse(f.tab.local.getItem('grammarProgress')!)[0].correctCount, 9); assert.match(f.page.text(), /다시 풀기/);
});
test('shipping grammar durable stale acknowledgement reconciles same operation and cannot offer a new increment', async t => {
  const f = await fixture('grammar'); t.after(f.dispose); const set = f.tab.local.setItem; let paused = false;
  f.tab.local.setItem = (key, value) => { set(key, value); if (!paused && key === f.tab.transactions.STORAGE_PROTOCOL_KEY && value.includes('"state":"committed"')) { paused = true; f.pause(); } };
  f.page.click('맞음 g1'); await f.page.settle(); const before = f.tab.local.getItem('grammarProgress')!; assert.equal(JSON.parse(before)[0].correctCount, 1); assert.match(f.page.text(), /저장 다시 확인/); assert.doesNotMatch(f.page.text(), /최신 상태에서 새로 저장/);
  await f.resume(); await f.page.settle(); f.page.click('저장 다시 확인'); await f.page.settle(); assert.equal(f.tab.local.getItem('grammarProgress'), before); assert.doesNotMatch(f.page.text(), /저장 다시 확인/);
});
test('shipping grammar unknown rollback failure permits only read-only same-operation confirmation', async t => {
  const f = await fixture('grammar'); t.after(f.dispose); const remove = f.tab.local.removeItem;
  f.browser.rejectNextWrite('dailyLearningHistory'); let failed = false;
  f.tab.local.removeItem = key => { if (key === 'grammarProgress' && !failed) { failed = true; throw new Error('synthetic rollback refusal'); } remove(key); };
  f.page.click('맞음 g1'); await f.page.settle(); assert.match(f.page.text(), /저장 다시 확인/); assert.doesNotMatch(f.page.text(), /최신 상태에서 새로 저장/);
  const before = f.browser.writes.length; f.page.click('저장 다시 확인'); await f.page.settle(); assert.equal(f.browser.writes.length, before, 'Unknown retry cannot dispatch any write');
});
for (const route of ['words', 'sentences', 'kana'] as const) test(`shipping ${route} reports unsupported app settings without mount rewrite`, async t => {
  const f = await fixture(route, { japaneseAppSettings: 'null' }); t.after(f.dispose); const before = f.browser.writes.length;
  await f.page.settle(); assert.match(f.page.text(), /일부 학습 설정/); assert.equal(f.tab.local.getItem('japaneseAppSettings'), 'null'); assert.equal(f.browser.writes.length, before);
});
test('shipping words save cannot silently delete a matching hidden incomplete saved row', async t => {
  const raw = '[{"word":"JP0","meaning":"KR0","category":"일상","future":1e999}]';
  const f = await fixture('words', { savedWords: raw }); t.after(f.dispose); assert.match(f.page.text(), /표시하지 못했어요/);
  const save = nodes(f.page.render()).find(node => node.type === 'button' && textOf(node) === '저장'); assert.ok(save); clickNode(save); await f.page.settle();
  assert.equal(f.tab.local.getItem('savedWords'), raw); assert.match(f.page.text(), /숨겨진 원본을 삭제하지 않았어요/);
});
