import {
  getWorkoutDayForDate,
  isWorkoutPerformed,
  type WorkoutCompletionStore,
} from "./workoutCompletion.ts";
import {
  dayIdToKoreanLabel,
  getWeeklyWorkoutPlanById,
  getWorkoutGroupForPlanDay,
} from "./workoutPlans.ts";

export const LANGUAGE_ROUTINES = [
  { id: "kana", label: "가나", href: "/language/kana" },
  { id: "words", label: "단어", href: "/language/words" },
  { id: "sentences", label: "문장", href: "/language/sentences" },
  { id: "grammar", label: "문법", href: "/language/grammar" },
  { id: "review", label: "복습", href: "/language/review" },
] as const;

export type FitnessDailyStatus = {
  synced: boolean;
  title: string;
  detail: string;
  completed: boolean;
  isRest: boolean;
};

export type LanguageDailyStatus = {
  synced: boolean;
  completed: number;
  total: number;
  nextLabel: string;
  nextHref: string;
};

export const EMPTY_FITNESS_DAILY_STATUS: FitnessDailyStatus = {
  synced: false,
  title: "운동 기록 연결 대기",
  detail: "운동 앱에서 오늘 계획을 확인하세요.",
  completed: false,
  isRest: false,
};

export const EMPTY_LANGUAGE_DAILY_STATUS: LanguageDailyStatus = {
  synced: false,
  completed: 0,
  total: LANGUAGE_ROUTINES.length,
  nextLabel: "학습 기록 연결 대기",
  nextHref: "/language",
};

export function parseStateObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function buildFitnessDailyStatus(
  state: Record<string, unknown>,
  todayKey: string,
  today = new Date(),
): FitnessDailyStatus {
  const planId = typeof state["ai-fitness-selected-weekly-workout-plan"] === "string"
    ? state["ai-fitness-selected-weekly-workout-plan"] as string
    : undefined;
  const dayId = getWorkoutDayForDate(today);
  if (!dayId) return EMPTY_FITNESS_DAILY_STATUS;

  const plan = getWeeklyWorkoutPlanById(planId);
  const group = getWorkoutGroupForPlanDay(plan, dayId);
  const completedStore = parseStateObject(
    state["ai-fitness-workout-completed-days"],
  ) as WorkoutCompletionStore;
  const completed = isWorkoutPerformed(completedStore[todayKey]);
  const isRest = group.id === "rest";

  return {
    synced: true,
    title: isRest ? "오늘은 회복일" : group.name,
    detail: completed
      ? "오늘 운동을 완료했습니다."
      : isRest
        ? "가볍게 쉬며 몸 상태를 확인하세요."
        : `${dayIdToKoreanLabel[dayId]} 계획 · ${plan.weekLabel}`,
    completed,
    isRest,
  };
}

export function buildLanguageDailyStatus(
  state: Record<string, unknown>,
  todayKey: string,
): LanguageDailyStatus {
  const routine = parseStateObject(state.dailyRoutineProgress);
  const completedIds = routine.date === todayKey && Array.isArray(routine.completedIds)
    ? Array.from(new Set(routine.completedIds.filter(
      (value): value is string =>
        typeof value === "string" && LANGUAGE_ROUTINES.some((item) => item.id === value),
    )))
    : [];
  const next = LANGUAGE_ROUTINES.find((item) => !completedIds.includes(item.id));

  return {
    synced: true,
    completed: completedIds.length,
    total: LANGUAGE_ROUTINES.length,
    nextLabel: next ? `다음 학습: ${next.label}` : "오늘 학습 완료",
    nextHref: next?.href ?? "/language",
  };
}
