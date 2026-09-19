import test from 'node:test';
import assert from 'node:assert/strict';
import { previousMeal, quickMealPreset, summarizeFreeDiet } from './freeDietTools.ts';

test('지난 식사는 오늘·미래·잘못된 날짜와 다른 끼니를 복사하지 않는다', () => {
  const today = '2026-09-13';
  const meals = { '2026-09-10': { lunchProteinChoice: 'custom', lunchProteinCustom: 32, dinnerProteinChoice: '30', breakfastShake: true, lastMealTime: '23:00' }, '2026-09-12': { dinnerProteinChoice: '20' }, [today]: { lunchProteinChoice: '30' }, '2026-09-14': { lunchProteinChoice: '30' }, '2026-02-31': { lunchProteinChoice: '30' } };
  const before = JSON.stringify(meals);
  const reused = previousMeal(meals, { '2026-09-10': { amountType: 'custom', grams: 130, riceType: '현미밥' } }, {}, 'lunch', today);
  assert.equal(reused?.label, '2026-09-10 점심');
  assert.deepEqual(reused?.patch, { lunchProteinChoice: 'custom', lunchProteinCustom: 32, lunchRice: true });
  assert.equal(reused?.carb.grams, 130); assert.equal(JSON.stringify(meals), before);
  assert.equal(previousMeal({}, {}, {}, 'dinner', today), null);
});

test('간편 기본값은 한 끼의 명시된 입력값만 바꾼다', () => {
  assert.deepEqual(quickMealPreset('lunch').patch, { lunchProteinChoice: '20', lunchProteinCustom: 0, lunchRice: true });
  assert.equal(quickMealPreset('lunch').carb.grams, 100);
  assert.equal(quickMealPreset('dinner').carb.grams, 0);
  assert.equal(Object.hasOwn(quickMealPreset('dinner').patch, 'lastMealTime'), false);
});

test('주간 요약은 미응답과 미래 기록을 빼고 지표마다 실제 응답 수를 표시한다', () => {
  const result = summarizeFreeDiet({
    '2026-09-13': { proteinTotal: 100, waterMl: 1800, digestionStatus: 'bloated', lateSnack: 'yes' },
    '2026-09-12': { proteinTotal: 80, waterMl: 0, digestionStatus: 'comfortable', lateSnack: 'no', afterWorkoutMeal: 'yes' },
    '2026-09-07': { proteinTotal: null, waterMl: '2000', digestionStatus: 'corrupt' },
    '2026-09-06': { proteinTotal: 999, waterMl: 999 }, '2026-09-14': { proteinTotal: 999 },
  }, '2026-09-13');
  assert.deepEqual(result, { recordedDays: 3, proteinDays: 2, averageProtein: 90, waterDays: 2, averageWater: 900, digestionDays: 2, discomfortDays: 1, lateSnackDays: 1, lateSnackAnswers: 2, afterWorkoutDays: 1, afterWorkoutAnswers: 1 });
  assert.equal(summarizeFreeDiet({}, '2026-09-13').averageProtein, null);
});
