import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeGrowthPatterns } from './growthPatterns.ts';
import type { GrowthSessionRow } from './growthPlatform.ts';
const session = (date: string, status: GrowthSessionRow['status'] = 'completed', routine = 'a') => ({ session_date: date, status, routine_id: routine } as GrowthSessionRow);
test('empty days remain unrecorded and never become failures', () => {
  const result = summarizeGrowthPatterns([], 'a', '2026-09-17');
  assert.equal(result.start, '2026-08-20'); assert.equal(result.end, '2026-09-16');
  assert.equal(result.unrecorded, 28); assert.equal(result.recorded, 0);
  assert.equal(result.weekday.stopped + result.weekend.stopped, 0);
});
test('same-day repeats count once with completed then partial then stopped precedence, regardless of order', () => {
  const rows = [session('2026-09-14', 'stopped'), session('2026-09-14'), session('2026-09-14', 'partial'), session('2026-09-15', 'stopped'), session('2026-09-15', 'partial')];
  const result = summarizeGrowthPatterns(rows, 'a', '2026-09-17');
  assert.equal(result.recorded, 2); assert.equal(result.weekday.completed, 1); assert.equal(result.weekday.partial, 1); assert.equal(result.weekday.stopped, 0);
  assert.deepEqual(summarizeGrowthPatterns([...rows].reverse(), 'a', '2026-09-17'), result);
});
test('invalid, future, today, old and unrelated records are excluded without mutating input', () => {
  const rows = [session('2026-08-20'), session('2026-08-19'), session('2026-09-17'), session('2026-09-18'), session('2026-09-16', 'completed', 'b'), session('2026-02-30')];
  const before = JSON.stringify(rows); const result = summarizeGrowthPatterns(rows, 'a', '2026-09-17');
  assert.equal(result.recorded, 1); assert.equal(JSON.stringify(rows), before);
  assert.throws(() => summarizeGrowthPatterns([], 'a', '2026-02-30'));
});
test('recommendation requires enough distinct weekday and weekend observations', () => {
  const rows = [session('2026-09-07', 'stopped'),session('2026-09-08', 'stopped'),session('2026-09-09', 'stopped'),session('2026-09-10', 'stopped'),session('2026-09-05'),session('2026-09-06'),session('2026-09-12')];
  assert.match(summarizeGrowthPatterns(rows, 'a', '2026-09-17').suggestion, /주말의 기록일/);
  assert.match(summarizeGrowthPatterns(rows.slice(0,-1), 'a', '2026-09-17').suggestion, /기록이 모이면/);
  assert.match(summarizeGrowthPatterns(rows.map(row => ({...row,status: row.status === 'completed' ? 'stopped' : 'completed'})), 'a', '2026-09-17').suggestion, /평일의 기록일/);
});
test('small differences keep the current schedule and year boundaries use date keys', () => {
  const rows = ['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-05','2026-09-06','2026-09-12'].map(date=>session(date));
  assert.match(summarizeGrowthPatterns(rows,'a','2026-09-17').suggestion,/차이가 크지/);
  const result=summarizeGrowthPatterns([session('2025-12-31')],'a','2026-01-01');
  assert.equal(result.start,'2025-12-04'); assert.equal(result.weekdays[2].completed,1);
});
