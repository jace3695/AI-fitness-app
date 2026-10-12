import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KOREAN_MFA_VISEMES } from './korean-mfa-phones.ts';
import { parseLipSyncManifest, phoneViseme } from './lip-sync.ts';

test('pinned G2P inventory is supported while unknown phones remain rejected', () => {
  const inventory = JSON.parse(readFileSync(new URL('../../docs/yeoni-general-validation/korean-mfa-inventory.json', import.meta.url), 'utf8'));
  assert.equal(inventory.phones.length, 108);
  assert.deepEqual(Object.keys(KOREAN_MFA_VISEMES).sort(), inventory.phones);
  for (const phone of inventory.phones) assert.doesNotThrow(() => phoneViseme(phone));
  for (const phone of ['spn', '<unk>', 'unreviewed-IPA', '__proto__']) assert.throws(() => phoneViseme(phone));
  assert.equal(phoneViseme('mʲː'), 'closed');
  assert.equal(phoneViseme('tɕʷ'), 'u');
  assert.equal(phoneViseme('t͈'), 'small');
});

test('new IPA projections preserve the measured phone labels and boundaries', () => {
  const cues = [{ startMs: 12, endMs: 61, phone: 't͈' }, { startMs: 70, endMs: 153, phone: 'ɟ' },
    { startMs: 180, endMs: 301, phone: 'mʲː' }, { startMs: 350, endMs: 416, phone: 'tɕʷ' }];
  const manifest = parseLipSyncManifest({ version: 1, language: 'ko-KR', voice: 'ko-KR-Chirp3-HD-Zephyr',
    spokenText: '형식 검사', audioSha256: 'a'.repeat(64), textSha256: 'b'.repeat(64),
    durationMs: 500, alignment: 'automatic-phonemes', cues });
  assert.deepEqual(manifest.cues, cues);
  assert.equal(manifest.durationMs, 500);
});
