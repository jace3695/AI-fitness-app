import { getBodyPartSetBreakdown, getBodyTrends, getMonthlyWorkoutStats, getPainScore, getRecentConditionSummary, getWeeklyActivity } from "./recordAnalytics.ts";
import { getWorkoutRecord, isWorkoutPerformed } from "./workoutCompletion.ts";
import type { RecordStores } from "./recordStorage.ts";

export type FitnessAiSnapshot = ReturnType<typeof buildFitnessAiSnapshot>;

export function buildFitnessAiSnapshot(stores: RecordStores, now = new Date()) {
  const workoutEntries = Object.entries(stores.workouts).sort(([a], [b]) => b.localeCompare(a)).slice(0, 28);
  const recentSessions = workoutEntries.map(([date, value]) => {
    const record = getWorkoutRecord(value);
    return {
      date,
      performed: isWorkoutPerformed(value),
      routine: record.workoutRoutineName || record.workoutPlanName || "미기록",
      status: record.workoutStatus || (record.workoutDone ? "completed" : "unknown"),
      difficulty: record.workoutDifficulty || "unknown",
      fatigue: record.workoutFatigue ?? null,
      method: record.workoutMethod ?? null,
      recordedAt: record.workoutRecordedAt ?? null,
      pain: Boolean(record.workoutPain || record.pullupPain || record.foamRollerPain),
      painScore: getPainScore(value) ?? null,
      exercises: (record.workoutExerciseRecords ?? []).slice(0, 15).map((exercise) => ({
        name: exercise.exerciseName.slice(0, 60), status: exercise.status,
        sets: exercise.sets?.filter((set) => set.completed).length ?? 0,
        setDetails: (exercise.sets ?? []).slice(0, 8).map((set) => ({
          setNumber: set.setNumber,
          completed: set.completed,
          reps: set.reps ?? null,
          leftReps: set.leftReps ?? null,
          rightReps: set.rightReps ?? null,
          weightKg: set.weightKg ?? null,
          durationSeconds: set.durationSeconds ?? null,
          restAfterSeconds: set.restAfterSeconds ?? null,
          plannedReps: set.plannedReps ?? null,
          plannedDurationSeconds: set.plannedDurationSeconds ?? null,
          plannedRestSeconds: set.plannedRestSeconds ?? null,
        })),
        maxReps: Math.max(0, ...(exercise.sets ?? []).map((set) => set.reps ?? set.leftReps ?? 0)),
        maxWeightKg: Math.max(0, ...(exercise.sets ?? []).map((set) => set.weightKg ?? 0)),
        minutes: exercise.durationMinutes ?? null,
        painScore: exercise.painScore ?? null,
      })),
    };
  });
  const body = getBodyTrends(stores.weights, stores.inbody, 8);
  const weekly = getWeeklyActivity(stores.workouts, now, 8);
  const condition = getRecentConditionSummary(stores.conditions, now, 14);
  const monthly = getMonthlyWorkoutStats(stores.workouts, now.getFullYear(), now.getMonth());
  const bodyPartSets = getBodyPartSetBreakdown(stores.workouts, now.getFullYear(), now.getMonth());
  return {
    generatedFor: now.toISOString().slice(0, 10),
    goal: "체지방 감량과 근육 유지·소폭 증가, 허리 안전 우선",
    profile: { heightCm: 168.5, targetWeightKg: 66, constraints: ["허리 디스크 이력", "통증·다리 저림 시 즉시 중단", "최근 운동 재시작 단계"] },
    monthly,
    bodyPartSets,
    condition,
    weekly,
    body,
    recentSessions,
  };
}
