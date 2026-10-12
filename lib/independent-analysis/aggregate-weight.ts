import type { Metric, Period, Snapshot, WeightRecord, WindowName } from './contracts.ts';
import { calendarDay, dateInPeriod } from './dates.ts';
import { blocked, metric, sourceReasons } from './quality.ts';

function mean(records: readonly WeightRecord[]): number {
  // Divide before adding so a large count cannot overflow an otherwise valid mean.
  return records.reduce((sum, record) => sum + record.value / records.length, 0);
}
export function aggregateWeight(snapshot: Snapshot) {
  const source = snapshot.sources.weight;
  const average = (period: Period): Metric => {
    const records = source.records.filter(row => dateInPeriod(row.date, period)), reasons = sourceReasons(source, period);
    return metric(blocked(reasons) || !records.length ? null : mean(records), 'kg', period, records, records.length || null, [...reasons, ...(!records.length ? ['no_records' as const] : [])]);
  };
  const averages = Object.fromEntries(Object.entries(snapshot.windows).map(([key, period]) => [key, average(period)])) as Record<WindowName, Metric>;
  const dayRecords = source.records.filter(row => row.date === snapshot.today || row.date === snapshot.windows.yesterday.startDate);
  const a = averages.today, b = averages.yesterday;
  const deltaReasons = [...a.quality.reasons, ...b.quality.reasons, ...(a.value === null || b.value === null ? ['missing_baseline' as const] : [])];
  const dailyDelta = metric(a.value !== null && b.value !== null ? a.value - b.value : null, 'kg', snapshot.windows.today, dayRecords, null, deltaReasons);
  const trendPeriod = snapshot.windows.recent30, trendRecords = source.records.filter(row => dateInPeriod(row.date, trendPeriod));
  const reasons = sourceReasons(source, trendPeriod), first = trendRecords[0]?.date, last = trendRecords.at(-1)?.date;
  const elapsed = first && last ? calendarDay(last) - calendarDay(first) : null;
  const enough = elapsed !== null && elapsed > 0 && !blocked(reasons);
  const delta = enough ? mean(trendRecords.filter(row => row.date === last)) - mean(trendRecords.filter(row => row.date === first)) : null;
  const trendReasons = [...reasons, ...(!trendRecords.length ? ['no_records' as const] : elapsed === 0 ? ['same_day' as const] : [])];
  return {
    averages, dailyDelta,
    recentChange: metric(delta, 'kg', trendPeriod, trendRecords, null, trendReasons),
    changePerCalendarDay: metric(delta !== null && elapsed ? delta / elapsed : null, 'kg/calendar_day', trendPeriod, trendRecords, enough ? elapsed : null, trendReasons),
    firstMeasurementDate: first ?? null, lastMeasurementDate: last ?? null,
    averageBasis: 'recorded_measurements' as const,
  };
}
