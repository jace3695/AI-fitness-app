import assert from "node:assert/strict";
import test from "node:test";
import {
  formatGrowthPreferredDays,
  growthWeekStart,
  growthWeekdayForDateKey,
  isGrowthRoutineScheduled,
  normalizeGrowthPreferredDays,
  normalizeGrowthWeeklyTarget,
  summarizeGrowthRoutineWeek,
} from "./growthSchedule.ts";

const routine = {
  id: "routine-1",
  preferred_days: [1, 3, 5],
  target_sessions_per_week: 3,
};

test("기존 루틴의 일정값이 없으면 매일 7회로 호환한다", () => {
  assert.deepEqual(normalizeGrowthPreferredDays(undefined), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(normalizeGrowthWeeklyTarget(undefined, undefined), 7);
  assert.equal(formatGrowthPreferredDays(undefined), "매일");
});
test("요일은 중복과 범위를 정리하고 주간 목표는 선택 요일 수를 넘지 않는다", () => {
  assert.deepEqual(normalizeGrowthPreferredDays([5, 3, 3, 0, 8, "1"]), [1, 3, 5]);
  assert.equal(normalizeGrowthWeeklyTarget(7, [1, 3, 5]), 3);
  assert.equal(formatGrowthPreferredDays([1, 3, 5]), "월·수·금");
});

test("날짜의 ISO 요일과 월요일 시작 주간을 시간대와 무관하게 계산한다", () => {
  assert.equal(growthWeekdayForDateKey("2026-09-13"), 7);
  assert.equal(growthWeekdayForDateKey("2026-09-14"), 1);
  assert.equal(growthWeekStart("2026-09-17"), "2026-09-14");
  assert.equal(isGrowthRoutineScheduled(routine, "2026-09-16"), true);
  assert.equal(isGrowthRoutineScheduled(routine, "2026-09-17"), false);
});

test("주간 달성은 같은 날 중복 완료를 한 번만 계산한다", () => {
  const result = summarizeGrowthRoutineWeek(routine, [
    { routine_id: routine.id, session_date: "2026-09-14", status: "completed" },
    { routine_id: routine.id, session_date: "2026-09-14", status: "completed" },
    { routine_id: routine.id, session_date: "2026-09-16", status: "partial" },
    { routine_id: routine.id, session_date: "2026-09-11", status: "completed" },
  ], "2026-09-16");
  assert.deepEqual(result, {
    startDate: "2026-09-14",
    completed: 1,
    target: 3,
    remaining: 2,
    achieved: false,
    scheduledToday: true,
  });
});
