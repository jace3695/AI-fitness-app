import test from 'node:test';
import assert from 'node:assert/strict';
import { catPose, canAnimate } from './cat-motion.ts';

test('every suspension reason independently stops motion', () => {
  const yes = { enabled: true, ready: true, visible: true, inView: true, editing: false, modal: false, reducedMotion: false };
  assert.equal(canAnimate(yes), true);
  for (const key of ['enabled', 'ready', 'visible', 'inView'] as const) assert.equal(canAnimate({ ...yes, [key]: false }), false, key);
  for (const key of ['editing', 'modal', 'reducedMotion'] as const) assert.equal(canAnimate({ ...yes, [key]: true }), false, key);
});
test('resting pose resets a closed blink and every transform', () => {
  assert.deepEqual(catPose(4250, false), { blink: 'open', breath: 0, tailAngle: 0 });
  assert.equal(catPose(4250).blink, 'closed');
  assert.equal(catPose(4140).blink, 'half');
  assert.equal(catPose(4490).blink, 'open');
});
test('long running motion remains bounded and invalid clocks cannot corrupt the canvas', () => {
  for (const t of [-1, NaN, Infinity, 0, 1000, 90000000]) {
    const p = catPose(t);
    assert.ok(Math.abs(p.breath) <= 0.008);
    assert.ok(Math.abs(p.tailAngle) <= 0.055);
  }
});
