import { DEFAULT_LUNCH_PROTEIN_RECORD, normalizeDinnerCarbRecord, normalizeLunchCarbRecord, normalizeLunchProteinRecord, type DietMealLog, type DinnerCarbRecord, type LunchProteinRecord } from './dietPlans.ts';

export const DIGESTION_LABELS = { unrecorded: '미기록', comfortable: '편안함', heartburn: '속쓰림', bloated: '더부룩함', nausea: '메스꺼움' };
export type DigestionStatus = keyof typeof DIGESTION_LABELS;
export type MealCheck = 'unrecorded' | 'yes' | 'no';
export function normalizeDigestion(value: unknown): DigestionStatus {
  return typeof value === 'string' && Object.hasOwn(DIGESTION_LABELS, value) ? value as DigestionStatus : 'unrecorded';
}
export function normalizeMealCheck(value: unknown): MealCheck { return value === 'yes' || value === 'no' ? value : 'unrecorded'; }
function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value; }
const row = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const nonnegative = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

export type QuickMeal = { slot: 'lunch' | 'dinner'; label: string; patch: Partial<DietMealLog>; carb: DinnerCarbRecord; supplement: LunchProteinRecord };
export function previousMeal(meals: Record<string, unknown>, carbs: Record<string, unknown>, supplements: Record<string, unknown>, slot: QuickMeal['slot'], today: string): QuickMeal | null {
  if (!validDate(today)) return null;
  const date = Object.keys(meals).filter(date => validDate(date) && date < today).sort().reverse().find(date => {
    const meal = row(meals[date]);
    return (['20', '25', '30', 'custom'].includes(String(meal[`${slot}ProteinChoice`])) || row(carbs[date]).amountType && row(carbs[date]).amountType !== 'none');
  });
  if (!date) return null;
  const meal = row(meals[date]);
  const choice = meal[`${slot}ProteinChoice`];
  const proteinChoice = ['none', '20', '25', '30', 'custom'].includes(String(choice)) ? choice as DietMealLog['lunchProteinChoice'] : 'none';
  const proteinCustom = Math.min(300, nonnegative(meal[`${slot}ProteinCustom`]) ?? 0);
  const carb = slot === 'lunch' ? normalizeLunchCarbRecord(carbs[date] ?? { amountType: 'none', grams: 0 }) : normalizeDinnerCarbRecord(carbs[date] ?? meal.dinnerCarb);
  return { slot, label: `${date} ${slot === 'lunch' ? '점심' : '저녁'}`, carb,
    patch: slot === 'lunch' ? { lunchProteinChoice: proteinChoice, lunchProteinCustom: proteinCustom, lunchRice: carb.amountType !== 'none' } : { dinnerProteinChoice: proteinChoice, dinnerProteinCustom: proteinCustom, dinnerCarb: carb.amountType },
    supplement: slot === 'lunch' ? normalizeLunchProteinRecord(supplements[date]) : DEFAULT_LUNCH_PROTEIN_RECORD,
  };
}

export function quickMealPreset(slot: QuickMeal['slot']): QuickMeal {
  const carb = normalizeDinnerCarbRecord({ amountType: slot === 'lunch' ? '100' : 'none', grams: slot === 'lunch' ? 100 : 0, riceType: '통곡물밥' });
  return { slot, label: slot === 'lunch' ? '단백질 20g + 밥 100g' : '단백질 20g + 밥 미섭취', carb,
    patch: slot === 'lunch' ? { lunchProteinChoice: '20', lunchProteinCustom: 0, lunchRice: true } : { dinnerProteinChoice: '20', dinnerProteinCustom: 0, dinnerCarb: 'none' },
    supplement: DEFAULT_LUNCH_PROTEIN_RECORD,
  };
}

export function summarizeFreeDiet(store: Record<string, unknown>, today: string) {
  const end = validDate(today) ? Date.parse(today + 'T12:00:00Z') : NaN;
  const records = Object.entries(store).filter(([date]) => validDate(date) && date <= today && end - Date.parse(date + 'T12:00:00Z') < 7 * 86_400_000).map(([, value]) => row(value));
  const proteins = records.map(record => nonnegative(record.proteinTotal)).filter((value): value is number => value !== null);
  const waters = records.map(record => nonnegative(record.waterMl)).filter((value): value is number => value !== null);
  const digestion = records.map(record => normalizeDigestion(record.digestionStatus)).filter(value => value !== 'unrecorded');
  const lateSnack = records.map(record => normalizeMealCheck(record.lateSnack)).filter(value => value !== 'unrecorded');
  const afterWorkout = records.map(record => normalizeMealCheck(record.afterWorkoutMeal)).filter(value => value !== 'unrecorded');
  const average = (values: number[]) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  return { recordedDays: records.length, proteinDays: proteins.length, averageProtein: average(proteins), waterDays: waters.length, averageWater: average(waters), digestionDays: digestion.length, discomfortDays: digestion.filter(value => value !== 'comfortable').length, lateSnackDays: lateSnack.filter(value => value === 'yes').length, lateSnackAnswers: lateSnack.length, afterWorkoutDays: afterWorkout.filter(value => value === 'yes').length, afterWorkoutAnswers: afterWorkout.length };
}
