import test from 'node:test';
import assert from 'node:assert/strict';
import { HOME_EQUIPMENT, homeExerciseCandidates, isHomeSelectable } from './homeExerciseCatalog.ts';
import { applyDayRoutineEdit, customExerciseSource } from './userWorkoutSettings.ts';
import type { DayWorkout } from './workouts';

test('home choices include bodyweight and exclude sliding board/bridge everywhere', () => {
  assert.ok(homeExerciseCandidates('맨몸').length >= 4);
  for (const equipment of HOME_EQUIPMENT) for (const item of homeExerciseCandidates(equipment)) assert.equal(isHomeSelectable(item.exerciseId, item.name), true);
  assert.equal(isHomeSelectable('custom-hip-bridge-123'), false);
  assert.equal(isHomeSelectable('custom-sliding-board-cardio-123'), false);
  for (const name of ['슬라이딩 보드', '힙 브리지', 'Hip Bridge', 'Sliding Board']) assert.equal(isHomeSelectable('', name), false);
});
test('source identity and safety guide survive JSON restart, with legacy support', () => {
  const day = { phases: [{ exercises: [] }] } as unknown as DayWorkout;
  const edit = JSON.parse(JSON.stringify({ customExercises: [{ id: 'custom-ab-slider-ready-position-123', sourceExerciseId: 'ab-slider-ready-position', name: 'AB 슬라이더 준비 자세' }] }));
  const exercise = applyDayRoutineEdit(day, edit).phases[0].exercises[0];
  assert.equal(exercise.sourceExerciseId, 'ab-slider-ready-position');
  assert.equal(exercise.abSlideGate, true);
  assert.ok(exercise.guide?.stopCriteria.length);
  assert.equal(customExerciseSource({ id: 'custom-wall-pushup-123', name: '벽 푸시업' }), 'wall-pushup');
  assert.equal(customExerciseSource({ id: 'custom-123', name: '내 운동' }), undefined);
});

test('catalog additions appear once in main, never repeated in warmup and cooldown', () => {
  const day = { phases: ['warmup', 'main', 'cooldown'].map(id => ({ id, exercises: [] })) } as unknown as DayWorkout;
  const next = applyDayRoutineEdit(day, { customExercises: [{ id: 'custom-wall-pushup-123', sourceExerciseId: 'wall-pushup', name: '벽 푸시업' }] });
  assert.deepEqual(next.phases.map(phase => phase.exercises.length), [0, 1, 0]);
});
