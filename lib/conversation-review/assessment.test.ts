import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFreeConversation, FREE_CONVERSATIONS } from '../../data/freeConversation.ts';
import { assessConversationTurn, PRODUCTION_ASSESSMENT_SOURCES } from './assessment.ts';
import { createAssessmentAdapter, isVerifiedAssessment } from './assessment-core.ts';
import { exactIdentity, type VerifiedAssessment } from './contract.ts';
import { abstention, assessFixture, change, FIXTURE_SOURCE, natural, RECEIVED_AT, record, request } from '../../tests/fixtures/conversation-review.ts';

test('production registry is immutable, empty and cannot be activated by payload/env/local flags', () => {
  assert.deepEqual(PRODUCTION_ASSESSMENT_SOURCES, []);
  assert.equal(Object.isFrozen(PRODUCTION_ASSESSMENT_SOURCES), true);
  assert.throws(() => (PRODUCTION_ASSESSMENT_SOURCES as unknown as unknown[]).push(FIXTURE_SOURCE));
  const prior = process.env.CONVERSATION_ASSESSMENT_ENABLED;
  process.env.CONVERSATION_ASSESSMENT_ENABLED = 'true';
  try {
    for (const raw of [change(), natural(), { ...change(), trusted: true, enabled: true, source: 'local', query: '?enableAssessment=true', localStorage: { trusted: true } }]) {
      assert.deepEqual(assessConversationTurn(raw, request(), RECEIVED_AT), { status: 'unavailable', reason: 'unsupported-source' });
    }
  } finally {
    if (prior === undefined) delete process.env.CONVERSATION_ASSESSMENT_ENABLED; else process.env.CONVERSATION_ASSESSMENT_ENABLED = prior;
  }
});

test('all five free examples, reading matches, normalization, alternatives and blank correction remain unassessed', () => {
  for (const situation of Object.keys(FREE_CONVERSATIONS) as (keyof typeof FREE_CONVERSATIONS)[]) {
    const example = FREE_CONVERSATIONS[situation];
    for (const input of [example.japanese, example.reading, ` ${example.japanese}？！ `, 'synthetic arbitrary alternative', 'synthetic typo', 'synthetic stylistic variant', '']) {
      const result = buildFreeConversation(situation, input);
      assert.equal(result.correction, '');
      assert.equal(result.source, 'local');
      // A meaningful expected turn is necessary even for a malformed empty input.
      assert.equal(assessConversationTurn(result, request({ input: input || 'empty-input-fixture' }), RECEIVED_AT).status, 'unavailable');
    }
  }
});

test('bare local/trusted payloads, paid-route same-input fallback and empty data cannot grant assessment', () => {
  for (const raw of [null, undefined, '', {}, { source: 'local' }, { trusted: true }, { correction: request().turn.input, source: 'ai' }, { correction: '', source: 'local' }]) {
    assert.equal(assessConversationTurn(raw, request(), RECEIVED_AT).status, 'unavailable');
    const result = assessFixture(raw, request(), RECEIVED_AT);
    assert.ok(result.status === 'invalid' || result.status === 'unavailable');
  }
});

test('explicit fixture change, positive and abstention retain separate verdicts and receipt times', () => {
  for (const evidence of [change(), natural(), abstention()]) {
    const result = assessFixture(evidence, request(), RECEIVED_AT);
    assert.equal(result.status, evidence.verdict);
    const accepted = record(result);
    assert.equal(accepted.receivedAt, RECEIVED_AT);
    assert.equal(accepted.evidence.assessedAt, evidence.assessedAt);
    assert.equal(isVerifiedAssessment(accepted), true);
    assert.equal(isVerifiedAssessment(structuredClone(accepted)), false);
    assert.equal(Object.isFrozen(accepted.evidence.request.turn), true);
    assert.equal(accepted.reviewCardId === null, evidence.verdict !== 'confirmed-change');
  }
});

for (const field of ['ownerId', 'generationId', 'sessionId', 'turnId', 'contextId', 'scriptId', 'scriptRevision', 'input'] as const) {
  test(`exact ${field} mismatch fails closed without normalization`, () => {
    const evidence = change(); evidence.request.turn[field] += ' ';
    const result = assessFixture(evidence, request(), RECEIVED_AT);
    assert.ok(result.status === 'invalid' || result.status === 'stale');
    const changed = change(request({ [field]: `different-${field}` }));
    assert.equal(assessFixture(changed, request(), RECEIVED_AT).status, 'stale');
  });
}
for (const field of ['namespace', 'adapterVersion', 'policyVersion'] as const) {
  test(`exact source ${field} binding rejects unsupported or switched values`, () => {
    const evidence = change(); evidence.request.source[field] = 'different';
    assert.equal(assessFixture(evidence, request(), RECEIVED_AT).status, 'stale');
    assert.equal(assessFixture(evidence, evidence.request, RECEIVED_AT).status, 'unavailable');
  });
}

test('request, turn revision, schema, enums and unknown properties reject malformed evidence', () => {
  const base = change();
  const candidates = [
    { ...base, schemaVersion: 2 }, { ...base, verdict: 'natural' }, { ...base, trusted: true },
    { ...base, receiptId: '' }, { ...base, assessedAt: 'yesterday' }, { ...base, issueId: '' },
    { ...base, explanation: ' ' }, { ...base, reference: '' }, { ...base, correctedText: '' },
    { ...base, correctedText: base.span.text }, { ...natural(), correctedText: base.span.text },
    { ...base, request: { ...base.request, requestId: 'request-new' } },
    { ...base, request: { ...base.request, turn: { ...base.request.turn, turnRevision: 2 } } },
  ];
  for (const candidate of candidates) assert.ok(['invalid', 'stale'].includes(assessFixture(candidate, request(), RECEIVED_AT).status));
  for (const expected of [null, {}, { ...request(), requestId: '' }, { ...request(), turn: { ...request().turn, turnRevision: -1 } }]) assert.equal(assessFixture(base, expected, RECEIVED_AT).status, 'invalid');
  assert.equal(assessFixture(base, request(), 'not-a-local-receipt-time').status, 'invalid');
});

test('spans are exact half-open UTF-16 ranges and never normalized or split surrogates', () => {
  const base = change();
  for (const span of [{ start: -1, end: 1, text: 's' }, { start: 0, end: 0, text: 's' }, { start: 2, end: 1, text: 's' }, { start: 0, end: 100, text: base.span.text }, { start: 0, end: 6, text: 'SAMPLE' }, { start: 0.5, end: 6, text: 'sample' }]) {
    assert.equal(assessFixture({ ...base, span }, request(), RECEIVED_AT).status, 'invalid');
  }
  const emoji = request({ input: 'a😀b' });
  assert.equal(assessFixture({ ...change(emoji), span: { start: 1, end: 2, text: '\ud83d' } }, emoji, RECEIVED_AT).status, 'invalid');
  assert.equal(assessFixture({ ...change(emoji), span: { start: 1, end: 3, text: '😀' } }, emoji, RECEIVED_AT).status, 'confirmed-change');
  assert.equal(assessFixture({ ...natural(), span: { start: 0, end: 6, text: 'sample' } }, request(), RECEIVED_AT).status, 'confirmed-natural');
});

test('exact replay preserves the original immutable record and local receipt time', () => {
  const original = record(assessFixture(change(), request(), RECEIVED_AT));
  const replay = assessFixture(structuredClone(change()), request(), '2026-10-09T20:10:00Z', [original]);
  assert.equal(record(replay), original);
  assert.equal('duplicate' in replay && replay.duplicate, true);
  assert.equal(record(replay).receivedAt, RECEIVED_AT);
});

test('same request with changed receipt, payload, source, issue or turn is a conflict; receipt replay cannot mint a request', () => {
  const original = record(assessFixture(change(), request(), RECEIVED_AT));
  for (const evidence of [{ ...change(), receiptId: 'another-receipt' }, { ...change(), correctedText: 'different replacement' }, { ...change(), issueId: 'different-issue' }, { ...change(), assessedAt: '2026-10-09T20:00:02Z' }, change(request({ turnId: 'turn-b' }))]) {
    assert.equal(assessFixture(evidence, evidence.request, RECEIVED_AT, [original]).status, 'conflict');
  }
  const nextRequest = request({}, 'request-b');
  assert.equal(assessFixture(change(nextRequest), nextRequest, RECEIVED_AT, [original]).status, 'conflict');
  const sourceB = { ...FIXTURE_SOURCE, adapterVersion: 'adapter-v2' };
  const adapter = createAssessmentAdapter([FIXTURE_SOURCE, sourceB]);
  const changedSource = change(); changedSource.request.source.adapterVersion = 'adapter-v2';
  assert.equal(adapter(changedSource, changedSource.request, RECEIVED_AT, [original]).status, 'conflict');
});

test('untrusted prior ledgers and cross-owner/generation records cannot be smuggled into ingestion', () => {
  const accepted = record(assessFixture(change(), request(), RECEIVED_AT));
  for (const prior of [structuredClone(accepted), { ...accepted }] as VerifiedAssessment[]) {
    assert.equal(assessFixture(change(), request(), RECEIVED_AT, [prior]).status, 'invalid');
  }
  for (const field of ['ownerId', 'generationId'] as const) {
    const target = request({ [field]: 'other' });
    assert.equal(assessFixture(change(target), target, RECEIVED_AT, [accepted]).status, 'invalid');
  }
});

test('only exact reviewed recurrence mapping is accepted, independently of textual similarity', () => {
  const recurrence = { mappingId: 'mapping-a', key: 'issue-family-a', policyVersion: 'recurrence-v1' };
  assert.equal(assessFixture({ ...change(), recurrence }, request(), RECEIVED_AT).status, 'confirmed-change');
  for (const field of ['mappingId', 'key', 'policyVersion'] as const) {
    assert.equal(assessFixture({ ...change(), recurrence: { ...recurrence, [field]: 'unreviewed' } }, request(), RECEIVED_AT).status, 'invalid');
  }
  for (const field of ['contextId', 'scriptId', 'scriptRevision'] as const) {
    const target = request({ [field]: 'other' });
    assert.equal(assessFixture({ ...change(target), recurrence }, target, RECEIVED_AT).status, 'invalid');
  }
  assert.equal(assessFixture({ ...change(), issueId: 'other', recurrence }, request(), RECEIVED_AT).status, 'invalid');
  assert.notEqual(exactIdentity(['a|b', 'c']), exactIdentity(['a', 'b|c']));
});
