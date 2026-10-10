import { z } from 'zod';
import { canonicalEvidence, evidenceEventSchema, instantSchema, makeSourceSlotKey } from './validation.ts';
import { freezeEvidence, immutableCopy, verifyFrozenEvidence } from './canonical-hash.ts';
import { LocalEvidenceError, MAX_COMPATIBILITY_ANSWER_CHARS, type CaptureCheckpoint, type CompatibilityHandoff,
  type CaptureMutation, type CheckpointAction, type LocalEvidenceContext, type PreparedCapture } from './persistence-types.ts';
import type { EvidenceEvent, TaskDescriptor, TextVisibility } from './types.ts';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const flag = z.boolean().nullable();
const visibilitySchema = z.object({ targetText: flag, reading: flag, meaning: flag, choices: flag }).strict();
const audioSchema = z.object({ status: z.enum(['not_requested', 'started', 'completed', 'aborted', 'failed', 'unknown']),
  requestId: uuid.optional(), promptMatchesTask: flag }).strict();
const predecessorSchema = z.object({ eventId: uuid, payloadHash: z.string().regex(/^[0-9a-f]{64}$/), sequence: integer }).strict();
const handoffSchema = z.object({ eventId: uuid, draftToken: z.string().min(1).max(2048),
  legacyQuestionId: z.string().min(1).max(200), lessonSessionId: z.string().min(1).max(200).nullable(),
  answer: z.string().max(MAX_COMPATIBILITY_ANSWER_CHARS), correct: z.boolean(),
  observation: z.object({ responseMs: z.number().min(0).max(600_000).optional(), neededHelp: z.boolean(),
    modality: z.enum(['meaning', 'listening', 'typing']) }).strict(), status: z.enum(['pending', 'applied']) }).strict();
const checkpointSchema = z.object({ version: z.literal(1), ownerId: uuid, generationId: uuid,
  sourceSlotKey: z.string().max(2048), episodeId: uuid, checkpointRevision: integer.refine(n => n > 0),
  nextSequence: integer.refine(n => n > 0), predecessor: predecessorSchema,
  presentation: evidenceEventSchema, lastOccurredAt: instantSchema, attemptStartedAt: instantSchema,
  hintUsed: flag, answerPreviouslyRevealed: flag, textVisibility: visibilitySchema, audio: audioSchema,
  timingContinuity: z.enum(['continuous', 'unknown']), answerReady: z.boolean(), handoff: handoffSchema.nullable(),
}).strict();
const expectationSchema = z.object({ checkpointRevision: integer, predecessor: predecessorSchema, canonical: z.string() }).strict().nullable();
const actionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['hint', 'reveal', 'interruption', 'provenance_loss']) }).strict(),
  z.object({ kind: z.literal('visibility'), visibility: visibilitySchema }).strict(),
  z.object({ kind: z.literal('retry'), occurredAt: instantSchema }).strict(),
  z.object({ kind: z.literal('audio_requested'), requestId: uuid, sourceSlotKey: z.string(), episodeId: uuid, promptMatchesTask: flag }).strict(),
  z.object({ kind: z.literal('audio_callback'), requestId: uuid, sourceSlotKey: z.string(), episodeId: uuid, status: z.enum(['started', 'completed', 'aborted', 'failed']) }).strict(),
  z.object({ kind: z.literal('compatibility_applied'), eventId: uuid, survivingDraftToken: z.string().min(1).max(2048) }).strict(),
]);
const mutationSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('presentation'), timingObserved: z.boolean() }).strict(),
  z.object({ kind: z.literal('answer') }).strict(), z.object({ kind: z.literal('checkpoint'), action: actionSchema }).strict()]);
const preparedSchema = z.object({ version: z.literal(1), transitionId: uuid,
  fence: z.object({ ownerId: uuid, generationId: uuid, ownerEpoch: integer }).strict(),
  expected: expectationSchema, checkpoint: checkpointSchema, event: z.unknown().nullable(), mutation: mutationSchema,
}).strict();
const fail = (code: 'invalid_input' | 'corrupt_record' | 'stale_context' | 'unsupported_history' | 'compatibility_pending' = 'invalid_input'): never => { throw new LocalEvidenceError(code); };
const equal = (a: unknown, b: unknown) => canonicalEvidence(a) === canonicalEvidence(b);
/** true is sticky; uncertainty cannot be erased by hiding a surface. */
export function stickyExposure(before: boolean | null, observed: boolean | null): boolean | null {
  return before === true || observed === true ? true : before === null || observed === null ? null : false;
}
export function exposureFor(format: EvidenceEvent['taskFormat'], visibility: TextVisibility): boolean | null {
  const relevant = format === 'typed_answer' ? [visibility.targetText, visibility.reading, visibility.choices]
    : format === 'listening_choice' ? [visibility.targetText, visibility.reading, visibility.meaning] : [];
  return relevant.reduce<boolean | null>((value, next) => stickyExposure(value, next), false);
}
export function parseCheckpoint(input: unknown): CaptureCheckpoint {
  const parsed = checkpointSchema.safeParse(input);
  if (!parsed.success) return fail('corrupt_record');
  const cp: CaptureCheckpoint = JSON.parse(JSON.stringify(parsed.data)), p = cp.presentation;
  if (p.kind !== 'exercise_presented' || p.source === 'item_practice' || p.generationId !== cp.generationId ||
    p.episodeId !== cp.episodeId || p.sourceSlotKey !== cp.sourceSlotKey || makeSourceSlotKey(cp.ownerId, p) !== cp.sourceSlotKey ||
    cp.nextSequence !== cp.predecessor.sequence + 1 || Date.parse(cp.lastOccurredAt) < Date.parse(p.occurredAt) ||
    Date.parse(cp.attemptStartedAt) < Date.parse(p.occurredAt) ||
    (cp.predecessor.sequence === 0 && cp.predecessor.eventId !== p.eventId) ||
    (cp.hintUsed !== true && p.hintUsed === true) || (cp.answerPreviouslyRevealed !== true && p.answerPreviouslyRevealed === true) ||
    stickyExposure(cp.answerPreviouslyRevealed, exposureFor(p.taskFormat, cp.textVisibility)) !== cp.answerPreviouslyRevealed ||
    (cp.predecessor.sequence > 0 && cp.answerPreviouslyRevealed !== true) ||
    (cp.handoff && (cp.handoff.eventId !== cp.predecessor.eventId || cp.predecessor.sequence === 0 ||
      cp.handoff.legacyQuestionId !== p.legacyQuestionId || cp.handoff.lessonSessionId !== (p.lessonSessionId ?? null))) ||
    (cp.audio.status === 'not_requested' && (cp.audio.requestId !== undefined || cp.audio.promptMatchesTask !== null)) ||
    (['started', 'completed', 'aborted', 'failed'].includes(cp.audio.status) && !cp.audio.requestId)) return fail('corrupt_record');
  return cp;
}
function checkContext(cp: CaptureCheckpoint, context: LocalEvidenceContext): void {
  if (cp.ownerId !== context.ownerId || cp.generationId !== context.generationId) fail('stale_context');
  if (!Number.isSafeInteger(context.ownerEpoch) || context.ownerEpoch < 0 || !instantSchema.safeParse(context.now).success ||
    Date.parse(context.now) < Date.parse(cp.lastOccurredAt)) fail();
}
function prepared(cp: CaptureCheckpoint, previous: CaptureCheckpoint | null, context: LocalEvidenceContext,
  transitionId: string, event: PreparedCapture['event'], mutation: CaptureMutation): PreparedCapture {
  if (!uuid.safeParse(transitionId).success) fail();
  checkContext(cp, context);
  return immutableCopy({ version: 1, transitionId,
    fence: { ownerId: context.ownerId, generationId: context.generationId, ownerEpoch: context.ownerEpoch },
    expected: previous ? { checkpointRevision: previous.checkpointRevision, predecessor: previous.predecessor, canonical: canonicalEvidence(previous) } : null,
    checkpoint: parseCheckpoint(cp), event, mutation });
}

/** No ID/clock creation and no actual capture: the caller supplies a genuine new visible observation. */
export async function preparePresentation(incomingInput: {
  transitionId: string; event: EvidenceEvent; actualVisible: true;
  history: 'new_session' | 'old_unattempted' | 'old_attempted' | 'lost_checkpoint';
  timingObserved: boolean;
}, incomingContext: LocalEvidenceContext, catalogue: readonly TaskDescriptor[]): Promise<PreparedCapture> {
  const input = structuredClone(incomingInput), context = structuredClone(incomingContext);
  if (input.actualVisible !== true || input.event.kind !== 'exercise_presented') fail();
  if (input.history === 'old_attempted' || input.history === 'lost_checkpoint') fail('unsupported_history');
  if (!['new_session', 'old_unattempted'].includes(input.history)) fail();
  const event: EvidenceEvent = JSON.parse(JSON.stringify(input.event));
  if ((event.audio.status !== 'not_requested' && event.audio.status !== 'unknown') || event.audio.requestId !== undefined || event.audio.promptMatchesTask !== null) fail();
  if (input.history === 'old_unattempted') { event.hintUsed = stickyExposure(event.hintUsed, null); event.answerPreviouslyRevealed = stickyExposure(event.answerPreviouslyRevealed, null); }
  event.answerPreviouslyRevealed = stickyExposure(event.answerPreviouslyRevealed, exposureFor(event.taskFormat, event.textVisibility));
  const frozen = await freezeEvidence(event, context, catalogue);
  const cp: CaptureCheckpoint = { version: 1, ownerId: context.ownerId, generationId: event.generationId,
    sourceSlotKey: event.sourceSlotKey, episodeId: event.episodeId, checkpointRevision: 1, nextSequence: 1,
    predecessor: { eventId: event.eventId, payloadHash: frozen.payloadHash, sequence: 0 }, presentation: event,
    lastOccurredAt: event.occurredAt, attemptStartedAt: event.occurredAt,
    hintUsed: event.hintUsed, answerPreviouslyRevealed: event.answerPreviouslyRevealed,
    textVisibility: event.textVisibility, audio: event.audio,
    timingContinuity: input.timingObserved ? 'continuous' : 'unknown', answerReady: true, handoff: null };
  return prepared(cp, null, context, input.transitionId, frozen, { kind: 'presentation', timingObserved: input.timingObserved });
}
export type { CheckpointAction } from './persistence-types.ts';

/** Commit help/reveal/retry intents before the future UI exposes or clears anything. */
export function prepareCheckpointTransition(current: CaptureCheckpoint, action: CheckpointAction,
  context: LocalEvidenceContext, transitionId: string): PreparedCapture {
  if (!actionSchema.safeParse(action).success) fail();
  const previous = parseCheckpoint(current); checkContext(previous, context);
  const cp = structuredClone(previous); cp.checkpointRevision++;
  switch (action.kind) {
    case 'hint': cp.hintUsed = true; cp.answerPreviouslyRevealed = true; break;
    case 'reveal': cp.answerPreviouslyRevealed = true; break;
    case 'visibility':
      cp.textVisibility = visibilitySchema.parse(action.visibility);
      cp.answerPreviouslyRevealed = stickyExposure(cp.answerPreviouslyRevealed, exposureFor(cp.presentation.taskFormat, cp.textVisibility)); break;
    case 'provenance_loss':
      cp.hintUsed = stickyExposure(cp.hintUsed, null);
      cp.answerPreviouslyRevealed = stickyExposure(cp.answerPreviouslyRevealed, null);
      cp.textVisibility = { targetText: stickyExposure(cp.textVisibility.targetText, null),
        reading: stickyExposure(cp.textVisibility.reading, null), meaning: stickyExposure(cp.textVisibility.meaning, null),
        choices: stickyExposure(cp.textVisibility.choices, null) };
      // Preserve the old interruption's audio shape and timing semantics.
      // Provenance loss alone additionally removes unsupported clean claims.
      cp.timingContinuity = 'unknown';
      cp.audio = { status: 'unknown', ...(cp.audio.requestId ? { requestId: cp.audio.requestId } : {}), promptMatchesTask: null }; break;
    case 'interruption':
      cp.timingContinuity = 'unknown';
      cp.audio = { status: 'unknown', ...(cp.audio.requestId ? { requestId: cp.audio.requestId } : {}), promptMatchesTask: null }; break;
    case 'retry':
      if (cp.answerReady || cp.predecessor.sequence === 0 || cp.handoff?.status === 'pending') fail('compatibility_pending');
      if (!instantSchema.safeParse(action.occurredAt).success || Date.parse(action.occurredAt) < Date.parse(cp.lastOccurredAt) || Date.parse(action.occurredAt) > Date.parse(context.now)) fail();
      cp.answerReady = true; cp.answerPreviouslyRevealed = true; cp.attemptStartedAt = action.occurredAt; break;
    case 'audio_requested':
      if (!cp.answerReady || action.sourceSlotKey !== cp.sourceSlotKey || action.episodeId !== cp.episodeId ||
        !uuid.safeParse(action.requestId).success || action.requestId === cp.audio.requestId) fail();
      cp.audio = { status: 'unknown', requestId: action.requestId, promptMatchesTask: action.promptMatchesTask }; break;
    case 'audio_callback':
      if (!cp.answerReady || action.sourceSlotKey !== cp.sourceSlotKey || action.episodeId !== cp.episodeId || action.requestId !== cp.audio.requestId) fail();
      if (cp.audio.status === 'aborted' || cp.audio.status === 'failed') fail();
      if (action.status === 'completed' && cp.audio.status !== 'started') fail();
      if (action.status === 'started' && cp.audio.status !== 'unknown') fail();
      cp.audio.status = action.status; break;
    case 'compatibility_applied':
      if (!cp.handoff || cp.handoff.status !== 'pending' || action.eventId !== cp.handoff.eventId || action.survivingDraftToken !== cp.handoff.draftToken) fail();
      cp.handoff!.status = 'applied'; break;
    default: fail();
  }
  return prepared(cp, previous, context, transitionId, null, { kind: 'checkpoint', action });
}

export async function prepareAnswer(current: CaptureCheckpoint, incomingInput: {
  transitionId: string; eventId: string; occurredAt: string; recordTimezone: string; correct: boolean;
  responseMs: number | null; handoff: Omit<CompatibilityHandoff, 'eventId' | 'correct' | 'status' | 'legacyQuestionId' | 'lessonSessionId'>;
}, incomingContext: LocalEvidenceContext, catalogue: readonly TaskDescriptor[]): Promise<PreparedCapture> {
  const input = structuredClone(incomingInput), context = structuredClone(incomingContext);
  const previous = parseCheckpoint(current); checkContext(previous, context);
  if (!previous.answerReady) fail();
  if (previous.handoff?.status === 'pending') fail('compatibility_pending');
  const elapsed = Date.parse(input.occurredAt) - Date.parse(previous.attemptStartedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0 || Date.parse(input.occurredAt) < Date.parse(previous.lastOccurredAt)) fail();
  const responseMs = previous.timingContinuity === 'continuous' ? input.responseMs : null;
  if (responseMs !== null && (!Number.isInteger(responseMs) || responseMs < 0 || responseMs > 600_000 || responseMs > elapsed)) fail();
  const event: EvidenceEvent = { ...previous.presentation, eventId: input.eventId, kind: 'answer_submitted', correct: input.correct,
    sequence: previous.nextSequence, isRetry: previous.nextSequence > 1, occurredAt: input.occurredAt, recordTimezone: input.recordTimezone,
    hintUsed: previous.hintUsed, answerPreviouslyRevealed: previous.answerPreviouslyRevealed,
    audio: structuredClone(previous.audio), textVisibility: structuredClone(previous.textVisibility), responseMs, timingComplete: responseMs !== null };
  const frozen = await freezeEvidence(event, context, catalogue);
  const parsedHandoff = handoffSchema.safeParse({ ...input.handoff, eventId: event.eventId, correct: input.correct, status: 'pending',
    legacyQuestionId: event.legacyQuestionId, lessonSessionId: event.lessonSessionId ?? null });
  if (!parsedHandoff.success) return fail();
  const handoff: CompatibilityHandoff = JSON.parse(JSON.stringify(parsedHandoff.data));
  const cp: CaptureCheckpoint = { ...previous, checkpointRevision: previous.checkpointRevision + 1,
    nextSequence: event.sequence + 1, predecessor: { eventId: event.eventId, payloadHash: frozen.payloadHash, sequence: event.sequence },
    lastOccurredAt: event.occurredAt, answerReady: false, answerPreviouslyRevealed: true, handoff };
  return prepared(cp, previous, context, input.transitionId, frozen, { kind: 'answer' });
}

/** Integrity validation of a stored/frozen transaction. Runs before opening a write transaction. */
export async function verifyPreparedCapture(input: PreparedCapture): Promise<void> {
  if (!preparedSchema.safeParse(input).success) fail('corrupt_record');
  let prior: unknown;
  try { prior = input.expected ? JSON.parse(input.expected.canonical) : null; } catch { return fail('corrupt_record'); }
  const cp = parseCheckpoint(input.checkpoint), before = input.expected ? parseCheckpoint(prior) : null;
  if (!equal(cp, input.checkpoint)) fail('corrupt_record');
  if (input.fence.ownerId !== cp.ownerId || input.fence.generationId !== cp.generationId ||
    cp.checkpointRevision !== (before?.checkpointRevision ?? 0) + 1 ||
    (before && (!equal(input.expected?.predecessor, before.predecessor) || input.expected?.checkpointRevision !== before.checkpointRevision ||
      input.expected?.canonical !== canonicalEvidence(before) || before.ownerId !== cp.ownerId || before.generationId !== cp.generationId ||
      before.sourceSlotKey !== cp.sourceSlotKey || before.episodeId !== cp.episodeId || !equal(before.presentation, cp.presentation) ||
      stickyExposure(before.hintUsed, cp.hintUsed) !== cp.hintUsed || stickyExposure(before.answerPreviouslyRevealed, cp.answerPreviouslyRevealed) !== cp.answerPreviouslyRevealed ||
      (before.timingContinuity === 'unknown' && cp.timingContinuity !== 'unknown')))) fail('corrupt_record');
  if (input.event) {
    const event = await verifyFrozenEvidence(input.event);
    if (event.eventId !== cp.predecessor.eventId || input.event.payloadHash !== cp.predecessor.payloadHash || event.sequence !== cp.predecessor.sequence ||
      input.event.ownerId !== cp.ownerId || event.generationId !== cp.generationId || event.sourceSlotKey !== cp.sourceSlotKey || event.episodeId !== cp.episodeId ||
      event.sequence !== (before?.nextSequence ?? 0) || cp.nextSequence !== event.sequence + 1 || event.occurredAt !== cp.lastOccurredAt) fail('corrupt_record');
    if (!before) {
      if (input.mutation.kind !== 'presentation') fail('corrupt_record');
      const initial = { version: 1, ownerId: input.event.ownerId, generationId: event.generationId,
        sourceSlotKey: event.sourceSlotKey, episodeId: event.episodeId, checkpointRevision: 1, nextSequence: 1,
        predecessor: { eventId: event.eventId, payloadHash: input.event.payloadHash, sequence: 0 }, presentation: event,
        lastOccurredAt: event.occurredAt, attemptStartedAt: event.occurredAt, hintUsed: event.hintUsed,
        answerPreviouslyRevealed: event.answerPreviouslyRevealed, textVisibility: event.textVisibility, audio: event.audio,
        timingContinuity: input.mutation.kind === 'presentation' && input.mutation.timingObserved ? 'continuous' : 'unknown', answerReady: true, handoff: null };
      if (!equal(cp, initial) || (event.audio.status !== 'not_requested' && event.audio.status !== 'unknown') ||
        event.audio.requestId !== undefined || event.audio.promptMatchesTask !== null) fail('corrupt_record');
    }
    else if (input.mutation.kind !== 'answer' || !before.answerReady || before.handoff?.status === 'pending' || event.kind !== 'answer_submitted' || cp.answerReady ||
      !cp.handoff || cp.handoff.status !== 'pending' || cp.handoff.correct !== event.correct ||
      event.hintUsed !== before.hintUsed || event.answerPreviouslyRevealed !== before.answerPreviouslyRevealed ||
      !equal(event.audio, before.audio) || !equal(event.textVisibility, before.textVisibility) ||
      (before.timingContinuity === 'unknown' && event.responseMs !== null) ||
      (event.responseMs !== null && event.responseMs > Date.parse(event.occurredAt) - Date.parse(before.attemptStartedAt))) fail('corrupt_record');
    if (before) {
      const exactEvent = { ...before.presentation, eventId: event.eventId, kind: 'answer_submitted', correct: event.correct,
        sequence: before.nextSequence, isRetry: before.nextSequence > 1, occurredAt: event.occurredAt, recordTimezone: event.recordTimezone,
        hintUsed: before.hintUsed, answerPreviouslyRevealed: before.answerPreviouslyRevealed, audio: before.audio,
        textVisibility: before.textVisibility, responseMs: event.responseMs, timingComplete: event.timingComplete };
      const exactCheckpoint = { ...before, checkpointRevision: before.checkpointRevision + 1, nextSequence: event.sequence + 1,
        predecessor: { eventId: event.eventId, payloadHash: input.event.payloadHash, sequence: event.sequence },
        lastOccurredAt: event.occurredAt, answerReady: false, answerPreviouslyRevealed: true, handoff: cp.handoff };
      if (!equal(event, exactEvent) || !equal(cp, exactCheckpoint) || Date.parse(event.occurredAt) < Date.parse(before.lastOccurredAt) ||
        Date.parse(event.occurredAt) < Date.parse(before.attemptStartedAt)) fail('corrupt_record');
    }
  } else {
    if (!before || input.mutation.kind !== 'checkpoint') return fail('corrupt_record');
    const action = input.mutation.action;
    const recomputed = prepareCheckpointTransition(before, action, {
      ownerId: cp.ownerId, generationId: cp.generationId, ownerEpoch: input.fence.ownerEpoch,
      prospectiveStartedAt: cp.presentation.occurredAt, studyDayTimezone: cp.presentation.recordTimezone,
      now: action.kind === 'retry' ? action.occurredAt : before.lastOccurredAt, freshness: 'cached_offline',
    }, input.transitionId);
    if (!equal(cp, recomputed.checkpoint)) fail('corrupt_record');
  }
}
