import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLocalGrowthCoach, type GrowthRoutineRow, type GrowthSessionRow } from './growthPlatform.ts';
import {
  buildGrowthProgressionSuggestion, completedGrowthFeedback, growthSuggestionCanApply,
  GROWTH_DIFFICULTIES, mergeEvidenceBasedGrowthSuggestions, normalizeGrowthDifficulty,
} from './growthRoutineProgression.ts';

const routine: GrowthRoutineRow = {
  id: 'routine', user_id: 'owner', category: 'typing', title: '타자', target_minutes: 10,
  preferred_days: [1, 3, 5], target_sessions_per_week: 3, enabled: true, sort_order: 0,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
};
const endDate = '2026-10-09';
function session(day: string, overrides: Partial<GrowthSessionRow> = {}): GrowthSessionRow {
  return { id: day, user_id: 'owner', routine_id: routine.id, session_date: day, status: 'completed',
    planned_minutes: 10, actual_minutes: 10, memo: '', source: 'manual', metrics: { routineDifficulty: 'too_easy' },
    started_at: null, ended_at: null, created_at: `${day}T00:00:00Z`, updated_at: `${day}T00:00:00Z`, ...overrides };
}
const easy = () => ['2026-10-05', '2026-10-07', '2026-10-09'].map(day => session(day));

test('completed feedback is optional, explicit, and independent from interruption reasons', () => {
  assert.equal(GROWTH_DIFFICULTIES.too_easy, '너무 쉬웠어요');
  for (const value of [undefined, null, '', 'unknown', 'constructor', '__proto__', {}, [], true, 1]) {
    assert.equal(normalizeGrowthDifficulty(value), 'unrecorded');
    assert.deepEqual(completedGrowthFeedback('completed', value), {});
  }
  for (const difficulty of ['too_easy', 'appropriate', 'difficult']) {
    assert.deepEqual(completedGrowthFeedback('completed', difficulty), { routineDifficulty: difficulty });
    assert.deepEqual(completedGrowthFeedback('partial', difficulty), {});
    assert.deepEqual(completedGrowthFeedback('stopped', difficulty), {});
  }
});

test('three explicit dates preview current→next time and immutable evidence without changing targets', () => {
  const rows = easy(); const before = JSON.stringify({ routine, rows });
  const suggestion = buildGrowthProgressionSuggestion(routine, rows, endDate)!;
  assert.equal(suggestion.recommendedMinutes, 15);
  assert.deepEqual(suggestion.progression, {
    targetMinutes: 10, routineUpdatedAt: routine.updated_at,
    dates: ['2026-10-05', '2026-10-07', '2026-10-09'], sessionIds: ['2026-10-05', '2026-10-07', '2026-10-09'],
  });
  assert.match(suggestion.reason, /직접 선택/);
  assert.equal(growthSuggestionCanApply(suggestion, routine, rows, endDate), true);
  assert.equal(JSON.stringify({ routine, rows }), before);
  const coach = buildLocalGrowthCoach([routine], rows, endDate);
  assert.deepEqual(coach.suggestions, [suggestion]);
  assert.deepEqual(buildLocalGrowthCoach([routine], rows, endDate), coach);
});

test('a high completion count, quick completion, unknown or missing feedback never becomes easy', () => {
  for (const metrics of [{}, { routineDifficulty: 'unrecorded' }, { routineDifficulty: 'future-value' }, { accuracy: 100 }]) {
    const rows = easy().map(row => ({ ...row, metrics }));
    assert.equal(buildGrowthProgressionSuggestion(routine, rows, endDate), null);
    assert.equal(buildLocalGrowthCoach([routine], rows, endDate).suggestions.some(item => item.progression), false);
  }
});

test('same-day duplicates cannot satisfy the three-day rule', () => {
  const one = easy()[0];
  assert.equal(buildGrowthProgressionSuggestion(routine, [one, { ...one, id: 'duplicate-1' }, { ...one, id: 'duplicate-2' }], endDate), null);
  assert.equal(buildGrowthProgressionSuggestion(routine, easy().slice(0, 2), endDate), null);
});

for (const [name, extra] of [
  ['partial', { status: 'partial' }], ['stopped', { status: 'stopped' }],
  ['appropriate', { metrics: { routineDifficulty: 'appropriate' } }],
  ['difficult', { metrics: { routineDifficulty: 'difficult' } }],
] as const) {
  test(`${name} evidence holds progression even after three easy responses`, () => {
    assert.equal(buildGrowthProgressionSuggestion(routine, [...easy(), session('2026-09-27', extra)], endDate), null);
  });
}

test('old/future/other-owner/other-routine/below-target records are excluded', () => {
  const insufficient = easy().slice(0, 2);
  for (const row of [session('2026-09-25'), session('2026-10-10'), session('2026-10-09', { user_id: 'other' }),
    session('2026-10-09', { routine_id: 'other' }), session('2026-10-09', { actual_minutes: 9 }),
    session('2026-10-09', { planned_minutes: 5 })]) {
    assert.equal(buildGrowthProgressionSuggestion(routine, [...insufficient, row], endDate), null);
  }
  assert.ok(buildGrowthProgressionSuggestion(routine, [...insufficient, session('2026-09-26')], endDate));
  // Foreign interruptions also cannot change this owner's decision.
  assert.ok(buildGrowthProgressionSuggestion(routine, [...easy(), session('2026-10-08', { status: 'stopped', user_id: 'other' })], endDate));
});

test('progression stays within existing bounds and disabled routines never progress', () => {
  assert.equal(buildGrowthProgressionSuggestion({ ...routine, enabled: false }, easy(), endDate), null);
  for (const target of [0, 4, 240, 241, NaN, 10.5]) assert.equal(buildGrowthProgressionSuggestion({ ...routine, target_minutes: target }, easy(), endDate), null);
  assert.equal(buildGrowthProgressionSuggestion({ ...routine, target_minutes: 238 }, easy().map(row => ({ ...row, planned_minutes: 238, actual_minutes: 238 })), endDate)?.recommendedMinutes, 240);
});

test('saved preview cannot be reused after target change, schedule edit, loss of evidence or new contrary feedback', () => {
  const suggestion = buildGrowthProgressionSuggestion(routine, easy(), endDate)!;
  assert.equal(growthSuggestionCanApply(suggestion, { ...routine, target_minutes: 15 }, easy(), endDate), false);
  assert.equal(growthSuggestionCanApply(suggestion, { ...routine, updated_at: '2026-10-10T00:00:00Z' }, easy(), endDate), false);
  assert.equal(growthSuggestionCanApply(suggestion, routine, easy().slice(1), endDate), false);
  assert.equal(growthSuggestionCanApply(suggestion, routine, [...easy(), session('2026-10-08', { status: 'stopped' })], endDate), false);
  assert.equal(growthSuggestionCanApply(suggestion, routine, easy(), '2026-11-01'), false);
  assert.equal(growthSuggestionCanApply(suggestion, { ...routine, user_id: 'other' }, easy(), endDate), false);
  assert.equal(growthSuggestionCanApply(suggestion, undefined, easy(), endDate), false);
});

test('repeated reviews at the new target cannot produce another increase from the same evidence', () => {
  const changed = { ...routine, target_minutes: 15, updated_at: '2026-10-09T12:00:00Z' };
  assert.equal(buildGrowthProgressionSuggestion(changed, easy(), endDate), null);
  assert.equal(buildLocalGrowthCoach([changed], easy(), endDate).suggestions.some(item => item.progression), false);
});

test('the existing model path may not invent increases or replace exact local progression evidence', () => {
  const local = buildLocalGrowthCoach([routine], easy(), endDate).suggestions;
  const candidate = [{ id: 'unproven', routineId: routine.id, title: 'more', reason: 'completed often', recommendedMinutes: 30 }];
  assert.deepEqual(mergeEvidenceBasedGrowthSuggestions(candidate, local, [routine]), local);
  assert.deepEqual(mergeEvidenceBasedGrowthSuggestions(candidate, [], [routine]), []);
  assert.equal(growthSuggestionCanApply(candidate[0], routine, easy(), endDate), false);
  const reduce = { ...candidate[0], recommendedMinutes: 5 };
  assert.equal(growthSuggestionCanApply(reduce, routine, [], endDate), true);
  assert.deepEqual(mergeEvidenceBasedGrowthSuggestions([reduce], [], [routine]), [reduce]);
});

test('repeat interruptions keep the existing reduction path, with no contradictory increase', () => {
  const rows = [...easy(), session('2026-10-06', { status: 'stopped', metrics: { stopReason: 'tired' } }), session('2026-10-08', { status: 'partial' })];
  const coach = buildLocalGrowthCoach([routine], rows, endDate);
  assert.equal(coach.suggestions[0].id, 'local-reduce-load');
  assert.equal(coach.suggestions.some(item => item.progression), false);
});

test('malformed or duplicated saved evidence cannot unlock an increase', () => {
  const valid = buildGrowthProgressionSuggestion(routine, easy(), endDate)!;
  for (const evidence of [
    { ...valid.progression!, dates: undefined },
    { ...valid.progression!, sessionIds: undefined },
    { ...valid.progression!, dates: ['2026-10-05', '2026-10-05', '2026-10-05'] },
    { ...valid.progression!, sessionIds: ['2026-10-05', '2026-10-05', '2026-10-05'] },
  ]) {
    assert.equal(growthSuggestionCanApply({ ...valid, progression: evidence as typeof valid.progression }, routine, easy(), endDate), false);
  }
});

test('filtering unsupported AI increases retains the existing local reduction fallback', () => {
  const interrupted = [
    session('2026-10-06', { status: 'stopped', metrics: { stopReason: 'tired' } }),
    session('2026-10-08', { status: 'partial', metrics: {} }),
  ];
  const local = buildLocalGrowthCoach([routine], interrupted, endDate).suggestions;
  assert.equal(local[0].id, 'local-reduce-load');
  const unsafe = [{ id: 'unproven', routineId: routine.id, title: 'more', reason: 'completed often', recommendedMinutes: 30 }];
  assert.deepEqual(mergeEvidenceBasedGrowthSuggestions(unsafe, local, [routine]), local);
  const consistency = buildLocalGrowthCoach([routine], [], endDate).suggestions;
  assert.deepEqual(mergeEvidenceBasedGrowthSuggestions(unsafe, consistency, [routine]), consistency);
});

test('dense routine histories stay within the existing 8000-byte review limit with three exact evidence dates', () => {
  const routines = Array.from({ length: 6 }, (_,i) => ({ ...routine, id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, title: '가'.repeat(60) }));
  const records = routines.flatMap((item, index) => Array.from({ length: 210 }, (_,i) => session(`2026-10-${String(7+i%3).padStart(2, '0')}`, {
    id: `00000000-0000-4000-8000-${String(index * 1000+i).padStart(12, '0')}`, routine_id: item.id,
  })));
  const suggestions = buildLocalGrowthCoach(routines, records, endDate).suggestions;
  assert.equal(suggestions.length, 6);
  assert.ok(Buffer.byteLength(JSON.stringify(suggestions)) <= 8000);
  for (let index = 0; index < suggestions.length; index++) {
    assert.equal(suggestions[index].progression!.sessionIds.length, 3);
    assert.equal(suggestions[index].progression!.dates.length, 3);
    assert.equal(growthSuggestionCanApply(suggestions[index], routines[index], records, endDate), true);
  }
});

test('new easy sessions and dates do not silently replace or invalidate still-valid saved evidence', () => {
  const original = easy(), suggestion = buildGrowthProgressionSuggestion(routine, original, endDate)!;
  const expanded = [...original, session('2026-10-08'), session('2026-10-09', { id: 'a-new-sort-first' })];
  assert.equal(growthSuggestionCanApply(suggestion, routine, expanded, endDate), true);
  assert.equal(growthSuggestionCanApply(suggestion, routine, expanded.filter(row => row.id !== original[0].id), endDate), false);
  const refreshed = buildGrowthProgressionSuggestion(routine, expanded, endDate)!;
  assert.deepEqual(refreshed.progression!.dates, ['2026-10-07', '2026-10-08', '2026-10-09']);
  assert.deepEqual(buildGrowthProgressionSuggestion(routine, [...expanded].reverse(), endDate), refreshed);
});
