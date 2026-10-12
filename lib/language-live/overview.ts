import type { LiveLearningProjection, LiveLearningSnapshot, LiveSkillState } from './learning-types.ts';
import { isLiveCalendarDate, liveReviewQueue } from './review-policy.ts';
import { projectLiveLearning } from './state-reducer.ts';
import { LIVE_REPORT_TIMEZONE, type LiveLesson } from './types.ts';

export type LiveCalendarDay = {
  lessons: LiveLesson[];
  reviews: number;
  relearning: number;
  planned: LiveSkillState[];
};
export type LiveOverviewProjection = {
  asOfDate: string;
  lessons: LiveLesson[];
  recentLessons: LiveLesson[];
  latestDate: string | null;
  stage: string | null;
  stageAmbiguous: boolean;
  undatedLessons: number;
  futureLessons: number;
  futureObservations: number;
  undatedObservations: number;
  learning: LiveLearningProjection;
  reviewQueue: LiveSkillState[];
  due: LiveSkillState[];
  relearning: LiveSkillState[];
  calendar: Record<string, LiveCalendarDay>;
};
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Live uses report calendar dates in Korea, never the browser's local day. */
export function liveOverviewDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: LIVE_REPORT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

/** Read-only projection from the verified complete P2 snapshot. Import timestamps
 * cannot establish lesson chronology, and old source revisions cannot stay active.
 */
export function projectLiveOverview(snapshot: LiveLearningSnapshot, asOfDate: string): LiveOverviewProjection {
  if (!isLiveCalendarDate(asOfDate)) throw new Error('invalid_overview_date');
  if (snapshot.lessons.some(lesson => lesson.user_id !== snapshot.ownerId) || snapshot.batches.some(batch => batch.user_id !== snapshot.ownerId)
    || new Set(snapshot.lessons.map(lesson => lesson.lesson_id)).size !== snapshot.lessons.length) throw new Error('overview_owner_or_source_mismatch');
  const active = snapshot.lessons.filter(lesson => lesson.operation !== 'delete');
  const lessons = active.filter(lesson => !lesson.report.lessonDate || lesson.report.lessonDate <= asOfDate);
  // Select current batches before date filtering so a future observation cannot
  // accidentally resurrect a superseded batch or an edited/deleted source.
  const current = projectLiveLearning(snapshot);
  const learning = projectLiveLearning({ ...snapshot, lessons,
    batches: snapshot.batches.map(batch => ({ ...batch, payload: { ...batch.payload,
      events: batch.payload.events.filter(event => !event.occurredDate || event.occurredDate <= asOfDate),
    } })),
  });
  const dated = lessons.filter(lesson => isLiveCalendarDate(lesson.report.lessonDate))
    .sort((a, b) => compare(b.report.lessonDate!, a.report.lessonDate!) || compare(a.lesson_id, b.lesson_id));
  const latestDate = dated[0]?.report.lessonDate ?? null;
  const recentLessons = dated.filter(lesson => lesson.report.lessonDate === latestDate);
  const stages = recentLessons.map(lesson => lesson.report.fields.stage.presence === 'reported' ? lesson.report.fields.stage.text.trim() : '');
  const uniqueStages = new Set(stages);
  const stage = stages.length && stages.every(Boolean) && uniqueStages.size === 1 ? stages[0] : null;
  const calendar: Record<string, LiveCalendarDay> = {};
  const day = (date: string) => calendar[date] ??= { lessons: [], reviews: 0, relearning: 0, planned: [] };
  for (const lesson of dated) day(lesson.report.lessonDate!).lessons.push(lesson);
  let undatedObservations = 0;
  for (const batch of learning.activeBatches) for (const event of batch.payload.events) {
    if (!isLiveCalendarDate(event.occurredDate)) { undatedObservations++; continue; }
    // A recorded attempt is not necessarily a successful assessment. Uncertain
    // activity is kept in item history, never presented as confirmed performance.
    if (event.certainty !== 'confirmed' || !event.evidenceText.trim()) continue;
    if (event.kind === 'review' || event.kind === 'reassessment') day(event.occurredDate).reviews++;
    if (event.kind === 'relearn') day(event.occurredDate).relearning++;
  }
  for (const state of learning.states) if (isLiveCalendarDate(state.nextDue)) day(state.nextDue).planned.push(state);
  return { asOfDate, lessons, recentLessons, latestDate, stage, stageAmbiguous: uniqueStages.size > 1,
    undatedLessons: lessons.filter(lesson => !lesson.report.lessonDate).length,
    futureLessons: active.length - lessons.length,
    futureObservations: current.activeBatches.reduce((count, batch) => count + batch.payload.events.filter(event => event.occurredDate && event.occurredDate > asOfDate).length, 0),
    undatedObservations, learning, calendar,
    reviewQueue: liveReviewQueue(learning.states, asOfDate),
    due: learning.states.filter(state => state.nextDue && state.nextDue <= asOfDate),
    relearning: learning.states.filter(state => state.status === 'relearn_needed'),
  };
}
