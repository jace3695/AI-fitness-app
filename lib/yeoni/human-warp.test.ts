import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanTransform, type HumanPose } from './human-warp.ts';

const poses: HumanPose[] = [-.024, 0, .024].flatMap(angle => [-.008, 0, .008].flatMap(breath => [-2, 0, 11].map(drop => ({ angle, breath, drop }))));
test('human neutral is identity and torso bottom remains anchored', () => {
  const neutral = humanTransform({ angle: 0, breath: 0, drop: 0 });
  for (const x of [0, 425, 524, 1024]) for (const y of [0, 512, 696, 740, 816, 1536]) assert.deepEqual(neutral.forward(x, y), { x, y });
  for (const pose of poses) assert.deepEqual(humanTransform(pose).forward(524, 1536), { x: 524, y: 1536 });
});
test('all facial patch corners follow a single rigid head transformation', () => {
  const points = [{ x: 354, y: 355 }, { x: 672, y: 427 }, { x: 425, y: 512 }, { x: 625, y: 624 }];
  for (const pose of poses) { const t = humanTransform(pose); for (const a of points) for (const b of points) {
    const p = t.forward(a.x, a.y), q = t.forward(b.x, b.y);
    assert.ok(Math.abs(Math.hypot(p.x - q.x, p.y - q.y) - Math.hypot(a.x - b.x, a.y - b.y)) < 1e-9);
  } }
});
test('inverse mapping is continuous and accurate through head-body split and neck', () => {
  for (const pose of poses) { const t = humanTransform(pose);
    for (let y = 600; y <= 900; y += 5) for (let x = 250; x <= 750; x += 25) {
      const p = t.forward(x, y), q = t.inverse(p.x, p.y);
      assert.ok(Math.hypot(x - q.x, y - q.y) < .01, JSON.stringify({ pose, x, y, q }));
      const next = t.forward(x, y + .01); assert.ok(next.y > p.y && Math.hypot(next.x - p.x, next.y - p.y) < .02);
    }
    for (const y of [696, 740, 816]) { const a = t.forward(520, y - 1e-5), b = t.forward(520, y + 1e-5); assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < .0001); }
  }
});
