// Synthetic contract fixtures only. Never imported by an application entrypoint.
import { createAssessmentAdapter, type SourceDefinition } from '../../lib/conversation-review/assessment-core.ts';
import type { AssessmentEvidence, AssessmentOutcome, AssessmentRequest, VerifiedAssessment } from '../../lib/conversation-review/contract.ts';
import type { ClosedConversationSession } from '../../lib/conversation-review/summary.ts';

export const RECEIVED_AT = '2026-10-09T20:00:01Z';
export const FIXTURE_SOURCE: SourceDefinition = {
  namespace: 'synthetic-fixture', adapterVersion: 'adapter-v1', policyVersion: 'policy-v1',
  recurrenceMappings: [{ mappingId: 'mapping-a', key: 'issue-family-a', policyVersion: 'recurrence-v1', issueId: 'issue-a', contextId: 'synthetic-context', scriptId: 'synthetic-script', scriptRevision: 'script-v1' }],
};
export const assessFixture = createAssessmentAdapter([FIXTURE_SOURCE]);
export function request(turnOverrides: Partial<AssessmentRequest['turn']> = {}, requestId = 'request-a'): AssessmentRequest {
  return { turn: { ownerId: 'owner-a', generationId: 'generation-a', sessionId: 'session-a', turnId: 'turn-a', turnRevision: 1, contextId: 'synthetic-context', scriptId: 'synthetic-script', scriptRevision: 'script-v1', input: 'sample input', ...turnOverrides }, requestId, source: { namespace: FIXTURE_SOURCE.namespace, adapterVersion: FIXTURE_SOURCE.adapterVersion, policyVersion: FIXTURE_SOURCE.policyVersion } };
}
export function change(target = request(), receiptId = 'receipt-a'): Extract<AssessmentEvidence, { verdict: 'confirmed-change' }> {
  return { schemaVersion: 1, request: structuredClone(target), receiptId, assessedAt: '2026-10-09T20:00:00Z', verdict: 'confirmed-change', issueId: 'issue-a', span: { start: 0, end: target.turn.input.length, text: target.turn.input }, correctedText: 'synthetic replacement', explanation: 'synthetic reason', reference: 'synthetic source reference' };
}
export function natural(target = request(), receiptId = 'receipt-natural'): Extract<AssessmentEvidence, { verdict: 'confirmed-natural' }> {
  return { schemaVersion: 1, request: structuredClone(target), receiptId, assessedAt: '2026-10-09T20:00:00Z', verdict: 'confirmed-natural', span: { start: 0, end: target.turn.input.length, text: target.turn.input }, reference: 'synthetic positive reference' };
}
export function abstention(target = request()): Extract<AssessmentEvidence, { verdict: 'abstained' }> {
  return { schemaVersion: 1, request: structuredClone(target), receiptId: 'receipt-abstained', assessedAt: '2026-10-09T20:00:00Z', verdict: 'abstained', reason: 'synthetic source declined', reference: 'synthetic abstention reference' };
}
export function record(outcome: AssessmentOutcome): VerifiedAssessment {
  if (!('record' in outcome)) throw new Error(`Expected synthetic accepted receipt, received ${outcome.status}`);
  return outcome.record;
}
export function session(targets = [request()]): ClosedConversationSession {
  const first = targets[0] ?? request();
  return { schemaVersion: 1, ownerId: first.turn.ownerId, generationId: first.turn.generationId, sessionId: first.turn.sessionId, contextId: first.turn.contextId, levelId: 'unlevelled', scriptId: first.turn.scriptId, scriptRevision: first.turn.scriptRevision,
    practice: { example: 'sample input', reading: 'sample reading', reply: 'scripted reply', hint: 'synthetic hint', sources: [{ id: 'synthetic-source', revision: 'source-v1' }] },
    turns: targets.map(target => ({ binding: structuredClone(target.turn), inputMethod: 'typed', exampleShown: false, hintShown: false })),
    closed: { summaryPolicyVersion: 'conversation-recap-v1', boundaryId: 'boundary-a', turnRefs: targets.map(({ turn }) => ({ turnId: turn.turnId, turnRevision: turn.turnRevision })), closedAt: '2026-10-09T20:01:00Z', saveStatus: 'saved', contextStatus: 'last-verified', verifiedAt: '2026-10-09T19:59:00Z', timeZone: 'UTC' },
  };
}
