import { buildGrowthProgressionSuggestion } from "./growthRoutineProgression.ts";
import type { GrowthCategoryId, GrowthRoutine } from "./growthRoutines";
import { normalizeGrowthPreferredDays, normalizeGrowthWeeklyTarget } from "./growthSchedule.ts";

export type GrowthRoutineRow = {
  id: string;
  user_id: string;
  category: GrowthCategoryId;
  title: string;
  target_minutes: number;
  preferred_days: number[];
  target_sessions_per_week: number;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type GrowthSessionStatus = "completed" | "partial" | "stopped";
export const GROWTH_STOP_REASONS = { unrecorded: '선택 안 함', time: '시간이 부족했어요', tired: '피곤했어요', difficult: '너무 어려웠어요', distracted: '집중이 어려웠어요', interrupted: '다른 일이 생겼어요', illness: '몸이 아팠어요', forgot: '깜빡했어요', no_motivation: '의욕이 없었어요' };
export type GrowthStopReason = keyof typeof GROWTH_STOP_REASONS;
export function normalizeGrowthStopReason(value: unknown): GrowthStopReason { return typeof value === 'string' && Object.hasOwn(GROWTH_STOP_REASONS, value) ? value as GrowthStopReason : 'unrecorded'; }
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
  last_used_on?: string | null;
  created_at: string;
  updated_at: string;
};

export type GrowthCoachSuggestion = {
  id: string;
  routineId: string | null;
  title: string;
  reason: string;
  recommendedMinutes: number | null;
  progression?: { targetMinutes: number; routineUpdatedAt: string; dates: string[]; sessionIds: string[] };
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
  averageMinutesPerActiveDay: number | null;
  recordedTimeSessions: number;
  recordedTimeDays: number;
  unknownTimeSessions: number;
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

export type GrowthDurationInput = { actual_minutes: number | string; metrics?: Record<string, unknown> | null };
export function summarizeGrowthDuration(sessions: GrowthDurationInput[]) {
  const recorded = sessions.filter(session => session.metrics?.actualMinutesRecorded !== false);
  const totalMinutes = recorded.reduce((sum, session) => {
    const minutes = Number(session.actual_minutes);
    return sum + (Number.isFinite(minutes) ? Math.max(0, minutes) : 0);
  }, 0);
  return { totalMinutes, recordedTimeSessions: recorded.length, unknownTimeSessions: sessions.length - recorded.length };
}
export function growthDurationLabel(duration: ReturnType<typeof summarizeGrowthDuration>) {
  if (duration.unknownTimeSessions && !duration.recordedTimeSessions) return `시간 미기록 ${duration.unknownTimeSessions}회`;
  return `기록 ${Math.round(duration.totalMinutes)}분${duration.unknownTimeSessions ? ` · 시간 미기록 ${duration.unknownTimeSessions}회 제외` : ''}`;
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
  // Only explicit false means unknown. Historic records without this newer flag
  // keep their recorded meaning; no migration or retrospective guess is made.
  const recorded = inPeriod.filter(session => session.metrics.actualMinutesRecorded !== false);
  const recordedTimeDays = new Set(recorded.map(session => session.session_date)).size;
  const duration = summarizeGrowthDuration(inPeriod);
  const totalMinutes = duration.totalMinutes;
  return {
    startDate,
    endDate,
    sessionCount: inPeriod.length,
    activeDays,
    completedCount,
    totalMinutes,
    completionRate: inPeriod.length ? Math.round((completedCount / inPeriod.length) * 100) : 0,
    averageMinutesPerActiveDay: recordedTimeDays ? Math.round(totalMinutes / recordedTimeDays) : null,
    recordedTimeSessions: duration.recordedTimeSessions, recordedTimeDays, unknownTimeSessions: duration.unknownTimeSessions,
  };
}

export function growthPeriodTimeLabel(summary: GrowthPeriodSummary) {
  if (summary.unknownTimeSessions && !summary.recordedTimeSessions) return '시간 미기록';
  return `${summary.totalMinutes}분${summary.unknownTimeSessions ? ' (기록된 시간)' : ''}`;
}

export function buildGrowthComparison(sessions: GrowthSessionRow[], endDate: string, days: number) {
  const current = summarizeGrowthPeriod(sessions, endDate, days);
  const previousEnd = shiftDateKey(current.startDate, -1);
  const previous = summarizeGrowthPeriod(sessions, previousEnd, days);
  return {
    current,
    previous,
    minuteDelta: current.unknownTimeSessions || previous.unknownTimeSessions ? null : current.totalMinutes - previous.totalMinutes,
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
    preferredDays: normalizeGrowthPreferredDays(routine.preferred_days),
    targetSessionsPerWeek: normalizeGrowthWeeklyTarget(
      routine.target_sessions_per_week,
      routine.preferred_days,
    ),
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
  const recent = sessions.filter(session => session.session_date >= week.startDate && session.session_date <= endDate);
  const interrupted = enabled.map(routine => ({ routine, records: recent.filter(session => session.routine_id === routine.id && session.status !== 'completed') }))
    .filter(item => new Set(item.records.map(record => record.session_date)).size >= 2)
    .sort((a, b) => b.records.length - a.records.length)[0];
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
    reason: leastUsed.count === 0 ? "이번 주 저장 기록이 없어요. 실제 미수행을 뜻하지는 않습니다. 짧게 시작할지 확인해 주세요." : "이번 주 기록 수가 가장 적은 루틴입니다. 목표 시간을 줄일지 직접 검토해 주세요.",
    recommendedMinutes: Math.max(5, Math.min(leastUsed.routine.target_minutes, 15)),
  }] : [];
  if (interrupted) {
    const reasons = interrupted.records.map(record => normalizeGrowthStopReason(record.metrics?.stopReason)).filter(reason => reason !== 'unrecorded');
    const common = reasons.toSorted((a, b) => reasons.filter(reason => reason === b).length - reasons.filter(reason => reason === a).length)[0];
    suggestions.splice(0, suggestions.length, {
      id: 'local-reduce-load', routineId: interrupted.routine.id,
      title: `${interrupted.routine.title} 목표 시간 줄여보기`,
      reason: `서로 다른 ${new Set(interrupted.records.map(record => record.session_date)).size}일에 미완료 기록이 있어요.${common ? ` 선택한 이유 중 ‘${GROWTH_STOP_REASONS[common]}’가 가장 많았어요.` : ' 이유는 기록되지 않아 추정하지 않아요.'}`,
      recommendedMinutes: Math.max(5, Math.min(interrupted.routine.target_minutes, Math.floor(interrupted.routine.target_minutes * 0.75 / 5) * 5)),
    });
  }
  for (const routine of enabled) {
    const progression = buildGrowthProgressionSuggestion(routine, sessions, endDate);
    if (!progression) continue;
    const existing = suggestions.findIndex(suggestion => suggestion.routineId === routine.id);
    if (existing >= 0) suggestions.splice(existing, 1);
    suggestions.push(progression);
  }
  suggestions.splice(6);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const weekday = days.map((label, index) => {
    const selected = recent.filter(record => new Date(`${record.session_date}T12:00:00Z`).getUTCDay() === index);
    return { label, total: selected.length, completed: selected.filter(record => record.status === 'completed').length };
  }).filter(item => item.total > 0);
  return {
    summary: {
      overview: week.sessionCount
        ? `이번 주 ${week.activeDays}일 동안 ${week.sessionCount}회 기록했어요. ${week.recordedTimeSessions ? `시간이 기록된 ${week.recordedTimeSessions}회의 합계는 ${week.totalMinutes}분이에요.` : '실행 시간은 미기록이에요.'}${week.unknownTimeSessions && week.recordedTimeSessions ? ` 시간 미기록 ${week.unknownTimeSessions}회는 시간 집계에서 제외했어요.` : ''}`
        : "이번 주 기록이 아직 없어요. 가장 쉬운 루틴부터 5분만 시작해 보세요.",
      positives: week.completedCount ? [`완료 기록이 ${week.completedCount}개 있어요.`] : [],
      cautions: week.activeDays <= 1 ? ["한 번에 오래 하기보다 실행하는 날을 늘려보세요."] : [],
      nextWeek: [...suggestions.map((suggestion) => suggestion.title), ...(weekday.length ? [`이번 주 요일별 완료: ${weekday.map(item => `${item.label} ${item.completed}/${item.total}회`).join(' · ')}. 시간 제안은 확인 후 적용하고, 요일은 루틴 편집에서 조정할 수 있어요.`] : [])],
    },
    suggestions,
  };
}
