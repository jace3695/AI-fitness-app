import assert from 'node:assert/strict';
import test from 'node:test';
import { supportedExercisePose, supportedMotionId, type MotionPoint } from './supportedExerciseMotion.ts';
const distance = (a: MotionPoint, b: MotionPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test('supported cycles preserve hand contacts and both arm segment lengths', () => {
  for (const id of ['supported-calf-raise', 'supported-side-leg-raise'] as const) {
    const start = supportedExercisePose(id, 0);
    assert.deepEqual(start, supportedExercisePose(id, 1));
    for (let i = 0; i <= 200; i++) {
      const p = supportedExercisePose(id, i / 200);
      assert.deepEqual(p.hand, start.hand);
      assert.deepEqual(p.farHand, start.farHand);
      const arm = id === 'supported-calf-raise' ? 57 : 32;
      near(distance(p.shoulder, p.elbow), arm); near(distance(p.elbow, p.hand), arm);
      near(distance(p.farShoulder, p.farElbow), arm); near(distance(p.farElbow, p.farHand), arm);
      for (const q of Object.values(p)) assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y) && q.x > 30 && q.x < 260 && q.y > 30 && q.y <= 272);
    }
  }
});
test('calf raise keeps both forefeet grounded and raises both heels without knee bending', () => {
  const start = supportedExercisePose('supported-calf-raise', 0);
  for (let i = 0; i <= 200; i++) {
    const p = supportedExercisePose('supported-calf-raise', i / 200);
    assert.deepEqual(p.toe, start.toe); assert.deepEqual(p.farToe, start.farToe);
    near(distance(p.toe, p.ankle), 30); near(distance(p.farToe, p.farAnkle), 30);
    near(p.ankle.y, p.farAnkle.y);
    near(distance(p.hip, p.knee), 48); near(distance(p.knee, p.ankle), 48);
    near(distance(p.hip, p.ankle), 96); near(distance(p.shoulder, p.hip), 78);
  }
  assert.ok(supportedExercisePose('supported-calf-raise', .5).ankle.y < start.ankle.y - 10);
});
test('side lift keeps support leg, level pelvis and trunk fixed while moving outward', () => {
  const start = supportedExercisePose('supported-side-leg-raise', 0);
  for (let i = 0; i <= 200; i++) {
    const p = supportedExercisePose('supported-side-leg-raise', i / 200);
    for (const key of ['farHip', 'farKnee', 'farAnkle', 'farToe', 'hip', 'shoulder', 'farShoulder', 'head'] as const) assert.deepEqual(p[key], start[key]);
    near(p.hip.y, p.farHip.y);
    near(distance(p.hip, p.knee), 50); near(distance(p.knee, p.ankle), 50);
    near(distance(p.hip, p.ankle), 100);
  }
  const peak = supportedExercisePose('supported-side-leg-raise', .5);
  assert.ok(peak.ankle.x > start.ankle.x + 25);
  assert.ok(peak.ankle.y < start.ankle.y);
});
test('unknown IDs are rejected and malformed progress returns start', () => {
  assert.equal(supportedMotionId('dead-bug'), null);
  assert.equal(supportedMotionId('__proto__'), null);
  for (const bad of [NaN, Infinity, -1]) assert.deepEqual(supportedExercisePose('supported-calf-raise', bad), supportedExercisePose('supported-calf-raise', 0));
});
