import test from 'node:test';
import assert from 'node:assert/strict';
import { GEMINI_ZEPHYR_VOICE, parseLipSyncManifest, phoneViseme, sha256, verifyLipSyncPair, visemeAt } from './lip-sync.ts';
import { mouthAt } from './mouth-motion.ts';
import { CharacterController, type CharacterPolicy } from './character-controller.ts';
import { japaneseTimelineFromLabels } from './japanese-alignment.ts';

const base = () => ({ version: 2, language: 'ja-JP', phoneSet: 'openjtalk-v1', voice: 'ja-JP-Chirp3-HD-Zephyr',
  spokenText: 'こんにちは。今日は少し休みましょう。', audioSha256: 'a'.repeat(64), textSha256: 'b'.repeat(64),
  durationMs: 4000, alignment: 'automatic-phonemes', cues: [
    { startMs: 100, endMs: 500, phone: 'a' }, { startMs: 500, endMs: 900, phone: 'a' },
    { startMs: 900, endMs: 960, phone: 'py' }, { startMs: 960, endMs: 1400, phone: 'I' },
    { startMs: 1400, endMs: 1650, phone: 'pau' }, { startMs: 1650, endMs: 1950, phone: 'N' },
    { startMs: 1950, endMs: 2250, phone: 'cl' }, { startMs: 2250, endMs: 2550, phone: 'U' },
    { startMs: 2550, endMs: 2700, phone: 'j' }, { startMs: 2700, endMs: 3200, phone: 'o' }] });
test('Japanese Open JTalk vowels, devoiced vowels, closure and silence have explicit projections', () => {
  for (const p of ['a', 'i', 'u', 'e', 'o']) { assert.equal(phoneViseme(p, 'ja-JP'), p); assert.equal(phoneViseme(p.toUpperCase(), 'ja-JP'), p); }
  for (const p of ['b', 'by', 'm', 'my', 'p', 'py']) assert.equal(phoneViseme(p, 'ja-JP'), 'closed');
  for (const p of ['sil', 'pau']) assert.equal(phoneViseme(p, 'ja-JP'), 'rest');
  for (const p of ['N', 'cl', 'ch', 'd', 'dy', 'f', 'g', 'gy', 'h', 'hy', 'j', 'k', 'ky', 'n', 'ny', 'r', 'ry', 's', 'sh', 't', 'ts', 'ty', 'v', 'z']) assert.equal(phoneViseme(p, 'ja-JP'), 'small');
  assert.equal(phoneViseme('w', 'ja-JP'), 'u'); assert.equal(phoneViseme('y', 'ja-JP'), 'i');
});
test('Japanese symbols never leak into Korean; identical j has language-specific meaning', () => {
  assert.equal(phoneViseme('j'), 'i'); assert.equal(phoneViseme('j', 'ja-JP'), 'small');
  for (const p of ['py', 'N', 'cl', 'U', 'pau']) assert.throws(() => phoneViseme(p));
  for (const p of ['ㅏ', 'ɐ', 'sʷ', 'iː']) assert.throws(() => phoneViseme(p, 'ja-JP'));
});
test('kana, unknown phones, G2P prosody and prototype names are not silently interpreted', () => {
  for (const p of ['あ', 'こんにちは', 'q', 'spn', '[', ']', '^', '$', '?', '_', '#', 'constructor', '__proto__', 'toString']) {
    assert.throws(() => parseLipSyncManifest({ ...base(), cues: [{ startMs: 0, endMs: 50, phone: p }] }));
  }
});
test('new language requires v2 and explicit Open JTalk convention; voice and language must agree', () => {
  for (const patch of [{ version: 1 }, { version: 3 }, { phoneSet: undefined }, { phoneSet: 'IPA' }, { language: 'ko-KR' },
    { language: 'en-US' }, { voice: 'ko-KR-Chirp3-HD-Zephyr' }, { voice: 'ja-JP-other' }, { alignment: 'equal-characters' }]) {
    assert.throws(() => parseLipSyncManifest({ ...base(), ...patch }));
  }
});
test('Japanese timeline freezes copied cues and preserves exact text and timing', () => {
  const input = base(), m = parseLipSyncManifest(input); input.cues[0].phone = 'o';
  assert.equal(m.spokenText, input.spokenText); assert.equal(m.cues[0].phone, 'a');
  assert.ok(Object.isFrozen(m) && Object.isFrozen(m.cues) && m.cues.every(Object.isFrozen));
  assert.equal(m.version, 2); assert.equal(m.language, 'ja-JP'); assert.equal(m.alignment, 'automatic-phonemes');
});
test('Gemini Japanese candidate keeps its own voice identity without broadening Korean or other voices', async () => {
  const bytes = new Uint8Array([7, 8, 9]).buffer;
  const candidate = await japaneseTimelineFromLabels(bytes, 'こんにちは。', '0 .2 sil\n.2 .7 a', 'seconds', 1000, GEMINI_ZEPHYR_VOICE);
  assert.equal(candidate.voice, GEMINI_ZEPHYR_VOICE);
  assert.equal(candidate.language, 'ja-JP');
  await verifyLipSyncPair(bytes, candidate);
  await assert.rejects(verifyLipSyncPair(new Uint8Array([7, 8, 0]).buffer, candidate));
  await assert.rejects(japaneseTimelineFromLabels(bytes, 'こんにちは。', '0 .2 sil\n.2 .7 a', 'seconds', 1000, 'gemini-3.8-flash-tts/Fola'));
  assert.throws(() => parseLipSyncManifest({ ...base(), version: 1, language: 'ko-KR', phoneSet: undefined, voice: GEMINI_ZEPHYR_VOICE }));
});
test('Japanese media boundaries, end, silence and random seeks select the declared phone', () => {
  const m = parseLipSyncManifest(base());
  for (const [t, v] of [[0, 'rest'], [100, 'a'], [900, 'closed'], [960, 'i'], [1400, 'rest'], [1650, 'small'],
    [1950, 'small'], [2250, 'u'], [2550, 'small'], [2700, 'o'], [3200, 'rest'], [4000, 'rest'], [910, 'closed']] as const) assert.equal(visemeAt(m, t), v);
  for (const t of [-1, NaN, Infinity]) assert.equal(visemeAt(m, t), 'rest');
});
test('long vowels stay open while short measured closures and pauses survive smoothing', () => {
  const m = parseLipSyncManifest(base());
  for (const t of [200, 499, 500, 501, 800]) assert.deepEqual(mouthAt(m, t), { from: 'a', to: 'a', mix: 0 });
  for (const t of [900, 930, 959]) assert.deepEqual(mouthAt(m, t), { from: 'closed', to: 'closed', mix: 0 });
  for (const t of [1400, 1500, 1649]) assert.deepEqual(mouthAt(m, t), { from: 'rest', to: 'rest', mix: 0 });
  assert.deepEqual(mouthAt(m, 1200), { from: 'i', to: 'i', mix: 0 });
  assert.deepEqual(mouthAt(m, 2400), { from: 'u', to: 'u', mix: 0 });
});
test('one Controller swaps language at the same audio hash without stale cached poses', () => {
  const controller = new CharacterController(), jp = parseLipSyncManifest(base());
  const ko = parseLipSyncManifest({ ...base(), version: 1, language: 'ko-KR', phoneSet: undefined, voice: 'ko-KR-Chirp3-HD-Zephyr', cues: [{ startMs: 0, endMs: 4000, phone: 'j' }] });
  const p: CharacterPolicy = { enabled: true, ready: true, visible: true, inView: true, editing: false, modal: false, reducedMotion: false };
  const playback = { clipId: jp.audioSha256, state: 'playing' as const, currentTimeMs: 2600 };
  controller.setSpeech(ko); assert.equal(controller.sample(playback, 0, p).viseme, 'i');
  controller.setSpeech(jp); assert.equal(controller.sample(playback, 20, p).viseme, 'small');
  controller.setSpeech(ko); assert.equal(controller.sample(playback, 40, p).viseme, 'i');
});
test('Japanese pair hashes exact UTF-8 text and audio; changed bytes and normalization are rejected', async () => {
  const bytes = new Uint8Array([1, 3, 5]).buffer, spokenText = 'パン。';
  const input = { ...base(), spokenText, audioSha256: await sha256(bytes), textSha256: await sha256(new TextEncoder().encode(spokenText).buffer) };
  await verifyLipSyncPair(bytes, input);
  await assert.rejects(verifyLipSyncPair(bytes, { ...input, spokenText: spokenText.normalize('NFC') }));
  await assert.rejects(verifyLipSyncPair(new Uint8Array([1, 3, 6]).buffer, input));
});
test('Japanese intervals reject overlap, negative/reversed/nonfinite/overrun clocks', () => {
  for (const [startMs, endMs] of [[-1, 100], [100, 100], [200, 100], [0, Infinity], [NaN, 100], [0, 4001]]) {
    assert.throws(() => parseLipSyncManifest({ ...base(), cues: [{ startMs, endMs, phone: 'a' }] }));
  }
  const m = base(); m.cues[1].startMs = 400; assert.throws(() => parseLipSyncManifest(m));
});
test('measured label import preserves nonuniform timing and equivalent explicit seconds/HTS units', async () => {
  const bytes = new Uint8Array([1, 2]).buffer;
  const seconds = await japaneseTimelineFromLabels(bytes, 'こんにちは。', '0 .12 sil\n.12 .415 a\n.6 1.0 pau', 'seconds', 1000);
  const ticks = await japaneseTimelineFromLabels(bytes, 'こんにちは。', '0 1200000 sil\n1200000 4150000 a\n6000000 10000000 pau', 'hts-100ns', 1000);
  assert.deepEqual(seconds, ticks); assert.deepEqual(seconds.cues[1], { startMs: 120, endMs: 415, phone: 'a' });
  assert.equal(seconds.alignment, 'automatic-phonemes'); await verifyLipSyncPair(bytes, seconds);
});
test('label import rejects text-only phonemes, guessed units, full context and unsafe timestamps', async () => {
  const bytes = new Uint8Array([1]).buffer;
  for (const labels of ['', 'k o N n i ch i w a', '0 1 あ', '0 1 unknown', '0 1 a extra', '0 1 a^i-u+e=o', '-1 1 a', '0 Infinity a', '0 2 a']) {
    await assert.rejects(japaneseTimelineFromLabels(bytes, 'こんにちは。', labels, 'seconds', 1000));
  }
  await assert.rejects(japaneseTimelineFromLabels(bytes, '文', '0 .5 a', 'hts-100ns', 1000));
  await assert.rejects(japaneseTimelineFromLabels(bytes, '文', '0 9007199254740992 a', 'hts-100ns', 1000));
  // @ts-expect-error Runtime input still has to declare a supported unit.
  await assert.rejects(japaneseTimelineFromLabels(bytes, '文', '0 100 a', 'milliseconds', 1000));
});
