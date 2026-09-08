import type { WorkoutDayId } from "./workoutCompletion.ts";
import type { UserWorkoutSettings } from "./userWorkoutSettings.ts";
import type { WorkoutMethodConfig } from "./workoutMethods.ts";

export const CURRENT_WORKOUT_DIRECTION_VERSION = "five-day-circuit-v1";
export const CURRENT_WORKOUT_DIRECTION_VERSION_KEY = "ai-fitness-workout-direction-version";
export const CURRENT_WORKOUT_DIRECTION_BACKUP_KEY = "ai-fitness-workout-direction-backup";
export const CURRENT_WEIGHT_BASELINE_KG = 86;
export const CURRENT_WEIGHT_BASELINE_DATE = "2026-09-07";

export const CURRENT_WEEKLY_GROUPS: Record<WorkoutDayId, string> = {
  mon: "current-fullbody-strength-circuit",
  tue: "current-fullbody-recovery-circuit",
  wed: "current-fullbody-strength-circuit",
  thu: "current-fullbody-recovery-circuit",
  fri: "current-fullbody-strength-circuit",
  sat: "current-weekend-recovery",
  sun: "rest",
};

const strengthCircuit: WorkoutMethodConfig = {
  method: "circuit",
  rounds: 3,
  restSeconds: 75,
  workSeconds: 30,
};

const recoveryCircuit: WorkoutMethodConfig = {
  method: "circuit",
  rounds: 1,
  restSeconds: 60,
  workSeconds: 30,
};

const restMethod: WorkoutMethodConfig = {
  method: "standard",
  rounds: 1,
  restSeconds: 60,
  workSeconds: 30,
};

export const CURRENT_WEEKLY_METHODS: Record<WorkoutDayId, WorkoutMethodConfig> = {
  mon: strengthCircuit,
  tue: recoveryCircuit,
  wed: strengthCircuit,
  thu: recoveryCircuit,
  fri: strengthCircuit,
  sat: restMethod,
  sun: restMethod,
};

export const CURRENT_PROGRAM_SCHEDULE = [
  { days: "월·수·금", label: "전신 근력 서킷", intensity: "중간 강도", duration: "25~35분", tone: "violet" },
  { days: "화·목", label: "회복형 전신 서킷", intensity: "낮은 강도", duration: "약 10~20분 · 1~2라운드", tone: "blue" },
  { days: "토·일", label: "회복 중심", intensity: "휴식 우선", duration: "선택 걷기·가동성", tone: "green" },
] as const;

export function buildCurrentWorkoutSettings(settings: UserWorkoutSettings): UserWorkoutSettings {
  return {
    ...settings,
    weeklyGroups: { ...CURRENT_WEEKLY_GROUPS },
    weeklyMethods: { ...CURRENT_WEEKLY_METHODS },
    weeklyEdits: {},
    dateOverrides: {},
    weeklyExerciseTargets: {},
  };
}
