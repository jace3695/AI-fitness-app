import { hasWorkoutRecord } from './growthWorkoutPatterns.ts';
import { normalizeMealCheck } from './freeDietTools.ts';

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;

/** Read-only evidence. Saving a workout is not its start/end time. */
export function dietWorkoutContext(diet: unknown, rawWorkout: unknown, today: string) {
  let workout = rawWorkout;
  if (typeof workout === 'string') {
    try { workout = JSON.parse(workout); } catch { return null; }
  }
  if (workout == null) workout = {};
  if (!object(diet) || !object(workout) || !validDate(today)) return null;
  const start = new Date(Date.parse(`${today}T12:00:00Z`) - 28 * 86400000).toISOString().slice(0, 10);
  const days = [...new Set([...Object.keys(diet), ...Object.keys(workout)])]
    .filter(date => validDate(date) && date >= start && date < today).sort().reverse()
    .map(date => {
      const record = diet[date];
      const meal = object(record) ? record : {};
      const rawClock = meal.lastMealTime;
      return {
        date,
        workout: hasWorkoutRecord(workout[date]),
        afterWorkoutMeal: normalizeMealCheck(meal.afterWorkoutMeal),
        lastMealTime: typeof rawClock === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(rawClock) ? rawClock : null,
        invalidMeal: record != null && !object(record),
        invalidClock: rawClock != null && rawClock !== '' && !(typeof rawClock === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(rawClock)),
      };
    });
  const recorded = days.filter(day => day.workout === true);
  return { start, days, workoutDays: recorded.length, yes: recorded.filter(day => day.afterWorkoutMeal === 'yes').length, no: recorded.filter(day => day.afterWorkoutMeal === 'no').length, unrecorded: recorded.filter(day => day.afterWorkoutMeal === 'unrecorded').length };
}
