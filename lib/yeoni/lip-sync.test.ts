import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLipSyncManifest, phoneViseme, sha256, verifyLipSyncPair, visemeAt } from './lip-sync.ts';

const base = () => ({ version: 1, language: 'ko-KR', voice: 'ko-KR-Chirp3-HD-Zephyr', spokenText: '아, 오, 이. 엄마.',
  audioSha256: 'a'.repeat(64), textSha256: 'b'.repeat(64), durationMs: 4000, alignment: 'reviewed-phonemes',
  cues: [{ startMs: 100, endMs: 300, phone: 'ㅏ' }, { startMs: 450, endMs: 600, phone: 'ㅁ' },
    { startMs: 600, endMs: 900, phone: 'ㅗ' }] });
test('Korean visible phoneme groups and unknown phone rejection', () => {
  for (const p of ['ㅁ', 'ㅂ', 'ㅃ', 'ㅍ']) assert.equal(phoneViseme(p), 'closed');
  for (const p of ['ㅏ', 'ㅑ']) assert.equal(phoneViseme(p), 'a');
  for (const p of ['ㅗ', 'ㅛ']) assert.equal(phoneViseme(p), 'o');
  for (const p of ['ㅜ', 'ㅠ']) assert.equal(phoneViseme(p), 'u');
  assert.equal(phoneViseme('ㅣ'), 'i');
  for (const p of ['ㅔ', 'ㅐ']) assert.equal(phoneViseme(p), 'e');
  assert.equal(phoneViseme('sil'), 'rest');
  for (const p of ['안', 'ㅘ', 'spn', 'constructor', '__proto__']) assert.throws(() => phoneViseme(p));
});
test('Korean MFA IPA projection preserves vowel distinctions, length and rounding', () => {
  for (const [phone, shape] of [['ɐ', 'a'], ['iː', 'i'], ['u', 'u'], ['sʷ', 'u'], ['eː', 'e'], ['o', 'o'], ['m', 'closed'], ['kʰ', 'small']]) {
    assert.equal(phoneViseme(phone), shape);
  }
  assert.throws(() => phoneViseme('spn'));
  assert.throws(() => phoneViseme('unreviewed-IPA'));
});
test('silence, exact boundaries, backward seek, end and invalid media times', () => {
  const m = parseLipSyncManifest(base());
  for (const t of [-1, NaN, Infinity, 0, 99.99, 300, 449.99, 900, 4000]) assert.equal(visemeAt(m, t), 'rest');
  assert.equal(visemeAt(m, 100), 'a'); assert.equal(visemeAt(m, 450), 'closed');
  assert.equal(visemeAt(m, 600), 'o'); assert.equal(visemeAt(m, 120), 'a');
});
test('reject overlap, reversed/negative/nonfinite/overlong timing; never repair silently', () => {
  for (const cue of [{ startMs: -1, endMs: 20, phone: 'ㅏ' }, { startMs: 20, endMs: 20, phone: 'ㅏ' },
    { startMs: 0, endMs: Infinity, phone: 'ㅏ' }, { startMs: 0, endMs: 4001, phone: 'ㅏ' }]) {
    assert.throws(() => parseLipSyncManifest({ ...base(), cues: [cue] }));
  }
  const m = base(); m.cues[1].startMs = 200; assert.throws(() => parseLipSyncManifest(m));
});
test('reject malformed contracts, wrong voice/language and excessive inputs', () => {
  for (const patch of [{ language: 'ja-JP' }, { voice: 'other-voice' }, { alignment: 'equal-characters' }, { version: 2 },
    { cues: [] }, { audioSha256: 'wrong' }, { durationMs: 120001 }, { spokenText: ' ' }, { spokenText: '아'.repeat(1201) }]) {
    assert.throws(() => parseLipSyncManifest({ ...base(), ...patch }));
  }
});
test('validated timeline is copied and frozen against later caller mutation', () => {
  const input = base(), m = parseLipSyncManifest(input);
  input.cues[0].phone = 'ㅗ'; assert.equal(visemeAt(m, 110), 'a');
  assert.ok(Object.isFrozen(m) && Object.isFrozen(m.cues) && Object.isFrozen(m.cues[0]));
});
test('audio and exact spoken text both bound to SHA-256; wrong pairs rejected', async () => {
  const bytes = new TextEncoder().encode('audio bytes for integrity unit test').buffer;
  const m = base(); m.audioSha256 = await sha256(bytes); m.textSha256 = await sha256(new TextEncoder().encode(m.spokenText).buffer);
  await verifyLipSyncPair(bytes, m);
  await assert.rejects(verifyLipSyncPair(bytes, { ...m, spokenText: '다른 문장' }));
  await assert.rejects(verifyLipSyncPair(new Uint8Array([0, 1, 2]).buffer, m));
  await assert.rejects(verifyLipSyncPair(new ArrayBuffer(0), m));
  await assert.rejects(verifyLipSyncPair(new ArrayBuffer(8_000_001), m));
});
