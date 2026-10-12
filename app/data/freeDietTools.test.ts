import test from 'node:test';
import assert from 'node:assert/strict';
import { DIGESTION_LABELS, normalizeDigestion, previousMeal, quickMealPreset, summarizeFreeDiet } from './freeDietTools.ts';

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

test('소화 상태는 복통·설사와 기존 자기응답을 보존하고 빈 값은 편안함으로 추정하지 않는다', () => {
  const labels = { unrecorded: '미기록', comfortable: '편안함', heartburn: '속쓰림', bloated: '더부룩함', nausea: '메스꺼움', abdominal_pain: '복통', diarrhea: '설사' };
  assert.deepEqual(DIGESTION_LABELS, labels);
  for (const key of Object.keys(labels)) assert.equal(normalizeDigestion(key), key);
  for (const value of [undefined, null, '', 'unknown', 'constructor', 'toString', '__proto__', false, 0, {}, []]) {
    assert.equal(normalizeDigestion(value), 'unrecorded');
  }
});

test('주간 소화 요약은 복통·설사를 불편 응답으로 세고 미응답·원본 JSON은 보존한다', () => {
  const data = {
    '2026-09-13': { digestionStatus: 'abdominal_pain', original: { keep: true } },
    '2026-09-12': { digestionStatus: 'diarrhea' },
    '2026-09-11': { digestionStatus: 'comfortable' },
    '2026-09-10': { digestionStatus: 'heartburn' },
    '2026-09-09': { digestionStatus: 'unrecorded' },
    '2026-09-08': { digestionStatus: 'future-status' },
    '2026-09-07': { dietMemo: '소화 응답 없음' },
    '2026-09-06': { digestionStatus: 'abdominal_pain' },
    '2026-09-14': { digestionStatus: 'diarrhea' },
  };
  const before = JSON.stringify(data);
  assert.deepEqual(summarizeFreeDiet(data, '2026-09-13'), {
    recordedDays: 7, proteinDays: 0, averageProtein: null, waterDays: 0, averageWater: null,
    digestionDays: 4, discomfortDays: 3, lateSnackDays: 0, lateSnackAnswers: 0, afterWorkoutDays: 0, afterWorkoutAnswers: 0,
  });
  assert.equal(JSON.stringify(data), before);
});
