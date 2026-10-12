import test from 'node:test';
import assert from 'node:assert/strict';
import {
  exactPainEvidenceGuide,
  painEvidenceRawText,
  positivePainSet,
  WORKOUT_PAIN_AREAS,
  workoutPainEvidence,
} from './workoutPainEvidence.ts';
import type { PainEvidenceCoverage, WorkoutPainEvidenceSummary } from './workoutPainEvidence.ts';
import { buildAdaptiveWorkoutReview, decideAdaptiveWorkoutReview } from './workoutAdaptiveReview.ts';
import type { AdaptiveReviewInput } from './workoutAdaptiveReview.ts';
import { buildCurrentWorkoutSettings } from './currentWorkoutDirection.ts';
import { exerciseGuides } from './exerciseGuides.ts';

const TODAY = '2026-10-09';
const pair = (patch: Record<string, unknown> = {}) => ({
  workoutPainArea: '무릎', workoutPainExercise: '버드독', ...patch,
});

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function dateBefore(today: string, days: number): string {
  return new Date(Date.parse(`${today}T12:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
}

function summarize(store: unknown, today = TODAY): WorkoutPainEvidenceSummary {
  const result = workoutPainEvidence(store, today);
  assert.ok(result);
  return result;
}

function assertCoverage(coverage: PainEvidenceCoverage): void {
  assert.equal(coverage.areaAnswered + coverage.areaMissing + coverage.areaInvalid, coverage.recorded);
  assert.equal(coverage.pairAnswered + coverage.pairMissing + coverage.pairInvalid, coverage.recorded);
  assert.equal(coverage.recorded + coverage.invalidRows + coverage.unrecorded, coverage.calendarDates);
}

function assertWindows(result: WorkoutPainEvidenceSummary): void {
  for (const window of [result.total, result.recent, result.previous]) assertCoverage(window);
  const counts = [
    'calendarDates', 'recorded', 'areaAnswered', 'areaMissing', 'areaInvalid',
    'pairAnswered', 'pairMissing', 'pairInvalid', 'invalidRows', 'unrecorded',
  ] as const;
  for (const field of counts) {
    assert.equal(result.total[field], result.recent[field] + result.previous[field], field);
  }
  for (const entry of result.pairs) {
    assert.equal(entry.dates.length, new Set(entry.dates).size);
    assert.equal(entry.dates.length, entry.recent + entry.previous);
  }
}

test('28 completed calendar dates split at the exact two 14-day boundaries', () => {
  const store = freeze(Object.fromEntries(Array.from({ length: 31 }, (_, index) => [dateBefore(TODAY, index - 1), pair()])));
  const before = structuredClone(store);
  const result = summarize(store);
  assert.deepEqual([result.total.start, result.total.end, result.total.calendarDates], ['2026-09-11', '2026-10-08', 28]);
  assert.deepEqual([result.previous.start, result.previous.end, result.previous.recorded], ['2026-09-11', '2026-09-24', 14]);
  assert.deepEqual([result.recent.start, result.recent.end, result.recent.recorded], ['2026-09-25', '2026-10-08', 14]);
  assert.equal(result.total.recorded, 28);
  assert.equal(result.total.unrecorded, 0);
  assert.deepEqual(result.sources.map(source => source.date), Array.from({ length: 28 }, (_, index) => dateBefore(TODAY, index + 1)));
  assert.deepEqual([result.pairs[0].previous, result.pairs[0].recent], [14, 14]);
  assert.deepEqual(store, before);
  assertWindows(result);
});

test('leap, month, year and DST boundaries use calendar dates regardless of process timezone', () => {
  const cases = [
    ['2024-03-01', '2024-02-02', '2024-02-15', '2024-02-16', '2024-02-29'],
    ['2026-03-01', '2026-02-01', '2026-02-14', '2026-02-15', '2026-02-28'],
    ['2026-01-01', '2025-12-04', '2025-12-17', '2025-12-18', '2025-12-31'],
    ['2026-03-10', '2026-02-10', '2026-02-23', '2026-02-24', '2026-03-09'],
    ['2026-11-03', '2026-10-06', '2026-10-19', '2026-10-20', '2026-11-02'],
  ];
  const previousTimezone = process.env.TZ;
  try {
    for (const timezone of ['UTC', 'America/New_York', 'Asia/Seoul']) {
      process.env.TZ = timezone;
      for (const [today, start, previousEnd, recentStart, end] of cases) {
        const store = freeze(Object.fromEntries(Array.from({ length: 28 }, (_, index) => [dateBefore(today, index + 1), true])));
        const result = summarize(store, today);
        assert.deepEqual([result.total.start, result.previous.end, result.recent.start, result.total.end],
          [start, previousEnd, recentStart, end], `${today} in ${timezone}`);
        assert.deepEqual([result.total.recorded, result.previous.recorded, result.recent.recorded], [28, 14, 14]);
        assertWindows(result);
      }
    }
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('today, future, old, impossible and weekday keys are excluded without migration', () => {
  const store = freeze({
    '2026-09-11': pair(), '2026-10-08': pair(),
    '2026-09-10': pair(), '2026-10-09': pair(), '2026-10-10': pair(),
    '2026-09-31': pair(), '2026-09-25T00:00:00Z': pair(), '2026-9-25': pair(),
    mon: pair(), tue: true, wed: pair(), thur: pair(),
  });
  const before = structuredClone(store);
  const result = summarize(store);
  assert.deepEqual(result.sources.map(source => source.date), ['2026-10-08', '2026-09-11']);
  assert.equal(result.total.recorded, 2);
  assert.equal(result.total.invalidRows, 0, 'excluded keys are not unreadable dated rows');
  assert.deepEqual(store, before, 'weekday records must remain untouched');
  const nonLeap = summarize({ '2026-02-29': pair(), '2026-02-30': pair(), '2026-02-28': pair() }, '2026-03-01');
  assert.deepEqual(nonLeap.sources.map(source => source.date), ['2026-02-28']);
  assertWindows(result);
});

test('invalid anchors and top-level shapes are unavailable rather than empty evidence', () => {
  for (const today of ['', 'mon', '2026-2-03', '2026-02-29', '2024-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-10-09T00:00:00Z']) {
    assert.equal(workoutPainEvidence({}, today), null, today);
  }
  for (const store of [null, undefined, true, false, 0, '', '{}', [], [pair()]]) {
    assert.equal(workoutPainEvidence(store, TODAY), null);
  }
  const result = summarize({});
  assert.equal(result.total.recorded, 0);
  assert.equal(result.total.invalidRows, 0);
  assert.equal(result.total.unrecorded, 28);
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.repeated, []);
  assertWindows(result);
});

test('multiple rounds, sets and duplicate exercise rows count only distinct stored dates', () => {
  const exerciseRows = Array.from({ length: 5 }, (_, round) => ({
    exerciseName: '버드독', status: 'completed', painScore: 3,
    executionContext: { method: 'circuit', roundNumber: round + 1, sequenceIndex: round, sourceExerciseIndex: 0 },
    sets: [{ setNumber: 1, completed: true }, { setNumber: 2, completed: true }],
  }));
  const row = pair({ workoutPainSet: 1, workoutExerciseRecords: [...exerciseRows, exerciseRows[0]] });
  const oneDate = summarize(freeze({ '2026-10-08': row }));
  assert.equal(oneDate.pairs[0].dates.length, 1);
  assert.equal(oneDate.sources[0].linkedExercises.length, 6);
  assert.deepEqual(oneDate.repeated, []);
  const twoDates = summarize(freeze({ '2026-10-08': row, '2026-09-24': row }));
  assert.equal(twoDates.total.recorded, 2);
  assert.equal(twoDates.total.pairAnswered, 2);
  assert.deepEqual(twoDates.repeated[0].dates, ['2026-10-08', '2026-09-24']);
  assert.deepEqual([twoDates.repeated[0].recent, twoDates.repeated[0].previous], [1, 1]);
  assertWindows(twoDates);
});

test('pair identity trims outer exercise whitespace only and keeps aliases, variants and Unicode distinct', () => {
  const names = ['버드독', '버드 독', 'bird-dog', 'Bird-Dog', '버드독 좌', '버드독 우', '밴드 버드독', '버드독'.normalize('NFD')];
  const store = Object.fromEntries(names.map((name, index) => [dateBefore(TODAY, index + 1), pair({ workoutPainExercise: name })]));
  store['2026-09-20'] = pair({ workoutPainExercise: ' \t버드독\n ' });
  store['2026-09-19'] = pair({ workoutPainArea: '발목' });
  const result = summarize(freeze(store));
  assert.equal(result.pairs.length, names.length + 1);
  assert.equal(result.repeated.length, 1);
  assert.equal(result.repeated[0].key, JSON.stringify(['무릎', '버드독']));
  assert.deepEqual(result.repeated[0].dates, ['2026-10-08', '2026-09-20']);
  for (const name of names) assert.ok(result.pairs.some(entry => entry.key === JSON.stringify(['무릎', name])));
  assert.ok(result.pairs.some(entry => entry.key === JSON.stringify(['발목', '버드독'])));
  assert.equal(result.sources.find(source => source.date === '2026-09-20')?.rawExercise, ' \t버드독\n ');
  assertWindows(result);
});

test('long, quoted and HTML-like names retain exact raw text without interpreting their content', () => {
  const rawExercise = `  <img src=x onerror="alert(1)"> & "custom" ${'운동'.repeat(300)}\n`;
  const result = summarize(freeze({ '2026-10-08': pair({ workoutPainExercise: rawExercise }) }));
  assert.equal(result.sources[0].rawExercise, rawExercise);
  assert.equal(result.sources[0].exercise, rawExercise.trim());
  assert.equal(result.pairs[0].key, JSON.stringify(['무릎', rawExercise.trim()]));
  assert.equal(painEvidenceRawText(rawExercise), JSON.stringify(rawExercise));
  assert.equal(painEvidenceRawText(undefined), '미입력');
  assert.equal(painEvidenceRawText(''), '빈 문자열');
  assert.equal(painEvidenceRawText('  '), '"  "');
  assert.equal(painEvidenceRawText(null), 'null');
  assert.equal(painEvidenceRawText(false), 'false');
  assert.equal(painEvidenceRawText(0), '0');
  assert.equal(painEvidenceRawText([]), '[]');
  assert.equal(painEvidenceRawText({ unsupported: true }), '{"unsupported":true}');
});

test('general-workout denominator includes completion and feedback-only records with honest status', () => {
  const cases: [unknown, string][] = [
    [true, 'completed'], [{ workoutDone: true }, 'completed'],
    [{ workoutStatus: 'completed' }, 'completed'], [{ workoutStatus: 'partial' }, 'partial'],
    [{ workoutDone: false, workoutStatus: 'stopped' }, 'stopped'],
    [{ workoutPain: false }, 'unknown'], [{ workoutBackStatus: 'none' }, 'unknown'],
    [{ workoutPainArea: undefined }, 'unknown'], [{ workoutPainExercise: null }, 'unknown'],
    [{ workoutPainSet: 0 }, 'unknown'], [{ workoutDifficulty: 'invalid' }, 'unknown'],
    [{ workoutFatigue: null }, 'unknown'], [{ workoutLastSetRpe: '' }, 'unknown'],
    [{ workoutNeurologicalSymptoms: [] }, 'unknown'],
    [{ workoutExerciseRecords: [{ exerciseName: '버드독', status: 'pending' }] }, 'unknown'],
    [{ workoutExerciseRecords: [null] }, 'unknown'],
    [{ workoutExerciseRecords: {} }, 'unknown'],
  ];
  for (const [row, status] of cases) {
    const result = summarize(freeze({ '2026-10-08': row }));
    assert.equal(result.total.recorded, 1, JSON.stringify(row));
    assert.equal(result.sources[0].status, status);
    assert.equal(result.total.invalidRows, 0);
    assertWindows(result);
  }
});

test('false, empty, other-activity, plan-only and draft-only rows do not enter the denominator', () => {
  const rows = [
    false, {}, { workoutDone: false }, { workoutStatus: 'pending' }, { workoutExerciseRecords: [] },
    { cardioDone: true, cardioMinutes: 30 }, { pullupDone: true, pullupPain: true },
    { foamRollerDone: true, foamRollerAreas: ['허리'] }, { recoveryDone: true },
    { rosaryCardioDone: true }, { postWorkoutCardioDone: true },
    { workoutPlanName: 'plan', workoutRoutineName: 'routine', workoutGroupId: 'group' },
    { workoutExerciseNames: ['버드독'], workoutMethod: { method: 'circuit', rounds: 5 } },
    { workoutRecordedAt: '2026-10-08T12:00:00Z' },
    { draft: { workoutPainArea: '무릎', workoutPainExercise: '버드독' } },
  ];
  const store = freeze(Object.fromEntries(rows.map((row, index) => [dateBefore(TODAY, index + 1), row])));
  const result = summarize(store);
  assert.equal(result.total.recorded, 0);
  assert.equal(result.total.invalidRows, 0);
  assert.equal(result.total.unrecorded, 28);
  assert.deepEqual(result.sources, []);
  assertWindows(result);
});

test('false, score zero, back none and empty symptoms never become explicit no-pain answers', () => {
  const result = summarize(freeze({
    '2026-10-08': { workoutPain: false },
    '2026-10-07': { workoutBackStatus: 'none' },
    '2026-10-06': { workoutNeurologicalSymptoms: [] },
    '2026-10-05': { workoutExerciseRecords: [{ exerciseName: '버드독', painScore: 0 }] },
    '2026-10-04': { workoutPain: true },
    '2026-10-03': pair({ workoutPain: false }),
  }));
  assert.deepEqual([result.total.recorded, result.total.areaAnswered, result.total.areaMissing], [6, 1, 5]);
  assert.deepEqual([result.total.pairAnswered, result.total.pairMissing, result.total.pairInvalid], [1, 5, 0]);
  assert.equal(result.sources[0].rawPain, false);
  assert.equal(result.sources[1].rawBack, 'none');
  assert.deepEqual(result.sources[2].rawNeurologicalSymptoms, []);
  assert.equal(result.sources.at(-1)?.pairState, 'answered', 'a computed false flag does not erase saved pair inputs');
  assert.equal(result.pairs.length, 1);
  assert.deepEqual(result.repeated, []);
  assertWindows(result);
});

test('back, neurological signals, exercise scores and planned names do not synthesize a pair', () => {
  const result = summarize(freeze({ '2026-10-08': {
    workoutStatus: 'stopped', workoutBackStatus: 'pain', workoutPain: true,
    workoutNeurologicalSymptoms: ['numbness'], workoutExerciseNames: ['버드독'],
    workoutExerciseRecords: [{ exerciseName: '버드독', painScore: 6, status: 'partial' }],
    workoutMemo: '무릎 버드독',
  } }));
  assert.equal(result.total.areaMissing, 1);
  assert.equal(result.total.pairMissing, 1);
  assert.equal(result.sources[0].area, null);
  assert.equal(result.sources[0].exercise, null);
  assert.deepEqual(result.sources[0].linkedExercises, []);
  assert.deepEqual(result.pairs, []);
});

test('supported areas are exact enums while missing and malformed values stay separate', () => {
  for (const area of WORKOUT_PAIN_AREAS) {
    const source = summarize({ '2026-10-08': pair({ workoutPainArea: area }) }).sources[0];
    assert.equal(source.areaState, 'answered');
    assert.equal(source.area, area);
  }
  for (const value of [undefined, null, '', ' \t\n ']) {
    const source = summarize({ '2026-10-08': pair({ workoutPainArea: value, workoutPainExercise: value }) }).sources[0];
    assert.equal(source.areaState, 'missing');
    assert.equal(source.pairState, 'missing');
    assert.equal(source.rawArea, value);
    assert.equal(source.rawExercise, value);
  }
  for (const value of ['없음', '목', ' 무릎 ', '무릎'.normalize('NFD'), 0, false, [], ['무릎'], {}]) {
    const source = summarize({ '2026-10-08': pair({ workoutPainArea: value }) }).sources[0];
    assert.equal(source.areaState, 'invalid');
    assert.equal(source.pairState, 'invalid');
    assert.equal(source.rawArea, value);
  }
  for (const value of [0, false, [], ['버드독'], {}]) {
    const source = summarize({ '2026-10-08': pair({ workoutPainExercise: value }) }).sources[0];
    assert.equal(source.areaState, 'answered');
    assert.equal(source.pairState, 'invalid');
    assert.equal(source.rawExercise, value);
  }
});

test('invalid fields take precedence over missing pair fields and coverage identities hold in every window', () => {
  const rows = ['무릎', null, ['무릎']].flatMap(area => ['버드독', null, 17].map(exercise => pair({
    workoutPainArea: area, workoutPainExercise: exercise,
  })));
  const store: Record<string, unknown> = {};
  for (const [index, row] of rows.entries()) {
    store[dateBefore(TODAY, index + 1)] = row;
    store[dateBefore(TODAY, index + 15)] = row;
  }
  store['2026-09-29'] = null;
  store['2026-09-15'] = [];
  store['2026-09-28'] = false;
  store['2026-09-14'] = { cardioDone: true };
  const result = summarize(freeze(store));
  for (const window of [result.recent, result.previous]) {
    assert.deepEqual([window.recorded, window.areaAnswered, window.areaMissing, window.areaInvalid], [9, 3, 3, 3]);
    assert.deepEqual([window.pairAnswered, window.pairMissing, window.pairInvalid], [1, 3, 5]);
    assert.deepEqual([window.invalidRows, window.unrecorded], [1, 4]);
  }
  assert.equal(result.sources.find(source => source.date === dateBefore(TODAY, 6))?.pairState, 'invalid', 'missing area plus invalid exercise is not double-counted as missing');
  assert.equal(result.sources.find(source => source.date === dateBefore(TODAY, 8))?.pairState, 'invalid', 'invalid area plus missing exercise is still invalid');
  assertWindows(result);
});

test('unreadable dated rows count outside D and never become unrecorded dates', () => {
  const unreadable = [null, undefined, 0, 1, '', 'true', [], [pair()]];
  const store = freeze(Object.fromEntries(unreadable.map((row, index) => [dateBefore(TODAY, index + 1), row])));
  const result = summarize(store);
  assert.equal(result.total.recorded, 0);
  assert.equal(result.total.invalidRows, unreadable.length);
  assert.equal(result.total.unrecorded, 28 - unreadable.length);
  assert.equal(result.total.areaInvalid, 0, 'field coverage is only over interpretable general-workout rows');
  assert.equal(result.total.pairInvalid, 0);
  assert.ok(result.sources.every(source => source.invalidRow && source.pairKey === null));
  assert.deepEqual(result.pairs, []);
  assertWindows(result);
});

test('one valid date, all unanswered dates and invalid fields remain distinguishable from an empty store', () => {
  const single = summarize({ '2026-10-08': pair() });
  const unanswered = summarize({ '2026-10-08': true, '2026-09-20': { workoutStatus: 'partial' } });
  const invalidFields = summarize({ '2026-10-08': pair({ workoutPainArea: ['무릎'] }) });
  assert.deepEqual([single.total.recorded, single.total.pairAnswered, single.repeated.length], [1, 1, 0]);
  assert.deepEqual([unanswered.total.recorded, unanswered.total.areaMissing, unanswered.total.pairMissing], [2, 2, 2]);
  assert.deepEqual([invalidFields.total.recorded, invalidFields.total.areaInvalid, invalidFields.total.invalidRows], [1, 1, 0]);
  for (const result of [single, unanswered, invalidFields]) assertWindows(result);
});

test('source dates retain all exact exercise matches, rounds and raw scores without matching aliases or planned names', () => {
  const first = {
    exerciseName: '버드독', status: 'partial', painScore: -1,
    executionContext: { method: 'circuit', roundNumber: 1, sequenceIndex: 2, sourceExerciseIndex: 0 },
    sets: [{ setNumber: 2, completed: false, reps: 4 }],
  };
  const second = { ...first, painScore: 2.5, executionContext: { ...first.executionContext, roundNumber: 3 } };
  const third = { ...first, painScore: 'unreadable', executionContext: { ...first.executionContext, roundNumber: 5 } };
  const store = freeze({ '2026-10-08': pair({
    workoutPainSet: 2, workoutExerciseNames: ['버드독'], workoutExerciseRecords: [
      first, { exerciseName: 'bird-dog', painScore: 4 }, second,
      { exerciseName: '버드 독' }, { exerciseName: '버드독 좌' }, third, null, 17, [],
    ],
  }), '2026-09-20': pair({ workoutExerciseNames: ['버드독'], workoutExerciseRecords: [{ exerciseName: '다른 운동' }] }) });
  const before = structuredClone(store);
  const result = summarize(store);
  const source = result.sources[0];
  assert.equal(source.date, '2026-10-08');
  assert.equal(source.painSet, 2);
  assert.deepEqual(source.linkedExercises, [first, second, third]);
  assert.deepEqual(source.linkedExercises.map(row => row.painScore), [-1, 2.5, 'unreadable']);
  assert.equal(source.invalidExerciseRecords, true);
  assert.equal(source.invalidRow, false);
  assert.deepEqual(result.sources[1].linkedExercises, [], 'a free name pair does not assert a performed exercise');
  assert.equal(result.total.pairAnswered, 2);
  assert.deepEqual(store, before);
});

test('only positive safe-integer pain sets are linked while every raw input is retained', () => {
  for (const value of [1, 2, Number.MAX_SAFE_INTEGER]) {
    assert.equal(positivePainSet(value), true);
    const source = summarize({ '2026-10-08': pair({ workoutPainSet: value }) }).sources[0];
    assert.equal(source.painSet, value);
    assert.equal(source.rawPainSet, value);
  }
  for (const value of [undefined, null, 0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '2', true, [], {}]) {
    assert.equal(positivePainSet(value), false);
    const source = summarize({ '2026-10-08': pair({ workoutPainSet: value }) }).sources[0];
    assert.equal(source.painSet, null);
    assert.equal(source.rawPainSet, value);
    assert.equal(source.pairState, 'answered', 'an invalid set does not erase the distinct saved area/name inputs');
  }
});

test('malformed exercise collections are flagged without erasing the session-level pair', () => {
  for (const records of [null, undefined, {}, 'unreadable', 0]) {
    const source = summarize({ '2026-10-08': pair({ workoutExerciseRecords: records }) }).sources[0];
    assert.equal(source.invalidExerciseRecords, true);
    assert.deepEqual(source.linkedExercises, []);
    assert.equal(source.pairState, 'answered');
  }
  const absent = summarize({ '2026-10-08': pair() }).sources[0];
  assert.equal(absent.invalidExerciseRecords, false);
  assert.deepEqual(absent.linkedExercises, []);
});

test('recordedAt never certifies actual occurrence dates or reconstructs a weekday migration', () => {
  const original = summarize({ '2026-09-20': pair(), '2026-10-08': pair() });
  const recordedLater = summarize(freeze({
    '2026-09-20': pair({ workoutRecordedAt: '2026-10-09T12:00:00Z' }),
    '2026-10-08': pair({ workoutRecordedAt: '2020-01-01T00:00:00Z' }),
    mon: pair({ workoutRecordedAt: '2026-10-08T12:00:00Z' }),
  }));
  assert.deepEqual(recordedLater, original, 'identical dated fields cannot distinguish original dates from migrated dates');
});

test('guide lookup accepts only own exact dictionary entries and never inherits or guesses a fallback', () => {
  const own = freeze({ summary: 'existing guide', videoUrl: 'https://example.invalid/static', alternatives: ['existing alternative'] });
  const dictionary = Object.assign(Object.create({ inherited: own }), { 버드독: own, 'bird-dog': own });
  Object.freeze(dictionary);
  assert.equal(exactPainEvidenceGuide(dictionary, '버드독'), own);
  assert.equal(exactPainEvidenceGuide(dictionary, 'bird-dog'), own);
  for (const name of ['inherited', 'constructor', '__proto__', 'toString', 'hasOwnProperty', ' 버드독 ', '버드 독', 'unknown']) {
    assert.equal(exactPainEvidenceGuide(dictionary, name), null, name);
  }
  const actualGuide = exerciseGuides['버드독'];
  assert.ok(actualGuide);
  const before = structuredClone(actualGuide);
  assert.equal(exactPainEvidenceGuide(exerciseGuides, '버드독'), actualGuide);
  assert.equal(exactPainEvidenceGuide(exerciseGuides, 'synthetic unregistered exercise'), null);
  assert.deepEqual(actualGuide, before, 'existing contents, alternatives and video queries are preserved');
});

function adaptiveInput(workouts: AdaptiveReviewInput['workouts']): AdaptiveReviewInput {
  return freeze(structuredClone({
    today: TODAY, selectedPlanId: 'five-day-fullbody-circuit', conditions: {}, workouts,
    settings: buildCurrentWorkoutSettings({ weeklyGroups: {}, weeklyMethods: {}, weeklyEdits: {}, exerciseTargets: {}, dateOverrides: {} }),
  }));
}

test('today-inclusive adaptive hold and rejected applied decisions are unchanged by historical evidence', () => {
  const data = adaptiveInput({
    '2026-10-09': { workoutStatus: 'stopped', workoutPain: true, workoutPainArea: '허리', workoutPainExercise: '오늘 운동' },
    '2026-10-08': { workoutDone: true, workoutPainArea: '무릎', workoutPainExercise: '버드독' },
    '2026-09-20': { workoutDone: true, workoutPainArea: '무릎', workoutPainExercise: '버드독' },
  });
  const before = structuredClone(data);
  const reviewBefore = buildAdaptiveWorkoutReview(data);
  assert.equal(reviewBefore.action, 'hold');
  assert.equal(reviewBefore.change, undefined);
  assert.equal(reviewBefore.evidenceThrough, TODAY);
  assert.throws(() => decideAdaptiveWorkoutReview(data, reviewBefore.id, 'applied', `${TODAY}T12:00:00Z`), /증상 확인/);
  const history = summarize(data.workouts);
  assert.equal(history.total.recorded, 2);
  assert.deepEqual(history.repeated[0].dates, ['2026-10-08', '2026-09-20']);
  assert.ok(history.sources.every(source => source.date !== TODAY));
  assert.deepEqual(buildAdaptiveWorkoutReview(data), reviewBefore);
  assert.throws(() => decideAdaptiveWorkoutReview(data, reviewBefore.id, 'applied', `${TODAY}T12:00:00Z`, true), /증상 확인/);
  assert.deepEqual(data, before);
});

test('historical windows do not broaden or shorten existing adaptive 28-day and safety 14-day cutoffs', () => {
  for (const [painDate, expectedAction] of [['2026-09-26', 'hold'], ['2026-09-25', 'maintain']] as const) {
    const data = adaptiveInput({
      [painDate]: { workoutStatus: 'stopped', workoutPain: true },
      '2026-09-11': { workoutDone: true },
      '2026-09-12': { workoutDone: true },
      '2026-10-09': { workoutDone: true },
    });
    const before = structuredClone(data);
    const review = buildAdaptiveWorkoutReview(data);
    assert.equal(review.action, expectedAction);
    assert.equal(review.evidenceCount, 3, 'adaptive history includes today and excludes T minus 28');
    const history = summarize(data.workouts);
    assert.equal(history.total.recorded, 3, 'historical evidence includes T minus 28 and excludes today');
    assert.deepEqual(buildAdaptiveWorkoutReview(data), review);
    assert.deepEqual(data, before);
    assertWindows(history);
  }
});

test('reading historical evidence preserves ordinary adaptive review IDs and decision results', () => {
  const data = adaptiveInput({
    '2026-10-08': { workoutDone: true, workoutPainArea: '무릎', workoutPainExercise: '버드독', workoutPain: false },
    '2026-09-20': { workoutDone: true, workoutPainArea: '무릎', workoutPainExercise: '버드독', workoutPain: false },
  });
  const before = structuredClone(data);
  const review = buildAdaptiveWorkoutReview(data);
  assert.equal(review.action, 'maintain');
  const now = `${TODAY}T12:00:00Z`;
  const decisionBefore = decideAdaptiveWorkoutReview(data, review.id, 'kept', now);
  const history = summarize(data.workouts);
  assert.equal(history.repeated.length, 1, 'saved pair inputs are not supplied as a new adaptive safety signal');
  assert.deepEqual(buildAdaptiveWorkoutReview(data), review);
  assert.deepEqual(decideAdaptiveWorkoutReview(data, review.id, 'kept', now), decisionBefore);
  assert.deepEqual(data, before);
});
