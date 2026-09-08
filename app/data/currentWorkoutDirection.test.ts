import assert from "node:assert/strict";
import test from "node:test";
import { buildCurrentWorkoutSettings, CURRENT_WEEKLY_GROUPS, CURRENT_WEEKLY_METHODS } from "./currentWorkoutDirection.ts";

test("현재 운동 방향으로 이전하면 개인 기록 목표는 보존하고 주간 루틴만 정확히 갱신한다", () => {
  const result = buildCurrentWorkoutSettings({
    weeklyGroups: { mon: "cardio-back-basic" },
    weeklyMethods: { mon: { method: "standard", rounds: 1, restSeconds: 10, workSeconds: 20 } },
    weeklyEdits: { mon: { customExercises: [{ id: "old", name: "이전 운동" }] } },
    dateOverrides: { "2026-09-08": { groupId: "cardio-back-basic" } },
    exerciseTargets: { "밴드 로우": { reps: 12 } },
  });

  assert.deepEqual(result.weeklyGroups, CURRENT_WEEKLY_GROUPS);
  assert.deepEqual(result.weeklyMethods, CURRENT_WEEKLY_METHODS);
  assert.deepEqual(result.weeklyEdits, {});
  assert.deepEqual(result.dateOverrides, {});
  assert.deepEqual(result.exerciseTargets, { "밴드 로우": { reps: 12 } });
});
