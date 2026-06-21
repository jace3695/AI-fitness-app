export type DietPhaseId = 'adaptation' | 'week1' | 'week2' | 'week3' | 'week4' | 'maintenance';
export type DietMode = 'auto' | 'manual';

export const DIET_PHASE_KEY = 'ai-fitness-diet-phase';
export const DIET_START_DATE_KEY = 'ai-fitness-diet-start-date';
export const DIET_COMPLETED_DAYS_KEY = 'ai-fitness-diet-completed-days';
export const FASTING_START_TIME_KEY = 'ai-fitness-fasting-start-time';
export const WATER_INTAKE_KEY = 'ai-fitness-water-intake';
export const WORKOUT_COMPLETED_DAYS_KEY = 'ai-fitness-workout-completed-days';

export const DIET_MODE_KEY = `${DIET_PHASE_KEY}-mode`;
export const DINNER_COMPLETED_TIME_KEY = 'ai-fitness-diet-dinner-completed-time';

export interface MealPlan {
  id: string;
  time: string;
  title: string;
  items: string[];
  options?: string[];
  alternatives?: string[];
  note?: string;
}

export interface DietPlan {
  id: DietPhaseId;
  shortLabel: string;
  label: string;
  description: string;
  badge: string;
  meals: MealPlan[];
  allowedFoods?: string[];
  cautionFoods?: string[];
  fasting: string[];
  exerciseAfter: string;
  warning?: string[];
  warningAction?: string[];
}

export const COMMON_DIET_RULES = [
  '저녁 식사 18:30 이전 완료',
  '운동 시간: 20:00~20:40',
  '운동 후 기본적으로 물만 섭취',
  '물 목표: 하루 2L 이상',
  '기본 공복 목표: 14시간',
  '저녁 탄수화물 기본 제외',
  '점심에만 통곡물밥 또는 일반 밥 소량 허용',
];

export const SAFETY_WARNING = '심한 두통, 손 떨림, 식은땀, 어지러움, 업무 집중 저하, 허리 통증 악화 또는 다리 저림이 나타나면 식단·단식·운동을 즉시 중단하고 휴식하세요. 증상이 지속되거나 심하면 의료진과 상담하세요.';

export const DIET_CHECK_ITEMS = [
  { id: 'water2l', label: '오늘 물 2L 달성' },
  { id: 'dinnerBefore1830', label: '저녁 식사 18:30 이전 완료' },
  { id: 'fasting14h', label: '14시간 공복 달성' },
  { id: 'noDinnerCarbs', label: '저녁 탄수화물 제외' },
  { id: 'proteinDone', label: '프로틴 섭취 완료' },
  { id: 'lunchProtein', label: '점심 단백질 섭취 완료' },
  { id: 'backPain', label: '허리 통증 발생', safety: true },
  { id: 'legNumbness', label: '다리 저림 발생', safety: true },
  { id: 'dizzinessHeadache', label: '어지러움·두통 발생', safety: true },
] as const;

export const DIET_GOAL_CHECK_ITEMS = DIET_CHECK_ITEMS.filter((item) => !('safety' in item));
export const DIET_SAFETY_CHECK_ITEMS = DIET_CHECK_ITEMS.filter((item) => 'safety' in item);

export type DietCheckId = (typeof DIET_CHECK_ITEMS)[number]['id'];
export type DietCheckMap = Partial<Record<DietCheckId, boolean>>;

export const DIET_PLANS: Record<DietPhaseId, DietPlan> = {
  adaptation: {
    id: 'adaptation', shortLabel: '적응 모드', label: 'day 1~3 적응 모드', badge: '더단백 우선 사용',
    description: '남아 있는 더단백 딸기맛을 우선 사용하고, 오이는 허기 보완용으로만 활용합니다.',
    meals: [
      { id: 'breakfast', time: '08:30', title: '아침', items: ['더단백 딸기맛 250mL 1병', '단백질 약 20g'] },
      { id: 'lunch', time: '12:30', title: '점심', items: ['더단백 딸기맛 250mL 1병', '단백질 약 20g'] },
      { id: 'snack', time: '16:00', title: '간식', items: ['더단백 딸기맛 250mL 1병', '단백질 약 20g'] },
      { id: 'dinner', time: '18:00~18:30', title: '저녁', items: ['더단백 딸기맛 250mL 1병', '단백질 약 20g', '저녁 식사는 18:30 이전 완료'] },
    ],
    allowedFoods: ['오이 하루 1개 정도, 허기 심한 날 최대 1~2개', '알배기배추 한 줌', '데친 양배추 한 줌', '두부 또는 연두부 소량'],
    cautionFoods: ['오이는 매 끼니마다 먹는 식품이 아니라 허기 보완용입니다.', '오후에 배고프면 오이 1/2개부터 먹고, 저녁 전까지 허기가 지속되면 나머지 1/2개를 먹습니다.', '운동 후에는 원칙적으로 물만 마십니다.'],
    fasting: ['기본 공복 목표: 14시간'], exerciseAfter: '물 300~500mL. 취침이 가까우면 추가 음식 섭취하지 않음.',
    warning: ['심한 어지러움', '손 떨림', '식은땀', '심한 두통', '업무 집중 저하'],
    warningAction: ['자동으로 다음 식단 단계로 변경하지 않습니다.', '적응 모드를 중단하고 일반식이 포함된 완화 식단으로 전환을 검토하세요.', '증상이 심하거나 지속되면 의료진과 상담하세요.'],
  },
  week1: {
    id: 'week1', shortLabel: '점심 일반식 도입', label: 'day 4~7 점심 일반식 도입', badge: '퓨어프로틴7', description: '점심에 통곡물밥과 단백질 식사를 도입합니다.',
    meals: [
      { id: 'breakfast', time: '08:30', title: '아침', items: ['퓨어프로틴7 1회'] },
      { id: 'lunch', time: '12:30', title: '점심', items: ['통곡물밥 + 단백질 + 채소'], options: ['햇반 통곡물밥 130g + 닭가슴살 150g + 샐러드', '햇반 통곡물밥 130g + 돼지안심 150g + 알배기배추', '햇반 통곡물밥 130g + 생선 1토막 + 버섯·채소', '햇반 통곡물밥 130g + 두부 1/2모 + 계란 2개 + 채소'], alternatives: ['통곡물밥 130g + 퓨어프로틴7 + 샐러드 또는 오이', '두부·계란·생선 중 하나 추가'] },
      { id: 'snack', time: '16:00', title: '간식', items: ['퓨어프로틴7 1회'] },
      { id: 'dinner', time: '18:00~18:30', title: '저녁', items: ['퓨어프로틴7 1회', '저녁 식사 18:30 이전 완료'] },
    ], fasting: ['기본 공복 목표: 14시간'], exerciseAfter: '운동 후 물만 섭취', cautionFoods: ['24시간 단식은 기본 루틴이 아니라 선택 항목 / 의료진 상담 권장입니다.'],
  },
  week2: {
    id: 'week2', shortLabel: '감량 안정화', label: '2주차 감량 안정화', badge: '14시간 주 3~4회', description: '점심 탄수화물은 유지하고 저녁은 단백질과 채소 중심으로 안정화합니다.',
    meals: [
      { id: 'breakfast', time: '08:30', title: '아침', items: ['퓨어프로틴7 1회'] },
      { id: 'lunch', time: '12:30', title: '점심', items: ['통곡물밥 130g + 단백질 30g 이상 + 채소'] },
      { id: 'snack', time: '16:00', title: '간식', items: ['퓨어프로틴7 1회'] },
      { id: 'dinner', time: '18:00~18:30', title: '저녁', items: ['단백질 + 채소', '밥·면·빵 제외'], options: ['닭가슴살 150g + 양배추·알배기배추', '돼지안심 150g + 버섯·샐러드', '생선 1토막 + 두부·채소', '계란 2개 + 두부 1/2모 + 오이'] },
    ], allowedFoods: ['견과류 하루 한 줌 이하', '무가당 그릭요거트', '콩류', '치즈 소량', '오전 디카페인 블랙커피 1잔'], fasting: ['14시간 공복 주 3~4회', '24시간 단식은 선택 사항으로만 표시', '단식일 운동은 걷기·스트레칭 위주 권장'], exerciseAfter: '운동 후 물만 섭취', cautionFoods: ['24시간 단식은 선택 항목 / 의료진 상담 권장입니다.'],
  },
  week3: {
    id: 'week3', shortLabel: '감량 강화', label: '3주차 감량 강화', badge: '저녁 탄수 제외', description: '공복 빈도를 늘리되 저혈당 의심 증상과 운동 피로가 있으면 즉시 낮춥니다.',
    meals: [
      { id: 'breakfast', time: '08:30', title: '아침', items: ['퓨어프로틴7 1회'] },
      { id: 'lunch', time: '12:30', title: '점심', items: ['통곡물밥 130g + 단백질 + 채소'], options: ['강한 운동일 점심 또는 오전에만: 바나나 1/2개', '블루베리 한 줌', '토마토 1개', '단호박 소량', '작은 고구마 1/2개'] },
      { id: 'snack', time: '16:00', title: '간식', items: ['퓨어프로틴7 또는 더단백 1회'] },
      { id: 'dinner', time: '18:00~18:30', title: '저녁', items: ['단백질 + 채소', '저녁 탄수화물 제외'] },
    ], fasting: ['14시간 공복 주 4~5회', '24시간 단식은 선택 기능', '연속 배치 금지', '어지러움, 저혈당 의심 증상, 운동 피로가 있으면 비활성 권장'], exerciseAfter: '운동 후 물만 섭취', cautionFoods: ['저녁에는 탄수화물 선택지를 표시하지 않습니다.', '24시간 단식은 선택 항목 / 의료진 상담 권장입니다.'],
  },
  week4: {
    id: 'week4', shortLabel: '유지 전환', label: '4주차 유지 전환', badge: '과일 오전/점심', description: '감량 루틴에서 유지 루틴으로 넘어가며 저녁 탄수화물은 최소화합니다.',
    meals: [
      { id: 'breakfast', time: '08:30', title: '아침', items: ['퓨어프로틴7 또는 계란·그릭요거트'] },
      { id: 'lunch', time: '12:30', title: '점심', items: ['통곡물밥 130g + 단백질 + 채소'] },
      { id: 'snack', time: '16:00', title: '간식', items: ['허기 있을 때만 퓨어프로틴7'] },
      { id: 'dinner', time: '18:00~18:30', title: '저녁', items: ['단백질 + 채소', '저녁 탄수 최소화'] },
    ], allowedFoods: ['과일 하루 1개 이내', '과일은 오전 또는 점심에만'], fasting: ['14시간 공복 주 4~5회', '24시간 단식은 주 1회 이하의 선택 항목'], exerciseAfter: '운동 후 물만 섭취', cautionFoods: ['24시간 단식은 선택 항목 / 의료진 상담 권장입니다.'],
  },
  maintenance: {
    id: 'maintenance', shortLabel: '유지 식단', label: 'day 29 이후 유지 식단', badge: '유지기', description: '일반식을 허용하되 저녁은 단백질과 채소 중심을 유지합니다.',
    meals: [
      { id: 'breakfast', time: '08:30', title: '아침', items: ['프로틴 쉐이크 또는 계란·그릭요거트'] },
      { id: 'lunch', time: '12:30', title: '점심', items: ['일반식 가능', '밥 1/2~2/3공기 + 단백질 + 채소'] },
      { id: 'snack', time: '16:00', title: '간식', items: ['배고픈 날만 프로틴 쉐이크'] },
      { id: 'dinner', time: '18:00~18:30', title: '저녁', items: ['단백질 + 채소 중심', '저녁 밥 기본 제외'] },
    ], fasting: ['14시간 공복 주 4~5회', '24시간 단식은 선택 항목으로만 표시'], exerciseAfter: '운동 후 물만 섭취', cautionFoods: ['밥·고구마·과일은 아침 또는 점심', '저녁 탄수화물 기본 제외', '저녁 외식으로 탄수화물을 먹은 다음 날은 점심 밥을 줄이거나 생략하세요.', '24시간 단식은 선택 항목 / 의료진 상담 권장입니다.'],
  },
};

export const DIET_PHASE_OPTIONS: { id: DietPhaseId; label: string }[] = [
  { id: 'adaptation', label: '적응 모드' },
  { id: 'week1', label: '점심 일반식 도입' },
  { id: 'week2', label: '2주차 감량 안정화' },
  { id: 'week3', label: '3주차 감량 강화' },
  { id: 'week4', label: '4주차 유지 전환' },
  { id: 'maintenance', label: '유지 식단' },
];

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getSwitchOnDay(startDate: string, today = new Date()) {
  const fallback = getLocalDateKey(today);
  const [y, m, d] = (startDate || fallback).split('-').map(Number);
  const start = new Date(y, (m || 1) - 1, d || 1);
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(1, Math.floor((current.getTime() - start.getTime()) / 86400000) + 1);
}

export function getAutoDietPhase(day: number): DietPhaseId {
  if (day <= 3) return 'adaptation';
  if (day <= 7) return 'week1';
  if (day <= 14) return 'week2';
  if (day <= 21) return 'week3';
  if (day <= 28) return 'week4';
  return 'maintenance';
}

export function getDietStatusText(day: number, phase: DietPhaseId) {
  if (phase === 'maintenance') return '스위치온 유지기';
  if (phase === 'week2') return '스위치온 2주차 · 감량 안정화';
  if (phase === 'week3') return '스위치온 3주차 · 감량 강화';
  if (phase === 'week4') return '스위치온 4주차 · 유지 전환';
  return `스위치온 ${day}일차 · ${DIET_PLANS[phase].shortLabel}`;
}
