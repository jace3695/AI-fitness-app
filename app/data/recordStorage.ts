import { DIET_COMPLETED_DAYS_KEY, DIET_GOAL_CHECK_ITEMS, DIET_SAFETY_CHECK_ITEMS, DINNER_CARB_CHOICE_KEY, DINNER_COMPLETED_TIME_KEY, LUNCH_CARB_CHOICE_KEY, LUNCH_PROTEIN_CHOICE_KEY, FASTING_START_TIME_KEY, WATER_INTAKE_KEY, getLocalDateKey, normalizeDinnerCarbStore, normalizeLunchCarbStore, normalizeLunchProteinStore, DinnerCarbRecord, LunchCarbRecord, LunchProteinRecord } from './dietPlans';
import { WORKOUT_COMPLETED_DAYS_KEY, WorkoutCompletionStore } from './workoutCompletion';

export const WEIGHT_RECORDS_KEY = 'ai-fitness-weight-records';
export const INBODY_RECORDS_KEY = 'ai-fitness-inbody-records';
export const DAILY_NOTES_KEY = 'ai-fitness-daily-notes';

export type DietDayRecord = Record<string, unknown> & { meals?: Record<string, boolean>; safetyAlert?: boolean; dietStatus?: string; fastingRecordStatus?: string; fastingHours?: number; fastingSuccess?: boolean; dietMemo?: string };
export type DietCompletedStore = Record<string, DietDayRecord>;
export type NumberStore = Record<string, number>;
export type StringStore = Record<string, string>;

export interface WeightRecord { weight: number; recordedAt: string }
export type WeightRecordStore = Record<string, WeightRecord>;

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
  notes: DailyNotesStore;
  recovery: RecoveryModeStore;
}

export function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export function writeJson<T>(key: string, value: T) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function readRecordStores(): RecordStores {
  return {
    workouts: readJson<WorkoutCompletionStore>(WORKOUT_COMPLETED_DAYS_KEY, {}),
    diet: readJson<DietCompletedStore>(DIET_COMPLETED_DAYS_KEY, {}),
    water: readJson<NumberStore>(WATER_INTAKE_KEY, {}),
    dinner: readJson<StringStore>(DINNER_COMPLETED_TIME_KEY, {}),
    dinnerCarbs: normalizeDinnerCarbStore(readJson<Record<string, unknown>>(DINNER_CARB_CHOICE_KEY, {})),
    lunchCarbs: normalizeLunchCarbStore(readJson<Record<string, unknown>>(LUNCH_CARB_CHOICE_KEY, {})),
    lunchProteins: normalizeLunchProteinStore(readJson<Record<string, unknown>>(LUNCH_PROTEIN_CHOICE_KEY, {})),
    fastingStart: typeof window === 'undefined' ? '' : window.localStorage.getItem(FASTING_START_TIME_KEY) || '',
    weights: readJson<WeightRecordStore>(WEIGHT_RECORDS_KEY, {}),
    inbody: readJson<InbodyRecordStore>(INBODY_RECORDS_KEY, {}),
    notes: readJson<DailyNotesStore>(DAILY_NOTES_KEY, {}),
    recovery: readJson<RecoveryModeStore>(RECOVERY_MODE_DAYS_KEY_FOR_RECORDS, {}),
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
