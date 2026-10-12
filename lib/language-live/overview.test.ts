import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { parseLiveReport } from './report-parser.ts';
import { liveOverviewDate, projectLiveOverview } from './overview.ts';
import type { LiveLearningBatch, LiveLearningEvent, LiveLearningSnapshot } from './learning-types.ts';
import type { LiveLesson } from './types.ts';

const owner = randomUUID(), other = randomUUID();
function lesson(date: string | null = '2026-10-09', stage = '기초', patch: Partial<LiveLesson> = {}): LiveLesson {
  return { user_id: owner, lesson_id: randomUUID(), revision: 1, operation: 'create', previous_revision: 0,
    request_id: randomUUID(), payload_hash: 'synthetic', created_at: '2026-10-09T15:00:00Z', restored_from_revision: null, duplicate_reason: null,
    report: parseLiveReport(`[연이 AI 일본어 학습 기록 v1.1]\n학습 날짜: ${date ?? '미확인'}\n수업 주제: 합성 수업\n현재 학습 단계: ${stage}\n읽기 학습 결과: え를 새로 배웠다.`), ...patch };
}
function event(patch: Partial<LiveLearningEvent> = {}): LiveLearningEvent {
  return { eventId: randomUUID(), item: { itemId: randomUUID(), kind: 'kana', text: 'え', meaning: '' }, skill: 'reading', kind: 'learn', result: 'not_assessed',
    occurredDate: '2026-10-09', certainty: 'confirmed', independent: null, hintUsed: null, forgettingConfirmed: false, evidenceText: 'え를 새로 배웠다.', sourceField: 'reading',
    reason: '합성 관찰', relearningText: '', linkedRelearningEventId: null, teacherRecommendedDue: null, teacherRecommendationConfirmed: false, ...patch };
}
function batch(source: LiveLesson, events: LiveLearningEvent[], version = 1): LiveLearningBatch {
  const requestId = randomUUID();
  return { user_id: source.user_id, lesson_id: source.lesson_id, lesson_revision: source.revision, version, previous_version: version - 1,
    request_id: requestId, payload_hash: 'synthetic', created_at: '2026-10-09T15:00:00Z',
    payload: { requestId, lessonId: source.lesson_id, lessonRevision: source.revision, expectedVersion: version - 1, confirmed: true, policyVersion: 'live-review-v1', events, changeReason: '합성 확인' } };
}
const snapshot = (lessons: LiveLesson[] = [], batches: LiveLearningBatch[] = []): LiveLearningSnapshot => ({ ownerId: owner, lessons, batches });

test('empty verified snapshots have unknown stage and zero recorded facts without mutating input', () => {
  const source = snapshot(), original = structuredClone(source), result = projectLiveOverview(source, '2026-10-10');
  assert.equal(result.stage, null); assert.equal(result.latestDate, null); assert.equal(result.lessons.length, 0);
  assert.deepEqual(result.calendar, {}); assert.deepEqual(result.reviewQueue, []); assert.deepEqual(source, original);
});

test('recent lesson date outranks import time and an unknown latest stage never falls back to old progress', () => {
  const old = lesson('2026-10-08', '상급', { created_at: '2026-10-11T00:00:00Z' });
  const current = lesson('2026-10-09', '미확인', { created_at: '2026-10-10T00:00:00Z' });
  const result = projectLiveOverview(snapshot([old, current]), '2026-10-10');
  assert.equal(result.latestDate, '2026-10-09'); assert.equal(result.stage, null); assert.deepEqual(result.recentLessons, [current]);
});

test('same-day stage conflicts and partial unknowns cannot be decided by timestamp or UUID', () => {
  const one = lesson(), two = lesson(undefined, '초급');
  let result = projectLiveOverview(snapshot([one, two]), '2026-10-10');
  assert.equal(result.stage, null); assert.equal(result.stageAmbiguous, true);
  two.report = parseLiveReport('학습 날짜: 2026-10-09\n현재 학습 단계: 미확인');
  result = projectLiveOverview(snapshot([one, two]), '2026-10-10'); assert.equal(result.stage, null);
  two.report = structuredClone(one.report);
  result = projectLiveOverview(snapshot([two, one]), '2026-10-10'); assert.equal(result.stage, '기초'); assert.equal(result.recentLessons.length, 2);
});

test('future lessons and observations stay out of current progress without resurrecting superseded evidence', () => {
  const current = lesson(), future = lesson('2026-10-11', '상급'), item = event();
  const before = batch(current, [item]), replacement = batch(current, [event({ ...item, occurredDate: '2026-10-11' })], 2);
  const result = projectLiveOverview(snapshot([current, future], [before, replacement, batch(future, [event({ occurredDate: '2026-10-11' })])]), '2026-10-10');
  assert.equal(result.stage, '기초'); assert.equal(result.lessons.length, 1); assert.equal(result.futureLessons, 1); assert.equal(result.futureObservations, 2);
  assert.equal(result.learning.states.length, 0); assert.equal(result.learning.inactiveBatches.includes(before), false, 'projection copies rather than mutates batches');
  assert.equal(result.learning.inactiveBatches.some(value => value.request_id === before.request_id), true);
  assert.equal(result.calendar['2026-10-11'], undefined);
});

test('edited deleted and restored reports do not activate stale evidence from an older source revision', () => {
  const original = lesson(), evidence = batch(original, [event({ kind: 'forgetting', result: 'cannot_recall', forgettingConfirmed: true })]);
  assert.equal(projectLiveOverview(snapshot([original], [evidence]), '2026-10-10').relearning.length, 1);
  for (const operation of ['edit', 'delete', 'restore'] as const) {
    const changed = { ...original, operation, revision: 2, previous_revision: 1 };
    const result = projectLiveOverview(snapshot([changed], [evidence]), '2026-10-10');
    assert.equal(result.relearning.length, 0); assert.equal(result.due.length, 0);
    assert.equal(result.lessons.length, operation === 'delete' ? 0 : 1);
    assert.equal(result.calendar['2026-10-09']?.lessons.length ?? 0, operation === 'delete' ? 0 : 1);
  }
});

test('owner mismatches and multiple current revisions fail closed', () => {
  const source = lesson();
  assert.throws(() => projectLiveOverview(snapshot([{ ...source, user_id: other }]), '2026-10-10'), /owner_or_source/);
  assert.throws(() => projectLiveOverview(snapshot([source], [{ ...batch(source, []), user_id: other }]), '2026-10-10'), /owner_or_source/);
  assert.throws(() => projectLiveOverview(snapshot([source, source]), '2026-10-10'), /owner_or_source/);
  assert.throws(() => projectLiveOverview(snapshot(), '2026-02-29'), /invalid_overview_date/);
});

test('calendar leap month and year boundaries preserve report dates and policy due dates', () => {
  for (const [date, due] of [['2024-02-28', '2024-02-29'], ['2024-02-29', '2024-03-01'], ['2026-12-31', '2027-01-01']]) {
    const source = lesson(date), result = projectLiveOverview(snapshot([source], [batch(source, [event({ occurredDate: date })])]), date);
    assert.equal(result.calendar[date].lessons.length, 1); assert.equal(result.calendar[due].planned.length, 1);
    assert.equal(result.due.length, 0); assert.equal(result.calendar[due].lessons.length, 0);
  }
});

test('Korean dates change at 15:00 UTC regardless of browser timezone', () => {
  assert.equal(liveOverviewDate(new Date('2026-12-31T14:59:59.999Z')), '2026-12-31');
  assert.equal(liveOverviewDate(new Date('2026-12-31T15:00:00.000Z')), '2027-01-01');
  assert.equal(liveOverviewDate(new Date('2024-02-28T15:00:00Z')), '2024-02-29');
});

test('same-day lessons and review activities have separate counts from independent four-skill due items', () => {
  const first = lesson(), second = lesson(), item = event();
  const reading = { ...item, kind: 'review' as const, result: 'independent_correct' as const, independent: true, hintUsed: false };
  const writing = event({ item: item.item, skill: 'writing', kind: 'relearn', relearningText: '다시 연습' });
  const result = projectLiveOverview(snapshot([first, second], [batch(first, [reading, writing]), batch(second, [event({ ...reading, eventId: randomUUID() })])]), '2026-10-10');
  assert.equal(result.lessons.length, 2); assert.equal(result.calendar['2026-10-09'].lessons.length, 2);
  assert.equal(result.calendar['2026-10-09'].reviews, 2); assert.equal(result.calendar['2026-10-09'].relearning, 1);
  assert.equal(result.learning.states.length, 2); assert.equal(result.due.length, 2); assert.equal(result.calendar['2026-10-10'].planned.length, 2);
  assert.equal(result.learning.states.find(value => value.skill === 'reading')!.independentSuccessCount, 1);
  assert.equal(result.learning.states.some(value => value.skill === 'speaking'), false);
});

test('undated observations remain in history and uncertainty is not a confirmed calendar activity', () => {
  const source = lesson(null, '上級');
  const result = projectLiveOverview(snapshot([source], [batch(source, [event({ occurredDate: null }), event({ kind: 'review', certainty: 'uncertain', result: 'uncertain' })])]), '2026-10-10');
  assert.equal(result.stage, null); assert.equal(result.undatedLessons, 1); assert.equal(result.undatedObservations, 1);
  assert.equal(result.learning.states.length, 2); assert.deepEqual(result.calendar, {});
  assert.equal(result.learning.states.some(state => state.status === 'mastery_confirmed'), false);
});
