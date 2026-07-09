export type DietPhaseId = 'week1' | 'week2' | 'week3' | 'week4' | 'maintenance';
export type DietMode = 'auto' | 'manual';
export type ProteinChoice = 'none' | 'half' | 'full';
export type ProteinGramChoice = '20' | '25' | '30' | 'custom';
export type DinnerCarbChoice = 'none' | '50' | '80' | '100' | 'third-bowl' | 'half-bowl' | 'two-third-bowl' | 'one-bowl' | 'custom';
export type LunchCarbChoice = DinnerCarbChoice;
export type DinnerRiceType = '흰쌀밥' | '잡곡밥' | '현미밥' | '통곡물밥' | '곤약밥' | '기타';
export interface DinnerCarbRecord { riceType: DinnerRiceType; amountType: DinnerCarbChoice; grams: number; customRiceType: string; estimatedCarbs: number }
export type LunchCarbRecord = DinnerCarbRecord;
export interface LunchProteinRecord { type: ProteinChoice | 'custom'; protein: number; customProtein: number }
export type SocialMealMode = 'none' | 'lunch' | 'dinner';
export type FastingMode = 'none';

export type DietStatus = 'good' | 'normal' | 'shaky' | 'dining' | 'recovery';
export type FastingRecordStatus = '14h' | '12h' | 'missed';
export interface SimpleDietRecommendation { id: string; title: string; items: string[] }
export const DIET_STATUS_LABELS: Record<DietStatus, string> = { good: '좋음', normal: '보통', shaky: '흔들림', dining: '회식/외식', recovery: '컨디션 조절' };
export const FASTING_STATUS_LABELS: Record<FastingRecordStatus, string> = { '14h': '14시간 달성', '12h': '12시간 조절', missed: '미달성' };
export const simpleDietRecommendations: SimpleDietRecommendation[] = [
  { id: 'breakfast', title: '아침 추천', items: ['퓨어프로틴7 1회', '물 1컵', '속이 불편하면 양을 줄이거나 천천히 섭취'] },
  { id: 'lunch', title: '점심 추천', items: ['통곡물밥 100~130g', '닭가슴살 / 생선 / 계란 / 두부 / 살코기 중 1개', '채소 반찬 1~2가지'] },
  { id: 'afternoon', title: '오후 보충 추천', items: ['퓨어프로틴7 0.5회', '허기가 크면 1회', '견과류는 필요할 때만 15~20g'] },
  { id: 'dinner', title: '저녁 추천', items: ['단백질 20g 이상', '채소 포함', '밥은 기본 제외', '운동 전 기운 부족, 야식 위험, 점심 부족 시 통곡물밥 50~80g 허용'] },
  { id: 'dining', title: '회식/외식 추천', items: ['구이 고기, 수육, 생선, 회, 샤브샤브, 두부, 계란 우선', '밥/면은 하나만 선택하고 과식하지 않기', '술 1잔당 물 1잔 권장'] },
  { id: 'low-condition', title: '컨디션 저하일 추천', items: ['12시간 공복으로 조절 가능', '속쓰림·어지럼·손떨림이 있으면 회복 우선', '단백질과 수분은 유지하고 강한 운동은 피하기'] },
];

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
export const LUNCH_CARB_CHOICE_KEY = 'ai-fitness-lunch-carb-choice';
export const LUNCH_PROTEIN_CHOICE_KEY = 'ai-fitness-lunch-protein-choice';
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
  '기본 목표는 14시간 공복을 주 5일 이상 달성, 컨디션 저하일은 12시간 공복 조절 가능',
  '운동 기준: 월/수/금 근력·안정화, 화/목 가벼운 유산소, 토 선택 유산소, 일 휴식',
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
export const DEFAULT_LUNCH_CARB_RECORD: LunchCarbRecord = { riceType: '통곡물밥', amountType: '100', grams: 100, customRiceType: '', estimatedCarbs: 30 };
export const DEFAULT_LUNCH_PROTEIN_RECORD: LunchProteinRecord = { type: 'none', protein: 0, customProtein: 0 };
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
export function normalizeLunchCarbRecord(value: unknown): LunchCarbRecord {
  const normalized = normalizeDinnerCarbRecord(value);
  if (!value || (typeof value === 'object' && Object.keys(value as object).length === 0)) return DEFAULT_LUNCH_CARB_RECORD;
  return { ...normalized, riceType: normalized.riceType || '통곡물밥' };
}
export function normalizeLunchCarbStore(value: unknown): Record<string, LunchCarbRecord> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([date, record]) => [date, normalizeLunchCarbRecord(record)]));
}
export function normalizeLunchProteinRecord(value: unknown): LunchProteinRecord {
  if (value && typeof value === 'object') {
    const record = value as Partial<LunchProteinRecord>;
    const type = record.type === 'half' || record.type === 'full' || record.type === 'custom' || record.type === 'none' ? record.type : 'none';
    const customProtein = Math.max(0, Math.floor(Number(record.customProtein ?? record.protein) || 0));
    const protein = type === 'custom' ? customProtein : proteinChoiceGrams(type);
    return { type, protein, customProtein };
  }
  if (typeof value === 'number') return normalizeLunchProteinRecord({ type: 'custom', protein: value, customProtein: value });
  if (typeof value === 'string') return normalizeLunchProteinRecord({ type: value });
  return DEFAULT_LUNCH_PROTEIN_RECORD;
}
export function normalizeLunchProteinStore(value: unknown): Record<string, LunchProteinRecord> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([date, record]) => [date, normalizeLunchProteinRecord(record)]));
}
export function formatRiceCarbRecord(mealLabel: string, record?: DinnerCarbRecord) {
  const normalized = normalizeDinnerCarbRecord(record);
  if (normalized.amountType === 'none' || normalized.grams <= 0) return { rice: `${mealLabel} 밥: 없음`, carbs: '' };
  const riceName = normalized.riceType === '기타' ? (normalized.customRiceType.trim() || '기타 밥') : normalized.riceType;
  const option = getDinnerCarbOption(normalized.amountType);
  const amountLabel = normalized.amountType === 'custom' ? `직접 입력 ${normalized.grams}g 밥량` : option.label;
  return { rice: `${mealLabel} 밥: ${riceName} ${amountLabel}`, carbs: `${mealLabel} 참고 탄수화물: 약 ${normalized.estimatedCarbs}g` };
}
export function formatDinnerCarbRecord(record?: DinnerCarbRecord) { return formatRiceCarbRecord('저녁', record); }
export function formatLunchCarbRecord(record?: LunchCarbRecord) { return formatRiceCarbRecord('점심', record); }
export function formatLunchProteinRecord(record?: LunchProteinRecord) {
  const normalized = normalizeLunchProteinRecord(record);
  if (normalized.protein <= 0) return '점심 프로틴: 없음';
  const label = normalized.type === 'half' ? '퓨어프로틴7 0.5회' : normalized.type === 'full' ? '퓨어프로틴7 1회' : '기타 직접 입력';
  return `점심 프로틴: ${label}, 단백질 ${normalized.protein}g`;
}

export const SAFETY_WARNING = '어지러움, 손 떨림, 식은땀, 심한 두통, 수면 부족, 허리 통증 악화, 다리 저림, 속쓰림 또는 회식·음주 다음 날에는 12~14시간 공복과 회복을 우선하세요.';

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
  week1: { id: 'week1', shortLabel: '14시간 주 5일 적응', label: '1주차', badge: '주 5일 목표', description: '기본 목표는 14시간 공복을 주 5일 이상 달성하는 것입니다.', fasting: ['14시간 공복 주 5일 이상', '컨디션 저하, 속쓰림, 어지럼, 손떨림이 있으면 12시간 공복으로 조절 가능'], safety: ['회식 다음날, 수면 부족, 컨디션 저하일은 12시간 공복도 조절 성공으로 인정합니다.'] },
  week2: { id: 'week2', shortLabel: '12~14시간 조절', label: '2주차', badge: '무리 금지', description: '매일 강제하지 않고 주간 달성 횟수를 관리합니다.', fasting: ['이번 주 목표: 14시간 공복 5일 이상', '12시간 이상 14시간 미만은 컨디션 조절 성공'], safety: ['속쓰림·어지럼·손떨림·피로가 있으면 회복일로 전환합니다.'] },
  week3: { id: 'week3', shortLabel: '주간 리듬 유지', label: '3주차', badge: '5일 이상', description: '식사 리듬과 운동 회복을 함께 유지합니다.', fasting: ['14시간 이상 공복: 공복 목표 달성', '12시간 미만 공복: 미달성'], safety: ['미달성 문구보다 조절일·회복일 기록을 우선합니다.'] },
  week4: { id: 'week4', shortLabel: '생활화', label: '4주차', badge: '주간 관리', description: '주 5일 이상 달성을 생활 리듬으로 만듭니다.', fasting: ['14시간 공복 달성일을 주간으로 확인', '컨디션에 따라 12시간 공복 조절 가능'], safety: ['무리한 보상 전략보다 다음 식사 리듬 복귀를 우선합니다.'] },
  maintenance: { id: 'maintenance', shortLabel: '생활 유지', label: '4주 이후 유지기', badge: '회식 후 복귀', description: '체중 감량보다 회식 후 빠른 복귀와 생활 유지가 목표입니다.', fasting: ['14시간 공복 주 5일 이상', '회식 다음날은 무리하지 말고 12~14시간 공복으로 조절'], safety: ['회식 후 프로틴 추가 섭취 금지, 다음날 일반식 리듬으로 복귀합니다.'] },
};
export const DIET_PHASE_OPTIONS = Object.values(DIET_PLANS).map((p) => ({ id: p.id, label: `${p.label} · ${p.shortLabel}` }));

export function getLocalDateKey(date = new Date()) { const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, '0'); const d = String(date.getDate()).padStart(2, '0'); return `${y}-${m}-${d}`; }
export function getSwitchOnDay(startDate: string, today = new Date()) { const fallback = getLocalDateKey(today); const [y, m, d] = (startDate || fallback).split('-').map(Number); const start = new Date(y, (m || 1) - 1, d || 1); const current = new Date(today.getFullYear(), today.getMonth(), today.getDate()); return Math.max(1, Math.floor((current.getTime() - start.getTime()) / 86400000) + 1); }
export function getAutoDietPhase(day: number): DietPhaseId { if (day <= 7) return 'week1'; if (day <= 14) return 'week2'; if (day <= 21) return 'week3'; if (day <= 28) return 'week4'; return 'maintenance'; }
export function getDietStatusText(day: number, phase: DietPhaseId) { const plan = DIET_PLANS[phase]; if (phase === 'maintenance') return '스위치온 유지기'; return `${plan.label} ${day}일차 · ${plan.shortLabel}`; }
export function proteinChoiceGrams(choice: ProteinChoice) { if (choice === 'full') return FULL_SHAKE_PROTEIN; if (choice === 'half') return HALF_SHAKE_PROTEIN; return 0; }
export function mealProteinGrams(choice: ProteinGramChoice, custom: number) { return choice === 'custom' ? Math.max(0, Number(custom) || 0) : Number(choice); }
export function calculateProteinTotal(log: DietMealLog, lunchProteinSupplement = 0) { return (log.breakfastShake ? FULL_SHAKE_PROTEIN : 0) + proteinChoiceGrams(log.afternoonShake) + proteinChoiceGrams(log.afterDinnerShake) + mealProteinGrams(log.lunchProteinChoice, log.lunchProteinCustom) + lunchProteinSupplement + mealProteinGrams(log.dinnerProteinChoice, log.dinnerProteinCustom); }
export function getProteinStatus(total: number) { if (total < 100) return { label: '단백질 보충 권장', color: 'text-amber-700', bg: 'bg-amber-50' }; if (total <= 135 && total >= 110) return { label: '목표 범위', color: 'text-green-700', bg: 'bg-green-50' }; if (total <= 150) return { label: '충분', color: 'text-blue-700', bg: 'bg-blue-50' }; return { label: '수분 섭취와 소화 상태를 확인하세요', color: 'text-red-700', bg: 'bg-red-50' }; }
