import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_MEAL_LOG, normalizeDinnerCarbRecord, normalizeLunchProteinRecord } from './dietPlans.ts';
import { confirmFavorite, favoriteDraft, favoriteQuickMeal, favoriteSummary, validFavorite, writeFavorite } from './dietFavorites.ts';
const owner = '00000000-0000-4000-8000-000000000101', id = '00000000-0000-4000-8000-000000000102';
const row = favoriteDraft(id, owner, ' 회사 점심 ', 'lunch', { ...DEFAULT_MEAL_LOG, lunchProteinChoice: 'custom', lunchProteinCustom: 27.5 }, normalizeDinnerCarbRecord({ amountType: 'custom', grams: 120, riceType: '기타', customRiceType: '보리밥' }), normalizeLunchProteinRecord({ type: 'half' }));
test('즐겨찾기는 명시한 양만 저장하며 날짜·상태·완료를 복사하지 않는다', () => {
  assert.equal(validFavorite(row), true);
  assert.equal(row.name, '회사 점심'); assert.equal(row.food_protein, 27.5); assert.equal(row.supplement_protein, 16);
  assert.deepEqual(Object.keys(row).sort(), ['id', 'user_id', 'name', 'slot', 'food_protein', 'rice_grams', 'rice_name', 'supplement_protein'].sort());
  assert.match(favoriteSummary(row), /보리밥 120g/);
});
test('불러오기는 선택한 끼니의 입력만 만들며 현재 점심 평가를 유지한다', () => {
  const value = favoriteQuickMeal(row, 'uncertain');
  assert.deepEqual(value.patch, { lunchProteinChoice: 'custom', lunchProteinCustom: 27.5, lunchRice: true });
  assert.equal(value.supplement.assessment, 'uncertain'); assert.equal(value.carb.customRiceType, '보리밥');
  const dinner = favoriteDraft(id, owner, '저녁', 'dinner', DEFAULT_MEAL_LOG, normalizeDinnerCarbRecord('none'), normalizeLunchProteinRecord('full'));
  assert.equal(dinner.supplement_protein, 0); assert.equal(dinner.food_protein, null);
  assert.deepEqual(favoriteQuickMeal(dinner, 'low').patch, { dinnerProteinChoice: 'none', dinnerProteinCustom: 0, dinnerCarb: 'none' });
});
test('미기록과 0g 구분, 음수·무한대·범위 초과·다른 끼니 보충 값 거부', () => {
  assert.equal(validFavorite({ ...row, food_protein: null }), true);
  assert.equal(validFavorite({ ...row, food_protein: 0 }), true);
  for (const patch of [{ name: ' ' }, { name: '가'.repeat(61) }, { food_protein: -1 }, { food_protein: Infinity }, { rice_grams: 1001 }, { rice_grams: 1.5 }, { supplement_protein: 301 }, { slot: 'dinner', supplement_protein: 16 }, { user_id: '' }]) assert.equal(validFavorite({ ...row, ...patch }), false);
});
function fake(responses: unknown[]) {
  const calls: string[] = [];
  const chain = { eq() { return chain; }, abortSignal() { return chain; }, maybeSingle() { return chain; }, then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { const next = responses.shift(); return next instanceof Error ? Promise.reject(next).then(resolve, reject) : Promise.resolve(next).then(resolve, reject); } };
  const client = { from() { return { select() { calls.push('GET'); return chain; }, insert() { calls.push('POST'); return chain; }, delete() { calls.push('DELETE'); return chain; } }; } } as unknown as SupabaseClient;
  return { client, calls };
}
test('저장 응답 유실 뒤 결과 재확인은 GET만 하며 같은 값을 확인한다', async () => {
  const f = fake([new Error('lost'), { error: {} }, { data: row }]);
  assert.equal((await writeFavorite(f.client, owner, row, 'save')).kind, 'uncertain');
  assert.equal((await confirmFavorite(f.client, owner, row, 'save')).kind, 'confirmed');
  assert.deepEqual(f.calls, ['POST', 'GET', 'GET']);
});
test('중복 이름과 다른 값·미저장을 구분하고 다른 소유자로 쓰지 않는다', async () => {
  const f = fake([{ error: { code: '23505' } }, { data: null }, { data: { ...row, food_protein: 1 } }]);
  assert.equal((await writeFavorite(f.client, owner, row, 'save')).kind, 'duplicate');
  assert.equal((await confirmFavorite(f.client, owner, row, 'save')).kind, 'changed');
  assert.equal((await writeFavorite(f.client, id, row, 'save')).kind, 'invalid');
  assert.deepEqual(f.calls, ['POST', 'GET', 'GET']);
});
test('삭제 결과 유실도 GET으로 확인하고 남은 행은 삭제 성공으로 표시하지 않는다', async () => {
  const f = fake([new Error('lost'), { data: row }, { data: null }]);
  assert.equal((await writeFavorite(f.client, owner, row, 'delete')).kind, 'not-saved');
  assert.equal((await confirmFavorite(f.client, owner, row, 'delete')).kind, 'confirmed');
  assert.deepEqual(f.calls, ['DELETE', 'GET', 'GET']);
});
