import { z } from 'zod';
import { matchFreeConversationSample } from '../../data/freeConversationCatalog.ts';
import { freezeRecord, timestampSchema, turnIdentity, turnSchema, type VerifiedAssessment } from './contract.ts';
import { ownerContextSchema, selectBoundAssessments } from './projection.ts';

export const SUMMARY_POLICY_VERSION = 'conversation-recap-v1';
const nonempty = z.string().min(1).max(8000).refine(value => value.trim().length > 0);
const reference = z.strictObject({ id: nonempty, revision: nonempty });
const savedTurnSchema = z.strictObject({
  binding: turnSchema,
  inputMethod: z.enum(['typed', 'inserted-example']),
  exampleShown: z.boolean(),
  hintShown: z.boolean(),
});
const sessionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ...ownerContextSchema.shape,
  sessionId: nonempty,
  contextId: nonempty,
  levelId: z.enum(['beginner', 'elementary', 'intermediate', 'unlevelled']),
  scriptId: nonempty,
  scriptRevision: nonempty,
  // Frozen source snapshots, not a lookup against the current mutable catalog.
  practice: z.strictObject({ example: nonempty, reading: nonempty, reply: nonempty, hint: nonempty, sources: z.array(reference).min(1).max(16) }),
  turns: z.array(savedTurnSchema).max(1000),
  closed: z.strictObject({
    summaryPolicyVersion: z.literal(SUMMARY_POLICY_VERSION),
    boundaryId: nonempty,
    turnRefs: z.array(z.strictObject({ turnId: nonempty, turnRevision: z.number().int().positive() })).max(1000),
    closedAt: timestampSchema,
    saveStatus: z.enum(['saved', 'failed', 'unavailable']),
    contextStatus: z.enum(['last-verified', 'offline-last-verified']),
    verifiedAt: timestampSchema,
    timeZone: z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }),
  }),
});
export type ClosedConversationSession = z.infer<typeof sessionSchema>;

/** A factual projection only. This neither closes/saves a session nor assesses
 * Japanese. P2 must establish a real owner-validated saved boundary first. */
export function buildConversationRecap(rawSession: unknown, records: readonly VerifiedAssessment[] = []) {
  const parsed = sessionSchema.safeParse(rawSession);
  if (!parsed.success || !Array.isArray(records) || records.length > 2000) return { status: 'unavailable' as const, reason: 'invalid-session-boundary' };
  const session = parsed.data;
  if (session.closed.saveStatus !== 'saved') return { status: 'unavailable' as const, reason: 'session-not-saved', saveStatus: session.closed.saveStatus };
  const { turns, closed } = session;
  const refKey = (turn: { turnId: string; turnRevision: number }) => JSON.stringify([turn.turnId, turn.turnRevision]);
  const refs = new Set(closed.turnRefs.map(refKey));
  if (refs.size !== closed.turnRefs.length || new Set(closed.turnRefs.map(ref => ref.turnId)).size !== closed.turnRefs.length || new Set(turns.map(turn => turn.binding.turnId)).size !== turns.length || turns.some(({ binding }) =>
    binding.ownerId !== session.ownerId || binding.generationId !== session.generationId || binding.sessionId !== session.sessionId || binding.contextId !== session.contextId || binding.scriptId !== session.scriptId || binding.scriptRevision !== session.scriptRevision || !refs.has(refKey(binding)))) {
    return { status: 'unavailable' as const, reason: 'inconsistent-session-boundary' };
  }
  const byRef = new Map(turns.map(turn => [refKey(turn.binding), turn]));
  const missingTurns = closed.turnRefs.filter(ref => !byRef.has(refKey(ref)));
  const orderedTurns = closed.turnRefs.flatMap(ref => { const turn = byRef.get(refKey(ref)); return turn ? [turn] : []; });
  const selected = selectBoundAssessments(session, orderedTurns.map(turn => turn.binding), records);
  const positive = selected.records.filter(record => record.evidence.verdict === 'confirmed-natural');
  const corrective = selected.records.filter(record => record.evidence.verdict === 'confirmed-change');
  const perTurn = orderedTurns.map(turn => {
    const bound = selected.records.filter(record => turnIdentity(record.evidence.request.turn) === turnIdentity(turn.binding));
    const confirmed = bound.filter(record => record.evidence.verdict !== 'abstained');
    const full = confirmed.some(record => record.evidence.verdict !== 'abstained' && record.evidence.span.start === 0 && record.evidence.span.end === turn.binding.input.length);
    return { turnId: turn.binding.turnId, turnRevision: turn.binding.turnRevision, status: confirmed.length ? (full ? 'assessed-whole-turn' as const : 'assessed-span-only' as const) : bound.length ? 'abstained' as const : 'unavailable' as const, receipts: bound.map(record => ({ occurrenceId: record.occurrenceId, source: record.evidence.request.source, receiptId: record.evidence.receiptId, verdict: record.evidence.verdict })) };
  });
  const assessedTurns = perTurn.filter(turn => turn.status.startsWith('assessed-')).length;
  const fullyAssessedTurns = perTurn.filter(turn => turn.status === 'assessed-whole-turn').length;
  const complete = closed.turnRefs.length > 0 && fullyAssessedTurns === closed.turnRefs.length && !selected.rejected && !selected.conflicts;
  const practiceFacts = orderedTurns.map(turn => ({
    turnId: turn.binding.turnId, turnRevision: turn.binding.turnRevision,
    input: turn.binding.input, inputMethod: turn.inputMethod, exampleShown: turn.exampleShown, hintShown: turn.hintShown,
    sampleMatch: matchFreeConversationSample(turn.binding.input, { japanese: session.practice.example, reading: session.practice.reading }),
  }));
  return freezeRecord({
    status: missingTurns.length || selected.rejected || selected.conflicts ? 'partial' as const : 'ready' as const,
    provenance: { ownerId: session.ownerId, generationId: session.generationId, sessionId: session.sessionId, contextId: session.contextId, levelId: session.levelId, scriptId: session.scriptId, scriptRevision: session.scriptRevision, practice: session.practice, ...closed },
    practiceFacts,
    missingTurns,
    assessmentCoverage: {
      status: complete ? 'complete' as const : assessedTurns ? 'partial' as const : 'unavailable' as const,
      eligibleTurns: closed.turnRefs.length, committedTurns: orderedTurns.length, assessedTurns, fullyAssessedTurns,
      abstainedTurns: perTurn.filter(turn => turn.status === 'abstained').length,
      unavailableTurns: perTurn.filter(turn => turn.status === 'unavailable').length + missingTurns.length,
      rejectedEvidence: selected.rejected, conflictingRequests: selected.conflicts, turns: perTurn,
    },
    // Empty means no supported claim is present. It never means zero errors.
    wellUsedExpressions: { status: positive.length ? 'source-confirmed' as const : 'unavailable' as const, claims: positive },
    correctableExpressions: { status: corrective.length ? 'source-confirmed' as const : 'unavailable' as const, claims: corrective },
  });
}
