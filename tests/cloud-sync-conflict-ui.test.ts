import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { nodes, textOf, type UiNode } from './helpers/storage-ui-fixture.ts';
import type { CloudSyncConflictReview, CloudSyncConflictChoice } from '../app/data/cloudSyncConflicts.ts';

// Synthetic React hook/JSX nodes. This checks shipping controls and handlers,
// not browser layout, focus behavior, or physical small-screen accessibility.
function renderReview(review: CloudSyncConflictReview, busy = false) {
  let choices = {}, submitted: CloudSyncConflictChoice[] | undefined;
  const exports: Record<string, unknown> = {};
  const jsx = (type: unknown, props: UiNode['props'], key?: string) => ({ type, props, key });
  const source = ts.transpileModule(readFileSync(new URL('../app/components/CloudSyncConflictReview.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const modules = { react: { useState: () => [choices, (update: (old: object) => object) => { choices = update(choices); }] }, 'react/jsx-runtime': { jsx, jsxs: jsx } };
  vm.runInNewContext(`(function(exports,require){${source}\n})`, {})(exports, (name: keyof typeof modules) => { assert.ok(name in modules); return modules[name]; });
  const component = exports.default as (props: object) => UiNode;
  const render = () => component({ review, busy, onResolve: (value: CloudSyncConflictChoice[]) => { submitted = value; } });
  const radios = () => nodes(render()).filter(node => node.type === 'input');
  return { render, radios, get submitted() { return submitted; },
    choose(index: number) { (radios()[index].props.onChange as () => void)(); },
    submit() { const button = nodes(render()).find(node => node.type === 'button')!; (button.props.onClick as () => void)(); return button; },
    fieldLabel: exports.cloudSyncFieldLabel as (path: string[]) => string,
    valueLabel: exports.cloudSyncValueLabel as (value: object, unknown?: boolean) => string,
  };
}
function fixture(base: object | null = {}) {
  return { request: { userId: 'synthetic-owner', epoch: 'synthetic-session', base, local: {}, acknowledgementToken: 'synthetic-ack', storageGeneration: 'synthetic-generation' },
    remote: { state: {}, updated_at: '2030-01-01T00:00:00Z' }, resetKeys: [], conflicts: [
      { path: ['ai-fitness-diet-completed-days', '2030-01-01', 'dietMemo'], kind: 'value', base: { present: true, value: 'synthetic base' }, local: { present: true, value: 'synthetic local' }, remote: { present: true, value: 'synthetic remote' } },
      { path: ['synthetic-extra'], kind: 'delete-edit', base: { present: true, value: 'synthetic old' }, local: { present: false }, remote: { present: true, value: null } },
    ] } as CloudSyncConflictReview;
}

test('shipping conflict review has no default winner and requires each accessible fieldset choice', () => {
  const ui = renderReview(fixture());
  assert.equal(nodes(ui.render()).filter(node => node.type === 'fieldset').length, 2);
  assert.equal(nodes(ui.render()).filter(node => node.type === 'legend').length, 2);
  assert.equal(ui.radios().length, 4); assert.ok(ui.radios().every(node => node.props.checked === false));
  assert.equal(ui.submit().props.disabled, true); assert.equal(ui.submitted, undefined);
  ui.choose(0); assert.equal(ui.submit().props.disabled, true); assert.equal(ui.submitted, undefined);
  ui.choose(3); assert.equal(ui.submit().props.disabled, false);
  assert.deepEqual(JSON.parse(JSON.stringify(ui.submitted)), [{ path: ['ai-fitness-diet-completed-days', '2030-01-01', 'dietMemo'], side: 'local' }, { path: ['synthetic-extra'], side: 'remote' }]);
  assert.match(textOf(ui.render()), /식단 기록.*식단 메모/);
  assert.equal(ui.fieldLabel(['toString', 'synthetic']), 'toString / synthetic');
  assert.match(textOf(ui.render()), /synthetic local/); assert.match(textOf(ui.render()), /synthetic remote/);
});

test('shipping conflict review distinguishes unknown baseline, missing/deleted, null, empty strings, arrays and literal text', () => {
  const ui = renderReview(fixture(null));
  assert.match(textOf(ui.render()), /기준 정보 없음/);
  assert.match(textOf(ui.render()), /값 없음 \(삭제되었거나 아직 기록되지 않음\)/);
  assert.match(textOf(ui.render()), /비어 있는 값 \(null\)/);
  assert.notEqual(ui.valueLabel({ present: false }), ui.valueLabel({ present: true, value: null }));
  assert.equal(ui.valueLabel({ present: true, value: '' }), '빈 문자열 ("")');
  assert.match(ui.valueLabel({ present: true, value: ['synthetic first', 'synthetic second'] }), /synthetic first.*\n.*synthetic second/);
  assert.equal(ui.valueLabel({ present: true, value: '<script>synthetic</script>' }), '문자열: <script>synthetic</script>');
  assert.notEqual(ui.valueLabel({ present: true, value: '1' }), ui.valueLabel({ present: true, value: 1 }));
  assert.notEqual(ui.valueLabel({ present: true, value: 'true' }), ui.valueLabel({ present: true, value: true }));
  assert.ok(nodes(ui.render()).every(node => !('dangerouslySetInnerHTML' in node.props)));
});

test('shipping busy review guards submit and uses small-screen stacking, bounded long values, and explicit labels', () => {
  const ui = renderReview(fixture(), true);
  ui.choose(1); ui.choose(2); assert.equal(ui.submit().props.disabled, true); assert.equal(ui.submitted, undefined);
  assert.ok(nodes(ui.render()).filter(node => node.type === 'fieldset').every(node => node.props.disabled));
  assert.ok(nodes(ui.render()).some(node => String(node.props.className).includes('sm:grid-cols-2')));
  assert.ok(nodes(ui.render()).some(node => String(node.props.className).includes('max-h-48')));
  assert.match(textOf(ui.render()), /이 기기 값 유지.*서버 값 유지/);
});
