import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HomeOverviewProps } from '../components/HomeOverview';
import { buildAssistantNextAction } from '../app/data/assistantNextAction.ts';
import { briefingScenario, type HomeBriefingScenario } from '../scripts/browser-qa/cloud/home-briefing-scenarios.ts';

const require = createRequire(import.meta.url);
const source = readFileSync('components/HomeOverview.tsx', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;
const output: { default?: ComponentType<HomeOverviewProps> } = {};
vm.runInNewContext(`(function(exports, require){${compiled}\n})`)(output, (name: string) => {
  if (['react/jsx-runtime', 'next/link'].includes(name)) return require(name);
  throw new Error(`Unexpected overview dependency: ${name}`);
});
assert.ok(output.default);
const Component = output.default;
const render = (scenario: HomeBriefingScenario, overrides: Partial<HomeOverviewProps> = {}) => renderToStaticMarkup(createElement(Component, {
  action: buildAssistantNextAction(briefingScenario(scenario)), loading: false, failures: [], lastLoadedAt: null, onRetry() {}, ...overrides,
}));

test('home presents the same read-only overview before chat, list and app cards without moving acquisition or priority logic', () => {
  const assistant = readFileSync('app/assistant/AssistantClient.tsx', 'utf8');
  const call = '<HomeOverview action={nextAction} loading={loading} failures={loadFailures} lastLoadedAt={lastLoadedAt} onRetry={() => void load()} />';
  assert.ok(assistant.includes(call));
  for (const id of ['yeoni-chat', 'assistant-list', 'today-apps', 'daily-briefing']) assert.ok(assistant.indexOf(call) < assistant.indexOf(`<${id === 'daily-briefing' ? 'details' : 'section'} id="${id}"`));
  assert.match(assistant, /const nextAction = loading \|\| unavailableAll \? null : buildAssistantNextAction\(nextActionInput\)/);
  assert.match(assistant, /const unavailableAll = loadFailures.includes\('연결 확인'\) \|\| loadFailures.includes\('로그인 확인'\)/);
  assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|supabase|useEffect|setTimeout|line-clamp|truncate/);
  const fixture = readFileSync('scripts/browser-qa/cloud/HomeOverviewFixture.tsx', 'utf8');
  assert.match(fixture, /import HomeOverview from '\.\.\/\.\.\/\.\.\/components\/HomeOverview'/);
  assert.match(fixture, /<HomeOverview action=\{action\}/);
  assert.doesNotMatch(fixture, /fetch\(|localStorage|sessionStorage|process\.env|dangerouslySetInnerHTML/);
});

test('loading suppresses even a supplied stale action but retains navigation to existing home sections', () => {
  const markup = render('due-priority', { loading: true });
  assert.match(markup, /role="status"[^>]*>현재 기록을 확인하고 있어요\./);
  assert.doesNotMatch(markup, /합성 오늘 마감|연이가 고른 다음 한 걸음/);
  assert.match(markup, /href="#yeoni-chat"/);
  assert.match(markup, /href="#today-apps"/);
});

test('unavailable records show the failure and retry instead of an empty-success or action', () => {
  const markup = render('empty', { action: null, failures: ['연결 확인'] });
  assert.match(markup, /연결 확인 정보를 불러오지 못했어요/);
  assert.match(markup, /아래 숫자를 현재 기록으로 판단하지 마세요/);
  assert.match(markup, /다시 불러오기/);
  assert.doesNotMatch(markup, /달력에서 일정을 확인해요|모두 완료/);
  const pending = render('due-priority', { loading: true, failures: ['할 일'], lastLoadedAt: '합성 시각' });
  assert.match(pending, /마지막 정상 확인 합성 시각의 값을 유지합니다/);
  assert.match(pending, /<button[^>]*disabled=""/);
  assert.doesNotMatch(pending, /합성 오늘 마감/);
});

test('partial failure preserves the successful-domain fallback and does not promote stale failed records', () => {
  const markup = render('partial-failure', { failures: ['할 일', '가계부'], lastLoadedAt: '합성 시각' });
  assert.match(markup, /할 일 · 가계부 정보를 불러오지 못했어요/);
  assert.match(markup, /통합 달력 보기/);
  assert.doesNotMatch(markup, /합성 조회 실패 영역의 이전 할 일|999,999/);
});

test('empty and completed records keep the neutral fallback without asserting all work is complete', () => {
  for (const scenario of ['empty', 'completed'] as const) {
    const markup = render(scenario);
    assert.match(markup, /이 화면에서 우선 안내할 항목이 없어요/);
    assert.match(markup, /미기록은 미수행으로 단정하지 않습니다/);
    assert.doesNotMatch(markup, /모두 완료|조회 실패|불러오지 못했어요/);
  }
});

test('the primary title, CTA and exact destination preserve the existing due, important, budget order', () => {
  for (const [scenario, title, label, href] of [
    ['due-priority', '합성 오늘 마감', '할 일 확인', '#assistant-list'],
    ['important-priority', '합성 중요 할 일', '할 일 확인', '#assistant-list'],
    ['budget-next', '2,500원 초과했어요', '가계부에서 확인', '/budget'],
  ] as const) {
    const markup = render(scenario);
    assert.ok(markup.includes(title));
    assert.ok(markup.includes(`href="${href}"`));
    assert.ok(markup.includes(`${label} →`));
    assert.doesNotMatch(markup, /합성 완료 항목|합성 취소 항목/);
  }
});

test('long action text is retained in full rather than visually truncated', () => {
  const action = buildAssistantNextAction(briefingScenario('due-priority'));
  action.title = '긴 합성 제목 '.repeat(30);
  const markup = render('due-priority', { action });
  assert.ok(markup.includes(action.title));
  assert.match(markup, /\[overflow-wrap:anywhere\]/);
});
