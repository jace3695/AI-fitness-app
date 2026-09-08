import { getBodyPartSetBreakdown, getBodyTrends, getLongTermWorkoutSummary, getMonthlyWorkoutStats, getPainScore, getRecentConditionSummary, getWeeklyActivity } from "./recordAnalytics.ts";
import { getWorkoutRecord, isWorkoutPerformed } from "./workoutCompletion.ts";
import type { RecordStores } from "./recordStorage.ts";
import { getWeightManagementSummary } from "./weightManagement.ts";
import { getLocalDateKey } from "./dietPlans.ts";
import { CURRENT_WEIGHT_BASELINE_KG } from "./currentWorkoutDirection.ts";
import { isRecentTrainingDate } from './workoutAdaptiveReview.ts';

export type FitnessAiSnapshot = ReturnType<typeof buildFitnessAiSnapshot>;

export function buildFitnessAiSnapshot(stores: RecordStores, now = new Date()) {
  const generatedFor = getLocalDateKey(now);
  const workoutEntries = Object.entries(stores.workouts).filter(([date]) => isRecentTrainingDate(date, generatedFor)).sort(([a], [b]) => b.localeCompare(a));
  const recentSessions = workoutEntries.map(([date, value]) => {
    const record = getWorkoutRecord(value);
    return {
      date,
      groupId: record.workoutGroupId ?? null,
      performed: isWorkoutPerformed(value),
      routine: record.workoutRoutineName || record.workoutPlanName || "미기록",
      status: record.workoutStatus || (record.workoutDone ? "completed" : "unknown"),
      difficulty: record.workoutDifficulty || "unknown",
      fatigue: record.workoutFatigue ?? null,
      method: record.workoutMethod ?? null,
      recordedAt: record.workoutRecordedAt ?? null,
      pain: Boolean(record.workoutPain || record.workoutBackStatus === "pain" || record.workoutBackStatus === "worse" || record.workoutNeurologicalSymptoms?.length || record.pullupPain || record.foamRollerPain),
      painScore: getPainScore(value) ?? null,
      backStatus: record.workoutBackStatus ?? (record.workoutPain ? "pain" : "unknown"),
      neurologicalSymptoms: record.workoutNeurologicalSymptoms ?? [],
      painExercise: record.workoutPainExercise ?? null,
      painSet: record.workoutPainSet ?? null,
      exercises: (record.workoutExerciseRecords ?? []).slice(0, 20).map((exercise) => ({
        name: exercise.exerciseName.slice(0, 60), status: exercise.status,
        sets: exercise.sets?.filter((set) => set.completed).length ?? 0,
        setDetails: (exercise.sets ?? []).slice(0, 8).map((set) => ({
          setNumber: set.setNumber,
          completed: set.completed,
          reps: set.reps ?? null,
          leftReps: set.leftReps ?? null,
          rightReps: set.rightReps ?? null,
          weightKg: set.weightKg ?? null,
          bandLevel: set.bandLevel ?? null,
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
  const longTerm = getLongTermWorkoutSummary(stores.workouts, now);
  const weightManagement = getWeightManagementSummary(
    stores.weights,
    stores.inbody,
    stores.weightGoal,
    generatedFor,
  );
  const targetWeightKg =
    Math.round(((stores.weightGoal.minKg + stores.weightGoal.maxKg) / 2) * 10) /
    10;
  return {
    generatedFor,
    goal: "체지방 감량과 근육 유지·소폭 증가, 허리 안전 우선",
    profile: {
      heightCm: 168.5,
      currentWeightKg: weightManagement.latest?.value ?? CURRENT_WEIGHT_BASELINE_KG,
      currentWeightSource: weightManagement.latest ? "record" : "user-provided-baseline",
      targetWeightKg,
      targetWeightRangeKg: [stores.weightGoal.minKg, stores.weightGoal.maxKg],
      constraints: ["허리 디스크 이력", "허리 악화·방사통·저림·감각 저하·다리 힘 빠짐 시 강도 상승 금지", "단기 급감량 권장 금지"],
    },
    currentProgram: {
      structure: "월·수·금 전신 근력 서킷 / 화·목 회복형 전신 서킷 / 주말 회복 중심",
      strengthDays: { days: ["mon", "wed", "fri"], durationMinutes: "25~35", rounds: 3, intensity: "medium" },
      recoveryDays: { days: ["tue", "thu"], durationMinutes: "10~20", rounds: "1~2", startingRounds: 1, intensity: "low" },
      saturday: "휴식 우선, 컨디션에 따라 걷기·스트레칭·가동성 선택",
      excludedFromCurrentRoutine: ["슬라이딩보드"],
      evaluationAxes: ["체중 추세", "체지방", "근력·반복수", "운동 완료율", "허리 상태", "컨디션", "피로"],
      progressionRule: "최근 비교 가능한 근력 수행·허리 상태·피로를 보고 유지·증가·교체·감소 제안. 운동 홈에서 변경 내용 확인 후 적용. 회복일의 쉬운 수행이나 달력 경과만으로 증가하지 않음",
      laterAlternatives: ['지지형 햄스트링 컬', '밴드 팔로프 프레스'],
    },
    monthly,
    bodyPartSets,
    condition,
    weekly,
    body,
    weightManagement,
    longTerm,
    recentSessions,
  };
}
