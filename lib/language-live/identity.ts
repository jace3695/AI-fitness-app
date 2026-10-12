import type { LiveReportDraft } from './types.ts';

/** Object-key order is irrelevant; strings, Japanese orthography and arrays are not. */
export function stableLiveValue(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item);
}

/** Duplicate candidates only. A similar lesson must never be automatically merged. */
export function isSameLiveReport(left: LiveReportDraft, right: LiveReportDraft): boolean {
  return left.lessonDate === right.lessonDate && left.rawText === right.rawText;
}
