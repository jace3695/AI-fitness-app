import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBodyWorkoutReview } from './bodyWorkoutReview.ts';
import { buildAdaptiveWorkoutReview } from './workoutAdaptiveReview.ts';
import { buildCurrentWorkoutSettings, CURRENT_WEEKLY_METHODS } from './currentWorkoutDirection.ts';
import { EMPTY_USER_WORKOUT_SETTINGS } from './userWorkoutSettings.ts';
import type { RecordStores } from './recordStorage.ts';
import type { WorkoutDayRecord } from './workoutCompletion.ts';

const today = '2026-10-20';
const settings = () => buildCurrentWorkoutSettings(structuredClone(EMPTY_USER_WORKOUT_SETTINGS));
const source = { device: 'OA Smart Scale PRO' as const, originalLabel: '근육량', originalUnit: 'kg', method: 'ocr' as const, mappingVersion: 'oa-pro-v1' as const };
const stores = (): Pick<RecordStores, 'inbody' | 'workouts' | 'conditions'> => ({
  inbody: {
    '2026-10-10': { muscleMass: 50, metricSources: { muscleMass: source } },
    [today]: { muscleMass: 51, metricSources: { muscleMass: source } },
  }, workouts: {}, conditions: {},
});
const run = (data = stores(), configuration = settings()) =>
  buildBodyWorkoutReview(data, configuration, 'five-day-fullbody-circuit', today);
function session(): WorkoutDayRecord {
  return {
    workoutDone: true, workoutGroupId: 'current-fullbody-strength-circuit', workoutStatus: 'completed',
    workoutDifficulty: 'easy', workoutFatigue: 2, workoutBackStatus: 'none',
    workoutMethod: { ...CURRENT_WEEKLY_METHODS.mon },
    workoutExerciseRecords: ['덤벨 고블릿 스쿼트', '밴드 로우', '덤벨 플로어프레스', '루프밴드 사이드워크', '버드독'].map((exerciseName, i) => ({
      exerciseName, status: 'completed', sets: Array.from({ length: 3 }, (_, n) => ({
        setNumber: n + 1, completed: true, plannedReps: i === 1 ? 10 : i === 4 ? 6 : 8,
        reps: i === 1 ? 10 : i === 4 ? 6 : 8,
        weightKg: i === 0 || i === 2 ? 5 : undefined, bandLevel: i === 1 || i === 3 ? '가벼움' : undefined,
      })),
    })),
  };
}
test('body evidence joins existing composition but cannot create a workout change without performance', () => {
  const result = run();
  assert.equal(result.recommendation.action, 'maintain');
  assert.equal(result.recommendation.change, undefined);
  assert.equal(result.composition?.strengthDays, 3);
  assert.equal(result.evidence[0].key, 'muscleMass');
  assert.match(result.bodyRationale, /원인이라는 뜻은 아닙니다/);
});
test('identical performance retains exactly the existing decision across opposite body trends', () => {
  const data = stores(), configuration = settings();
  data.workouts = { '2026-10-19': session(), '2026-10-16': session(), '2026-10-14': session() };
  const expected = buildAdaptiveWorkoutReview({ ...data, settings: configuration, selectedPlanId: 'five-day-fullbody-circuit', today });
  assert.equal(expected.action, 'increase');
  const first = run(data, configuration);
  data.inbody[today].muscleMass = 49;
  const second = run(data, configuration);
  assert.equal(first.recommendation.action, expected.action);
  assert.deepEqual(first.recommendation, second.recommendation);
  assert.equal(second.recommendation.change?.after, expected.change?.after);
});
test('existing stable-practice rule supplies a concrete replacement, not body-part deficit diagnosis', () => {
  const data = stores();
  data.workouts = Object.fromEntries(['2026-10-19', '2026-10-16', '2026-10-14', '2026-10-12', '2026-10-09', '2026-10-05'].map(date => [date, session()]));
  const result = run(data);
  assert.equal(result.recommendation.action, 'replace');
  assert.match(result.recommendation.change!.after, /햄스트링/);
  assert.match(result.recommendation.change!.preparation!, /지지대/);
});
test('current condition stop signals suppress body evidence as an exercise permission', () => {
  const data = stores();
  data.conditions[today] = { signals: ['leg-numbness'], recommendation: 'recovery', updatedAt: today };
  const result = run(data);
  assert.equal(result.recommendation.action, 'hold');
  assert.equal(result.composition, undefined);
  assert.equal(result.recommendation.change, undefined);
});
test('pain without a performed session still suppresses a recommendation', () => {
  const data = stores(); data.workouts[today] = { pullupPain: true };
  assert.equal(run(data).recommendation.action, 'hold');
  assert.equal(run(data).recommendation.change, undefined);
});
test('existing fatigue rule yields only the same date-specific recovery change', () => {
  const data = stores(); data.workouts['2026-10-19'] = { ...session(), workoutFatigue: 4 };
  const result = run(data);
  assert.equal(result.recommendation.action, 'decrease');
  assert.match(result.recommendation.change!.after, /휴식/);
  assert.match(result.recommendation.reasons.join(' '), /이번 날짜/);
});
test('old, incompatible and missing body metrics are absent from recommendation evidence', () => {
  const data = stores();
  data.inbody = { '2026-08-01': { muscleMass: 50, metricSources: { muscleMass: source } }, [today]: { bmi: 25, fatMass: 20 } };
  assert.deepEqual(run(data).evidence, []);
  assert.match(run(data).bodyRationale, /부족/);
});
test('existing catalog filter excludes custom hip bridge without rewriting saved settings', () => {
  const configuration = settings();
  configuration.weeklyEdits.mon = { customExercises: [{ id: 'custom-hip', sourceExerciseId: 'hip-bridge', name: '힙브릿지' }] };
  const result = run(stores(), configuration);
  assert.equal(result.recommendation.action, 'maintain');
  assert.equal(result.recommendation.change, undefined);
  assert.doesNotMatch(JSON.stringify(result), /힙브릿지/);
  assert.equal(configuration.weeklyEdits.mon.customExercises![0].name, '힙브릿지');
});
test('repeated combined checks preserve records, settings and decision history', () => {
  const data = stores(), configuration = settings(), before = JSON.stringify({ data, configuration });
  const first = run(data, configuration);
  assert.deepEqual(run(data, configuration), first);
  assert.equal(JSON.stringify({ data, configuration }), before);
  assert.equal('targets' in (first.recommendation.change ?? {}), false);
});
test('other user-selected programs keep their existing review scope', () => {
  const result = buildBodyWorkoutReview(stores(), settings(), 'week1-cardio-back', today);
  // Existing excluded exercises can additionally hold this legacy selection.
  assert.ok(['maintain', 'hold'].includes(result.recommendation.action));
  assert.equal(result.recommendation.change, undefined);
});
