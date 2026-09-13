import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFreeFitnessReport } from './freeFitnessReport.ts';

test('무료 운동 요약은 수행 기록만 집계하고 미응답 상태를 양호하다고 추정하지 않는다', () => {
  const result = buildFreeFitnessReport({ generatedFor: '2026-09-13', recentSessions: [
    { date: '2026-09-13', performed: true, status: 'completed', pain: true, fatigue: 4 },
    { date: '2026-09-07', performed: true, status: 'stopped', backStatus: 'unknown', fatigue: null },
    { date: '2026-09-14', performed: true }, { date: '2026-09-06', performed: true }, { date: '2026-09-12', performed: false },
  ] }, 'weekly');
  assert.match(result.overview, /2일/); assert.match(result.overview, /완료 기록은 1일/);
  assert.ok(result.cautions.some(item => item.includes('미응답 2일')));
  assert.ok(result.cautions.some(item => item.includes('통증 신호 1일')));
});

test('월간·장기 요약은 잘린 상세 목록 대신 각 기간의 집계를 사용한다', () => {
  const snapshot = { generatedFor: '2026-09-30', recentSessions: [], monthly: { workoutDays: 18 }, longTerm: { recent28Days: { workoutDays: 16 }, previous28Days: { workoutDays: 12 } } };
  assert.match(buildFreeFitnessReport(snapshot, 'monthly').overview, /18일/);
  assert.match(buildFreeFitnessReport(snapshot, 'longTerm').positives[0], /16일.*12일/);
  assert.match(buildFreeFitnessReport({}, 'latest').overview, /기록이 없어요/);
});
