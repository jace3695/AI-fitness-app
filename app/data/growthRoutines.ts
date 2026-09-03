export const GROWTH_ROUTINES_STORAGE_KEY = "ai-yeoni-growth-routines:v1";
export const GROWTH_ROUTINE_LIMIT = 12;

const RETIRED_GROWTH_ROUTINE_TITLES = new Set(["28회 그림 기초 연습"]);
const RETIRED_GROWTH_CONTENT_MARKERS = ["그림 기초", "그림 연습", "드로잉", "drawing-foundations"];

export function isRetiredGrowthRoutine(routine: { title: string }) {
  return RETIRED_GROWTH_ROUTINE_TITLES.has(routine.title.trim());
}

export function includesRetiredGrowthContent(value: unknown) {
  try {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    if (!serialized) return false;
    const text = serialized.toLocaleLowerCase("ko-KR");
    return RETIRED_GROWTH_CONTENT_MARKERS.some((marker) => text.includes(marker));
  } catch {
    return false;
  }
}

export function getGrowthRoutinesStorageKey(userId: string) {
  return `${GROWTH_ROUTINES_STORAGE_KEY}:${userId}`;
}

async function deterministicGrowthUuid(scope: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(scope))).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getGrowthRoutineCloudId(userId: string, localRoutineId: string) {
  return deterministicGrowthUuid(`growth-routine-v1:${userId}:${localRoutineId}`);
}

export function getGrowthLegacySessionCloudId(userId: string, cloudRoutineId: string, date: string) {
  return deterministicGrowthUuid(`growth-session-v2:${userId}:${cloudRoutineId}:${date}`);
}

export const GROWTH_CATEGORIES = [
  { id: "development", label: "AI 허브 개발" },
  { id: "typing", label: "타자" },
  { id: "handwriting", label: "손글씨" },
  { id: "custom", label: "기타" },
] as const;

export type GrowthCategoryId = (typeof GROWTH_CATEGORIES)[number]["id"];

export type GrowthRoutine = {
  id: string;
  category: GrowthCategoryId;
  title: string;
  targetMinutes: number;
  enabled: boolean;
  completedDates: string[];
};

export const DEFAULT_GROWTH_ROUTINES: GrowthRoutine[] = [
  { id: "development-default", category: "development", title: "AI 허브 개발", targetMinutes: 60, enabled: true, completedDates: [] },
  { id: "typing-default", category: "typing", title: "정확도 중심 타자 연습", targetMinutes: 10, enabled: true, completedDates: [] },
  { id: "handwriting-default", category: "handwriting", title: "손글씨 교정 연습", targetMinutes: 15, enabled: true, completedDates: [] },
];

const categoryIds = new Set<GrowthCategoryId>(GROWTH_CATEGORIES.map((item) => item.id));

function cloneDefaults() {
  return DEFAULT_GROWTH_ROUTINES.map((routine) => ({ ...routine, completedDates: [] }));
}

export function normalizeGrowthRoutines(value: unknown): GrowthRoutine[] {
  if (!Array.isArray(value)) return cloneDefaults();

  const ids = new Set<string>();
  const normalized: GrowthRoutine[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || normalized.length >= GROWTH_ROUTINE_LIMIT) continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim().slice(0, 80) : "";
    const title = typeof record.title === "string" ? record.title.trim().slice(0, 60) : "";
    if (!id || !title || ids.has(id)) continue;
    ids.add(id);
    const category = typeof record.category === "string" && categoryIds.has(record.category as GrowthCategoryId)
      ? record.category as GrowthCategoryId
      : "custom";
    const rawMinutes = typeof record.targetMinutes === "number" ? record.targetMinutes : Number(record.targetMinutes);
    const completedDates = Array.isArray(record.completedDates)
      ? Array.from(new Set(record.completedDates.filter(
        (date): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date),
      ))).slice(-90)
      : [];
    normalized.push({
      id,
      category,
      title,
      targetMinutes: Number.isFinite(rawMinutes) ? Math.min(240, Math.max(5, Math.round(rawMinutes))) : 15,
      enabled: record.enabled !== false,
      completedDates,
    });
  }
  return normalized;
}

export function parseGrowthRoutines(raw: string | null): GrowthRoutine[] {
  if (!raw) return cloneDefaults();
  try {
    return normalizeGrowthRoutines(JSON.parse(raw));
  } catch {
    return cloneDefaults();
  }
}

export function toggleGrowthRoutineDate(
  routine: GrowthRoutine,
  dateKey: string,
): GrowthRoutine {
  const completed = routine.completedDates.includes(dateKey);
  return {
    ...routine,
    completedDates: completed
      ? routine.completedDates.filter((date) => date !== dateKey)
      : [...routine.completedDates.filter((date) => date !== dateKey), dateKey].slice(-90),
  };
}

export function growthCategoryLabel(category: GrowthCategoryId) {
  return GROWTH_CATEGORIES.find((item) => item.id === category)?.label ?? "기타";
}
