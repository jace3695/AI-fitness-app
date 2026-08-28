import { getWorkoutRecord, isWorkoutPerformed } from "./workoutCompletion.ts";
import type {
  ExerciseRecord,
  WorkoutCompletionStore,
  WorkoutCompletionValue,
} from "./workoutCompletion.ts";
import { getMonthDateKeys } from "./recordStorage.ts";
import type {
  DailyConditionStore,
  InbodyRecordStore,
  WeightRecordStore,
} from "./recordStorage.ts";
import type { ConditionSignalId } from "./recoveryMode.ts";

export interface TrendPoint {
  dateKey: string;
  value: number;
}

export interface WeeklyActivity {
  label: string;
  startKey: string;
  endKey: string;
  workoutDays: number;
  minutes: number;
}

export interface ExerciseProgressItem {
  exerciseName: string;
  metricLabel: string;
  unit: string;
  previousValue?: number;
  latestValue: number;
  latestDateKey: string;
}

export interface RecentConditionSummary {
  recordedDays: number;
  normalDays: number;
  adjustedDays: number;
  recoveryDays: number;
  topSignals: { signal: ConditionSignalId; count: number }[];
}

export interface BodyPartSetItem {
  bodyPart: "코어" | "하체" | "등" | "가슴·어깨" | "전신·유산소" | "기타";
  sets: number;
}

const BODY_PART_RULES: { bodyPart: BodyPartSetItem["bodyPart"]; keywords: string[] }[] = [
  { bodyPart: "코어", keywords: ["버드독", "데드버그", "플랭크", "복부", "코어", "골반 기울", "AB 슬라이더"] },
  { bodyPart: "하체", keywords: ["스쿼트", "런지", "사이드워크", "몬스터워크", "종아리", "하체", "엉덩이"] },
  { bodyPart: "등", keywords: ["로우", "랫풀", "풀다운", "풀어파트", "페이스풀", "턱걸이", "매달리기", "철봉"] },
  { bodyPart: "가슴·어깨", keywords: ["프레스", "푸시업", "가슴", "어깨"] },
  { bodyPart: "전신·유산소", keywords: ["슬라이딩보드", "걷기", "산책", "자전거", "유산소", "몸풀기", "정리운동", "폼롤러"] },
];

function getBodyPart(exerciseName: string): BodyPartSetItem["bodyPart"] {
  return BODY_PART_RULES.find((rule) => rule.keywords.some((keyword) => exerciseName.includes(keyword)))?.bodyPart ?? "기타";
}

function getCompletedSets(record: ExerciseRecord) {
  return (record.sets ?? []).filter((set) => set.completed);
}

function getSetReps(set: NonNullable<ExerciseRecord["sets"]>[number]) {
  if (set.leftReps !== undefined || set.rightReps !== undefined) return (set.leftReps ?? 0) + (set.rightReps ?? 0);
  return set.reps ?? 0;
}

function getRecordTrainingTotals(record: ExerciseRecord) {
  const sets = getCompletedSets(record);
  return sets.reduce(
    (total, set) => {
      const reps = getSetReps(set);
      return {
        completedSets: total.completedSets + 1,
        totalReps: total.totalReps + reps,
        volumeKg: total.volumeKg + (set.weightKg !== undefined && reps > 0 ? set.weightKg * reps : 0),
      };
    },
    { completedSets: 0, totalReps: 0, volumeKg: 0 },
  );
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

export function getRecentConditionSummary(
  conditions: DailyConditionStore,
  baseDate = new Date(),
  dayCount = 7,
): RecentConditionSummary {
  const keys = Array.from({ length: dayCount }, (_, index) =>
    toDateKey(addDays(baseDate, index - dayCount + 1)),
  );
  const records = keys.flatMap((key) =>
    conditions[key] ? [conditions[key]] : [],
  );
  const signalCounts = new Map<ConditionSignalId, number>();

  records.forEach((record) => {
    record.signals.forEach((signal) => {
      signalCounts.set(signal, (signalCounts.get(signal) ?? 0) + 1);
    });
  });

  return {
    recordedDays: records.length,
    normalDays: records.filter((record) => record.recommendation === "normal")
      .length,
    adjustedDays: records.filter((record) => record.recommendation === "70%")
      .length,
    recoveryDays: records.filter(
      (record) => record.recommendation === "recovery",
    ).length,
    topSignals: Array.from(signalCounts, ([signal, count]) => ({
      signal,
      count,
    }))
      .sort((a, b) => b.count - a.count || a.signal.localeCompare(b.signal))
      .slice(0, 3),
  };
}

function getSessionMinutes(value?: WorkoutCompletionValue) {
  if (typeof value !== "object" || !value) return 0;
  const memoMatch = value.workoutMemo?.match(
    /\[따라하기 세션\]\s*(\d+)\s*분/,
  );
  if (memoMatch) return Number(memoMatch[1]);

  const exerciseMinutes = (value.workoutExerciseRecords ?? []).reduce(
    (total, exercise) => {
      if (exercise.status === "skipped" || exercise.status === "pending")
        return total;
      if (exercise.durationMinutes !== undefined)
        return total + exercise.durationMinutes;
      const seconds = (exercise.sets ?? []).reduce(
        (setTotal, set) =>
          setTotal + (set.completed ? set.durationSeconds ?? 0 : 0),
        0,
      );
      return total + seconds / 60;
    },
    0,
  );

  if (exerciseMinutes > 0) return Math.round(exerciseMinutes);
  return Math.round(
    (value.cardioMinutes ?? 0) +
      (value.rosaryCardioMinutes ?? 0) +
      (value.postWorkoutCardioMinutes ?? 0),
  );
}

export function getWorkoutMinutes(value?: WorkoutCompletionValue) {
  return getSessionMinutes(value);
}

export function getPainScore(value?: WorkoutCompletionValue) {
  if (typeof value !== "object" || !value) return undefined;
  const scores = (value.workoutExerciseRecords ?? [])
    .map((record) => record.painScore)
    .filter((score): score is number => score !== undefined && score > 0);
  if (!scores.length) return undefined;
  return (
    Math.round(
      (scores.reduce((total, score) => total + score, 0) / scores.length) * 10,
    ) / 10
  );
}

function hasPain(value?: WorkoutCompletionValue) {
  if (typeof value !== "object" || !value) return false;
  return Boolean(
    value.workoutPain ||
      value.pullupPain ||
      value.foamRollerPain ||
      (value.workoutExerciseRecords ?? []).some(
        (record) => (record.painScore ?? 0) > 0,
      ),
  );
}

export function getWeeklyActivity(
  workouts: WorkoutCompletionStore,
  baseDate = new Date(),
  weekCount = 6,
) {
  const endOfCurrentWeek = addDays(baseDate, 6 - baseDate.getDay());
  return Array.from({ length: weekCount }, (_, index) => {
    const weekOffset = index - (weekCount - 1);
    const end = addDays(endOfCurrentWeek, weekOffset * 7);
    const start = addDays(end, -6);
    const keys = Array.from({ length: 7 }, (__, dayIndex) =>
      toDateKey(addDays(start, dayIndex)),
    );
    return {
      label: `${start.getMonth() + 1}/${start.getDate()}`,
      startKey: keys[0],
      endKey: keys[6],
      workoutDays: keys.filter((key) => {
        const record = getWorkoutRecord(workouts[key]);
        return Boolean(
          isWorkoutPerformed(workouts[key]) || record.cardioDone || record.pullupDone,
        );
      }).length,
      minutes: keys.reduce(
        (total, key) => total + getSessionMinutes(workouts[key]),
        0,
      ),
    } satisfies WeeklyActivity;
  });
}

export function getMonthlyWorkoutStats(
  workouts: WorkoutCompletionStore,
  year: number,
  monthIndex: number,
) {
  const keys = getMonthDateKeys(year, monthIndex);
  const exerciseRecords = keys.flatMap((key) => {
    const record = getWorkoutRecord(workouts[key]);
    return record.workoutExerciseRecords ?? [];
  });
  const decidedRecords = exerciseRecords.filter(
    (record) => record.status !== "pending",
  );
  const completedRecords = decidedRecords.filter(
    (record) => record.status === "completed",
  );
  const trainingTotals = exerciseRecords.reduce(
    (total, record) => {
      const next = getRecordTrainingTotals(record);
      return {
        completedSets: total.completedSets + next.completedSets,
        totalReps: total.totalReps + next.totalReps,
        volumeKg: total.volumeKg + next.volumeKg,
      };
    },
    { completedSets: 0, totalReps: 0, volumeKg: 0 },
  );
  return {
    workoutDays: keys.filter((key) => {
      const record = getWorkoutRecord(workouts[key]);
      return Boolean(isWorkoutPerformed(workouts[key]) || record.cardioDone || record.pullupDone);
    }).length,
    minutes: keys.reduce(
      (total, key) => total + getSessionMinutes(workouts[key]),
      0,
    ),
    completionRate: decidedRecords.length
      ? Math.round((completedRecords.length / decidedRecords.length) * 100)
      : undefined,
    painDays: keys.filter((key) => hasPain(workouts[key])).length,
    completedSets: trainingTotals.completedSets,
    totalReps: trainingTotals.totalReps,
    volumeKg: Math.round(trainingTotals.volumeKg * 10) / 10,
    activeExerciseCount: new Set(
      exerciseRecords
        .filter((record) => getCompletedSets(record).length > 0 || record.status === "completed")
        .map((record) => record.exerciseName),
    ).size,
  };
}

export function getBodyPartSetBreakdown(
  workouts: WorkoutCompletionStore,
  year: number,
  monthIndex: number,
): BodyPartSetItem[] {
  const counts = new Map<BodyPartSetItem["bodyPart"], number>();
  getMonthDateKeys(year, monthIndex).forEach((key) => {
    const record = getWorkoutRecord(workouts[key]);
    (record.workoutExerciseRecords ?? []).forEach((exercise) => {
      const completedSets = getCompletedSets(exercise).length;
      if (!completedSets) return;
      const bodyPart = getBodyPart(exercise.exerciseName);
      counts.set(bodyPart, (counts.get(bodyPart) ?? 0) + completedSets);
    });
  });
  return Array.from(counts, ([bodyPart, sets]) => ({ bodyPart, sets }))
    .sort((a, b) => b.sets - a.sets || a.bodyPart.localeCompare(b.bodyPart));
}

export function getBodyTrends(
  weights: WeightRecordStore,
  inbody: InbodyRecordStore,
  limit = 12,
) {
  const weight = Object.entries(weights)
    .filter(([, record]) => Number.isFinite(record.weight))
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-limit)
    .map(([dateKey, record]) => ({ dateKey, value: record.weight }));
  const bodyFat = Object.entries(inbody)
    .filter(([, record]) => Number.isFinite(record.bodyFatPercent))
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-limit)
    .map(([dateKey, record]) => ({
      dateKey,
      value: record.bodyFatPercent as number,
    }));
  const skeletalMuscle = Object.entries(inbody)
    .filter(([, record]) => Number.isFinite(record.skeletalMuscleMass))
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-limit)
    .map(([dateKey, record]) => ({
      dateKey,
      value: record.skeletalMuscleMass as number,
    }));
  return { weight, bodyFat, skeletalMuscle };
}

export function getPainTrend(
  workouts: WorkoutCompletionStore,
  limit = 12,
) {
  return Object.entries(workouts)
    .map(([dateKey, value]) => {
      const score = getPainScore(value);
      return score === undefined ? null : { dateKey, value: score };
    })
    .filter((point): point is TrendPoint => point !== null)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
    .slice(-limit);
}

function getMetric(record: ExerciseRecord) {
  const completedSets = (record.sets ?? []).filter((set) => set.completed);
  const maxWeight = Math.max(
    ...completedSets.map((set) => set.weightKg ?? Number.NEGATIVE_INFINITY),
  );
  if (Number.isFinite(maxWeight))
    return { label: "최대 중량", unit: "kg", value: maxWeight };
  const maxDuration = Math.max(
    ...completedSets.map(
      (set) => set.durationSeconds ?? Number.NEGATIVE_INFINITY,
    ),
  );
  if (Number.isFinite(maxDuration))
    return { label: "최장 시간", unit: "초", value: maxDuration };
  const maxLeftRightReps = Math.max(
    ...completedSets.map((set) =>
      Math.min(
        set.leftReps ?? Number.NEGATIVE_INFINITY,
        set.rightReps ?? Number.NEGATIVE_INFINITY,
      ),
    ),
  );
  if (Number.isFinite(maxLeftRightReps))
    return { label: "좌우 완료 횟수", unit: "회", value: maxLeftRightReps };
  const maxReps = Math.max(
    ...completedSets.map((set) => set.reps ?? Number.NEGATIVE_INFINITY),
  );
  if (Number.isFinite(maxReps))
    return { label: "최대 횟수", unit: "회", value: maxReps };
  if (record.distanceKm !== undefined)
    return { label: "이동 거리", unit: "km", value: record.distanceKm };
  if (record.stepCount !== undefined)
    return { label: "걸음 수", unit: "걸음", value: record.stepCount };
  if (record.intervalRounds !== undefined)
    return { label: "인터벌 반복", unit: "회", value: record.intervalRounds };
  if (record.durationMinutes !== undefined)
    return { label: "운동시간", unit: "분", value: record.durationMinutes };
  return undefined;
}

export function getExerciseProgress(
  workouts: WorkoutCompletionStore,
  limit = 5,
) {
  const byExercise = new Map<
    string,
    { dateKey: string; label: string; unit: string; value: number }[]
  >();

  Object.entries(workouts)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([dateKey, value]) => {
      const record = getWorkoutRecord(value);
      const dailyMetrics = new Map<string, { label: string; unit: string; value: number }>();
      (record.workoutExerciseRecords ?? []).forEach((exercise) => {
        if (
          exercise.status !== "completed" &&
          exercise.status !== "partial"
        )
          return;
        if (
          exercise.status === "partial" &&
          !(exercise.sets ?? []).some((set) => set.completed)
        )
          return;
        const metric = getMetric(exercise);
        if (!metric) return;
        const metricKey = `${exercise.exerciseName}\u0000${metric.label}\u0000${metric.unit}`;
        const existing = dailyMetrics.get(metricKey);
        if (!existing || metric.value > existing.value) dailyMetrics.set(metricKey, metric);
      });
      dailyMetrics.forEach((metric, metricKey) => {
        const exerciseName = metricKey.split("\u0000", 1)[0];
        const current = byExercise.get(exerciseName) ?? [];
        current.push({ dateKey, ...metric });
        byExercise.set(exerciseName, current);
      });
    });

  return Array.from(byExercise.entries())
    .map(([exerciseName, records]) => {
      const latest = records[records.length - 1];
      const previous = [...records]
        .reverse()
        .slice(1)
        .find(
          (record) =>
            record.label === latest.label && record.unit === latest.unit,
        );
      return {
        exerciseName,
        metricLabel: latest.label,
        unit: latest.unit,
        previousValue: previous?.value,
        latestValue: latest.value,
        latestDateKey: latest.dateKey,
      } satisfies ExerciseProgressItem;
    })
    .sort((a, b) => b.latestDateKey.localeCompare(a.latestDateKey))
    .slice(0, limit);
}

export function formatShortDate(dateKey: string) {
  const date = parseDateKey(dateKey);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
