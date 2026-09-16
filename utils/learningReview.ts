import type { CurriculumReviewItem } from './curriculumProgress';

export type ReviewModality = 'meaning' | 'listening' | 'typing';
export type ReviewObservation = { responseMs?: number; neededHelp: boolean; modality: ReviewModality };
export const REVIEW_MODALITY_LABELS: Record<ReviewModality, string> = { meaning: '뜻·읽기 선택', listening: '듣기', typing: '직접 입력' };
export function cleanResponseMs(value: unknown) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 600_000 ? Math.round(value) : undefined; }
export function reviewModality(kind: string | undefined, mode: string): ReviewModality { return kind === 'listening' ? 'listening' : kind === 'input' && mode === 'reader' ? 'typing' : 'meaning'; }

export function reviewInterval(current: number | undefined, correct: boolean, observation?: ReviewObservation) {
  if (!correct || observation?.neededHelp) return 1;
  const previous = typeof current === 'number' && Number.isFinite(current) ? Math.max(0, Math.min(30, current)) : 0;
  const responseMs = cleanResponseMs(observation?.responseMs);
  const threshold = observation?.modality === 'typing' ? 30_000 : observation?.modality === 'listening' ? 25_000 : 12_000;
  // A slow correct answer keeps its interval; it is never marked wrong.
  if (responseMs !== undefined && responseMs > threshold) return Math.max(1, previous);
  return [1, 3, 7, 14, 30].find(days => days > previous) ?? 30;
}

export function reviewObservationFields(previous: CurriculumReviewItem | undefined, correct: boolean, observation: ReviewObservation) {
  const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(10000, Math.floor(value))) : 0;
  return { lastResponseMs: cleanResponseMs(observation.responseMs), lastModality: observation.modality, lastNeededHelp: observation.neededHelp,
    reviewCount: count(previous?.reviewCount) + 1, successStreak: correct && !observation.neededHelp ? count(previous?.successStreak) + 1 : 0 };
}

export function summarizeReviewMastery(items: CurriculumReviewItem[]) {
  return (Object.keys(REVIEW_MODALITY_LABELS) as ReviewModality[]).map(modality => {
    const observed = items.filter(item => item.lastModality === modality);
    return { modality, label: REVIEW_MODALITY_LABELS[modality], observed: observed.length, stable: observed.filter(item => (item.successStreak ?? 0) >= 3 && (item.intervalDays ?? 0) >= 7).length };
  });
}
