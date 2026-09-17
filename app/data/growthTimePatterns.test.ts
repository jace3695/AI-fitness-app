import test from 'node:test';
import assert from 'node:assert/strict';
import type { GrowthSessionRow } from './growthPlatform.ts';
import { summarizeGrowthPatterns } from './growthPatterns.ts';
import { summarizeGrowthTimePatterns } from './growthTimePatterns.ts';

const row = (date: string, clock: string | null, status: GrowthSessionRow['status'] = 'completed', extra: Partial<GrowthSessionRow> = {}) => ({ routine_id: 'a', session_date: date, status, started_at: clock === null ? null : `${date}T${clock}:00+09:00`, ended_at: null, ...extra } as GrowthSessionRow);
const summarize = (rows: GrowthSessionRow[]) => summarizeGrowthTimePatterns(rows, 'a', summarizeGrowthPatterns(rows, 'a', '2026-09-17').days);

test('explicit offsets resolve Korean clock boundaries independently of machine timezone', () => {
  const rows = ['00:00','05:59','06:00','11:59','12:00','17:59','18:00','23:59'].map((clock, i) => row(`2026-09-${String(i + 1).padStart(2,'0')}`, clock));
  const expected = summarize(rows);
  assert.deepEqual(expected.groups.map(group => group.recorded), [2,2,2,2]);
  const utc = rows.map(session => ({...session, started_at: new Date(session.started_at!).toISOString()}));
  assert.deepEqual(summarize(utc), expected);
  assert.equal(summarize([row('2026-09-16','08:00','completed',{started_at:'2026-09-15T23:00:00.123456+00:00'})]).groups[1].recorded,1);
});

test('winning status cannot borrow a lower status clock and conflicting starts stay unconfirmed', () => {
  const rows = [row('2026-09-16','08:00','stopped'), row('2026-09-16',null), row('2026-09-15','08:00'), row('2026-09-15','20:00'), row('2026-09-14','08:00'), row('2026-09-14','09:00'), row('2026-09-14','20:00','stopped')];
  const result = summarize(rows);
  assert.equal(result.recorded,1); assert.equal(result.unconfirmed,2);
  assert.equal(result.evidence[0].reason,'시각 미기록'); assert.equal(result.evidence[1].reason,'여러 시간대');
  assert.equal(result.evidence[2].clock,'08:00 외 1개 시각');
  assert.deepEqual(summarize([...rows].reverse()),result);
});

test('missing and malformed times never fall back to creation, end time or duration', () => {
  const rows = [
    row('2026-09-16',null,'completed',{created_at:'2026-09-16T08:00:00+09:00',ended_at:'2026-09-16T09:00:00+09:00',actual_minutes:60}),
    row('2026-09-15','08:00','completed',{started_at:'2026-09-15T08:00:00'}),
    row('2026-09-14','08:00','completed',{started_at:'2026-02-30T08:00:00Z'}),
    row('2026-09-13','24:00'),
    row('2026-09-12','08:00','completed',{ended_at:'2026-09-12T07:59:00+09:00'}),
    row('2026-09-11','08:00','completed',{ended_at:'invalid'}),
    row('2026-09-10','08:00','completed',{started_at:'2026-09-09T23:59:00+09:00'}),
  ];
  const result = summarize(rows);
  assert.equal(result.recorded,0); assert.equal(result.unconfirmed,7);
  assert.equal(result.evidence.at(-1)?.reason,'시작 날짜 다름');
  assert.equal(result.evidence.filter(day=>day.reason==='시각 확인 필요').length,5);
});

test('the shared 28-day selection excludes today, old dates, other routines and invalid statuses without writes', () => {
  const rows = [row('2026-08-20','08:00'),row('2026-08-19','08:00'),row('2026-09-17','08:00'),row('2026-09-18','08:00'),row('2026-09-16','08:00','completed',{routine_id:'b'}),row('2026-09-16','08:00','invalid' as never)];
  const before = JSON.stringify(rows);
  assert.equal(summarize(rows).recorded,1); assert.equal(JSON.stringify(rows),before);
});

test('comparison needs four distinct days in each eligible slot, not repeated sessions', () => {
  const rows = Array.from({length:8},(_,i)=>row(`2026-09-0${i+1}`,i<4?'08:00':'20:00',i<4?'stopped':'completed'));
  assert.match(summarize(rows).suggestion,/저녁의 기록일/);
  assert.match(summarize([...rows.slice(0,7),...Array.from({length:10},()=>rows[6])]).suggestion,/각각 4일 이상/);
  assert.match(summarize(rows.map(session=>({...session,status:'completed'}))).suggestion,/차이가 크지/);
});

test('empty and unconfirmed days never become failed mornings or recommendations', () => {
  assert.equal(summarize([]).recorded,0);
  const result=summarize(Array.from({length:8},(_,i)=>row(`2026-09-0${i+1}`,null)));
  assert.equal(result.unconfirmed,8);
  assert.ok(result.groups.every(group=>group.recorded===0 && group.stopped===0));
  assert.match(result.suggestion,/기록일이 각각 4일 이상/);
});
