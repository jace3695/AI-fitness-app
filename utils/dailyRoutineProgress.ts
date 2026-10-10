export const DAILY_ROUTINE_STORAGE_KEY = "dailyRoutineProgress";
export const DAILY_LEARNING_HISTORY_STORAGE_KEY = "dailyLearningHistory";
const ROUTINE_IDS = ["kana", "words", "sentences", "grammar", "review"] as const;

/** Display-only projection. Absence is a default, never authority for a write. */
export const getTodayRoutineCompletedIds = (todayKey: string, raw?: string | null): string[] => {
  if (raw == null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    const item = parsed as { date?: unknown; completedIds?: unknown };
    if (item.date !== todayKey || !Array.isArray(item.completedIds)) return [];
    return [...new Set(item.completedIds.filter((value): value is string => typeof value === 'string' && (ROUTINE_IDS as readonly string[]).includes(value)))];
  } catch { return []; }
};
