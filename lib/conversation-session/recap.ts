import { buildConversationRecap } from '../conversation-review/summary.ts';
import { FREE_CONVERSATION_SAMPLE_MATCH_POLICY } from '../../data/freeConversationCatalog.ts';
import { SUMMARY_POLICY_VERSION, freezeRecord, supportedSource, validateEnvelope } from './contracts.ts';

/** Pure compatibility projection, deliberately NOT a persistence/owner capability.
 * P2-B must establish an opaque, current, coherent local snapshot before exposing
 * this projection. Serialized records can never restore assessment authority. */
export function projectClosedConversationRecap(raw: unknown, sessionId: string) {
  const checked = validateEnvelope(raw);
  if (checked.status !== 'valid') return { status: 'unavailable' as const, reason: checked.code };
  const envelope = checked.envelope;
  const session = envelope.sessions.find(item => item.sessionId === sessionId);
  if (!session?.closed) return { status: 'unavailable' as const, reason: 'no-closed-boundary' };
  if (!supportedSource(session.source) || session.source.matchPolicy !== FREE_CONVERSATION_SAMPLE_MATCH_POLICY || session.closed.summaryPolicyVersion !== SUMMARY_POLICY_VERSION) return { status: 'unavailable' as const, reason: 'unsupported-source-or-policy' };
  // P1 only accepts booleans. Never turn unknown into false, or a later hint into
  // pre-answer help. Preserve all four richer exposure fields below.
  if (session.turns.some(turn => Object.values(turn.draft.exposure).includes('unknown'))) return { status: 'unavailable' as const, reason: 'unknown-exposure' };
  const source = session.source, closed = session.closed;
  const p1 = buildConversationRecap({
    schemaVersion: 1, ownerId: envelope.ownerId, generationId: envelope.generationId, sessionId,
    contextId: source.contextId, levelId: source.levelId, scriptId: source.scriptId, scriptRevision: source.scriptRevision,
    practice: { example: source.content.japanese, reading: source.content.reading, reply: source.content.reply, hint: source.content.hint, sources: [{ id: source.contentSource.module, revision: source.contentSource.revision }] },
    turns: session.turns.map(turn => ({
      binding: { ownerId: envelope.ownerId, generationId: envelope.generationId, sessionId, turnId: turn.turnId, turnRevision: turn.turnRevision, contextId: source.contextId, scriptId: source.scriptId, scriptRevision: source.scriptRevision, input: turn.draft.input },
      inputMethod: turn.draft.origin.kind === 'inserted-example' && !turn.draft.origin.edited ? 'inserted-example' : 'typed',
      exampleShown: turn.draft.exposure.example === 'shown', hintShown: turn.draft.exposure.hint === 'shown',
    })),
    // P1's legacy booleans are only adapter inputs. They are intentionally omitted
    // from output: neither a parsed envelope nor these literals prove a save.
    closed: { summaryPolicyVersion: SUMMARY_POLICY_VERSION, boundaryId: closed.boundaryId, turnRefs: closed.turnRefs, closedAt: closed.closedAt, timeZone: closed.timeZone, saveStatus: 'saved', contextStatus: 'last-verified', verifiedAt: closed.observation.receivedAt },
  }, []);
  if (p1.status === 'unavailable') return p1;
  return freezeRecord({
    status: p1.status, persistence: 'not-verified-by-pure-projection' as const,
    provenance: { ownerId: envelope.ownerId, generationId: envelope.generationId, sessionId, source, closed },
    practiceFacts: p1.practiceFacts, assessmentCoverage: p1.assessmentCoverage,
    wellUsedExpressions: p1.wellUsedExpressions, correctableExpressions: p1.correctableExpressions,
    missingTurns: p1.missingTurns, unsentDraftCount: session.drafts.filter(draft => draft.input.trim().length > 0).length,
    recordedTurns: session.turns.map(turn => ({ turnId: turn.turnId, input: turn.draft.input, origin: turn.draft.origin, preAnswerExposure: turn.draft.exposure, emitted: turn.emission, sampleMatch: turn.sampleMatch })),
  });
}
