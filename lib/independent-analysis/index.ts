import { aggregateBudget } from './aggregate-budget.ts';
import { aggregateWeight } from './aggregate-weight.ts';
import { aggregateWorkout } from './aggregate-workout.ts';
import type { Metric } from './contracts.ts';
import { normalizeSnapshot } from './normalize.ts';
import { stableFingerprint } from './quality.ts';

export { AnalysisInputError } from './contracts.ts';
export type { SnapshotInput, SourceInput, Coverage, RecordInput, WeightInput, WorkoutInput, PlanInput, SpendingInput, Metric, Period } from './contracts.ts';

export function analyzeSnapshot(input: unknown) {
  const snapshot = normalizeSnapshot(input);
  const result = {
    schemaVersion: 1 as const, asOf: snapshot.asOf, timeZone: snapshot.timeZone, windows: snapshot.windows, quality: snapshot.quality,
    provenance: Object.entries(snapshot.sources).map(([domain, source]) => ({ domain, source: source ? { sourceId: source.sourceId, sourceVersion: source.sourceVersion, currentVersion: source.currentVersion, status: source.status, coverage: source.coverage, quality: source.quality, excludedFutureCount: source.excludedFutureCount, deduplicatedCount: source.deduplicatedCount } : null })),
    weight: aggregateWeight(snapshot), workout: aggregateWorkout(snapshot), spending: aggregateBudget(snapshot),
  };
  return { ...result, fingerprint: stableFingerprint(result) };
}
export type AnalysisResult = ReturnType<typeof analyzeSnapshot>;

/** Data minimization ONLY. This function does not authorize or perform transmission.
 * Aggregated weight, pain and money remain sensitive. No free-text/source IDs leave
 * this projection. A future provider adapter still needs purpose/provider consent.
 */
export function projectAnalysisFacts(result: AnalysisResult) {
  const facts: { id: string; state: Metric['state']; value: number | null; unit: string; sampleCount: number; denominator: number | null; startDate: string; endDateExclusive: string; partial: boolean; quality: Metric['quality'] }[] = [];
  const add = (id: string, value: Metric) => facts.push({ id, state: value.state, value: value.value, unit: value.unit, sampleCount: value.sampleCount, denominator: value.denominator, startDate: value.period.startDate, endDateExclusive: value.period.endDateExclusive, partial: value.period.partial, quality: value.quality });
  for (const [name, value] of Object.entries(result.weight.averages)) add(`weight.${name}.mean`, value);
  add('weight.daily_delta', result.weight.dailyDelta);
  add('weight.recent_change', result.weight.recentChange);
  add('weight.change_per_calendar_day', result.weight.changePerCalendarDay);
  for (const [name, period] of Object.entries(result.workout.periods)) {
    for (const key of ['completed', 'partial', 'stopped', 'unclassified', 'recordedPlannedDayCompletionRate'] as const) add(`workout.${name}.${key}`, period[key]);
    for (const key of ['yes', 'no', 'unanswered'] as const) add(`workout.${name}.pain.${key}`, period.pain[key]);
  }
  add('workout.observed_consecutive_days', result.workout.observedConsecutiveDaysEndingAtLastRecord);
  add('workout.days_since_last_record', result.workout.daysSinceLastRecordedCompletion);
  for (const currency of result.spending.byCurrency) {
    for (const [name, period] of Object.entries(currency.periods)) for (const key of ['expenses', 'refunds', 'income', 'savings', 'scheduled'] as const) add(`spending.${currency.currency}.${name}.${key}`, period[key]);
    add(`spending.${currency.currency}.monthly_budget`, currency.configuredMonthlyBudget);
    add(`spending.${currency.currency}.monthly_budget_usage`, currency.monthlyBudgetUsage);
    add(`spending.${currency.currency}.completed7_change`, currency.completed7Change);
  }
  return {
    schemaVersion: 1 as const, asOf: result.asOf, timeZone: result.timeZone, sensitive: true as const,
    semantics: 'recorded_observations_only' as const, quality: result.quality,
    domains: result.provenance.map(({ domain, source }) => ({ domain, status: source?.status ?? 'not_provided', quality: source?.quality ?? null })),
    facts,
  };
}
