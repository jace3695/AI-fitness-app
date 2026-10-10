import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceEventSchema, evidenceReceiptSchema, evidenceSnapshotSchema, makeSourceSlotKey, validateEvidenceEvent, validateEvidenceSnapshot } from './validation.ts';
import { catalogue, context, episode, id, snapshot, typedTask, uuid } from './test-fixtures.ts';
import type { EvidenceEvent } from './types.ts';

test('all payload, provenance and receipt fields survive strict JSON roundtrip without defaults', () => {
  const events = episode(0, { task: typedTask, format: 'typed_answer' });
  const copy = JSON.parse(JSON.stringify(snapshot(events)));
  assert.deepEqual(evidenceSnapshotSchema.parse(copy), copy);
  assert.deepEqual(evidenceReceiptSchema.parse(copy.records[1]), copy.records[1]);
  assert.deepEqual(evidenceEventSchema.parse(copy.records[1].event), events[1]);
  const nullable = { ...events[1], hintUsed: null, answerPreviouslyRevealed: null, responseMs: null, timingComplete: false,
    audio: { status: 'unknown', promptMatchesTask: null }, textVisibility: { targetText: null, reading: null, meaning: null, choices: null } };
  assert.deepEqual(evidenceEventSchema.parse(nullable), nullable);
});

test('strict schema rejects unknown versions, kinds, fields, raw answers and invalid types/ranges', () => {
  const event = episode(0)[1];
  for (const patch of [
    { schemaVersion: 2 }, { kind: 'postponed' }, { kind: 'speaking_checked' }, { kind: 'routine_completed' }, { rawAnswer: 'private text' },
    { correct: 'true' }, { eventId: 'x' }, { sequence: -1 }, { sequence: 1.5 }, { responseMs: 600001 }, { responseMs: Infinity },
    { responseMs: null, timingComplete: true }, { responseMs: 0, timingComplete: false }, { contentRevision: 0 },
    { occurredAt: '2026-02-30T00:00:00.000Z' }, { occurredAt: '2026-01-01' }, { recordTimezone: 'device' }, { recordTimezone: '+14:01' },
    { textVisibility: { targetText: false, reading: false, meaning: true } }, { audio: { status: 'completed', promptMatchesTask: true } },
    { sequence: 2, isRetry: false }, { source: 'course_lesson' },
  ]) assert.equal(evidenceEventSchema.safeParse({ ...event, ...patch }).success, false, JSON.stringify(patch));
  assert.equal(evidenceEventSchema.safeParse({ ...episode(0)[0], correct: true }).success, false);
});

test('source identity, format, grading version, owner, generation and prospective time are exact', () => {
  const event = episode(0)[1];
  assert.equal(validateEvidenceEvent(event, context(), catalogue).ok, true);
  for (const patch of [
    { itemId: 'different:sense' }, { lessonId: 'f99' }, { legacyQuestionId: 'f01:3' }, { taskId: 'unknown' }, { contentRevision: 2 },
    { gradingVersion: 'unknown' }, { taskFormat: 'typed_answer' }, { source: 'item_practice' }, { generationId: uuid(3) },
    { occurredAt: '2025-12-31T23:59:59.999Z' }, { occurredAt: '2026-01-02T00:00:00.000Z' },
  ]) {
    const changed = { ...event, ...patch } as EvidenceEvent;
    changed.sourceSlotKey = makeSourceSlotKey(context().ownerId, changed);
    assert.equal(validateEvidenceEvent(changed, context(), catalogue).ok, false, JSON.stringify(patch));
  }
  assert.equal(validateEvidenceEvent(event, { ...context(), ownerId: uuid(9) }, catalogue).ok, false);
  assert.equal(validateEvidenceEvent(event, context(), [...catalogue, catalogue[0]]).ok, false);
});

test('lesson source slot binds original session instead of a replaceable episode UUID', () => {
  const event = { ...episode(0)[1], source: 'course_lesson' as const, lessonSessionId: 'existing-session-id' };
  event.sourceSlotKey = makeSourceSlotKey(uuid(1), event);
  assert.equal(validateEvidenceEvent(event, context(), catalogue).ok, true);
  assert.equal(makeSourceSlotKey(uuid(1), { ...event, episodeId: id() }), event.sourceSlotKey);
  assert.notEqual(makeSourceSlotKey(uuid(1), { ...event, lessonSessionId: 'different-session' }), event.sourceSlotKey);
});

test('snapshot cannot claim complete with missing high-water rows, foreign owner, generation, zone or prospectivity', () => {
  const value = snapshot(episode(0));
  for (const changed of [
    { ...value, ownerId: uuid(8) }, { ...value, generationId: uuid(8) }, { ...value, studyDayTimezone: 'UTC' },
    { ...value, prospectiveStartedAt: '2025-01-01T00:00:00.000Z' },
    { ...value, records: [{ ...value.records[0], ownerId: uuid(8) }] },
  ]) assert.equal(validateEvidenceSnapshot(changed, context(), catalogue).ok, false);
  const missing = validateEvidenceSnapshot({ ...value, records: [value.records[1]] }, context(), catalogue);
  assert.ok(missing.ok); assert.equal(missing.complete, false);
});

test('same ID exact replay deduplicates; different payload/receipt/semantic sequence never wins', () => {
  const value = snapshot(episode(0));
  const replay = validateEvidenceSnapshot({ ...value, records: [...value.records, value.records[1]] }, context(), catalogue);
  assert.ok(replay.ok); assert.equal(replay.complete, true); assert.equal(replay.records.length, 2);
  for (const extra of [
    { ...value.records[1], event: { ...value.records[1].event, correct: false } },
    { ...value.records[1], payloadHash: 'a'.repeat(64) },
    { ...value.records[1], serverSequence: 3, event: { ...value.records[1].event, eventId: id() } },
  ]) {
    const conflict = validateEvidenceSnapshot({ ...value, records: [...value.records, extra] }, context(), catalogue);
    assert.ok(conflict.ok); assert.equal(conflict.complete, false);
  }
});
