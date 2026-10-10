import type { Metric, Period, Reason, Snapshot, WindowName, WorkoutStatus } from './contracts.ts';
import { addDays, calendarDay, dateInPeriod } from './dates.ts';
import { blocked, compareText, metric, sourceReasons } from './quality.ts';

export function aggregateWorkout(snapshot: Snapshot) {
  const { workout: source, plans } = snapshot.sources;
  const aggregate = (period: Period) => {
    const records = source.records.filter(row => dateInPeriod(row.date, period)), reasons = sourceReasons(source, period), valid = !blocked(reasons);
    const count = (status: WorkoutStatus) => {
      const selected = records.filter(row => row.status === status);
      return metric(valid ? selected.length : null, 'recorded_sessions', period, selected, null, [...reasons, ...(!records.length ? ['no_records' as const] : [])]);
    };
    const byKind = [...new Set(records.map(row => row.kind))].sort((a, b) => compareText(a ?? '', b ?? '')).map(kind => {
      const selected = records.filter(row => row.kind === kind && row.status === 'completed');
      return { kind, completed: metric(valid ? selected.length : null, 'recorded_sessions', period, selected, null, reasons) };
    });
    const planRows = plans?.records.filter(row => dateInPeriod(row.date, period)) ?? [];
    const planReasons: Reason[] = [...reasons, ...sourceReasons(plans, period)];
    if (!plans || planRows.length !== period.calendarDays) planReasons.push('plan_unknown');
    const planned = planRows.filter(row => row.state === 'planned'), plannedDates = new Set(planned.map(row => row.date));
    const completed = records.filter(row => row.status === 'completed' && plannedDates.has(row.date));
    const numerator = new Set(completed.map(row => row.date)).size;
    const knownPlan = !blocked(planReasons) && !planReasons.includes('plan_unknown');
    if (knownPlan && !planned.length) planReasons.push('no_planned_days');
    const rate = metric(knownPlan && planned.length ? numerator / planned.length * 100 : null, 'percent_of_planned_days_with_recorded_completion', period, [...planRows, ...completed], knownPlan ? planned.length : null, planReasons);
    const pain = (answer: 'yes' | 'no' | 'unknown') => {
      const rows = records.filter(row => row.pain === answer);
      return metric(valid ? rows.length : null, 'recorded_answers', period, rows, records.length, [...reasons, ...(answer === 'unknown' && rows.length ? ['unanswered' as const] : [])]);
    };
    return { completed: count('completed'), partial: count('partial'), stopped: count('stopped'), unclassified: count('unknown'), recordedPlannedDayCompletionRate: rate, byKind, pain: { yes: pain('yes'), no: pain('no'), unanswered: pain('unknown') } };
  };
  const periods = Object.fromEntries(Object.entries(snapshot.windows).map(([name, period]) => [name, aggregate(period)])) as Record<WindowName, ReturnType<typeof aggregate>>;
  const period = snapshot.windows.recent30, reasons = sourceReasons(source, period), records = source.records.filter(row => dateInPeriod(row.date, period) && row.status === 'completed');
  const dates = new Set(records.map(row => row.date)), latest = records.at(-1)?.date ?? null;
  let streak = 0;
  if (latest) for (let day = latest; dates.has(day); day = addDays(day, -1)) streak++;
  return {
    periods, lastRecordedCompletionDate: blocked(reasons) ? null : latest,
    observedConsecutiveDaysEndingAtLastRecord: metric(!blocked(reasons) && latest ? streak : null, 'recorded_calendar_days', period, records.filter(row => latest && row.date > addDays(latest, -streak)), null, [...reasons, ...(!latest ? ['no_records' as const] : [])]),
    daysSinceLastRecordedCompletion: metric(!blocked(reasons) && latest ? calendarDay(snapshot.today) - calendarDay(latest) : null, 'calendar_days_since_record', period, records.filter(row => row.date === latest), null, [...reasons, ...(!latest ? ['no_records' as const] : [])]),
    // A missing day says nothing about activity, failure, or whether a streak actually ended.
    missingDayBehavior: 'unknown' as const,
  };
}
