import type { LiveItemIdentity, LiveSkill, LiveSkillState } from './learning-types.ts';
import { parseLiveLessonDate } from './validation.ts';

/** Product defaults, not a validated language-proficiency score. */
export const LIVE_REVIEW_INTERVALS = [1, 3, 7, 14, 30] as const;
/** Stricter than P0's two-date minimum: no same-day success can inflate mastery. */
export const LIVE_MASTERY_MIN_SUCCESSES = 3;
export const LIVE_MASTERY_MIN_DISTINCT_DATES = 3;
export const LIVE_MASTERY_MIN_SPAN_DAYS = 7;

export function isLiveCalendarDate(value: string | null): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && parseLiveLessonDate(value) === value;
}

/** Calendar-day math only. Local timezone, DST and import timestamps never enter it. */
export function addLiveCalendarDays(value: string, days: number): string | null {
  if (!isLiveCalendarDate(value) || !Number.isSafeInteger(days)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  if (!Number.isFinite(date.getTime())) return null;
  const result = date.toISOString().slice(0, 10);
  return isLiveCalendarDate(result) ? result : null;
}

export function liveCalendarDaysBetween(start: string, end: string): number | null {
  if (!isLiveCalendarDate(start) || !isLiveCalendarDate(end)) return null;
  return (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000;
}

export function nextLiveReviewInterval(current: number | null): number {
  if (current === null) return LIVE_REVIEW_INTERVALS[0];
  return LIVE_REVIEW_INTERVALS.find(days => days > current) ?? LIVE_REVIEW_INTERVALS.at(-1)!;
}

const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

/** Read-only selection; overdue reviews never create failure or completion events. */
export function liveReviewQueue(states: LiveSkillState[], today: string, limit = 5): LiveSkillState[] {
  if (!isLiveCalendarDate(today) || !Number.isFinite(limit) || limit <= 0) return [];
  const due = (state: LiveSkillState) => isLiveCalendarDate(state.nextDue) && state.nextDue <= today;
  const rank = (state: LiveSkillState) => {
    if (state.status === 'relearn_needed') return 0;
    if (due(state) && state.nextDue! < today && state.status !== 'mastery_confirmed') return 1;
    if (state.needsAssessment || (state.errorCount >= 2 && (state.lastResult === 'incorrect' || state.lastResult === 'cannot_recall'))) return 2;
    return state.status === 'mastery_confirmed' ? 4 : 3;
  };
  return states.filter(state => state.status === 'relearn_needed' || state.needsAssessment || due(state))
    .sort((left, right) => rank(left) - rank(right)
      || compareText(left.nextDue ?? '9999-12-31', right.nextDue ?? '9999-12-31')
      || compareText(left.lastAssessedDate ?? '', right.lastAssessedDate ?? '')
      || compareText(left.item.itemId, right.item.itemId)
      || compareText(left.skill, right.skill))
    .slice(0, Math.floor(limit));
}

/** Navigation only: no report text in URLs, no legacy completion writes or auto-tests. */
export function livePracticeHref(item: LiveItemIdentity, skill: LiveSkill): string {
  if (skill === 'writing') return item.kind === 'kana' ? '/language/kana-writing' : '/language/writing';
  if (skill === 'speaking') return '/language/speaking';
  if (item.kind === 'kana') return '/language/kana';
  if (item.kind === 'word') return '/language/words';
  if (item.kind === 'grammar') return '/language/grammar';
  if (item.kind === 'expression' || item.kind === 'sentence') return '/language/sentences';
  return '/language/review';
}
