import { buildBodyWorkoutReview } from './bodyWorkoutReview';
import { readRecordStores, type RecordStores } from './recordStorage';
import { readUserWorkoutSettings } from './userWorkoutSettings';
import { DEFAULT_WEEKLY_WORKOUT_PLAN_ID, SELECTED_WEEKLY_WORKOUT_PLAN_KEY } from './workoutPlans';
import { getLocalDateKey } from './dietPlans';

/** Browser-only read. Never persists or sends the resulting health context. */
export function readLocalBodyReview(stores?: RecordStores) {
  return buildBodyWorkoutReview(
    stores ?? readRecordStores(), readUserWorkoutSettings(),
    window.localStorage.getItem(SELECTED_WEEKLY_WORKOUT_PLAN_KEY) || DEFAULT_WEEKLY_WORKOUT_PLAN_ID,
    getLocalDateKey(),
  );
}
