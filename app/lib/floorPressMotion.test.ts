import test from 'node:test';
import assert from 'node:assert/strict';
import { floorPressPose, floorPressMotionId, projectFloorPoint, type Vector3 } from './floorPressMotion.ts';
const distance = (a: Vector3,b: Vector3) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
test('floor press preserves 3D limbs, paired motion, wrist stack and fixed supports', () => {
  const initial = floorPressPose(0);
  for (let i=0;i<=400;i++) {
    const p = floorPressPose(i/400);
    for(const key of ['head','neck','hip','leftHip','rightHip','leftKnee','rightKnee','leftAnkle','rightAnkle','leftToe','rightToe'] as const) assert.deepEqual(p[key], initial[key]);
    for(const arm of [p.left,p.right]) {
      assert.ok(Math.abs(distance(arm.shoulder,arm.elbow)-38)<1e-8);
      assert.ok(Math.abs(distance(arm.elbow,arm.hand)-35)<1e-8);
      assert.equal(arm.hand.x,arm.elbow.x); assert.equal(arm.hand.y,arm.elbow.y);
      assert.ok(arm.elbow.z>=6 && arm.hand.z>arm.elbow.z);
      assert.ok(Math.abs(arm.elbow.x-arm.shoulder.x)>3, 'no straight elbow lock');
      for(const q of Object.values(arm)) for(const view of ['oblique','side'] as const) {
        const projected = projectFloorPoint(q, view);
        assert.ok(projected.x>10 && projected.x<290 && projected.y>10 && projected.y<260);
      }
    }
    assert.equal(p.left.hand.x,-p.right.hand.x);
    assert.equal(p.left.hand.z,p.right.hand.z);
    assert.ok(distance(p.left.hand,p.right.hand)>40, 'weights remain separated');
  }
});
test('floor contacts at lower pose, upper arms lift, both views share geometry and cycle closes', () => {
  const a=floorPressPose(0), b=floorPressPose(.5);
  assert.equal(a.right.elbow.z,6);
  assert.ok(b.right.elbow.z>43 && b.right.hand.z>78);
  assert.ok(projectFloorPoint(b.right.hand,'side').y<projectFloorPoint(a.right.hand,'side').y-35);
  assert.deepEqual(floorPressPose(1),a);
  for(const p of [NaN,Infinity,-1,2]) assert.deepEqual(floorPressPose(p),a);
  assert.equal(floorPressMotionId('dumbbell-floor-press'),'dumbbell-floor-press');
  assert.equal(floorPressMotionId('bench-press'),null);
});
