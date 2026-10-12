import { AnalysisInputError, type Period, type Windows } from './contracts.ts';

const DAY = 86_400_000; // Calendar ordinals only; never elapsed local-day milliseconds.
export function calendarDay(value: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AnalysisInputError('calendar_date');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
  if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new AnalysisInputError('calendar_date');
  return date.getTime() / DAY;
}
export function addDays(date: string, days: number): string {
  if (!Number.isSafeInteger(days)) throw new AnalysisInputError('calendar_offset');
  const result = new Date((calendarDay(date) + days) * DAY).toISOString().slice(0, 10);
  calendarDay(result);
  return result;
}
export function parseInstant(value: string): number {
  if (typeof value !== 'string') throw new AnalysisInputError('instant');
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new AnalysisInputError('instant');
  calendarDay(match[1]);
  const offset = match[6];
  if (+match[2] > 23 || +match[3] > 59 || +match[4] > 59 || (offset !== 'Z' && (+offset.slice(1, 3) > 14 || +offset.slice(4) > 59 || (+offset.slice(1, 3) === 14 && +offset.slice(4) !== 0)))) throw new AnalysisInputError('instant');
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new AnalysisInputError('instant');
  return millis;
}
export function validateTimeZone(timeZone: string): void {
  if (typeof timeZone !== 'string' || !timeZone || /^[+-]/.test(timeZone)) throw new AnalysisInputError('time_zone');
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format(0); } catch { throw new AnalysisInputError('time_zone'); }
}
export function localDateAt(instant: string, timeZone: string): string {
  validateTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(parseInstant(instant));
  const get = (type: string) => parts.find(part => part.type === type)?.value;
  const date = `${get('year')?.padStart(4, '0')}-${get('month')}-${get('day')}`;
  calendarDay(date); return date;
}
export function makePeriod(name: string, startDate: string, endDateExclusive: string, asOf: string, timeZone: string): Period {
  const calendarDays = calendarDay(endDateExclusive) - calendarDay(startDate);
  const today = localDateAt(asOf, timeZone);
  if (calendarDays <= 0 || endDateExclusive > addDays(today, 1)) throw new AnalysisInputError('period');
  return { name, startDate, endDateExclusive, calendarDays, partial: endDateExclusive > today, asOf: new Date(parseInstant(asOf)).toISOString(), timeZone };
}
export function buildWindows(asOf: string, timeZone: string): Windows {
  const today = localDateAt(asOf, timeZone), tomorrow = addDays(today, 1);
  const p = (name: string, start: string, end: string) => makePeriod(name, start, end, asOf, timeZone);
  return {
    today: p('today', today, tomorrow), yesterday: p('yesterday', addDays(today, -1), today),
    recent7: p('recent7', addDays(today, -6), tomorrow), previous7: p('previous7', addDays(today, -13), addDays(today, -6)),
    recent30: p('recent30', addDays(today, -29), tomorrow), month: p('month', `${today.slice(0, 7)}-01`, tomorrow),
    completed7: p('completed7', addDays(today, -7), today), previousCompleted7: p('previousCompleted7', addDays(today, -14), addDays(today, -7)),
  };
}
export function dateInPeriod(date: string, period: Period): boolean {
  calendarDay(date); return date >= period.startDate && date < period.endDateExclusive;
}
export function instantInPeriod(instant: string, period: Period): boolean {
  return parseInstant(instant) <= parseInstant(period.asOf) && dateInPeriod(localDateAt(instant, period.timeZone), period);
}
export function periodsComparable(current: Period, previous: Period): boolean {
  return !current.partial && !previous.partial && current.calendarDays === previous.calendarDays
    && current.timeZone === previous.timeZone && current.asOf === previous.asOf && current.endDateExclusive <= localDateAt(current.asOf, current.timeZone)
    && previous.endDateExclusive <= current.startDate;
}
