import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBodyCompositionReview } from './bodyCompositionCoach.ts';
import type { InbodyRecord, InbodyRecordStore, BodyMetricSource } from './recordStorage.ts';
import type { WorkoutCompletionStore } from './workoutCompletion.ts';
import { OA_REPORT_INVENTORY } from '../lib/oaReportInventory.ts';
import { buildLocalWorkoutPlanResult } from './localWorkoutPlanProposal.ts';
import { buildFreeFitnessReport } from './freeFitnessReport.ts';

const today = '2026-10-20';
const sources = Object.fromEntries(OA_REPORT_INVENTORY.map(([key, originalLabel, originalUnit]) =>
  [key, { device: 'OA Smart Scale PRO', originalLabel, originalUnit, method: 'ocr', mappingVersion: 'oa-pro-v1' }])) as Record<string, BodyMetricSource>;
const row = (values: object): InbodyRecord => ({ ...values, metricSources: structuredClone(sources) });
const review = (inbody: InbodyRecordStore, workouts: WorkoutCompletionStore = {}) =>
  buildBodyCompositionReview({ inbody, workouts }, today);
const metric = (inbody: InbodyRecordStore, key = 'muscleMass') => review(inbody).metrics.find(r => r.key === key)!;
const pair = (): InbodyRecordStore => ({
  '2026-10-10': row({ muscleMass: 50, musclePercent: 60, bodyFatPercent: 25 }),
  '2026-10-20': row({ muscleMass: 49, musclePercent: 61, bodyFatPercent: 24 }),
});

test('same source recent endpoints yield descriptive differences without mutating records', () => {
  const records = pair(), before = JSON.stringify(records), result = review(records);
  assert.equal(metric(records).delta, -1);
  assert.equal(metric(records, 'bodyFatPercent').delta, -1);
  assert.equal(result.divergent, true);
  assert.match(result.nextAction, /단정하지/);
  assert.equal(JSON.stringify(records), before);
});
test('missing and ambiguous BMI are not calculated from profile, weight or other metrics', () => {
  const records = pair(); records[today].weight = 80;
  assert.equal(metric(records, 'bmi').value, undefined);
  assert.equal(metric(records, 'bmi').status, 'missing');
  assert.equal(metric(records, 'skeletalMuscleMass').value, undefined);
});
test('explicit valid unitless BMI compares only its saved values', () => {
  const records = { '2026-10-10': row({ bmi: 25 }), [today]: row({ bmi: 24 }) };
  assert.equal(metric(records, 'bmi').delta, -1);
  assert.match(review(records).nextAction, /자료가 부족/);
});
test('zero, nonfinite, impossible rates and malformed numeric values are excluded', () => {
  for (const v of [0, -1, NaN, Infinity, '51', null, 999]) {
    const r = metric({ [today]: row({ muscleMass: v }) });
    assert.equal(r.value, undefined); assert.equal(r.status, 'invalid');
  }
  assert.equal(metric({ [today]: row({ bodyFatPercent: 101 }) }, 'bodyFatPercent').status, 'invalid');
  assert.equal(metric({ [today]: row({ bmi: 100 }) }, 'bmi').status, 'invalid');
});
test('legacy unverified metrics display values but do not provide a trend or invented source', () => {
  const records = { '2026-10-10': { muscleMass: 50 }, [today]: { muscleMass: 51, skeletalMuscleMass: 30 } };
  assert.equal(metric(records).status, 'unverified'); assert.equal(metric(records).delta, undefined);
  assert.equal(metric(records, 'skeletalMuscleMass').value, 30);
});
test('device, mapping, label, method and unit changes break comparison', () => {
  for (const override of [{ device: 'OA long report' }, { mappingVersion: 'unknown' }, { originalLabel: '다른 근육' },
    { method: 'unknown' }, { originalUnit: '%' }, { originalUnit: undefined }]) {
    const records = pair();
    records[today].metricSources!.muscleMass = { ...sources.muscleMass, ...override } as BodyMetricSource;
    assert.equal(metric(records).delta, undefined);
  }
});
test('incompatible observation between compatible dates is a boundary, not a gap', () => {
  const records = pair();
  records['2026-10-15'] = row({ muscleMass: 0 });
  assert.equal(metric(records).status, 'single');
  records['2026-10-15'] = { muscleMass: 50 };
  assert.equal(metric(records).delta, undefined);
});
test('invalid and future dates are excluded, including leap-day normalization', () => {
  const result = review({ [today]: row({ muscleMass: 50 }), '2026-02-29': row({ muscleMass: 51 }), '2026-10-21': row({ muscleMass: 52 }) });
  assert.equal(result.excludedDateCount, 2);
  assert.equal(result.latestDate, today);
  assert.equal(result.metrics.find(m => m.key === 'muscleMass')?.count, 1);
});
test('old measurements and a single recent measurement have distinct statuses', () => {
  assert.equal(metric({ '2026-09-19': row({ muscleMass: 50 }) }).status, 'stale');
  assert.equal(metric({ '2026-09-20': row({ muscleMass: 50 }) }).status, 'single');
  assert.equal(metric({ '2026-09-19': row({ muscleMass: 50 }), [today]: row({ muscleMass: 51 }) }).delta, undefined);
});
test('latest absent metric does not resurrect earlier data as current', () => {
  const records = { '2026-10-10': row({ muscleMass: 50 }), [today]: { bodyFatPercent: 25 } };
  assert.equal(metric(records).status, 'historical');
  assert.equal(metric(records).date, '2026-10-10');
});
test('OCR date conflict requires correction, explicitly edited dates are retained', () => {
  const records = pair();
  records[today].metricSources!.measurementDate = { ...sources.measurementDate, originalText: '2026-10-19' } as BodyMetricSource;
  assert.equal(metric(records).status, 'invalid');
  records[today].metricSources!.measurementDate!.method = 'ocr-edited';
  assert.equal(metric(records).status, 'comparable');
});
test('prior OCR date conflict is a comparison boundary too', () => {
  const records = pair();
  records['2026-10-10'].metricSources!.measurementDate = { ...sources.measurementDate, originalText: '2026-10-09' };
  assert.equal(metric(records).status, 'single');
  assert.equal(metric(records).delta, undefined);
});
test('comparison window is bounded and duplicate same-day records are not fabricated', () => {
  const records: InbodyRecordStore = Object.fromEntries(Array.from({ length: 16 }, (_, index) =>
    [`2026-10-${String(index + 5).padStart(2, '0')}`, row({ muscleMass: 50 + index / 10 })]));
  assert.equal(metric(records).count, 12);
  records[today] = row({ muscleMass: 55 });
  assert.equal(metric(records).count, 12);
  assert.equal(metric(records).fromDate, '2026-10-09');
  assert.equal(metric(records).value, 55);
});
test('unconfirmed device cannot qualify trunk interpretation', () => {
  const records = { [today]: row({ trunkMuscleMass: 25 }) };
  records[today].metricSources!.trunkMuscleMass!.device = 'OA long report';
  assert.equal(metric(records, 'trunkMuscleMass').status, 'unverified');
});
test('different endpoint periods cannot imply paired kg and percentage divergence', () => {
  const records = pair();
  delete records['2026-10-10'].musclePercent;
  delete records['2026-10-10'].metricSources!.musclePercent;
  records['2026-10-12'] = row({ musclePercent: 60 });
  assert.equal(review(records).divergent, false);
});
test('pain and neurological signals take priority even without a performed workout', () => {
  for (const signal of [{ workoutPain: true }, { workoutBackStatus: 'worse' as const },
    { workoutNeurologicalSymptoms: ['tingling' as const] }, { pullupPain: true }, { foamRollerPain: true },
    { workoutExerciseRecords: [{ exerciseName: '합성', status: 'skipped' as const, painScore: 2 }] }]) {
    assert.match(review(pair(), { [today]: signal }).nextAction, /중단/);
  }
});
test('fatigue overrides body trends; invalid, old and future training dates do not', () => {
  assert.match(review(pair(), { [today]: { workoutFatigue: 4 } }).nextAction, /회복 상태/);
  for (const date of ['2026-10-13', '2026-10-21', '2026-02-29']) {
    assert.doesNotMatch(review(pair(), { [date]: { workoutPain: true } }).nextAction, /동작은 중단/);
  }
});
test('body review does not change existing free report or plan targets', () => {
  const snapshot = { generatedFor: today, recentSessions: [] };
  const before = buildLocalWorkoutPlanResult(snapshot, {}, 'free_mode');
  const report = buildFreeFitnessReport(snapshot, 'weekly');
  review(pair());
  assert.deepEqual(buildLocalWorkoutPlanResult(snapshot, {}, 'free_mode'), before);
  assert.deepEqual(buildFreeFitnessReport(snapshot, 'weekly'), report);
  assert.deepEqual(before.planProposal.exerciseTargets, []);
});
