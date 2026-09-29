import test from 'node:test';
import assert from 'node:assert/strict';
import { CharacterController, type CharacterPolicy, type CharacterFrame, type CharacterRenderer, type PlaybackSnapshot } from './character-controller.ts';
import { parseLipSyncManifest } from './lip-sync.ts';

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
