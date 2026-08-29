import type { WorkoutDayId } from "./workoutCompletion.ts";
import type { WorkoutPlanProposal } from "./workoutPlanProposal.ts";

export const WORKOUT_PLAN_DECISION_HISTORY_KEY =
  "ai-fitness-workout-plan-decision-history";

export type WorkoutPlanDecision = "applied" | "partial" | "kept";

export interface WorkoutPlanDecisionRecord {
  id: string;
  createdAt: string;
  decision: WorkoutPlanDecision;
  proposalTitle: string;
  selectedDayIds: WorkoutDayId[];
  selectedExerciseNames: string[];
  changeSummary: string[];
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeRecord(value: unknown): WorkoutPlanDecisionRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<WorkoutPlanDecisionRecord>;
  if (!raw.id || !raw.createdAt || !["applied", "partial", "kept"].includes(raw.decision || "")) {
    return null;
  }
  const validDays = new Set<WorkoutDayId>([
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "sat",
    "sun",
  ]);
  return {
    id: cleanText(raw.id, 80),
    createdAt: cleanText(raw.createdAt, 40),
    decision: raw.decision as WorkoutPlanDecision,
    proposalTitle: cleanText(raw.proposalTitle, 100),
    selectedDayIds: Array.isArray(raw.selectedDayIds)
      ? raw.selectedDayIds.filter((day): day is WorkoutDayId => validDays.has(day)).slice(0, 7)
      : [],
    selectedExerciseNames: Array.isArray(raw.selectedExerciseNames)
      ? raw.selectedExerciseNames.map((name) => cleanText(name, 80)).filter(Boolean).slice(0, 8)
      : [],
    changeSummary: Array.isArray(raw.changeSummary)
      ? raw.changeSummary.map((item) => cleanText(item, 160)).filter(Boolean).slice(0, 6)
      : [],
  };
}

export function readWorkoutPlanDecisionHistory(): WorkoutPlanDecisionRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(
      window.localStorage.getItem(WORKOUT_PLAN_DECISION_HISTORY_KEY) || "[]",
    );
    return Array.isArray(value)
      ? value.flatMap((item) => {
          const record = normalizeRecord(item);
          return record ? [record] : [];
        }).slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

export function saveWorkoutPlanDecision(
  decision: WorkoutPlanDecision,
  proposal: WorkoutPlanProposal,
  selection?: {
    dayIds?: WorkoutDayId[];
    exerciseNames?: string[];
  },
) {
  if (typeof window === "undefined") return;
  const allDayIds = proposal.days.map((day) => day.dayId);
  const allExerciseNames = proposal.exerciseTargets.map(
    (target) => target.exerciseName,
  );
  const record: WorkoutPlanDecisionRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    decision,
    proposalTitle: proposal.title,
    selectedDayIds:
      decision === "kept" ? [] : selection?.dayIds ?? allDayIds,
    selectedExerciseNames:
      decision === "kept"
        ? []
        : selection?.exerciseNames ?? allExerciseNames,
    changeSummary: proposal.changes,
  };
  const next = [record, ...readWorkoutPlanDecisionHistory()].slice(0, 20);
  window.localStorage.setItem(
    WORKOUT_PLAN_DECISION_HISTORY_KEY,
    JSON.stringify(next),
  );
}
