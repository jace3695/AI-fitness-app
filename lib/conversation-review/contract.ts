import { z } from 'zod';

// P1 contracts only. No persistence, provider, auth or curriculum dependencies.
const id = z.string().min(1).max(160).refine(value => value.trim() === value);
const text = z.string().min(1).max(8000).refine(value => value.trim().length > 0);
export const timestampSchema = z.iso.datetime({ offset: true });
export const sourceSchema = z.strictObject({ namespace: id, adapterVersion: id, policyVersion: id });
export const turnSchema = z.strictObject({
  ownerId: id,
  generationId: id,
  sessionId: id,
  turnId: id,
  turnRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  contextId: id,
  scriptId: id,
  scriptRevision: id,
  input: text,
});
export const requestSchema = z.strictObject({
  turn: turnSchema,
  requestId: id,
  source: sourceSchema,
});
export const spanSchema = z.strictObject({
  // Half-open UTF-16 offsets into the exact committed input; never normalized.
  start: z.number().int().nonnegative().max(8000),
  end: z.number().int().positive().max(8000),
  text,
});
const recurrenceSchema = z.strictObject({ key: id, policyVersion: id, mappingId: id });
const base = {
  schemaVersion: z.literal(1),
  request: requestSchema,
  receiptId: id,
  assessedAt: timestampSchema,
};
export const assessmentEvidenceSchema = z.discriminatedUnion('verdict', [
  z.strictObject({ ...base, verdict: z.literal('confirmed-change'), issueId: id, span: spanSchema, correctedText: text, explanation: text, reference: text, recurrence: recurrenceSchema.optional() }),
  z.strictObject({ ...base, verdict: z.literal('confirmed-natural'), span: spanSchema, reference: text }),
  z.strictObject({ ...base, verdict: z.literal('abstained'), reason: text, reference: text }),
]);
export type ConversationTurn = z.infer<typeof turnSchema>;
export type AssessmentRequest = z.infer<typeof requestSchema>;
export type AssessmentEvidence = z.infer<typeof assessmentEvidenceSchema>;
export type SourceIdentity = z.infer<typeof sourceSchema>;
export type ExpressionSpan = z.infer<typeof spanSchema>;

type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type VerifiedAssessment = DeepReadonly<{
  evidence: AssessmentEvidence;
  receivedAt: string;
  requestSlot: string;
  occurrenceId: string;
  reviewCardId: string | null;
}>;
export type AssessmentOutcome =
  | { status: 'unavailable' | 'invalid' | 'stale' | 'conflict'; reason: string }
  | { status: AssessmentEvidence['verdict']; record: VerifiedAssessment; duplicate: boolean };

export function exactIdentity(parts: readonly (string | number)[]): string {
  // Tuple encoding avoids delimiter collisions and retains revisions verbatim.
  return JSON.stringify(parts);
}
export function turnIdentity(turn: ConversationTurn): string {
  return exactIdentity([turn.ownerId, turn.generationId, turn.sessionId, turn.turnId, turn.turnRevision]);
}
export function sameTurn(left: ConversationTurn, right: ConversationTurn): boolean {
  return Object.keys(turnSchema.shape).every(key => left[key as keyof ConversationTurn] === right[key as keyof ConversationTurn]);
}
export function validSpan(span: ExpressionSpan, input: string): boolean {
  const splitsSurrogate = (offset: number) => offset > 0 && offset < input.length && /[\uD800-\uDBFF]/.test(input[offset - 1]) && /[\uDC00-\uDFFF]/.test(input[offset]);
  return span.start < span.end && span.end <= input.length && !splitsSurrogate(span.start) && !splitsSurrogate(span.end) && input.slice(span.start, span.end) === span.text;
}
export function freezeRecord<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeRecord(child);
    Object.freeze(value);
  }
  return value;
}
