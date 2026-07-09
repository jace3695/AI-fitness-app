import { DIET_SYMPTOMS_KEY, SOCIAL_MEAL_MODE_KEY, DietSymptomMap, getLocalDateKey } from './dietPlans';
import { readJson, writeJson } from './recordStorage';
import { WorkoutDayId } from './workoutCompletion';

export const RECOVERY_MODE_DAYS_KEY = 'ai-fitness-recovery-mode-days';
export const SLEEP_STATUS_KEY = 'ai-fitness-sleep-status';
export const ALCOHOL_STATUS_KEY = 'ai-fitness-alcohol-status';
export const WORKOUT_CONDITION_KEY = 'ai-fitness-workout-condition';

export type RecoveryReasonId = 'alcohol-yesterday' | 'hangover' | 'sleep-lack' | 'dizziness' | 'hand-tremor' | 'cold-sweat' | 'severe-headache' | 'back-pain' | 'leg-numbness' | 'heartburn' | 'fasting-high-intensity' | 'social-dinner-yesterday' | 'after-social-meal' | 'fatigue' | 'etc';
export interface RecoveryDayRecord { recoveryMode: boolean; reasons: RecoveryReasonId[]; completedAsRecovery?: boolean; recoveryPriorityOnly?: boolean; intensity: 'normal' | '70%' | 'recovery'; recoveryMemo?: string; updatedAt?: string }
export type RecoveryModeStore = Record<string, RecoveryDayRecord>;

export const RECOVERY_REASON_LABELS: Record<RecoveryReasonId, string> = {
  'alcohol-yesterday': '전날 음주', hangover: '숙취', 'sleep-lack': '수면 부족', dizziness: '어지럼', 'hand-tremor': '손 떨림', 'cold-sweat': '식은땀', 'severe-headache': '심한 두통', 'back-pain': '허리 통증', 'leg-numbness': '다리 저림', heartburn: '속쓰림/위장 불편', 'fasting-high-intensity': '운동 강도 조절 필요', 'social-dinner-yesterday': '저녁 회식 다음 날', 'after-social-meal': '회식 다음 날', fatigue: '피로 누적', etc: '기타',
};

const symptomReasonMap: Partial<Record<keyof DietSymptomMap, RecoveryReasonId>> = {
  alcoholYesterday: 'alcohol-yesterday', hangover: 'hangover', sleepLack: 'sleep-lack', dizziness: 'dizziness', handTremor: 'hand-tremor', coldSweat: 'cold-sweat', severeHeadache: 'severe-headache', backPain: 'back-pain', legNumbness: 'leg-numbness', heartburn: 'heartburn', highIntensityPlanned: 'fasting-high-intensity', afterSocialMeal: 'after-social-meal',
};

function previousDateKey(dateKey: string) { const [y, m, d] = dateKey.split('-').map(Number); const date = new Date(y, (m || 1) - 1, d || 1); date.setDate(date.getDate() - 1); return getLocalDateKey(date); }

export function assessRecoveryMode(dateKey = getLocalDateKey(), workoutDayId?: WorkoutDayId | null): RecoveryDayRecord {
  const symptomsStore = readJson<Record<string, DietSymptomMap>>(DIET_SYMPTOMS_KEY, {});
  const socialStore = readJson<Record<string, string>>(SOCIAL_MEAL_MODE_KEY, {});
  const savedRecovery = readJson<RecoveryModeStore>(RECOVERY_MODE_DAYS_KEY, {});
  const symptoms = symptomsStore[dateKey] || {};
  const reasons = new Set<RecoveryReasonId>(savedRecovery[dateKey]?.reasons || []);

  if (socialStore[previousDateKey(dateKey)] === 'dinner') reasons.add('social-dinner-yesterday');
  Object.entries(symptomReasonMap).forEach(([symptom, reason]) => { if (symptoms[symptom as keyof DietSymptomMap] && reason) reasons.add(reason); });

  const reasonList = Array.from(reasons);
  const isRecovery = reasonList.length > 0;
  const isAlcoholRelated = reasonList.some((reason) => ['alcohol-yesterday', 'hangover', 'social-dinner-yesterday'].includes(reason));
  return { recoveryMode: isRecovery, reasons: reasonList, completedAsRecovery: savedRecovery[dateKey]?.completedAsRecovery, recoveryPriorityOnly: savedRecovery[dateKey]?.recoveryPriorityOnly, intensity: isRecovery ? (isAlcoholRelated ? 'recovery' : '70%') : 'normal', recoveryMemo: savedRecovery[dateKey]?.recoveryMemo, updatedAt: savedRecovery[dateKey]?.updatedAt };
}

export function saveRecoveryRecord(dateKey: string, patch: Partial<RecoveryDayRecord>) {
  const current = readJson<RecoveryModeStore>(RECOVERY_MODE_DAYS_KEY, {});
  const assessed = assessRecoveryMode(dateKey);
  const next: RecoveryModeStore = { ...current, [dateKey]: { ...assessed, ...current[dateKey], ...patch, updatedAt: new Date().toISOString() } };
  writeJson(RECOVERY_MODE_DAYS_KEY, next);
  return next[dateKey];
}

export const RECOVERY_ROUTINE = ['폼롤러 3분', '가벼운 슬라이딩보드 8~10분', '버드독 좌우 6회 × 2세트', '힙 브릿지 10회 × 2세트', '가벼운 스트레칭 5분'];
export const RECOVERY_STOP_CRITERIA = ['허리 통증', '다리 저림', '날카로운 무릎 통증', '어지럼', '메스꺼움', '식은땀', '심한 피로'];
