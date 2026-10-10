import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CURRENCY_BACKUP_KEY, readCurrencyBackup } from './currency-backup.ts';

const plan = JSON.parse(readFileSync('services/yeoni-alignment/currency-validation-plan.json', 'utf8'));
const approved = { ...plan.cases[0], voice: plan.voice };
// Synthetic bytes test lossless transport only; this is not a generated or playable voice.
const audio = Buffer.from('synthetic backup transport bytes');
const saved = { ...approved, audioContent: audio.toString('base64'), generationMs: 2240,
  responseSpokenText: approved.text, reservedCharacters: 17, remainingCharacters: 0 };

test('backup reads only the fixed audio key and preserves exact JSON and audio bytes', () => {
  const raw = JSON.stringify({ ...saved, existingMetadata: { retained: true } }, null, 2) + '\n';
  const values = new Map([[CURRENCY_BACKUP_KEY, raw], [CURRENCY_BACKUP_KEY + ':attempt', approved.requestId],
    ['yeoni-approved-review-20261008:short', 'original short response']]);
  const before = [...values];
  const storage = new Proxy({}, { get: (_, property) => {
    assert.equal(property, 'getItem', 'no writes, deletion, enumeration or other storage access');
    return (key: string) => { assert.equal(key, CURRENCY_BACKUP_KEY); return values.get(key) ?? null; };
  } }) as Pick<Storage, 'getItem'>;
  const result = readCurrencyBackup(storage, approved);
  assert.equal(result.json, raw);
  assert.equal(result.audioBytes, audio.length);
  assert.deepEqual(Buffer.from(JSON.parse(result.json).audioContent, 'base64'), audio);
  assert.deepEqual([...values], before);
});

test('absent, denied, corrupt and oversized storage stop without fallback or retry', () => {
  for (const raw of [null, '', 'not json', 'null', '[]', 'x'.repeat(2_200_001)]) {
    let reads = 0;
    assert.throws(() => readCurrencyBackup({ getItem: () => { reads++; return raw; } }, approved));
    assert.equal(reads, 1);
  }
  assert.throws(() => readCurrencyBackup({ getItem: () => { throw new DOMException('Denied', 'SecurityError'); } }, approved), { name: 'SecurityError' });
});

test('wrong case, request, transcript, voice or reservation cannot be exported as approved audio', () => {
  for (const [field, value] of Object.entries({ id: 'short', requestId: 'another-id', text: approved.requestText,
    requestText: 'another input', responseSpokenText: approved.requestText, voice: 'another-voice', reservedCharacters: 18 })) {
    assert.throws(() => readCurrencyBackup({ getItem: () => JSON.stringify({ ...saved, [field]: value }) }, approved));
  }
});

test('invalid or truncated base64 is rejected without changing saved data', () => {
  for (const audioContent of ['', null, 'Zg=', 'Zh==', 'data:audio/mpeg;base64,Zg==', 'Zg==\n', '!!!!', 'A'.repeat(2_000_004)]) {
    assert.throws(() => readCurrencyBackup({ getItem: () => JSON.stringify({ ...saved, audioContent }) }, approved));
  }
});
