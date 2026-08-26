import type { CloudState } from "./cloudSync";

export const LANGUAGE_STORAGE_KEYS = [
  "dailyRoutineProgress", "dailyLearningHistory", "integratedLearningSettingsV1",
  "japaneseCurriculumProgressV1", "japaneseCurriculumReviewV1", "japaneseAppSettings",
  "learningSettings", "savedWords", "savedSentences", "wrongKana", "wrongKanaChars",
  "wrongWords", "wrongSentences", "grammarProgress", "reviewCompletedItemsByDate",
] as const;

const LANGUAGE_SYNC_BASE_PREFIX = "language-cloud-sync-base:";
const LANGUAGE_LAST_USER_KEY = "language-cloud-sync-user";

export type LanguageState = Record<string, string>;

export function readLanguageState(): LanguageState {
  if (typeof window === "undefined") return {};
  const state: LanguageState = {};
  for (const key of LANGUAGE_STORAGE_KEYS) {
    const value = window.localStorage.getItem(key);
    if (value !== null) state[key] = value;
  }
  return state;
}

export function applyLanguageState(state: CloudState) {
  if (typeof window === "undefined") return;
  for (const key of LANGUAGE_STORAGE_KEYS) {
    const value = state[key];
    if (typeof value === "string") window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  }
}

export function clearLanguageLocalState() {
  if (typeof window === "undefined") return;
  for (const key of LANGUAGE_STORAGE_KEYS) window.localStorage.removeItem(key);
  const baseKeys = Array.from(
    { length: window.localStorage.length },
    (_, index) => window.localStorage.key(index),
  ).filter((key): key is string => Boolean(key?.startsWith(LANGUAGE_SYNC_BASE_PREFIX)));
  baseKeys.forEach((key) => window.localStorage.removeItem(key));
  window.localStorage.removeItem(LANGUAGE_LAST_USER_KEY);
}

export function prepareLanguageLocalState(userId: string) {
  if (typeof window === "undefined") return;
  const previousUserId = window.localStorage.getItem(LANGUAGE_LAST_USER_KEY);
  if (previousUserId && previousUserId !== userId) {
    for (const key of LANGUAGE_STORAGE_KEYS) window.localStorage.removeItem(key);
  }
  window.localStorage.setItem(LANGUAGE_LAST_USER_KEY, userId);
}

export function readLanguageSyncBase(userId: string): LanguageState | null {
  if (typeof window === "undefined") return null;
  const key = `${LANGUAGE_SYNC_BASE_PREFIX}${userId}`;
  try {
    return JSON.parse(window.localStorage.getItem(key) || "null") as LanguageState | null;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

export function saveLanguageSyncBase(userId: string, state: CloudState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${LANGUAGE_SYNC_BASE_PREFIX}${userId}`, JSON.stringify(state));
}
