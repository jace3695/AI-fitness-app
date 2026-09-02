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
