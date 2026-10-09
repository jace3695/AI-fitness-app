import test from 'node:test';
import assert from 'node:assert/strict';
import { DIET_SELF_RESPONSE_FIELDS, dietSelfResponseMetricText, dietSelfResponsePatch, normalizeDietSelfResponse, readDietSelfResponses, summarizeDietSelfResponses, type DietSelfResponseEdits } from './dietSelfResponses.ts';
import { dietPatterns } from './dietPatterns.ts';
import { hasUnrecognizedDietResponse, preserveUneditedDietResponse } from './dietSelfResponses.ts';
import { normalizeDigestion, normalizeMealCheck } from './freeDietTools.ts';

test('세 자기응답은 각각 명시된 예/아니요만 사용하며 식사·시각에서 추정하지 않는다', () => {
  assert.deepEqual(DIET_SELF_RESPONSE_FIELDS.map(field => field.key), ['hunger', 'bingeUrge', 'preSleepOvereating']);
  assert.deepEqual(readDietSelfResponses({ lateSnack: 'yes', afterWorkoutMeal: 'yes', lastMealTime: '23:55', proteinTotal: 0 }), {
    hunger: 'unrecorded', bingeUrge: 'unrecorded', preSleepOvereating: 'unrecorded',
  });
  assert.deepEqual(readDietSelfResponses({ hunger: 'yes', bingeUrge: 'no', preSleepOvereating: 'unrecorded' }), {
    hunger: 'yes', bingeUrge: 'no', preSleepOvereating: 'unrecorded',
  });
});

test('알 수 없는 기존 응답과 미기록은 표시 상태를 구분한다', () => {
  for (const value of [null, '', true, false, 0, 1, [], {}, 'future-answer', 'unknown', 'constructor', '__proto__']) {
    assert.equal(normalizeDietSelfResponse(value), 'unknown');
  }
  assert.equal(normalizeDietSelfResponse(undefined), 'unrecorded');
  assert.equal(normalizeDietSelfResponse('unrecorded'), 'unrecorded');
  assert.equal(normalizeDietSelfResponse('yes'), 'yes');
  assert.equal(normalizeDietSelfResponse('no'), 'no');
});

test('선택하지 않은 누락·기존 값은 저장 patch로 정규화하거나 제거하지 않는다', () => {
  const previous = { hunger: 'future-answer', bingeUrge: { version: 2, answer: 1 }, digestionStatus: 'future-status', original: { keep: true } };
  const before = JSON.stringify(previous);
  assert.deepEqual(dietSelfResponsePatch({}), {});
  assert.equal(JSON.stringify({ ...previous, ...dietSelfResponsePatch({}) }), before);
  const edited = { ...previous, ...dietSelfResponsePatch({ preSleepOvereating: 'no' }) };
  assert.deepEqual(edited, { ...previous, preSleepOvereating: 'no' });
  assert.equal(JSON.stringify(previous), before);
  assert.deepEqual(dietSelfResponsePatch({ hunger: 'unrecorded' }), { hunger: 'unrecorded' });
  assert.deepEqual(dietSelfResponsePatch({ hunger: 'unknown', bingeUrge: false, unrelated: 'yes' } as unknown as DietSelfResponseEdits), {});
  assert.equal(Object.hasOwn({ ...dietSelfResponsePatch({}) }, 'hunger'), false);
});

test('7일 요약은 지표마다 예/아니요 실제 응답일을 분모로 쓰며 미응답·손상은 제외한다', () => {
  const store = {
    '2026-10-09': { hunger: 'yes', bingeUrge: 'no', preSleepOvereating: 'no' },
    '2026-10-08': { hunger: 'no', bingeUrge: 'unrecorded', preSleepOvereating: 'yes' },
    '2026-10-07': { hunger: 'yes', bingeUrge: 'future-value' },
    '2026-10-06': { hunger: 'unrecorded', bingeUrge: false, preSleepOvereating: null },
    '2026-10-05': { lateSnack: 'yes', lastMealTime: '23:55' },
    '2026-10-04': [], '2026-10-03': null,
    '2026-10-02': { hunger: 'yes', bingeUrge: 'yes', preSleepOvereating: 'yes' },
    '2026-10-10': { hunger: 'yes', bingeUrge: 'yes', preSleepOvereating: 'yes' },
    '2026-09-31': { hunger: 'yes' },
  };
  const before = JSON.stringify(store);
  const result = summarizeDietSelfResponses(store, '2026-10-09', 7);
  assert.deepEqual(result, {
    hunger: { count: 2, answers: 3, rate: 67, unrecognized: 0 },
    bingeUrge: { count: 0, answers: 1, rate: 0, unrecognized: 2 },
    preSleepOvereating: { count: 1, answers: 2, rate: 50, unrecognized: 1 },
  });
  assert.equal(JSON.stringify(store), before);
  assert.equal(dietSelfResponseMetricText(result.hunger), '예 2일 / 응답 3일 · 67%');
  assert.equal(dietSelfResponseMetricText(result.bingeUrge), '예 0일 / 응답 1일 · 0% · 기존 응답 확인 필요 2일 (계산 제외)');
});

test('무응답은 0%가 아닌 미기록이고 전체 기간 경계와 윤년을 구분한다', () => {
  const empty = { count: 0, answers: 0, rate: null, unrecognized: 0 };
  assert.deepEqual(summarizeDietSelfResponses({}, '2026-10-09', 7).hunger, empty);
  assert.equal(dietSelfResponseMetricText(empty), '미기록 · 응답 0일');
  assert.equal(dietSelfResponseMetricText({ ...empty, unrecognized: 1 }), '미기록 · 응답 0일 · 기존 응답 확인 필요 1일 (계산 제외)');
  const store = Object.fromEntries(['2024-03-01', '2024-02-29', '2024-02-24', '2024-02-23', '2024-02-30'].map(date => [date, { hunger: 'yes' }]));
  assert.equal(summarizeDietSelfResponses(store, '2024-03-01', 7).hunger.answers, 3);
  for (const end of ['2026-02-29', '2026-02-31', 'bad-date']) assert.deepEqual(summarizeDietSelfResponses(store, end, 7).hunger, empty);
  for (const days of [0, -1, 1.5, NaN, Infinity]) assert.deepEqual(summarizeDietSelfResponses(store, '2024-03-01', days).hunger, empty);
});

test('28일 비교는 오늘을 제외하고 독립된 응답 수로 각 항목의 비교 가능 여부를 판단한다', () => {
  const store = Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`2026-09-${String(index + 1).padStart(2, '0')}`, {
    hunger: index < 7 ? 'yes' : 'no', bingeUrge: index < 6 ? 'yes' : 'unrecorded', preSleepOvereating: 'no',
  }]));
  Object.assign(store, Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`2026-08-${String(index + 1).padStart(2, '0')}`, {
    hunger: 'yes', bingeUrge: 'no', preSleepOvereating: 'no',
  }])));
  const result = dietPatterns(store, '2026-09-17')!;
  assert.deepEqual(result.selfResponseDeltas, [
    { key: 'hunger', label: '배고픔', delta: -50 },
    { key: 'bingeUrge', label: '폭식 충동', delta: null },
    { key: 'preSleepOvereating', label: '수면 전 과식', delta: 0 },
  ]);
  assert.deepEqual(result.current.days[0].selfResponses, { hunger: 'no', bingeUrge: 'unrecorded', preSleepOvereating: 'no' });
  const boundaryStore = Object.fromEntries(['2026-09-17', '2026-09-16', '2026-08-20', '2026-08-19', '2026-07-23', '2026-07-22'].map(date => [date, { hunger: 'yes' }]));
  const boundary = dietPatterns(boundaryStore, '2026-09-17')!;
  assert.equal(boundary.current.selfResponses.hunger.answers, 2);
  assert.equal(boundary.previous.selfResponses.hunger.answers, 2);
});


test('기존 소화·식사 응답도 새 필드의 무관한 저장에서 알 수 없는 값을 보존한다', () => {
  for (const normalize of [normalizeDigestion, normalizeMealCheck]) {
    for (const raw of ['future-answer', false, null, { version: 2 }]) {
      assert.equal(hasUnrecognizedDietResponse(raw, normalize), true);
      assert.equal(preserveUneditedDietResponse(raw, 'unrecorded', false), raw);
      assert.equal(preserveUneditedDietResponse(raw, 'unrecorded', true), 'unrecorded');
    }
    assert.equal(hasUnrecognizedDietResponse(undefined, normalize), false);
    assert.equal(hasUnrecognizedDietResponse('unrecorded', normalize), false);
    assert.equal(preserveUneditedDietResponse(undefined, 'unrecorded', false), 'unrecorded');
  }
  assert.equal(hasUnrecognizedDietResponse('abdominal_pain', normalizeDigestion), false);
  assert.equal(hasUnrecognizedDietResponse('diarrhea', normalizeDigestion), false);
  assert.equal(preserveUneditedDietResponse('diarrhea', 'abdominal_pain', true), 'abdominal_pain');
});

test('다른 탭이 바꾼 기존 응답도 현재 탭에서 직접 편집하지 않았다면 최신 값을 보존한다', () => {
  assert.equal(preserveUneditedDietResponse('diarrhea', 'unrecorded', false), 'diarrhea');
  assert.equal(preserveUneditedDietResponse('yes', 'no', false), 'yes');
  assert.equal(preserveUneditedDietResponse('no', 'yes', false), 'no');
  assert.equal(preserveUneditedDietResponse('unrecorded', 'yes', false), 'unrecorded');
  assert.equal(preserveUneditedDietResponse(undefined, 'yes', false), 'unrecorded');
  assert.equal(preserveUneditedDietResponse('yes', 'no', true), 'no');
  const latest = { hunger: 'no', bingeUrge: 'yes', preSleepOvereating: 'future-answer', digestionStatus: 'diarrhea', lateSnack: 'yes', afterWorkoutMeal: 'no', originalField: { keep: true } };
  const saved = {
    ...latest,
    digestionStatus: preserveUneditedDietResponse(latest.digestionStatus, 'unrecorded', false),
    lateSnack: preserveUneditedDietResponse(latest.lateSnack, 'unrecorded', false),
    afterWorkoutMeal: preserveUneditedDietResponse(latest.afterWorkoutMeal, 'unrecorded', false),
    ...dietSelfResponsePatch({ hunger: 'yes' }),
  };
  assert.deepEqual(saved, { ...latest, hunger: 'yes' });
});
