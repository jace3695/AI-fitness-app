import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAssistantNextAction, type AssistantNextActionInput } from './assistantNextAction.ts';
import { EMPTY_DIET_DAILY_STATUS, EMPTY_FITNESS_DAILY_STATUS, EMPTY_LANGUAGE_DAILY_STATUS } from './dailyAppStatus.ts';

function input(patch: Partial<AssistantNextActionInput> = {}): AssistantNextActionInput {
  return {
    items: [], budget: { remaining: 1000 },
    fitness: { ...EMPTY_FITNESS_DAILY_STATUS, synced: true, title: '전신 근력', completed: true },
    diet: { ...EMPTY_DIET_DAILY_STATUS, synced: true, completed: true },
    language: { ...EMPTY_LANGUAGE_DAILY_STATUS, synced: true, completed: 5, total: 5 },
    growth: { completed: 2, total: 2 }, todayKey: '2026-09-12', hour: 12, ...patch,
  };
}

test('오늘 또는 지난 마감의 할 일을 가장 먼저 고른다', () => {
  const action = buildAssistantNextAction(input({ items: [
    { title: '중요하지만 나중 일', kind: 'task', status: 'open', priority: 5, due_at: null, created_at: '2026-09-01T00:00:00Z' },
    { title: '오늘 할 일', kind: 'task', status: 'open', priority: 3, due_at: '2026-09-12T23:59:00+09:00', created_at: '2026-09-02T00:00:00Z' },
  ] }));
  assert.equal(action.area, 'task');
  assert.equal(action.title, '오늘 할 일');
});

test('예산 초과는 일반 앱 루틴보다 먼저 확인한다', () => {
  const action = buildAssistantNextAction(input({ budget: { remaining: -12345 }, language: { ...EMPTY_LANGUAGE_DAILY_STATUS, synced: true } }));
  assert.equal(action.area, 'budget');
  assert.equal(action.href, '/budget');
});

test('운동일에는 완료하지 않은 실제 계획으로 연결한다', () => {
  const action = buildAssistantNextAction(input({ fitness: { synced: true, title: '전신 근력 서킷', detail: '월요일 계획', completed: false, isRest: false } }));
  assert.equal(action.area, 'fitness');
  assert.equal(action.href, '/fitness');
});

test('언어 앱이 알려준 정확한 다음 학습 주소를 사용한다', () => {
  const action = buildAssistantNextAction(input({ language: { synced: true, completed: 2, total: 5, nextLabel: '다음 학습: 문장', nextHref: '/language/sentences' } }));
  assert.equal(action.area, 'language');
  assert.equal(action.label, '문장 학습 시작');
  assert.equal(action.href, '/language/sentences');
});

test('저녁의 미완료 식단과 남은 성장 루틴을 순서대로 안내한다', () => {
  const diet = buildAssistantNextAction(input({ hour: 20, diet: { synced: true, completed: false, title: '오늘 식단 확인', detail: '간단히 남겨보세요.' }, growth: { completed: 0, total: 2 } }));
  assert.equal(diet.area, 'diet');
  const growth = buildAssistantNextAction(input({ diet: { ...EMPTY_DIET_DAILY_STATUS, synced: false }, growth: { completed: 0, total: 2 } }));
  assert.equal(growth.area, 'growth');
});

test('조회에 실패한 영역은 빈 값으로 추천하지 않는다', () => {
  const action = buildAssistantNextAction(input({ budget: { remaining: -1000 }, available: { budget: false } }));
  assert.equal(action.area, 'calendar');
});
