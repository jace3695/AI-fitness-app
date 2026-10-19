import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceMotion, clampProgress, exerciseMotionPose, exerciseMotions, motionId } from './exerciseMotion.ts';

test('only explicitly supported catalog IDs are enabled', () => {
  for (const id of Object.keys(exerciseMotions)) assert.equal(motionId(id), id);
  for (const id of ['wall-pushup', 'constructor', '__proto__', '', undefined]) assert.equal(motionId(id), null);
});
test('both cycles preserve limb lengths, trunk and bounds across 201 frames', () => {
  for (const id of ['seated-knee-extension', 'light-dumbbell-curl'] as const) {
    const start = exerciseMotionPose(id, 0);
    assert.deepEqual(start, exerciseMotionPose(id, 1));
    for (let n = 0; n <= 200; n++) {
      const p = exerciseMotionPose(id, n / 200);
      for (const joint of ['head', 'shoulder', 'hip', 'knee', 'elbow'] as const) assert.deepEqual(p[joint], start[joint]);
      assert.ok(Math.abs(Math.hypot(p.ankle.x - p.knee.x, p.ankle.y - p.knee.y) - 55) < 1e-9);
      assert.ok(Math.abs(Math.hypot(p.hand.x - p.elbow.x, p.hand.y - p.elbow.y) - 46) < 1e-9);
      for (const q of Object.values(p)) assert.ok(q.x >= 30 && q.x <= 260 && q.y >= 30 && q.y <= 280);
    }
    const peak = exerciseMotionPose(id, .5);
    assert.ok(id === 'seated-knee-extension' ? peak.ankle.y < start.ankle.y : peak.hand.y < start.hand.y);
  }
});
test('invalid progress and clock values are bounded, end/repeat and speed are deterministic', () => {
  assert.equal(clampProgress(NaN), 0);
  assert.equal(clampProgress(Infinity), 0);
  assert.equal(clampProgress(-1), 0);
  assert.equal(clampProgress(4), 1);
  assert.deepEqual(advanceMotion(.999, 100, false, false), { progress: 1, ended: true });
  assert.ok(advanceMotion(.999, 100, false, true).progress < .02);
  assert.equal(advanceMotion(0, 100, false, false).progress, 2 * advanceMotion(0, 100, true, false).progress);
  assert.equal(advanceMotion(0, 99999, false, false).progress, 100 / 6000);
  assert.equal(advanceMotion(.2, -10, false, false).progress, .2);
  assert.equal(advanceMotion(.2, NaN, false, false).progress, .2);
});
