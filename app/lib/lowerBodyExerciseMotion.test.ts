import assert from 'node:assert/strict';
import test from 'node:test';
import { lowerBodyExercisePose, lowerBodyMotionId } from './lowerBodyExerciseMotion.ts';
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8);
test('hamstring curl rotates only lower working leg while maintaining support contacts and thigh', () => {
  const start = lowerBodyExercisePose('supported-hamstring-curl', 0);
  for (let i = 0; i <= 200; i++) {
    const p = lowerBodyExercisePose('supported-hamstring-curl', i / 200);
    for (const key of Object.keys(p) as (keyof typeof p)[]) {
      if (key !== 'ankle' && key !== 'toe') assert.deepEqual(p[key], start[key]);
    }
    near(distance(p.hip, p.knee), 48); near(distance(p.knee, p.ankle), 48); near(distance(p.ankle, p.toe), 22);
    assert.ok(p.toe.y <= 272 + 1e-8, 'toe must not penetrate floor during lift-off');
  }
  const peak = lowerBodyExercisePose('supported-hamstring-curl', .5);
  assert.ok(peak.ankle.x < start.ankle.x - 40 && peak.ankle.y < start.ankle.y - 30);
});
test('squat moves hip back/down with both feet planted, constant limbs and unbent trunk', () => {
  const start = lowerBodyExercisePose('bodyweight-squat', 0);
  for (let i = 0; i <= 200; i++) {
    const p = lowerBodyExercisePose('bodyweight-squat', i / 200);
    for (const key of ['ankle', 'toe', 'farAnkle', 'farToe'] as const) assert.deepEqual(p[key], start[key]);
    near(distance(p.ankle, p.knee), 58); near(distance(p.knee, p.hip), 58);
    near(distance(p.hip, p.shoulder), 77); near(distance(p.shoulder, p.head), 26); near(distance(p.hip, p.head), 103);
    near(distance(p.shoulder, p.elbow), 34); near(distance(p.elbow, p.hand), 32);
    near(distance(p.farAnkle, p.farKnee), 58); near(distance(p.farKnee, p.farHip), 58);
  }
  const peak = lowerBodyExercisePose('bodyweight-squat', .5);
  assert.ok(peak.hip.x < start.hip.x - 30 && peak.hip.y > start.hip.y + 30);
  assert.ok(peak.knee.x > start.knee.x + 15);
});
test('new motions have distinct displacement signatures, valid bounds and closed cycles', () => {
  for (const id of ['supported-hamstring-curl', 'bodyweight-squat'] as const) {
    assert.equal(lowerBodyMotionId(id), id);
    assert.deepEqual(lowerBodyExercisePose(id, 0), lowerBodyExercisePose(id, 1));
    for (const invalid of [NaN, Infinity, -1]) assert.deepEqual(lowerBodyExercisePose(id, invalid), lowerBodyExercisePose(id, 0));
    for (let i = 0; i <= 200; i++) for (const p of Object.values(lowerBodyExercisePose(id, i / 200))) assert.ok(Number.isFinite(p.x) && p.x > 30 && p.x < 265 && p.y > 30 && p.y <= 272);
  }
  const curlStart = lowerBodyExercisePose('supported-hamstring-curl', 0), curlPeak = lowerBodyExercisePose('supported-hamstring-curl', .5);
  const squatStart = lowerBodyExercisePose('bodyweight-squat', 0), squatPeak = lowerBodyExercisePose('bodyweight-squat', .5);
  assert.equal(curlPeak.hip.y - curlStart.hip.y, 0);
  assert.notEqual(squatPeak.hip.y - squatStart.hip.y, 0);
  assert.equal(squatPeak.ankle.y - squatStart.ankle.y, 0);
  assert.notEqual(curlPeak.ankle.y - curlStart.ankle.y, 0);
  assert.equal(lowerBodyMotionId('dead-bug'), null); assert.equal(lowerBodyMotionId('__proto__'), null);
});
