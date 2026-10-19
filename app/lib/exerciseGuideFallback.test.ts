import assert from 'node:assert/strict';
import test from 'node:test';
import { exerciseGuides, fallbackExerciseGuide, getExerciseGuide } from '../data/exerciseGuides.ts';
import { getWorkoutGroupById, workoutGroupToDayWorkout } from '../data/workoutGroups.ts';

test('missing pullup posture guide does not borrow a different exercise or promote rest context into instructions', () => {
  assert.equal(exerciseGuides['pullup-posture-only'], undefined);
  for (const id of ['rest', 'cardio-foam-recovery']) {
    const day = workoutGroupToDayWorkout(getWorkoutGroupById(id), 'fixture', 'fixture');
    const exercise = day.phases.flatMap(p => p.exercises).find(e => e.exerciseId === 'pullup-posture-only')!;
    assert.ok(exercise);
    const guide = exercise.guide!;
    assert.match(guide.keyPoint!, /상세 안내 미등록/);
    assert.match(guide.target!, /사용 근육 정보가 등록되지/);
    assert.deepEqual(guide.setup, []);
    assert.deepEqual(guide.movement, ['동작 방법이 등록되지 않아 이 안내만으로 따라 할 수 없습니다.']);
    assert.equal(guide.videoSearchQuery, undefined);
    assert.equal(guide.videoUrl, undefined);
    assert.ok(guide.stopCriteria.length > 0);
    assert.ok(exercise.details.some(d => d.text === '**목적:** 목적 정보가 등록되지 않았습니다.'));
    const restContext = '휴식을 우선하고, 원할 때만 자세 연습을 선택합니다. 쉬고 싶으면 건너뛰세요.';
    assert.equal(exercise.details.filter(d => d.text.includes(restContext)).length, id === 'rest' ? 1 : 0);
    assert.notEqual(guide, getExerciseGuide('pullup-basic-posture'));
  }
});

test('unknown exercise context stays in summary without guessed posture, breathing, muscles or video', () => {
  for (const description of [undefined, '합성 사용자 메모']) {
    const guide = fallbackExerciseGuide('합성 미등록 운동', description);
    if (description) assert.equal(guide.summary, description);
    assert.equal(guide.purpose, '목적 정보가 등록되지 않았습니다.');
    assert.equal(guide.breathing, '');
    assert.equal(guide.keyPoint, '상세 안내 미등록 · 동작을 추측해서 따라 하지 마세요.');
    assert.deepEqual(guide.commonMistakes, []);
    assert.ok(guide.stopCriteria.includes('통증이 있으면 즉시 중단하세요.'));
  }
});

test('registered guides still resolve by exact ID and retain their safety instructions', () => {
  for (const id of ['pullup-basic-posture', 'wall-pushup', 'seated-knee-extension', 'light-dumbbell-curl']) {
    const guide = getExerciseGuide(id, 'different display name', 'unrelated rest description');
    assert.equal(guide, exerciseGuides[id]);
    assert.ok(guide.setup.length > 0);
    assert.ok(guide.movement.length > 0);
    assert.ok(guide.stopCriteria.length > 0);
    assert.notEqual(guide.summary, 'unrelated rest description');
  }
});
