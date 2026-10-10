import { AnalysisInputError, type Coverage, type NormalRecord, type PlanRecord, type Reason, type Snapshot, type Source, type SourceStatus, type SpendingRecord, type WeightRecord, type WorkoutRecord } from './contracts.ts';
import { buildWindows, calendarDay, localDateAt, parseInstant, validateTimeZone } from './dates.ts';
import { parseMoney } from './money.ts';
import { canonicalJson, compareText, quality } from './quality.ts';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AnalysisInputError('object');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) throw new AnalysisInputError('text');
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new AnalysisInputError('integer');
  return value;
}
function optionalText(value: unknown): string | null { return value === undefined || value === null ? null : text(value); }
function coverage(value: unknown): Coverage {
  const raw = object(value), startDate = text(raw.startDate), endDateExclusive = text(raw.endDateExclusive);
  if (calendarDay(startDate) >= calendarDay(endDateExclusive) || typeof raw.complete !== 'boolean') throw new AnalysisInputError('coverage');
  return { startDate, endDateExclusive, complete: raw.complete, totalRows: raw.totalRows === null ? null : integer(raw.totalRows) };
}
type Context = { ownerId: string; asOf: string; today: string; timeZone: string };
function normalizeSource<T extends NormalRecord>(input: unknown, ctx: Context, parse: (raw: Record<string, unknown>, base: NormalRecord) => T): Source<T> {
  const raw = object(input), sourceId = text(raw.sourceId), sourceVersion = text(raw.sourceVersion);
  const currentVersion = raw.currentVersion === undefined ? sourceVersion : text(raw.currentVersion);
  if (typeof raw.status !== 'string' || !['ok', 'empty', 'unavailable', 'incomplete', 'invalid'].includes(raw.status) || !Array.isArray(raw.records)) throw new AnalysisInputError('source_schema');
  const status = raw.status as SourceStatus, cov = coverage(raw.coverage), reasons: Reason[] = [];
  if ((status === 'empty' || status === 'unavailable' || status === 'invalid') && raw.records.length !== 0) throw new AnalysisInputError('source_status_conflict');
  if (status === 'ok' && raw.records.length === 0) throw new AnalysisInputError('source_status_conflict');
  if (status === 'unavailable') reasons.push('source_unavailable');
  if (status === 'invalid') reasons.push('source_invalid');
  if (status === 'incomplete' || !cov.complete || cov.totalRows === null || cov.totalRows !== raw.records.length) reasons.push('source_incomplete');
  if (currentVersion !== sourceVersion) reasons.push('stale_revision');
  const groups = new Map<string, T[]>();
  for (const item of raw.records) {
    const row = object(item);
    if (text(row.ownerId) !== ctx.ownerId) throw new AnalysisInputError('mixed_owner');
    const id = text(row.id), revision = integer(row.revision);
    if ((row.date === undefined) === (row.timestamp === undefined)) throw new AnalysisInputError('record_date');
    const timestamp = row.timestamp === undefined ? null : new Date(parseInstant(text(row.timestamp))).toISOString();
    const date = timestamp ? localDateAt(timestamp, ctx.timeZone) : text(row.date);
    calendarDay(date);
    const updatedAt = row.updatedAt === undefined ? null : new Date(parseInstant(text(row.updatedAt))).toISOString();
    if (timestamp && updatedAt && parseInstant(updatedAt) < parseInstant(timestamp)) throw new AnalysisInputError('revision_time');
    const base: NormalRecord = { id, revision, date, timestamp, updatedAt, evidence: { sourceId, sourceVersion, recordId: id, revision } };
    const record = parse(row, base);
    const versions = groups.get(id);
    if (versions) versions.push(record); else groups.set(id, [record]);
  }
  const records: T[] = [];
  let deduplicatedCount = 0, excludedFutureCount = 0;
  for (const versions of groups.values()) {
    // Explicit source revision wins. Never infer edits from amount, date, or row order.
    versions.sort((a, b) => b.revision - a.revision);
    for (let i = 1; i < versions.length; i++) if (versions[i].revision === versions[i - 1].revision && canonicalJson(versions[i]) !== canonicalJson(versions[i - 1])) throw new AnalysisInputError('disputed_record_revision');
    deduplicatedCount += versions.length - 1;
    const record = versions[0];
    // An edit made after the requested snapshot can hide a prior fact. This slice
    // does not claim to reconstruct historical rows from an incomplete revision log.
    // Block the source rather than quietly publishing the remaining subtotal.
    if (versions.some(version => version.updatedAt && parseInstant(version.updatedAt) > parseInstant(ctx.asOf))) reasons.push('source_incomplete');
    if (record.date > ctx.today || (record.timestamp && parseInstant(record.timestamp) > parseInstant(ctx.asOf)) || (record.updatedAt && parseInstant(record.updatedAt) > parseInstant(ctx.asOf))) {
      excludedFutureCount++; continue;
    }
    if (record.date < cov.startDate || record.date >= cov.endDateExclusive) throw new AnalysisInputError('record_outside_coverage');
    records.push(record);
  }
  records.sort((a, b) => compareText(a.date, b.date) || compareText(a.id, b.id));
  if (excludedFutureCount) reasons.push('future_excluded');
  return { sourceId, sourceVersion, currentVersion, status, coverage: cov, records, quality: quality(...reasons), excludedFutureCount, deduplicatedCount };
}
export function normalizeSnapshot(input: unknown): Snapshot {
  let decoded = input;
  if (typeof decoded === 'string') {
    try { decoded = JSON.parse(decoded); } catch { throw new AnalysisInputError('json'); }
  }
  const raw = object(decoded);
  if (raw.schemaVersion !== 1) throw new AnalysisInputError('schema_version');
  const ownerId = text(raw.ownerId), timeZone = text(raw.timeZone);
  validateTimeZone(timeZone);
  const asOf = new Date(parseInstant(text(raw.asOf))).toISOString(), today = localDateAt(asOf, timeZone);
  const ctx = { ownerId, asOf, today, timeZone }, sources = object(raw.sources);
  const weight = normalizeSource<WeightRecord>(sources.weight, ctx, (row, base) => {
    if (row.unit !== 'kg' || typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value <= 0 || row.value > Number.MAX_SAFE_INTEGER) throw new AnalysisInputError('weight');
    return { ...base, value: row.value, unit: 'kg' };
  });
  const workout = normalizeSource<WorkoutRecord>(sources.workout, ctx, (row, base) => {
    // Legacy false means no positive completion evidence, not a failed exercise.
    const status = row.status === true ? 'completed' : row.status === false ? 'unknown' : row.status;
    if (typeof status !== 'string' || !['completed', 'partial', 'stopped', 'unknown'].includes(status)) throw new AnalysisInputError('workout_status');
    const pain = row.pain ?? 'unknown';
    if (typeof pain !== 'string' || !['yes', 'no', 'unknown'].includes(pain)) throw new AnalysisInputError('pain');
    return { ...base, status: status as WorkoutRecord['status'], pain: pain as WorkoutRecord['pain'], kind: optionalText(row.kind) };
  });
  const plans = sources.plans === undefined ? null : normalizeSource<PlanRecord>(sources.plans, ctx, (row, base) => {
    if (typeof row.state !== 'string' || !['planned', 'rest', 'unavailable'].includes(row.state)) throw new AnalysisInputError('plan');
    return { ...base, state: row.state as PlanRecord['state'] };
  });
  if (plans && new Set(plans.records.map(row => row.date)).size !== plans.records.length) throw new AnalysisInputError('disputed_plan_date');
  const spending = normalizeSource<SpendingRecord>(sources.spending, ctx, (row, base) => {
    if (typeof row.kind !== 'string' || !['expense', 'income', 'savings', 'refund', 'scheduled', 'monthly_budget'].includes(row.kind)) throw new AnalysisInputError('money_kind');
    const currency = text(row.currency), { minor, decimals } = parseMoney(row.amount, currency);
    if (row.kind === 'monthly_budget' && !base.date.endsWith('-01')) throw new AnalysisInputError('budget_month');
    return { ...base, kind: row.kind as SpendingRecord['kind'], currency, minor, decimals, category: optionalText(row.category) };
  });
  const budgetKeys = spending.records.filter(row => row.kind === 'monthly_budget').map(row => `${row.date}:${row.currency}`);
  if (new Set(budgetKeys).size !== budgetKeys.length) throw new AnalysisInputError('disputed_monthly_budget');
  const allSources = [weight, workout, spending, ...(plans ? [plans] : [])];
  if (new Set(allSources.map(source => source.sourceId)).size !== allSources.length) throw new AnalysisInputError('duplicate_source_id');
  return { schemaVersion: 1, asOf, today, timeZone, windows: buildWindows(asOf, timeZone), sources: { weight, workout, spending, plans }, quality: quality(...allSources.flatMap(source => source.quality.reasons)) };
}
