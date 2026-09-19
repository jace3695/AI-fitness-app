import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGrowthComparison,
  buildLocalGrowthCoach,
  calculateTypingMetrics,
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
