import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRegisteredReplyClipResolver, prepareReplyClip, type ReplyClipMime } from './reply-clip-source.ts';
import { verifyLipSyncPair } from './lip-sync.ts';
import { buildReplyPlan } from './reply-plan.ts';

// Reuse the existing recording and measured timeline unchanged. Not new speech evidence.
const timeline = JSON.parse(readFileSync(new URL('../../docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json', import.meta.url), 'utf8'));
const recording = Uint8Array.from(readFileSync(new URL('../../docs/yeoni-phase5/fixtures/zephyr-ko-39.mp3', import.meta.url))).buffer;
const signal = () => new AbortController().signal;

test('artifact admission preserves the exact pair and owns bytes/cues across caller mutations and loads', async () => {
  const bytes = recording.slice(0), input = structuredClone(timeline);
  const pending = prepareReplyClip(bytes, input, 'audio/mpeg');
  new Uint8Array(bytes).fill(0); input.cues[0].phone = 'unknown';
  const clip = await pending, first = await clip.load(signal());
  assert.ok(Object.isFrozen(clip) && Object.isFrozen(clip.manifest));
  assert.deepEqual(clip.manifest.cues, timeline.cues);
  assert.deepEqual(first.bytes, recording); assert.equal(first.mime, 'audio/mpeg');
  new Uint8Array(first.bytes).fill(0);
  const second = await clip.load(signal());
  assert.deepEqual(second.bytes, recording);
  await verifyLipSyncPair(second.bytes, clip.manifest);
});

test('artifact admission rejects wrong pairs, synthetic clocks, unsupported mime and oversized bytes', async () => {
  for (const input of [{ ...timeline, spokenText: `${timeline.spokenText} ` },
    { ...timeline, audioSha256: '0'.repeat(64) }, { ...timeline, alignment: 'synthetic-clock-test' },
    { ...timeline, alignment: ['synthetic-clock-test'] }]) {
    await assert.rejects(prepareReplyClip(recording, input, 'audio/mpeg'));
  }
  await assert.rejects(prepareReplyClip(recording, timeline, 'text/html' as ReplyClipMime));
  await assert.rejects(prepareReplyClip(new ArrayBuffer(8_000_001), timeline, 'audio/mpeg'));
});

test('cancelled admission and cancelled load never deliver an audio artifact', async () => {
  const before = new AbortController(); before.abort();
  await assert.rejects(prepareReplyClip(recording, timeline, 'audio/mpeg', before.signal), { name: 'AbortError' });
  const during = new AbortController(), pending = prepareReplyClip(recording, timeline, 'audio/mpeg', during.signal);
  during.abort(); await assert.rejects(pending, { name: 'AbortError' });
  const clip = await prepareReplyClip(recording, timeline, 'audio/mpeg');
  await assert.rejects(clip.load(before.signal), { name: 'AbortError' });
});

test('registered catalog snapshots metadata and loader identity without eagerly loading or claiming verified bytes', async () => {
  const input = structuredClone(timeline); let loads = 0;
  const candidate = { manifest: input, async load() { loads++; return { bytes: recording.slice(0), mime: 'audio/mpeg' }; } };
  const clips = [candidate], resolve = createRegisteredReplyClipResolver(clips);
  input.spokenText = '바뀐 문장'; input.cues[0].phone = 'unsupported';
  candidate.load = async () => { throw new Error('replaced loader'); }; clips.length = 0;
  const found = await resolve(buildReplyPlan(timeline.spokenText, 'registered'), signal());
  assert.equal(loads, 0); assert.ok(found); assert.ok(Object.isFrozen(found));
  assert.equal(found.manifest.spokenText, timeline.spokenText);
  assert.deepEqual(found.manifest.cues, timeline.cues);
  const loaded = await found.load(signal()); assert.equal(loads, 1);
  await verifyLipSyncPair(loaded.bytes, found.manifest);
  for (const reply of [`${timeline.spokenText} `, '새 발화예요.', 'Hello']) {
    assert.equal(await resolve(buildReplyPlan(reply, 'unregistered'), signal()), null);
  }
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(resolve(buildReplyPlan(timeline.spokenText, 'cancelled'), cancelled.signal), { name: 'AbortError' });
  assert.equal(loads, 1);
});
