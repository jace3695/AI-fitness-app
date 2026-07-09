import { getLocalDateKey } from './dietPlans';

export type WorkoutDayId = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
export interface WorkoutDayRecord {
  workoutDone?: boolean;
  workoutRoutineName?: string;
  workoutExerciseNames?: string[];
  workoutSourceDay?: string;
  workoutPain?: boolean;
  workoutMemo?: string;
  cardioDone?: boolean;
  cardioType?: string;
  cardioMinutes?: number;
  cardioMemo?: string;
  pullupDone?: boolean;
  pullupStage?: number;
  pullupExerciseNames?: string[];
  pullupPain?: boolean;
  pullupMemo?: string;
}
export type WorkoutCompletionValue = boolean | WorkoutDayRecord;
export type WorkoutCompletionStore = Record<string, WorkoutCompletionValue>;

export function isWorkoutDone(value?: WorkoutCompletionValue) {
  return typeof value === 'boolean' ? value : Boolean(value?.workoutDone);
}

export function isCardioDone(value?: WorkoutCompletionValue) {
  return typeof value === 'object' && Boolean(value?.cardioDone);
}

export function isPullupDone(value?: WorkoutCompletionValue) {
  return typeof value === 'object' && Boolean(value?.pullupDone);
}

export function getWorkoutRecord(value?: WorkoutCompletionValue): WorkoutDayRecord {
  return typeof value === 'object' && value ? value : { workoutDone: Boolean(value) };
}

export const WORKOUT_COMPLETED_DAYS_KEY = 'ai-fitness-workout-completed-days';
export const WORKOUT_DAY_IDS: WorkoutDayId[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const dayIndexById: Record<WorkoutDayId, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

export function isWorkoutDayId(value: string): value is WorkoutDayId {
  return WORKOUT_DAY_IDS.includes(value as WorkoutDayId);
}

export function getDateForWorkoutDay(dayId: WorkoutDayId, baseDate = new Date()) {
  const current = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const diff = dayIndexById[dayId] - current.getDay();
  current.setDate(current.getDate() + diff);
  return getLocalDateKey(current);
}

export function getWorkoutDayForDate(date = new Date()): WorkoutDayId | null {
  const entry = Object.entries(dayIndexById).find(([, dayIndex]) => dayIndex === date.getDay());
  return entry ? (entry[0] as WorkoutDayId) : null;
}

export function getWeeklyWorkoutCompletion(store: WorkoutCompletionStore, baseDate = new Date()) {
  return WORKOUT_DAY_IDS.reduce<Record<WorkoutDayId, boolean>>((acc, dayId) => {
    acc[dayId] = isWorkoutDone(store[getDateForWorkoutDay(dayId, baseDate)]);
    return acc;
  }, { sun: false, mon: false, tue: false, wed: false, thu: false, fri: false, sat: false });
}

export function readWorkoutCompletionStore(baseDate = new Date()): WorkoutCompletionStore {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(WORKOUT_COMPLETED_DAYS_KEY);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const migrated: WorkoutCompletionStore = {};
    let changed = false;

    Object.entries(parsed).forEach(([key, value]) => {
      if (!value) return;
      if (isWorkoutDayId(key)) {
        migrated[getDateForWorkoutDay(key, baseDate)] = { workoutDone: true };
        changed = true;
        return;
      }
      migrated[key] = typeof value === 'object' && value !== null ? value as WorkoutDayRecord : { workoutDone: true };
    });

    if (changed) {
      window.localStorage.setItem(WORKOUT_COMPLETED_DAYS_KEY, JSON.stringify(migrated));
    }

    return migrated;
  } catch {
    window.localStorage.removeItem(WORKOUT_COMPLETED_DAYS_KEY);
    return {};
  }
}

export function isWorkoutCompletedOnDate(store: WorkoutCompletionStore, date = new Date()) {
  return isWorkoutDone(store[getLocalDateKey(date)]);
}
