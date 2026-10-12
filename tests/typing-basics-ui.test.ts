import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
import * as basics from '../app/data/typingBasics.ts';
import { emptyTypingBasicsDraft, makeTypingBasicsSession } from '../lib/typing-basics-draft.ts';
const owner = '00000000-0000-4000-8000-000000000001';
const routine = { id: '00000000-0000-4000-8000-000000000003', user_id: owner, category: 'typing' };
type Element = ReactElement<Record<string, unknown>>;
function fixture() {
  const resetRequests: (number | undefined)[] = [];
  const practice = { draft: emptyTypingBasicsDraft(owner, null), ready: true, saving: false, saved: false, completed: new Set(), notice: '',
    storageError: false, progressError: false, loadError: false,
    changeKey(code: string) { const next = basics.pressTypingKey(practice.draft.attempt, practice.draft.lesson.keys, code); practice.draft = { ...practice.draft, attempt: next }; return next; },
    changeCheck(index: number, checked: boolean) { practice.draft.checks[index] = checked; },
    reset: (lesson?: number) => { resetRequests.push(lesson); return true; }, save: async () => {}, retryLoad() {}, retryCheckpoint() {} };
  const growth = { routines: [routine], dataReady: true, loading: false };
  const slots: unknown[] = []; let cursor = 0, dirty = false;
  const modules = {
    'react/jsx-runtime': jsx,
    react: { useRef: () => ({ current: null }), useState(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = initial; return [slots[slot], (value: unknown) => { slots[slot] = value; }]; } },
    'next/link': { default: () => null }, '@/app/components/AppIdentity': { default: () => null },
    '@/app/lib/supabase': { supabase: null }, '../../useGrowthData': { useGrowthData: () => growth },
    '@/components/useUnsavedChanges': { useUnsavedChanges(value: boolean) { dirty = value; } },
    './useTypingBasicsPractice': { useTypingBasicsPractice: () => practice }, '@/app/data/typingBasics': basics,
  };
  const exports = {} as { TypingBasicsPractice: (props: unknown) => Element };
  const source = ts.transpileModule(readFileSync(new URL('../app/growth/typing/basics/page.tsx', import.meta.url), 'utf8') + '\nexport { TypingBasicsPractice };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, {})(exports, (name: string) => {
    assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name as keyof typeof modules];
  });
  const render = () => { cursor = 0; return exports.TypingBasicsPractice({ owner, isOwnerActive: () => true }); };
  return { render, practice, growth, resetRequests, dirty: () => dirty };
}
function find(element: unknown, predicate: (element: Element) => boolean): Element | undefined {
  if (!element || typeof element !== 'object') return;
  if (Array.isArray(element)) { for (const child of element) { const found = find(child, predicate); if (found) return found; } return; }
  const item = element as Element; if (predicate(item)) return item;
  return find(item.props?.children, predicate);
}
function button(tree: Element, label: string) { return find(tree, item => item.type === 'button' && (item.props['aria-label'] === label || item.props.children === label))!; }
function press(qa: ReturnType<typeof fixture>, patch: Record<string, unknown>) {
  let prevented = false;
  const event = { code: 'KeyF', repeat: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, preventDefault() { prevented = true; }, ...patch };
  (button(qa.render(), '키보드 자리 연습 입력').props.onKeyDown as (event: unknown) => void)(event);
  return prevented;
}
test('shipping basics component keeps physical-code, Korean IME, ignored repeat/modifier and Tab semantics', () => {
  const qa = fixture();
  (button(qa.render(), '키보드 자리 연습 입력').props.onClick as () => void)();
  assert.equal(press(qa, { code: 'Tab' }), false);
  for (const modifier of ['metaKey', 'ctrlKey', 'altKey']) assert.equal(press(qa, { [modifier]: true }), false);
  assert.equal(press(qa, { shiftKey: true }), true); assert.equal(press(qa, { repeat: true }), true);
  assert.equal(qa.practice.draft.attempt.attempts, 0);
  press(qa, { key: 'Process', code: 'KeyF', isComposing: true, keyCode: 229 });
  assert.equal(qa.practice.draft.attempt.position, 1);
  (button(qa.render(), '키보드 자리 연습 입력').props.onBlur as () => void)();
  press(qa, { code: 'KeyJ' }); assert.equal(qa.practice.draft.attempt.position, 1);
  qa.render(); assert.equal(qa.dirty(), true);
});
test('recovered pending payload freezes pad/checks/reset but permits read-first confirmation without a current routine', () => {
  const qa = fixture(), startedAt = Date.parse('2026-10-09T10:00:00Z');
  const draft = { ...qa.practice.draft, attempt: { position: 12, attempts: 13, mistakes: { f: 1 } }, startedAt, endedAt: startedAt + 1000, checks: [true, true] };
  qa.practice.draft = { ...draft, pending: makeTypingBasicsSession(draft, routine.id, owner, '2026-10-09') };
  qa.growth.routines = []; qa.growth.dataReady = false;
  const tree = qa.render();
  assert.equal(button(tree, '키보드 자리 연습 입력').props.disabled, true);
  assert.equal(button(tree, '같은 자리 다시 연습').props.disabled, true);
  assert.equal(button(tree, '같은 기록 다시 확인').props.disabled, false);
  assert.equal(find(tree, item => item.type === 'fieldset')!.props.disabled, true);
  const html = renderToStaticMarkup(tree); assert.match(html, /틀린 키/); assert.match(html, /92/);
});
test('recovery/storage failures lock every mutating control and expose retry actions', () => {
  const qa = fixture(); qa.practice.ready = false; qa.practice.loadError = true;
  let tree = qa.render(); assert.ok(button(tree, '복구 다시 불러오기')); assert.equal(button(tree, '키보드 자리 연습 입력').props.disabled, true);
  qa.practice.ready = true; qa.practice.loadError = false; qa.practice.storageError = true; tree = qa.render();
  assert.ok(button(tree, '기기 임시 저장 다시 시도')); assert.equal(button(tree, '같은 자리 다시 연습').props.disabled, true);
  assert.equal(button(tree, '자리 연습 저장').props.disabled, true);
});
test('same-lesson reset preserves the snapshot while course selection requests a current index', () => {
  const qa = fixture(); qa.practice.draft.lessonIndex = 99;
  (button(qa.render(), '같은 자리 다시 연습').props.onClick as () => void)();
  const firstLesson = find(qa.render(), item => item.type === 'button' && Array.isArray(item.props.children)
    && item.props.children.includes(basics.TYPING_LESSONS[0].title))!;
  (firstLesson.props.onClick as () => void)();
  assert.deepEqual(qa.resetRequests, [undefined, 0]);
});
