import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

// Structural layout contracts only; actual wrapping is checked by browser geometry/PNGs.
const source = readFileSync('app/components/BodyRecordCard.tsx', 'utf8');
const tree = ts.createSourceFile('BodyRecordCard.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const elements: ts.JsxElement[] = [];
function visit(node: ts.Node) { if (ts.isJsxElement(node)) elements.push(node); ts.forEachChild(node, visit); }
visit(tree);
function attribute(element: ts.JsxElement, name: string) {
  const attr = element.openingElement.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(tree) === name);
  return attr && ts.isJsxAttribute(attr) && attr.initializer && ts.isStringLiteral(attr.initializer) ? attr.initializer.text : '';
}
const label = (element: ts.JsxElement) => element.children.filter(ts.isJsxText).map(child => child.text).join('').trim();

test('record-kind badge remains a complete label and its header can reflow when text is enlarged', () => {
  const badge = elements.find(element => label(element) === '체중·인바디');
  assert.ok(badge);
  const classes = attribute(badge, 'className');
  assert.match(classes, /\bshrink-0\b/);
  assert.match(classes, /\bwhitespace-nowrap\b/);
  assert.ok(classes.includes('text-[0.6875rem]'));
  assert.doesNotMatch(classes, /truncate|overflow-hidden/);
  assert.ok(ts.isJsxElement(badge.parent));
  assert.match(attribute(badge.parent, 'className'), /\bflex-wrap\b/);
});

test('photo steps retain their order and use font-relative auto-fit tracks instead of forced narrow thirds', () => {
  const steps = elements.find(element => attribute(element, 'aria-label') === '사진 입력 순서');
  assert.ok(steps);
  const classes = attribute(steps, 'className');
  assert.ok(classes.includes('grid-cols-[repeat(auto-fit,minmax(min(100%,4.5rem),1fr))]'));
  assert.match(classes, /\btext-xs\b/);
  assert.doesNotMatch(classes, /grid-cols-3|truncate|overflow-hidden|text-\[12px\]/);
  const items = steps.children.filter(ts.isJsxElement);
  assert.deepEqual(items.map(label), ['1. 사진 선택', '2. 내용 확인', '3. 저장']);
  for (const item of items) {
    assert.match(attribute(item, 'className'), /\bwhitespace-nowrap\b/);
    assert.match(attribute(item, 'className'), /\bpx-1\b/);
  }
});

test('native measurement date stays width-constrained inside enlarged narrow review without fixed font sizing', () => {
  let input: ts.JsxSelfClosingElement | undefined;
  function find(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.attributes.properties.some(item =>
      ts.isJsxAttribute(item) && item.name.getText(tree) === 'id' && item.initializer &&
      ts.isStringLiteral(item.initializer) && item.initializer.text === 'body-measurement-date')) input = node;
    ts.forEachChild(node, find);
  }
  find(tree);
  assert.ok(input);
  const classes = input.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(tree) === 'className');
  assert.ok(classes && ts.isJsxAttribute(classes) && classes.initializer && ts.isStringLiteral(classes.initializer));
  for (const token of ['min-w-0', 'w-full', 'max-w-full']) assert.ok(classes.initializer.text.split(' ').includes(token));
  assert.doesNotMatch(classes.initializer.text, /text-\[\d+px\]|truncate/);
});

function datePreview() {
  const preview = elements.find(element => attribute(element, 'id') === 'body-measurement-date-preview');
  assert.ok(preview, 'native date clipping needs a readable visual value alongside the input');
  return preview;
}

type PreviewNode = { tag: string; props: Record<string, string>; children: PreviewChild[] };
type PreviewChild = PreviewNode | string | boolean | null;
function previewText(node: PreviewChild): string {
  if (typeof node === 'string') return node;
  if (!node || typeof node === 'boolean') return '';
  return node.children.map(previewText).join('');
}

test('selected date preview renders the exact draft year, month and day without time-zone conversion and clears with the input', () => {
  const preview = datePreview();
  assert.ok(ts.isBinaryExpression(preview.parent) && ts.isJsxExpression(preview.parent.parent));
  const expression = preview.parent.getText(tree);
  const script = ts.transpileModule(`const render = (draft: { date: string }) => (${expression});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'h' },
  }).outputText;
  const render = vm.runInNewContext(script + '\nrender', {
    h: (tag: string, props: Record<string, string>, ...children: PreviewChild[]) => ({ tag, props, children }),
  }) as (draft: { date: string }) => PreviewNode | '';
  for (const [date, parts] of [
    ['2025-04-07', ['2025년', '04월', '07일']],
    ['2024-02-29', ['2024년', '02월', '29일']],
    ['2025-12-31', ['2025년', '12월', '31일']],
    ['10000-01-01', ['10000년', '01월', '01일']], // Even an out-of-range edit must not be visually truncated.
  ] as const) {
    const draft = Object.freeze({ date });
    const rendered = render(draft);
    assert.ok(rendered);
    const time = rendered.children.find(child => typeof child === 'object' && child?.tag === 'time') as PreviewNode;
    assert.ok(time);
    assert.equal(time.props.dateTime, date);
    assert.deepEqual(time.children.filter(child => typeof child === 'object').map(previewText), [...parts]);
    assert.equal(previewText(rendered), '선택한 날짜' + parts.join(''));
    assert.equal(draft.date, date);
  }
  assert.equal(render(Object.freeze({ date: '' })), '');
});

test('selected date preview can reflow whole date parts without reducing enlarged text or duplicating accessible controls', () => {
  const preview = datePreview();
  assert.equal(attribute(preview, 'aria-hidden'), 'true', 'the native input already exposes the same value to assistive technology');
  assert.equal(attribute(preview, 'role'), '');
  assert.equal(attribute(preview, 'tabIndex'), '');
  assert.equal(attribute(preview, 'aria-live'), '');
  assert.doesNotMatch(preview.getText(tree), /<input|<button|<a[ >]|aria-label|text-\[|text-xs|text-sm|truncate|overflow-hidden|max-h-/);
  const time = preview.children.find(child => ts.isJsxElement(child) && child.openingElement.tagName.getText(tree) === 'time');
  assert.ok(time && ts.isJsxElement(time));
  assert.match(attribute(time, 'className'), /\bflex-wrap\b/);
  const parts = time.children.filter(ts.isJsxElement);
  assert.equal(parts.length, 3);
  for (const part of parts) assert.match(attribute(part, 'className'), /\bwhitespace-nowrap\b/);
  let ancestor: ts.Node | undefined = preview.parent;
  while (ancestor) {
    if (ts.isJsxElement(ancestor)) assert.notEqual(ancestor.openingElement.tagName.getText(tree), 'label');
    ancestor = ancestor.parent;
  }
});

test('photo and save/delete actions keep words whole and stack when enlarged instead of squeezing sibling buttons', () => {
  const photo = elements.find(element => element.openingElement.tagName.getText(tree) === 'button' && element.getText(tree).includes('fileInputRef.current?.click()'));
  const save = elements.find(element => element.openingElement.tagName.getText(tree) === 'button' && element.getText(tree).includes('onClick={draft ? saveImport : save}'));
  const remove = elements.find(element => label(element) === '이 날짜 기록 삭제');
  assert.ok(photo && save && remove);
  for (const button of [photo, save, remove]) {
    assert.match(attribute(button, 'className'), /\bbreak-keep\b/);
    assert.match(attribute(button, 'className'), /\bpx-2\b/);
    assert.doesNotMatch(attribute(button, 'className'), /truncate|overflow-hidden|text-\[\d+px\]/);
  }
  for (const button of [save, remove]) {
    assert.match(attribute(button, 'className'), /\bflex-1\b/);
    assert.match(attribute(button, 'className'), /\bbasis-48\b/);
  }
  assert.ok(ts.isJsxElement(save.parent));
  assert.match(attribute(save.parent, 'className'), /\bflex-wrap\b/);
  assert.ok(attribute(remove, 'className').includes('text-[0.8125rem]'));
});

test('review shortcut preserves complete Korean words without shrinking its enlarged text', () => {
  const shortcut = elements.find(element => element.openingElement.tagName.getText(tree) === 'button' && element.getText(tree).includes('document.getElementById(draft ?'));
  assert.ok(shortcut);
  const classes = attribute(shortcut, 'className');
  assert.match(classes, /\bbreak-keep\b/);
  assert.match(classes, /\btext-sm\b/);
  assert.match(classes, /\bmin-h-11\b/);
  assert.doesNotMatch(classes, /truncate|overflow-hidden|whitespace-nowrap|text-\[\d+px\]/);
});

test('photo review cancel keeps words whole with room for two enlarged words while retaining its touch height', () => {
  const cancel = elements.find(element => label(element) === '사진 입력 취소');
  assert.ok(cancel);
  const classes = attribute(cancel, 'className');
  assert.match(classes, /\bbreak-keep\b/);
  assert.match(classes, /\bpx-1\b/);
  assert.match(classes, /\bmin-h-11\b/);
  assert.doesNotMatch(classes, /truncate|overflow-hidden|whitespace-nowrap|text-/);
});
