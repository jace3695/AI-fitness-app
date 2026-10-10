import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGrowthComparison,
  buildLocalGrowthCoach,
  calculateTypingMetrics,
  GROWTH_STOP_REASONS,
  normalizeGrowthStopReason,
  sanitizeCoachSuggestions,
  summarizeGrowthPeriod,
  type GrowthRoutineRow,
  type GrowthSessionRow,
} from "./growthPlatform.ts";

const routine: GrowthRoutineRow = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "user",
  category: "typing",
  title: "타자",
  target_minutes: 10,
  preferred_days: [1, 3, 5],
  target_sessions_per_week: 3,
  enabled: true,
  sort_order: 0,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

function session(date: string, minutes: number, status: GrowthSessionRow["status"] = "completed"): GrowthSessionRow {
  return {
    id: `${date}-${minutes}`,
    user_id: "user",
    routine_id: routine.id,
    session_date: date,
    status,
    planned_minutes: 10,
    actual_minutes: minutes,
    memo: "",
    source: "manual",
    metrics: {},
    started_at: null,
    ended_at: null,
    created_at: `${date}T00:00:00Z`,
    updated_at: `${date}T00:00:00Z`,
  };
}

test("주간 요약은 범위 안 기록만 합산한다", () => {
  const result = summarizeGrowthPeriod([
    session("2026-09-02", 10),
    session("2026-09-01", 5, "partial"),
    session("2026-08-20", 99),
  ], "2026-09-02", 7);
  assert.equal(result.startDate, "2026-08-27");
  assert.equal(result.sessionCount, 2);
  assert.equal(result.activeDays, 2);
  assert.equal(result.totalMinutes, 15);
  assert.equal(result.completionRate, 50);
});

test("이전 기간과 현재 기간의 차이를 계산한다", () => {
  const result = buildGrowthComparison([
    session("2026-09-02", 20),
    session("2026-08-26", 5),
  ], "2026-09-02", 7);
  assert.equal(result.minuteDelta, 15);
  assert.equal(result.activeDayDelta, 0);
});

test("타자 정확도와 분당 타수를 계산한다", () => {
  assert.deepEqual(calculateTypingMetrics("가나다라", "가나마라", 30), {
    characters: 4,
    correctCharacters: 3,
    accuracy: 75,
    charactersPerMinute: 8,
  });
});

test("AI 제안은 루틴 ID와 시간 범위를 제한한다", () => {
  const result = sanitizeCoachSuggestions([{ id: "one", routineId: routine.id, title: " 줄이기 ", reason: " 부담 완화 ", recommendedMinutes: 999 }], new Set([routine.id]));
  assert.deepEqual(result, [{ id: "one", routineId: routine.id, title: "줄이기", reason: "부담 완화", recommendedMinutes: 240 }]);
});

test("AI가 없어도 기록 기반 주간 제안을 만든다", () => {
  const result = buildLocalGrowthCoach([routine], [], "2026-09-02");
  assert.equal(result.suggestions[0].routineId, routine.id);
  assert.equal(result.suggestions[0].recommendedMinutes, 10);
});

test('서로 다른 날 미완료가 반복되면 선택한 이유로 시간을 줄이되 자동 변경하지 않는다', () => {
  const target = { ...routine, target_minutes: 30 };
  const stopped = ['2026-09-01', '2026-09-02'].map(date => ({ ...session(date, 5, 'stopped'), metrics: { stopReason: 'tired' } }));
  const result = buildLocalGrowthCoach([target], stopped, '2026-09-02');
  assert.equal(result.suggestions[0].recommendedMinutes, 20);
  assert.match(result.suggestions[0].reason, /피곤했어요/);
  assert.equal(target.target_minutes, 30);
  const oneDay = buildLocalGrowthCoach([target], [stopped[0], { ...stopped[0], id: 'duplicate-day' }], '2026-09-02');
  assert.notEqual(oneDay.suggestions[0].id, 'local-reduce-load');
});

test('선택하지 않은 중단 이유는 추정하지 않고 미래·이전 주 기록은 제안에서 제외한다', () => {
  const result = buildLocalGrowthCoach([routine], [session('2026-09-01', 1, 'stopped'), session('2026-09-02', 1, 'partial'), { ...session('2026-09-03', 1, 'stopped'), metrics: { stopReason: 'tired' } }], '2026-09-02');
  assert.match(result.suggestions[0].reason, /이유는 기록되지 않아 추정하지/);
  assert.doesNotMatch(result.suggestions[0].reason, /피곤/);
});

test('중단 이유는 새 자기응답과 기존 키를 구분하고 알 수 없는 값은 미기록으로 읽는다', () => {
  const labels = {
    unrecorded: '선택 안 함', time: '시간이 부족했어요', tired: '피곤했어요',
    difficult: '너무 어려웠어요', distracted: '집중이 어려웠어요', interrupted: '다른 일이 생겼어요',
    illness: '몸이 아팠어요', forgot: '깜빡했어요', no_motivation: '의욕이 없었어요',
  };
  assert.deepEqual(GROWTH_STOP_REASONS, labels);
  for (const key of Object.keys(labels)) assert.equal(normalizeGrowthStopReason(key), key);
  for (const value of [undefined, null, '', 'unknown', 'constructor', 'toString', '__proto__', false, 0, {}, []]) {
    assert.equal(normalizeGrowthStopReason(value), 'unrecorded');
  }
});

for (const [reason, label] of [['illness', '몸이 아팠어요'], ['forgot', '깜빡했어요'], ['no_motivation', '의욕이 없었어요']]) {
  test(`무료 코칭은 ${reason} 자기응답만 설명하고 기존 기록·목표를 바꾸지 않는다`, () => {
    const target = { ...routine, target_minutes: 30 };
    const records = [
      { ...session('2026-09-01', 4, 'stopped'), metrics: { stopReason: reason, original: { keep: true } } },
      { ...session('2026-09-02', 3, 'partial'), metrics: { stopReason: reason } },
      { ...session('2026-09-03', 2, 'stopped'), metrics: { stopReason: 'tired' } },
      { ...session('2026-09-04', 1, 'stopped'), metrics: { stopReason: 'future-reason' } },
      session('2026-09-05', 0, 'stopped'),
    ];
    const before = JSON.stringify({ target, records });
    const result = buildLocalGrowthCoach([target], records, '2026-09-05');
    assert.deepEqual(result.suggestions[0], {
      id: 'local-reduce-load', routineId: target.id, title: '타자 목표 시간 줄여보기',
      reason: `서로 다른 5일에 미완료 기록이 있어요. 선택한 이유 중 ‘${label}’가 가장 많았어요.`,
      recommendedMinutes: 20,
    });
    assert.equal(JSON.stringify({ target, records }), before);
  });
}

test('미기록·알 수 없는 이유만 있는 기록에서는 새 중단 이유도 추정하지 않는다', () => {
  const records = [
    { ...session('2026-09-01', 1, 'stopped'), metrics: { stopReason: 'unknown' } },
    { ...session('2026-09-02', 1, 'partial'), metrics: { stopReason: 'unrecorded' } },
  ];
  const before = JSON.stringify(records);
  const result = buildLocalGrowthCoach([routine], records, '2026-09-02');
  assert.equal(result.suggestions[0].reason, '서로 다른 2일에 미완료 기록이 있어요. 이유는 기록되지 않아 추정하지 않아요.');
  assert.equal(JSON.stringify(records), before);
});

test('explicit time-unknown completions preserve activity while staying out of duration averages', () => {
  const known = session('2026-09-01', 20);
  const unknown = { ...session('2026-09-02', 0), metrics: { actualMinutesRecorded: false } };
  const result = summarizeGrowthPeriod([known, unknown], '2026-09-02', 7);
  assert.equal(result.activeDays, 2); assert.equal(result.completedCount, 2); assert.equal(result.completionRate, 100);
  assert.equal(result.totalMinutes, 20); assert.equal(result.recordedTimeDays, 1); assert.equal(result.unknownTimeSessions, 1);
  assert.equal(result.averageMinutesPerActiveDay, 20);
  assert.equal(buildGrowthComparison([known, unknown], '2026-09-02', 7).minuteDelta, null);
});
test('unknown-only duration stays unknown; actual zero and legacy unflagged minutes keep distinct meanings', () => {
  const unknown = { ...session('2026-09-02', 0), metrics: { actualMinutesRecorded: false } };
  const result = summarizeGrowthPeriod([unknown], '2026-09-02', 7);
  assert.equal(result.recordedTimeSessions, 0); assert.equal(result.averageMinutesPerActiveDay, null);
  const coach = buildLocalGrowthCoach([routine], [unknown], '2026-09-02');
  assert.match(coach.summary.overview, /실행 시간은 미기록/); assert.doesNotMatch(coach.summary.overview, /0분/);
  const zero = summarizeGrowthPeriod([session('2026-09-02', 0)], '2026-09-02', 7);
  assert.equal(zero.recordedTimeSessions, 1); assert.equal(zero.averageMinutesPerActiveDay, 0);
  const legacy = summarizeGrowthPeriod([session('2026-09-02', 15)], '2026-09-02', 7);
  assert.equal(legacy.totalMinutes, 15); assert.equal(legacy.unknownTimeSessions, 0);
});
test('even a nonzero sentinel with explicit unknown flag never contributes fabricated duration', () => {
  const unknown = { ...session('2026-09-02', 99), metrics: { actualMinutesRecorded: false } };
  const result = summarizeGrowthPeriod([unknown], '2026-09-02', 7);
  assert.equal(result.totalMinutes, 0); assert.equal(result.recordedTimeSessions, 0);
});
