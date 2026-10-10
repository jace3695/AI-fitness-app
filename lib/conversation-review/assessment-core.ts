import {
  assessmentEvidenceSchema, exactIdentity, freezeRecord, requestSchema, sameTurn, timestampSchema, validSpan,
  type AssessmentEvidence, type AssessmentOutcome, type AssessmentRequest, type SourceIdentity, type VerifiedAssessment,
} from './contract.ts';

/** Code-reviewed mappings, never supplied in a response or enabled by runtime flags. */
export type SourceDefinition = Readonly<SourceIdentity & {
  recurrenceMappings: readonly Readonly<{
    mappingId: string; key: string; policyVersion: string; issueId: string;
    contextId: string; scriptId: string; scriptRevision: string;
  }>[];
}>;

// A serialized object is not a trusted adapter result. P2 must revalidate a stored
// receipt through an authorized adapter; this in-memory P1 marker is not signing.
const verified = new WeakSet<object>();
export function isVerifiedAssessment(value: unknown): value is VerifiedAssessment {
  return typeof value === 'object' && value !== null && verified.has(value);
}
const sourceKey = (source: SourceIdentity) => exactIdentity([source.namespace, source.adapterVersion, source.policyVersion]);
const requestSlot = (request: AssessmentRequest) => exactIdentity([request.turn.ownerId, request.turn.generationId, request.turn.sessionId, request.requestId]);
const receiptSlot = (evidence: AssessmentEvidence) => exactIdentity([evidence.request.turn.ownerId, evidence.request.turn.generationId, sourceKey(evidence.request.source), evidence.receiptId]);

/** Internal pure engine. Only assessment.ts defines the production registry.
 * Synthetic tests wire their own explicit code-only registry; no app entrypoint
 * accepts a registry, trusted boolean, source token or registration callback.
 */
export function createAssessmentAdapter(definitions: readonly SourceDefinition[]) {
  const registry = freezeRecord(structuredClone(definitions));
  return function assess(raw: unknown, expected: unknown, receivedAt: string, previous: readonly VerifiedAssessment[] = []): AssessmentOutcome {
    const target = requestSchema.safeParse(expected);
    if (!target.success || !timestampSchema.safeParse(receivedAt).success) return { status: 'invalid', reason: 'invalid-request-context' };
    if (raw === null || raw === undefined || raw === '') return { status: 'unavailable', reason: 'missing-assessment' };
    // An empty production registry is unconditional, including malformed/flagged data.
    const permitted = registry.find(source => sourceKey(source) === sourceKey(target.data.source));
    if (!permitted) return { status: 'unavailable', reason: 'unsupported-source' };
    const parsed = assessmentEvidenceSchema.safeParse(raw);
    if (!parsed.success) return { status: 'invalid', reason: 'malformed-assessment' };
    const evidence = parsed.data;
    if (!sameTurn(evidence.request.turn, target.data.turn) || evidence.request.requestId !== target.data.requestId || sourceKey(evidence.request.source) !== sourceKey(target.data.source)) {
      return { status: 'stale', reason: 'request-binding-mismatch' };
    }
    if (evidence.verdict !== 'abstained' && !validSpan(evidence.span, target.data.turn.input)) return { status: 'invalid', reason: 'invalid-input-span' };
    if (evidence.verdict === 'confirmed-change') {
      if (evidence.correctedText === evidence.span.text) return { status: 'invalid', reason: 'unchanged-correction' };
      const recurrence = evidence.recurrence;
      if (recurrence && !permitted.recurrenceMappings.some(mapping =>
        mapping.mappingId === recurrence.mappingId && mapping.key === recurrence.key && mapping.policyVersion === recurrence.policyVersion &&
        mapping.issueId === evidence.issueId && mapping.contextId === target.data.turn.contextId &&
        mapping.scriptId === target.data.turn.scriptId && mapping.scriptRevision === target.data.turn.scriptRevision)) {
        return { status: 'invalid', reason: 'unreviewed-recurrence-mapping' };
      }
    }
    // Fail closed on a fabricated record or another owner/generation's ledger.
    if (!Array.isArray(previous) || previous.length > 2000 || previous.some(record => !isVerifiedAssessment(record) || record.evidence.request.turn.ownerId !== target.data.turn.ownerId || record.evidence.request.turn.generationId !== target.data.turn.generationId)) {
      return { status: 'invalid', reason: 'invalid-prior-evidence' };
    }
    const priorSlots = new Map<string, VerifiedAssessment>();
    const priorReceipts = new Map<string, VerifiedAssessment>();
    for (const record of previous) {
      const byRequest = priorSlots.get(record.requestSlot);
      const byReceipt = priorReceipts.get(receiptSlot(record.evidence));
      if ((byRequest && JSON.stringify(byRequest.evidence) !== JSON.stringify(record.evidence)) || (byReceipt && byReceipt.requestSlot !== record.requestSlot)) {
        return { status: 'conflict', reason: 'conflicting-prior-evidence' };
      }
      priorSlots.set(record.requestSlot, record);
      priorReceipts.set(receiptSlot(record.evidence), record);
    }
    const slot = requestSlot(target.data);
    const prior = previous.find(record => record.requestSlot === slot);
    if (prior) {
      if (JSON.stringify(prior.evidence) !== JSON.stringify(evidence)) return { status: 'conflict', reason: 'request-slot-already-bound' };
      return { status: prior.evidence.verdict, record: prior, duplicate: true };
    }
    if (previous.some(record => receiptSlot(record.evidence) === receiptSlot(evidence))) return { status: 'conflict', reason: 'receipt-already-bound' };
    const turn = evidence.request.turn;
    const occurrenceId = exactIdentity([turn.ownerId, turn.generationId, turn.sessionId, turn.turnId, turn.turnRevision, evidence.request.requestId, evidence.request.source.namespace, evidence.request.source.adapterVersion, evidence.request.source.policyVersion, evidence.verdict === 'confirmed-change' ? evidence.issueId : evidence.verdict]);
    const recurrence = evidence.verdict === 'confirmed-change' ? evidence.recurrence : undefined;
    const reviewCardId = evidence.verdict !== 'confirmed-change' ? null : recurrence
      ? exactIdentity([turn.ownerId, turn.generationId, evidence.request.source.namespace, evidence.request.source.adapterVersion, evidence.request.source.policyVersion, recurrence.policyVersion, recurrence.key])
      : occurrenceId;
    const record = freezeRecord({ evidence, receivedAt, requestSlot: slot, occurrenceId, reviewCardId });
    verified.add(record);
    return { status: evidence.verdict, record, duplicate: false };
  };
}
