import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSESSMENT_TRIAL, validateAssessmentTrial } from './assessment-trial.ts';
import { validateAssessmentWav } from '../../../lib/azure-pronunciation-server.ts';

const signal = () => new AbortController().signal;
function wavBytes(samples = 16000): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples * 2), view = new DataView(bytes.buffer);
  const tag = (at: number, value: string) => [...value].forEach((character, index) => { bytes[at + index] = character.charCodeAt(0); });
  tag(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); tag(8, 'WAVE'); tag(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, bytes.length - 44, true);
  return bytes;
}
const blob = (bytes: Uint8Array) => new Blob([new Uint8Array(bytes)], { type: 'audio/wav' });

test('trial preflight accepts exactly the server WAV subset up to five seconds and existing text trimming', async () => {
  assert.equal(ASSESSMENT_TRIAL.referenceText, 'こんにちは。');
  assert.equal(ASSESSMENT_TRIAL.maxDurationMs, 5000);
  for (const samples of [1, 16000, 79999, 80000]) {
    const bytes = wavBytes(samples);
    assert.ok(validateAssessmentWav(bytes) <= 5000);
    await validateAssessmentTrial(blob(bytes), ' \nこんにちは。\t', signal());
  }
});

test('other text, punctuation, extras and excessive whitespace are rejected before reading audio', async () => {
  class UnreadableAudio extends Blob {
    slice(): Blob { throw Error('Audio must not be read'); }
  }
  for (const reference of ['', 'こんにちは', 'こんにちは！', 'こんにちは。秘密', 'おはよう。', ' '.repeat(1000) + 'こんにちは。']) {
    await assert.rejects(validateAssessmentTrial(new UnreadableAudio([wavBytes()]), reference, signal()), /trial reference/);
  }
});

test('trial rejects oversized, empty, partial-sample and non-WAV recording without reading content', async () => {
  class UnreadableAudio extends Blob {
    slice(): Blob { throw Error('Audio must not be read'); }
  }
  for (const audio of [new UnreadableAudio([wavBytes(80001)], { type: 'audio/wav' }), new UnreadableAudio([wavBytes(0)], { type: 'audio/wav' }), new UnreadableAudio([new Uint8Array(47)], { type: 'audio/wav' }), new UnreadableAudio([wavBytes()], { type: 'audio/webm' })]) {
    await assert.rejects(validateAssessmentTrial(audio, 'こんにちは。', signal()), /five seconds/);
  }
});

test('malformed RIFF length, chunks, encoding, rates and data length never qualify by MIME or size alone', async () => {
  const mutations = [
    (b: Uint8Array, _v: DataView) => { b[0] = 0; },
    (_b: Uint8Array, v: DataView) => v.setUint32(4, 36, true),
    (b: Uint8Array, _v: DataView) => { b[8] = 0; },
    (b: Uint8Array, _v: DataView) => { b[12] = 0; },
    (_b: Uint8Array, v: DataView) => v.setUint32(16, 18, true),
    (_b: Uint8Array, v: DataView) => v.setUint16(20, 3, true),
    (_b: Uint8Array, v: DataView) => v.setUint16(22, 2, true),
    (_b: Uint8Array, v: DataView) => v.setUint32(24, 8000, true),
    (_b: Uint8Array, v: DataView) => v.setUint32(28, 64000, true),
    (_b: Uint8Array, v: DataView) => v.setUint16(32, 4, true),
    (_b: Uint8Array, v: DataView) => v.setUint16(34, 8, true),
    (b: Uint8Array, _v: DataView) => { b[36] = 'J'.charCodeAt(0); },
    (_b: Uint8Array, v: DataView) => v.setUint32(40, 2, true),
  ];
  for (const mutate of mutations) {
    const bytes = wavBytes(); mutate(bytes, new DataView(bytes.buffer));
    assert.throws(() => validateAssessmentWav(bytes));
    await assert.rejects(validateAssessmentTrial(blob(bytes), 'こんにちは。', signal()), /canonical/);
  }
});

test('valid preflight reads only a 44-byte header and abort during that read rejects late completion', async () => {
  const bytes = wavBytes(); let readBytes = 0;
  class HeaderOnlyAudio extends Blob {
    arrayBuffer(): Promise<ArrayBuffer> { throw Error('Full audio read is forbidden during preflight'); }
    slice(start?: number, end?: number): Blob { readBytes += (end ?? this.size) - (start ?? 0); return super.slice(start, end); }
  }
  await validateAssessmentTrial(new HeaderOnlyAudio([bytes], { type: 'audio/wav' }), 'こんにちは。', signal());
  assert.equal(readBytes, 44);
  const controller = new AbortController(); let complete!: (bytes: ArrayBuffer) => void;
  class SlowHeader extends Blob { arrayBuffer() { return new Promise<ArrayBuffer>(resolve => { complete = resolve; }); } }
  class SlowAudio extends Blob { slice() { return new SlowHeader(); } }
  const pending = validateAssessmentTrial(new SlowAudio([bytes], { type: 'audio/wav' }), 'こんにちは。', controller.signal);
  controller.abort(); complete(new Uint8Array(bytes.slice(0, 44)).buffer);
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(validateAssessmentTrial(blob(bytes), 'こんにちは。', controller.signal), { name: 'AbortError' });
});
