export type DietMealChange = { kind: 'meal'; slot: 'lunch' | 'dinner'; field: 'protein' | 'rice'; grams: number };
export type DietMealSnapshot = {
  record?: Record<string, unknown>; water?: number; meal?: Record<string, unknown>;
  lunchCarb?: unknown; dinnerCarb?: unknown; supplement?: unknown; proteinTotal?: number; social?: string;
};
export const DIET_MEAL_STORE_KEYS = {
  meal: 'ai-fitness-diet-meal-log', lunchCarb: 'ai-fitness-lunch-carb-choice', dinnerCarb: 'ai-fitness-dinner-carb-choice',
  supplement: 'ai-fitness-lunch-protein-choice', proteinTotal: 'ai-fitness-protein-total', social: 'ai-fitness-social-meal-mode',
} as const;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100000;
const invalid = () => new Error('기존 끼니별 식단 수치나 합계를 확인하지 못했습니다. 식단 화면에서 확인한 뒤 다시 말씀해 주세요.');
export function isDietMealChange(value: unknown): value is DietMealChange {
  return object(value) && Object.keys(value).sort().join() === 'field,grams,kind,slot' && value.kind === 'meal'
    && (value.slot === 'lunch' || value.slot === 'dinner') && (value.field === 'protein' || value.field === 'rice')
    && amount(value.grams) && Number.isInteger(value.grams) && value.grams <= (value.field === 'protein' ? 100 : 1000);
}
export function isDietMealSnapshot(value: Record<string, unknown>) {
  return (!Object.hasOwn(value, 'meal') || object(value.meal))
    && (!Object.hasOwn(value, 'proteinTotal') || amount(value.proteinTotal))
    && (!Object.hasOwn(value, 'social') || ['none', 'lunch', 'dinner', 'all-day', 'travel'].includes(String(value.social)))
    && ['lunchCarb', 'dinnerCarb', 'supplement'].every(key => !Object.hasOwn(value, key) || object(value[key]) || typeof value[key] === 'string' || amount(value[key]));
}
function shake(value: unknown) {
  if (value === undefined || value === 'none') return 0;
  if (value === 'half') return 16;
  if (value === 'full') return 31;
  throw invalid();
}
export function recordedMealProtein(meal: Record<string, unknown> | undefined, slot: 'lunch' | 'dinner') {
  const choice = meal?.[`${slot}ProteinChoice`];
  if (choice === undefined || choice === 'none') return 0;
  if (['20', '25', '30'].includes(String(choice)) && typeof choice === 'string') return Number(choice);
  const custom = meal?.[`${slot}ProteinCustom`];
  if (choice === 'custom' && amount(custom)) return custom;
  throw invalid();
}
function supplementProtein(value: unknown) {
  if (value === undefined) return 0;
  if (amount(value)) return Math.floor(value);
  if (typeof value === 'string') return shake(value);
  if (!object(value)) throw invalid();
  if (value.type === 'custom') {
    const custom = value.customProtein ?? value.protein;
    if (!amount(custom)) throw invalid();
    return Math.floor(custom);
  }
  return shake(value.type);
}
export function recordedProteinTotal(snapshot: DietMealSnapshot) {
  const meal = snapshot.meal ?? {};
  if (meal.breakfastShake !== undefined && typeof meal.breakfastShake !== 'boolean') throw invalid();
  return (meal.breakfastShake ? 31 : 0) + shake(meal.afternoonShake) + shake(meal.afterDinnerShake)
    + recordedMealProtein(meal, 'lunch') + recordedMealProtein(meal, 'dinner') + supplementProtein(snapshot.supplement);
}
export function dietMealNextSnapshot(before: DietMealSnapshot, change: DietMealChange): DietMealSnapshot {
  if (!isDietMealChange(change) || !isDietMealSnapshot(before)) throw invalid();
  const meal = { ...before.meal }, record = { ...before.record };
  if (change.field === 'protein') {
    const oldTotal = recordedProteinTotal(before);
    // A legacy aggregate without matching meal details cannot safely be replaced.
    for (const value of [before.proteinTotal, record.proteinTotal]) {
      if (value !== undefined && (!amount(value) || Math.abs(value - oldTotal) > 0.000001)) throw invalid();
    }
    meal[`${change.slot}ProteinChoice`] = change.grams === 0 ? 'none' : 'custom';
    meal[`${change.slot}ProteinCustom`] = change.grams;
    const total = recordedProteinTotal({ ...before, meal });
    record.proteinTotal = total; record.proteinDone = total >= 100;
    if (change.slot === 'lunch') record.lunchProtein = change.grams > 0 || supplementProtein(before.supplement) > 0;
    return { ...before, meal, record, proteinTotal: total };
  }
  const key = change.slot === 'lunch' ? 'lunchCarb' : 'dinnerCarb';
  const prior = before[key];
  const carb = object(prior) ? { ...prior } : {};
  if (carb.riceType !== undefined && !['흰쌀밥', '잡곡밥', '현미밥', '통곡물밥', '곤약밥', '기타'].includes(String(carb.riceType))) throw invalid();
  if (carb.riceType === undefined) { carb.riceType = '기타'; carb.customRiceType = '종류 미기록'; }
  carb.amountType = change.grams === 0 ? 'none' : 'custom'; carb.grams = change.grams;
  // Keep the existing diet screen's labelled reference estimate in sync.
  carb.estimatedCarbs = Math.round(change.grams * 0.3);
  if (change.slot === 'lunch') meal.lunchRice = change.grams > 0;
  else { meal.dinnerCarb = carb.amountType; record.noDinnerCarbs = change.grams === 0 || (change.grams >= 50 && change.grams <= 80); }
  return { ...before, meal, [key]: carb, ...(change.slot === 'dinner' ? { record } : {}) };
}
export function describeDietMeal(snapshot: DietMealSnapshot, change: DietMealChange) {
  const slot = change.slot === 'lunch' ? '점심' : '저녁';
  if (change.field === 'protein') {
    const choice = snapshot.meal?.[`${change.slot}ProteinChoice`];
    const value = choice === undefined ? '미기록' : `${recordedMealProtein(snapshot.meal, change.slot)}g`;
    const total = snapshot.proteinTotal ?? snapshot.record?.proteinTotal;
    return `${slot} 식품 단백질 ${value}${total === undefined ? '' : ` · 기록된 하루 합계 ${total}g`}`;
  }
  const carb = snapshot[change.slot === 'lunch' ? 'lunchCarb' : 'dinnerCarb'];
  const presets: Record<string, number> = { none: 0, '50': 50, '80': 80, '100': 100, 'third-bowl': 70, 'half-bowl': 100, 'two-third-bowl': 130, 'one-bowl': 200 };
  const raw = carb ?? (change.slot === 'dinner' ? snapshot.meal?.dinnerCarb : undefined);
  const grams = object(raw) ? raw.amountType === 'custom' ? raw.grams : presets[String(raw.amountType)] : typeof raw === 'string' ? presets[raw] : raw;
  return `${slot} 조리된 밥 ${grams === undefined ? '무게 미기록' : `${grams}g`}`;
}
