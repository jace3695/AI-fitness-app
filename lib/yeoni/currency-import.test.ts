import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCurrencyBackup } from './currency-backup.ts';
import { CURRENCY_IMPORT_MAX_BYTES, parseCurrencyPlaybackFile } from './currency-import.ts';

const plan = JSON.parse(readFileSync('services/yeoni-alignment/currency-validation-plan.json', 'utf8'));
const approved = { ...plan.cases[0], voice: plan.voice };
const row = { ...approved, audioContent: Buffer.from('synthetic transport only').toString('base64'),
  responseSpokenText: approved.text, reservedCharacters: 17, alignment: { audioSha256: '0'.repeat(64) } };

test('file parser preserves exact JSON/base64 without requiring a Storage object', () => {
  const raw = JSON.stringify(row, null, 2) + '\n';
  assert.equal(parseCurrencyBackup(raw, approved).json, raw);
});

test('file import rejects corrupt, missing and byte-oversized input', async () => {
  for (const raw of ['', 'null', '[]', '{bad', 'a'.repeat(CURRENCY_IMPORT_MAX_BYTES + 1),
    JSON.stringify({ ...row, padding: '가'.repeat(50_000) })]) {
    await assert.rejects(parseCurrencyPlaybackFile(raw, approved));
  }
});

test('another recording cannot reuse approved metadata, and missing alignment cannot trigger a job', async () => {
  await assert.rejects(parseCurrencyPlaybackFile(JSON.stringify(row), approved), /원본 음성과 다른/);
  await assert.rejects(parseCurrencyPlaybackFile(JSON.stringify({ ...row, alignment: undefined }), approved), /정렬 정보가 포함된/);
  for (const [key, value] of Object.entries({ requestId: 'another-id', requestText: approved.text,
    responseSpokenText: approved.requestText, voice: 'another-voice', reservedCharacters: 0 })) {
    await assert.rejects(parseCurrencyPlaybackFile(JSON.stringify({ ...row, [key]: value }), approved), /승인된 금액 음성과 일치하지/);
  }
});
