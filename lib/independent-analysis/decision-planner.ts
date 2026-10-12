import type { Quality, Reason, WindowName } from './contracts.ts';
import type { projectAnalysisFacts } from './index.ts';
import { buildWindows, calendarDay, parseInstant, periodsComparable } from './dates.ts';
import { CURRENCY_DECIMALS } from './money.ts';
import { quality } from './quality.ts';

type Facts = ReturnType<typeof projectAnalysisFacts>;
type Domain = 'weight' | 'workout' | 'spending';
export type DecisionState = 'blocked' | 'insufficient_data' | 'no_meaningful_change' | 'routine' | 'complex_review';
export type DecisionReason = 'policy_invalid' | 'evidence_invalid' | 'clock_invalid'
  | 'snapshot_in_future' | 'snapshot_expired' | 'source_quality_blocked' | 'source_quality_limited'
  | 'evidence_missing' | 'evidence_unknown' | 'evidence_quality_blocked' | 'evidence_quality_limited'
  | 'partial_period' | 'period_mismatch' | 'unit_mismatch' | 'insufficient_samples'
  | 'denominator_unknown_or_zero' | 'numeric_range_invalid' | 'unchanged' | 'numeric_increase'
  | 'numeric_decrease' | 'below_change_threshold' | 'change_threshold_reached'
  | 'complex_threshold_reached' | 'complex_domain_count_reached';

/** All numbers are explicit policy inputs, not recommended clinical/financial thresholds.
 * There are no defaults. Version strings identify local configuration, not approval. */
export interface DecisionComparisonRule {
  id: string; currentFactId: string; baselineFactId: string; unit: string;
  minimumSamplesPerPeriod: number;
  meaningfulAbsoluteChange: number;
  complexAbsoluteChange: number | null;
}
export interface DecisionPolicy {
  schemaVersion: 1; version: string; purpose: 'local_decision_planning';
  maximumSnapshotAgeMs: number;
  /** Explicit count of distinct changed domains, not evidence of deterioration/causation. */
  complexWhenChangedDomainsAtLeast: number | null;
  rules: readonly DecisionComparisonRule[];
}
export interface DecisionRuleResult {
  ruleId: string; state: DecisionState; reasonCodes: DecisionReason[]; evidenceIds: string[];
}
export interface DecisionPlan {
  schemaVersion: 1; mode: 'local_planning_only'; scope: 'configured_comparisons_only';
  state: DecisionState; policyVersion: string | null;
  reasonCodes: DecisionReason[]; evidenceIds: string[]; rules: DecisionRuleResult[];
  authority: {
    dispatch: 'not_authorized'; provider: 'not_checked'; consent: 'not_checked';
    price: 'not_checked'; budget: 'not_checked';
  };
}

const WINDOWS: readonly WindowName[] = ['today', 'yesterday', 'recent7', 'previous7', 'recent30', 'month', 'completed7', 'previousCompleted7'];
const REASONS: readonly Reason[] = ['source_unavailable', 'source_invalid', 'source_incomplete', 'coverage_gap',
  'no_records', 'future_excluded', 'stale_revision', 'partial_period', 'missing_baseline', 'zero_baseline',
  'period_mismatch', 'plan_unknown', 'no_planned_days', 'same_day', 'budget_unset', 'zero_budget', 'unanswered', 'currency_absent'];
const DOMAINS = ['weight', 'workout', 'spending', 'plans'];

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
}
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER; }
function validQuality(value: unknown): value is Quality {
  if (!object(value) || !exactKeys(value, ['status', 'reasons']) || !Array.isArray(value.reasons)
    || value.reasons.some(reason => !REASONS.includes(reason)) || new Set(value.reasons).size !== value.reasons.length) return false;
  return value.status === quality(...value.reasons as Reason[]).status;
}
function unusable(value: Quality): boolean { return value.status === 'blocked' || value.status === 'stale'; }
function unique<T extends string>(values: T[]): T[] { return [...new Set(values)].sort(); }

interface ComparisonMetric { domain: Domain; window: WindowName; key: string; unit: string; requiresDenominator: boolean }
/** Only already-projected period metrics can be compared. Same units alone do not
 * make income/expenses, completed/stopped or different currencies comparable. */
function comparisonMetric(id: unknown): ComparisonMetric | null {
  if (typeof id !== 'string') return null;
  const parts = id.split('.');
  let domain: Domain, window: string, key: string, unit: string, requiresDenominator = false;
  if (parts[0] === 'weight' && parts.length === 3 && parts[2] === 'mean') {
    domain = 'weight'; window = parts[1]; key = 'weight.mean'; unit = 'kg'; requiresDenominator = true;
  } else if (parts[0] === 'workout' && parts.length === 3
    && ['completed', 'partial', 'stopped', 'unclassified', 'recordedPlannedDayCompletionRate'].includes(parts[2])) {
    domain = 'workout'; window = parts[1]; key = `workout.${parts[2]}`;
    requiresDenominator = parts[2] === 'recordedPlannedDayCompletionRate';
    unit = requiresDenominator ? 'percent_of_planned_days_with_recorded_completion' : 'recorded_sessions';
  } else if (parts[0] === 'workout' && parts.length === 4 && parts[2] === 'pain' && ['yes', 'no', 'unanswered'].includes(parts[3])) {
    domain = 'workout'; window = parts[1]; key = `workout.pain.${parts[3]}`; unit = 'recorded_answers'; requiresDenominator = true;
  } else if (parts[0] === 'spending' && parts.length === 4 && Object.hasOwn(CURRENCY_DECIMALS, parts[1])
    && ['expenses', 'refunds', 'income', 'savings', 'scheduled'].includes(parts[3])) {
    domain = 'spending'; window = parts[2]; key = `spending.${parts[1]}.${parts[3]}`; unit = `${parts[1]}_minor`;
  } else return null;
  return WINDOWS.includes(window as WindowName) ? { domain, window: window as WindowName, key, unit, requiresDenominator } : null;
}

function validPolicy(value: unknown): value is DecisionPolicy {
  if (!object(value) || !exactKeys(value, ['schemaVersion', 'version', 'purpose', 'maximumSnapshotAgeMs', 'complexWhenChangedDomainsAtLeast', 'rules'])
    || value.schemaVersion !== 1 || !identifier(value.version) || value.purpose !== 'local_decision_planning'
    || !integer(value.maximumSnapshotAgeMs) || !Array.isArray(value.rules) || value.rules.length === 0) return false;
  const ids = new Set<string>(), pairs = new Set<string>(), domains = new Set<Domain>();
  for (const rule of value.rules) {
    if (!object(rule) || !exactKeys(rule, ['id', 'currentFactId', 'baselineFactId', 'unit', 'minimumSamplesPerPeriod', 'meaningfulAbsoluteChange', 'complexAbsoluteChange'])
      || !identifier(rule.id) || ids.has(rule.id) || !integer(rule.minimumSamplesPerPeriod) || rule.minimumSamplesPerPeriod < 1
      || !finite(rule.meaningfulAbsoluteChange) || rule.meaningfulAbsoluteChange <= 0
      || (rule.complexAbsoluteChange !== null && (!finite(rule.complexAbsoluteChange) || rule.complexAbsoluteChange < rule.meaningfulAbsoluteChange))) return false;
    const current = comparisonMetric(rule.currentFactId), baseline = comparisonMetric(rule.baselineFactId);
    if (!current || !baseline || current.key !== baseline.key || current.window === baseline.window || rule.unit !== current.unit) return false;
    const pair = `${rule.currentFactId}:${rule.baselineFactId}`;
    if (pairs.has(pair)) return false;
    ids.add(rule.id); pairs.add(pair); domains.add(current.domain);
  }
  return value.complexWhenChangedDomainsAtLeast === null || (integer(value.complexWhenChangedDomainsAtLeast)
    && value.complexWhenChangedDomainsAtLeast >= 2 && value.complexWhenChangedDomainsAtLeast <= domains.size);
}

function validFacts(value: unknown): value is Facts {
  if (!object(value) || !exactKeys(value, ['schemaVersion', 'asOf', 'timeZone', 'sensitive', 'semantics', 'quality', 'domains', 'facts'])
    || value.schemaVersion !== 1 || value.sensitive !== true || value.semantics !== 'recorded_observations_only'
    || typeof value.asOf !== 'string' || typeof value.timeZone !== 'string' || !validQuality(value.quality)
    || !Array.isArray(value.domains) || !Array.isArray(value.facts)) return false;
  const domains = new Set<string>(), facts = new Set<string>();
  for (const domain of value.domains) {
    if (!object(domain) || !exactKeys(domain, ['domain', 'status', 'quality']) || typeof domain.domain !== 'string'
      || !DOMAINS.includes(domain.domain) || domains.has(domain.domain)) return false;
    if (domain.domain === 'plans' && domain.status === 'not_provided') { if (domain.quality !== null) return false; }
    else if (typeof domain.status !== 'string' || !['ok', 'empty', 'unavailable', 'incomplete', 'invalid'].includes(domain.status) || !validQuality(domain.quality)) return false;
    domains.add(domain.domain);
  }
  if (domains.size !== DOMAINS.length) return false;
  for (const fact of value.facts) {
    if (!object(fact) || !exactKeys(fact, ['id', 'state', 'value', 'unit', 'sampleCount', 'denominator', 'startDate', 'endDateExclusive', 'partial', 'quality'])
      || !identifier(fact.id) || facts.has(fact.id) || typeof fact.unit !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_/]{0,127}$/.test(fact.unit)
      || !integer(fact.sampleCount) || !(fact.denominator === null || (finite(fact.denominator) && fact.denominator >= 0))
      || !((fact.state === 'known' && finite(fact.value)) || (fact.state === 'unknown' && fact.value === null))
      || typeof fact.startDate !== 'string' || typeof fact.endDateExclusive !== 'string' || typeof fact.partial !== 'boolean'
      || !validQuality(fact.quality)) return false;
    facts.add(fact.id);
    if (calendarDay(fact.startDate) >= calendarDay(fact.endDateExclusive)) return false;
  }
  return true;
}

/** Pure local preparation, with no default policy, ambient clock, advice or execution.
 * The single C projection is a trusted-source contract, not authenticated provenance.
 * This function cannot establish owner identity or authorize transmission. */
export function planAnalysisDecision(evidence: unknown, policy: unknown, now: string): DecisionPlan {
  const result: DecisionPlan = {
    schemaVersion: 1, mode: 'local_planning_only', scope: 'configured_comparisons_only',
    state: 'blocked', policyVersion: null, reasonCodes: [], evidenceIds: [], rules: [],
    authority: { dispatch: 'not_authorized', provider: 'not_checked', consent: 'not_checked', price: 'not_checked', budget: 'not_checked' },
  };
  const stop = (reason: DecisionReason): DecisionPlan => ({ ...result, reasonCodes: [reason] });
  try { if (!validPolicy(policy)) return stop('policy_invalid'); }
  catch { return stop('policy_invalid'); }
  result.policyVersion = policy.version;
  try { if (!validFacts(evidence)) return stop('evidence_invalid'); }
  catch { return stop('evidence_invalid'); }
  let currentInstant: number;
  try { currentInstant = parseInstant(now); } catch { return stop('clock_invalid'); }
  let windows: ReturnType<typeof buildWindows>, age: number;
  try { age = currentInstant - parseInstant(evidence.asOf); windows = buildWindows(evidence.asOf, evidence.timeZone); }
  catch { return stop('evidence_invalid'); }
  if (age < 0) return stop('snapshot_in_future');
  if (age > policy.maximumSnapshotAgeMs) return stop('snapshot_expired');
  if (unusable(evidence.quality) || evidence.domains.some(domain => domain.quality && unusable(domain.quality))
    || evidence.domains.some(domain => ['unavailable', 'incomplete', 'invalid'].includes(domain.status))) return stop('source_quality_blocked');
  const byId = new Map(evidence.facts.map(fact => [fact.id, fact]));
  const changedDomains = new Set<Domain>();
  for (const rule of [...policy.rules].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const metric = comparisonMetric(rule.currentFactId)!;
    const baselineMetric = comparisonMetric(rule.baselineFactId)!;
    const current = byId.get(rule.currentFactId), baseline = byId.get(rule.baselineFactId);
    const row: DecisionRuleResult = { ruleId: rule.id, state: 'insufficient_data', reasonCodes: [], evidenceIds: unique([current?.id, baseline?.id].filter((id): id is string => !!id)) };
    const reject = (reason: DecisionReason, blocked = false) => {
      row.reasonCodes.push(reason); if (blocked) row.state = 'blocked';
    };
    const source = evidence.domains.find(domain => domain.domain === metric.domain)!;
    if (source.quality!.status === 'limited') reject('source_quality_limited');
    if (metric.key === 'workout.recordedPlannedDayCompletionRate') {
      const plans = evidence.domains.find(domain => domain.domain === 'plans')!;
      if (plans.status !== 'ok') reject('evidence_unknown');
      if (plans.quality?.status === 'limited') reject('source_quality_limited');
    }
    if (!current || !baseline) reject('evidence_missing');
    for (const [fact, descriptor] of [[current, metric], [baseline, baselineMetric]] as const) {
      if (!fact) continue;
      if (fact.unit !== rule.unit) reject('unit_mismatch', true);
      if (fact.state !== 'known') reject('evidence_unknown');
      if (unusable(fact.quality)) reject('evidence_quality_blocked', true);
      else if (fact.quality.status !== 'valid') reject('evidence_quality_limited');
      if (fact.partial) reject('partial_period');
      const expected = windows[descriptor.window];
      if (fact.startDate !== expected.startDate || fact.endDateExclusive !== expected.endDateExclusive || fact.partial !== expected.partial) reject('period_mismatch');
      if (fact.sampleCount < rule.minimumSamplesPerPeriod) reject('insufficient_samples');
      // Rate samples also contain plan rows, even when the workout source is empty.
      if (source.status === 'empty' && ((descriptor.key !== 'workout.recordedPlannedDayCompletionRate' && fact.sampleCount > 0)
        || (fact.value !== null && fact.value !== 0))) reject('evidence_invalid', true);
      if (descriptor.requiresDenominator && (fact.denominator === null || fact.denominator <= 0)) reject('denominator_unknown_or_zero');
      // A forged negative count/money/weight mean is not a signed change metric.
      if (fact.value !== null && (fact.value < 0 || (descriptor.domain === 'weight' && fact.value === 0)
        || ((descriptor.unit.endsWith('_minor') || descriptor.unit.startsWith('recorded_')) && !Number.isSafeInteger(fact.value))
        || (descriptor.unit.startsWith('recorded_') && fact.value !== fact.sampleCount)
        || (descriptor.unit === 'recorded_answers' && fact.denominator !== null
          && (!Number.isSafeInteger(fact.denominator) || fact.sampleCount > fact.denominator))
        || (descriptor.domain === 'weight' && fact.denominator !== null && fact.denominator > 0 && fact.denominator !== fact.sampleCount)
        || (descriptor.key === 'workout.recordedPlannedDayCompletionRate' && (fact.value > 100
          || fact.sampleCount < expected.calendarDays
          || (fact.value === 0 ? fact.sampleCount !== expected.calendarDays : fact.sampleCount === expected.calendarDays)
          || (fact.denominator !== null && (!Number.isSafeInteger(fact.denominator) || fact.denominator > expected.calendarDays)))))) reject('numeric_range_invalid', true);
    }
    const currentPeriod = windows[metric.window], baselinePeriod = windows[baselineMetric.window];
    if (!periodsComparable(currentPeriod, baselinePeriod) || baselinePeriod.endDateExclusive !== currentPeriod.startDate) reject('period_mismatch');
    if (row.reasonCodes.length === 0 && current && baseline) {
      // Absolute difference: zero baseline is valid, no percentage division occurs.
      const delta = current.value! - baseline.value!, magnitude = Math.abs(delta);
      if (!finite(delta)) reject('numeric_range_invalid', true);
      else {
        row.reasonCodes.push(delta === 0 ? 'unchanged' : delta > 0 ? 'numeric_increase' : 'numeric_decrease');
        if (magnitude < rule.meaningfulAbsoluteChange) { row.state = 'no_meaningful_change'; row.reasonCodes.push('below_change_threshold'); }
        else {
          changedDomains.add(metric.domain); row.reasonCodes.push('change_threshold_reached');
          row.state = 'routine';
          if (rule.complexAbsoluteChange !== null && magnitude >= rule.complexAbsoluteChange) { row.state = 'complex_review'; row.reasonCodes.push('complex_threshold_reached'); }
        }
      }
    }
    row.reasonCodes = unique(row.reasonCodes); result.rules.push(row);
  }
  result.reasonCodes = unique(result.rules.flatMap(rule => rule.reasonCodes));
  result.evidenceIds = unique(result.rules.flatMap(rule => rule.evidenceIds));
  if (result.rules.some(rule => rule.state === 'blocked')) result.state = 'blocked';
  else if (result.rules.some(rule => rule.state === 'insufficient_data')) result.state = 'insufficient_data';
  else if (policy.complexWhenChangedDomainsAtLeast !== null && changedDomains.size >= policy.complexWhenChangedDomainsAtLeast) {
    result.state = 'complex_review'; result.reasonCodes = unique([...result.reasonCodes, 'complex_domain_count_reached']);
  } else if (result.rules.some(rule => rule.state === 'complex_review')) result.state = 'complex_review';
  else if (result.rules.some(rule => rule.state === 'routine')) result.state = 'routine';
  else result.state = 'no_meaningful_change';
  return result;
}
