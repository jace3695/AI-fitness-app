import { getLocalDateKey } from './dietPlans';

export type WorkoutDayId = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
export type WorkoutCompletionStore = Record<string, boolean>;

export const WORKOUT_COMPLETED_DAYS_KEY = 'ai-fitness-workout-completed-days';
export const WORKOUT_DAY_IDS: WorkoutDayId[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const dayIndexById: Record<WorkoutDayId, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

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
    acc[dayId] = Boolean(store[getDateForWorkoutDay(dayId, baseDate)]);
    return acc;
  }, { mon: false, tue: false, wed: false, thu: false, fri: false, sat: false });
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
        migrated[getDateForWorkoutDay(key, baseDate)] = true;
        changed = true;
        return;
      }
      migrated[key] = true;
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
  return Boolean(store[getLocalDateKey(date)]);
}
