import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FREE_CONVERSATION_SAMPLE_MATCH_POLICY } from '../../data/freeConversationCatalog.ts';
import { createAssessmentAdapter } from './assessment-core.ts';
import { buildConversationRecap } from './summary.ts';
import { projectConversationReview } from './projection.ts';
import type { VerifiedAssessment } from './contract.ts';
import { abstention, assessFixture, change, FIXTURE_SOURCE, natural, RECEIVED_AT, record, request, session } from '../../tests/fixtures/conversation-review.ts';

function readyRecap(...args: Parameters<typeof buildConversationRecap>) {
  const result = buildConversationRecap(...args);
  assert.notEqual(result.status, 'unavailable');
  if (result.status === 'unavailable') throw new Error(result.reason);
  return result;
}
const context = { ownerId: 'owner-a', generationId: 'generation-a' };
const turns = (...targets: ReturnType<typeof request>[]) => targets.map(target => target.turn);

test('free recap reports exact saved practice and exposure, with both assessment sections unavailable', () => {
  const targets = [request(), request({ turnId: 'turn-b', input: 'sample reading' }, 'request-b'), request({ turnId: 'turn-c', input: 'different sentence' }, 'request-c')];
  const saved = session(targets);
  saved.turns[0].inputMethod = 'inserted-example'; saved.turns[0].exampleShown = true; saved.turns[0].hintShown = true;
  const result = readyRecap(saved);
  assert.equal(result.status, 'ready');
  assert.equal(result.assessmentCoverage.status, 'unavailable');
  assert.equal(result.assessmentCoverage.eligibleTurns, 3);
  assert.equal(result.assessmentCoverage.assessedTurns, 0);
  assert.equal(result.assessmentCoverage.unavailableTurns, 3);
  assert.deepEqual(result.practiceFacts.map(fact => fact.sampleMatch.matchedAgainst), ['example', 'reading', null]);
  assert.equal(result.practiceFacts[0].sampleMatch.policyVersion, FREE_CONVERSATION_SAMPLE_MATCH_POLICY);
  assert.equal(result.practiceFacts[0].sampleMatch.assessment, 'unavailable');
  assert.equal(result.practiceFacts[0].inputMethod, 'inserted-example');
  assert.equal(result.practiceFacts[0].exampleShown, true); assert.equal(result.practiceFacts[0].hintShown, true);
  assert.deepEqual(result.wellUsedExpressions, { status: 'unavailable', claims: [] });
  assert.deepEqual(result.correctableExpressions, { status: 'unavailable', claims: [] });
  assert.equal('errorCount' in result, false);
  assert.equal('durationMinutes' in result, false);
  assert.deepEqual(result.provenance.turnRefs, saved.closed.turnRefs);
  assert.equal(result.provenance.scriptRevision, 'script-v1');
});

test('finish replay is deterministic; frozen snapshot provenance cannot drift with later catalog/input edits', () => {
  const saved = session();
  const result = readyRecap(saved);
  assert.deepEqual(readyRecap(structuredClone(saved)), result);
  saved.practice.example = 'later example'; saved.practice.sources[0].revision = 'later-revision'; saved.turns[0].binding.input = 'later input';
  assert.equal(result.provenance.practice.example, 'sample input');
  assert.equal(result.provenance.practice.sources[0].revision, 'source-v1');
  assert.equal(result.practiceFacts[0].input, 'sample input');
  assert.equal(Object.isFrozen(result.provenance.practice), true);
  assert.equal(Object.isFrozen(result.practiceFacts[0].sampleMatch), true);
});

test('positive and correction claims require exact bound source receipts and partial coverage stays partial', () => {
  const a = request(), b = request({ turnId: 'turn-b', input: 'second input' }, 'request-b'), c = request({ turnId: 'turn-c' }, 'request-c');
  const positive = record(assessFixture({ ...natural(a), span: { start: 0, end: 6, text: 'sample' } }, a, RECEIVED_AT));
  const correction = record(assessFixture(change(b, 'receipt-b'), b, RECEIVED_AT));
  const result = readyRecap(session([a, b, c]), [positive, correction]);
  assert.equal(result.assessmentCoverage.status, 'partial');
  assert.equal(result.assessmentCoverage.assessedTurns, 2);
  assert.equal(result.assessmentCoverage.fullyAssessedTurns, 1);
  assert.equal(result.assessmentCoverage.unavailableTurns, 1);
  assert.equal(result.assessmentCoverage.turns[0].status, 'assessed-span-only');
  assert.equal(result.wellUsedExpressions.claims[0], positive);
  assert.equal(result.correctableExpressions.claims[0], correction);
  assert.equal(result.wellUsedExpressions.claims[0].evidence.verdict === 'confirmed-natural' && result.wellUsedExpressions.claims[0].evidence.span.text, 'sample');
});

test('full explicit source coverage differs from empty, abstained, missing and unsupported results', () => {
  const a = request(), b = request({ turnId: 'turn-b' }, 'request-b');
  const positives = [record(assessFixture(natural(a), a, RECEIVED_AT)), record(assessFixture(natural(b, 'receipt-b'), b, RECEIVED_AT))];
  const full = readyRecap(session([a, b]), positives);
  assert.equal(full.assessmentCoverage.status, 'complete');
  // Even complete positive coverage does not fabricate a zero-errors claim.
  assert.deepEqual(full.correctableExpressions, { status: 'unavailable', claims: [] });
  const abstained = readyRecap(session(), [record(assessFixture(abstention(), a, RECEIVED_AT))]);
  assert.equal(abstained.assessmentCoverage.status, 'unavailable');
  assert.equal(abstained.assessmentCoverage.abstainedTurns, 1);
  assert.equal(abstained.assessmentCoverage.assessedTurns, 0);
  assert.equal(readyRecap(session([])).assessmentCoverage.status, 'unavailable');
});

test('missing committed turns are explicit partial coverage, not a shorter completed session', () => {
  const a = request(), b = request({ turnId: 'turn-b' }, 'request-b');
  const saved = session([a, b]); saved.turns.pop();
  const result = readyRecap(saved);
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.missingTurns, [{ turnId: 'turn-b', turnRevision: 1 }]);
  assert.equal(result.assessmentCoverage.eligibleTurns, 2);
  assert.equal(result.assessmentCoverage.committedTurns, 1);
  assert.equal(result.assessmentCoverage.unavailableTurns, 2);
});

test('malformed, wrong-owner/revision, unsaved and duplicated boundaries fail closed', () => {
  for (const raw of [null, {}, { ...session(), schemaVersion: 2 }, { ...session(), unexpected: true }]) assert.equal(buildConversationRecap(raw).status, 'unavailable');
  for (const saveStatus of ['failed', 'unavailable'] as const) {
    const saved = session(); saved.closed.saveStatus = saveStatus;
    assert.deepEqual(buildConversationRecap(saved), { status: 'unavailable', reason: 'session-not-saved', saveStatus });
  }
  for (const field of ['ownerId', 'generationId', 'sessionId', 'contextId', 'scriptId', 'scriptRevision'] as const) {
    const saved = session(); saved.turns[0].binding[field] = 'different';
    assert.equal(buildConversationRecap(saved).status, 'unavailable');
  }
  const badRevision = session(); badRevision.turns[0].binding.turnRevision = 2;
  assert.equal(buildConversationRecap(badRevision).status, 'unavailable');
  const duplicate = session(); duplicate.closed.turnRefs.push(duplicate.closed.turnRefs[0]);
  assert.equal(buildConversationRecap(duplicate).status, 'unavailable');
  assert.equal(buildConversationRecap(session([request(), request({ turnRevision: 2 }, 'request-b')])).status, 'unavailable');
  const badTime = session(); badTime.closed.timeZone = 'Invalid/TimeZone';
  assert.equal(buildConversationRecap(badTime).status, 'unavailable');
  const badPolicy = { ...session(), closed: { ...session().closed, summaryPolicyVersion: 'future-policy' } };
  assert.equal(buildConversationRecap(badPolicy).status, 'unavailable');
});

test('fabricated/serialized evidence and stale source-turn bytes cannot create recap claims or review cards', () => {
  const accepted = record(assessFixture(change(), request(), RECEIVED_AT));
  const fakes = [structuredClone(accepted), { ...accepted }, { evidence: change(), trusted: true }] as VerifiedAssessment[];
  for (const fake of fakes) {
    const recap = readyRecap(session(), [fake]);
    assert.equal(recap.status, 'partial'); assert.equal(recap.assessmentCoverage.rejectedEvidence, 1);
    assert.equal(recap.correctableExpressions.claims.length, 0);
    const review = projectConversationReview(context, turns(request()), [fake]);
    assert.equal(review.status, 'partial'); assert.deepEqual(review.cards, []);
  }
  for (const target of [request({ input: 'same-looking different bytes' }), request({ turnRevision: 2 }), request({ ownerId: 'owner-b' }), request({ generationId: 'generation-b' })]) {
    const recap = readyRecap(session([target]), [accepted]);
    assert.equal(recap.correctableExpressions.claims.length, 0);
    assert.equal(recap.assessmentCoverage.rejectedEvidence, 1);
  }
  assert.deepEqual(projectConversationReview(context, [], [accepted]).cards, []);
});

test('exact duplicate replay gives one occurrence; similar text without reviewed recurrence stays separate', () => {
  const a = request(), b = request({ turnId: 'turn-b' }, 'request-b');
  const first = record(assessFixture(change(a), a, RECEIVED_AT));
  const second = record(assessFixture(change(b, 'receipt-b'), b, RECEIVED_AT));
  const result = projectConversationReview(context, turns(a, b), [first, first, second]);
  assert.equal(result.status, 'ready');
  assert.equal(result.cards.length, 2);
  assert.deepEqual(result.cards.map(card => [card.occurrenceCount, card.repeated]), [[1, false], [1, false]]);
});

test('two unique occurrences group only through an exact approved recurrence mapping, without cross-source/version inference', () => {
  const a = request(), b = request({ turnId: 'turn-b', input: 'unrelated synthetic input' }, 'request-b');
  const recurrence = { key: 'issue-family-a', policyVersion: 'recurrence-v1', mappingId: 'mapping-a' };
  const first = record(assessFixture({ ...change(a), recurrence }, a, RECEIVED_AT));
  const second = record(assessFixture({ ...change(b, 'receipt-b'), recurrence }, b, RECEIVED_AT, [first]));
  const result = projectConversationReview(context, turns(a, b), [first, second, first]);
  assert.equal(result.cards.length, 1); assert.equal(result.cards[0].occurrenceCount, 2); assert.equal(result.cards[0].repeated, true);
  for (const field of ['namespace', 'adapterVersion', 'policyVersion'] as const) {
    const nextSource = { ...FIXTURE_SOURCE, [field]: 'source-version-b' };
    const adapter = createAssessmentAdapter([nextSource]);
    const target = request({ turnId: `turn-${field}` }, `request-${field}`); target.source[field] = 'source-version-b';
    const other = record(adapter({ ...change(target, `receipt-${field}`), recurrence }, target, RECEIVED_AT));
    assert.equal(projectConversationReview(context, turns(a, target), [first, other]).cards.length, 2);
  }
});

test('independently accepted conflicting requests or reused receipts are quarantined at recap/review projection', () => {
  const a = request(), b = request({ turnId: 'turn-b' }, 'request-b');
  const first = record(assessFixture(change(a), a, RECEIVED_AT));
  const conflicting = record(assessFixture({ ...change(a), correctedText: 'conflicting payload' }, a, RECEIVED_AT));
  const reusedReceipt = record(assessFixture(change(b), b, RECEIVED_AT));
  for (const records of [[first, conflicting], [first, reusedReceipt]]) {
    const result = readyRecap(session([a, b]), records);
    assert.equal(result.status, 'partial'); assert.ok(result.assessmentCoverage.conflictingRequests > 0);
    assert.deepEqual(result.correctableExpressions.claims, []);
    const review = projectConversationReview(context, turns(a, b), records);
    assert.equal(review.status, 'partial'); assert.deepEqual(review.cards, []);
    assert.equal(assessFixture(change(a), a, RECEIVED_AT, records).status, 'conflict');
  }
});

test('review projection excludes positives/abstentions, rejects mixed owners, and does not mutate inputs or course arrays', () => {
  const a = request(); const saved = session(); const savedBefore = structuredClone(saved);
  const unrelated = { savedSentences: ['keep'], wrongSentences: ['keep'], curriculumReview: [{ wrongCount: 2 }], live: ['keep'], a2: ['keep'] };
  const before = structuredClone(unrelated);
  for (const evidence of [natural(), abstention()]) {
    const accepted = record(assessFixture(evidence, a, RECEIVED_AT));
    assert.deepEqual(projectConversationReview(context, turns(a), [accepted]).cards, []);
    readyRecap(saved, [accepted]);
  }
  assert.equal(projectConversationReview(context, turns(a, request({ ownerId: 'owner-b' })), []).status, 'unavailable');
  assert.deepEqual(saved, savedBefore); assert.deepEqual(unrelated, before);
});
