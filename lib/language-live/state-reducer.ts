import {
  LIVE_REVIEW_POLICY_VERSION, LIVE_SKILLS,
  type LiveEventReference, type LiveLearningBatch, type LiveLearningEvent,
  type LiveLearningProjection, type LiveLearningSnapshot, type LiveSkillState,
} from './learning-types.ts';
import type { LiveLesson } from './types.ts';
import {
  addLiveCalendarDays, isLiveCalendarDate, liveCalendarDaysBetween,
  LIVE_MASTERY_MIN_DISTINCT_DATES, LIVE_MASTERY_MIN_SPAN_DAYS,
  LIVE_MASTERY_MIN_SUCCESSES, nextLiveReviewInterval,
} from './review-policy.ts';

export { livePracticeHref, liveReviewQueue } from './review-policy.ts';

type Observation = LiveEventReference & { event: LiveLearningEvent; lessonDate: string | null; order: number };
type Accumulator = {
  state: LiveSkillState;
  successDates: Set<string>;
  masteryRunDates: Set<string>;
  errorDates: Set<string>;
  resetDate: string | null;
  closeReviewDate: string | null;
  hasDatedObservation: boolean;
};
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const dateKey = (date: string | null) => isLiveCalendarDate(date) ? date : '9999-99-99';
const compareBatches = (left: LiveLearningBatch, right: LiveLearningBatch) => compareText(left.lesson_id, right.lesson_id)
  || left.lesson_revision - right.lesson_revision || left.version - right.version
  || compareText(left.request_id, right.request_id) || compareText(left.payload_hash, right.payload_hash);

function initial(event: LiveLearningEvent): Accumulator {
  return {
    state: {
      item: { ...event.item }, skill: event.skill, status: null,
      firstLearnedDate: null, lastReviewedDate: null, lastAssessedDate: null,
      lastResult: null, lastEvidence: null, nextDue: null, policyDue: null,
      intervalDays: null, reviewCount: 0, errorCount: 0,
      independentSuccessCount: 0, uncertainCount: 0, needsAssessment: false,
      masteryHistory: [], history: [],
    },
    successDates: new Set(), masteryRunDates: new Set(), errorDates: new Set(),
    resetDate: null, closeReviewDate: null, hasDatedObservation: false,
  };
}

function reference(observation: Observation): LiveEventReference {
  const { lessonId, lessonRevision, batchVersion, eventId } = observation;
  return { lessonId, lessonRevision, batchVersion, eventId };
}

function resetMastery(accumulator: Accumulator, date: string | null) {
  accumulator.masteryRunDates.clear();
  accumulator.resetDate = date;
}

function schedule(state: LiveSkillState, event: LiveLearningEvent, date: string | null, interval: number) {
  state.intervalDays = date ? interval : null;
  state.policyDue = date ? addLiveCalendarDays(date, interval) : null;
  state.nextDue = date && event.teacherRecommendationConfirmed
    && isLiveCalendarDate(event.teacherRecommendedDue) && event.teacherRecommendedDue >= date
    ? event.teacherRecommendedDue : state.policyDue;
}

function applyObservation(accumulator: Accumulator, observation: Observation, hasActiveRelearningSource: boolean) {
  const { state } = accumulator;
  const { event } = observation;
  const date = isLiveCalendarDate(event.occurredDate) ? event.occurredDate : null;
  const previousStatus = state.status;
  const hasEvidence = Boolean(event.evidenceText.trim());
  const uncertain = event.certainty !== 'confirmed' || event.result === 'uncertain' || !hasEvidence;
  let policyReason: string;

  // Counts represent real recorded attempts, including uncertain/undated attempts.
  // Independent success is deliberately a distinct dated-observation count.
  if (event.kind === 'review' || event.kind === 'reassessment') {
    state.reviewCount += 1;
    if (date) state.lastReviewedDate = date;
  }
  if (uncertain) {
    state.uncertainCount += 1;
    state.needsAssessment = true;
    policyReason = '평가가 불확실하여 기존 상태·근거·복습일을 유지하고 재평가를 요청해요.';
  } else if (event.kind === 'reassessment' && !hasActiveRelearningSource) {
    state.needsAssessment = true;
    policyReason = '연결된 재학습의 현재 유효한 날짜·근거를 확인할 수 없어 이력만 보존하고 재평가를 요청해요.';
  } else if (!date && accumulator.hasDatedObservation) {
    // Unknown chronology cannot erase/replace the latest dated result or due date.
    state.needsAssessment = true;
    if (event.result === 'incorrect' || event.result === 'cannot_recall') state.errorCount += 1;
    policyReason = '날짜가 없어 이력만 보존해요. 날짜가 확인된 기존 상태·복습일은 유지해요.';
  } else {
    if (date) accumulator.hasDatedObservation = true;
    const independentSuccess = event.result === 'independent_correct' && event.independent === true && event.hintUsed === false;
    const hintedSuccess = event.result === 'hinted_correct' && event.independent === false && event.hintUsed === true;
    const error = event.result === 'incorrect' || event.result === 'cannot_recall';

    if (event.kind === 'not_learned') {
      state.status = 'unlearned';
      state.intervalDays = null; state.policyDue = null; state.nextDue = null;
      state.needsAssessment = false;
      resetMastery(accumulator, date);
      accumulator.errorDates.clear();
      policyReason = '명시적으로 확인한 미학습 기록이에요.';
    } else if (event.kind === 'learn' || event.kind === 'relearn') {
      state.status = 'learning';
      // A review/relearning date does not establish when the original learning
      // happened. Keep that date unknown until explicit learning evidence exists.
      if (event.kind === 'learn') state.firstLearnedDate ??= date;
      state.needsAssessment = !date;
      accumulator.closeReviewDate = date;
      if (event.kind === 'relearn') resetMastery(accumulator, date);
      schedule(state, event, date, 1);
      policyReason = event.kind === 'relearn'
        ? '재학습을 기록했어요. 이전 숙달 이력은 보존하고 새 간격 평가를 시작해요.'
        : '학습을 기록했어요. 날짜가 확인되면 다음 날 다시 확인해요.';
    } else if (error) {
      state.errorCount += 1;
      accumulator.closeReviewDate = date;
      if (date) accumulator.errorDates.add(date);
      const forgetting = event.forgettingConfirmed || accumulator.errorDates.size >= 2;
      if (forgetting) {
        state.status = 'relearn_needed';
        resetMastery(accumulator, date);
      } else if (state.status !== 'relearn_needed') {
        state.status = 'review_due';
      }
      state.needsAssessment = true;
      schedule(state, event, date, 1);
      policyReason = forgetting
        ? '확인된 망각 또는 최근 독립 성공 이후 서로 다른 날짜의 반복 오류로 재학습이 필요해요.'
        : '한 번의 오답을 망각으로 단정하지 않아요. 가까운 날짜에 다시 평가해요.';
    } else if (independentSuccess && date) {
      const newSuccessDate = !accumulator.successDates.has(date);
      if (newSuccessDate) {
        accumulator.successDates.add(date);
        state.independentSuccessCount += 1;
      }
      accumulator.masteryRunDates.add(date);
      accumulator.errorDates.clear();
      state.needsAssessment = false;
      const dates = [...accumulator.masteryRunDates].sort();
      const span = liveCalendarDaysBetween(dates[0], dates.at(-1)!) ?? 0;
      const mastered = dates.length >= LIVE_MASTERY_MIN_SUCCESSES
        && dates.length >= LIVE_MASTERY_MIN_DISTINCT_DATES && span >= LIVE_MASTERY_MIN_SPAN_DAYS
        && accumulator.resetDate !== date && accumulator.closeReviewDate !== date;
      state.status = mastered ? 'mastery_confirmed' : 'learning';
      if (mastered && previousStatus !== 'mastery_confirmed') state.masteryHistory.push(reference(observation));
      schedule(state, event, date, newSuccessDate && accumulator.closeReviewDate !== date
        ? nextLiveReviewInterval(state.intervalDays) : state.intervalDays ?? 1);
      policyReason = mastered
        ? '서로 다른 3일 이상의 독립 성공과 7일 이상 간격의 근거를 확인했어요. 장기 복습은 계속해요.'
        : newSuccessDate ? '힌트 없는 독립 성공을 확인했어요. 날짜 간격을 두고 다시 평가해요.'
          : '같은 날짜의 추가 성공은 이력에만 추가하고 간격·성공 횟수를 늘리지 않아요.';
    } else if (hintedSuccess) {
      accumulator.closeReviewDate = date;
      state.status = state.status === 'relearn_needed' ? 'relearn_needed' : 'review_due';
      state.needsAssessment = true;
      schedule(state, event, date, 1);
      policyReason = '힌트를 사용한 성공은 독립 숙달로 계산하지 않고 가까운 날짜에 다시 확인해요.';
    } else {
      state.needsAssessment = true;
      policyReason = date
        ? '독립 수행 여부가 확인되지 않아 상태·복습일을 유지하고 재평가를 요청해요.'
        : '날짜가 없어 숙달·복습일을 계산하지 않고 재평가를 요청해요.';
    }

    // A dated not-assessed review or incompletely flagged success is not evidence
    // replacing a known assessed result. Its full source still remains in history.
    if (event.kind === 'learn' || event.kind === 'relearn' || event.kind === 'not_learned' || error || hintedSuccess || (independentSuccess && date)) {
      state.lastAssessedDate = date;
      state.lastResult = event.result;
      state.lastEvidence = event.evidenceText;
    }
  }

  state.history.push({ ...reference(observation), event, previousStatus, status: state.status,
    policyDue: state.policyDue, nextDue: state.nextDue,
    reason: event.reason.trim() ? `${policyReason} ${event.reason}` : policyReason });
}

function activeRelearningSource(observation: Observation, sources: Map<string, Observation[]>): Observation | null {
  const { event } = observation;
  const matches = event.linkedRelearningEventId ? sources.get(event.linkedRelearningEventId) ?? [] : [];
  const linked = matches.length === 1 ? matches[0] : null;
  return linked && isLiveCalendarDate(event.occurredDate)
    && linked.event.item.itemId === event.item.itemId && linked.event.skill === event.skill
    && linked.event.occurredDate! <= event.occurredDate
    && (linked.lessonId !== observation.lessonId || linked.event.occurredDate !== event.occurredDate || linked.order < observation.order)
    ? linked : null;
}

/** Explicit causal links outrank UUID tie-breaking, never the known calendar date.
 * Keep each report's same-day event order. Contradictory cycles remain historical
 * evidence, but their reassessments cannot contribute success or mastery.
 */
function causalObservationOrder(observations: Observation[], sources: Map<string, Observation[]>) {
  const byDate = new Map<string, Observation[]>();
  for (const observation of observations) {
    const key = dateKey(observation.event.occurredDate);
    const group = byDate.get(key) ?? [];
    group.push(observation); byDate.set(key, group);
  }
  const ordered: Observation[] = [], blocked = new Set<Observation>();
  for (const group of byDate.values()) {
    const indices = new Map(group.map((observation, index) => [observation, index]));
    const outgoing = group.map(() => new Set<number>()), degree = group.map(() => 0);
    const previousInBatch = new Map<string, number>();
    const addEdge = (from: number, to: number) => {
      if (!outgoing[from].has(to)) { outgoing[from].add(to); degree[to] += 1; }
    };
    group.forEach((observation, index) => {
      const batchKey = `${observation.lessonId}:${observation.lessonRevision}`;
      const previous = previousInBatch.get(batchKey);
      if (previous !== undefined) addEdge(previous, index);
      previousInBatch.set(batchKey, index);
      const linked = activeRelearningSource(observation, sources);
      const linkedIndex = linked ? indices.get(linked) : undefined;
      if (linkedIndex !== undefined) addEdge(linkedIndex, index);
    });
    // Stable priority queue keeps the pre-existing deterministic order wherever
    // it does not conflict with confirmed links. O(n log n), with no recursion.
    const ready: number[] = [];
    const enqueue = (index: number) => {
      ready.push(index);
      for (let child = ready.length - 1; child > 0;) {
        const parent = Math.floor((child - 1) / 2);
        if (ready[parent] <= ready[child]) break;
        [ready[parent], ready[child]] = [ready[child], ready[parent]]; child = parent;
      }
    };
    const dequeue = () => {
      const first = ready[0], last = ready.pop()!;
      if (ready.length) {
        ready[0] = last;
        for (let parent = 0; parent * 2 + 1 < ready.length;) {
          const left = parent * 2 + 1, right = left + 1;
          const child = right < ready.length && ready[right] < ready[left] ? right : left;
          if (ready[parent] <= ready[child]) break;
          [ready[parent], ready[child]] = [ready[child], ready[parent]]; parent = child;
        }
      }
      return first;
    };
    degree.forEach((count, index) => { if (!count) enqueue(index); });
    const emitted = new Set<number>();
    while (ready.length) {
      const index = dequeue(); ordered.push(group[index]); emitted.add(index);
      for (const next of outgoing[index]) { degree[next] -= 1; if (!degree[next]) enqueue(next); }
    }
    group.forEach((observation, index) => {
      if (!emitted.has(index)) { blocked.add(observation); ordered.push(observation); }
    });
  }
  return { ordered, blocked };
}

/** Rebuild from one owner-scoped snapshot; never mutate reports, batches or legacy state. */
export function projectLiveLearning(snapshot: LiveLearningSnapshot): LiveLearningProjection {
  const currentLessons = new Map<string, LiveLesson>();
  // Snapshot contract is current-only. This also fails closed if a caller supplies history.
  for (const lesson of snapshot.lessons) {
    if (lesson.user_id !== snapshot.ownerId) continue;
    const previous = currentLessons.get(lesson.lesson_id);
    if (!previous || lesson.revision > previous.revision
      || (lesson.revision === previous.revision && lesson.operation === 'delete')) currentLessons.set(lesson.lesson_id, lesson);
  }
  const ownerBatches = snapshot.batches.filter(batch => batch.user_id === snapshot.ownerId).slice().sort(compareBatches);
  const latestBatches = new Map<string, LiveLearningBatch>();
  for (const batch of ownerBatches) {
    const lesson = currentLessons.get(batch.lesson_id);
    if (lesson && lesson.operation !== 'delete' && batch.lesson_revision === lesson.revision) latestBatches.set(batch.lesson_id, batch);
  }
  const activeBatches = [...latestBatches.values()].filter(batch => batch.payload.confirmed === true
    && batch.payload.policyVersion === LIVE_REVIEW_POLICY_VERSION
    && batch.payload.lessonId === batch.lesson_id && batch.payload.lessonRevision === batch.lesson_revision);
  const active = new Set(activeBatches);
  const inactiveBatches = ownerBatches.filter(batch => !active.has(batch));
  const observations: Observation[] = activeBatches.flatMap(batch => batch.payload.events
    .map((event, order) => ({ event, order, eventId: event.eventId, lessonId: batch.lesson_id,
      lessonRevision: batch.lesson_revision, batchVersion: batch.version,
      lessonDate: currentLessons.get(batch.lesson_id)!.report.lessonDate })));
  observations.sort((left, right) => compareText(dateKey(left.event.occurredDate), dateKey(right.event.occurredDate))
    || compareText(dateKey(left.lessonDate), dateKey(right.lessonDate)) || compareText(left.lessonId, right.lessonId)
    || left.order - right.order);
  const relearningSources = new Map<string, Observation[]>();
  for (const observation of observations) {
    const event = observation.event;
    if (event.kind !== 'relearn' || event.certainty !== 'confirmed' || !event.evidenceText.trim() || !isLiveCalendarDate(event.occurredDate)) continue;
    const sources = relearningSources.get(event.eventId) ?? [];
    sources.push(observation);
    relearningSources.set(event.eventId, sources);
  }
  const { ordered, blocked } = causalObservationOrder(observations, relearningSources);
  const accumulators = new Map<string, Accumulator>();
  for (const observation of ordered) {
    const { event } = observation;
    if (!LIVE_SKILLS.includes(event.skill)) continue;
    const key = JSON.stringify([event.item.itemId, event.skill]);
    let accumulator = accumulators.get(key);
    if (!accumulator) { accumulator = initial(event); accumulators.set(key, accumulator); }
    const hasActiveRelearningSource = !blocked.has(observation)
      && Boolean(activeRelearningSource(observation, relearningSources));
    applyObservation(accumulator, observation, hasActiveRelearningSource);
    if (blocked.has(observation)) accumulator.state.needsAssessment = true;
  }
  const states = [...accumulators.values()].map(value => value.state).sort((left, right) =>
    compareText(left.item.itemId, right.item.itemId) || LIVE_SKILLS.indexOf(left.skill) - LIVE_SKILLS.indexOf(right.skill));
  const confirmedLessons = new Set(activeBatches.filter(batch => batch.payload.events.length > 0).map(batch => batch.lesson_id));
  const unconfirmedLessons = [...currentLessons.values()].filter(lesson => lesson.operation !== 'delete' && !confirmedLessons.has(lesson.lesson_id))
    .sort((left, right) => compareText(dateKey(left.report.lessonDate), dateKey(right.report.lessonDate)) || compareText(left.lesson_id, right.lesson_id));
  return { policyVersion: LIVE_REVIEW_POLICY_VERSION, states, activeBatches, inactiveBatches, unconfirmedLessons };
}
