import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeGrowthWorkoutPatterns } from './growthWorkoutPatterns.ts';
import { summarizeGrowthPatterns } from './growthPatterns.ts';
import type { GrowthSessionRow, GrowthSessionStatus } from './growthPlatform.ts';

const days = (statuses: GrowthSessionStatus[]) => statuses.map((status, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, status }));

test('only explicit main, cardio and pullup execution marks count; absent records do not mean rest', () => {
  const rows = days(Array(12).fill('completed'));
  const values = [true, false, { workoutStatus: 'stopped' }, { workoutStatus: 'partial' }, { workoutDone: true }, { cardioDone: true }, { rosaryCardioDone: true }, { postWorkoutCardioDone: true }, { pullupDone: true }, { foamRollerDone: true }, { cardioMinutes: 20, workoutMemo: 'plan', workoutGroupId: 'rest' }];
  const raw = Object.fromEntries(values.map((value, i) => [rows[i].date, value]));
  const before = structuredClone(raw);
  const result = summarizeGrowthWorkoutPatterns(rows, raw)!;
  assert.equal(result.withWorkout.recorded, 8); assert.equal(result.unconfirmed.recorded, 4);
  assert.deepEqual(raw, before);
  assert.deepEqual(summarizeGrowthWorkoutPatterns(rows, JSON.stringify(raw)), result);
});

test('comparison uses only valid, distinct routine days in the last 28 complete days', () => {
  const sessions = [
    { session_date: '2026-09-16', status: 'stopped', routine_id: 'a' },
    { session_date: '2026-09-16', status: 'completed', routine_id: 'a' },
    { session_date: '2026-09-17', status: 'completed', routine_id: 'a' },
    { session_date: '2026-09-15', status: 'completed', routine_id: 'b' },
    { session_date: '2026-08-19', status: 'completed', routine_id: 'a' },
  ] as GrowthSessionRow[];
  const result = summarizeGrowthWorkoutPatterns(summarizeGrowthPatterns(sessions, 'a', '2026-09-17').days, { '2026-09-16': true, '2026-09-14': true })!;
  assert.deepEqual(result.withWorkout, { recorded: 1, completed: 1, partial: 0, stopped: 0 });
  assert.equal(result.evidence.length, 1); assert.equal(result.unconfirmed.recorded, 0);
  assert.match(result.suggestion, /각각 4일 이상/);
});

test('comparison waits for four days per group and only describes a difference at 25 percentage points', () => {
  const rows = days(['stopped', 'partial', 'completed', 'completed', 'completed', 'completed', 'completed', 'completed']);
  const raw = Object.fromEntries(rows.slice(0, 4).map(row => [row.date, true]));
  assert.match(summarizeGrowthWorkoutPatterns(rows.slice(0, -1), raw)!.suggestion, /각각 4일 이상/);
  assert.match(summarizeGrowthWorkoutPatterns(rows, raw)!.suggestion, /더 낮았어요/);
  assert.match(summarizeGrowthWorkoutPatterns(rows.map(row => ({ ...row, status: row.status === 'completed' ? 'stopped' : 'completed' })), raw)!.suggestion, /더 높았어요/);
  assert.match(summarizeGrowthWorkoutPatterns(rows.map(row => ({ ...row, status: 'completed' })), raw)!.suggestion, /차이가 크지/);
  const boundary = days(['partial','completed','completed','completed','completed','completed','completed','completed']);
  assert.match(summarizeGrowthWorkoutPatterns(boundary, raw)!.suggestion, /더 낮았어요/);
});

test('unreadable data blocks comparison instead of becoming no exercise; missing stores remain unconfirmed', () => {
  const rows = days(['completed']);
  for (const raw of ['{broken', '[]', [], true, 3, { '2026-09-01': 'true' }, { '2026-09-01': { workoutDone: 'false' } }, { '2026-09-01': { workoutStatus: 'rest' } }]) {
    assert.equal(summarizeGrowthWorkoutPatterns(rows, raw), null);
  }
  for (const raw of [undefined, null, {}, '{}', { '2026-09-02': 'unrelated malformed record' }]) {
    const result = summarizeGrowthWorkoutPatterns(rows, raw)!;
    assert.equal(result.withWorkout.recorded, 0); assert.equal(result.unconfirmed.recorded, 1);
  }
  assert.equal(summarizeGrowthWorkoutPatterns([], {})!.evidence.length, 0);
});
