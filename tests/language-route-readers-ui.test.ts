import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { languageWriterFixture } from './helpers/languageWriterFixture.ts';
import { nodes, textOf } from './helpers/storage-ui-fixture.ts';
import type { LanguageBytes } from '../app/data/languageStorageBoundary.ts';

async function fixture(t: TestContext, seed: LanguageBytes) {
  const f = await languageWriterFixture(seed); t.after(f.dispose);
  const audio: { text: string; options: { rate: number; repeatCount: number; repeatDelayMs: number } }[] = [];
  f.tab.setModule('utils/speakJapanese.ts', { japaneseAudioErrorMessage: (error: unknown) => String(error), async speakJapaneseWithPreferredTts(text: string, options: typeof audio[number]['options']) { audio.push({ text, options }); } });
  f.tab.setModule('components/FuriganaText.tsx', { default: 'furigana' });
  f.tab.setModule('app/lib/authenticatedHeaders.ts', { authenticatedJsonHeaders: async () => ({}) });
  f.tab.setModule('lib/free-mode.ts', { FREE_MODE: true });
  f.tab.setModule('components/language/live/LiveCalendarOverlay.tsx', { default: 'live-calendar', LiveCalendarBadges: 'live-badges' });
  f.tab.setModule('components/language/live/useLiveOverview.ts', { useLiveOverview: () => ({ status: 'idle', overview: null }) });
  return { ...f, audio };
}
test('W4 shipping language calendar reads coherent history and goal, refreshes, then hides retired source', async t => {
  const now = new Date(), day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const history = JSON.stringify({ [day]: { completedIds: ['kana', 'words'], completedCount: 2, totalCount: 5 } });
  const f = await fixture(t, { dailyLearningHistory: history, learningSettings: '{"dailyGoalCount":2,"opaque":1e999}' });
  const before = f.browser.writes.length, view = f.tab.mount('app/language/calendar/page.tsx'); t.after(view.dispose); await view.settle();
  assert.match(view.text(), /목표 달성률100%/); assert.equal(f.browser.writes.length, before);
  await f.language.updateLanguageRecords(f.context, () => ({ learningSettings: '{"dailyGoalCount":4,"opaque":1e999}' })); await view.settle();
  assert.match(view.text(), /목표 달성률50%/);
  f.pause(); view.render(); assert.doesNotMatch(view.text(), /학습 상세|목표 달성률50%/); assert.match(view.text(), /학습 기록/);
  assert.equal(f.tab.local.getItem('dailyLearningHistory'), history);
});
test('W4 shipping speaking source refresh changes audio settings and saved questions without raw readers', async t => {
  const saved = '[{"japanese":"秘密の例","meaning":"SYNTHETIC PRIVATE SENTENCE","category":"일상","koreanPronunciation":"synthetic pronunciation"},{"unknown":1e999}]';
  const f = await fixture(t, { japaneseAppSettings: '{"ttsRate":0.8,"sections":{"speaking":{"repeatCount":2}}}', savedSentences: saved });
  const before = f.browser.writes.length, view = f.tab.mount('app/language/speaking/page.tsx'); t.after(view.dispose); await view.settle();
  assert.equal(f.browser.writes.length, before); view.click('일상'); assert.match(view.text(), /SYNTHETIC PRIVATE SENTENCE/);
  view.click('정답 보기'); view.click('🔊 정답 듣기'); await view.settle();
  assert.equal(f.audio[0].options.rate, 0.8); assert.equal(f.audio[0].options.repeatCount, 2);
  await f.language.updateLanguageRecords(f.context, () => ({ japaneseAppSettings: '{"sections":{"speaking":{"ttsRate":0.6,"repeatCount":3}}}' })); await view.settle();
  view.click('🔊 정답 듣기'); await view.settle(); assert.equal(f.audio[1].options.rate, 0.6); assert.equal(f.audio[1].options.repeatCount, 3);
  f.pause(); view.render(); assert.doesNotMatch(view.text(), /SYNTHETIC PRIVATE SENTENCE/); assert.equal(f.tab.local.getItem('savedSentences'), saved);
});
test('W4 shipping conversation uses snapshot settings and preserves typed draft across pause/resume', async t => {
  const f = await fixture(t, { japaneseAppSettings: '{"ttsRate":0.7,"sections":{"conversation":{"repeatCount":2,"showReading":false}}}' });
  const before = f.browser.writes.length, view = f.tab.mount('app/language/conversation/page.tsx'); t.after(view.dispose); await view.settle();
  const input = nodes(view.render()).find(node => node.type === 'input'); assert.ok(input);
  (input.props.onChange as (event: unknown) => void)({ target: { value: 'synthetic unsent input' } }); view.render();
  view.click('예문 듣기'); await view.settle(); assert.equal(f.audio[0].options.rate, 0.7); assert.equal(f.audio[0].options.repeatCount, 2);
  assert.equal(f.browser.writes.length, before);
  await f.language.updateLanguageRecords(f.context, () => ({ japaneseAppSettings: '{"sections":{"conversation":{"ttsRate":1.2,"repeatCount":3}}}' })); await view.settle();
  view.click('예문 듣기'); await view.settle(); assert.equal(f.audio[1].options.rate, 1.2);
  f.pause(); view.render(); assert.doesNotMatch(view.text(), /예문 듣기/);
  await f.resume(); await view.settle(); assert.equal(nodes(view.render()).find(node => node.type === 'input')?.props.value, 'synthetic unsent input');
});
test('W4 shipping malformed reader documents preserve exact bytes without normalization on mount', async t => {
  const f = await fixture(t, { dailyLearningHistory: '{broken', learningSettings: 'null', japaneseAppSettings: '{broken', savedSentences: 'null' });
  const before = f.browser.writes.length;
  const calendar = f.tab.mount('app/language/calendar/page.tsx'); t.after(calendar.dispose); await calendar.settle();
  assert.match(calendar.text(), /읽지 못했어요/);
  const speaking = f.tab.mount('app/language/speaking/page.tsx'); t.after(speaking.dispose); await speaking.settle(); assert.match(speaking.text(), /읽지 못했어요/);
  assert.equal(f.browser.writes.length, before); assert.equal(f.tab.local.getItem('dailyLearningHistory'), '{broken'); assert.equal(f.tab.local.getItem('savedSentences'), 'null');
});
test('W4 shipping speaking pause/resume preserves self-marked answer and score', async t => {
  const f = await fixture(t, { savedSentences: '[{"japanese":"秘密の例","meaning":"SYNTHETIC PRIVATE SENTENCE","category":"일상"}]' });
  const view = f.tab.mount('app/language/speaking/page.tsx'); t.after(view.dispose); await view.settle();
  view.click('일상'); view.click('정답 보기'); view.click('✅ 맞았음');
  const before = view.text(); f.pause(); view.render(); assert.doesNotMatch(view.text(), /SYNTHETIC PRIVATE SENTENCE/);
  await f.resume(); await view.settle(); assert.equal(view.text(), before);
  const next = nodes(view.render()).find(node => node.type === 'button' && (textOf(node).includes('다음') || textOf(node).includes('결과'))); assert.ok(next);
  (next.props.onClick as () => void)(); view.render(); assert.match(view.text(), /맞은 개수: 1/);
});
test('W4 speaking hides unsupported optional rendering fields and reports partial read', async t => {
  const raw = '[{"japanese":"unsafe","meaning":"UNSAFE OPTIONAL","category":{}},{"japanese":"unsafe2","meaning":"UNSAFE RUBY","rubySegments":[{"text":{}}]}]';
  const f = await fixture(t, { savedSentences: raw }); const view = f.tab.mount('app/language/speaking/page.tsx'); t.after(view.dispose); await view.settle();
  assert.match(view.text(), /저장 문장 일부를 읽지 못했어요/); assert.doesNotMatch(view.text(), /UNSAFE OPTIONAL|UNSAFE RUBY/);
  view.click('정답 보기'); const ruby = nodes(view.render()).find(node => node.type === 'furigana'); assert.ok(ruby); assert.equal(typeof ruby.props.text, 'string');
  assert.equal(f.tab.local.getItem('savedSentences'), raw);
});
