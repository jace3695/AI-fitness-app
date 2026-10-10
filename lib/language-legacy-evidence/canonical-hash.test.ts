import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { canonicalEvidence, makeSourceSlotKey } from './validation.ts';
import { canonicalSha256, decodeFrozenEvidence, freezeEvidence, verifyFrozenEvidence } from './canonical-hash.ts';
import { context, catalogue, episode, typedTask, uuid } from './test-fixtures.ts';

test('canonical UTF-8 SHA-256 matches Node known vector and A1 nested event bytes', async () => {
  assert.equal(await canonicalSha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  for (const event of episode(0)) {
    const frozen = await freezeEvidence(event, context(), catalogue);
    assert.equal(frozen.canonical, canonicalEvidence(event));
    assert.equal(frozen.payloadHash, createHash('sha256').update(frozen.canonical, 'utf8').digest('hex'));
    assert.deepEqual(await verifyFrozenEvidence(frozen), event);
    assert.ok(Object.isFrozen(frozen));
    event.hintUsed = true; assert.notEqual(frozen.canonical, canonicalEvidence(event));
  }
});
test('fixed canonical golden vector covers escaped slot, optional lesson binding, null/false and timezone', async () => {
  const event = episode(0, { task: typedTask, format: 'typed_answer' })[0];
  Object.assign(event, { eventId: uuid(77), episodeId: uuid(78), source: 'course_lesson', lessonSessionId: 'session/alpha:01',
    hintUsed: null, answerPreviouslyRevealed: null, recordTimezone: '+14:00', audio: { status: 'unknown', promptMatchesTask: null },
    textVisibility: { targetText: null, reading: false, meaning: true, choices: false } });
  event.sourceSlotKey = makeSourceSlotKey(uuid(1), event);
  const frozen = await freezeEvidence(event, context(), catalogue);
  assert.equal(frozen.payloadHash, 'd2853bac1cd6e578c6b6e3bc3f4c6b6976a9209092b0d9f5e292e17919ac5089');
  assert.equal(await canonicalSha256('日本語 🙂\n'), '34a4df889cbe77891ee7b30721a98f4c912c9e2636cbd8f9e2f7fbb35097497f');
});
test('strict parser rejects duplicate keys, whitespace, wrong hash, altered identities and extra metadata', async () => {
  const frozen = await freezeEvidence(episode(0)[0], context(), catalogue);
  for (const corrupt of [
    { ...frozen, canonical: ` ${frozen.canonical}` },
    { ...frozen, canonical: frozen.canonical.replace('{', '{"schemaVersion":1,') },
    { ...frozen, ownerId: '00000003-0000-4000-8000-000000000000' },
    { ...frozen, sequence: 1 }, { ...frozen, authenticated: true },
  ]) assert.throws(() => decodeFrozenEvidence(corrupt), /corrupt_record/);
  await assert.rejects(verifyFrozenEvidence({ ...frozen, payloadHash: 'a'.repeat(64) }), /corrupt_record/);
  await assert.rejects(freezeEvidence({ ...episode(0)[0], rawAnswer: 'must never enter event bytes' }, context(), catalogue), /invalid_input/);
});
