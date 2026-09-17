import test from 'node:test';
import assert from 'node:assert/strict';
import { dietPatterns, dietPatternToday } from './dietPatterns.ts';

test('비교 기준 날짜는 기기 시간대와 관계없이 한국 자정에 바뀐다', () => {
  assert.equal(dietPatternToday(new Date('2026-09-16T14:59:59Z')), '2026-09-16');
  assert.equal(dietPatternToday(new Date('2026-09-16T15:00:00Z')), '2026-09-17');
});

test('28일 비교는 오늘 제외, 두 기간의 양 끝 포함, 윤년·잘못된 날짜 구분', () => {
  const yes = { digestionStatus: 'bloated', lateSnack: 'yes' };
  const result = dietPatterns({ '2024-03-01': yes, '2024-02-29': yes, '2024-02-02': yes, '2024-02-01': yes, '2024-01-05': yes, '2024-01-04': yes, '2024-02-30': yes }, '2024-03-01')!;
  assert.deepEqual(result.current.days.map(day => day.date), ['2024-02-29', '2024-02-02']);
  assert.deepEqual(result.previous.days.map(day => day.date), ['2024-02-01', '2024-01-05']);
  assert.equal(dietPatterns({}, '2023-02-29'), null);
});

test('미응답·잘못된 값은 지표별 분모에서 제외하고 아니요는 0으로 포함', () => {
  const data = { '2026-09-16': { digestionStatus: 'comfortable', lateSnack: 'yes' }, '2026-09-15': { digestionStatus: 'heartburn', lateSnack: 'no' }, '2026-09-14': { digestionStatus: 'corrupt', lateSnack: false }, '2026-09-13': { lateSnack: 'no' }, '2026-09-12': null, '2026-09-11': [] };
  const before = JSON.stringify(data);
  const result = dietPatterns(data, '2026-09-17')!;
  assert.deepEqual(result.current.digestion, { answers: 2, count: 1, rate: 50 });
  assert.deepEqual(result.current.lateSnack, { answers: 3, count: 1, rate: 33 });
  assert.equal(result.current.days.length, 4);
  assert.equal(result.digestionDelta, null);
  assert.equal(JSON.stringify(data), before);
});

test('응답 수가 다른 기간은 각 분모로 비교하고 7일 기준을 항목별로 적용', () => {
  const data = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`2026-09-${String(i + 1).padStart(2, '0')}`, { digestionStatus: i < 7 ? 'bloated' : 'comfortable', lateSnack: i < 6 ? 'yes' : 'unrecorded' }]));
  Object.assign(data, Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`2026-08-${String(i + 1).padStart(2, '0')}`, { digestionStatus: 'bloated', lateSnack: 'no' }])));
  const result = dietPatterns(data, '2026-09-17')!;
  assert.equal(result.digestionDelta, -50);
  assert.equal(result.lateSnackDelta, null);
  data['2026-09-07'].lateSnack = 'no';
  assert.equal(dietPatterns(data, '2026-09-17')!.lateSnackDelta, 86);
});

test('기록 없음은 0%가 아니라 비율 미기록이며 미래·오래된 기록을 넣어도 동일', () => {
  const result = dietPatterns({ '2026-09-18': { lateSnack: 'yes' }, '2001-01-02': { digestionStatus: 'bloated' } }, '2026-09-17')!;
  assert.equal(result.current.digestion.rate, null);
  assert.equal(result.previous.lateSnack.rate, null);
  assert.equal(result.lateSnackDelta, null);
  assert.deepEqual(result.current.days, []);
});
