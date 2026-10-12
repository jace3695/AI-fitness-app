import type { Evidence, Metric, NormalRecord, Period, Quality, Reason, Source } from './contracts.ts';

export function quality(...reasons: Reason[]): Quality {
  const unique = [...new Set(reasons)].sort();
  const status = unique.includes('stale_revision') ? 'stale' : unique.some(reason => ['source_unavailable', 'source_invalid', 'source_incomplete', 'coverage_gap'].includes(reason)) ? 'blocked' : unique.length ? 'limited' : 'valid';
  return { status, reasons: unique };
}
export function sourceReasons(source: Source<NormalRecord> | null, period: Period): Reason[] {
  if (!source) return ['plan_unknown'];
  const reasons = [...source.quality.reasons];
  if (source.coverage.startDate > period.startDate || source.coverage.endDateExclusive < period.endDateExclusive) reasons.push('coverage_gap');
  return [...new Set(reasons)].sort();
}
export function blocked(reasons: Reason[]): boolean {
  return reasons.some(reason => ['source_unavailable', 'source_invalid', 'source_incomplete', 'coverage_gap', 'stale_revision'].includes(reason));
}
export function evidence(records: readonly NormalRecord[]): Evidence[] {
  const unique = new Map(records.map(record => [JSON.stringify(record.evidence), record.evidence]));
  return [...unique.values()].sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)));
}
export function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
export function metric(value: number | null, unit: string, period: Period, records: readonly NormalRecord[], denominator: number | null, reasons: Reason[] = []): Metric {
  const all = [...reasons, ...(period.partial ? ['partial_period' as const] : [])];
  return { state: value === null ? 'unknown' : 'known', value, unit, sampleCount: records.length, denominator, period, evidence: evidence(records), quality: quality(...all) };
}
/** Not a cryptographic digest, owner key, idempotency key, or permission token. */
export function stableFingerprint(value: unknown): string {
  const canonical = canonicalJson(value);
  let hash = 2166136261;
  for (let i = 0; i < canonical.length; i++) hash = Math.imul(hash ^ canonical.charCodeAt(i), 16777619);
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
