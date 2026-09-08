import { getWorkoutRecord } from './workoutCompletion.ts';
import type { WorkoutCompletionStore } from './workoutCompletion.ts';
import type { WeightRecordStore } from './recordStorage.ts';
import { CURRENT_WEIGHT_BASELINE_KG } from './currentWorkoutDirection.ts';
import { getLocalDateKey } from './dietPlans.ts';
import { buildAdaptiveWorkoutReview, hasComparablePerformanceDrop, isRecentTrainingDate } from './workoutAdaptiveReview.ts';

export type AdaptiveCoachState = 'safety-hold' | 'recovery' | 'progress' | 'maintain' | 'insufficient';
export interface AdaptiveCoachAdvice {
  state: AdaptiveCoachState;
  headline: string;
  detail: string;
  nextAction: string;
  currentWeightKg: number;
  weightSource: 'record' | 'provided-baseline';
  weightAssessment: string;
}

export function buildAdaptiveCoachAdvice(workouts: WorkoutCompletionStore, weights: WeightRecordStore = {}, today = getLocalDateKey()): AdaptiveCoachAdvice {
  const review = buildAdaptiveWorkoutReview({ workouts, conditions: {}, today, selectedPlanId: 'five-day-fullbody-circuit',
    settings: { weeklyGroups: {}, weeklyMethods: {}, weeklyEdits: {}, exerciseTargets: {}, dateOverrides: {} },
  });
  const recent = Object.entries(workouts).filter(([date]) => isRecentTrainingDate(date, today)).sort(([a], [b]) => b.localeCompare(a)).map(([, value]) => getWorkoutRecord(value));
  const weightEntries = Object.entries(weights).filter(([date, record]) => isRecentTrainingDate(date, today, 36500) && Number.isFinite(record.weight) && record.weight > 0).sort(([a], [b]) => b.localeCompare(a));
  const latestWeight = weightEntries[0]?.[1].weight ?? CURRENT_WEIGHT_BASELINE_KG;
  // One lower reading is not a trend; compare two seven-day averages.
  const average = (values: number[]) => values.length >= 2 ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
  const recentWeight = average(weightEntries.filter(([date]) => isRecentTrainingDate(date, today, 7)).map(([, value]) => value.weight));
  const priorWeight = average(weightEntries.filter(([date]) => isRecentTrainingDate(date, today, 14) && !isRecentTrainingDate(date, today, 7)).map(([, value]) => value.weight));
  const weightDown = recentWeight !== undefined && priorWeight !== undefined && recentWeight < priorWeight;
  const performanceDrop = hasComparablePerformanceDrop(recent);
  const highFatigue = Object.entries(workouts).some(([date, value]) => isRecentTrainingDate(date, today, 7) && (getWorkoutRecord(value).workoutFatigue ?? 0) >= 4);
  return {
    state: review.action === 'hold' ? 'safety-hold' : review.action === 'decrease' ? 'recovery' : review.action === 'increase' ? 'progress' : review.evidenceCount ? 'maintain' : 'insufficient',
    headline: review.title, detail: review.reasons[0], nextAction: review.reasons[1] ?? '',
    currentWeightKg: latestWeight, weightSource: weightEntries.length ? 'record' : 'provided-baseline',
    weightAssessment: weightDown && (performanceDrop || highFatigue)
      ? '주 평균 체중은 내려갔지만 수행 저하나 높은 피로가 함께 보여 감량 속도와 회복 상태를 다시 확인해야 합니다.'
      : weightDown ? '주 평균 체중이 내려가는 중입니다. 근력·반복수·완료율이 유지되는지 함께 확인합니다.'
        : '체중 한 번의 변화보다 주 평균 추세, 운동 수행능력, 피로와 허리 상태를 함께 평가합니다.',
  };
}
