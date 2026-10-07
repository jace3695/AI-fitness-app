import test from 'node:test';
import assert from 'node:assert/strict';
import { CharacterController, type CharacterPolicy, type CharacterFrame, type CharacterRenderer, type PlaybackSnapshot } from './character-controller.ts';
import { parseLipSyncManifest } from './lip-sync.ts';
import { CHARACTER_EMOTIONS, CHARACTER_GESTURES, EXPRESSIONS, GESTURE_DURATION } from './character-expression.ts';

const policy: CharacterPolicy = { enabled: true, ready: true, visible: true, inView: true, editing: false, modal: false, reducedMotion: false };
const manifest = parseLipSyncManifest({ version: 1, language: 'ko-KR', voice: 'ko-KR-Chirp3-HD-Zephyr',
  spokenText: '아 이 우 에 오', audioSha256: 'a'.repeat(64), textSha256: 'b'.repeat(64), durationMs: 2000,
  alignment: 'automatic-phonemes', cues: ['ㅁ', 'ㅏ', 'ㅣ', 'ㅜ', 'ㅔ', 'ㅗ'].map((phone, i) => ({ phone, startMs: i * 200, endMs: (i + 1) * 200 })) });
const playback: PlaybackSnapshot = { clipId: manifest.audioSha256, currentTimeMs: 250, state: 'playing' };

test('one controller delivers identical immutable semantic frames to independent render adapters without DOM', () => {
  const controller = new CharacterController(); controller.setSpeech(manifest); controller.setEmotion('happy');
  const cat: CharacterFrame[] = [], human: CharacterFrame[] = [];
  const recorder = (target: CharacterFrame[]): CharacterRenderer => ({ render: frame => { target.push(frame); }, dispose() {} });
  const adapters = [recorder(cat), recorder(human)];
  for (let i = 0; i < 6; i++) {
    const frame = controller.sample({ ...playback, currentTimeMs: i * 200 + 50 }, 4200, policy);
    adapters.forEach(adapter => adapter.render(frame, { size: 400 }));
    assert.ok(Object.isFrozen(frame)); assert.equal(frame.emotion, 'happy'); assert.equal(frame.blink, 'closed');
  }
  assert.deepEqual(cat, human);
  assert.deepEqual(cat.map(frame => frame.viseme), ['closed', 'a', 'i', 'u', 'e', 'o']);
});
test('pause, end, wait, seek, error and every visibility gate close the mouth', () => {
  const controller = new CharacterController(); controller.setSpeech(manifest);
  for (const state of ['empty', 'loading', 'ready', 'paused', 'ended', 'waiting', 'seeking', 'error'] as const) {
    assert.equal(controller.sample({ ...playback, state }, 1000, policy).viseme, 'rest');
  }
  for (const key of Object.keys(policy) as (keyof CharacterPolicy)[]) {
    const frame = controller.sample(playback, 4200, { ...policy, [key]: !policy[key] });
    assert.equal(frame.viseme, 'rest'); assert.equal(frame.blink, 'open'); assert.equal(frame.breath, 0); assert.equal(frame.sway, 0);
  }
});
test('media position, not idle clock, controls seeks, gaps and replacement clips', () => {
  const controller = new CharacterController(); controller.setSpeech(manifest);
  assert.equal(controller.sample(playback, 90_000, policy).viseme, 'a');
  assert.equal(controller.sample({ ...playback, currentTimeMs: 1050 }, 0, policy).viseme, 'o');
  assert.equal(controller.sample({ ...playback, currentTimeMs: 450 }, 0, policy).viseme, 'i');
  assert.equal(controller.sample({ ...playback, currentTimeMs: 1500 }, 0, policy).viseme, 'rest');
  assert.equal(controller.sample({ ...playback, clipId: 'other' }, 0, policy).viseme, 'rest');
  controller.setSpeech(null); assert.equal(controller.sample(playback, 0, policy).viseme, 'rest');
});

test('all twelve expressions preserve speech cues and immutable bounded frames', () => {
  for (const emotion of CHARACTER_EMOTIONS) {
    const controller = new CharacterController(); controller.setSpeech(manifest); controller.setEmotion(emotion);
    controller.sample(playback, 0, policy);
    const pose = controller.sample(playback, 240, policy);
    assert.deepEqual(pose.expression, EXPRESSIONS[emotion]); assert.ok(Object.isFrozen(pose.expression));
    assert.equal(pose.viseme, 'a'); assert.ok(Object.values(pose.expression).every(Number.isFinite));
    for (let i = 0; i < 6; i++) {
      assert.equal(controller.sample({ ...playback, currentTimeMs: i * 200 + 50 }, 300 + i, policy).viseme,
        ['closed', 'a', 'i', 'u', 'e', 'o'][i]);
    }
  }
});
test('expression retargeting is continuous; disabled snapshots do not replay old blends', () => {
  const controller = new CharacterController(); controller.setEmotion('happy'); controller.sample(playback, 0, policy);
  const midway = controller.sample(playback, 120, policy).expression;
  assert.ok(midway.eyeSmile > 0 && midway.eyeSmile < 1);
  controller.setEmotion('concerned'); assert.deepEqual(controller.sample(playback, 120, policy).expression, midway);
  assert.deepEqual(controller.sample(playback, 360, policy).expression, EXPRESSIONS.concerned);
  controller.setEmotion('sleepy'); controller.sample(playback, 400, { ...policy, reducedMotion: true });
  assert.deepEqual(controller.sample(playback, 400, policy).expression, EXPRESSIONS.sleepy);
});
test('gestures are finite, replace instead of queue, and use the host animation clock', () => {
  for (const gesture of CHARACTER_GESTURES) {
    const controller = new CharacterController(); controller.setSpeech(manifest); controller.requestGesture(gesture);
    assert.equal(controller.sample(playback, 0, policy).gesture, gesture);
    const midway = controller.sample(playback, GESTURE_DURATION[gesture] / 2, policy);
    assert.equal(midway.gesture, gesture); assert.equal(midway.viseme, 'a');
    const end = controller.sample(playback, GESTURE_DURATION[gesture], policy);
    assert.equal(end.gesture, 'idle'); assert.equal(end.headTilt, 0); assert.equal(end.headNod, 0); assert.equal(end.bodyLift, 0);
  }
  const controller = new CharacterController(); controller.requestGesture('cheer'); controller.sample(playback, 0, policy);
  controller.requestGesture('greet'); assert.equal(controller.sample(playback, 200, policy).gesture, 'greet');
  assert.equal(controller.sample(playback, 1500, policy).gesture, 'idle');
});
test('visibility/reduced-motion gates and reset cancel gestures permanently', () => {
  for (const key of Object.keys(policy) as (keyof CharacterPolicy)[]) {
    const controller = new CharacterController(); controller.requestGesture('cheer'); controller.sample(playback, 0, policy);
    const stopped = controller.sample(playback, 200, { ...policy, [key]: !policy[key] });
    assert.equal(stopped.gesture, 'idle'); assert.equal(stopped.bodyLift, 0);
    assert.equal(controller.sample(playback, 201, policy).gesture, 'idle');
  }
  const controller = new CharacterController(); controller.setEmotion('happy'); controller.requestGesture('nod');
  controller.sample(playback, 200, policy); controller.reset();
  controller.sample(playback, 200, policy); const reset = controller.sample(playback, 440, policy);
  assert.equal(reset.emotion, 'neutral'); assert.equal(reset.gesture, 'idle');
  controller.requestGesture('tilt'); controller.sample(playback, 500, policy);
  assert.equal(controller.sample(playback, 0, policy).gesture, 'idle');
});
