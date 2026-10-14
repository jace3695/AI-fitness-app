import test from 'node:test';
import assert from 'node:assert/strict';
import { expandedHomeExercises, expandedEquipmentIds } from './expandedHomeExercises.ts';
import { HOME_EQUIPMENT, homeExerciseCandidates, isHomeSelectable } from './homeExerciseCatalog.ts';
import { WORKOUT_GROUPS } from './workoutGroups.ts';
import { applyDayRoutineEdit } from './userWorkoutSettings.ts';
import type { DayWorkout } from './workouts.ts';

test('new catalog entries have complete sourced guides and no automatic group membership', () => {
  const catalog = HOME_EQUIPMENT.flatMap(homeExerciseCandidates);
  assert.equal(catalog.length, 30);
  assert.equal(new Set(catalog.map(x => x.exerciseId)).size, 30);
  const newIds = Object.keys(expandedHomeExercises);
  assert.equal(newIds.length, 5);
  assert.deepEqual(Object.values(expandedEquipmentIds).flat().sort(), newIds.sort());
  for (const [id, guide] of Object.entries(expandedHomeExercises)) {
    assert.ok(guide.equipment && guide.target && guide.difficulty);
    assert.ok(guide.setup.length && guide.movement.length && guide.commonMistakes.length && guide.stopCriteria.length && guide.alternatives?.length);
    assert.equal(guide.catalogOnly, true);
    assert.ok(guide.sources?.every(source => ['www.nhs.uk', 'www.orthoinfo.org'].includes(new URL(source.url).hostname)));
    assert.ok(guide.stopCriteria.some(text => text.includes('허리')));
    assert.ok(isHomeSelectable(id, guide.name));
    assert.equal(JSON.stringify(WORKOUT_GROUPS).includes(id), false);
    assert.equal(guide.sets, undefined);
    assert.equal(guide.reps, undefined);
    const saved = JSON.parse(JSON.stringify({ customExercises: [{ id: `custom-${id}-123`, sourceExerciseId: id, name: guide.name }] }));
    const restored = applyDayRoutineEdit({ phases: [{ id: 'main', exercises: [] }] } as unknown as DayWorkout, saved).phases[0].exercises[0];
    assert.equal(restored.sourceExerciseId, id);
    assert.deepEqual(restored.guide?.sources, guide.sources);
  }
});

test('unverified equipment loads and high demand motions are not new choices', () => {
  assert.equal(homeExerciseCandidates('케틀벨 · 바벨').length, 0);
  assert.deepEqual(homeExerciseCandidates('AB 슬라이드').map(x => x.exerciseId), ['ab-slider-ready-position']);
  assert.match(expandedHomeExercises['band-external-rotation-at-side'].setup.join(' '), /고정 장치가 없으면 선택하지/);
});
