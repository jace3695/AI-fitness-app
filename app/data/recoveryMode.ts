import { DIET_SYMPTOMS_KEY, SOCIAL_MEAL_MODE_KEY, DietSymptomMap, getLocalDateKey } from './dietPlans';
import { readJson, writeJson } from './recordStorage';
import { WorkoutDayId } from './workoutCompletion';

export const RECOVERY_MODE_DAYS_KEY = 'ai-fitness-recovery-mode-days';
export const DAILY_CONDITION_KEY = 'ai-fitness-daily-condition';
export const SLEEP_STATUS_KEY = 'ai-fitness-sleep-status';
export const ALCOHOL_STATUS_KEY = 'ai-fitness-alcohol-status';
export const WORKOUT_CONDITION_KEY = 'ai-fitness-workout-condition';

export type RecoveryReasonId = 'alcohol-yesterday' | 'hangover' | 'sleep-lack' | 'dizziness' | 'hand-tremor' | 'cold-sweat' | 'severe-headache' | 'back-pain' | 'leg-numbness' | 'ankle-pain' | 'heartburn' | 'fasting-high-intensity' | 'social-dinner-yesterday' | 'after-social-meal' | 'fatigue' | 'etc';
export interface RecoveryDayRecord { recoveryMode: boolean; reasons: RecoveryReasonId[]; completedAsRecovery?: boolean; recoveryPriorityOnly?: boolean; intensity: 'normal' | '70%' | 'recovery'; recoveryMemo?: string; updatedAt?: string }
export type RecoveryModeStore = Record<string, RecoveryDayRecord>;
export type ConditionRecommendation = 'normal' | '70%' | 'recovery';
export type ConditionSignalId = 'mild-back-discomfort' | 'marked-back-pain' | 'leg-numbness' | 'ankle-pain' | 'sleep-lack' | 'fatigue' | 'dizziness' | 'hand-tremor' | 'cold-sweat' | 'severe-headache' | 'heartburn';
export interface DailyConditionRecord { signals: ConditionSignalId[]; recommendation: ConditionRecommendation; memo?: string; updatedAt: string }
export type DailyConditionStore = Record<string, DailyConditionRecord>;

export const CONDITION_SIGNAL_OPTIONS: { id: ConditionSignalId; label: string; group: 'body' | 'condition' }[] = [
  { id: 'mild-back-discomfort', label: '가벼운 허리 불편', group: 'body' },
  { id: 'marked-back-pain', label: '뚜렷한 허리 통증', group: 'body' },
  { id: 'leg-numbness', label: '다리 저림', group: 'body' },
  { id: 'ankle-pain', label: '발목 통증', group: 'body' },
  { id: 'sleep-lack', label: '수면 부족', group: 'condition' },
  { id: 'fatigue', label: '피로 누적', group: 'condition' },
  { id: 'dizziness', label: '어지럼', group: 'condition' },
  { id: 'hand-tremor', label: '손 떨림', group: 'condition' },
  { id: 'cold-sweat', label: '식은땀', group: 'condition' },
  { id: 'severe-headache', label: '심한 두통', group: 'condition' },
  { id: 'heartburn', label: '속쓰림', group: 'condition' },
];

export const RECOVERY_REASON_LABELS: Record<RecoveryReasonId, string> = {
  'alcohol-yesterday': '전날 음주', hangover: '숙취', 'sleep-lack': '수면 부족', dizziness: '어지럼', 'hand-tremor': '손 떨림', 'cold-sweat': '식은땀', 'severe-headache': '심한 두통', 'back-pain': '허리 통증', 'leg-numbness': '다리 저림', 'ankle-pain': '발목 통증', heartburn: '속쓰림/위장 불편', 'fasting-high-intensity': '운동 강도 조절 필요', 'social-dinner-yesterday': '저녁 회식 다음 날', 'after-social-meal': '회식 다음 날', fatigue: '피로 누적', etc: '기타',
};

const symptomReasonMap: Partial<Record<keyof DietSymptomMap, RecoveryReasonId>> = {
  alcoholYesterday: 'alcohol-yesterday', hangover: 'hangover', sleepLack: 'sleep-lack', dizziness: 'dizziness', handTremor: 'hand-tremor', coldSweat: 'cold-sweat', severeHeadache: 'severe-headache', backPain: 'back-pain', legNumbness: 'leg-numbness', heartburn: 'heartburn', highIntensityPlanned: 'fasting-high-intensity', afterSocialMeal: 'after-social-meal',
};

const conditionReasonMap: Record<ConditionSignalId, RecoveryReasonId> = {
  'mild-back-discomfort': 'back-pain',
  'marked-back-pain': 'back-pain',
  'leg-numbness': 'leg-numbness',
  'ankle-pain': 'ankle-pain',
  'sleep-lack': 'sleep-lack',
  fatigue: 'fatigue',
  dizziness: 'dizziness',
  'hand-tremor': 'hand-tremor',
  'cold-sweat': 'cold-sweat',
  'severe-headache': 'severe-headache',
  heartburn: 'heartburn',
};

const RECOVERY_SIGNALS = new Set<ConditionSignalId>(['marked-back-pain', 'leg-numbness', 'ankle-pain', 'dizziness', 'hand-tremor', 'cold-sweat', 'severe-headache']);

export function getConditionRecommendation(signals: ConditionSignalId[]): ConditionRecommendation {
  if (signals.some((signal) => RECOVERY_SIGNALS.has(signal))) return 'recovery';
  return signals.length ? '70%' : 'normal';
}

export function readDailyCondition(dateKey = getLocalDateKey()) {
  return readJson<DailyConditionStore>(DAILY_CONDITION_KEY, {})[dateKey];
}

export function saveDailyCondition(dateKey: string, signals: ConditionSignalId[], memo = '') {
  const current = readJson<DailyConditionStore>(DAILY_CONDITION_KEY, {});
  const previousReasonIds = new Set((current[dateKey]?.signals || []).map((signal) => conditionReasonMap[signal]));
  if (previousReasonIds.size) {
    const recoveryStore = readJson<RecoveryModeStore>(RECOVERY_MODE_DAYS_KEY, {});
    const savedRecovery = recoveryStore[dateKey];
    if (savedRecovery) {
      writeJson(RECOVERY_MODE_DAYS_KEY, {
        ...recoveryStore,
        [dateKey]: {
          ...savedRecovery,
          reasons: savedRecovery.reasons.filter((reason) => !previousReasonIds.has(reason)),
        },
      });
    }
  }
  const record: DailyConditionRecord = {
    signals,
    recommendation: getConditionRecommendation(signals),
    memo: memo.trim() || undefined,
    updatedAt: new Date().toISOString(),
  };
  writeJson(DAILY_CONDITION_KEY, { ...current, [dateKey]: record });
  return record;
}

export function clearDailyCondition(dateKey: string) {
  const current = readJson<DailyConditionStore>(DAILY_CONDITION_KEY, {});
  const conditionReasons = new Set((current[dateKey]?.signals || []).map((signal) => conditionReasonMap[signal]));
  const { [dateKey]: _removed, ...next } = current;
  writeJson(DAILY_CONDITION_KEY, next);
  if (conditionReasons.size) {
    const recoveryStore = readJson<RecoveryModeStore>(RECOVERY_MODE_DAYS_KEY, {});
    const savedRecovery = recoveryStore[dateKey];
    if (savedRecovery) {
      writeJson(RECOVERY_MODE_DAYS_KEY, {
        ...recoveryStore,
        [dateKey]: {
          ...savedRecovery,
          reasons: savedRecovery.reasons.filter((reason) => !conditionReasons.has(reason)),
        },
      });
    }
  }
}

function previousDateKey(dateKey: string) { const [y, m, d] = dateKey.split('-').map(Number); const date = new Date(y, (m || 1) - 1, d || 1); date.setDate(date.getDate() - 1); return getLocalDateKey(date); }

export function assessRecoveryMode(dateKey = getLocalDateKey(), workoutDayId?: WorkoutDayId | null): RecoveryDayRecord {
  const symptomsStore = readJson<Record<string, DietSymptomMap>>(DIET_SYMPTOMS_KEY, {});
  const socialStore = readJson<Record<string, string>>(SOCIAL_MEAL_MODE_KEY, {});
  const savedRecovery = readJson<RecoveryModeStore>(RECOVERY_MODE_DAYS_KEY, {});
  const condition = readDailyCondition(dateKey);
  const symptoms = symptomsStore[dateKey] || {};
  const reasons = new Set<RecoveryReasonId>(savedRecovery[dateKey]?.reasons || []);

  if (socialStore[previousDateKey(dateKey)] === 'dinner') reasons.add('social-dinner-yesterday');
  Object.entries(symptomReasonMap).forEach(([symptom, reason]) => { if (symptoms[symptom as keyof DietSymptomMap] && reason) reasons.add(reason); });
  condition?.signals.forEach((signal) => reasons.add(conditionReasonMap[signal]));

  const reasonList = Array.from(reasons);
  const saved = savedRecovery[dateKey];
  const requiresRecovery = condition?.recommendation === 'recovery' || reasonList.some((reason) => ['hangover', 'dizziness', 'hand-tremor', 'cold-sweat', 'severe-headache', 'leg-numbness', 'ankle-pain'].includes(reason)) || saved?.recoveryPriorityOnly;
  const isRecovery = reasonList.length > 0 || Boolean(saved?.completedAsRecovery);
  return { recoveryMode: isRecovery, reasons: reasonList, completedAsRecovery: saved?.completedAsRecovery, recoveryPriorityOnly: saved?.recoveryPriorityOnly, intensity: isRecovery ? (requiresRecovery ? 'recovery' : '70%') : 'normal', recoveryMemo: saved?.recoveryMemo || condition?.memo, updatedAt: saved?.updatedAt || condition?.updatedAt };
}

export function saveRecoveryRecord(dateKey: string, patch: Partial<RecoveryDayRecord>) {
  const current = readJson<RecoveryModeStore>(RECOVERY_MODE_DAYS_KEY, {});
  const assessed = assessRecoveryMode(dateKey);
  const next: RecoveryModeStore = { ...current, [dateKey]: { ...assessed, ...current[dateKey], ...patch, updatedAt: new Date().toISOString() } };
  writeJson(RECOVERY_MODE_DAYS_KEY, next);
  return next[dateKey];
}

export const RECOVERY_ROUTINE = ['폼롤러 회복 5~10분', '가벼운 호흡 1~2분', '가벼운 스트레칭 3~5분', '허리 아래쪽 직접 폼롤링 금지', '종아리·허벅지 앞·허벅지 바깥쪽·엉덩이·등 위쪽 중심'];
export const RECOVERY_STOP_CRITERIA = ['허리 통증', '다리 저림', '날카로운 무릎 통증', '어지럼', '메스꺼움', '식은땀', '심한 피로'];
