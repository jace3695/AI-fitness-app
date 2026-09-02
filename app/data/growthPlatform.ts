import type { GrowthCategoryId, GrowthRoutine } from "./growthRoutines";

export type GrowthRoutineRow = {
  id: string;
  user_id: string;
  category: GrowthCategoryId;
  title: string;
  target_minutes: number;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type GrowthSessionStatus = "completed" | "partial" | "stopped";
export type GrowthSessionSource = "manual" | "typing" | "handwriting" | "assistant";

export type GrowthSessionRow = {
  id: string;
  user_id: string;
  routine_id: string | null;
  session_date: string;
  status: GrowthSessionStatus;
  planned_minutes: number;
  actual_minutes: number;
  memo: string;
  source: GrowthSessionSource;
  metrics: Record<string, unknown>;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GrowthResourceClassification = "direct" | "partial" | "reference" | "duplicate" | "deferred";

export type GrowthResourceRow = {
  id: string;
  user_id: string;
  routine_id: string | null;
  title: string;
  category: GrowthCategoryId | "reference";
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  classification: GrowthResourceClassification;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type GrowthCoachSuggestion = {
  id: string;
  routineId: string | null;
  title: string;
  reason: string;
  recommendedMinutes: number | null;
};

export type GrowthAiReviewRow = {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  summary: {
    overview?: string;
    positives?: string[];
    cautions?: string[];
    nextWeek?: string[];
  };
  suggestions: GrowthCoachSuggestion[];
  source: "cloud" | "economy" | "local" | "recovered";
  decision: "applied" | "partial" | "kept" | null;
  decision_selection: string[];
  decided_at: string | null;
  created_at: string;
};

export type GrowthPeriodSummary = {
  startDate: string;
  endDate: string;
  sessionCount: number;
  activeDays: number;
  completedCount: number;
  totalMinutes: number;
  completionRate: number;
  averageMinutesPerActiveDay: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function shiftDateKey(dateKey: string, days: number) {
  if (!DATE_RE.test(dateKey)) return dateKey;
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function periodStart(endDate: string, days: number) {
  return shiftDateKey(endDate, -(Math.max(1, Math.round(days)) - 1));
}

export function summarizeGrowthPeriod(
  sessions: GrowthSessionRow[],
  endDate: string,
  days: number,
): GrowthPeriodSummary {
  const startDate = periodStart(endDate, days);
  const inPeriod = sessions.filter((session) => session.session_date >= startDate && session.session_date <= endDate);
  const activeDays = new Set(inPeriod.map((session) => session.session_date)).size;
  const completedCount = inPeriod.filter((session) => session.status === "completed").length;
  const totalMinutes = inPeriod.reduce((sum, session) => sum + Math.max(0, Number(session.actual_minutes) || 0), 0);
  return {
    startDate,
    endDate,
    sessionCount: inPeriod.length,
    activeDays,
    completedCount,
    totalMinutes,
    completionRate: inPeriod.length ? Math.round((completedCount / inPeriod.length) * 100) : 0,
    averageMinutesPerActiveDay: activeDays ? Math.round(totalMinutes / activeDays) : 0,
  };
}

export function buildGrowthComparison(sessions: GrowthSessionRow[], endDate: string, days: number) {
  const current = summarizeGrowthPeriod(sessions, endDate, days);
  const previousEnd = shiftDateKey(current.startDate, -1);
  const previous = summarizeGrowthPeriod(sessions, previousEnd, days);
  return {
    current,
    previous,
    minuteDelta: current.totalMinutes - previous.totalMinutes,
    activeDayDelta: current.activeDays - previous.activeDays,
  };
}

export function calculateTypingMetrics(expected: string, typed: string, elapsedSeconds: number) {
  const expectedCharacters = Array.from(expected);
  const typedCharacters = Array.from(typed);
  const correctCharacters = typedCharacters.reduce(
    (count, character, index) => count + Number(expectedCharacters[index] === character),
    0,
  );
  const minutes = Math.max(elapsedSeconds, 1) / 60;
  return {
    characters: typedCharacters.length,
    correctCharacters,
    accuracy: typedCharacters.length ? Math.round((correctCharacters / typedCharacters.length) * 100) : 100,
    charactersPerMinute: Math.round(typedCharacters.length / minutes),
  };
}

export function cloudRoutineToLocal(routine: GrowthRoutineRow, completedDates: string[]): GrowthRoutine {
  return {
    id: routine.id,
    category: routine.category,
    title: routine.title,
    targetMinutes: routine.target_minutes,
    enabled: routine.enabled,
    completedDates,
  };
}

function safeString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function sanitizeCoachSuggestions(value: unknown, routineIds: Set<string>): GrowthCoachSuggestion[] {
  if (!Array.isArray(value)) return [];
  const suggestions: GrowthCoachSuggestion[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || suggestions.length >= 6) continue;
    const record = item as Record<string, unknown>;
    const title = safeString(record.title, 100);
    const reason = safeString(record.reason, 240);
    if (!title || !reason) continue;
    const rawRoutineId = typeof record.routineId === "string" ? record.routineId : null;
    const routineId = rawRoutineId && routineIds.has(rawRoutineId) ? rawRoutineId : null;
    const rawMinutes = Number(record.recommendedMinutes);
    suggestions.push({
      id: safeString(record.id, 80) || `suggestion-${suggestions.length + 1}`,
      routineId,
      title,
      reason,
      recommendedMinutes: Number.isFinite(rawMinutes) && rawMinutes > 0
        ? Math.min(240, Math.max(5, Math.round(rawMinutes)))
        : null,
    });
  }
  return suggestions;
}

export function buildLocalGrowthCoach(
  routines: GrowthRoutineRow[],
  sessions: GrowthSessionRow[],
  endDate: string,
) {
  const week = summarizeGrowthPeriod(sessions, endDate, 7);
  const enabled = routines.filter((routine) => routine.enabled);
  const leastUsed = enabled
    .map((routine) => ({
      routine,
      count: sessions.filter((session) => session.routine_id === routine.id && session.session_date >= week.startDate && session.session_date <= endDate).length,
    }))
    .sort((a, b) => a.count - b.count)[0];
  const suggestions: GrowthCoachSuggestion[] = leastUsed ? [{
    id: "local-consistency",
    routineId: leastUsed.routine.id,
    title: `${leastUsed.routine.title} 시작 문턱 낮추기`,
    reason: leastUsed.count === 0 ? "이번 주 기록이 없어 5분만 시작하는 방식이 부담을 줄여줘요." : "가장 적게 실행한 루틴이라 짧게 이어가는 편이 좋아요.",
    recommendedMinutes: Math.max(5, Math.min(leastUsed.routine.target_minutes, 15)),
  }] : [];
  return {
    summary: {
      overview: week.sessionCount
        ? `이번 주 ${week.activeDays}일 동안 ${week.totalMinutes}분을 기록했어요.`
        : "이번 주 기록이 아직 없어요. 가장 쉬운 루틴부터 5분만 시작해 보세요.",
      positives: week.completedCount ? [`완료 기록이 ${week.completedCount}개 있어요.`] : [],
      cautions: week.activeDays <= 1 ? ["한 번에 오래 하기보다 실행하는 날을 늘려보세요."] : [],
      nextWeek: suggestions.map((suggestion) => suggestion.title),
    },
    suggestions,
  };
}
