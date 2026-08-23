import { getLocalDateKey } from "@/utils/dateKey";

export const DAILY_ROUTINE_STORAGE_KEY = "dailyRoutineProgress";
export const DAILY_LEARNING_HISTORY_STORAGE_KEY = "dailyLearningHistory";

const ROUTINE_IDS = ["kana", "words", "sentences", "grammar", "review"] as const;
const TOTAL_ROUTINE_COUNT = ROUTINE_IDS.length;

type RoutineId = (typeof ROUTINE_IDS)[number];

type DailyRoutineStorage = {
  date: string;
  completedIds: string[];
};

type DailyLearningHistoryItem = {
  completedIds: string[];
  completedCount: number;
  totalCount: number;
  updatedAt: string;
};

type DailyLearningHistoryStorage = Record<string, DailyLearningHistoryItem>;

const isRoutineId = (value: unknown): value is RoutineId =>
  typeof value === "string" && (ROUTINE_IDS as readonly string[]).includes(value);

const normalizeCompletedIds = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(isRoutineId)));
};

export const getTodayRoutineCompletedIds = (todayKey: string) => {
  const raw = window.localStorage.getItem(DAILY_ROUTINE_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return [];

    const date = "date" in parsed ? (parsed as { date?: unknown }).date : null;
    const completedIds =
      "completedIds" in parsed ? (parsed as { completedIds?: unknown }).completedIds : null;

    if (date !== todayKey) return [];
    return normalizeCompletedIds(completedIds);
  } catch {
    return [];
  }
};

export const saveTodayRoutineCompletedIds = (
  todayKey: string,
  completedIds: string[],
  totalCount: number = TOTAL_ROUTINE_COUNT,
) => {
  const safeCompletedIds = normalizeCompletedIds(completedIds);

  const routineData: DailyRoutineStorage = {
    date: todayKey,
    completedIds: safeCompletedIds,
  };
  window.localStorage.setItem(DAILY_ROUTINE_STORAGE_KEY, JSON.stringify(routineData));

  try {
    const historyRaw = window.localStorage.getItem(DAILY_LEARNING_HISTORY_STORAGE_KEY);
    const parsedHistory: unknown = historyRaw ? JSON.parse(historyRaw) : {};
    const safeHistory: DailyLearningHistoryStorage =
      typeof parsedHistory === "object" && parsedHistory !== null
        ? { ...(parsedHistory as DailyLearningHistoryStorage) }
        : {};

    safeHistory[todayKey] = {
      completedIds: safeCompletedIds,
      completedCount: safeCompletedIds.length,
      totalCount,
      updatedAt: new Date().toISOString(),
    };

    window.localStorage.setItem(DAILY_LEARNING_HISTORY_STORAGE_KEY, JSON.stringify(safeHistory));
  } catch {
    // localStorage history 값이 손상되어도 루틴 저장은 유지합니다.
  }
};

export const markTodayRoutineCompleted = (routineId: RoutineId) => {
  if (typeof window === "undefined") return;

  const todayKey = getLocalDateKey();
  const completedIds = getTodayRoutineCompletedIds(todayKey);
  if (completedIds.includes(routineId)) return;

  saveTodayRoutineCompletedIds(todayKey, [...completedIds, routineId]);
};

