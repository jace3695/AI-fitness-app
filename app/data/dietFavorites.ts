import type { SupabaseClient } from '@supabase/supabase-js';
import { DINNER_RICE_TYPES, normalizeDinnerCarbRecord, normalizeLunchProteinRecord, type DietMealLog, type DinnerCarbRecord, type LunchProteinRecord } from './dietPlans.ts';
import type { QuickMeal } from './freeDietTools.ts';

export type MealFavorite = {
  id: string; user_id: string; name: string; slot: 'lunch' | 'dinner';
  food_protein: number | null; rice_grams: number; rice_name: string; supplement_protein: number;
  created_at?: string;
};
const fields = ['id', 'user_id', 'name', 'slot', 'food_protein', 'rice_grams', 'rice_name', 'supplement_protein'] as const;
const amount = (value: unknown, max: number, integer = false) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max && (!integer || Number.isInteger(value));
const label = (value: unknown) => typeof value === 'string' && value === value.trim() && value.length > 0 && Array.from(value).length <= 60;
export function validFavorite(value: unknown): value is MealFavorite {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as MealFavorite;
  const uuid = (id: unknown) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  return uuid(row.id) && uuid(row.user_id) && label(row.name) && ['lunch', 'dinner'].includes(row.slot)
    && (row.food_protein === null || amount(row.food_protein, 300)) && amount(row.rice_grams, 1000, true)
    && label(row.rice_name) && amount(row.supplement_protein, 300, true) && (row.slot === 'lunch' || row.supplement_protein === 0);
}
export function favoriteDraft(id: string, owner: string, name: string, slot: MealFavorite['slot'], meal: DietMealLog, rice: DinnerCarbRecord, supplement: LunchProteinRecord): MealFavorite {
  const choice = meal[`${slot}ProteinChoice`];
  return { id, user_id: owner, name: name.trim(), slot,
    food_protein: choice === 'none' ? null : choice === 'custom' ? meal[`${slot}ProteinCustom`] : Number(choice),
    rice_grams: rice.amountType === 'none' ? 0 : rice.grams,
    rice_name: (rice.riceType === '기타' ? rice.customRiceType : rice.riceType).trim() || '기타',
    supplement_protein: slot === 'lunch' ? supplement.protein : 0,
  };
}
export function favoriteQuickMeal(row: MealFavorite, assessment: LunchProteinRecord['assessment']): QuickMeal {
  const knownRice = DINNER_RICE_TYPES.find(value => value === row.rice_name);
  const carb = normalizeDinnerCarbRecord({ amountType: row.rice_grams ? 'custom' : 'none', grams: row.rice_grams, riceType: knownRice ?? '기타', customRiceType: knownRice ? '' : row.rice_name });
  const choice = row.food_protein === null ? 'none' as const : 'custom' as const;
  return { slot: row.slot, label: row.name, carb,
    patch: row.slot === 'lunch' ? { lunchProteinChoice: choice, lunchProteinCustom: row.food_protein ?? 0, lunchRice: row.rice_grams > 0 } : { dinnerProteinChoice: choice, dinnerProteinCustom: row.food_protein ?? 0, dinnerCarb: carb.amountType },
    supplement: normalizeLunchProteinRecord({ type: row.supplement_protein ? 'custom' : 'none', customProtein: row.supplement_protein, assessment }),
  };
}
export function favoriteSummary(row: MealFavorite) {
  return `${row.slot === 'lunch' ? '점심' : '저녁'} · 식품 단백질 ${row.food_protein === null ? '미기록' : `${row.food_protein}g`} · ${row.rice_name} ${row.rice_grams}g${row.slot === 'lunch' ? ` · 보충 단백질 ${row.supplement_protein}g` : ''}`;
}
export type FavoriteResult = { kind: 'confirmed' | 'uncertain' | 'not-saved' | 'changed' | 'invalid' | 'duplicate' };
export async function confirmFavorite(client: SupabaseClient, owner: string, row: MealFavorite, operation: 'save' | 'delete'): Promise<FavoriteResult> {
  if (row.user_id !== owner || !validFavorite(row)) return { kind: 'invalid' };
  try {
    const { data, error } = await client.from('diet_meal_favorites').select('*').eq('user_id', owner).eq('id', row.id).abortSignal(AbortSignal.timeout(15_000)).maybeSingle();
    if (error) return { kind: 'uncertain' };
    if (operation === 'delete') return { kind: data ? 'not-saved' : 'confirmed' };
    if (!data) return { kind: 'not-saved' };
    return { kind: fields.every(key => data[key] === row[key]) ? 'confirmed' : 'changed' };
  } catch { return { kind: 'uncertain' }; }
}
export async function writeFavorite(client: SupabaseClient, owner: string, row: MealFavorite, operation: 'save' | 'delete'): Promise<FavoriteResult> {
  if (row.user_id !== owner || !validFavorite(row)) return { kind: 'invalid' };
  let duplicate = false;
  try {
    let request = operation === 'save'
      ? client.from('diet_meal_favorites').insert(Object.fromEntries(fields.map(key => [key, row[key]])))
      : client.from('diet_meal_favorites').delete().eq('user_id', owner).eq('id', row.id);
    if (operation === 'delete' && row.created_at) request = request.eq('created_at', row.created_at);
    const { error } = await request.abortSignal(AbortSignal.timeout(15_000));
    duplicate = error?.code === '23505';
  } catch { /* A lost response can still have committed. Only GET may recover it. */ }
  const result = await confirmFavorite(client, owner, row, operation);
  return duplicate && result.kind === 'not-saved' ? { kind: 'duplicate' } : result;
}
