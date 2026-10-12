import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson, capacityUsage, parseEnvelope, validateEnvelope, type ConversationEnvelope, type Observation } from './contracts.ts';
import { base, fillBudget, TIME } from './fixtures.test-support.ts';
const marker = '2026-10-10T00:00:00.123456Z|AAAAAAAA-1111-4111-8111-111111111111';
const observation = (m: string | null): Observation => ({ kind: 'authenticated-remote-observation-received', requestId: 'r', ownerId: 'owner-a', ownerEpochId: 'e', lifecycleId: 'l', marker: m, receivedAt: TIME });
const replacement = (): ConversationEnvelope => ({ ...base(), marker, generationId: 'new-generation', enrollment: { kind: 'reset-replacement', enrollmentId: 'cleanup', createdAt: TIME, ownerId: 'owner-a', generationId: 'new-generation', previousGenerationId: 'generation-a', previousMarker: null, marker, requestId: marker.split('|')[1], reason: 'explicit-reset' } });

test('P2B enrollment union retains original canonical P2A fixture schema without granting runtime authority', () => {
  const original = base(); assert.deepEqual(parseEnvelope(canonicalJson(original)), { status: 'valid', envelope: original });
  const causal = { ...original, enrollment: { ...original.enrollment, observation: observation(null) } };
  assert.equal(parseEnvelope(canonicalJson(causal)).status, 'valid'); assert.ok(capacityUsage(causal).actualCodeUnits > capacityUsage(original).actualCodeUnits);
});
test('P2B explicit/remote/catch-up replacement receipt binds exact owner/generations/marker UUID and preserves canonical encoding', () => {
  for (const reason of ['explicit-reset', 'remote-reset', 'observation-catch-up'] as const) {
    const e = replacement(); if (e.enrollment.kind !== 'reset-replacement') throw new Error('fixture');
    e.enrollment.reason = reason; if (reason !== 'explicit-reset') e.enrollment.observation = observation(marker);
    assert.equal(parseEnvelope(canonicalJson(e)).status, 'valid');
  }
});
for (const [field, value] of [['ownerId', 'other'], ['generationId', 'other'], ['previousGenerationId', 'new-generation'], ['requestId', marker.split('|')[1].toLowerCase()], ['previousMarker', marker], ['marker', null]] as const) test(`P2B inconsistent replacement ${field} is rejected without normalizing source`, () => {
  const e = replacement(); Reflect.set(e.enrollment, field, value); const raw = canonicalJson(e);
  assert.equal(parseEnvelope(raw).status, 'blocked'); assert.equal(canonicalJson(e), raw);
});
test('P2B remote replacement requires exact causal observation and rejects hidden receipt fields', () => {
  const e = replacement(); if (e.enrollment.kind !== 'reset-replacement') throw new Error('fixture'); e.enrollment.reason = 'remote-reset';
  assert.equal(validateEnvelope(e).status, 'blocked'); e.enrollment.observation = observation(null); assert.equal(validateEnvelope(e).status, 'blocked');
  e.enrollment.observation = observation(marker); assert.equal(validateEnvelope(e).status, 'valid'); Reflect.set(e.enrollment, 'extra', 'ignored-proof'); assert.equal(validateEnvelope(e).status, 'blocked');
});
test('P2B enrollment/receipt metadata consumes the same per-owner budget without exemption', () => {
  const full = fillBudget(base()); assert.equal(validateEnvelope(full).status, 'valid');
  const causal = { ...full, enrollment: { ...full.enrollment, observation: observation(null) } }; assert.equal(validateEnvelope(causal).status, 'blocked');
  assert.equal(validateEnvelope(fillBudget(replacement())).status, 'valid');
});
