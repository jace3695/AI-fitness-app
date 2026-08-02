import { DayWorkout, Exercise } from "./workouts";
import { WorkoutDayId } from "./workoutCompletion";

export const USER_WORKOUT_SETTINGS_KEY = "ai-fitness-user-workout-settings";

export interface ExerciseTarget {
  sets?: number;
  reps?: number;
  durationMinutes?: number;
}

export interface UserWorkoutSettings {
  weeklyGroups: Partial<Record<WorkoutDayId, string>>;
  exerciseTargets: Record<string, ExerciseTarget>;
}

export const EMPTY_USER_WORKOUT_SETTINGS: UserWorkoutSettings = { weeklyGroups: {}, exerciseTargets: {} };

export function readUserWorkoutSettings(): UserWorkoutSettings {
  if (typeof window === "undefined") return EMPTY_USER_WORKOUT_SETTINGS;
  try {
    const saved = JSON.parse(window.localStorage.getItem(USER_WORKOUT_SETTINGS_KEY) || "{}");
    return { weeklyGroups: saved.weeklyGroups || {}, exerciseTargets: saved.exerciseTargets || {} };
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
