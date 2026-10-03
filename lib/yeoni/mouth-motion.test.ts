import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mouthAt, REST_MOUTH } from './mouth-motion.ts';
import { parseLipSyncManifest } from './lip-sync.ts';
import { CharacterController, type CharacterPolicy } from './character-controller.ts';
import { morphMouthPixels, mouthMesh, MOUTH_TRIANGLES, HUMAN_MOUTH_GEOMETRY, CAT_MOUTH_GEOMETRY } from './mouth-morph.ts';

const manifest = parseLipSyncManifest(JSON.parse(readFileSync(new URL('../../docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json', import.meta.url), 'utf8')));
const policy: CharacterPolicy = { enabled: true, ready: true, visible: true, inView: true, editing: false, modal: false, reducedMotion: false };
test('brief consonants join adjacent vowels; 10 ms glides do not force a full-mouth flash', () => {
  assert.deepEqual(mouthAt(manifest, 180), { from: 'a', to: 'a', mix: 0 });
  const glide = mouthAt(manifest, 645);
  assert.equal(glide.from, 'e'); assert.equal(glide.to, 'o'); assert.ok(glide.mix > 0 && glide.mix < 1);
  assert.equal(manifest.cues.find(c => c.startMs === 640)?.phone, 'j');
});
test('all measured silence and lip closure interiors remain completely closed', () => {
  for (const time of [0, 30, 950, 1000, 1119, 2720, 3100, 3369, 5200, 5376, -1, NaN, Infinity]) assert.deepEqual(mouthAt(manifest, time), REST_MOUTH);
  for (let time = 3940; time < 4020; time++) assert.deepEqual(mouthAt(manifest, time), { from: 'closed', to: 'closed', mix: 0 });
});
test('visual pose is immutable, bounded and independent of sampling order or playback rate', () => {
  const before = JSON.stringify(manifest);
  const times = [450, 645, 180, 4010, 5000, 3100, 500, 4365];
  const snapshots = times.map(time => mouthAt(manifest, time));
  for (const [i, time] of times.entries()) { const pose = mouthAt(manifest, time); assert.deepEqual(pose, snapshots[i]); assert.ok(Object.isFrozen(pose)); }
  for (let time = 0; time <= manifest.durationMs; time += 7) { const pose = mouthAt(manifest, time); assert.ok(pose.mix >= 0 && pose.mix <= 1); }
  assert.equal(JSON.stringify(manifest), before);
});
test('all gates, playback interruptions and replaced clips clear visual pose without a lingering blend', () => {
  const c = new CharacterController(); c.setSpeech(manifest);
  const playback = { state: 'playing' as const, currentTimeMs: 645, clipId: manifest.audioSha256 };
  assert.notDeepEqual(c.sample(playback, 0, policy).mouth, REST_MOUTH);
  for (const state of ['empty', 'loading', 'ready', 'paused', 'ended', 'waiting', 'seeking', 'error'] as const) assert.deepEqual(c.sample({ ...playback, state }, 0, policy).mouth, REST_MOUTH);
  for (const key of Object.keys(policy) as (keyof CharacterPolicy)[]) assert.deepEqual(c.sample(playback, 0, { ...policy, [key]: !policy[key] }).mouth, REST_MOUTH);
  assert.deepEqual(c.sample({ ...playback, clipId: 'replacement' }, 0, policy).mouth, REST_MOUTH);
  assert.equal(c.sample(playback, 0, policy, 'direct').mouth, undefined);
  assert.equal(c.sample(playback, 0, policy).viseme, 'i');
  c.setSpeech(null); assert.deepEqual(c.sample(playback, 0, policy).mouth, REST_MOUTH);
});
test('every mouth geometry is ordered inside its renderer patch', () => {
  for (const [geometry, width, height] of [[HUMAN_MOUTH_GEOMETRY, 200, 112], [CAT_MOUTH_GEOMETRY, 51, 36]] as const) {
    for (const g of Object.values(geometry)) for (let i = 0; i < 5; i++) {
      assert.ok(g.x[i] > (g.x[i - 1] ?? 0) && g.x[i] < width - 1);
      assert.ok(0 < g.upper[i] && g.upper[i] < g.openingTop[i] && g.openingTop[i] < g.openingBottom[i] && g.openingBottom[i] < g.lower[i] && g.lower[i] < height - 1);
    }
    for (const a of Object.values(geometry)) for (const b of Object.values(geometry)) for (const mix of [0, .25, .5, .75, 1]) {
      const aa = mouthMesh(a, width, height), bb = mouthMesh(b, width, height), points = aa.map((p, i) => ({ x: p.x * (1 - mix) + bb[i].x * mix, y: p.y * (1 - mix) + bb[i].y * mix }));
      for (const [i, j, k] of MOUTH_TRIANGLES) { const p = points[i], q = points[j], r = points[k]; assert.ok((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x) > 0, 'Mesh may not fold or collapse'); }
    }
  }
});
test('pixel morph preserves exact endpoints, identity, fixed border and symmetric halfway blend', () => {
  const w = 51, h = 36, a = new Uint8ClampedArray(w * h * 4), b = new Uint8ClampedArray(a.length), out = new Uint8ClampedArray(a.length), reverse = new Uint8ClampedArray(a.length);
  for (let i = 0; i < a.length; i++) { a[i] = i % 4 === 3 ? 255 : (i * 7) % 251; b[i] = i % 4 === 3 ? 255 : (i * 13) % 251; }
  const from = CAT_MOUTH_GEOMETRY.a, to = CAT_MOUTH_GEOMETRY.o;
  morphMouthPixels(a, b, out, w, h, from, to, 0); assert.deepEqual(out, a);
  morphMouthPixels(a, b, out, w, h, from, to, 1); assert.deepEqual(out, b);
  morphMouthPixels(a, a, out, w, h, from, from, .5); assert.deepEqual(out, a);
  morphMouthPixels(a, b, out, w, h, from, to, .5); morphMouthPixels(b, a, reverse, w, h, to, from, .5); assert.deepEqual(out, reverse);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x === 0 || y === 0 || x === w - 1 || y === h - 1)
    for (let c = 0; c < 4; c++) { const i = (y * w + x) * 4 + c; assert.equal(out[i], new Uint8ClampedArray([(a[i] + b[i]) / 2])[0]); }
});
test('cat nose rows stay pinned while every interior pixel receives opaque output', () => {
  const w = 51, h = 36, a = new Uint8ClampedArray(w * h * 4).fill(120), b = new Uint8ClampedArray(a.length).fill(180), out = new Uint8ClampedArray(a.length);
  for (let i = 3; i < a.length; i += 4) a[i] = b[i] = 255;
  for (let i = 0; i < w * 5 * 4; i++) if (i % 4 !== 3) a[i] = b[i] = i % 251;
  morphMouthPixels(a, b, out, w, h, CAT_MOUTH_GEOMETRY.rest, CAT_MOUTH_GEOMETRY.u, .5, 1, 4);
  assert.deepEqual(out.slice(0, w * 5 * 4), a.slice(0, w * 5 * 4));
  for (let i = 3; i < out.length; i += 4) assert.equal(out[i], 255);
});
