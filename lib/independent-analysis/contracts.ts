/** PHASE C only: immutable, caller-supplied snapshots. No loaders or provider calls. */
export type SourceStatus = 'ok' | 'empty' | 'unavailable' | 'incomplete' | 'invalid';
export type Reason = 'source_unavailable' | 'source_invalid' | 'source_incomplete' | 'coverage_gap'
  | 'no_records' | 'future_excluded' | 'stale_revision' | 'partial_period' | 'missing_baseline'
  | 'zero_baseline' | 'period_mismatch' | 'plan_unknown' | 'no_planned_days' | 'same_day'
  | 'budget_unset' | 'zero_budget' | 'unanswered' | 'currency_absent';
export interface Quality { status: 'valid' | 'limited' | 'blocked' | 'stale'; reasons: Reason[] }
export interface Coverage { startDate: string; endDateExclusive: string; complete: boolean; totalRows: number | null }
export interface Evidence { sourceId: string; sourceVersion: string; recordId: string; revision: number }
export interface Period { name: string; startDate: string; endDateExclusive: string; calendarDays: number; partial: boolean; asOf: string; timeZone: string }
export type WindowName = 'today' | 'yesterday' | 'recent7' | 'previous7' | 'recent30' | 'month' | 'completed7' | 'previousCompleted7';
export type Windows = Record<WindowName, Period>;
export interface Metric {
  state: 'known' | 'unknown'; value: number | null; unit: string; sampleCount: number;
  denominator: number | null; period: Period; evidence: Evidence[]; quality: Quality;
}
export interface SourceInput {
  sourceId: string; sourceVersion: string; currentVersion?: string; status: SourceStatus;
  coverage: Coverage; records: readonly unknown[];
}
export interface SnapshotInput {
  schemaVersion: 1; ownerId: string; asOf: string; timeZone: string;
  sources: { weight: SourceInput; workout: SourceInput; spending: SourceInput; plans?: SourceInput };
}
export interface RecordInput {
  id: string; ownerId: string; revision: number;
  /** Exactly one of date or timestamp. date is already a local calendar date. */
  date?: string; timestamp?: string; updatedAt?: string;
}
export interface WeightInput extends RecordInput { value: number; unit: 'kg' }
export type WorkoutStatus = 'completed' | 'partial' | 'stopped' | 'unknown';
export interface WorkoutInput extends RecordInput { status: WorkoutStatus | boolean; kind?: string | null; pain?: 'yes' | 'no' | 'unknown' | null }
export interface PlanInput extends RecordInput { state: 'planned' | 'rest' | 'unavailable' }
export type MoneyKind = 'expense' | 'income' | 'savings' | 'refund' | 'scheduled' | 'monthly_budget';
export interface SpendingInput extends RecordInput { kind: MoneyKind; currency: string; amount: string; category?: string | null }
export interface NormalRecord { id: string; date: string; revision: number; timestamp: string | null; updatedAt: string | null; evidence: Evidence }
export interface WeightRecord extends NormalRecord { value: number; unit: 'kg' }
export interface WorkoutRecord extends NormalRecord { status: WorkoutStatus; kind: string | null; pain: 'yes' | 'no' | 'unknown' }
export interface PlanRecord extends NormalRecord { state: 'planned' | 'rest' | 'unavailable' }
export interface SpendingRecord extends NormalRecord { kind: MoneyKind; currency: string; minor: number; decimals: number; category: string | null }
export interface Source<T extends NormalRecord> {
  sourceId: string; sourceVersion: string; currentVersion: string; status: SourceStatus;
  coverage: Coverage; records: T[]; quality: Quality; excludedFutureCount: number; deduplicatedCount: number;
}
export interface Snapshot {
  schemaVersion: 1; asOf: string; timeZone: string; today: string; windows: Windows;
  sources: { weight: Source<WeightRecord>; workout: Source<WorkoutRecord>; spending: Source<SpendingRecord>; plans: Source<PlanRecord> | null };
  quality: Quality;
}
export class AnalysisInputError extends Error {
  readonly code: string;
  constructor(code: string) { super(`Invalid analysis input: ${code}`); this.code = code; this.name = 'AnalysisInputError'; }
}
