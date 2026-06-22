export type DietPhaseId = 'week1' | 'week2' | 'week3' | 'week4' | 'maintenance';
export type DietMode = 'auto' | 'manual';
export type ProteinChoice = 'none' | 'half' | 'full';
export type ProteinGramChoice = '20' | '25' | '30' | 'custom';
export type DinnerCarbChoice = 'none' | '50' | '80' | '100' | 'third-bowl' | 'half-bowl' | 'two-third-bowl' | 'one-bowl' | 'custom';
export type DinnerRiceType = '흰쌀밥' | '잡곡밥' | '현미밥' | '통곡물밥' | '곤약밥' | '기타';
export interface DinnerCarbRecord { riceType: DinnerRiceType; amountType: DinnerCarbChoice; grams: number; customRiceType: string; estimatedCarbs: number }
export type SocialMealMode = 'none' | 'lunch' | 'dinner';
export type FastingMode = 'none' | '24h';

export const DIET_PHASE_KEY = 'ai-fitness-diet-phase';
export const DIET_START_DATE_KEY = 'ai-fitness-diet-start-date';
export const DIET_COMPLETED_DAYS_KEY = 'ai-fitness-diet-completed-days';
export const DIET_MEAL_LOG_KEY = 'ai-fitness-diet-meal-log';
export const PROTEIN_TOTAL_KEY = 'ai-fitness-protein-total';
export const FASTING_START_TIME_KEY = 'ai-fitness-fasting-start-time';
export const FASTING_MODE_KEY = 'ai-fitness-fasting-mode';
export const FASTING_COMPLETED_KEY = 'ai-fitness-fasting-completed';
export const WATER_INTAKE_KEY = 'ai-fitness-water-intake';
export const DINNER_CARB_CHOICE_KEY = 'ai-fitness-dinner-carb-choice';
export const SOCIAL_MEAL_MODE_KEY = 'ai-fitness-social-meal-mode';
export const DIET_SYMPTOMS_KEY = 'ai-fitness-diet-symptoms';
export const WORKOUT_COMPLETED_DAYS_KEY = 'ai-fitness-workout-completed-days';

export const DIET_MODE_KEY = `${DIET_PHASE_KEY}-mode`;
export const DINNER_COMPLETED_TIME_KEY = 'ai-fitness-diet-dinner-completed-time';

export const PROTEIN_TARGET_GRAMS = 120;
export const FULL_SHAKE_PROTEIN = 31;
export const HALF_SHAKE_PROTEIN = 16;

export interface MealPlan { id: string; time: string; title: string; items: string[]; options?: string[]; note?: string }
export interface DietPlan { id: DietPhaseId; shortLabel: string; label: string; description: string; badge: string; fasting: string[]; safety: string[] }

export interface DietMealLog {
  breakfastShake: boolean;
  lunchRice: boolean;
  lunchProteinChoice: ProteinGramChoice;
  lunchProteinCustom: number;
  afternoonShake: ProteinChoice;
  dinnerProteinChoice: ProteinGramChoice;
  dinnerProteinCustom: number;
  dinnerCarb: DinnerCarbChoice;
  afterDinnerShake: ProteinChoice;
  lastMealTime: string;
}

export type DietSymptomId = 'alcoholYesterday' | 'hangover' | 'afterSocialMeal' | 'sleepLack' | 'dizziness' | 'handTremor' | 'coldSweat' | 'severeHeadache' | 'backPain' | 'legNumbness' | 'heartburn' | 'highIntensityPlanned';
export type DietSymptomMap = Partial<Record<DietSymptomId, boolean>>;

export const DEFAULT_MEAL_LOG: DietMealLog = {
  breakfastShake: true,
  lunchRice: true,
  lunchProteinChoice: '20',
  lunchProteinCustom: 20,
  afternoonShake: 'half',
  dinnerProteinChoice: '20',
  dinnerProteinCustom: 20,
  dinnerCarb: 'none',
  afterDinnerShake: 'half',
  lastMealTime: '18:30',
};

export const COMMON_DIET_RULES = [
  '일반식 기반: 점심은 통곡물밥 100~130g + 실제 식품 단백질 20g 이상 + 채소',
  '저녁은 단백질 20g 이상 + 채소 중심, 밥은 기본 제외',
  '저녁 밥은 기본 제외, 필요 시 조리된 밥 기준 50~80g 밥량 우선',
  '퓨어프로틴7은 의무 식사가 아니라 단백질 보충 선택지',
  '기본 공복 목표는 매일 14시간, 24시간 단식은 선택 기능',
  '운동 시간: 월/화/목/금/토 20:00~20:40',
  '목표 단백질: 하루 약 120g 전후',
  '물 목표: 하루 2L 이상',
];


export const DINNER_RICE_TYPES: DinnerRiceType[] = ['흰쌀밥', '잡곡밥', '현미밥', '통곡물밥', '곤약밥', '기타'];
export const DINNER_CARB_OPTIONS: { id: DinnerCarbChoice; label: string; grams: number; note?: string }[] = [
  { id: 'none', label: '없음', grams: 0 },
  { id: '50', label: '50g 밥량', grams: 50 },
  { id: '80', label: '80g 밥량', grams: 80 },
  { id: '100', label: '100g 밥량', grams: 100 },
  { id: 'third-bowl', label: '1/3공기, 약 70g 밥량', grams: 70 },
  { id: 'half-bowl', label: '반 공기, 약 100g 밥량', grams: 100 },
  { id: 'two-third-bowl', label: '2/3공기, 약 130g 밥량', grams: 130 },
  { id: 'one-bowl', label: '1공기, 약 200g 밥량', grams: 200, note: '많음 / 특별한 경우' },
  { id: 'custom', label: '직접 입력', grams: 0 },
];
export const DEFAULT_DINNER_CARB_RECORD: DinnerCarbRecord = { riceType: '잡곡밥', amountType: 'none', grams: 0, customRiceType: '', estimatedCarbs: 0 };
export function estimateDinnerRiceCarbs(grams: number) { return Math.max(0, Math.round((Number(grams) || 0) * 0.3)); }
export function getDinnerCarbOption(choice: DinnerCarbChoice) { return DINNER_CARB_OPTIONS.find((option) => option.id === choice) || DINNER_CARB_OPTIONS[0]; }
function isDinnerCarbChoice(value: unknown): value is DinnerCarbChoice { return DINNER_CARB_OPTIONS.some((option) => option.id === value); }
export function normalizeDinnerCarbRecord(value: unknown): DinnerCarbRecord {
  if (value && typeof value === 'object') {
    const record = value as Partial<DinnerCarbRecord>;
    const amountType = isDinnerCarbChoice(record.amountType) ? record.amountType : 'none';
    const option = getDinnerCarbOption(amountType);
    const grams = amountType === 'custom' ? Math.max(0, Math.floor(Number(record.grams) || 0)) : option.grams;
    const riceType = DINNER_RICE_TYPES.includes(record.riceType as DinnerRiceType) ? record.riceType as DinnerRiceType : '잡곡밥';
    return { riceType, amountType, grams, customRiceType: String(record.customRiceType || ''), estimatedCarbs: amountType === 'none' ? 0 : estimateDinnerRiceCarbs(grams) };
  }
  if (typeof value === 'number') return normalizeDinnerCarbRecord({ amountType: 'custom', grams: value });
  if (typeof value === 'string' && isDinnerCarbChoice(value)) {
    const option = getDinnerCarbOption(value);
    return { ...DEFAULT_DINNER_CARB_RECORD, amountType: value, grams: option.grams, estimatedCarbs: estimateDinnerRiceCarbs(option.grams) };
  }
  return DEFAULT_DINNER_CARB_RECORD;
}
export function normalizeDinnerCarbStore(value: unknown): Record<string, DinnerCarbRecord> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([date, record]) => [date, normalizeDinnerCarbRecord(record)]));
}
export function formatDinnerCarbRecord(record?: DinnerCarbRecord) {
  const normalized = normalizeDinnerCarbRecord(record);
  if (normalized.amountType === 'none' || normalized.grams <= 0) return { rice: '저녁 밥: 없음', carbs: '' };
  const riceName = normalized.riceType === '기타' ? (normalized.customRiceType.trim() || '기타 밥') : normalized.riceType;
  const option = getDinnerCarbOption(normalized.amountType);
  const amountLabel = normalized.amountType === 'custom' ? `직접 입력 ${normalized.grams}g 밥량` : option.label;
  return { rice: `저녁 밥: ${riceName} ${amountLabel}`, carbs: `참고 탄수화물: 약 ${normalized.estimatedCarbs}g` };
}

export const SAFETY_WARNING = '어지러움, 손 떨림, 식은땀, 심한 두통, 수면 부족, 허리 통증 악화, 다리 저림, 속쓰림 또는 회식·음주 다음 날에는 24시간 단식을 하지 말고 12~14시간 공복과 회복을 우선하세요.';

export const DIET_CHECK_ITEMS = [
  { id: 'water2l', label: '오늘 물 2L 달성' },
  { id: 'dinnerBefore1830', label: '저녁 식사 시간 기록' },
  { id: 'fasting14h', label: '14시간 공복 달성' },
  { id: 'noDinnerCarbs', label: '저녁 밥 없음 또는 계획량(조리된 밥 기준 50~80g 우선)만 섭취' },
  { id: 'proteinDone', label: '하루 단백질 목표 관리' },
  { id: 'lunchProtein', label: '점심 실제 식품 단백질 20g 이상' },
  { id: 'backPain', label: '허리 통증 발생', safety: true },
  { id: 'legNumbness', label: '다리 저림 발생', safety: true },
  { id: 'dizzinessHeadache', label: '어지러움·두통 발생', safety: true },
] as const;
export const DIET_GOAL_CHECK_ITEMS = DIET_CHECK_ITEMS.filter((item) => !('safety' in item));
export const DIET_SAFETY_CHECK_ITEMS = DIET_CHECK_ITEMS.filter((item) => 'safety' in item);
export type DietCheckId = (typeof DIET_CHECK_ITEMS)[number]['id'];
export type DietCheckMap = Partial<Record<DietCheckId, boolean>>;

export const DIET_PLANS: Record<DietPhaseId, DietPlan> = {
  week1: { id: 'week1', shortLabel: '14시간 적응', label: '1주차', badge: '24시간 단식 없음', description: '야식 끊기, 저녁 탄수 줄이기, 식사 리듬 정리가 목표입니다.', fasting: ['매일 14시간 공복 적응', '24시간 단식 없음'], safety: ['컨디션과 운동 지속성을 최우선으로 합니다.'] },
  week2: { id: 'week2', shortLabel: '선택 단식 검토', label: '2주차', badge: '주 0~1회 선택', description: '14시간 공복을 유지하고 24시간 단식은 운동 없는 수요일 또는 일요일에만 선택합니다.', fasting: ['24시간 단식은 주 0~1회만 허용', '단식일에는 걷기·스트레칭·회복 운동만 안내'], safety: ['강한 슬라이딩보드, 전신 서킷 금지'] },
  week3: { id: 'week3', shortLabel: '컨디션 조건부', label: '3주차', badge: '연속 단식 금지', description: '최근 2주간 위험 신호가 없을 때만 주 1회 유지 또는 주 2회까지 검토합니다.', fasting: ['단식일 사이 최소 2일 이상 간격', '회식 후 과식 반동이 있으면 단식 비추천'], safety: ['어지러움·손 떨림·허리 통증·다리 저림 확인'] },
  week4: { id: 'week4', shortLabel: '유지 전환', label: '4주차', badge: '주 1회 이하 기본', description: '24시간 단식은 기본 추천 주 1회 이하이며 주 2회 이상은 자동 추천하지 않습니다.', fasting: ['주 2회는 사용자가 직접 선택한 경우만 허용', '주 3회 24시간 단식은 기본 플랜 제외'], safety: ['연속 단식 금지'] },
  maintenance: { id: 'maintenance', shortLabel: '생활 유지', label: '4주 이후 유지기', badge: '회식 후 복귀', description: '체중 감량보다 회식 후 빠른 복귀와 생활 유지가 목표입니다.', fasting: ['14시간 공복 주 4~5회 이상', '24시간 단식은 격주 1회 / 주 1회 / 주 2회 중 사용자 선택'], safety: ['컨디션이 흔들리면 12~14시간 공복으로 낮춥니다.'] },
};
export const DIET_PHASE_OPTIONS = Object.values(DIET_PLANS).map((p) => ({ id: p.id, label: `${p.label} · ${p.shortLabel}` }));

export function getLocalDateKey(date = new Date()) { const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, '0'); const d = String(date.getDate()).padStart(2, '0'); return `${y}-${m}-${d}`; }
export function getSwitchOnDay(startDate: string, today = new Date()) { const fallback = getLocalDateKey(today); const [y, m, d] = (startDate || fallback).split('-').map(Number); const start = new Date(y, (m || 1) - 1, d || 1); const current = new Date(today.getFullYear(), today.getMonth(), today.getDate()); return Math.max(1, Math.floor((current.getTime() - start.getTime()) / 86400000) + 1); }
export function getAutoDietPhase(day: number): DietPhaseId { if (day <= 7) return 'week1'; if (day <= 14) return 'week2'; if (day <= 21) return 'week3'; if (day <= 28) return 'week4'; return 'maintenance'; }
export function getDietStatusText(day: number, phase: DietPhaseId) { const plan = DIET_PLANS[phase]; if (phase === 'maintenance') return '스위치온 유지기'; return `${plan.label} ${day}일차 · ${plan.shortLabel}`; }
export function proteinChoiceGrams(choice: ProteinChoice) { if (choice === 'full') return FULL_SHAKE_PROTEIN; if (choice === 'half') return HALF_SHAKE_PROTEIN; return 0; }
export function mealProteinGrams(choice: ProteinGramChoice, custom: number) { return choice === 'custom' ? Math.max(0, Number(custom) || 0) : Number(choice); }
export function calculateProteinTotal(log: DietMealLog) { return (log.breakfastShake ? FULL_SHAKE_PROTEIN : 0) + proteinChoiceGrams(log.afternoonShake) + proteinChoiceGrams(log.afterDinnerShake) + mealProteinGrams(log.lunchProteinChoice, log.lunchProteinCustom) + mealProteinGrams(log.dinnerProteinChoice, log.dinnerProteinCustom); }
export function getProteinStatus(total: number) { if (total < 100) return { label: '단백질 보충 권장', color: 'text-amber-700', bg: 'bg-amber-50' }; if (total <= 135 && total >= 110) return { label: '목표 범위', color: 'text-green-700', bg: 'bg-green-50' }; if (total <= 150) return { label: '충분', color: 'text-blue-700', bg: 'bg-blue-50' }; return { label: '수분 섭취와 소화 상태를 확인하세요', color: 'text-red-700', bg: 'bg-red-50' }; }
