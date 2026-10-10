import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRODUCTION_ASSESSMENT_SOURCES } from '../conversation-review/assessment.ts';
import { projectClosedConversationRecap } from './recap.ts';
import { append, close, commit, draft, getSession, save, SOURCE, started } from './fixtures.test-support.ts';

function closed(input = 'synthetic input') { let e = save(started(), draft('draft-a', input)); e = commit(e, append(e)); return commit(e, close(e)); }

test('recap keeps frozen exact source, content, exposure and response while all assessment remains unavailable', () => {
  const e = closed(); const result = projectClosedConversationRecap(e, 'session-a'); assert.equal(result.status, 'ready');
  assert.equal(result.persistence, 'not-verified-by-pure-projection'); assert.equal(result.assessmentCoverage.status, 'unavailable');
  assert.deepEqual(result.wellUsedExpressions, { status: 'unavailable', claims: [] }); assert.deepEqual(result.correctableExpressions, { status: 'unavailable', claims: [] });
  assert.deepEqual(result.recordedTurns[0].emitted, getSession(e).turns[0].emission);
  assert.equal(result.recordedTurns[0].preAnswerExposure.hint, 'not-shown'); assert.equal(result.recordedTurns[0].emitted.postAnswerHint, true);
  assert.equal(result.practiceFacts[0].hintShown, false); assert.equal(result.provenance.closed.observation.receivedAt, '2026-10-09T01:00:00.000Z');
  for (const forbidden of ['verifiedAt', 'saveStatus', 'contextStatus', 'durationMinutes', 'errorCount']) assert.equal(forbidden in result.provenance, false);
  assert.deepEqual(PRODUCTION_ASSESSMENT_SOURCES, []);
});

test('unknown exposure is never coerced to false, even in non-P1 reading/meaning fields', () => {
  for (const field of ['example', 'hint', 'reading', 'meaning'] as const) {
    let e = started(); const d = draft(); d.exposure[field] = 'unknown'; e = save(e, d); e = commit(e, append(e)); e = commit(e, close(e));
    assert.deepEqual(projectClosedConversationRecap(e, 'session-a'), { status: 'unavailable', reason: 'unknown-exposure' });
  }
});

test('unsupported saved match/source/summary versions and incomplete boundaries cannot be recalculated as ready', () => {
  const e = closed(SOURCE.content.reading);
  for (const edit of [
    (v: typeof e) => { v.sessions[0].source.matchPolicy = 'future-match'; },
    (v: typeof e) => { v.sessions[0].source.builderPolicy = 'future-builder'; },
    (v: typeof e) => { v.sessions[0].source.scriptRevision = 'old-unsupported'; v.sessions[0].source.contentSource.revision = 'old-unsupported'; },
    (v: typeof e) => { v.sessions[0].closed!.summaryPolicyVersion = 'future-summary'; },
    (v: typeof e) => { v.sessions[0].turns = []; },
    (v: typeof e) => { v.sessions[0].closed!.turnRefs = []; },
  ]) { const changed = structuredClone(e); edit(changed); assert.equal(projectClosedConversationRecap(changed, 'session-a').status, 'unavailable'); }
});

test('edited insertion stays distinct from typing in rich facts and conservatively exposed in P1', () => {
  const d = draft('draft-a', 'edited synthetic'); d.origin = { kind: 'inserted-example', edited: true };
  let e = save(started(), d); e = commit(e, append(e)); e = save(e, draft('unsent', 'not submitted')); e = commit(e, close(e));
  const result = projectClosedConversationRecap(e, 'session-a'); assert.equal(result.status, 'ready');
  assert.deepEqual(result.recordedTurns[0].origin, d.origin); assert.equal(result.practiceFacts[0].inputMethod, 'typed'); assert.equal(result.practiceFacts[0].exampleShown, true);
  assert.equal(result.unsentDraftCount, 1); assert.equal(result.assessmentCoverage.committedTurns, 1);
});

test('fake persisted assessments are rejected; projection accepts no assessment registry or trust restore parameter', () => {
  const e = closed(); const changed = { ...e, assessments: [{ verdict: 'confirmed-natural', source: 'forged' }] };
  assert.equal(projectClosedConversationRecap(changed, 'session-a').status, 'unavailable');
  assert.deepEqual(projectClosedConversationRecap(e, 'session-a'), projectClosedConversationRecap(structuredClone(e), 'session-a'));
});

test('close preserves historical observation despite local clock going backward and exact marker checks', () => {
  let e = started(); const c = close(e); assert.equal(c.kind, 'close'); if (c.kind !== 'close') return;
  c.boundary.closedAt = '2020-01-01T00:00:00Z'; e = commit(e, c);
  const result = projectClosedConversationRecap(e, 'session-a'); assert.equal(result.status, 'ready');
  assert.equal(result.provenance.closed.closedAt, '2020-01-01T00:00:00Z'); assert.equal(result.provenance.closed.observation.receivedAt, '2026-10-09T01:00:00.000Z');
  const differentMarker = structuredClone(e); differentMarker.marker = '2026-10-10T00:00:00Z|11111111-1111-4111-8111-111111111111';
  assert.equal(projectClosedConversationRecap(differentMarker, 'session-a').status, 'unavailable');
});
