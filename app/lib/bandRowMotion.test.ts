import assert from 'node:assert/strict';
import test from 'node:test';
import { bandRowPose, bandRowMotionId } from './bandRowMotion.ts';
const distance = (a: {x: number; y: number}, b: {x: number; y: number}) => Math.hypot(a.x-b.x, a.y-b.y);
test('row keeps feet, torso and anchor fixed with constant arm segments', () => {
  const start = bandRowPose(0);
  let length = distance(start.hand, start.anchor);
  for (let i = 0; i <= 400; i++) {
    const pose = bandRowPose(i / 400);
    for (const key of Object.keys(pose) as (keyof typeof pose)[]) {
      if (key !== 'hand' && key !== 'elbow') assert.deepEqual(pose[key], start[key]);
      assert.ok(pose[key].x > 0 && pose[key].x < 300 && pose[key].y > 0 && pose[key].y < 300);
    }
    assert.ok(Math.abs(distance(pose.shoulder, pose.elbow) - 43) < 1e-8);
    assert.ok(Math.abs(distance(pose.elbow, pose.hand) - 42) < 1e-8);
    assert.equal(pose.hand.y, pose.elbow.y);
    const next = distance(pose.hand, pose.anchor);
    if (i <= 200) assert.ok(next >= length - 1e-8, 'band extends while pulling away from fixed anchor');
    else assert.ok(next <= length + 1e-8);
    length = next;
  }
});
test('row moves elbow backwards, distinct from stationary-elbow curl, and closes cycle', () => {
  const start = bandRowPose(0), peak = bandRowPose(.5);
  assert.ok(peak.elbow.x < start.elbow.x - 20);
  assert.ok(peak.hand.x < start.hand.x - 20);
  assert.ok(peak.hand.x > peak.shoulder.x);
  assert.deepEqual(bandRowPose(1), start);
  for (const p of [NaN, Infinity, -1]) assert.deepEqual(bandRowPose(p), start);
  assert.deepEqual(bandRowPose(2), start);
  assert.equal(bandRowMotionId('band-row'), 'band-row');
  for (const id of [undefined, 'band-pull-apart', 'band-row-copy']) assert.equal(bandRowMotionId(id), null);
});
