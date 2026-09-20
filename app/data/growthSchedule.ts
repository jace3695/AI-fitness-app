import type { GrowthRoutineRow, GrowthSessionRow } from "./growthPlatform.ts";

export const GROWTH_WEEKDAYS = [
  { id: 1, label: "월" },
  { id: 2, label: "화" },
  { id: 3, label: "수" },
  { id: 4, label: "목" },
  { id: 5, label: "금" },
  { id: 6, label: "토" },
  { id: 7, label: "일" },
] as const;

export const ALL_GROWTH_WEEKDAYS = GROWTH_WEEKDAYS.map((day) => day.id);

export function normalizeGrowthPreferredDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [...ALL_GROWTH_WEEKDAYS];
  const days = Array.from(new Set(value.map(Number).filter(
    (day) => Number.isInteger(day) && day >= 1 && day <= 7,
  ))).sort((left, right) => left - right);
  return days.length ? days : [...ALL_GROWTH_WEEKDAYS];
}
export function normalizeGrowthWeeklyTarget(value: unknown, preferredDays: unknown) {
  const days = normalizeGrowthPreferredDays(preferredDays);
  const number = Number(value);
  const fallback = days.length;
  return Math.min(
    days.length,
    Math.max(1, Number.isFinite(number) ? Math.round(number) : fallback),
  );
}

export function growthWeekdayForDateKey(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const date = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

export function growthWeekStart(dateKey: string) {
  const weekday = growthWeekdayForDateKey(dateKey);
  if (!weekday) return dateKey;
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (weekday - 1));
  return date.toISOString().slice(0, 10);
}

export function isGrowthRoutineScheduled(routine: Pick<GrowthRoutineRow, "preferred_days">, dateKey: string) {
  const weekday = growthWeekdayForDateKey(dateKey);
  return weekday !== null && normalizeGrowthPreferredDays(routine.preferred_days).includes(weekday);
}

export function formatGrowthPreferredDays(value: unknown) {
  const days = normalizeGrowthPreferredDays(value);
  return days.length === 7
    ? "매일"
    : days.map((day) => GROWTH_WEEKDAYS.find((item) => item.id === day)?.label).filter(Boolean).join("·");
}

export function summarizeGrowthRoutineWeek(
  routine: Pick<GrowthRoutineRow, "id" | "preferred_days" | "target_sessions_per_week">,
  sessions: Pick<GrowthSessionRow, "routine_id" | "session_date" | "status">[],
  dateKey: string,
) {
  const startDate = growthWeekStart(dateKey);
  const completedDates = new Set(sessions.filter((session) =>
    session.routine_id === routine.id &&
    session.status === "completed" &&
    session.session_date >= startDate &&
    session.session_date <= dateKey
  ).map((session) => session.session_date));
  const target = normalizeGrowthWeeklyTarget(routine.target_sessions_per_week, routine.preferred_days);
  return {
    startDate,
    completed: completedDates.size,
    target,
    remaining: Math.max(0, target - completedDates.size),
    achieved: completedDates.size >= target,
    scheduledToday: isGrowthRoutineScheduled(routine, dateKey),
  };
}
