import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLiveReport } from './report-parser.ts';
import {
  LIVE_REVIEW_POLICY_VERSION, LIVE_SKILLS, type LiveItemIdentity, type LiveLearningBatch,
  type LiveLearningEvent, type LiveLearningSnapshot, type LiveSkillState,
} from './learning-types.ts';
import type { LiveLesson } from './types.ts';
import { projectLiveLearning } from './state-reducer.ts';
import {
  addLiveCalendarDays, liveCalendarDaysBetween, livePracticeHref, liveReviewQueue,
  LIVE_MASTERY_MIN_DISTINCT_DATES, LIVE_MASTERY_MIN_SPAN_DAYS, LIVE_MASTERY_MIN_SUCCESSES,
} from './review-policy.ts';

const ownerId = '00000000-0000-4000-8000-000000000001';
const item: LiveItemIdentity = { itemId: '00000000-0000-4000-8000-000000000002', kind: 'kana', text: 'え', meaning: '' };
const uuid = (index: number) => `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
function lesson(index = 10, date: string | null = '2026-10-01', changes: Partial<LiveLesson> = {}): LiveLesson {
  return { user_id: ownerId, lesson_id: uuid(index), revision: 1, operation: 'create',
    report: parseLiveReport(`학습 날짜: ${date ?? '미확인'}\n수업 주제: 합성 수업`),
    created_at: '2026-10-09T23:59:59Z', request_id: uuid(index + 100), payload_hash: `lesson-${index}`,
    previous_revision: 0, restored_from_revision: null, duplicate_reason: null, ...changes };
}
function event(index: number, date: string | null, changes: Partial<LiveLearningEvent> = {}): LiveLearningEvent {
  return { eventId: uuid(index + 1000), item, skill: 'reading', kind: 'review', result: 'independent_correct',
    occurredDate: date, certainty: 'confirmed', independent: true, hintUsed: false, forgettingConfirmed: false,
    evidenceText: '새 문맥에서 힌트 없이 읽음', sourceField: 'reading', reason: '사용자가 확인한 평가',
    relearningText: '', linkedRelearningEventId: null, teacherRecommendedDue: null,
    teacherRecommendationConfirmed: false, ...changes };
}
const learn = (index: number, date: string | null, changes: Partial<LiveLearningEvent> = {}) => event(index, date,
  { kind: 'learn', result: 'not_assessed', independent: null, hintUsed: null, evidenceText: '글자를 학습함', ...changes });
const error = (index: number, date: string | null, changes: Partial<LiveLearningEvent> = {}) => event(index, date,
  { result: 'incorrect', independent: false, hintUsed: false, evidenceText: '글자를 혼동함', ...changes });
function batch(source: LiveLesson, events: LiveLearningEvent[], version = 1, changes: Partial<LiveLearningBatch> = {}): LiveLearningBatch {
  return { user_id: source.user_id, lesson_id: source.lesson_id, lesson_revision: source.revision,
    version, previous_version: version - 1, request_id: uuid(2000 + version), payload_hash: `batch-${version}`,
    created_at: '2026-10-09T23:59:59Z', payload: { requestId: uuid(2000 + version), lessonId: source.lesson_id,
      lessonRevision: source.revision, expectedVersion: version - 1, confirmed: true,
      policyVersion: LIVE_REVIEW_POLICY_VERSION, events, changeReason: '합성 자료 확인' }, ...changes };
}
function projection(events: LiveLearningEvent[]) {
  const source = lesson();
  return projectLiveLearning({ ownerId, lessons: [source], batches: [batch(source, events)] });
}
const state = (events: LiveLearningEvent[]) => projection(events).states[0];
const masteryEvents = () => [learn(1, '2026-10-01'), event(2, '2026-10-02'), event(3, '2026-10-05'), event(4, '2026-10-09')];

test('empty and unconfirmed lessons do not invent four skill states or unlearned results', () => {
  const source = lesson();
  const result = projectLiveLearning({ ownerId, lessons: [source], batches: [] });
  assert.deepEqual(result.states, []);
  assert.deepEqual(result.unconfirmedLessons, [source]);
  assert.equal(result.policyVersion, 'live-review-v1');
  const unknown = state([event(1, '2026-10-01', { result: 'not_assessed', independent: null, hintUsed: null })]);
  assert.equal(unknown.status, null);
  assert.equal(unknown.nextDue, null);
  assert.equal(unknown.needsAssessment, true);
  const unlearned = state([learn(1, null, { kind: 'not_learned' })]);
  assert.equal(unlearned.status, 'unlearned');
  assert.equal(unlearned.firstLearnedDate, null);
});

test('first learning schedules next calendar day, independent of the import timestamp', () => {
  const result = state([learn(1, '2026-10-01')]);
  assert.equal(result.status, 'learning');
  assert.equal(result.firstLearnedDate, '2026-10-01');
  assert.equal(result.nextDue, '2026-10-02');
  assert.equal(result.policyDue, '2026-10-02');
  assert.equal(result.intervalDays, 1);
  assert.equal(result.reviewCount, 0);
  assert.equal(result.independentSuccessCount, 0);
});

test('successful dated reviews advance 1/3/7/14/30 and remain scheduled after 30', () => {
  const events = [learn(1, '2026-01-01'), event(2, '2026-01-02'), event(3, '2026-01-05'),
    event(4, '2026-01-12'), event(5, '2026-01-26'), event(6, '2026-02-25')];
  const intervals = [1, 3, 7, 14, 30, 30];
  const dues = ['2026-01-02', '2026-01-05', '2026-01-12', '2026-01-26', '2026-02-25', '2026-03-27'];
  for (let count = 1; count <= events.length; count += 1) {
    const result = state(events.slice(0, count));
    assert.equal(result.intervalDays, intervals[count - 1]);
    assert.equal(result.nextDue, dues[count - 1]);
  }
  const result = state(events);
  assert.equal(result.status, 'mastery_confirmed');
  assert.equal(result.reviewCount, 5);
  assert.equal(result.independentSuccessCount, 5);
  assert.equal(result.lastReviewedDate, '2026-02-25');
});

test('same-day successes across distinct lessons count once for interval and mastery', () => {
  const first = lesson(10), second = lesson(20);
  const result = projectLiveLearning({ ownerId, lessons: [second, first], batches: [
    batch(second, [event(4, '2026-10-02'), event(5, '2026-10-02')]),
    batch(first, [learn(1, '2026-10-01'), event(2, '2026-10-02'), event(3, '2026-10-02')]),
  ] }).states[0];
  assert.equal(result.reviewCount, 4);
  assert.equal(result.independentSuccessCount, 1);
  assert.equal(result.intervalDays, 3);
  assert.equal(result.status, 'learning');
  assert.equal(result.nextDue, '2026-10-05');
  assert.equal(result.history.length, 5);
});

test('same-day success after learning or corrective practice keeps next-day reassessment', () => {
  for (const start of [learn(1, '2026-10-01'), error(1, '2026-10-01'), event(1, '2026-10-01', { result: 'hinted_correct', independent: false, hintUsed: true })]) {
    const result = state([start, event(2, '2026-10-01'), event(3, '2026-10-01')]);
    assert.equal(result.intervalDays, 1);
    assert.equal(result.nextDue, '2026-10-02');
    assert.equal(result.independentSuccessCount, 1);
  }
});

test('mastery needs 3 distinct independent-success dates and a span of at least 7 days', () => {
  assert.equal(LIVE_MASTERY_MIN_SUCCESSES, 3);
  assert.equal(LIVE_MASTERY_MIN_DISTINCT_DATES, 3);
  assert.equal(LIVE_MASTERY_MIN_SPAN_DAYS, 7);
  assert.equal(state([event(1, '2026-10-01'), event(2, '2026-10-01'), event(3, '2026-10-08')]).status, 'learning');
  assert.equal(state([event(1, '2026-10-01'), event(2, '2026-10-02'), event(3, '2026-10-07')]).status, 'learning');
  const result = state([event(1, '2026-10-01'), event(2, '2026-10-02'), event(3, '2026-10-08')]);
  assert.equal(result.status, 'mastery_confirmed');
  assert.deepEqual(result.masteryHistory.map(reference => reference.eventId), [uuid(1003)]);
});

test('independent success needs explicit independent/no-hint flags and evidence', () => {
  for (const changes of [{ independent: null }, { hintUsed: null }, { independent: false }, { hintUsed: true }, { evidenceText: '' }]) {
    const result = state([event(1, '2026-10-01', changes)]);
    assert.equal(result.status, null);
    assert.equal(result.independentSuccessCount, 0);
    assert.equal(result.nextDue, null);
    assert.equal(result.needsAssessment, true);
  }
});

test('hinted success schedules close reassessment and does not count independent success', () => {
  const result = state([learn(1, '2026-10-01'), event(2, '2026-10-02', { result: 'hinted_correct', independent: false, hintUsed: true })]);
  assert.equal(result.status, 'review_due');
  assert.equal(result.nextDue, '2026-10-03');
  assert.equal(result.independentSuccessCount, 0);
  assert.equal(result.needsAssessment, true);
});

test('one error or multiple errors on the same date are not confirmed forgetting', () => {
  for (const errors of [[error(2, '2026-10-02')], [error(2, '2026-10-02'), error(3, '2026-10-02')]]) {
    const result = state([learn(1, '2026-10-01'), ...errors]);
    assert.equal(result.status, 'review_due');
    assert.equal(result.nextDue, '2026-10-03');
    assert.equal(result.errorCount, errors.length);
  }
});

test('two different dated errors since the last independent success trigger relearning', () => {
  const result = state([learn(1, '2026-10-01'), error(2, '2026-10-02'), error(3, '2026-10-03')]);
  assert.equal(result.status, 'relearn_needed');
  assert.equal(result.errorCount, 2);
  assert.equal(result.nextDue, '2026-10-04');
  const recovered = state([learn(1, '2026-10-01'), error(2, '2026-10-02'), event(3, '2026-10-03'), error(4, '2026-10-04')]);
  assert.equal(recovered.status, 'review_due');
  assert.equal(recovered.errorCount, 2);
});

test('confirmed forgetting preserves prior mastery evidence and original learning date', () => {
  const events = [...masteryEvents(), error(5, '2026-10-10', { kind: 'forgetting', result: 'cannot_recall', forgettingConfirmed: true })];
  const result = state(events);
  assert.equal(result.status, 'relearn_needed');
  assert.equal(result.firstLearnedDate, '2026-10-01');
  assert.equal(result.masteryHistory.length, 1);
  assert.equal(result.masteryHistory[0].eventId, uuid(1004));
  const transition = result.history.at(-1)!;
  assert.equal(transition.previousStatus, 'mastery_confirmed');
  assert.equal(transition.status, 'relearn_needed');
  assert.equal(transition.event, events.at(-1));
  assert.match(transition.reason, /사용자가 확인한 평가/);
});

test('relearning and same-day reassessment restart a fresh spaced mastery run', () => {
  const events = [...masteryEvents(), error(5, '2026-10-10', { forgettingConfirmed: true }),
    learn(6, '2026-10-10', { kind: 'relearn', relearningText: '글자 대조 연습' }),
    event(7, '2026-10-10', { kind: 'reassessment', linkedRelearningEventId: uuid(1006) }),
    event(8, '2026-10-10')];
  const immediately = state(events);
  assert.equal(immediately.status, 'learning');
  assert.equal(immediately.nextDue, '2026-10-11');
  assert.equal(immediately.intervalDays, 1);
  assert.equal(immediately.masteryHistory.length, 1);
  assert.equal(immediately.history[6].event.linkedRelearningEventId, uuid(1006));
  assert.equal(state([...events, event(9, '2026-10-13')]).status, 'learning');
  const spaced = state([...events, event(9, '2026-10-13'), event(10, '2026-10-17')]);
  assert.equal(spaced.status, 'mastery_confirmed');
  assert.equal(spaced.masteryHistory.length, 2);
  assert.equal(spaced.firstLearnedDate, '2026-10-01');
});

test('relearning without a forgetting label still prevents immediate mastery', () => {
  const result = state([...masteryEvents(), learn(5, '2026-10-10', { kind: 'relearn', relearningText: '다시 읽기' }), event(6, '2026-10-10')]);
  assert.equal(result.status, 'learning');
  assert.equal(result.masteryHistory.length, 1);
});

test('reassessment requires an active linked relearn of the same item/skill and known earlier date', () => {
  const link = learn(5, '2026-10-10', { kind: 'relearn', relearningText: '글자 재학습' });
  const assessment = event(6, '2026-10-11', { kind: 'reassessment', linkedRelearningEventId: link.eventId });
  const available = state([...masteryEvents(), link, assessment]);
  assert.equal(available.independentSuccessCount, 4);
  assert.equal(available.lastAssessedDate, '2026-10-11');
  for (const changed of [null, { ...link, skill: 'writing' as const }, { ...link, item: { ...item, itemId: uuid(999) } }, { ...link, occurredDate: null }, { ...link, occurredDate: '2026-10-12' }, { ...link, certainty: 'uncertain' as const }]) {
    const result = state([...masteryEvents(), ...(changed ? [changed] : []), assessment]);
    const reading = result.skill === 'reading' ? result : projection([...masteryEvents(), ...(changed ? [changed] : []), assessment]).states.find(entry => entry.skill === 'reading')!;
    assert.equal(reading.independentSuccessCount, 3);
    assert.match(reading.history.find(entry => entry.eventId === assessment.eventId)!.reason, /연결된 재학습/);
  }
});

test('explicit same-day cross-lesson links order relearning and its prior events before reassessment', () => {
  // UUID order is deliberately opposite to the confirmed causal link.
  const source = lesson(30, '2026-10-10'), later = lesson(20, '2026-10-10');
  const learning = learn(6, '2026-10-10', { kind: 'relearn', relearningText: '새 연습' });
  const assessment = event(7, '2026-10-10', { kind: 'reassessment', linkedRelearningEventId: learning.eventId });
  const history = [batch(source, [...masteryEvents(), error(5, '2026-10-10', { forgettingConfirmed: true }), learning]), batch(later, [assessment])];
  const result = projectLiveLearning({ ownerId, lessons: [later, source], batches: history }).states[0];
  assert.deepEqual(result.history.slice(-3).map(entry => entry.eventId), [uuid(1005), learning.eventId, assessment.eventId]);
  assert.equal(result.lastResult, 'independent_correct');
  assert.equal(result.status, 'learning');
  assert.equal(result.independentSuccessCount, 4);
  assert.equal(result.nextDue, '2026-10-11');
  assert.equal(result.masteryHistory.length, 1);
});

test('contradictory same-day causal links preserve history without creating assessed successes', () => {
  const one = lesson(10), two = lesson(20);
  const first = learn(1, '2026-10-01', { kind: 'relearn', relearningText: '첫 연습' });
  const second = learn(2, '2026-10-01', { kind: 'relearn', relearningText: '둘째 연습' });
  const firstAssessment = event(3, '2026-10-01', { kind: 'reassessment', linkedRelearningEventId: second.eventId });
  const secondAssessment = event(4, '2026-10-01', { kind: 'reassessment', linkedRelearningEventId: first.eventId });
  const result = projectLiveLearning({ ownerId, lessons: [one, two], batches: [
    batch(one, [firstAssessment, first]), batch(two, [secondAssessment, second]),
  ] }).states[0];
  assert.equal(result.history.length, 4);
  assert.equal(result.independentSuccessCount, 0);
  assert.equal(result.masteryHistory.length, 0);
  assert.equal(result.needsAssessment, true);
  assert.ok(result.history.filter(entry => entry.event.kind === 'reassessment').every(entry => /연결된 재학습/.test(entry.reason)));
});

test('deleting a linked relearn source preserves reassessment history without retaining its success', () => {
  const earlier = lesson(), later = lesson(20, '2026-10-02');
  const learning = learn(1, '2026-10-01', { kind: 'relearn', relearningText: '새 연습' });
  const assessment = event(2, '2026-10-02', { kind: 'reassessment', linkedRelearningEventId: learning.eventId });
  const evidence = [batch(earlier, [learning]), batch(later, [assessment])];
  const before = projectLiveLearning({ ownerId, lessons: [earlier, later], batches: evidence });
  assert.equal(before.states[0].independentSuccessCount, 1);
  const after = projectLiveLearning({ ownerId, lessons: [{ ...earlier, revision: 2, operation: 'delete' }, later], batches: evidence });
  assert.equal(after.states[0].independentSuccessCount, 0);
  assert.equal(after.states[0].status, null);
  assert.equal(after.states[0].needsAssessment, true);
  assert.equal(after.states[0].nextDue, null);
  assert.equal(after.states[0].history[0].eventId, assessment.eventId);
  assert.equal(after.inactiveBatches.length, 1);
});

test('uncertain/ASR results preserve prior state, assessed evidence, success count and due', () => {
  const prior = state(masteryEvents());
  for (const changes of [{ result: 'uncertain' as const, certainty: 'confirmed' as const }, { result: 'incorrect' as const, certainty: 'uncertain' as const }, { result: 'independent_correct' as const, certainty: 'uncertain' as const }]) {
    const result = state([...masteryEvents(), event(5, '2026-10-10', { ...changes, evidenceText: '음성 인식이 불명확함', teacherRecommendationConfirmed: true, teacherRecommendedDue: '2026-10-11' })]);
    for (const key of ['status', 'lastEvidence', 'lastResult', 'lastAssessedDate', 'nextDue', 'policyDue', 'intervalDays', 'independentSuccessCount', 'errorCount'] as const) assert.equal(result[key], prior[key], key);
    assert.equal(result.needsAssessment, true);
    assert.equal(result.uncertainCount, 1);
    assert.equal(result.reviewCount, prior.reviewCount + 1);
    assert.equal(result.history.at(-1)!.event.evidenceText, '음성 인식이 불명확함');
  }
});

test('undated learning has no invented due, first learned date or mastery', () => {
  const result = state([learn(1, null), event(2, null), event(3, null)]);
  assert.equal(result.status, 'learning');
  assert.equal(result.firstLearnedDate, null);
  assert.equal(result.nextDue, null);
  assert.equal(result.intervalDays, null);
  assert.equal(result.independentSuccessCount, 0);
  assert.equal(result.needsAssessment, true);
});

test('review, hinted success and relearning never invent the missing original learning date', () => {
  for (const observation of [
    event(1, '2026-10-01'),
    event(1, '2026-10-01', { result: 'hinted_correct', independent: false, hintUsed: true }),
    learn(1, '2026-10-01', { kind: 'relearn', relearningText: '이전 학습일을 모르는 재학습' }),
  ]) {
    const result = state([observation]);
    assert.equal(result.firstLearnedDate, null);
    assert.equal(result.nextDue, '2026-10-02');
    assert.equal(result.lastAssessedDate, '2026-10-01');
  }
  const learnedWithoutDate = state([learn(1, null), event(2, '2026-10-02'), event(3, '2026-10-05'), event(4, '2026-10-09')]);
  assert.equal(learnedWithoutDate.firstLearnedDate, null);
  assert.equal(learnedWithoutDate.status, 'mastery_confirmed');
  assert.equal(learnedWithoutDate.independentSuccessCount, 3);
  assert.equal(learnedWithoutDate.nextDue, '2026-10-16');
});

test('undated errors/learning/unlearned never override any dated state or due', () => {
  const prior = state(masteryEvents());
  const result = state([error(9, null, { forgettingConfirmed: true }), learn(10, null), learn(11, null, { kind: 'not_learned' }), ...masteryEvents()]);
  for (const key of ['status', 'lastEvidence', 'lastResult', 'lastAssessedDate', 'firstLearnedDate', 'nextDue', 'policyDue', 'intervalDays', 'independentSuccessCount'] as const) assert.equal(result[key], prior[key], key);
  assert.equal(result.needsAssessment, true);
  assert.equal(result.errorCount, 1);
  assert.equal(result.history.length, 7);
  assert.equal(result.history.at(-1)!.event.occurredDate, null);
});

test('teacher override requires explicit confirmation and a known event date; policy due remains visible', () => {
  const result = state([learn(1, '2026-10-01', { teacherRecommendedDue: '2026-10-07', teacherRecommendationConfirmed: true })]);
  assert.equal(result.policyDue, '2026-10-02');
  assert.equal(result.nextDue, '2026-10-07');
  assert.equal(result.history[0].policyDue, '2026-10-02');
  for (const changes of [{ teacherRecommendationConfirmed: false }, { occurredDate: null }, { teacherRecommendedDue: '2026-09-30' }, { teacherRecommendedDue: '2026-02-30' }]) {
    const held = state([learn(1, '2026-10-01', { teacherRecommendedDue: '2026-10-07', teacherRecommendationConfirmed: true, ...changes })]);
    assert.equal(held.nextDue, held.policyDue);
  }
});

test('all four skills remain separate with no inferred propagation', () => {
  const onlyReading = projection(masteryEvents());
  assert.equal(onlyReading.states.length, 1);
  assert.equal(onlyReading.states[0].skill, 'reading');
  const all = projection(LIVE_SKILLS.map((skill, index) => learn(index, '2026-10-01', { skill, kind: skill === 'speaking' ? 'not_learned' : 'learn' })));
  assert.deepEqual(all.states.map(row => row.skill), LIVE_SKILLS);
  assert.equal(all.states.find(row => row.skill === 'speaking')!.status, 'unlearned');
  const invalid = projection([learn(1, '2026-10-01', { skill: 'vocabulary' as 'reading' })]);
  assert.deepEqual(invalid.states, []);
});

test('exact identity and homograph meanings remain separate', () => {
  const result = projection([
    learn(1, '2026-10-01', { item: { ...item, text: 'ｶﾞ', meaning: '의미1' } }),
    learn(2, '2026-10-01', { item: { ...item, itemId: uuid(3), text: 'ガ', meaning: '의미1' } }),
    learn(3, '2026-10-01', { item: { ...item, itemId: uuid(4), text: 'ガ', meaning: '의미2' } }),
  ]);
  assert.deepEqual(result.states.map(row => row.item.text), ['ｶﾞ', 'ガ', 'ガ']);
  assert.deepEqual(result.states.map(row => row.item.meaning), ['의미1', '의미1', '의미2']);
});

test('latest batch fully replaces old events, and an empty batch clears only current evidence', () => {
  const source = lesson();
  const older = batch(source, masteryEvents());
  const latest = batch(source, [learn(8, '2026-10-09', { skill: 'writing' })], 2);
  const replaced = projectLiveLearning({ ownerId, lessons: [source], batches: [latest, older] });
  assert.equal(replaced.states.length, 1);
  assert.equal(replaced.states[0].skill, 'writing');
  assert.deepEqual(replaced.activeBatches, [latest]);
  assert.deepEqual(replaced.inactiveBatches, [older]);
  const clear = batch(source, [], 3);
  const cleared = projectLiveLearning({ ownerId, lessons: [source], batches: [clear, older, latest] });
  assert.deepEqual(cleared.states, []);
  assert.deepEqual(cleared.activeBatches, [clear]);
  assert.equal(cleared.inactiveBatches.length, 2);
  assert.deepEqual(cleared.unconfirmedLessons, [source]);
});

test('editing a lesson invalidates old-revision evidence until exact revision is confirmed', () => {
  const original = lesson();
  const edited = { ...original, revision: 2, previous_revision: 1, operation: 'edit' as const };
  const previous = batch(original, masteryEvents());
  const result = projectLiveLearning({ ownerId, lessons: [edited], batches: [previous] });
  assert.deepEqual(result.states, []);
  assert.deepEqual(result.inactiveBatches, [previous]);
  assert.deepEqual(result.unconfirmedLessons, [edited]);
  const current = batch(edited, [learn(9, '2026-10-10')]);
  assert.equal(projectLiveLearning({ ownerId, lessons: [original, edited], batches: [current, previous] }).states[0].status, 'learning');
});

test('tombstones and missing sources cannot revive old evidence; restore needs current-revision evidence', () => {
  const original = lesson();
  const previous = batch(original, masteryEvents());
  const deleted = { ...original, revision: 2, operation: 'delete' as const };
  for (const lessons of [[], [deleted], [original, deleted]]) {
    const result = projectLiveLearning({ ownerId, lessons, batches: [previous] });
    assert.deepEqual(result.states, []);
    assert.deepEqual(result.unconfirmedLessons, []);
    assert.deepEqual(result.inactiveBatches, [previous]);
  }
  const restored = { ...original, revision: 3, operation: 'restore' as const, restored_from_revision: 1 };
  const result = projectLiveLearning({ ownerId, lessons: [restored], batches: [previous] });
  assert.deepEqual(result.states, []);
  assert.deepEqual(result.unconfirmedLessons, [restored]);
});

test('owner scoping removes foreign lessons and batches from every projection collection', () => {
  const source = lesson();
  const foreign = lesson(20, '2026-10-01', { user_id: uuid(99) });
  const result = projectLiveLearning({ ownerId, lessons: [source, foreign], batches: [batch(foreign, masteryEvents()), batch(source, [learn(1, '2026-10-01')], 1, { user_id: foreign.user_id })] });
  assert.deepEqual(result.states, []);
  assert.deepEqual(result.activeBatches, []);
  assert.deepEqual(result.inactiveBatches, []);
  assert.deepEqual(result.unconfirmedLessons, [source]);
});

test('late imported history is ordered by occurred date, lesson date and batch order', () => {
  const early = lesson(30, '2026-10-01', { created_at: '2026-12-01T00:00:00Z' });
  const late = lesson(20, '2026-10-02', { created_at: '2026-10-02T00:00:00Z' });
  const result = projectLiveLearning({ ownerId, lessons: [late, early], batches: [
    batch(late, [error(4, '2026-10-03'), learn(5, '2026-10-03', { kind: 'relearn', relearningText: '다시 학습' })]),
    batch(early, [event(3, '2026-10-03'), learn(1, '2026-10-01'), event(2, '2026-10-02')]),
  ] }).states[0];
  assert.deepEqual(result.history.map(entry => entry.eventId), [1, 2, 3, 4, 5].map(index => uuid(1000 + index)));
  assert.equal(result.firstLearnedDate, '2026-10-01');
  assert.equal(result.lastResult, 'not_assessed');
  assert.equal(result.nextDue, '2026-10-04');
});

test('projection is pure, deterministic under batch order, and idempotent for repeated snapshots', () => {
  const one = lesson(), two = lesson(20, '2026-10-02');
  const snapshot: LiveLearningSnapshot = { ownerId, lessons: [one, two], batches: [batch(one, masteryEvents()), batch(two, [error(9, '2026-10-10')])] };
  const before = JSON.stringify(snapshot);
  const first = projectLiveLearning(snapshot);
  assert.equal(JSON.stringify(snapshot), before);
  assert.deepEqual(first, projectLiveLearning(snapshot));
  assert.deepEqual(first, projectLiveLearning({ ...snapshot, lessons: snapshot.lessons.slice().reverse(), batches: snapshot.batches.slice().reverse() }));
  assert.equal(first.states[0].history.length, 5);
});

test('same current batch repeated in an input snapshot is not double-counted', () => {
  const source = lesson();
  const evidence = batch(source, masteryEvents());
  const result = projectLiveLearning({ ownerId, lessons: [source], batches: [evidence, { ...evidence }] });
  assert.equal(result.activeBatches.length, 1);
  assert.equal(result.states[0].reviewCount, 3);
});

test('calendar arithmetic handles leap/year/DST boundaries and rejects invalid dates', () => {
  assert.equal(addLiveCalendarDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addLiveCalendarDays('2024-02-29', 1), '2024-03-01');
  assert.equal(addLiveCalendarDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addLiveCalendarDays('2026-03-08', 1), '2026-03-09');
  assert.equal(addLiveCalendarDays('2026-11-01', 1), '2026-11-02');
  assert.equal(addLiveCalendarDays('0001-01-01', 1), '0001-01-02');
  assert.equal(liveCalendarDaysBetween('2026-03-07', '2026-03-14'), 7);
  assert.equal(liveCalendarDaysBetween('2026-10-25', '2026-11-01'), 7);
  for (const invalid of ['2026-02-29', '2026-04-31', '2026-10-01T23:00:00Z', '2026-1-1', '0000-01-01']) assert.equal(addLiveCalendarDays(invalid, 1), null);
  assert.equal(addLiveCalendarDays('9999-12-31', 1), null);
});

test('review queue prioritizes relearning and weak overdue states, caps results, includes old mastery', () => {
  const base = state([learn(1, '2026-10-01')]);
  const row = (index: number, changes: Partial<LiveSkillState>): LiveSkillState => ({ ...base, item: { ...item, itemId: uuid(index) }, ...changes });
  const rows = [
    row(10, { status: 'mastery_confirmed', nextDue: '2026-09-01' }),
    row(20, { nextDue: '2026-10-09' }),
    row(30, { status: 'relearn_needed', nextDue: '2026-10-15' }),
    row(40, { status: 'review_due', nextDue: '2026-10-08' }),
    row(50, { needsAssessment: true, nextDue: null }),
    row(60, { nextDue: '2026-10-10' }),
  ];
  const before = JSON.stringify(rows);
  assert.deepEqual(liveReviewQueue(rows, '2026-10-09').map(entry => entry.item.itemId), [30, 40, 50, 20, 10].map(uuid));
  assert.equal(liveReviewQueue(rows, '2026-10-09', 2).length, 2);
  assert.equal(JSON.stringify(rows), before);
  assert.deepEqual(liveReviewQueue(rows, 'not-a-date'), []);
  assert.deepEqual(liveReviewQueue(rows, '2026-10-09', 0), []);
});

test('missed reviews stay overdue with no synthetic failure, review or status transition', () => {
  const result = state(masteryEvents());
  const before = JSON.stringify(result);
  assert.equal(liveReviewQueue([result], '2027-10-09')[0], result);
  assert.equal(JSON.stringify(result), before);
  assert.equal(result.errorCount, 0);
  assert.equal(result.status, 'mastery_confirmed');
});

test('old error totals do not wrongly prioritize recovered mastery over ordinary due reviews', () => {
  const mastered = { ...state(masteryEvents()), errorCount: 8, nextDue: '2026-10-01' };
  const learning = state([learn(8, '2026-10-08', { item: { ...item, itemId: uuid(8) } })]);
  assert.equal(liveReviewQueue([mastered, learning], '2026-10-09')[0], learning);
});

test('practice links use existing routes and never encode the report/item text or mutate legacy state', () => {
  assert.equal(livePracticeHref(item, 'reading'), '/language/kana');
  assert.equal(livePracticeHref(item, 'writing'), '/language/kana-writing');
  assert.equal(livePracticeHref(item, 'speaking'), '/language/speaking');
  assert.equal(livePracticeHref({ ...item, kind: 'word' }, 'listening'), '/language/words');
  assert.equal(livePracticeHref({ ...item, kind: 'grammar' }, 'reading'), '/language/grammar');
  assert.equal(livePracticeHref({ ...item, kind: 'expression' }, 'reading'), '/language/sentences');
  assert.equal(livePracticeHref({ ...item, kind: 'sentence' }, 'writing'), '/language/writing');
  assert.equal(livePracticeHref({ ...item, kind: 'other' }, 'reading'), '/language/review');
});
