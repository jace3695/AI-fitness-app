import { normalizeDigestion, normalizeMealCheck } from './freeDietTools.ts';

const DAY = 86_400_000;
export const dietPatternToday = (now = new Date()) => new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
export const DIET_COMPARISON_MIN_DAYS = 7;
export type DietPatternDay = { date: string; digestion: ReturnType<typeof normalizeDigestion>; lateSnack: ReturnType<typeof normalizeMealCheck> };
function metric(days: DietPatternDay[], kind: 'digestion' | 'lateSnack') {
  const answers = days.filter(day => day[kind] !== 'unrecorded');
  const count = answers.filter(day => kind === 'digestion' ? day.digestion !== 'comfortable' : day.lateSnack === 'yes').length;
  return { answers: answers.length, count, rate: answers.length ? Math.round(count / answers.length * 100) : null };
}

/** Calendar days, not elapsed local-time hours. Today is deliberately excluded. */
export function dietPatterns(store: Record<string, unknown>, today: string) {
  if (!validDate(today)) return null;
  const anchor = Date.parse(`${today}T12:00:00Z`);
  const offset = (days: number) => new Date(anchor - days * DAY).toISOString().slice(0, 10);
  function period(start: string, end: string) {
    const days = Object.entries(store).filter(([date, value]) => validDate(date) && date >= start && date <= end && value !== null && typeof value === 'object' && !Array.isArray(value))
      .map(([date, value]) => { const row = value as Record<string, unknown>; return { date, digestion: normalizeDigestion(row.digestionStatus), lateSnack: normalizeMealCheck(row.lateSnack) }; })
      .sort((a, b) => b.date.localeCompare(a.date));
    return { start, end, days, digestion: metric(days, 'digestion'), lateSnack: metric(days, 'lateSnack') };
  }
  const current = period(offset(28), offset(1));
  const previous = period(offset(56), offset(29));
  function delta(kind: 'digestion' | 'lateSnack') {
    const a = current[kind], b = previous[kind];
    return a.answers >= DIET_COMPARISON_MIN_DAYS && b.answers >= DIET_COMPARISON_MIN_DAYS
      ? Math.round((a.count / a.answers - b.count / b.answers) * 100) : null;
  }
  return { current, previous, digestionDelta: delta('digestion'), lateSnackDelta: delta('lateSnack') };
}
