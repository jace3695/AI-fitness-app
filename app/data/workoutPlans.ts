import { WorkoutDayId } from './workoutCompletion';
import { getWorkoutGroupById, workoutGroupToDayWorkout } from './workoutGroups';

export type WeeklyWorkoutPlanDays = Record<'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday', string>;
export type WeeklyWorkoutPlan = { id: string; name: string; description: string; recommendedFor: string; weekLabel: string; days: WeeklyWorkoutPlanDays; notice?: string };

export const SELECTED_WEEKLY_WORKOUT_PLAN_KEY = 'selectedWeeklyWorkoutPlanId';
export const DEFAULT_WEEKLY_WORKOUT_PLAN_ID = 'week1-cardio-back';

export const WEEKLY_WORKOUT_PLANS: WeeklyWorkoutPlan[] = [
  { id: 'week1-cardio-back', name: '1주차 — 유산소 + 허리 강화 적응 주간', description: '운동 재시작 첫 주용. 월~금 모두 유산소와 허리 안정화 중심으로 진행합니다.', recommendedFor: '운동을 3개월 정도 쉬었거나 허리 부담이 걱정되는 사용자', weekLabel: '1주차', notice: '1주차는 허리 안정화와 유산소 적응을 우선하는 주간입니다. AB 슬라이더와 사이드 플랭크는 허리 부담이 생길 수 있으므로 1주차 기본 루틴에서는 제외합니다.', days: { monday: 'cardio-back-basic-week1', tuesday: 'cardio-back-basic-week1', wednesday: 'cardio-back-basic-week1', thursday: 'cardio-back-basic-week1', friday: 'cardio-back-basic-week1', saturday: 'optional-cardio', sunday: 'rest' } },
  { id: 'week2-basic-strength', name: '2주차 — 유산소 + 기초 근력 적응 주간', description: '유산소 기반을 유지하면서 등·하체·상체 근력운동을 낮은 강도로 다시 연결합니다.', recommendedFor: '1주차 적응 후 덤벨/밴드 운동을 천천히 재개하려는 사용자', weekLabel: '2주차', days: { monday: 'back-band-dumbbell-row', tuesday: 'cardio-back-basic', wednesday: 'lower-dumbbell-loopband', thursday: 'cardio-core-basic', friday: 'upper-dumbbell-longband', saturday: 'optional-cardio', sunday: 'rest' } },
  { id: 'week3-4-switchon-fatloss', name: '3~4주차 — 스위치온 감량 집중 주간', description: '근력운동 빈도를 늘리되 회복형 코어와 선택 유산소를 함께 배치합니다.', recommendedFor: '허리/무릎 통증 없이 2주차 루틴을 소화한 사용자', weekLabel: '3~4주차', days: { monday: 'back-band-dumbbell-row', tuesday: 'lower-dumbbell-loopband', wednesday: 'cardio-core-basic', thursday: 'upper-dumbbell-longband', friday: 'fullbody-light-circuit', saturday: 'optional-cardio', sunday: 'rest' } },
  { id: 'after-month-maintenance', name: '1개월 이후 — 유지/조절 주간', description: '근력운동 주 3회와 유산소/회복일을 섞어 지속 가능한 유지기로 전환합니다.', recommendedFor: '1개월 감량 집중기 이후 컨디션과 일정에 따라 운동량을 조절하려는 사용자', weekLabel: '1개월 이후', days: { monday: 'back-band-dumbbell-row', tuesday: 'optional-cardio', wednesday: 'lower-dumbbell-loopband', thursday: 'cardio-core-basic', friday: 'upper-dumbbell-longband', saturday: 'optional-cardio', sunday: 'rest' } },
];

export const getWeeklyWorkoutPlanById = (id?: string | null) => WEEKLY_WORKOUT_PLANS.find((plan) => plan.id === id) || WEEKLY_WORKOUT_PLANS[0];

export const dayIdToPlanKey: Record<WorkoutDayId, keyof WeeklyWorkoutPlanDays> = { mon: 'monday', tue: 'tuesday', wed: 'wednesday', thu: 'thursday', fri: 'friday', sat: 'saturday', sun: 'sunday' };
export const dayIdToKoreanLabel: Record<WorkoutDayId, string> = { mon: '월요일', tue: '화요일', wed: '수요일', thu: '목요일', fri: '금요일', sat: '토요일', sun: '일요일' };

export function getWorkoutGroupForPlanDay(plan: WeeklyWorkoutPlan, dayId: WorkoutDayId) { return getWorkoutGroupById(plan.days[dayIdToPlanKey[dayId]]); }
export function getDayWorkoutForPlan(plan: WeeklyWorkoutPlan, dayId: WorkoutDayId) { return workoutGroupToDayWorkout(getWorkoutGroupForPlanDay(plan, dayId), dayId, dayIdToKoreanLabel[dayId]); }
