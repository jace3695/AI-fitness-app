import test from 'node:test';
import assert from 'node:assert/strict';
import { CAT_TRIANGLES, warpCatPoint, type CatWarp } from './cat-warp.ts';

const zero: CatWarp = { headAngle: 0, headDrop: 0, breath: 0, tailAngle: 0, lift: 0 };
test('cat neutral maps the entire source exactly onto itself', () => {
  for (const t of CAT_TRIANGLES) for (const p of t) assert.deepEqual(warpCatPoint(p, zero), p);
});
test('face eye, nose and mouth distances remain rigid at combined motion limits', () => {
  const face = [{ x: 134, y: 175 }, { x: 224, y: 175 }, { x: 178, y: 187 }, { x: 178, y: 209 }];
  for (const headAngle of [-.04, .04]) for (const headDrop of [-4, 4]) for (const breath of [-.008, .008]) {
    const points = face.map(p => warpCatPoint(p, { headAngle, headDrop, breath, tailAngle: .05, lift: 5 }));
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++)
      assert.ok(Math.abs(Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) - Math.hypot(face[i].x - face[j].x, face[i].y - face[j].y)) < 1e-9);
  }
});
test('neck and tail mesh cannot fold over at combined allowed extremes', () => {
  for (const headAngle of [-.04, 0, .04]) for (const headDrop of [-4, 0, 4]) for (const breath of [-.008, .008]) for (const tailAngle of [-.05, .05]) {
    for (const t of CAT_TRIANGLES) {
      const [a, b, c] = t.map(p => warpCatPoint(p, { headAngle, headDrop, breath, tailAngle, lift: 5 }));
      const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      assert.ok(area > 250, `Folded or compressed mesh: ${area}`);
    }
  }
});
