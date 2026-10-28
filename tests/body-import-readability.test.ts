import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

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
