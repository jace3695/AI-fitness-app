import assert from "node:assert/strict";
import test from "node:test";
import { getBodyPartSetBreakdown, getExerciseProgress, getLongTermWorkoutSummary, getMonthlyWorkoutStats } from "./recordAnalytics.ts";
import type { WorkoutCompletionStore } from "./workoutCompletion.ts";

const workouts: WorkoutCompletionStore = {
  "2026-08-10": {
    workoutDone: true,
    workoutExerciseRecords: [
      { exerciseName: "덤벨 고블릿 스쿼트", status: "completed", sets: [
        { setNumber: 1, completed: true, reps: 10, weightKg: 7 },
        { setNumber: 2, completed: true, reps: 8, weightKg: 7 },
      ] },
      { exerciseName: "버드독", status: "completed", sets: [{ setNumber: 1, completed: true, leftReps: 6, rightReps: 6 }] },
    ],
  },
  "2026-08-17": {
    workoutDone: true,
    workoutMethod: { method: "circuit", rounds: 2, restSeconds: 60, workSeconds: 30 },
    workoutExerciseRecords: [
      { exerciseName: "덤벨 고블릿 스쿼트", status: "completed", sets: [{ setNumber: 1, completed: true, reps: 10, weightKg: 8 }], executionContext: { method: "circuit", sourceExerciseIndex: 0, sequenceIndex: 0, roundNumber: 1 } },
      { exerciseName: "덤벨 고블릿 스쿼트", status: "completed", sets: [{ setNumber: 1, completed: true, reps: 9, weightKg: 8 }], executionContext: { method: "circuit", sourceExerciseIndex: 0, sequenceIndex: 1, roundNumber: 2 } },
    ],
  },
};

test("월간 실제 세트·반복·중량 볼륨을 완료 세트만으로 계산한다", () => {
  const stats = getMonthlyWorkoutStats(workouts, 2026, 7);
  assert.equal(stats.completedSets, 5);
  assert.equal(stats.totalReps, 49);
  assert.equal(stats.volumeKg, 278);
  assert.equal(stats.activeExerciseCount, 2);
});

test("부위별 세트는 서킷 라운드도 실제 수행 세트로 합산한다", () => {
  assert.deepEqual(getBodyPartSetBreakdown(workouts, 2026, 7), [
    { bodyPart: "하체", sets: 4 },
    { bodyPart: "코어", sets: 1 },
  ]);
});

test("같은 날짜의 서킷 라운드는 성장 비교의 직전 날짜로 취급하지 않는다", () => {
  const progress = getExerciseProgress(workouts, 10);
  const squat = progress.find((item) => item.exerciseName === "덤벨 고블릿 스쿼트");
  assert.equal(squat?.latestValue, 8);
  assert.equal(squat?.previousValue, 7);
  assert.equal(squat?.latestDateKey, "2026-08-17");
});

test("장기 요약은 최근 28일과 직전 28일을 같은 기준으로 비교한다", () => {
  const longTermWorkouts: WorkoutCompletionStore = {
    "2026-07-10": workouts["2026-08-10"],
    "2026-08-17": workouts["2026-08-17"],
  };
  const summary = getLongTermWorkoutSummary(
    longTermWorkouts,
    new Date("2026-08-24T12:00:00Z"),
  );
  assert.equal(summary.totalWorkoutDays, 2);
  assert.equal(summary.previous28Days.workoutDays, 1);
  assert.equal(summary.recent28Days.workoutDays, 1);
  assert.equal(summary.changes.workoutDays, 0);
  assert.equal(summary.recent28Days.completedSets, 2);
  assert.equal(summary.previous28Days.completedSets, 3);
  assert.equal(summary.changes.completedSets, -1);
  assert.equal(summary.weekly.length, 12);
  assert.equal(summary.exerciseProgress[0].latestDateKey, "2026-08-17");
});
