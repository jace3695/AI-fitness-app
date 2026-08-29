import assert from "node:assert/strict";
import test from "node:test";
import {
  readWorkoutPlanDecisionHistory,
  saveWorkoutPlanDecision,
  WORKOUT_PLAN_DECISION_HISTORY_KEY,
} from "./workoutPlanDecision.ts";
import type { WorkoutPlanProposal } from "./workoutPlanProposal.ts";

const proposal: WorkoutPlanProposal = {
  title: "다음 주 안전 계획",
  summary: "허리 안전 우선",
  days: [
    { dayId: "mon", groupId: "core", method: { method: "standard", rounds: 1, restSeconds: 60, workSeconds: 30 }, reason: "코어" },
    { dayId: "tue", groupId: "rest", method: { method: "free", rounds: 1, restSeconds: 0, workSeconds: 30 }, reason: "회복" },
  ],
  exerciseTargets: [
    { exerciseName: "버드독", sets: 2, reps: 6, reason: "안전" },
  ],
  changes: ["화요일 회복"],
  cautions: [],
};

test("브라우저가 아니면 계획 결정 기록은 안전하게 비어 있다", () => {
  assert.deepEqual(readWorkoutPlanDecisionHistory(), []);
  assert.doesNotThrow(() => saveWorkoutPlanDecision("kept", proposal));
  assert.equal(typeof WORKOUT_PLAN_DECISION_HISTORY_KEY, "string");
});
