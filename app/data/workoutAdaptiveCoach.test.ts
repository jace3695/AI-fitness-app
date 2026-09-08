import assert from "node:assert/strict";
import test from "node:test";
import { buildAdaptiveCoachAdvice } from "./workoutAdaptiveCoach.ts";
import type { WorkoutCompletionStore } from "./workoutCompletion.ts";

const easyRecord = (date: string) => ({
  date,
  value: {
    workoutDone: true,
    workoutStatus: "completed" as const,
    workoutDifficulty: "easy" as const,
    workoutFatigue: 2,
    workoutBackStatus: "none" as const,
  },
});

test("기록이 없으면 제공된 86kg을 기준값으로만 사용한다", () => {
  const advice = buildAdaptiveCoachAdvice({});
  assert.equal(advice.state, "insufficient");
  assert.equal(advice.currentWeightKg, 86);
  assert.equal(advice.weightSource, "provided-baseline");
});

test("완료 표시만 있고 비교할 근력·반복수 기록이 없으면 증가하지 않는다", () => {
  const workouts = Object.fromEntries([
    easyRecord("2026-09-01"),
    easyRecord("2026-09-03"),
    easyRecord("2026-09-05"),
  ].map((entry) => [entry.date, entry.value])) as WorkoutCompletionStore;
  const advice = buildAdaptiveCoachAdvice(workouts, {}, '2026-09-07');
  assert.equal(advice.state, "maintain");
});

test("허리 악화나 신경 증상이 있으면 강도 상승을 막고 의료 평가를 안내한다", () => {
  const advice = buildAdaptiveCoachAdvice({
    "2026-09-05": {
      workoutDone: false,
      workoutStatus: "stopped",
      workoutBackStatus: "worse",
      workoutNeurologicalSymptoms: ["leg-weakness"],
    },
  }, {}, '2026-09-07');
  assert.equal(advice.state, "safety-hold");
  assert.match(advice.nextAction, /의료 평가/);
});

test("체중 하락과 수행 저하·높은 피로가 겹치면 감량과 회복을 재검토한다", () => {
  const workouts: WorkoutCompletionStore = {
    "2026-09-01": { workoutDone: true, workoutGroupId: "current-fullbody-strength-circuit", workoutStatus: "completed", workoutFatigue: 2, workoutExerciseRecords: [{ exerciseName: "밴드 로우", status: "completed", sets: [{ setNumber: 1, completed: true, reps: 12 }, { setNumber: 2, completed: true, reps: 12 }, { setNumber: 3, completed: true, reps: 12 }] }] },
    "2026-09-05": { workoutDone: false, workoutGroupId: "current-fullbody-strength-circuit", workoutStatus: "partial", workoutFatigue: 4, workoutExerciseRecords: [{ exerciseName: "밴드 로우", status: "partial", sets: [{ setNumber: 1, completed: true, reps: 8 }] }] },
  };
  const advice = buildAdaptiveCoachAdvice(workouts, {
    "2026-08-26": { weight: 87, recordedAt: "2026-08-26T00:00:00.000Z" },
    "2026-08-28": { weight: 87, recordedAt: "2026-08-28T00:00:00.000Z" },
    "2026-09-01": { weight: 86, recordedAt: "2026-09-01T00:00:00.000Z" },
    "2026-09-05": { weight: 86, recordedAt: "2026-09-05T00:00:00.000Z" },
  }, '2026-09-07');
  assert.equal(advice.state, "recovery");
  assert.match(advice.weightAssessment, /감량 속도와 회복 상태/);
});
