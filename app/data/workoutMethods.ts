import type { Exercise } from "./workouts";

export type WorkoutMethod = "standard" | "circuit" | "superset" | "interval" | "free";

export interface WorkoutMethodConfig {
  method: WorkoutMethod;
  rounds: number;
  restSeconds: number;
  workSeconds: number;
}

export const DEFAULT_WORKOUT_METHOD: WorkoutMethodConfig = {
  method: "standard",
  rounds: 3,
  restSeconds: 60,
  workSeconds: 30,
};

export const WORKOUT_METHOD_OPTIONS: { id: WorkoutMethod; label: string; description: string }[] = [
  { id: "standard", label: "일반 세트", description: "한 운동의 세트를 마친 뒤 다음 운동으로 이동" },
  { id: "circuit", label: "서킷", description: "선택한 본운동을 한 번씩 진행한 뒤 라운드 반복" },
  { id: "superset", label: "슈퍼세트", description: "본운동을 두 개씩 묶어 번갈아 진행" },
  { id: "interval", label: "인터벌", description: "운동 시간과 휴식 시간을 정해 반복" },
  { id: "free", label: "자유 운동", description: "정해진 방식 없이 현재 순서로 자유롭게 기록" },
];

export function normalizeWorkoutMethod(value?: Partial<WorkoutMethodConfig> | null): WorkoutMethodConfig {
  const validMethod = WORKOUT_METHOD_OPTIONS.some((option) => option.id === value?.method);
  const rounds = Number(value?.rounds);
  const restSeconds = Number(value?.restSeconds);
  const workSeconds = Number(value?.workSeconds);
  return {
    method: validMethod ? value!.method! : DEFAULT_WORKOUT_METHOD.method,
    rounds: Math.min(8, Math.max(1, Math.round(Number.isFinite(rounds) && rounds > 0 ? rounds : DEFAULT_WORKOUT_METHOD.rounds))),
    restSeconds: Math.min(300, Math.max(0, Math.round(Number.isFinite(restSeconds) ? restSeconds : DEFAULT_WORKOUT_METHOD.restSeconds))),
    workSeconds: Math.min(600, Math.max(10, Math.round(Number.isFinite(workSeconds) && workSeconds > 0 ? workSeconds : DEFAULT_WORKOUT_METHOD.workSeconds))),
  };
}

export function getWorkoutMethodLabel(method: WorkoutMethod) {
  return WORKOUT_METHOD_OPTIONS.find((option) => option.id === method)?.label || "일반 세트";
}

function withExecutionContext(
  exercise: Exercise,
  config: WorkoutMethodConfig,
  sourceExerciseIndex: number,
  sequenceIndex: number,
  extra?: { roundNumber?: number; groupNumber?: number },
): Exercise {
  return {
    ...exercise,
    executionContext: {
      method: config.method,
      sourceExerciseIndex,
      sequenceIndex,
      roundNumber: extra?.roundNumber,
      groupNumber: extra?.groupNumber,
      plannedSets: exercise.sets,
      plannedRestSeconds: config.method === "interval" ? config.restSeconds : exercise.restSeconds ?? config.restSeconds,
      plannedWorkSeconds: config.method === "interval" ? config.workSeconds : undefined,
    },
  };
}

function asSingleSet(exercise: Exercise, metaPrefix: string, restSeconds: number): Exercise {
  return {
    ...exercise,
    sets: exercise.sets ? 1 : exercise.sets,
    meta: [metaPrefix, exercise.meta].filter(Boolean).join(" · "),
    restSeconds,
  };
}

export function prepareMethodExercises(exercises: Exercise[], rawConfig?: Partial<WorkoutMethodConfig> | null): Exercise[] {
  const config = normalizeWorkoutMethod(rawConfig);
  if (config.method === "standard") return exercises.map((exercise, index) => withExecutionContext(exercise, config, index, index));
  if (config.method === "free") return exercises.map((exercise, index) => withExecutionContext({ ...exercise, restSeconds: 0 }, config, index, index));
  if (config.method === "interval") {
    return exercises.map((exercise, index) => withExecutionContext({
      ...exercise,
      sets: exercise.sets ? 1 : exercise.sets,
      meta: [`${config.workSeconds}초 운동 · ${config.restSeconds}초 휴식 × ${config.rounds}라운드`, exercise.meta].filter(Boolean).join(" · "),
      restSeconds: 0,
      intervalPlan: {
        rounds: config.rounds,
        segments: [
          { label: "운동", seconds: config.workSeconds, intensity: "자세 유지" },
          { label: "휴식", seconds: config.restSeconds, intensity: "호흡 정리" },
        ],
      },
    }, config, index, index));
  }
  if (config.method === "circuit") {
    let sequenceIndex = 0;
    return Array.from({ length: config.rounds }, (_, round) => exercises.map((exercise, index) =>
      withExecutionContext(
        asSingleSet(exercise, `${round + 1}/${config.rounds} 라운드`, index === exercises.length - 1 ? config.restSeconds : 0),
        config,
        index,
        sequenceIndex++,
        { roundNumber: round + 1 },
      ),
    )).flat();
  }
  const pairs = Array.from({ length: Math.ceil(exercises.length / 2) }, (_, index) => exercises.slice(index * 2, index * 2 + 2));
  let sequenceIndex = 0;
  return pairs.flatMap((pair, pairIndex) => Array.from({ length: config.rounds }, (_, round) => pair.map((exercise, index) => {
    const sourceExerciseIndex = pairIndex * 2 + index;
    return withExecutionContext(
      asSingleSet(exercise, `${pairIndex + 1}번 묶음 · ${round + 1}/${config.rounds} 세트`, index === pair.length - 1 ? config.restSeconds : 0),
      config,
      sourceExerciseIndex,
      sequenceIndex++,
      { roundNumber: round + 1, groupNumber: pairIndex + 1 },
    );
  })).flat());
}
