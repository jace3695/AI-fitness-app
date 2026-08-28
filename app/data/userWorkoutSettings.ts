import { DayWorkout, Exercise } from "./workouts";
import { EXCLUDED_EXERCISE_IDS } from "./workoutGroups";
import { WorkoutDayId } from "./workoutCompletion";
import type { WorkoutMethodConfig } from "./workoutMethods";

export const USER_WORKOUT_SETTINGS_KEY = "ai-fitness-user-workout-settings";

export interface ExerciseTarget {
  sets?: number;
  reps?: number;
  durationMinutes?: number;
}

export interface CustomExercise {
  id: string;
  name: string;
  sets?: number;
  reps?: number;
  durationMinutes?: number;
}

export interface DayRoutineEdit {
  order?: string[];
  removed?: string[];
  customExercises?: CustomExercise[];
}

export interface DateWorkoutOverride {
  groupId?: string;
  edit?: DayRoutineEdit;
  method?: WorkoutMethodConfig;
}

export interface UserWorkoutSettings {
  weeklyGroups: Partial<Record<WorkoutDayId, string>>;
  exerciseTargets: Record<string, ExerciseTarget>;
  weeklyEdits: Partial<Record<WorkoutDayId, DayRoutineEdit>>;
  weeklyMethods: Partial<Record<WorkoutDayId, WorkoutMethodConfig>>;
  dateOverrides: Record<string, DateWorkoutOverride>;
}

export const EMPTY_USER_WORKOUT_SETTINGS: UserWorkoutSettings = { weeklyGroups: {}, exerciseTargets: {}, weeklyEdits: {}, weeklyMethods: {}, dateOverrides: {} };

export function readUserWorkoutSettings(): UserWorkoutSettings {
  if (typeof window === "undefined") return EMPTY_USER_WORKOUT_SETTINGS;
  try {
    const saved = JSON.parse(window.localStorage.getItem(USER_WORKOUT_SETTINGS_KEY) || "{}");
    return {
      weeklyGroups: saved.weeklyGroups || {},
      exerciseTargets: saved.exerciseTargets || {},
      weeklyEdits: saved.weeklyEdits || {},
      weeklyMethods: saved.weeklyMethods || {},
      dateOverrides: saved.dateOverrides || {},
    };
  } catch {
    return EMPTY_USER_WORKOUT_SETTINGS;
  }
}

export function saveUserWorkoutSettings(settings: UserWorkoutSettings) {
  window.localStorage.setItem(USER_WORKOUT_SETTINGS_KEY, JSON.stringify(settings));
}

function applyTarget(exercise: Exercise, target?: ExerciseTarget): Exercise {
  if (!target) return exercise;
  const units = [target.reps ? `${target.reps}회` : "", target.sets ? `${target.sets}세트` : "", target.durationMinutes ? `${target.durationMinutes}분` : ""].filter(Boolean);
  return { ...exercise, sets: target.sets ?? exercise.sets, meta: units.length ? units.join(" × ") : exercise.meta };
}

export function applyExerciseTargets(day: DayWorkout, targets: Record<string, ExerciseTarget>): DayWorkout {
  return {
    ...day,
    phases: day.phases.map((phase) => ({ ...phase, exercises: phase.exercises.map((exercise) => applyTarget(exercise, targets[exercise.name])) })),
    optionalCardio: day.optionalCardio ? {
      ...day.optionalCardio,
      warmup: day.optionalCardio.warmup.map((exercise) => applyTarget(exercise, targets[exercise.name])),
      options: day.optionalCardio.options.map((option) => ({ ...option, exercises: option.exercises.map((exercise) => applyTarget(exercise, targets[exercise.name])) })),
      cooldown: day.optionalCardio.cooldown.map((exercise) => applyTarget(exercise, targets[exercise.name])),
    } : undefined,
  };
}

function editExercises(exercises: Exercise[], edit?: DayRoutineEdit): Exercise[] {
  const allowedExercises = exercises.filter((exercise) => !EXCLUDED_EXERCISE_IDS.has(exercise.exerciseId || ""));
  if (!edit) return allowedExercises;
  const removed = new Set(edit.removed || []);
  const existing = allowedExercises.filter((exercise) => !removed.has(exercise.exerciseId || exercise.name));
  const custom: Exercise[] = (edit.customExercises || []).filter((exercise) => !EXCLUDED_EXERCISE_IDS.has(exercise.id)).map((exercise) => ({
    exerciseId: exercise.id,
    name: exercise.name,
    sets: exercise.sets ?? (exercise.reps ? 1 : 0),
    meta: exercise.durationMinutes ? `${exercise.durationMinutes}분` : [exercise.reps ? `${exercise.reps}회` : "", exercise.sets ? `${exercise.sets}세트` : ""].filter(Boolean).join(" × "),
    restSeconds: exercise.sets ? 30 : 0,
    details: [{ type: "purple", text: "사용자가 직접 추가한 운동입니다. 통증 없는 범위에서 진행하세요." }],
  }));
  const combined = [...existing, ...custom];
  if (!edit.order?.length) return combined;
  const rank = new Map(edit.order.map((id, index) => [id, index]));
  return combined.sort((a, b) => (rank.get(a.exerciseId || a.name) ?? 999) - (rank.get(b.exerciseId || b.name) ?? 999));
}

export function applyDayRoutineEdit(day: DayWorkout, edit?: DayRoutineEdit): DayWorkout {
  if (!edit) return day;
  return {
    ...day,
    phases: day.phases.map((phase) => ({ ...phase, exercises: editExercises(phase.exercises, edit) })),
    optionalCardio: day.optionalCardio ? {
      ...day.optionalCardio,
      warmup: editExercises(day.optionalCardio.warmup, edit),
      options: day.optionalCardio.options.map((option) => ({ ...option, exercises: editExercises(option.exercises, edit) })),
      cooldown: editExercises(day.optionalCardio.cooldown, edit),
    } : undefined,
  };
}
