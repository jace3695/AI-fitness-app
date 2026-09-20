import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADVICE_QUESTIONS, detectAdviceScope } from './assistant-advice-intent.ts';

test('unified chat recognizes advice scopes and preserves write/query commands', () => {
  for (const [scope, question] of Object.entries(ADVICE_QUESTIONS)) assert.equal(detectAdviceScope(question), scope);
  for (const question of ['요즘 운동 잘하고 있어?', '식단 어떻게 하면 좋을까?', '최근 운동 기록을 분석해줘']) assert.equal(detectAdviceScope(question), 'fitness');
  assert.equal(detectAdviceScope('운동과 가계부 기록을 보고 조언해줘'), 'assistant');
  for (const command of ['오늘 운동 계획 보여줘', '오늘 걷기 20분 기록해줘', '할 일에 운동 조언받기 추가해줘', '오늘 식단 메모에 "소비를 줄이려면?" 기록해줘', '운동 완료했어', '가계부 금액 수정해줘', '오늘 일본어 학습 진도 알려줘']) assert.equal(detectAdviceScope(command), null, command);
});
