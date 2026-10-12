import { fastingStartForDay } from '../../lib/diet-time.ts';
import { DIET_COMPLETED_DAYS_KEY, DIET_GOAL_CHECK_ITEMS, DIET_SAFETY_CHECK_ITEMS, DINNER_CARB_CHOICE_KEY, DINNER_COMPLETED_TIME_KEY, LUNCH_CARB_CHOICE_KEY, LUNCH_PROTEIN_CHOICE_KEY, FASTING_START_TIME_KEY, WATER_INTAKE_KEY, getLocalDateKey, normalizeDinnerCarbStore, normalizeLunchCarbStore, normalizeLunchProteinStore } from './dietPlans.ts';
import type { DinnerCarbRecord, LunchCarbRecord, LunchProteinRecord } from './dietPlans.ts';
import { WORKOUT_COMPLETED_DAYS_KEY } from './workoutCompletion.ts';
import type { WorkoutCompletionStore } from './workoutCompletion.ts';
import type { DailyConditionRecord } from './recoveryMode.ts';
import { captureStorageOwner, StorageCorruptionError, readStorageSnapshot, updateStorageBatch, writeStorageBatch } from './storageTransaction.ts';
import type { StorageOwnerToken, StorageReader } from './storageTransaction.ts';

export const WEIGHT_RECORDS_KEY = 'ai-fitness-weight-records';
export const INBODY_RECORDS_KEY = 'ai-fitness-inbody-records';
export const WEIGHT_GOAL_KEY = 'ai-fitness-weight-goal';
export const DAILY_NOTES_KEY = 'ai-fitness-daily-notes';
export const DAILY_CONDITION_KEY_FOR_RECORDS = 'ai-fitness-daily-condition';

export type DietDayRecord = Record<string, unknown> & { meals?: Record<string, boolean>; safetyAlert?: boolean; dietStatus?: string; fastingRecordStatus?: string; fastingHours?: number; fastingSuccess?: boolean; dietMemo?: string };
export type DietCompletedStore = Record<string, DietDayRecord>;
export type NumberStore = Record<string, number>;
export type StringStore = Record<string, string>;

export interface WeightRecord { weight: number; recordedAt: string }
export type WeightRecordStore = Record<string, WeightRecord>;

export interface WeightGoal {
  minKg: number;
  maxKg: number;
}

export const DEFAULT_WEIGHT_GOAL: WeightGoal = { minKg: 65, maxKg: 67 };

export interface InbodyRecord {
  weight?: number;
  bmi?: number;
  musclePercent?: number;
  skeletalMuscleMass?: number;
  muscleMass?: number;
  bodyFatMass?: number;
  fatMass?: number;
  bodyFatPercent?: number;
  visceralFatLevel?: number;
  subcutaneousFatMass?: number;
  subcutaneousFatPercent?: number;
  bodyWaterPercent?: number;
  proteinPercent?: number;
  fatFreeMass?: number;
  boneMass?: number;
  basalMetabolicRate?: number;
  bodyAge?: number;
  bodyScore?: number;
  leftArmFatMass?: number;
  rightArmFatMass?: number;
  leftLegFatMass?: number;
  rightLegFatMass?: number;
  leftArmMuscleMass?: number;
  rightArmMuscleMass?: number;
  leftLegMuscleMass?: number;
  rightLegMuscleMass?: number;
  memo?: string;
}
export type InbodyRecordStore = Record<string, InbodyRecord>;
export type DailyNotesStore = Record<string, string>;
export type DailyConditionStore = Record<string, DailyConditionRecord>;
export interface RecoveryDayRecord { recoveryMode: boolean; reasons: string[]; completedAsRecovery?: boolean; recoveryPriorityOnly?: boolean; recoveryMemo?: string; intensity: 'normal' | '70%' | 'recovery'; updatedAt?: string }
export type RecoveryModeStore = Record<string, RecoveryDayRecord>;
export const RECOVERY_MODE_DAYS_KEY_FOR_RECORDS = 'ai-fitness-recovery-mode-days';

export interface RecordStores {
  workouts: WorkoutCompletionStore;
  diet: DietCompletedStore;
  water: NumberStore;
  dinner: StringStore;
  dinnerCarbs: Record<string, DinnerCarbRecord>;
  lunchCarbs: Record<string, LunchCarbRecord>;
  lunchProteins: Record<string, LunchProteinRecord>;
  fastingStart: string;
  weights: WeightRecordStore;
  inbody: InbodyRecordStore;
  weightGoal: WeightGoal;
  notes: DailyNotesStore;
  recovery: RecoveryModeStore;
  conditions: DailyConditionStore;
}

export function readJson<T>(key: string, fallback: T, source?: Pick<Storage, 'getItem'>): T {
  if (typeof window === 'undefined') return fallback;
  const raw = (source ?? readStorageSnapshot(window.localStorage)).getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export function readJsonForUpdate<T>(snapshot: Pick<StorageReader, 'getItem'>, key: string, fallback: T): T {
  const raw = snapshot.getItem(key);
  if (raw === null) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    if (fallback !== null && (value === null || typeof value !== typeof fallback || Array.isArray(value) !== Array.isArray(fallback))) throw new StorageCorruptionError();
    return value as T;
  } catch { throw new StorageCorruptionError(); }
}

export async function writeJson<T>(key: string, value: T, owner?: StorageOwnerToken): Promise<void> {
  if (typeof window === 'undefined') return;
  await writeStorageBatch(window.localStorage, { [key]: JSON.stringify(value) }, { owner });
}

export async function updateJson<T>(key: string, fallback: T, transform: (current: T) => T, owner?: StorageOwnerToken): Promise<T> {
  if (typeof window === 'undefined') throw new Error('기록 저장은 브라우저에서만 가능합니다.');
  const captured = owner ?? captureStorageOwner();
  let result = fallback;
  await updateStorageBatch(window.localStorage, snapshot => {
    result = transform(readJsonForUpdate(snapshot, key, fallback));
    return { [key]: JSON.stringify(result) };
  }, { owner: captured });
  return result;
}

export function normalizeWeightGoal(value: unknown): WeightGoal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_WEIGHT_GOAL };
  }
  const candidate = value as Partial<WeightGoal>;
  const minKg = Math.round(Number(candidate.minKg) * 10) / 10;
  const maxKg = Math.round(Number(candidate.maxKg) * 10) / 10;
  if (
    !Number.isFinite(minKg) ||
    !Number.isFinite(maxKg) ||
    minKg < 30 ||
    maxKg > 250 ||
    minKg > maxKg
  ) {
    return { ...DEFAULT_WEIGHT_GOAL };
  }
  return { minKg, maxKg };
}

export async function saveWeightGoal(goal: WeightGoal, owner?: StorageOwnerToken) {
  const normalized = normalizeWeightGoal(goal);
  await writeJson(WEIGHT_GOAL_KEY, normalized, owner);
  return normalized;
}

export function readRecordStores(): RecordStores {
  const snapshot = typeof window === 'undefined' ? undefined : readStorageSnapshot(window.localStorage);
  const read = <T,>(key: string, fallback: T) => readJson(key, fallback, snapshot);
  return {
    workouts: read<WorkoutCompletionStore>(WORKOUT_COMPLETED_DAYS_KEY, {}),
    diet: read<DietCompletedStore>(DIET_COMPLETED_DAYS_KEY, {}),
    water: read<NumberStore>(WATER_INTAKE_KEY, {}),
    dinner: read<StringStore>(DINNER_COMPLETED_TIME_KEY, {}),
    dinnerCarbs: normalizeDinnerCarbStore(read<Record<string, unknown>>(DINNER_CARB_CHOICE_KEY, {})),
    lunchCarbs: normalizeLunchCarbStore(read<Record<string, unknown>>(LUNCH_CARB_CHOICE_KEY, {})),
    lunchProteins: normalizeLunchProteinStore(read<Record<string, unknown>>(LUNCH_PROTEIN_CHOICE_KEY, {})),
    fastingStart: typeof window === 'undefined' ? '' : fastingStartForDay(snapshot?.getItem(FASTING_START_TIME_KEY) ?? undefined, getLocalDateKey()),
    weights: read<WeightRecordStore>(WEIGHT_RECORDS_KEY, {}),
    inbody: read<InbodyRecordStore>(INBODY_RECORDS_KEY, {}),
    weightGoal: normalizeWeightGoal(read<unknown>(WEIGHT_GOAL_KEY, DEFAULT_WEIGHT_GOAL)),
    notes: read<DailyNotesStore>(DAILY_NOTES_KEY, {}),
    recovery: read<RecoveryModeStore>(RECOVERY_MODE_DAYS_KEY_FOR_RECORDS, {}),
    conditions: read<DailyConditionStore>(DAILY_CONDITION_KEY_FOR_RECORDS, {}),
  };
}

export function isDietSuccess(record?: DietDayRecord) {
  if (!record) return false;
  return DIET_GOAL_CHECK_ITEMS.every((item) => Boolean(record[item.id]));
}

export function getDietGoalCount(record?: DietDayRecord) {
  return DIET_GOAL_CHECK_ITEMS.filter((item) => Boolean(record?.[item.id])).length;
}

export function hasSafetyAlert(record?: DietDayRecord) {
  return Boolean(record?.safetyAlert) || DIET_SAFETY_CHECK_ITEMS.some((item) => Boolean(record?.[item.id]));
}

export function isTodayKey(dateKey: string) {
  return dateKey === getLocalDateKey();
}

export function getPreviousWeightRecord(weights: WeightRecordStore, dateKey: string) {
  return Object.entries(weights)
    .filter(([key, record]) => key < dateKey && Number.isFinite(record.weight))
    .sort(([a], [b]) => b.localeCompare(a))[0];
}

export function getMonthDateKeys(year: number, monthIndex: number) {
  const end = new Date(year, monthIndex + 1, 0).getDate();
  return Array.from({ length: end }, (_, idx) => getLocalDateKey(new Date(year, monthIndex, idx + 1)));
}
