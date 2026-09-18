import type { CurriculumReviewItem } from './curriculumProgress.ts';
export type ReviewTrack = 'all' | 'foundation' | 'work' | 'travel';
export function reviewFocus(items: CurriculumReviewItem[], now: number, track: ReviewTrack = 'all') {
  const prefix = { foundation: 'f', work: 'w', travel: 't', all: '' }[track];
  return items.filter(item => item.lessonId.startsWith(prefix) && (!item.nextReviewAt || Date.parse(item.nextReviewAt) <= now))
    .sort((a,b) => Number(b.lastNeededHelp === true) - Number(a.lastNeededHelp === true) || (b.wrongCount ?? 0) - (a.wrongCount ?? 0) || (a.lastWrongAt ?? a.createdAt).localeCompare(b.lastWrongAt ?? b.createdAt))
    .slice(0,3);
}
