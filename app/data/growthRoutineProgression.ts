import type { GrowthCoachSuggestion, GrowthRoutineRow, GrowthSessionRow, GrowthSessionStatus } from './growthPlatform';

export const GROWTH_DIFFICULTIES = {
  unrecorded: '선택 안 함', too_easy: '너무 쉬웠어요', appropriate: '적당했어요', difficult: '어려웠어요',
} as const;
export type GrowthDifficulty = keyof typeof GROWTH_DIFFICULTIES;
export function normalizeGrowthDifficulty(value: unknown): GrowthDifficulty {
  return typeof value === 'string' && Object.hasOwn(GROWTH_DIFFICULTIES, value) ? value as GrowthDifficulty : 'unrecorded';
}

// Optional feedback is independent of completion. Quick/legacy completions do not imply ease.
export function completedGrowthFeedback(status: GrowthSessionStatus, value: unknown): Record<string, unknown> {
  const difficulty = normalizeGrowthDifficulty(value);
  return status === 'completed' && difficulty !== 'unrecorded' ? { routineDifficulty: difficulty } : {};
}

// Transparent, conservative app rule, not a clinical or optimal-training prescription.
function growthProgressionEvidence(
  routine: GrowthRoutineRow, sessions: GrowthSessionRow[], endDate: string,
) {
  if (!routine.enabled || !Number.isInteger(routine.target_minutes) || routine.target_minutes < 5 || routine.target_minutes >= 240) return null;
  const start = new Date(`${endDate}T12:00:00Z`);
  if (!Number.isFinite(start.getTime())) return null;
  start.setUTCDate(start.getUTCDate() - 13);
  const startDate = start.toISOString().slice(0, 10);
  const recent = sessions.filter(row => row.user_id === routine.user_id && row.routine_id === routine.id
    && row.session_date >= startDate && row.session_date <= endDate);
  // Any interruption takes precedence; contradictory feedback at this target also holds progression.
  if (recent.some(row => row.status !== 'completed'
    || (row.planned_minutes === routine.target_minutes && ['appropriate', 'difficult'].includes(normalizeGrowthDifficulty(row.metrics?.routineDifficulty))))) return null;
  const easy = recent.filter(row => row.status === 'completed' && row.planned_minutes === routine.target_minutes
    && row.actual_minutes >= routine.target_minutes && normalizeGrowthDifficulty(row.metrics?.routineDifficulty) === 'too_easy');
  const dates = [...new Set(easy.map(row => row.session_date))].sort();
  if (dates.length < 3) return null;
  return { easy, dates };
}

export function buildGrowthProgressionSuggestion(
  routine: GrowthRoutineRow, sessions: GrowthSessionRow[], endDate: string,
): GrowthCoachSuggestion | null {
  const evidence = growthProgressionEvidence(routine, sessions, endDate);
  if (!evidence) return null;
  // Three distinct recent days suffice. A bounded, deterministic subset avoids
  // overflowing the existing review JSON limit for frequent routine sessions.
  const dates = evidence.dates.slice(-3);
  const sessionIds = dates.map(date => evidence.easy.filter(row => row.session_date === date).map(row => row.id).sort()[0]).sort();
  return {
    id: `local-next-step-${routine.id}`, routineId: routine.id,
    title: `${routine.title} 다음 단계 검토`,
    reason: `최근 14일 중 서로 다른 ${dates.length}일에 현재 목표 ${routine.target_minutes}분 이상을 완료하고 ‘너무 쉬웠어요’를 직접 선택했어요. 다음 목표를 조금 늘릴지 검토해 주세요.`,
    recommendedMinutes: Math.min(240, routine.target_minutes + 5),
    progression: { targetMinutes: routine.target_minutes, routineUpdatedAt: routine.updated_at, dates, sessionIds },
  };
}

export function growthSuggestionCanApply(suggestion: GrowthCoachSuggestion, routine: GrowthRoutineRow | undefined, sessions: GrowthSessionRow[], endDate: string) {
  if (!routine?.enabled || routine.id !== suggestion.routineId || !Number.isInteger(suggestion.recommendedMinutes)
    || suggestion.recommendedMinutes! < 5 || suggestion.recommendedMinutes! > 240) return false;
  if (!suggestion.progression) return suggestion.recommendedMinutes! <= routine.target_minutes;
  const evidence = suggestion.progression;
  if (!Array.isArray(evidence.dates) || !Array.isArray(evidence.sessionIds)
    || evidence.dates.length < 3 || evidence.sessionIds.length < 3
    || new Set(evidence.dates).size !== evidence.dates.length || new Set(evidence.sessionIds).size !== evidence.sessionIds.length) return false;
  if (evidence.targetMinutes !== routine.target_minutes || Date.parse(evidence.routineUpdatedAt) !== Date.parse(routine.updated_at)) return false;
  const current = growthProgressionEvidence(routine, sessions, endDate);
  if (!current || Math.min(240, routine.target_minutes + 5) !== suggestion.recommendedMinutes) return false;
  // Saved evidence must still exist; new records cannot silently replace the preview's evidence.
  const savedRows = current.easy.filter(row => evidence.sessionIds.includes(row.id));
  const savedDates = [...new Set(savedRows.map(row => row.session_date))];
  return savedRows.length === evidence.sessionIds.length && savedDates.length === evidence.dates.length
    && evidence.dates.every(date => savedDates.includes(date));
}

export function mergeEvidenceBasedGrowthSuggestions(candidate: GrowthCoachSuggestion[], local: GrowthCoachSuggestion[], routines: GrowthRoutineRow[]) {
  const progression = local.filter(suggestion => suggestion.progression);
  const progressionIds = new Set(progression.map(suggestion => suggestion.routineId));
  const safe = candidate.filter(suggestion => {
    const routine = routines.find(row => row.id === suggestion.routineId);
    return !progressionIds.has(suggestion.routineId) && (!suggestion.recommendedMinutes
      || (routine && suggestion.recommendedMinutes <= routine.target_minutes));
  });
  // Filtering an unsupported model increase must not also erase the existing
  // local reduction/consistency fallback for this review.
  return safe.length ? [...progression, ...safe].slice(0, 6) : local.slice(0, 6);
}
