import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdaptiveWorkoutReview, decideAdaptiveWorkoutReview, hasComparablePerformanceDrop } from './workoutAdaptiveReview.ts';
import type { AdaptiveReviewInput } from './workoutAdaptiveReview.ts';
import type { WorkoutDayRecord } from './workoutCompletion.ts';
import { buildCurrentWorkoutSettings, CURRENT_WEEKLY_METHODS } from './currentWorkoutDirection.ts';
import { applyExerciseTargets, getExerciseTargetsForDay } from './userWorkoutSettings.ts';
import { getWorkoutGroupById, workoutGroupToDayWorkout } from './workoutGroups.ts';

const names = ['덤벨 고블릿 스쿼트', '밴드 로우', '덤벨 플로어프레스', '루프밴드 사이드워크', '버드독'];
function session(patch: Partial<WorkoutDayRecord> = {}): WorkoutDayRecord {
  return {
    workoutDone: true, workoutGroupId: 'current-fullbody-strength-circuit', workoutStatus: 'completed', workoutDifficulty: 'easy',
    workoutFatigue: 2, workoutBackStatus: 'none', workoutNeurologicalSymptoms: [], workoutMethod: { ...CURRENT_WEEKLY_METHODS.mon },
    workoutExerciseRecords: names.map((exerciseName, index) => ({
      exerciseName, status: 'completed', sets: Array.from({ length: 3 }, (_, round) => ({
        setNumber: round + 1, completed: true, plannedReps: index === 1 ? 10 : index === 4 ? 6 : 8, reps: index === 1 ? 10 : index === 4 ? 6 : 8,
        weightKg: index === 0 || index === 2 ? 5 : undefined, bandLevel: index === 1 || index === 3 ? '가벼움' : undefined,
      })),
    })), ...patch,
  };
}
function input(patch: Partial<AdaptiveReviewInput> = {}): AdaptiveReviewInput {
  return { today: '2026-09-07', selectedPlanId: 'five-day-fullbody-circuit', conditions: {},
    settings: buildCurrentWorkoutSettings({ weeklyGroups: {}, weeklyMethods: {}, weeklyEdits: {}, exerciseTargets: {}, dateOverrides: {} }),
    workouts: { '2026-09-04': session(), '2026-09-02': session(), '2026-08-31': session() }, ...patch,
  };
}

test('current routine starts recovery days at one round, strength days at three', () => {
  assert.equal(CURRENT_WEEKLY_METHODS.tue.rounds, 1);
  assert.equal(CURRENT_WEEKLY_METHODS.thu.rounds, 1);
  assert.equal(CURRENT_WEEKLY_METHODS.mon.rounds, 3);
});
test('three fully recorded comparable strength sessions propose only one weekday rep increase', () => {
  const data = input();
  const original = structuredClone(data.settings);
  const review = buildAdaptiveWorkoutReview(data);
  assert.equal(review.action, 'increase');
  assert.deepEqual(data.settings, original, 'preview must not mutate settings');
  const next = decideAdaptiveWorkoutReview(data, review.id, 'applied', '2026-09-07T09:00:00Z');
  assert.equal(next.weeklyExerciseTargets?.mon?.[names[0]].reps, 9);
  assert.equal(getExerciseTargetsForDay(next, 'tue')[names[0]], undefined);
  assert.deepEqual(next.weeklyMethods, original.weeklyMethods);
  assert.deepEqual(next.weeklyGroups, original.weeklyGroups);
  assert.equal(getExerciseTargetsForDay(next, 'mon', '2026-08-31')[names[0]].reps, 8, 'past occurrence keeps old target');
  const day = applyExerciseTargets(workoutGroupToDayWorkout(getWorkoutGroupById(next.weeklyGroups.mon!), 'mon', '월요일'), getExerciseTargetsForDay(next, 'mon', '2026-09-07'));
  assert.match(day.phases.flatMap((phase) => phase.exercises).find((exercise) => exercise.name === names[0])!.meta ?? '', /9회/);
  const reloaded = JSON.parse(JSON.stringify(next));
  assert.equal(buildAdaptiveWorkoutReview({ ...data, settings: reloaded }).action, 'maintain');
  assert.equal(buildAdaptiveWorkoutReview({ ...data, settings: reloaded, today: '2026-09-14' }).action, 'maintain', 'old records cannot increment again next week');
});
test('keep saves a decision while preserving the entire plan', () => {
  const data = input();
  const review = buildAdaptiveWorkoutReview(data);
  const next = decideAdaptiveWorkoutReview(data, review.id, 'kept', '2026-09-07T09:00:00Z');
  const { adaptiveReviewDecisions, ...plan } = next;
  assert.deepEqual(plan, data.settings);
  assert.equal(adaptiveReviewDecisions?.[0].decision, 'kept');
  assert.equal(buildAdaptiveWorkoutReview({ ...data, settings: next }).alreadyReviewed, true);
  assert.throws(() => decideAdaptiveWorkoutReview({ ...data, settings: next }, review.id, 'applied', '2026-09-07T10:00:00Z'), /이미 확인/);
});
test('changed records or settings invalidate a preview before applying', () => {
  const data = input();
  const review = buildAdaptiveWorkoutReview(data);
  data.workouts['2026-09-07'] = session({ workoutBackStatus: 'worse' });
  assert.throws(() => decideAdaptiveWorkoutReview(data, review.id, 'applied', '2026-09-07T10:00:00Z'), /기록이나 계획/);
  const fresh = input();
  fresh.settings.weeklyMethods.mon = { ...CURRENT_WEEKLY_METHODS.mon, rounds: 2 };
  assert.throws(() => decideAdaptiveWorkoutReview(fresh, review.id, 'applied', '2026-09-07T10:00:00Z'), /기록이나 계획/);
});
test('missing details, unknown back status, missing load, recovery-only and outdated sessions never increase', () => {
  const variants = [
    { workoutExerciseRecords: undefined }, { workoutBackStatus: undefined },
    { workoutExerciseRecords: session().workoutExerciseRecords!.map((exercise) => ({ ...exercise, sets: exercise.sets!.map((set) => ({ ...set, weightKg: undefined, bandLevel: undefined })) })) },
    { workoutGroupId: 'current-fullbody-recovery-circuit' },
  ];
  for (const patch of variants) {
    const data = input({ workouts: { '2026-09-04': session(patch), '2026-09-02': session(patch), '2026-08-31': session(patch) } });
    assert.equal(buildAdaptiveWorkoutReview(data).action, 'maintain');
  }
  assert.equal(buildAdaptiveWorkoutReview(input({ today: '2026-10-08' })).evidenceCount, 0);
  assert.equal(buildAdaptiveWorkoutReview(input({ today: '2026-09-15' })).action, 'maintain');
});
test('future and invalid dates do not become training evidence', () => {
  const review = buildAdaptiveWorkoutReview(input({ workouts: { '2026-09-08': session(), '2026-99-99': session(), 'bad': session() } }));
  assert.equal(review.evidenceCount, 0);
  assert.equal(review.action, 'maintain');
});
test('fatigue reduces only the next date and does not alter weekly recovery structure', () => {
  const data = input({ today: '2026-09-08', workouts: { '2026-09-07': session({ workoutFatigue: 4 }) } });
  const review = buildAdaptiveWorkoutReview(data);
  assert.equal(review.action, 'decrease');
  assert.equal(review.change?.date, '2026-09-08');
  assert.equal(review.change?.groupId, 'rest', 'one-round recovery day can become rest');
  const next = decideAdaptiveWorkoutReview(data, review.id, 'applied', '2026-09-08T09:00:00Z');
  assert.deepEqual(next.weeklyGroups, data.settings.weeklyGroups);
  assert.deepEqual(next.weeklyMethods, data.settings.weeklyMethods);
  assert.equal(next.dateOverrides['2026-09-08'].groupId, 'rest');
  assert.equal(buildAdaptiveWorkoutReview({ ...data, settings: next }).action, 'maintain', 'same fatigue cannot reduce another day');
});
test('fatigue lowers a strength session from three to two rounds with more rest', () => {
  const data = input({ workouts: { '2026-09-06': session({ workoutFatigue: 4 }) } });
  const review = buildAdaptiveWorkoutReview(data);
  assert.equal(review.action, 'decrease');
  assert.equal(review.change?.method?.rounds, 2);
  assert.equal(review.change?.method?.restSeconds, 90);
});
test('all neurological symptoms, worsening back and current symptoms hold changes including stopped sessions', () => {
  for (const symptom of ['radiating-pain', 'tingling', 'numbness', 'leg-weakness'] as const) {
    const data = input({ workouts: { '2026-09-07': session({ workoutDone: false, workoutStatus: 'stopped', workoutNeurologicalSymptoms: [symptom] }) } });
    const review = buildAdaptiveWorkoutReview(data);
    assert.equal(review.action, 'hold');
    assert.equal(review.change, undefined);
    assert.throws(() => decideAdaptiveWorkoutReview(data, review.id, 'applied', '2026-09-07T10:00:00Z'), /증상 확인/);
  }
  assert.equal(buildAdaptiveWorkoutReview(input({ conditions: { '2026-09-07': { signals: ['leg-weakness'], recommendation: 'recovery', updatedAt: '2026-09-07T10:00:00Z' } } })).action, 'hold');
  assert.equal(buildAdaptiveWorkoutReview(input({ workouts: { '2026-09-07': session({ workoutBackStatus: 'worse' }) } })).action, 'hold');
});
test('custom edits and date exceptions are not overwritten by a proposal', () => {
  const data = input();
  data.settings.weeklyEdits.mon = { removed: ['bird-dog'] };
  data.settings.dateOverrides['2026-09-09'] = { groupId: 'rest' };
  const review = buildAdaptiveWorkoutReview(data);
  assert.equal(review.change?.dayId, 'fri');
  const next = decideAdaptiveWorkoutReview(data, review.id, 'applied', '2026-09-07T10:00:00Z');
  assert.deepEqual(next.weeklyEdits, data.settings.weeklyEdits);
  assert.deepEqual(next.dateOverrides['2026-09-09'], data.settings.dateOverrides['2026-09-09']);
});
test('after sufficient stable practice, a replacement needs preparation and keeps five main moves', () => {
  const data = input({ today: '2026-09-14', workouts: Object.fromEntries(['2026-09-11', '2026-09-09', '2026-09-07', '2026-09-04', '2026-09-02', '2026-08-31'].map((date) => [date, session()])) });
  data.settings.exerciseTargets['지지형 햄스트링 컬'] = { reps: 24, sets: 5 };
  const review = buildAdaptiveWorkoutReview(data);
  assert.equal(review.action, 'replace');
  assert.throws(() => decideAdaptiveWorkoutReview(data, review.id, 'applied', '2026-09-14T10:00:00Z'), /준비 조건/);
  const next = decideAdaptiveWorkoutReview(data, review.id, 'applied', '2026-09-14T10:00:00Z', true);
  assert.equal(next.weeklyGroups.mon, 'current-fullbody-hamstring-circuit');
  assert.equal(next.weeklyMethods.mon?.rounds, 2);
  const group = getWorkoutGroupById(next.weeklyGroups.mon!);
  assert.ok(group.type !== 'choice');
  const main = group.exercises.filter((exercise) => exercise.phase === 'main');
  assert.equal(main.length, 5);
  assert.ok(main.some((exercise) => exercise.exerciseId === 'supported-hamstring-curl'));
  const day = applyExerciseTargets(workoutGroupToDayWorkout(group, 'mon', '월요일'), getExerciseTargetsForDay(next, 'mon', '2026-09-14'));
  assert.match(day.phases.flatMap((phase) => phase.exercises).find((exercise) => exercise.exerciseId === 'supported-hamstring-curl')?.meta ?? '', /좌우 8회/);
  assert.equal(next.exerciseTargets['지지형 햄스트링 컬'].reps, 24, 'introduction target is scoped to the changed weekday');
  assert.ok(!main.some((exercise) => ['dead-bug', 'hip-bridge', 'sliding-board-cardio'].includes(exercise.exerciseId)));
});
test('a lower planned round count is not a performance decline', () => {
  const previous = session();
  const latest = session({ workoutMethod: { ...CURRENT_WEEKLY_METHODS.mon, rounds: 2 }, workoutExerciseRecords: session().workoutExerciseRecords!.map((exercise) => ({ ...exercise, sets: exercise.sets!.slice(0, 2) })) });
  assert.equal(hasComparablePerformanceDrop([latest, previous]), false);
  const declining = session({ workoutExerciseRecords: session().workoutExerciseRecords!.map((exercise) => ({ ...exercise, sets: exercise.sets!.map((set) => ({ ...set, reps: 2 })) })) });
  assert.equal(hasComparablePerformanceDrop([declining, previous]), true);
});
test('Pallof press is offered only after the hamstring variation is established', () => {
  const data = input({ today: '2026-09-21', workouts: Object.fromEntries(['2026-09-18', '2026-09-16', '2026-09-14', '2026-09-11', '2026-09-09', '2026-09-07'].map((date) => [date, session()])) });
  data.settings.weeklyGroups.fri = 'current-fullbody-hamstring-circuit';
  assert.notEqual(buildAdaptiveWorkoutReview(data).change?.groupId, 'current-fullbody-antirotation-circuit', 'calendar time alone cannot introduce another variation');
  for (const date of ['2026-09-18', '2026-09-11', '2026-09-04']) {
    data.workouts[date] = session({ workoutGroupId: 'current-fullbody-hamstring-circuit', workoutExerciseRecords: session().workoutExerciseRecords!.map((exercise) => ({ ...exercise, exerciseName: exercise.exerciseName === '루프밴드 사이드워크' ? '지지형 햄스트링 컬' : exercise.exerciseName })) });
  }
  const review = buildAdaptiveWorkoutReview(data);
  assert.equal(review.action, 'replace');
  assert.equal(review.change?.groupId, 'current-fullbody-antirotation-circuit');
  assert.match(review.preparation!, /안전하게 고정/);
  const next = decideAdaptiveWorkoutReview(data, review.id, 'applied', '2026-09-21T09:00:00Z', true);
  const group = getWorkoutGroupById(next.weeklyGroups.mon!);
  assert.ok(group.type !== 'choice');
  const main = group.exercises.filter((exercise) => exercise.phase === 'main');
  assert.equal(main.length, 5);
  assert.ok(main.some((exercise) => exercise.exerciseId === 'band-pallof-press'));
});
test('a prior small rep increase does not prevent a later balance replacement', () => {
  const data = input({ today: '2026-09-21', workouts: Object.fromEntries(['2026-09-18', '2026-09-16', '2026-09-14', '2026-09-11', '2026-09-09', '2026-09-07'].map((date) => [date, session()])) });
  data.settings.adaptiveReviewDecisions = [{ id: 'previous', action: 'increase', decision: 'applied', decidedAt: '2026-09-12T09:00:00Z', decidedFor: '2026-09-12', evidenceThrough: '2026-09-11', summary: '한 운동 반복수 변경' }];
  assert.equal(buildAdaptiveWorkoutReview(data).action, 'replace');
});
test('weekly limit uses the user local date, including a Korean Monday before UTC Monday', () => {
  const data = input();
  const review = buildAdaptiveWorkoutReview(data);
  const settings = decideAdaptiveWorkoutReview(data, review.id, 'applied', '2026-09-06T16:00:00Z');
  assert.equal(settings.adaptiveReviewDecisions?.[0].decidedFor, '2026-09-07');
  const after = input({ today: '2026-09-12', settings, workouts: { '2026-09-11': session(), '2026-09-09': session(), '2026-09-08': session() } });
  assert.equal(buildAdaptiveWorkoutReview(after).action, 'maintain');
  after.workouts['2026-09-12'] = session({ workoutNeurologicalSymptoms: ['numbness'] });
  assert.equal(buildAdaptiveWorkoutReview(after).action, 'hold', 'safety can override the weekly limit');
});
