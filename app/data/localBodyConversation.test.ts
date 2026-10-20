import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalBodyNarrative, isLocalBodyQuestion, shouldUseLocalBodyConversation, remoteChatHistory, LOCAL_BODY_NOTICE } from './localBodyConversation.ts';
import { buildBodyWorkoutReview } from './bodyWorkoutReview.ts';
import { EMPTY_USER_WORKOUT_SETTINGS } from './userWorkoutSettings.ts';
import { buildCurrentWorkoutSettings } from './currentWorkoutDirection.ts';

for (const question of ['인바디 분석해줘', 'BMI 23 저장해줘', '체지방 삭제해줘', '근육량으로 진단해줘', 'body composition review']) {
  test(`body request remains local even if unsupported: ${question}`, () => assert.equal(isLocalBodyQuestion(question), true));
}
test('ordinary commands retain their original routing', () => {
  for (const question of ['오늘 할 일 보여줘', '이번 달 지출 알려줘', '운동 완료했어', '일본어 복습']) assert.equal(isLocalBodyQuestion(question), false);
});
test('local question and answer are excluded from all future server chat history', () => {
  const messages = [
    { id: 'welcome', role: 'assistant' as const, text: 'hi' },
    { id: '1', role: 'user' as const, text: 'ordinary' },
    { id: '2', role: 'user' as const, text: 'health secret', localOnly: true },
    { id: '3', role: 'assistant' as const, text: 'health interpretation', localOnly: true },
  ];
  const before = JSON.stringify(messages);
  assert.deepEqual(remoteChatHistory(messages), [{ role: 'user', text: 'ordinary' }]);
  assert.equal(JSON.stringify(messages), before);
});
test('history window is selected after removing local context', () => {
  const messages = Array.from({ length: 20 }, (_, i) => ({ id: String(i), role: 'user' as const, text: String(i), localOnly: i >= 10 }));
  assert.deepEqual(remoteChatHistory(messages).map(item => item.text), ['2','3','4','5','6','7','8','9']);
});
const review = (pain = false) => buildBodyWorkoutReview(
  { inbody: {}, workouts: pain ? { '2026-10-20': { pullupPain: true } } : {}, conditions: {} },
  buildCurrentWorkoutSettings(structuredClone(EMPTY_USER_WORKOUT_SETTINGS)), 'five-day-fullbody-circuit', '2026-10-20',
);
test('narrative states missing evidence and no diagnostic or write capability', () => {
  const text = buildLocalBodyNarrative(review());
  assert.match(text, /마지막 체성분 기록 없음/);
  assert.match(text, /비교 가능한 체성분 근거가 부족/);
  assert.match(text, /진단하거나/);
  assert.match(text, /명령을 실행하지 않습니다/);
});
test('safety hold is preserved and does not present an exercise replacement', () => {
  const text = buildLocalBodyNarrative(review(true));
  assert.doesNotMatch(text, /검토할 변경:|현재 구성:/);
  assert.match(text, /통증/);
});
test('equipment explanation has no invented loads or excluded candidates', () => {
  const text = buildLocalBodyNarrative(review());
  assert.match(text, /맨몸/);
  assert.match(text, /제품 하중·밴드 저항 수치는 확인되지 않았습니다/);
  assert.doesNotMatch(text, /슬라이딩|힙브릿지/);
});
test('session-only history limitation is explicit', () => {
  assert.match(LOCAL_BODY_NOTICE, /영구 저장 없음/);
  assert.match(LOCAL_BODY_NOTICE, /이력이 사라집니다/);
});
test('keyword-free follow-ups remain local while body context is active', () => {
  for (const text of ['왜 그런 거야?', '그럼 23은 괜찮아?', '이전 답변 읽어줘', '다시 시도해줘']) {
    assert.equal(shouldUseLocalBodyConversation(text, true), true);
  }
});
test('ordinary exact queries work and explicit general mode releases unrelated questions', () => {
  assert.equal(shouldUseLocalBodyConversation('오늘 할 일 보여줘', true), false);
  assert.equal(shouldUseLocalBodyConversation('프랑스 수도는?', false), false);
  assert.equal(shouldUseLocalBodyConversation('BMI 알려줘', false), true);
  assert.equal(shouldUseLocalBodyConversation('오늘 할 일 보여줘 그리고 23은 괜찮아?', true), true);
});
test('restored conversations and unmarked body text cannot become server context', () => {
  const messages = [
    {id:'old',role:'assistant' as const,text:'지난 수치는 23',historyOnly:true},
    {id:'legacy',role:'assistant' as const,text:'BMI 23'},
    {id:'current',role:'user' as const,text:'오늘 할 일 보여줘'},
  ];
  assert.deepEqual(remoteChatHistory(messages),[{role:'user',text:'오늘 할 일 보여줘'}]);
});
