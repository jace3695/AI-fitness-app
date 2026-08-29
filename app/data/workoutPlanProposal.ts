import type { WorkoutDayId } from "./workoutCompletion";
import { normalizeWorkoutMethod } from "./workoutMethods.ts";
import type { WorkoutMethodConfig } from "./workoutMethods";
import type { ExerciseTarget, UserWorkoutSettings } from "./userWorkoutSettings";

export const WORKOUT_PLAN_DAY_IDS: WorkoutDayId[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

export const WORKOUT_PLAN_DAY_LABELS: Record<WorkoutDayId, string> = {
  mon: "월요일",
  tue: "화요일",
  wed: "수요일",
  thu: "목요일",
  fri: "금요일",
  sat: "토요일",
  sun: "일요일",
};

export interface WorkoutDayProposal {
  dayId: WorkoutDayId;
  groupId: string;
  method: WorkoutMethodConfig;
  reason: string;
}

export interface ExerciseTargetProposal extends ExerciseTarget {
  exerciseName: string;
  reason: string;
}

export interface WorkoutPlanProposal {
  title: string;
  summary: string;
  days: WorkoutDayProposal[];
  exerciseTargets: ExerciseTargetProposal[];
  changes: string[];
  cautions: string[];
}

interface ProposalAllowList {
  groupIds: ReadonlySet<string>;
  exerciseNames: ReadonlySet<string>;
}

function safeText(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeNumber(value: unknown, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function safeTextList(value: unknown, maxItems: number) {
  return Array.isArray(value)
    ? value.map((item) => safeText(item)).filter(Boolean).slice(0, maxItems)
    : [];
}

export function sanitizeWorkoutPlanProposal(value: unknown, allowList: ProposalAllowList): WorkoutPlanProposal | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const rawDays = Array.isArray(raw.days) ? raw.days : [];
  const seenDays = new Set<WorkoutDayId>();
  const days = rawDays.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const day = item as Record<string, unknown>;
    const dayId = day.dayId as WorkoutDayId;
    const groupId = safeText(day.groupId, 80);
    if (!WORKOUT_PLAN_DAY_IDS.includes(dayId) || seenDays.has(dayId) || !allowList.groupIds.has(groupId)) return [];
    seenDays.add(dayId);
    return [{
      dayId,
      groupId,
      method: normalizeWorkoutMethod(day.method as Partial<WorkoutMethodConfig> | undefined),
      reason: safeText(day.reason),
    }];
  });

  const rawTargets = Array.isArray(raw.exerciseTargets) ? raw.exerciseTargets : [];
  const seenExercises = new Set<string>();
  const exerciseTargets = rawTargets.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const target = item as Record<string, unknown>;
    const exerciseName = safeText(target.exerciseName, 80);
    if (!allowList.exerciseNames.has(exerciseName) || seenExercises.has(exerciseName)) return [];
    seenExercises.add(exerciseName);
    const next: ExerciseTargetProposal = {
      exerciseName,
      sets: safeNumber(target.sets, 1, 5),
      reps: safeNumber(target.reps, 1, 30),
      durationMinutes: safeNumber(target.durationMinutes, 1, 60),
      reason: safeText(target.reason),
    };
    if (next.sets === undefined && next.reps === undefined && next.durationMinutes === undefined) return [];
    return [next];
  });

  if (days.length !== WORKOUT_PLAN_DAY_IDS.length) return null;
  return {
    title: safeText(raw.title, 100) || "AI 추천 운동 계획",
    summary: safeText(raw.summary, 600),
    days,
    exerciseTargets,
    changes: safeTextList(raw.changes, 6),
    cautions: safeTextList(raw.cautions, 5),
  };
}

export function applyWorkoutPlanProposal(
  settings: UserWorkoutSettings,
  proposal: WorkoutPlanProposal,
): UserWorkoutSettings {
  const weeklyGroups = { ...settings.weeklyGroups };
  const weeklyMethods = { ...settings.weeklyMethods };
  proposal.days.forEach((day) => {
    weeklyGroups[day.dayId] = day.groupId;
    weeklyMethods[day.dayId] = normalizeWorkoutMethod(day.method);
  });
  const exerciseTargets = { ...settings.exerciseTargets };
  proposal.exerciseTargets.forEach(({ exerciseName, reason: _reason, ...target }) => {
    exerciseTargets[exerciseName] = target;
  });
  return { ...settings, weeklyGroups, weeklyMethods, exerciseTargets };
}
