import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFreeConversation, FREE_CONVERSATIONS } from '../../data/freeConversation.ts';
import { CURRICULUM } from '../../data/curriculum.ts';
import { answerSessionQuestion, createLearningSession, normalizeLearningSession, retrySessionQuestion, updateSessionReviews } from '../../utils/learningSession.ts';
import { reviewInterval, reviewModality, reviewObservationFields, summarizeReviewMastery } from '../../utils/learningReview.ts';

test('회화는 5개 상황의 예문을 제공하며 자유 문장을 교정했다고 가장하지 않는다', () => {
  for (const situation of Object.keys(FREE_CONVERSATIONS) as (keyof typeof FREE_CONVERSATIONS)[]) {
    const example = FREE_CONVERSATIONS[situation];
    assert.equal(buildFreeConversation(situation, example.japanese).reply, example.reply);
    assert.equal(buildFreeConversation(situation, example.reading).source, 'local');
    const freeText = buildFreeConversation(situation, '틀린 자유 문장');
    assert.equal(freeText.correction, ''); assert.match(freeText.explanation, /자동 교정은 보류/);
  }
});

test('복습은 힌트·오답·응답 시간을 반영하고 입력을 선택식으로 풀면 타이핑 숙련도로 계산하지 않는다', () => {
  assert.equal(reviewInterval(3, true, { neededHelp: false, modality: 'meaning', responseMs: 11_000 }), 7);
  assert.equal(reviewInterval(3, true, { neededHelp: false, modality: 'meaning', responseMs: 13_000 }), 3);
  assert.equal(reviewInterval(7, true, { neededHelp: true, modality: 'typing', responseMs: 1000 }), 1);
  assert.equal(reviewInterval(30, false), 1);
  assert.equal(reviewInterval(0, true, { neededHelp: false, modality: 'meaning', responseMs: 90_000 }), 1);
  assert.equal(reviewModality('input', 'starter'), 'meaning'); assert.equal(reviewModality('input', 'reader'), 'typing');
});

test('새로 측정한 정답도 복습에 남고 반복 저장과 재시도로 성취를 부풀리지 않는다', () => {
  const lesson = CURRICULUM[0]; const now = new Date('2026-09-13T00:00:00Z');
  let session = answerSessionQuestion(createLearningSession(lesson.id, 5, 'starter'), 2, true, '정답', { responseMs: 2000, neededHelp: false, modality: 'meaning' });
  const once = updateSessionReviews([], lesson, session, now);
  assert.equal(once.length, 1); assert.equal(once[0].reviewCount, 1); assert.equal(once[0].intervalDays, 1);
  assert.deepEqual(updateSessionReviews(once, lesson, session, now), once);
  assert.equal(normalizeLearningSession(JSON.parse(JSON.stringify(session)), lesson)?.observations?.[2].responseMs, 2000);
  session = answerSessionQuestion(createLearningSession(lesson.id, 5, 'starter'), 2, false, '오답', { responseMs: 18000, neededHelp: true, modality: 'meaning' });
  session = answerSessionQuestion(retrySessionQuestion(session, 2), 2, true, '정답', { responseMs: 1000, neededHelp: false, modality: 'meaning' });
  const corrected = updateSessionReviews(once, lesson, session, now)[0];
  assert.equal(corrected.successStreak, 0); assert.equal(corrected.intervalDays, 1); assert.equal(corrected.lastResponseMs, 18000);
});

test('숙련도는 실제 측정한 문제만 포함하며 연속 정답과 간격 조건을 함께 확인한다', () => {
  const base = { id: 'x', lessonId: 'f01', lessonTitle: 'synthetic', prompt: '', explanation: '', createdAt: '' };
  const fields = reviewObservationFields({ ...base, successStreak: 2, reviewCount: 3 }, true, { responseMs: 1000, neededHelp: false, modality: 'listening' });
  const summary = summarizeReviewMastery([{ ...base, ...fields, intervalDays: 7 }, { ...base, id: 'old' }]);
  assert.equal(summary.find(item => item.modality === 'listening')?.stable, 1);
  assert.equal(summary.reduce((sum, item) => sum + item.observed, 0), 1);
});
