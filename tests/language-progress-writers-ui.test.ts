import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { languageWriterFixture } from './helpers/languageWriterFixture.ts';
import { nodes, textOf, type UiNode } from './helpers/storage-ui-fixture.ts';
import type { LanguageBytes } from '../app/data/languageStorageBoundary.ts';
async function fixture(t: TestContext, seed: LanguageBytes) {
  const f = await languageWriterFixture(seed); t.after(f.dispose);
  f.tab.setModule('data/grammar.ts', { GRAMMAR_LESSONS: [], GRAMMAR_PROGRESS_KEY: 'grammarProgress' });
  f.tab.setModule('data/words.ts', { WORDS: [{ word: '猫', meaning: '고양이' }, { word: '犬', meaning: '개' }] });
  f.tab.setModule('data/sentences.ts', { SENTENCES: [{ japanese: 'こんにちは', meaning: '안녕' }, { japanese: 'またね', meaning: '또 봐' }] });
  return f;
}
function section(view: { render(): UiNode }, heading: string) {
  const result = nodes(view.render()).find(node => node.type === 'section' && nodes(node).some(child => child.type === 'h2' && textOf(child) === heading)); assert.ok(result, heading); return result;
}
function buttonIn(node: UiNode, label: string, ordinal = 0) { const button = nodes(node).filter(child => child.type === 'button' && textOf(child) === label)[ordinal]; assert.ok(button, label); return button; }
function click(node: UiNode) { (node.props.onClick as () => void)(); }

test('W3 shipping progress deletes the captured duplicate occurrence, preserving first row and opaque neighbors', async t => {
  const raw = '[{"word":"猫","meaning":"고양이","u":90071992547409933333},{"word":"猫","meaning":"고양이","u":"\\u0041"},{"opaque":1e999}]';
  const f = await fixture(t, { wrongWords: raw }); const view = f.tab.mount('app/language/progress/page.tsx'); t.after(view.dispose); await view.settle(); view.click('단어');
  click(buttonIn(section(view, '틀린 단어'), '삭제', 1)); await view.settle();
  assert.equal(f.tab.local.getItem('wrongWords'), '[{"word":"猫","meaning":"고양이","u":90071992547409933333},{"opaque":1e999}]'); assert.match(view.text(), /일부 복습 기록을 읽지 못했어요/);
});
test('W3 shipping progress quota failure preserves the selected answer and source; verified retry alone rebuilds quiz', async t => {
  const raw = '[{"char":"あ","romaji":"a","u":1e999}]'; const f = await fixture(t, { wrongKana: raw, wrongKanaChars: '["あ"]' });
  const view = f.tab.mount('app/language/progress/page.tsx'); t.after(view.dispose); await view.settle(); view.click('가나');
  f.browser.rejectNextWrite('wrongKana'); view.click('a'); await view.settle();
  assert.equal(f.tab.local.getItem('wrongKana'), raw); assert.match(view.text(), /정답이에요. 오답 정리 저장을 확인/); assert.doesNotMatch(view.text(), /오답 목록에서 정리했습니다/);
  view.click('다음 오답 →'); assert.equal(f.tab.local.getItem('wrongKana'), raw);
  view.click('저장 다시 확인'); await view.settle(); assert.equal(f.tab.local.getItem('wrongKana'), '[]'); assert.equal(f.tab.local.getItem('wrongKanaChars'), '["あ"]');
});
for (const key of ['wrongKana', 'wrongWords', 'wrongSentences'] as const) test(`W3 shipping ${key} wrong-then-correct duplicate callback accepts only the first answer`, async t => {
  const raw = key === 'wrongKana' ? '[{"char":"あ","romaji":"a"}]' : key === 'wrongWords' ? '[{"word":"猫","meaning":"고양이"}]' : '[{"japanese":"こんにちは","meaning":"안녕"}]';
  const f = await fixture(t, { [key]: raw }); const view = f.tab.mount('app/language/progress/page.tsx'); t.after(view.dispose); await view.settle();
  view.click(key === 'wrongKana' ? '가나' : key === 'wrongWords' ? '단어' : '문장');
  const group = section(view, key === 'wrongKana' ? '가나 오답 다시 풀기' : key === 'wrongWords' ? '단어 오답 다시 풀기' : '문장 오답 다시 풀기');
  const options = nodes(group).filter(node => node.type === 'button' && typeof node.props.disabled === 'boolean');
  const correct = options.find(node => (key === 'wrongKana' ? ['a'] : key === 'wrongWords' ? ['고양이', '猫'] : ['안녕', 'こんにちは']).includes(textOf(node))); assert.ok(correct);
  const correctLabel = textOf(correct);
  const wrong = options.find(node => textOf(node) !== correctLabel); assert.ok(wrong);
  click(wrong); click(correct); view.render(); await view.settle();
  assert.match(view.text(), /오답입니다/); assert.equal(f.tab.local.getItem(key), raw);
});
test('W3 shipping section clear captures confirmation source, rejects ABA during lock wait, and cannot clear hidden rows', async t => {
  const f = await fixture(t, { wrongWords: '[{"word":"猫","meaning":"고양이"}]' }); const view = f.tab.mount('app/language/progress/page.tsx'); t.after(view.dispose); await view.settle(); view.click('단어'); f.tab.setConfirm(true);
  const original = f.tab.local.getItem('wrongWords')!;
  const release = f.browser.holdLock();
  const aba = f.language.updateLanguageRecords(f.context, () => ({ wrongWords: '[{"word":"犬","meaning":"개"}]' }));
  const restore = f.language.updateLanguageRecords(f.context, () => ({ wrongWords: original }));
  click(buttonIn(section(view, '틀린 단어'), '전체 삭제')); release(); await aba; await restore; await view.settle();
  assert.equal(f.tab.local.getItem('wrongWords'), original); assert.match(view.text(), /삭제 결과 확인/);
  const another = await fixture(t, { wrongWords: '[{"word":"猫","meaning":"고양이"},{"opaque":1e999}]' }); const blocked = another.tab.mount('app/language/progress/page.tsx'); t.after(blocked.dispose); await blocked.settle(); blocked.click('단어'); another.tab.setConfirm(true);
  const before = another.tab.local.getItem('wrongWords'); click(buttonIn(section(blocked, '틀린 단어'), '전체 삭제')); await blocked.settle(); assert.equal(another.tab.local.getItem('wrongWords'), before); assert.match(blocked.text(), /표시하지 못한 기록/);
});
test('W3 shipping valid progress section clear removes only its key and respects cancellation', async t => {
  const f = await fixture(t, { wrongKana: '[{"char":"あ","romaji":"a"}]', wrongKanaChars: '["あ"]' }); const view = f.tab.mount('app/language/progress/page.tsx'); t.after(view.dispose); await view.settle(); view.click('가나');
  click(buttonIn(section(view, '헷갈린 글자'), '전체 삭제')); await view.settle(); assert.notEqual(f.tab.local.getItem('wrongKana'), null);
  f.tab.setConfirm(true); click(buttonIn(section(view, '헷갈린 글자'), '전체 삭제')); await view.settle(); assert.equal(f.tab.local.getItem('wrongKana'), null); assert.equal(f.tab.local.getItem('wrongKanaChars'), '["あ"]');
});
test('W3 shipping progress retains answered quiz across same-owner pause without interpreting unscoped legacy bytes', async t => {
  const f = await fixture(t, { wrongWords: '[{"word":"猫","meaning":"고양이"}]' }); f.tab.local.setItem('confusingKana', '["secret-unscoped"]');
  const view = f.tab.mount('app/language/progress/page.tsx'); t.after(view.dispose); await view.settle(); view.click('단어');
  const group = section(view, '단어 오답 다시 풀기'), choices = nodes(group).filter(node => node.type === 'button' && typeof node.props.disabled === 'boolean'); click(choices[0]); view.render(); const before = view.text();
  f.pause(); view.render(); assert.doesNotMatch(view.text(), /고양이/); await f.resume(); await view.settle(); assert.equal(view.text(), before); assert.doesNotMatch(view.text(), /secret-unscoped/); assert.equal(f.tab.local.getItem('confusingKana'), '["secret-unscoped"]');
});
