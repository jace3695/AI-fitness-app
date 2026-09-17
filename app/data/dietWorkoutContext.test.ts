import test from 'node:test';
import assert from 'node:assert/strict';
import { dietWorkoutContext } from './dietWorkoutContext.ts';

test('운동 표시는 실제 완료·일부·중단과 유산소만 사용하고 저장 시각은 무시한다', () => {
  const workout = { '2026-09-16': {workoutStatus:'partial'}, '2026-09-15': {cardioDone:true}, '2026-09-14': {workoutRecordedAt:'2026-09-14T12:00:00Z'}, '2026-09-13':false, '2026-09-12':true, '2026-09-11':{workoutStatus:'stopped'} };
  const diet = {'2026-09-16':{afterWorkoutMeal:'yes',lastMealTime:'18:30'},'2026-09-15':{afterWorkoutMeal:'no'}};
  const before=JSON.stringify({workout,diet});
  const data=dietWorkoutContext(diet,JSON.stringify(workout),'2026-09-17')!;
  assert.deepEqual([data.workoutDays,data.yes,data.no,data.unrecorded],[4,1,1,2]);
  assert.equal(data.days[0].lastMealTime,'18:30');
  assert.equal(data.days[2].workout,false);
  assert.equal(JSON.stringify({workout,diet}),before);
});

test('양쪽 날짜 합집합과 28일 경계를 사용하고 오늘·미래·잘못된 날짜를 제외한다', () => {
  const data=dietWorkoutContext({'2024-02-29':{},'2024-02-02':{},'2024-02-01':{},'2024-03-01':{},'2024-03-02':{},'2024-02-30':{}},{'2024-02-28':true},'2024-03-01')!;
  assert.deepEqual(data.days.map(d=>d.date),['2024-02-29','2024-02-28','2024-02-02']);
  assert.equal(dietWorkoutContext({}, {}, '2023-02-29'),null);
});

test('빈 기록은 미확인이고 잘못된 저장 형식은 빈 기록으로 표시하지 않는다', () => {
  assert.equal(dietWorkoutContext({},'{broken','2026-09-17'),null);
  assert.equal(dietWorkoutContext({},[],'2026-09-17'),null);
  assert.equal(dietWorkoutContext([],{},'2026-09-17'),null);
  assert.equal(dietWorkoutContext({},null,'2026-09-17')!.days.length,0);
  const data=dietWorkoutContext({'2026-09-16':false},{'2026-09-16':{workoutDone:'true'}},'2026-09-17')!;
  assert.equal(data.days[0].workout,null);
  assert.equal(data.days[0].invalidMeal,true);
  assert.equal(data.workoutDays,0);
});

test('운동 후 식사 응답과 마지막 식사 시각은 서로 추정하지 않는다', () => {
  const data=dietWorkoutContext({'2026-09-16':{lastMealTime:'00:00'},'2026-09-15':{afterWorkoutMeal:'yes',lastMealTime:'24:00'},'2026-09-14':{afterWorkoutMeal:true,lastMealTime:''}}, {'2026-09-16':true,'2026-09-15':true,'2026-09-14':true}, '2026-09-17')!;
  assert.deepEqual([data.yes,data.no,data.unrecorded],[1,0,2]);
  assert.equal(data.days[0].lastMealTime,'00:00');
  assert.equal(data.days[1].invalidClock,true);
  assert.equal(data.days[2].lastMealTime,null);
  assert.equal(data.days[2].invalidClock,false);
});
