import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { analyzeSnapshot, AnalysisInputError, projectAnalysisFacts } from './index.ts';
import type { RecordInput, SnapshotInput, SourceInput, SpendingInput, WeightInput, WorkoutInput, PlanInput } from './contracts.ts';
import { addDays, buildWindows, calendarDay, instantInPeriod, localDateAt, parseInstant } from './dates.ts';
import { compareRecordedTotals } from './aggregate-budget.ts';
import { formatMinor, parseMoney, sumMinor } from './money.ts';

// All fixtures are synthetic. No database, environment variables, real accounts or provider access.
const OWNER = 'SYNTHETIC_OWNER_PRIVATE';
const AS_OF = '2026-10-10T03:00:00.000Z';
function source(sourceId: string, records: readonly unknown[] = [], overrides: Partial<SourceInput> = {}): SourceInput {
  return { sourceId, sourceVersion: 'synthetic-v1', status: records.length ? 'ok' : 'empty', coverage: { startDate: '2025-01-01', endDateExclusive: '2027-01-01', complete: true, totalRows: records.length }, records, ...overrides };
}
function snapshot(weight: readonly unknown[] = [], workout: readonly unknown[] = [], spending: readonly unknown[] = []): SnapshotInput {
  return { schemaVersion: 1, ownerId: OWNER, asOf: AS_OF, timeZone: 'Asia/Seoul', sources: { weight: source('SYNTHETIC_WEIGHT_SOURCE', weight), workout: source('SYNTHETIC_WORKOUT_SOURCE', workout), spending: source('SYNTHETIC_MONEY_SOURCE', spending) } };
}
function row(id: string, date: string, extra: Partial<RecordInput> = {}): RecordInput { return { id, ownerId: OWNER, revision: 1, date, ...extra }; }
function weight(id: string, date: string, value: number, extra: Partial<WeightInput> = {}): WeightInput { return { ...row(id, date), value, unit: 'kg', ...extra }; }
function workout(id: string, date: string, status: WorkoutInput['status'] = 'completed', extra: Partial<WorkoutInput> = {}): WorkoutInput { return { ...row(id, date), status, ...extra }; }
function money(id: string, date: string, amount: string, extra: Partial<SpendingInput> = {}): SpendingInput { return { ...row(id, date), kind: 'expense', currency: 'KRW', amount, ...extra }; }
function plan(id: string, date: string, state: PlanInput['state']): PlanInput { return { ...row(id, date), state }; }
function budget(input: SnapshotInput, currency = 'KRW') { const result = analyzeSnapshot(input).spending.byCurrency.find(item => item.currency === currency); assert.ok(result); return result; }
function near(actual: number | null, expected: number) { assert.ok(actual !== null); assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} vs ${expected}`); }
function fails(input: unknown, code?: string) { assert.throws(() => analyzeSnapshot(input), error => error instanceof AnalysisInputError && (!code || error.code === code)); }

test('C01 identical snapshot/asOf/version gives identical JSON and fingerprint without mutation', () => {
  const input = snapshot([weight('w1', '2026-10-10', 70)], [], [money('t1', '2026-10-09', '1200')]);
  const before = JSON.stringify(input), a = analyzeSnapshot(input), b = analyzeSnapshot(JSON.parse(before));
  assert.deepEqual(a, b); assert.match(a.fingerprint, /^fnv1a32:/); assert.equal(JSON.stringify(input), before);
});
test('C02 input order and object property order do not change results', () => {
  const input = snapshot([weight('b', '2026-10-09', 80), weight('a', '2026-10-10', 70)], [workout('b', '2026-10-08'), workout('a', '2026-10-09')], [money('b', '2026-10-09', '200'), money('a', '2026-10-09', '100')]);
  const reverse = structuredClone(input);
  for (const s of Object.values(reverse.sources)) s.records = [...s.records].reverse().map(record => Object.fromEntries(Object.entries(record as object).reverse()));
  assert.deepEqual(analyzeSnapshot(input), analyzeSnapshot(reverse));
});
test('C03 cross-owner records are rejected even for same IDs, future dates and lower revisions', () => {
  for (const other of [weight('x', '2026-10-10', 70, { ownerId: 'OTHER' }), weight('x', '2026-12-01', 70, { ownerId: 'OTHER', revision: 0 })]) fails(snapshot([weight('x', '2026-10-10', 70), other]), 'mixed_owner');
});
test('C04 unavailable and an accurately empty source remain distinct', () => {
  const empty = analyzeSnapshot(snapshot());
  const unavailable = snapshot(); unavailable.sources.workout = source('workout', [], { status: 'unavailable' });
  const result = analyzeSnapshot(unavailable);
  assert.equal(empty.workout.periods.completed7.completed.value, 0);
  assert.equal(result.workout.periods.completed7.completed.value, null);
  assert.ok(result.workout.periods.completed7.completed.quality.reasons.includes('source_unavailable'));
  assert.equal(empty.weight.averages.today.value, null);
});
test('C05 incomplete pagination never publishes a financial total', () => {
  const input = snapshot([], [], [money('x', '2026-10-09', '900')]);
  input.sources.spending.coverage.totalRows = 2;
  const result = budget(input);
  assert.equal(result.periods.completed7.expenses.value, null);
  assert.ok(result.periods.completed7.expenses.quality.reasons.includes('source_incomplete'));
});
test('C06 malformed JSON/schema/number is not converted to zero', () => {
  for (const invalid of ['{', null, [], {}, { ...snapshot(), schemaVersion: 2 }, snapshot([weight('w', '2026-10-10', '70' as unknown as number)])]) fails(invalid);
});
test('C07 future date and future instant are excluded and marked', () => {
  const input = snapshot([weight('ok', '2026-10-10', 70), weight('future', '2026-10-11', 90), { ...weight('time', '2026-10-10', 90), date: undefined, timestamp: '2026-10-10T04:00:00Z' }]);
  const result = analyzeSnapshot(input);
  assert.equal(result.weight.averages.today.value, 70);
  assert.equal(result.provenance[0].source?.excludedFutureCount, 2);
  assert.ok(result.quality.reasons.includes('future_excluded'));
});
test('C08 leap dates/month ends are validated without rollover', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29'); assert.equal(addDays('2024-02-29', 1), '2024-03-01');
  for (const date of ['2026-02-29', '2026-04-31', '0000-01-01', '2026-1-01', '2026-13-01']) assert.throws(() => calendarDay(date), AnalysisInputError);
  assert.equal(addDays('0099-12-31', 1), '0100-01-01');
});
test('C09 KST local midnight does not use the UTC date', () => {
  const input = snapshot([weight('w', '2026-10-10', 70)]); input.asOf = '2026-10-09T15:00:00Z';
  const result = analyzeSnapshot(input); assert.equal(result.windows.today.startDate, '2026-10-10'); assert.equal(result.weight.averages.today.value, 70);
});
test('C10 DST boundaries use local calendar days and date-only input remains date-only', () => {
  const spring = buildWindows('2026-03-09T04:00:00Z', 'America/New_York').yesterday;
  assert.equal(spring.startDate, '2026-03-08');
  assert.equal(instantInPeriod('2026-03-08T04:59:59Z', spring), false);
  assert.equal(instantInPeriod('2026-03-08T05:00:00Z', spring), true);
  assert.equal(instantInPeriod('2026-03-09T03:59:59Z', spring), true);
  assert.equal(instantInPeriod('2026-03-09T04:00:00Z', spring), false);
  const fall = buildWindows('2026-11-02T05:00:00Z', 'America/New_York').yesterday;
  assert.equal(instantInPeriod('2026-11-01T05:30:00Z', fall), true);
  assert.equal(instantInPeriod('2026-11-01T06:30:00Z', fall), true);
  const input = snapshot([weight('day', '2026-03-08', 70)]); input.timeZone = 'America/New_York'; input.asOf = '2026-03-09T04:00:00Z';
  assert.equal(analyzeSnapshot(input).weight.averages.yesterday.value, 70);
});
test('C11 today is partial and yesterday is a completed period', () => {
  const windows = analyzeSnapshot(snapshot()).windows; assert.equal(windows.today.partial, true); assert.equal(windows.yesterday.partial, false);
});
test('C12 7-day/previous7/30-day/month windows have distinct exact boundaries', () => {
  const { windows } = analyzeSnapshot(snapshot());
  assert.deepEqual([windows.recent7.startDate, windows.recent7.endDateExclusive], ['2026-10-04', '2026-10-11']);
  assert.deepEqual([windows.previous7.startDate, windows.previous7.endDateExclusive], ['2026-09-27', '2026-10-04']);
  assert.equal(windows.recent30.startDate, '2026-09-11'); assert.equal(windows.month.startDate, '2026-10-01');
  assert.equal(windows.completed7.startDate, '2026-10-03'); assert.equal(windows.previousCompleted7.startDate, '2026-09-26');
  const result = analyzeSnapshot(snapshot([weight('excluded', '2026-10-03', 100), weight('included', '2026-10-04', 70)]));
  assert.equal(result.weight.averages.recent7.value, 70);
});
test('C13 missing today or yesterday leaves daily weight delta unknown', () => {
  for (const date of ['2026-10-09', '2026-10-10']) assert.equal(analyzeSnapshot(snapshot([weight('w', date, 70)])).weight.dailyDelta.value, null);
});
test('C14 weight means use actual measurement counts rather than calendar length', () => {
  const result = analyzeSnapshot(snapshot([weight('a', '2026-10-10', 70), weight('b', '2026-10-09', 74), weight('c', '2026-09-15', 72)]));
  assert.equal(result.weight.averages.recent7.value, 72); assert.equal(result.weight.averages.recent7.denominator, 2);
  assert.equal(result.weight.averages.recent30.value, 72); assert.equal(result.weight.averages.recent30.denominator, 3);
  assert.equal(result.weight.dailyDelta.value, -4);
});
test('C15 old latest measurement is not relabelled as the current 7-day mean', () => {
  const result = analyzeSnapshot(snapshot([weight('w', '2026-09-20', 70)]));
  assert.equal(result.weight.averages.recent7.value, null); assert.equal(result.weight.averages.recent30.value, 70);
});
test('C16 zero/negative/nonfinite weights and unknown units fail', () => {
  for (const value of [0, -1, NaN, Infinity, -Infinity]) fails(snapshot([weight('w', '2026-10-10', value)]), 'weight');
  fails(snapshot([weight('w', '2026-10-10', 70, { unit: 'lb' as 'kg' })]), 'weight');
});
test('C17 weight speed uses actual elapsed calendar days and rejects same-day denominator', () => {
  const result = analyzeSnapshot(snapshot([weight('a', '2026-10-01', 90), weight('b', '2026-10-07', 84)]));
  assert.equal(result.weight.changePerCalendarDay.value, -1); assert.equal(result.weight.changePerCalendarDay.denominator, 6);
  const sameDay = analyzeSnapshot(snapshot([weight('a', '2026-10-10', 80), weight('b', '2026-10-10', 70)]));
  assert.equal(sameDay.weight.averages.today.value, 75); assert.equal(sameDay.weight.changePerCalendarDay.value, null);
});
test('C18 completed/partial/stopped/legacy boolean remain separate', () => {
  const rows = ['completed', 'partial', 'stopped', true, false].map((status, i) => workout(`w${i}`, '2026-10-09', status as WorkoutInput['status']));
  const result = analyzeSnapshot(snapshot([], rows)).workout.periods.completed7;
  assert.equal(result.completed.value, 2); assert.equal(result.partial.value, 1); assert.equal(result.stopped.value, 1); assert.equal(result.unclassified.value, 1);
});
test('C19 missing workout days are not failed workouts', () => {
  const result = analyzeSnapshot(snapshot([], [workout('w', '2026-10-09')]));
  assert.equal(result.workout.periods.completed7.stopped.value, 0); assert.equal(result.workout.missingDayBehavior, 'unknown');
  assert.equal(JSON.stringify(result).includes('failed_workouts'), false);
});
test('C20 absent or partially known plans cannot supply a completion denominator', () => {
  const input = snapshot([], [workout('w', '2026-10-09')]);
  assert.equal(analyzeSnapshot(input).workout.periods.completed7.recordedPlannedDayCompletionRate.denominator, null);
  input.sources.plans = source('plans', [plan('p', '2026-10-09', 'planned')]);
  assert.equal(analyzeSnapshot(input).workout.periods.completed7.recordedPlannedDayCompletionRate.value, null);
});
test('C21 known rest/unavailable days do not inflate the planned-day denominator', () => {
  const input = snapshot([], [workout('w', '2026-10-03'), workout('extra', '2026-10-03')]);
  input.sources.plans = source('plans', Array.from({ length: 7 }, (_, i) => plan(`p${i}`, addDays('2026-10-03', i), i < 2 ? 'planned' : i === 2 ? 'unavailable' : 'rest')));
  const rate = analyzeSnapshot(input).workout.periods.completed7.recordedPlannedDayCompletionRate;
  assert.equal(rate.value, 50); assert.equal(rate.denominator, 2);
});
test('C22 a recording gap cannot extend an observed streak or prove inactivity', () => {
  const result = analyzeSnapshot(snapshot([], ['2026-10-01', '2026-10-03', '2026-10-04'].map((date, i) => workout(`w${i}`, date))));
  assert.equal(result.workout.observedConsecutiveDaysEndingAtLastRecord.value, 2); assert.equal(result.workout.daysSinceLastRecordedCompletion.value, 6);
  assert.equal(result.workout.missingDayBehavior, 'unknown');
});
test('C23 exact workout IDs/revisions deduplicate; kind/amount/date similarities do not', () => {
  const old = workout('x', '2026-10-09', 'partial', { kind: 'walk' }), revised = { ...old, revision: 2, status: 'completed' as const };
  const result = analyzeSnapshot(snapshot([], [old, revised, revised, workout('distinct', '2026-10-09', 'completed', { kind: 'walk' })]));
  assert.equal(result.workout.periods.completed7.byKind[0].completed.value, 2); assert.equal(result.workout.periods.completed7.partial.value, 0);
  fails(snapshot([], [old, { ...old, status: 'completed' }]), 'disputed_record_revision');
});
test('C24 unanswered pain is distinct from explicit no pain', () => {
  const result = analyzeSnapshot(snapshot([], [workout('u', '2026-10-09'), workout('n', '2026-10-09', 'completed', { pain: 'no' }), workout('y', '2026-10-09', 'partial', { pain: 'yes' })])).workout.periods.completed7.pain;
  assert.equal(result.unanswered.value, 1); assert.equal(result.no.value, 1); assert.equal(result.yes.value, 1);
});
test('C25 currency decimal conversion and safe-integer sums are exact or fail closed', () => {
  const result = budget(snapshot([], [], [money('a', '2026-10-09', '0.10', { currency: 'USD' }), money('b', '2026-10-09', '0.20', { currency: 'USD' })]), 'USD');
  assert.equal(result.periods.completed7.expenses.value, 30); assert.equal(formatMinor(30, 'USD'), '0.30');
  assert.equal(parseMoney('1.234', 'KWD').minor, 1234); assert.equal(parseMoney('9007199254740991', 'KRW').minor, Number.MAX_SAFE_INTEGER);
  assert.throws(() => sumMinor([Number.MAX_SAFE_INTEGER, 1]), /money_overflow/);
  for (const [amount, currency] of [['0.1', 'KRW'], ['0.001', 'USD'], ['9007199254740992', 'KRW'], ['-1', 'USD'], ['1e3', 'USD'], ['1', 'UNKNOWN']]) assert.throws(() => parseMoney(amount, currency), AnalysisInputError);
});
test('C26 expense/income/savings/refund/scheduled are separate and never inferred', () => {
  const kinds = ['expense', 'income', 'savings', 'refund', 'scheduled'] as const;
  const result = budget(snapshot([], [], kinds.map((kind, i) => money(String(i), '2026-10-09', String((i + 1) * 100), { kind })))).periods.completed7;
  assert.equal(result.expenses.value, 100); assert.equal(result.income.value, 200); assert.equal(result.savings.value, 300); assert.equal(result.refunds.value, 400); assert.equal(result.scheduled.value, 500);
});
test('C27 a zero comparison baseline produces unknown, not Infinity', () => {
  const change = budget(snapshot([], [], [money('a', '2026-10-09', '100')])).completed7Change;
  assert.equal(change.value, null); assert.ok(change.quality.reasons.includes('zero_baseline')); assert.equal(change.denominator, 0);
});
test('C28 absent categories retain their explicit unknown bucket', () => {
  const result = budget(snapshot([], [], [money('a', '2026-10-09', '100'), money('b', '2026-10-09', '200', { category: 'food' })])).periods.completed7;
  assert.equal(result.categories.find(row => row.category === null)?.total.value, 100); assert.equal(result.categories.find(row => row.category === 'food')?.total.value, 200);
});
test('C29 configured zero budget differs from absent budget without dividing by zero', () => {
  const noBudget = budget(snapshot([], [], [money('a', '2026-10-09', '100')]));
  const zero = budget(snapshot([], [], [money('a', '2026-10-09', '100'), money('limit', '2026-10-01', '0', { kind: 'monthly_budget' })]));
  assert.equal(noBudget.configuredMonthlyBudget.value, null); assert.equal(zero.configuredMonthlyBudget.value, 0);
  assert.equal(zero.monthlyBudgetUsage.value, null); assert.equal(zero.monthlyBudgetUsage.denominator, 0);
});
test('C30 revised transaction wins by revision; distinct same-amount transactions survive', () => {
  const original = money('x', '2026-10-09', '100'), edit = { ...original, revision: 2, amount: '200' };
  const input = snapshot([], [], [original, edit, edit, money('y', '2026-10-09', '200')]);
  assert.equal(budget(input).periods.completed7.expenses.value, 400);
  fails(snapshot([], [], [original, { ...original, amount: '101' }]), 'disputed_record_revision');
});
test('C31 partial day comparison is unknown and cannot assert improvement/deterioration', () => {
  const result = budget(snapshot([], [], [money('y', '2026-10-09', '100'), money('t', '2026-10-10', '10')]));
  const comparison = compareRecordedTotals(result.periods.today.expenses, result.periods.yesterday.expenses);
  assert.equal(comparison.value, null); assert.ok(comparison.quality.reasons.includes('period_mismatch'));
  assert.equal('improvement' in result, false);
});
test('C32 changed source revision makes snapshot stale and blocks affected metrics', () => {
  const input = snapshot([weight('w', '2026-10-10', 70)]); input.sources.weight.currentVersion = 'new-revision';
  const result = analyzeSnapshot(input); assert.equal(result.quality.status, 'stale'); assert.equal(result.weight.averages.today.value, null);
});
test('C33 provider-facts projection contains no raw text, merchant, category, owner or source IDs', () => {
  const input = snapshot([{ ...weight('PRIVATE_RECORD_ID', '2026-10-10', 70), memo: 'PRIVATE_MEMO' }], [workout('PRIVATE_WORKOUT_ID', '2026-10-09', 'completed', { kind: 'PRIVATE_KIND' })], [{ ...money('PRIVATE_MONEY_ID', '2026-10-09', '100', { category: 'PRIVATE_CATEGORY' }), merchant: 'PRIVATE_MERCHANT' }]);
  const projection = projectAnalysisFacts(analyzeSnapshot(input)), text = JSON.stringify(projection);
  for (const hidden of [OWNER, 'PRIVATE_', 'SYNTHETIC_WEIGHT_SOURCE', 'SYNTHETIC_WORKOUT_SOURCE', 'SYNTHETIC_MONEY_SOURCE', 'sourceVersion', 'recordId']) assert.equal(text.includes(hidden), false, hidden);
  assert.equal(projection.sensitive, true); assert.ok(projection.facts.some(fact => fact.id === 'weight.today.mean' && fact.value === 70));
});
test('C34 language activity is never promoted to language mastery', () => {
  const result = analyzeSnapshot({ ...snapshot(), language: { sessions: 100, mastery: 'invented' } });
  assert.equal('language' in result, false); assert.equal(JSON.stringify(projectAnalysisFacts(result)).includes('mastery'), false);
});
test('C35 missing growth/symptom answers are not inferred as failure or diagnosis', () => {
  const result = analyzeSnapshot({ ...snapshot([], [workout('w', '2026-10-09')]), growth: null, symptoms: null });
  assert.equal('growth' in result, false); assert.equal('diagnosis' in result, false); assert.equal(result.workout.periods.completed7.pain.no.value, 0); assert.equal(result.workout.periods.completed7.pain.unanswered.value, 1);
});
test('C36 pure implementation uses no network/provider/DB/TTS/STT/Push or ambient clock', () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = (() => { calls++; throw new Error('Network forbidden'); }) as typeof fetch;
  try { analyzeSnapshot(snapshot()); projectAnalysisFacts(analyzeSnapshot(snapshot([weight('w', '2026-10-10', 70)]))); fails('{'); } finally { globalThis.fetch = original; }
  assert.equal(calls, 0);
  for (const file of readdirSync(new URL('.', import.meta.url)).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /\b(?:fetch\s*\(|Date\.now\s*\(|process\.env|XMLHttpRequest|WebSocket|setTimeout\s*\()/, file);
    for (const imported of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.ok(imported[1].startsWith('./'), `${file}: ${imported[1]}`);
  }
});

test('boundary: equivalent offset instants normalize identically', () => {
  const a = snapshot(), b = snapshot(); b.asOf = '2026-10-10T12:00:00+09:00'; assert.deepEqual(analyzeSnapshot(a), analyzeSnapshot(b));
});
test('boundary: malformed timestamps and time zones fail rather than adopting server locale', () => {
  for (const value of ['2026-10-10', '2026-10-10T03:00:00', '2026-02-30T03:00:00Z', '2026-10-10T24:00:00Z', '2026-10-10T03:00:60Z', '2026-10-10T03:00:00+14:01']) assert.throws(() => parseInstant(value), AnalysisInputError);
  const input = snapshot(); input.timeZone = 'not-a-zone'; fails(input, 'time_zone');
  assert.equal(localDateAt('2026-10-10T01:00:00Z', 'America/Los_Angeles'), '2026-10-09');
});
test('boundary: count/coverage mismatch blocks metrics even if source says ok', () => {
  const input = snapshot([], [], [money('a', '2026-10-09', '100')]); input.sources.spending.coverage.complete = false;
  assert.equal(budget(input).periods.today.expenses.value, null);
  input.sources.spending.coverage.complete = true; input.sources.spending.coverage.startDate = '2026-10-09';
  assert.equal(budget(input).periods.completed7.expenses.value, null); assert.equal(budget(input).periods.today.expenses.value, 0);
});
test('boundary: unavailable source with rows, empty with rows, and ok without rows are disputed', () => {
  for (const status of ['unavailable', 'empty'] as const) { const input = snapshot([weight('w', '2026-10-10', 70)]); input.sources.weight.status = status; fails(input, 'source_status_conflict'); }
  const input = snapshot(); input.sources.weight.status = 'ok'; fails(input, 'source_status_conflict');
});
test('boundary: records must have exactly one date representation and lie in coverage', () => {
  fails(snapshot([{ ...weight('w', '2026-10-10', 70), timestamp: AS_OF }]), 'record_date');
  fails(snapshot([{ ...weight('w', '2026-10-10', 70), date: undefined }]), 'record_date');
  const input = snapshot([weight('w', '2026-10-10', 70)]); input.sources.weight.coverage.startDate = '2026-10-11'; fails(input, 'record_outside_coverage');
});
test('boundary: fully known no-planned-days yields null rate with zero denominator', () => {
  const input = snapshot(); input.sources.plans = source('plans', Array.from({ length: 7 }, (_, i) => plan(`p${i}`, addDays('2026-10-03', i), 'rest')));
  const rate = analyzeSnapshot(input).workout.periods.completed7.recordedPlannedDayCompletionRate;
  assert.equal(rate.value, null); assert.equal(rate.denominator, 0); assert.ok(rate.quality.reasons.includes('no_planned_days'));
});
test('boundary: disputed daily plans fail instead of arbitrary selection', () => {
  const input = snapshot(); input.sources.plans = source('plans', [plan('p1', '2026-10-09', 'planned'), plan('p2', '2026-10-09', 'rest')]); fails(input, 'disputed_plan_date');
});
test('boundary: mixed currencies are never summed or converted', () => {
  const input = snapshot([], [], [money('a', '2026-10-09', '100'), money('b', '2026-10-09', '1.00', { currency: 'USD' })]);
  const result = analyzeSnapshot(input).spending; assert.equal(result.byCurrency.length, 2); assert.equal('total' in result, false); assert.equal(budget(input, 'USD').periods.completed7.expenses.value, 100);
});
test('boundary: completed equal-length periods and category changes compare exactly', () => {
  const input = snapshot([], [], [money('old', '2026-10-01', '100', { category: 'food' }), money('new', '2026-10-09', '150', { category: 'food' })]);
  const result = budget(input); assert.equal(result.completed7Change.value, 50); assert.equal(result.categoryCompleted7Changes[0].change.value, 50);
});
test('boundary: monthly limit is explicit, current-month scoped, and cannot have conflicting IDs', () => {
  const input = snapshot([], [], [money('expense', '2026-10-09', '100'), money('budget', '2026-10-01', '400', { kind: 'monthly_budget' })]);
  near(budget(input).monthlyBudgetUsage.value, 25);
  fails(snapshot([], [], [money('a', '2026-10-01', '400', { kind: 'monthly_budget' }), money('b', '2026-10-01', '500', { kind: 'monthly_budget' })]), 'disputed_monthly_budget');
  fails(snapshot([], [], [money('a', '2026-10-02', '400', { kind: 'monthly_budget' })]), 'budget_month');
});
test('boundary: exact cutoff instant is included but the next millisecond is not', () => {
  const input = snapshot([{ ...weight('at', '2026-10-10', 70), date: undefined, timestamp: AS_OF }, { ...weight('after', '2026-10-10', 90), date: undefined, timestamp: '2026-10-10T03:00:00.001Z' }]);
  assert.equal(analyzeSnapshot(input).weight.averages.today.value, 70);
});
test('boundary: diagnostics contain no raw invalid values', () => {
  const input = snapshot([weight('SENSITIVE_ID', '2026-10-10', 70, { ownerId: 'SENSITIVE_OTHER_OWNER' })]);
  assert.throws(() => analyzeSnapshot(input), error => error instanceof AnalysisInputError && !String(error).includes('SENSITIVE'));
});
test('boundary: all generated results JSON-roundtrip without NaN/Infinity/undefined', () => {
  const result = analyzeSnapshot(snapshot([weight('w', '2026-10-10', 70)], [workout('w', '2026-10-09')], [money('m', '2026-10-09', '0')]));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result); assert.doesNotMatch(JSON.stringify(result), /NaN|Infinity/);
});
test('boundary: enum values must be strings, never arrays or coercible objects', () => {
  fails(snapshot([], [{ ...workout('w', '2026-10-09'), status: ['completed'] }]), 'workout_status');
  fails(snapshot([], [{ ...workout('w', '2026-10-09'), pain: ['no'] }]), 'pain');
  fails(snapshot([], [], [{ ...money('m', '2026-10-09', '100'), kind: ['expense'] }]), 'money_kind');
  const input = snapshot(); input.sources.weight.status = ['empty'] as unknown as 'empty'; fails(input, 'source_schema');
  const plans = snapshot(); plans.sources.plans = source('plans', [{ ...plan('p', '2026-10-09', 'planned'), state: ['planned'] }]); fails(plans, 'plan');
});
test('boundary: edits after cutoff cannot remove old expenses and publish an understated subtotal', () => {
  const original = money('edited', '2026-10-09', '100', { updatedAt: '2026-10-09T02:00:00Z' });
  const input = snapshot([], [], [original, { ...original, revision: 2, amount: '200', updatedAt: '2026-10-11T00:00:00Z' }, money('other', '2026-10-09', '10')]);
  const result = budget(input).periods.yesterday.expenses;
  assert.equal(result.value, null); assert.ok(result.quality.reasons.includes('source_incomplete'));
});
test('boundary: provider facts retain global stale and unavailable-versus-empty domain quality', () => {
  const input = snapshot([weight('w', '2026-10-10', 70)]); input.sources.weight.currentVersion = 'changed';
  assert.equal(projectAnalysisFacts(analyzeSnapshot(input)).quality.status, 'stale');
  const empty = projectAnalysisFacts(analyzeSnapshot(snapshot()));
  const unavailable = snapshot(); unavailable.sources.spending = source('money', [], { status: 'unavailable' });
  const output = projectAnalysisFacts(analyzeSnapshot(unavailable));
  assert.notDeepEqual(output, empty); assert.equal(output.domains.find(item => item.domain === 'spending')?.status, 'unavailable');
});
test('boundary: no income/savings/refund/scheduled rows means unknown; explicit zero remains zero', () => {
  const missing = budget(snapshot([], [], [money('e', '2026-10-09', '100')])).periods.completed7;
  for (const key of ['income', 'savings', 'refunds', 'scheduled'] as const) assert.equal(missing[key].value, null);
  const explicit = budget(snapshot([], [], [money('i', '2026-10-09', '0', { kind: 'income' })])).periods.completed7;
  assert.equal(explicit.income.value, 0); assert.equal(explicit.income.sampleCount, 1);
});
test('boundary: bulk decimal totals stay exact, while aggregation overflow stops the result', () => {
  const input = snapshot([], [], Array.from({ length: 2000 }, (_, i) => money(`m${i}`, '2026-10-09', '0.01', { currency: 'USD' })));
  assert.equal(budget(input, 'USD').periods.completed7.expenses.value, 2000);
  fails(snapshot([], [], [money('a', '2026-10-09', '9007199254740991'), money('b', '2026-10-09', '1')]), 'money_overflow');
});
test('boundary: disputed older revisions still fail; invalid revision/count metadata is not accepted', () => {
  const original = weight('w', '2026-10-10', 70);
  fails(snapshot([original, { ...original, value: 71 }, { ...original, revision: 2, value: 72 }]), 'disputed_record_revision');
  for (const revision of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) fails(snapshot([{ ...original, revision }]), 'integer');
  const incomplete = snapshot([], [], [money('m', '2026-10-09', '100')]); incomplete.sources.spending.coverage.totalRows = null;
  assert.equal(budget(incomplete).periods.completed7.expenses.value, null);
});
test('boundary: comparisons from different snapshot cutoffs or currencies remain unknown', () => {
  const input = snapshot([], [], [money('a', '2026-10-01', '100'), money('b', '2026-10-09', '200')]);
  const result = budget(input), current = result.periods.completed7.expenses, previous = result.periods.previousCompleted7.expenses;
  const otherCutoff = { ...previous, period: { ...previous.period, asOf: '2026-10-10T02:00:00.000Z' } };
  assert.equal(compareRecordedTotals(current, otherCutoff).value, null);
  assert.equal(compareRecordedTotals(current, { ...previous, unit: 'USD_minor' }).value, null);
});
