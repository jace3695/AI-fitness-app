import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeSnapshot, projectAnalysisFacts } from './index.ts';
import type { SnapshotInput, SourceInput, WeightInput, SpendingInput, WorkoutInput, PlanInput } from './contracts.ts';
import { addDays, buildWindows } from './dates.ts';
import { planAnalysisDecision } from './decision-planner.ts';
import type { DecisionComparisonRule, DecisionPolicy, DecisionPlan, DecisionReason, DecisionState } from './decision-planner.ts';

// These policy amounts/counts are deliberately synthetic, not production guidance.
const NOW = '2026-10-10T03:00:00.000Z';
const OWNER = 'SYNTHETIC_OWNER_PRIVATE';
type Facts = ReturnType<typeof projectAnalysisFacts>;
function source(sourceId: string, records: readonly unknown[]): SourceInput {
  return { sourceId, sourceVersion: 'fixture-v1', status: records.length ? 'ok' : 'empty',
    coverage: { startDate: '2020-01-01', endDateExclusive: '2030-01-01', complete: true, totalRows: records.length }, records };
}
function snapshot(current = 72, baseline = 70, asOf = NOW, timeZone = 'Asia/Seoul'): SnapshotInput {
  const windows = buildWindows(asOf, timeZone);
  const currentDate = addDays(windows.completed7.endDateExclusive, -1), baselineDate = addDays(windows.previousCompleted7.endDateExclusive, -1);
  const row = (id: string, date: string) => ({ id, ownerId: OWNER, revision: 1, date });
  const weights: WeightInput[] = [{ ...row('PRIVATE_CURRENT_WEIGHT', currentDate), value: current, unit: 'kg' }, { ...row('PRIVATE_BASELINE_WEIGHT', baselineDate), value: baseline, unit: 'kg' }];
  const spending: SpendingInput[] = [currentDate, baselineDate].map((date, i) => ({ ...row(`PRIVATE_MONEY_${i}`, date), kind: 'expense', amount: '100', currency: 'KRW' }));
  const workouts: WorkoutInput[] = [currentDate, baselineDate].map((date, i) => ({ ...row(`PRIVATE_WORKOUT_${i}`, date), status: 'completed', pain: 'no' }));
  return { schemaVersion: 1, ownerId: OWNER, asOf, timeZone,
    sources: { weight: source('PRIVATE_WEIGHT_SOURCE', weights), spending: source('PRIVATE_MONEY_SOURCE', spending), workout: source('PRIVATE_WORKOUT_SOURCE', workouts) } };
}
function facts(input = snapshot()): Facts { return projectAnalysisFacts(analyzeSnapshot(input)); }
function rule(overrides: Partial<DecisionComparisonRule> = {}): DecisionComparisonRule {
  return { id: 'fixture-weight-change', currentFactId: 'weight.completed7.mean', baselineFactId: 'weight.previousCompleted7.mean', unit: 'kg',
    minimumSamplesPerPeriod: 1, meaningfulAbsoluteChange: 2, complexAbsoluteChange: 10, ...overrides };
}
function policy(overrides: Partial<DecisionPolicy> = {}): DecisionPolicy {
  return { schemaVersion: 1, version: 'fixture-policy-v1', purpose: 'local_decision_planning', maximumSnapshotAgeMs: 3_600_000,
    complexWhenChangedDomainsAtLeast: null, rules: [rule()], ...overrides };
}
function fact(evidence: Facts, id = 'weight.completed7.mean'): Facts['facts'][number] {
  const found = evidence.facts.find(value => value.id === id); assert.ok(found); return found;
}
function outcome(evidence: unknown, config: unknown, state: DecisionState, reason?: DecisionReason, now = NOW): DecisionPlan {
  const result = planAnalysisDecision(evidence, config, now);
  assert.equal(result.state, state, JSON.stringify(result));
  if (reason) assert.ok(result.reasonCodes.includes(reason), JSON.stringify(result));
  assert.deepEqual(result.authority, { dispatch: 'not_authorized', provider: 'not_checked', consent: 'not_checked', price: 'not_checked', budget: 'not_checked' });
  assert.equal(result.scope, 'configured_comparisons_only');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  return result;
}

test('P01 real C projection derives routine from explicit policy with exact rule/evidence provenance', () => {
  const result = outcome(facts(), policy(), 'routine', 'change_threshold_reached');
  assert.equal(result.policyVersion, 'fixture-policy-v1');
  assert.deepEqual(result.evidenceIds, ['weight.completed7.mean', 'weight.previousCompleted7.mean']);
  assert.equal(result.rules[0].ruleId, 'fixture-weight-change');
  assert.ok(result.reasonCodes.includes('numeric_increase'));
});
test('P02 unchanged and sub-threshold evidence produce only scoped no-change', () => {
  outcome(facts(snapshot(70, 70)), policy(), 'no_meaningful_change', 'unchanged');
  outcome(facts(snapshot(71, 70)), policy(), 'no_meaningful_change', 'below_change_threshold');
  outcome(facts(snapshot(69, 70)), policy(), 'no_meaningful_change', 'numeric_decrease');
});
test('P03 negative signed changes are not invalid, positive, favorable or unfavorable by assumption', () => {
  const evidence = facts(snapshot(60, 70));
  assert.equal(fact(evidence, 'weight.recent_change').value, -10);
  const result = outcome(evidence, policy(), 'complex_review', 'numeric_decrease');
  assert.doesNotMatch(JSON.stringify(result), /healthy|unhealthy|improvement|worse|urgent|diagnos|recommendation|higher_is_bad/);
});
test('P04 complex review occurs at an explicit inclusive threshold and can be explicitly disabled', () => {
  outcome(facts(snapshot(79, 70)), policy(), 'routine');
  outcome(facts(snapshot(80, 70)), policy(), 'complex_review', 'complex_threshold_reached');
  outcome(facts(snapshot(80, 70)), policy({ rules: [rule({ complexAbsoluteChange: null })] }), 'routine');
});
test('P05 zero monetary baseline is valid absolute math, never a percent denominator or unknown zero', () => {
  const config = policy({ rules: [rule({ id: 'money-change', currentFactId: 'spending.KRW.completed7.expenses', baselineFactId: 'spending.KRW.previousCompleted7.expenses', unit: 'KRW_minor', meaningfulAbsoluteChange: 50, complexAbsoluteChange: 200 })] });
  for (const amounts of [['100', '0'], ['0', '100'], ['0', '0']]) {
    const input = snapshot(); input.sources.spending = source('PRIVATE_MONEY_SOURCE', input.sources.spending.records.map((row, i) => ({ ...row as SpendingInput, amount: amounts[i] })));
    const result = outcome(facts(input), config, amounts.every(value => value === '0') ? 'no_meaningful_change' : 'routine');
    assert.doesNotMatch(JSON.stringify(result), /Infinity|NaN|percent_change/);
  }
});
test('P06 multiple domains escalate only under explicit policy and count distinct domains', () => {
  const input = snapshot(); input.sources.spending = source('PRIVATE_MONEY_SOURCE', input.sources.spending.records.map((row, i) => ({ ...row as SpendingInput, amount: i === 0 ? '50' : '100' })));
  const rules = [rule(), rule({ id: 'money-change', currentFactId: 'spending.KRW.completed7.expenses', baselineFactId: 'spending.KRW.previousCompleted7.expenses', unit: 'KRW_minor', meaningfulAbsoluteChange: 25, complexAbsoluteChange: null })];
  const ordinary = outcome(facts(input), policy({ rules }), 'routine');
  assert.ok(ordinary.reasonCodes.includes('numeric_increase')); assert.ok(ordinary.reasonCodes.includes('numeric_decrease'));
  const complex = outcome(facts(input), policy({ rules, complexWhenChangedDomainsAtLeast: 2 }), 'complex_review', 'complex_domain_count_reached');
  assert.equal(complex.evidenceIds.length, 4);
  outcome(facts(input), policy({ rules: [rule()], complexWhenChangedDomainsAtLeast: 2 }), 'blocked', 'policy_invalid');
});
test('P07 no explicit policy, no version, no rules or omitted complex flag never invents defaults', () => {
  for (const config of [null, {}, { ...policy(), version: '' }, { ...policy(), version: undefined }, policy({ rules: [] }),
    { ...policy(), complexWhenChangedDomainsAtLeast: undefined }, policy({ rules: [rule({ complexAbsoluteChange: undefined })] })]) {
    outcome(facts(), config, 'blocked', 'policy_invalid');
  }
});
test('P08 invalid thresholds, sample requirements and coercible numbers fail closed', () => {
  for (const value of [0, -1, NaN, Infinity, '2', Number.MAX_SAFE_INTEGER + 1]) outcome(facts(), policy({ rules: [rule({ meaningfulAbsoluteChange: value as number })] }), 'blocked', 'policy_invalid');
  for (const value of [0, -1, 0.5, NaN, '1']) outcome(facts(), policy({ rules: [rule({ minimumSamplesPerPeriod: value as number })] }), 'blocked', 'policy_invalid');
  for (const value of [1, -1, NaN, Infinity, '10']) outcome(facts(), policy({ rules: [rule({ complexAbsoluteChange: value as number })] }), 'blocked', 'policy_invalid');
  for (const value of [-1, 0.5, NaN, '3600000']) outcome(facts(), policy({ maximumSnapshotAgeMs: value as number }), 'blocked', 'policy_invalid');
});
test('P09 duplicate rules and same-unit but semantically different pairs are rejected', () => {
  for (const rules of [[rule(), rule()], [rule(), rule({ id: 'duplicate-pair' })], [rule({ baselineFactId: 'weight.completed7.mean' })],
    [rule({ currentFactId: 'workout.completed7.completed', baselineFactId: 'workout.previousCompleted7.stopped', unit: 'recorded_sessions' })],
    [rule({ currentFactId: 'spending.KRW.completed7.expenses', baselineFactId: 'spending.KRW.previousCompleted7.income', unit: 'KRW_minor' })],
    [rule({ currentFactId: 'spending.USD.completed7.expenses', baselineFactId: 'spending.KRW.previousCompleted7.expenses', unit: 'USD_minor' })]]) {
    outcome(facts(), policy({ rules }), 'blocked', 'policy_invalid');
  }
});
test('P10 unsupported fact IDs, units, schema versions, and configuration fields cannot broaden authority', () => {
  for (const config of [{ ...policy(), schemaVersion: 2 }, { ...policy(), need: 'complex_review' }, { ...policy(), consent: true },
    { ...policy(), provider: 'approved' }, { ...policy(), budget: 0 }, { ...policy(), price: 0 },
    policy({ rules: [rule({ currentFactId: 'weight.recent_change' })] }), policy({ rules: [rule({ unit: 'lb' })] })]) {
    outcome(facts(), config, 'blocked', 'policy_invalid');
  }
});
test('P11 stale, future and malformed clocks are closed; the explicit age boundary is inclusive', () => {
  outcome(facts(), policy(), 'routine', undefined, '2026-10-10T04:00:00Z');
  outcome(facts(), policy(), 'blocked', 'snapshot_expired', '2026-10-10T04:00:00.001Z');
  outcome(facts(), policy(), 'blocked', 'snapshot_in_future', '2026-10-10T02:59:59.999Z');
  for (const clock of ['', 'yesterday', '2026-02-30T00:00:00Z', '2026-10-10T25:00:00Z']) outcome(facts(), policy(), 'blocked', 'clock_invalid', clock);
  outcome(facts(), policy({ maximumSnapshotAgeMs: 0 }), 'routine');
});
test('P12 C stale revisions and unavailable/incomplete unselected sources block globally', () => {
  const stale = snapshot(); stale.sources.weight.currentVersion = 'fixture-v2';
  outcome(facts(stale), policy(), 'blocked', 'source_quality_blocked');
  const missing = snapshot(); missing.sources.spending = { ...source('PRIVATE_MONEY_SOURCE', []), status: 'unavailable' };
  outcome(facts(missing), policy(), 'blocked', 'source_quality_blocked');
  const partial = snapshot(); partial.sources.spending.coverage.totalRows = 100;
  outcome(facts(partial), policy(), 'blocked', 'source_quality_blocked');
});
test('P13 missing and unknown facts remain insufficient; no empty collection implies no-change', () => {
  const missing = facts(); missing.facts = missing.facts.filter(value => value.id !== 'weight.completed7.mean');
  const result = outcome(missing, policy(), 'insufficient_data', 'evidence_missing');
  assert.deepEqual(result.evidenceIds, ['weight.previousCompleted7.mean']);
  const empty = snapshot(); empty.sources.weight = source('PRIVATE_WEIGHT_SOURCE', []);
  outcome(facts(empty), policy(), 'insufficient_data', 'evidence_unknown');
});
test('P14 insufficient samples cannot become no-change, routine or complex', () => {
  for (const current of [70, 72, 90]) outcome(facts(snapshot(current)), policy({ rules: [rule({ minimumSamplesPerPeriod: 2 })] }), 'insufficient_data', 'insufficient_samples');
});
test('P15 incomplete metric quality, stale facts and internally inconsistent quality fail closed', () => {
  for (const [status, reason] of [['blocked', 'source_incomplete'], ['stale', 'stale_revision']] as const) {
    const evidence = facts(); fact(evidence).quality = { status, reasons: [reason] };
    outcome(evidence, policy(), 'blocked', 'evidence_quality_blocked');
  }
  const limited = facts(); fact(limited).quality = { status: 'limited', reasons: ['unanswered'] };
  outcome(limited, policy(), 'insufficient_data', 'evidence_quality_limited');
  const malformed = facts(); fact(malformed).quality = { status: 'valid', reasons: ['stale_revision'] };
  outcome(malformed, policy(), 'blocked', 'evidence_invalid');
});
test('P16 the source future-exclusion warning prevents a confident decision for that domain', () => {
  const input = snapshot(); input.sources.weight = source('PRIVATE_WEIGHT_SOURCE', [...input.sources.weight.records, { ...input.sources.weight.records[0] as WeightInput, id: 'PRIVATE_FUTURE', date: '2026-10-11' }]);
  outcome(facts(input), policy(), 'insufficient_data', 'source_quality_limited');
});
test('P17 partial today/recent-seven periods are insufficient even when both values exist', () => {
  const input = snapshot(); input.sources.weight = source('PRIVATE_WEIGHT_SOURCE', [...input.sources.weight.records, { ...input.sources.weight.records[0] as WeightInput, id: 'PRIVATE_TODAY', date: '2026-10-10' }]);
  outcome(facts(input), policy({ rules: [rule({ currentFactId: 'weight.today.mean', baselineFactId: 'weight.yesterday.mean' })] }), 'insufficient_data', 'partial_period');
  outcome(facts(input), policy({ rules: [rule({ currentFactId: 'weight.recent7.mean', baselineFactId: 'weight.previous7.mean' })] }), 'insufficient_data', 'partial_period');
});
test('P18 equal-length but shifted/fabricated date windows do not masquerade as matching C periods', () => {
  const evidence = facts(); fact(evidence).startDate = '2026-10-02'; fact(evidence).endDateExclusive = '2026-10-09';
  outcome(evidence, policy(), 'insufficient_data', 'period_mismatch');
  const forgedPartial = facts(); fact(forgedPartial).partial = true;
  outcome(forgedPartial, policy(), 'insufficient_data', 'period_mismatch');
});
test('P19 unequal lengths, reverse windows, gaps and overlapping periods fail closed', () => {
  for (const config of [rule({ currentFactId: 'weight.yesterday.mean' }), rule({ currentFactId: 'weight.previousCompleted7.mean', baselineFactId: 'weight.completed7.mean' }),
    rule({ currentFactId: 'weight.yesterday.mean', baselineFactId: 'weight.previous7.mean' }), rule({ currentFactId: 'weight.completed7.mean', baselineFactId: 'weight.previous7.mean' })]) {
    outcome(facts(), policy({ rules: [config] }), 'insufficient_data', 'period_mismatch');
  }
});
test('P20 impossible dates, invalid cutoffs and invalid time zones do not roll over or use host locale', () => {
  for (const date of ['2026-02-29', '2026-04-31', '0000-01-01', '2026-13-01', '2026-1-01']) {
    const evidence = facts(); fact(evidence).startDate = date;
    outcome(evidence, policy(), 'blocked', 'evidence_invalid');
  }
  for (const changes of [{ asOf: '2026-02-29T00:00:00Z' }, { timeZone: 'invalid/time-zone' }, { timeZone: '' }]) outcome({ ...facts(), ...changes }, policy(), 'blocked', 'evidence_invalid');
});
test('P21 leap-day, month/year boundaries and DST use completed local-calendar periods', () => {
  for (const [asOf, zone] of [['2024-03-01T03:00:00Z', 'Asia/Seoul'], ['2026-01-02T03:00:00Z', 'Asia/Seoul'],
    ['2026-03-09T04:00:00Z', 'America/New_York'], ['2026-11-02T05:00:00Z', 'America/New_York']]) {
    outcome(facts(snapshot(72, 70, asOf, zone)), policy(), 'routine', undefined, asOf);
  }
});
test('P22 equivalent clock offsets preserve the same decision', () => {
  assert.deepEqual(planAnalysisDecision(facts(), policy(), NOW), planAnalysisDecision(facts(), policy(), '2026-10-10T12:00:00+09:00'));
});
test('P23 currency/unit mismatches and altered known values cannot pass through a matching fact ID', () => {
  const evidence = facts(); fact(evidence).unit = 'lb'; outcome(evidence, policy(), 'blocked', 'unit_mismatch');
  for (const value of [-1, 0]) { const bad = facts(); fact(bad).value = value; outcome(bad, policy(), 'blocked', 'numeric_range_invalid'); }
  for (const value of [NaN, Infinity, '72', null, Number.MAX_SAFE_INTEGER + 1]) {
    const bad = facts(); fact(bad).value = value as number; outcome(bad, policy(), 'blocked', 'evidence_invalid');
  }
});
test('P24 zero/missing denominators remain insufficient for means and planned completion rates', () => {
  for (const denominator of [null, 0]) { const evidence = facts(); fact(evidence).denominator = denominator; outcome(evidence, policy(), 'insufficient_data', 'denominator_unknown_or_zero'); }
  const config = policy({ rules: [rule({ currentFactId: 'workout.completed7.recordedPlannedDayCompletionRate', baselineFactId: 'workout.previousCompleted7.recordedPlannedDayCompletionRate', unit: 'percent_of_planned_days_with_recorded_completion' })] });
  outcome(facts(), config, 'insufficient_data', 'evidence_unknown');
  const input = snapshot(), windows = buildWindows(NOW, input.timeZone);
  const plans: PlanInput[] = Array.from({ length: 14 }, (_, i) => ({ id: `PRIVATE_PLAN_${i}`, ownerId: OWNER, revision: 1, date: addDays(windows.previousCompleted7.startDate, i), state: 'rest' }));
  input.sources.plans = source('PRIVATE_PLAN_SOURCE', plans);
  outcome(facts(input), config, 'insufficient_data', 'denominator_unknown_or_zero');
});
test('P25 any missing required comparison dominates an otherwise complex signal', () => {
  const evidence = facts(snapshot(90)); evidence.facts = evidence.facts.filter(value => value.id !== 'workout.completed7.completed');
  const config = policy({ rules: [rule(), rule({ id: 'workout-change', currentFactId: 'workout.completed7.completed', baselineFactId: 'workout.previousCompleted7.completed', unit: 'recorded_sessions' })] });
  const result = outcome(evidence, config, 'insufficient_data', 'evidence_missing');
  assert.ok(result.reasonCodes.includes('complex_threshold_reached'));
  const bad = structuredClone(evidence); fact(bad, 'workout.previousCompleted7.completed').unit = 'kg';
  outcome(bad, config, 'blocked', 'unit_mismatch');
});
test('P26 duplicate facts/domains and contradictory state/value or quality metadata are blocked', () => {
  const duplicate = facts(); duplicate.facts.push(structuredClone(fact(duplicate))); outcome(duplicate, policy(), 'blocked', 'evidence_invalid');
  const domain = facts(); domain.domains.push(structuredClone(domain.domains[0])); outcome(domain, policy(), 'blocked', 'evidence_invalid');
  const unknown = facts(); fact(unknown).state = 'unknown'; outcome(unknown, policy(), 'blocked', 'evidence_invalid');
  const missingDomain = facts(); missingDomain.domains.pop(); outcome(missingDomain, policy(), 'blocked', 'evidence_invalid');
  for (const value of [null, [], {}, { ...facts(), schemaVersion: 2 }, { ...facts(), sensitive: false }, { ...facts(), semantics: 'all_activity' }]) outcome(value, policy(), 'blocked', 'evidence_invalid');
});
test('P27 output is deterministic, independent of rule/fact order, immutable and minimal', () => {
  const evidence = facts(), config = policy({ rules: [rule(), rule({ id: 'money-change', currentFactId: 'spending.KRW.completed7.expenses', baselineFactId: 'spending.KRW.previousCompleted7.expenses', unit: 'KRW_minor' })] });
  const before = JSON.stringify({ evidence, config }), a = planAnalysisDecision(evidence, config, NOW);
  assert.equal(JSON.stringify({ evidence, config }), before);
  const reverse = structuredClone(evidence); reverse.facts.reverse(); reverse.domains.reverse();
  assert.deepEqual(a, planAnalysisDecision(reverse, { ...config, rules: [...config.rules].reverse() }, NOW));
  assert.doesNotMatch(JSON.stringify(a), /PRIVATE_|SYNTHETIC_OWNER|sourceId|recordId|ownerId|candidate|advice|payload|model/);
  a.evidenceIds.push('changed-result'); assert.equal(planAnalysisDecision(evidence, config, NOW).evidenceIds.includes('changed-result'), false);
});
test('P28 pure planning makes zero network/provider calls and does not consult the ambient clock', () => {
  const oldFetch = globalThis.fetch, oldNow = Date.now; let calls = 0;
  globalThis.fetch = (() => { calls++; throw new Error('Network forbidden'); }) as typeof fetch;
  Date.now = () => { calls++; throw new Error('Ambient clock forbidden'); };
  try {
    for (const evidence of [facts(), facts(snapshot(70)), facts(snapshot(90)), null]) planAnalysisDecision(evidence, policy(), NOW);
    planAnalysisDecision(facts(), null, NOW);
  } finally { globalThis.fetch = oldFetch; Date.now = oldNow; }
  assert.equal(calls, 0);
});
test('P29 positive samples cannot contradict an empty source or the metric denominator', () => {
  const empty = facts(); empty.domains.find(value => value.domain === 'weight')!.status = 'empty';
  outcome(empty, policy(), 'blocked', 'evidence_invalid');
  const denominator = facts(); fact(denominator).denominator = 2;
  outcome(denominator, policy(), 'blocked', 'numeric_range_invalid');
  const count = facts(); fact(count, 'workout.completed7.completed').value = 2;
  outcome(count, policy({ rules: [rule({ currentFactId: 'workout.completed7.completed', baselineFactId: 'workout.previousCompleted7.completed', unit: 'recorded_sessions' })] }), 'blocked', 'numeric_range_invalid');
});
test('P30 reported completion rates cannot claim missing plan evidence or impossible percentages', () => {
  const evidence = facts(), ids = ['workout.completed7.recordedPlannedDayCompletionRate', 'workout.previousCompleted7.recordedPlannedDayCompletionRate'];
  const config = policy({ rules: [rule({ currentFactId: ids[0], baselineFactId: ids[1], unit: 'percent_of_planned_days_with_recorded_completion' })] });
  for (const id of ids) Object.assign(fact(evidence, id), { state: 'known', value: 100, denominator: 1, sampleCount: 8, quality: { status: 'valid', reasons: [] } });
  outcome(evidence, config, 'insufficient_data', 'evidence_unknown');
  fact(evidence, ids[0]).value = 101;
  outcome(evidence, config, 'blocked', 'numeric_range_invalid');
});
test('P31 pain counts cannot exceed their total-answer denominator or use fractional counts', () => {
  const config = policy({ rules: [rule({ currentFactId: 'workout.completed7.pain.no', baselineFactId: 'workout.previousCompleted7.pain.no', unit: 'recorded_answers' })] });
  outcome(facts(), config, 'no_meaningful_change');
  for (const denominator of [0, 0.5]) {
    const evidence = facts(); fact(evidence, 'workout.completed7.pain.no').denominator = denominator;
    outcome(evidence, config, 'blocked', 'numeric_range_invalid');
  }
  const count = facts(); fact(count, 'workout.completed7.pain.no').value = 0.5;
  outcome(count, config, 'blocked', 'numeric_range_invalid');
});
test('P32 unrelated limited source warnings permit only configured-scope decisions, unlike blocked/stale sources', () => {
  const input = snapshot(); input.sources.spending = source('PRIVATE_MONEY_SOURCE', [...input.sources.spending.records, { ...input.sources.spending.records[0] as SpendingInput, id: 'PRIVATE_FUTURE_MONEY', date: '2026-10-11' }]);
  const evidence = facts(input); assert.equal(evidence.quality.status, 'limited');
  assert.equal(evidence.domains.find(value => value.domain === 'weight')?.quality?.status, 'valid');
  outcome(evidence, policy(), 'routine');
});
test('P33 genuine complete plan denominators from C remain supported', () => {
  const input = snapshot(), windows = buildWindows(NOW, input.timeZone);
  const plans: PlanInput[] = Array.from({ length: 14 }, (_, i) => ({ id: `PRIVATE_PLAN_${i}`, ownerId: OWNER, revision: 1, date: addDays(windows.previousCompleted7.startDate, i), state: 'planned' }));
  input.sources.plans = source('PRIVATE_PLAN_SOURCE', plans);
  const config = policy({ rules: [rule({ currentFactId: 'workout.completed7.recordedPlannedDayCompletionRate', baselineFactId: 'workout.previousCompleted7.recordedPlannedDayCompletionRate', unit: 'percent_of_planned_days_with_recorded_completion' })] });
  const evidence = facts(input);
  outcome(evidence, config, 'no_meaningful_change');
  for (const changes of [{ value: 120 }, { value: 0 }, { denominator: 8 }, { denominator: 0.5 }, { sampleCount: 6 }, { sampleCount: 7 }]) {
    const invalid = structuredClone(evidence); Object.assign(fact(invalid, 'workout.completed7.recordedPlannedDayCompletionRate'), changes);
    outcome(invalid, config, 'blocked', 'numeric_range_invalid');
  }
});
test('P34 plan-row samples do not contradict genuinely empty workout sources in recorded completion rates', () => {
  const input = snapshot(), windows = buildWindows(NOW, input.timeZone);
  input.sources.workout = source('PRIVATE_WORKOUT_SOURCE', []);
  input.sources.plans = source('PRIVATE_PLAN_SOURCE', Array.from({ length: 14 }, (_, i) => ({ id: `PRIVATE_PLAN_${i}`, ownerId: OWNER, revision: 1, date: addDays(windows.previousCompleted7.startDate, i), state: 'planned' })));
  const evidence = facts(input), currentId = 'workout.completed7.recordedPlannedDayCompletionRate';
  assert.equal(fact(evidence, currentId).value, 0); assert.equal(fact(evidence, currentId).sampleCount, 7);
  outcome(evidence, policy({ rules: [rule({ currentFactId: currentId, baselineFactId: 'workout.previousCompleted7.recordedPlannedDayCompletionRate', unit: 'percent_of_planned_days_with_recorded_completion' })] }), 'no_meaningful_change');
});
