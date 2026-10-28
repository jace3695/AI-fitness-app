import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as briefing from '../app/data/dailyBriefing.ts';
import type { AssistantNextActionInput } from '../app/data/assistantNextAction.ts';
import { briefingScenario, HOME_BRIEFING_SCENARIOS, type HomeBriefingScenario } from '../scripts/browser-qa/cloud/home-briefing-scenarios.ts';

// Execute the shipped component with real React/server rendering, real Next Link and
// the real data function. This is not browser layout, event or user-comprehension proof.
const require = createRequire(import.meta.url);
const source = readFileSync('components/DailyBriefing.tsx', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  esModuleInterop: true,
} }).outputText;
const output: { default?: ComponentType<{ input: AssistantNextActionInput; loading: boolean }> } = {};
vm.runInNewContext(`(function(exports, require){${compiled}\n})`)(output, (name: string) => {
  if (name === '@/app/data/dailyBriefing') return briefing;
  if (['react', 'react/jsx-runtime', 'next/link'].includes(name)) return require(name);
  throw new Error(`Unexpected component dependency: ${name}`);
});
assert.ok(output.default);
const Component = output.default;
const render = (scenario: HomeBriefingScenario, loading = false) => renderToStaticMarkup(createElement(Component, { input: briefingScenario(scenario), loading }));
const nextLink = (markup: string) => [...markup.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)][0]?.slice(1);

// Prevent this test lane drifting into a copied display or a provider-backed fixture.
test('home briefing fixture renders the same component used by home without replacing production modules', () => {
  const home = readFileSync('app/page.tsx', 'utf8');
  const assistant = readFileSync('app/assistant/AssistantClient.tsx', 'utf8');
  const fixture = readFileSync('scripts/browser-qa/cloud/HomeBriefingFixture.tsx', 'utf8');
  const entry = readFileSync('scripts/browser-qa/cloud/entry.tsx', 'utf8');
  assert.match(home, /<AssistantPage \/>/);
  assert.match(assistant, /<DailyBriefing input=\{nextActionInput\} loading=\{loading\} \/>/);
  assert.match(fixture, /import DailyBriefing from '\.\.\/\.\.\/\.\.\/components\/DailyBriefing'/);
  assert.match(fixture, /<DailyBriefing key=\{scenario\} input=\{briefingScenario\(scenario\)\} loading=\{scenario === 'loading'\} \/>/);
  assert.match(entry, /scenario === 'home-briefing' \? <HomeBriefingFixture \/>/);
  assert.doesNotMatch(fixture, /fetch\(|localStorage|sessionStorage|process\.env|dangerouslySetInnerHTML/);
  assert.doesNotMatch(readFileSync('scripts/browser-qa/cloud/build.mjs', 'utf8'), /plugins:|alias:|inject:/);
});

test('each synthetic scenario is fresh, deterministic and read-only when consumed by the actual data function', () => {
  for (const scenario of HOME_BRIEFING_SCENARIOS) {
    const first = briefingScenario(scenario), second = briefingScenario(scenario);
    assert.deepEqual(first, second);
    assert.notEqual(first.items, second.items);
    assert.notEqual(first.fitness, second.fitness);
    const original = structuredClone(first);
    for (const mode of ['morning', 'evening'] as const) briefing.dailyBriefing(first, mode);
    assert.deepEqual(first, original);
  }
  const completed = briefingScenario('completed');
  assert.equal(completed.fitness.completed, true);
  assert.equal(completed.diet.completed, true);
  assert.equal(completed.language.completed, 5);
  const failed = briefingScenario('partial-failure');
  assert.ok(failed.items[0].title.includes('조회 실패'));
  assert.equal(failed.budget.remaining, -999999);
  assert.deepEqual(failed.available, { tasks: false, budget: false });
});

test('actual empty, completed and failed initial renders retain neutral next action while distinguishing records', () => {
  for (const scenario of ['empty', 'completed', 'partial-failure'] as const) {
    const markup = render(scenario);
    assert.ok(markup.includes('저장된 기록 기준입니다. 미기록은 미수행으로 단정하지 않습니다.'));
    assert.ok(markup.includes('다음 한 걸음: 달력에서 일정을 확인해요'));
    assert.deepEqual(nextLink(markup), ['/calendar', '통합 달력 보기']);
    assert.equal((markup.match(/<li\b/g) ?? []).length, 6);
    assert.doesNotMatch(markup, /모두 완료|합성 조회 실패 영역의 이전 할 일|999,999/);
  }
  const empty = render('empty');
  for (const text of ['월 예산 미설정', '운동 기록 연결 필요', '식단 기록 연결 필요', '학습 기록 연결 필요']) assert.ok(empty.includes(text));
  const completed = render('completed');
  for (const text of ['오늘 완료 기록 있음', '오늘 저장 기록 있음', '오늘 5/5개 완료', '오늘 예정 루틴 2/2개 완료']) assert.ok(completed.includes(text));
  const failed = render('partial-failure');
  assert.equal(failed.split('조회 실패 · 미기록으로 판단하지 않음').length - 1, 2);
  assert.ok(failed.includes('오늘 완료 기록 있음'));
  assert.doesNotMatch(failed, /월 예산 미설정|마감 확인 1건/);
});

test('actual loading render exposes status instead of actionable stale summaries', () => {
  const markup = render('loading', true);
  assert.match(markup, /role="status"[^>]*>현재 기록을 확인하고 있어요\.<\/p>/);
  assert.doesNotMatch(markup, /<li\b|<a\b|다음 한 걸음:/);
});

test('actual rendered next-action title, label and link follow due, important then budget priority', () => {
  for (const [scenario, title, href, label] of [
    ['due-priority', '합성 오늘 마감', '#assistant-list', '할 일 확인'],
    ['important-priority', '합성 중요 할 일', '#assistant-list', '할 일 확인'],
    ['budget-next', '2,500원 초과했어요', '/budget', '가계부에서 확인'],
  ] as const) {
    const markup = render(scenario);
    assert.ok(markup.includes(`다음 한 걸음: ${title}`));
    assert.deepEqual(nextLink(markup), [href, label]);
    assert.ok(markup.indexOf(`다음 한 걸음: ${title}`) < markup.indexOf('<ul'), 'next action precedes all six domain cards');
    assert.doesNotMatch(markup, /합성 완료 항목|합성 취소 항목/);
  }
});

test('synthetic scenario selector has a text-only explicitly associated label for exact native lookup', () => {
  const fixture = readFileSync('scripts/browser-qa/cloud/HomeBriefingFixture.tsx', 'utf8');
  const tree = ts.createSourceFile('HomeBriefingFixture.tsx', fixture, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const elements: ts.JsxElement[] = [];
  const visit = (node: ts.Node) => { if (ts.isJsxElement(node)) elements.push(node); ts.forEachChild(node, visit); };
  visit(tree);
  const label = elements.find(node => node.openingElement.tagName.getText(tree) === 'label');
  const select = elements.find(node => node.openingElement.tagName.getText(tree) === 'select');
  assert.ok(label && select);
  const literalAttribute = (node: ts.JsxElement, name: string) => {
    const attr = node.openingElement.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(tree) === name);
    return attr && ts.isJsxAttribute(attr) && attr.initializer && ts.isStringLiteral(attr.initializer) ? attr.initializer.text : '';
  };
  assert.equal(literalAttribute(label, 'htmlFor'), 'synthetic-home-briefing-scenario');
  assert.equal(literalAttribute(select, 'id'), 'synthetic-home-briefing-scenario');
  assert.equal(label.children.length, 1, 'nested options must not become part of the exact label text');
  assert.ok(ts.isJsxText(label.children[0]));
  assert.equal(label.children[0].text, 'Synthetic home briefing scenario');
  assert.equal(label.parent, select.parent, 'label and control are siblings, not an option-containing wrapper');
  for (const name of ['aria-label', 'aria-labelledby']) assert.equal(literalAttribute(select, name), '');
  const native = readFileSync('tests/browser-cloud/home-briefing.spec.ts', 'utf8');
  assert.ok(native.includes("page.getByLabel('Synthetic home briefing scenario', { exact: true })"));
});
