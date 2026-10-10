import { z } from 'zod';
import { isRecordTimezone } from './study-policy.ts';
import type { EvidenceEvent, EvidenceReceipt, EvidenceSnapshot, EvidenceWarning, ProjectionContext, TaskDescriptor } from './types.ts';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9:_@./-]+$/);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const instantSchema = z.string().refine(value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'Expected canonical UTC ISO instant');
const timezone = z.string().max(100).refine(isRecordTimezone, 'Expected explicit IANA zone or offset');
const nullableBoolean = z.boolean().nullable();
const common = {
  schemaVersion: z.literal(1), eventId: uuid, generationId: uuid, episodeId: uuid,
  sourceSlotKey: z.string().min(1).max(2048), sequence: integer,
  source: z.enum(['course_lesson', 'course_review', 'item_practice']),
  lessonId: identifier, legacyQuestionId: identifier.optional(), lessonSessionId: identifier.optional(),
  itemId: identifier, contentRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), taskId: identifier,
  gradingVersion: identifier, taskFormat: z.enum(['meaning_choice', 'listening_choice', 'typed_answer']),
  occurredAt: instantSchema, recordTimezone: timezone,
  hintUsed: nullableBoolean, answerPreviouslyRevealed: nullableBoolean, isRetry: z.boolean(),
  responseMs: z.number().int().min(0).max(600_000).nullable(), timingComplete: z.boolean(),
  audio: z.object({ status: z.enum(['not_requested', 'started', 'completed', 'aborted', 'failed', 'unknown']), requestId: uuid.optional(), promptMatchesTask: nullableBoolean }).strict(),
  textVisibility: z.object({ targetText: nullableBoolean, reading: nullableBoolean, meaning: nullableBoolean, choices: nullableBoolean }).strict(),
};
export const evidenceEventSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('exercise_presented'), correct: z.null() }).strict(),
  z.object({ ...common, kind: z.literal('answer_submitted'), correct: z.boolean() }).strict(),
]).superRefine((event, ctx) => {
  const problem = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (event.kind === 'exercise_presented' && (event.sequence !== 0 || event.isRetry || event.responseMs !== null || event.timingComplete)) problem('Presentation cannot contain an answer');
  if (event.kind === 'answer_submitted' && (event.sequence < 1 || event.isRetry !== (event.sequence > 1))) problem('Answer sequence/retry mismatch');
  if (event.timingComplete !== (event.responseMs !== null)) problem('Incomplete timing must remain null');
  if (['started', 'completed', 'aborted', 'failed'].includes(event.audio.status) && !event.audio.requestId) problem('Playback request identity required');
  if (event.audio.status === 'not_requested' && (event.audio.requestId !== undefined || event.audio.promptMatchesTask !== null)) problem('Unrequested audio cannot have playback facts');
  if (event.source === 'course_lesson' && (!event.lessonSessionId || !event.legacyQuestionId)) problem('Lesson source requires original session and question');
  if (event.source !== 'course_lesson' && event.lessonSessionId !== undefined) problem('Only lesson sources use a lesson session');
  if (event.source === 'course_review' && !event.legacyQuestionId) problem('Review source requires original question');
});
export const evidenceReceiptSchema = z.object({ ownerId: uuid, event: evidenceEventSchema, payloadHash: z.string().regex(/^[0-9a-f]{64}$/), receivedAt: instantSchema, serverSequence: integer.refine(value => value > 0) }).strict();
export const evidenceSnapshotSchema = z.object({
  schemaVersion: z.literal(1), ownerId: uuid, generationId: uuid, prospectiveStartedAt: instantSchema, studyDayTimezone: timezone,
  completeness: z.object({ status: z.enum(['complete', 'partial', 'unavailable']), throughServerSequence: integer }).strict(),
  records: z.array(evidenceReceiptSchema),
}).strict();
const contextSchema = z.object({ ownerId: uuid, generationId: uuid, prospectiveStartedAt: instantSchema, studyDayTimezone: timezone, now: instantSchema }).strict();

/** A tuple encoding, not a text/content hash. For lesson replay the episode UUID is deliberately excluded. */
export function makeSourceSlotKey(ownerId: string, event: Pick<EvidenceEvent, 'generationId' | 'source' | 'lessonSessionId' | 'episodeId' | 'legacyQuestionId' | 'itemId' | 'contentRevision' | 'taskId' | 'taskFormat' | 'gradingVersion'>): string {
  return JSON.stringify(['legacy-evidence-slot-v1', ownerId, event.generationId, event.source,
    event.source === 'course_lesson' ? event.lessonSessionId : event.episodeId,
    event.legacyQuestionId ?? null, event.itemId, event.contentRevision, event.taskId, event.taskFormat, event.gradingVersion]);
}

export function canonicalEvidence(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalEvidence).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalEvidence((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function validateEvidenceEvent(input: unknown, context: ProjectionContext, catalogue: readonly TaskDescriptor[]):
  { ok: true; event: EvidenceEvent } | { ok: false; code: string } {
  if (!contextSchema.safeParse(context).success || Date.parse(context.prospectiveStartedAt) > Date.parse(context.now)) return { ok: false, code: 'invalid_context' };
  const parsed = evidenceEventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_event_schema' };
  const event = parsed.data;
  if (event.generationId !== context.generationId) return { ok: false, code: 'generation_mismatch' };
  if (event.sourceSlotKey !== makeSourceSlotKey(context.ownerId, event)) return { ok: false, code: 'source_slot_mismatch' };
  const occurred = Date.parse(event.occurredAt);
  if (occurred < Date.parse(context.prospectiveStartedAt) || occurred > Date.parse(context.now)) return { ok: false, code: 'clock_or_nonprospective_event' };
  const matches = catalogue.filter(task => task.taskId === event.taskId && task.contentRevision === event.contentRevision);
  if (matches.length !== 1) return { ok: false, code: 'unknown_or_conflicting_source' };
  const task = matches[0];
  if (task.itemId !== event.itemId || task.lessonId !== event.lessonId || task.legacyQuestionId !== event.legacyQuestionId || !task.bindings.some(binding => binding.source === event.source && binding.taskFormat === event.taskFormat && binding.gradingVersion === event.gradingVersion)) return { ok: false, code: 'source_descriptor_mismatch' };
  return { ok: true, event };
}

export type ValidatedSnapshot = { ok: true; snapshot: EvidenceSnapshot; records: EvidenceReceipt[]; complete: boolean; warnings: EvidenceWarning[] } | { ok: false; code: string };
export function validateEvidenceSnapshot(input: unknown, context: ProjectionContext, catalogue: readonly TaskDescriptor[]): ValidatedSnapshot {
  if (!contextSchema.safeParse(context).success || Date.parse(context.prospectiveStartedAt) > Date.parse(context.now)) return { ok: false, code: 'invalid_context' };
  const parsed = evidenceSnapshotSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_snapshot_schema' };
  const snapshot = parsed.data;
  if (snapshot.ownerId !== context.ownerId || snapshot.generationId !== context.generationId || snapshot.prospectiveStartedAt !== context.prospectiveStartedAt || snapshot.studyDayTimezone !== context.studyDayTimezone) return { ok: false, code: 'snapshot_context_mismatch' };
  if (snapshot.records.some(row => row.ownerId !== context.ownerId || row.event.generationId !== context.generationId)) return { ok: false, code: 'receipt_context_mismatch' };
  if (snapshot.completeness.status === 'unavailable') return { ok: false, code: 'snapshot_unavailable' };
  const warnings: EvidenceWarning[] = [];
  const warn = (code: string, ids: string[] = []) => warnings.push({ code, eventIds: ids });
  if (snapshot.completeness.status !== 'complete') warn('incomplete_snapshot');
  const ids = new Map<string, EvidenceReceipt>(), sequences = new Map<number, string>(), slots = new Map<string, string>();
  const records: EvidenceReceipt[] = [];
  for (const row of snapshot.records) {
    const event = row.event;
    const duplicate = ids.get(event.eventId);
    if (duplicate) {
      if (canonicalEvidence(duplicate) !== canonicalEvidence(row)) warn('conflicting_event_id', [event.eventId]);
      continue;
    }
    ids.set(event.eventId, row);
    const sequenceId = sequences.get(row.serverSequence);
    if (sequenceId) warn('conflicting_server_sequence', [sequenceId, event.eventId]);
    sequences.set(row.serverSequence, event.eventId);
    const slot = `${event.sourceSlotKey}:${event.sequence}`, slotId = slots.get(slot);
    if (slotId) warn('conflicting_episode_sequence', [slotId, event.eventId]);
    slots.set(slot, event.eventId);
    const checked = validateEvidenceEvent(event, context, catalogue);
    if (!checked.ok) { warn(checked.code, [event.eventId]); continue; }
    if (Date.parse(row.receivedAt) < Date.parse(event.occurredAt) || Date.parse(row.receivedAt) > Date.parse(context.now)) { warn('clock_inconsistent_receipt', [event.eventId]); continue; }
    records.push(row);
  }
  // No timestamp pagination assumptions: the complete prefix includes every committed sequence.
  const sorted = [...sequences.keys()].sort((a, b) => a - b);
  if (sorted.length !== snapshot.completeness.throughServerSequence || sorted.some((value, index) => value !== index + 1)) warn('incomplete_server_sequence');
  // Conflicting IDs are quarantined rather than choosing whichever payload arrived first.
  const conflicts = new Set(warnings.filter(warning => warning.code.startsWith('conflicting_')).flatMap(warning => warning.eventIds));
  return { ok: true, snapshot, records: records.filter(row => !conflicts.has(row.event.eventId)), complete: warnings.length === 0,
    warnings: warnings.map(warning => ({ ...warning, eventIds: [...warning.eventIds].sort() })).sort((a, b) => canonicalEvidence(a).localeCompare(canonicalEvidence(b))),
  };
}
