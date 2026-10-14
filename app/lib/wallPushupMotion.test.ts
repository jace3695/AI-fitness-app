import assert from 'node:assert/strict';
import test from 'node:test';
import { ARM_LENGTH, wallPushupPose, type Point } from './wallPushupMotion.ts';

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
test('original wall pushup cycle maintains wall/foot contacts, limb lengths and straight trunk', () => {
  for (let step = 0; step <= 100; step++) {
    const p = wallPushupPose(step / 100);
    assert.deepEqual(p.hand, { x: 210, y: 106 });
    assert.deepEqual(p.ankle, { x: 90, y: 270 });
    assert.ok(Math.abs(distance(p.shoulder, p.elbow) - ARM_LENGTH) < 1e-8);
    assert.ok(Math.abs(distance(p.elbow, p.hand) - ARM_LENGTH) < 1e-8);
    assert.ok(Math.abs(distance(p.ankle, p.hip) + distance(p.hip, p.shoulder) - 165) < 1e-8);
    assert.ok(p.head.x + 14 < 210);
    assert.ok(p.elbow.y > p.shoulder.y && p.elbow.x < 210);
    for (const point of Object.values(p)) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  }
  assert.deepEqual(wallPushupPose(0), wallPushupPose(1));
  assert.ok(wallPushupPose(.5).shoulder.x > wallPushupPose(0).shoulder.x);
});
