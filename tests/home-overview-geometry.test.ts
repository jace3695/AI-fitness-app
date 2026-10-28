import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { renderToString } from 'react-dom/server';
import type { ReactElement } from 'react';
import type { HomeOverviewProps } from '../components/HomeOverview';
import { buildAssistantNextAction } from '../app/data/assistantNextAction.ts';
import { briefingScenario } from '../scripts/browser-qa/cloud/home-briefing-scenarios.ts';

// Execute the exact native evaluate callback, not a parallel implementation of its geometry rule.
const native = readFileSync('tests/browser-cloud/home-overview.spec.ts', 'utf8');
const tree = ts.createSourceFile('home-overview.spec.ts', native, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const callbacks: ts.ArrowFunction[] = [];
const visit = (node: ts.Node) => {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === "primary.locator('span').evaluate" && ts.isArrowFunction(node.arguments[0])) callbacks.push(node.arguments[0]);
  ts.forEachChild(node, visit);
};
visit(tree);
assert.equal(callbacks.length, 1, 'one shipped text-line callback is required');
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;
const callbackCode = compile(`export default ${callbacks[0].getText(tree)}`);
type Rect = { left: number; right: number; top: number; bottom: number; width: number; height: number };
const rect = (left: number, top: number, width: number, height = 32): Rect => ({ left, right: left + width, top, bottom: top + height, width, height });
function measure(rects: Rect[], overrides: Partial<{ scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number; box: Rect }> = {}) {
  const { box = rect(0, 0, 180, 40), ...dimensions } = overrides;
  const element = { scrollWidth: 180, clientWidth: 180, scrollHeight: 40, clientHeight: 40, ...dimensions, getBoundingClientRect: () => box };
  let selections = 0;
  const exports: { default?: (node: typeof element) => boolean } = {};
  vm.runInNewContext(callbackCode, { exports, document: { createRange: () => ({
    selectNodeContents(selected: unknown) { assert.equal(selected, element); selections++; },
    getClientRects: () => rects,
  }) } });
  assert.ok(exports.default);
  const result = exports.default(element);
  assert.equal(selections, 1);
  return result;
}

test('shipped CTA has separate label and arrow text children; SSR retains that text-node boundary', () => {
  const require = createRequire(import.meta.url);
  const exports: { default?: (props: HomeOverviewProps) => ReactElement } = {};
  vm.runInNewContext(`(function(exports, require){${compile(readFileSync('components/HomeOverview.tsx', 'utf8'))}\n})`)(exports, (name: string) => {
    if (['react/jsx-runtime', 'next/link'].includes(name)) return require(name);
    throw new Error(`Unexpected component dependency: ${name}`);
  });
  assert.ok(exports.default);
  const action = buildAssistantNextAction(briefingScenario('due-priority'));
  const element = exports.default({ action, loading: false, failures: [], lastLoadedAt: null, onRetry() {} });
  const spans: unknown[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object' || !('props' in node)) return;
    const current = node as ReactElement<{ children?: unknown }>;
    if (current.type === 'span') spans.push(current.props.children);
    walk(current.props.children);
  };
  walk(element);
  assert.equal(spans.length, 1);
  assert.deepEqual(Array.from(spans[0] as string[]), ['할 일 확인', ' →']);
  assert.ok(renderToString(element).includes('할 일 확인<!-- --> →'));
});

test('native callback accepts multiple same-line text fragments, including fractional geometry', () => {
  assert.equal(measure([rect(0, 4, 126), rect(126, 4, 42)]), true);
  assert.equal(measure([rect(0, 4, 50), rect(50, 4.25, 76, 31.5), rect(126, 4, 42)]), true);
  assert.equal(measure([rect(0, 4, 168)]), true);
});

test('native callback rejects actual wrapping even when fragment count is two and each fragment fits', () => {
  assert.equal(measure([rect(0, 4, 126), rect(0, 44, 42)], { box: rect(0, 0, 180, 80), scrollHeight: 80, clientHeight: 80 }), false);
  assert.equal(measure([rect(0, 4, 126), rect(126, 4, 42, 35)]), false, 'both top and bottom must match the line');
  assert.equal(measure([rect(0, 4, 126), rect(126, 7, 42, 29)]), false, 'matching bottoms alone is not a line');
});

test('native callback rejects clipping and horizontal or vertical overflow rather than only counting rows', () => {
  const fragments = [rect(0, 4, 126), rect(126, 4, 42)];
  assert.equal(measure(fragments, { scrollWidth: 195 }), false);
  assert.equal(measure(fragments, { scrollHeight: 60 }), false);
  assert.equal(measure(fragments, { box: rect(0, 0, 160, 40) }), false);
  assert.equal(measure(fragments, { box: rect(0, 10, 180, 20) }), false);
  assert.equal(measure([rect(-4, 4, 168)]), false);
});

test('native callback fails closed for absent, non-finite or zero-area text fragments', () => {
  assert.equal(measure([]), false);
  assert.equal(measure([rect(0, 4, 0)]), false);
  assert.equal(measure([rect(0, 4, 168, 0)]), false);
  assert.equal(measure([rect(Number.NaN, 4, 168)]), false);
});


type ReporterFixture = {
  onStepEnd(test: unknown, result: unknown, step: unknown): void;
  onTestEnd(test: unknown, result: unknown): void;
  onEnd(result: unknown): void;
};
function reporterFixture() {
  const exports: { default?: new () => ReporterFixture } = {};
  let output = '';
  vm.runInNewContext(`(function(exports, require){${compile(readFileSync('tests/browser-cloud/reporter.ts', 'utf8'))}\n})`, {
    process: { env: { QA_HEAD_SHA: 'synthetic-commit' } }, console: { log() {} },
  })(exports, (name: string) => {
    assert.equal(name, 'node:fs');
    return { mkdirSync() {}, appendFileSync() { assert.fail('No summary path configured'); },
      writeFileSync(_path: string, value: string) { output = value; } };
  });
  assert.ok(exports.default);
  const reporter = new exports.default();
  const fixture = { id: 'synthetic-h3', title: 'Fixed synthetic test title', parent: { project: () => ({ name: 'synthetic-browser' }) } };
  return { step(title: string, error?: unknown) { reporter.onStepEnd(fixture, {}, { title, error }); }, finish() {
    reporter.onTestEnd(fixture, { status: 'failed', duration: 1 }); reporter.onEnd({ status: 'failed' });
    return { raw: output, phases: JSON.parse(output).results[0].phases as { phase: string; status: string }[] };
  } };
}

test('actual reporter accepts only the bounded H3 phases and preserves existing enums without raw diagnostics', () => {
  const reporter = reporterFixture();
  const allowed = ['component-evidence/final-capture', 'b3-reflow/draft/320/32/checks',
    ...[320, 390].flatMap(width => ['primary', 'text-line', 'collapsed-capture', 'expanded', 'anchor-back', 'closed', 'reload'].map(phase => `h3-overview/${width}/${phase}`))];
  for (const phase of allowed) reporter.step(phase, { message: 'PRIVATE_ERROR_SENTINEL', value: 7123, url: 'PRIVATE_URL_SENTINEL' });
  for (const phase of ['h3-overview/321/text-line', 'h3-overview/320/text-line/PRIVATE_DOM_SENTINEL', 'h3-overview/320/PRIVATE_TITLE_SENTINEL', 'h3-overview/390/primary\n', 'random-step']) reporter.step(phase);
  const result = reporter.finish();
  assert.deepEqual(result.phases.map(item => item.phase), allowed);
  assert.ok(result.phases.every(item => item.status === 'failed'));
  assert.doesNotMatch(result.raw, /PRIVATE_|7123|random-step/);
});

test('actual reporter retains the existing 32-phase bounded cap with added H3 enums', () => {
  const reporter = reporterFixture();
  for (let index = 0; index < 40; index++) reporter.step(index % 2 ? 'h3-overview/320/text-line' : 'component-evidence/final-capture');
  const result = reporter.finish();
  assert.equal(result.phases.length, 32);
  assert.ok(result.phases.every(item => item.status === 'passed'));
});
