import { z } from 'zod';
import { languageDocument } from '../../app/data/languageRecordDocuments.ts';
import { canonicalEvidence, makeSourceSlotKey, instantSchema } from './validation.ts';
import { canonicalSha256, immutableCopy, decodeFrozenEvidence } from './canonical-hash.ts';
import { verifyPreparedCapture, stickyExposure } from './capture.ts';
import { LEGACY_EVIDENCE_CATALOGUE } from './catalogue.ts';
import { LocalEvidenceError, type LocalFence, type PreparedCapture, type Immutable } from './persistence-types.ts';

/** Inactive, local-only pilot ceilings. All strings are charged in stored UTF-8 encoding. */
export const REVIEW_LIMITS = Object.freeze({ sourceBytes: 256 * 1024, ownerBytes: 8 * 1024 * 1024,
  runs: 64, exposures: 256, journals: 1024, pendingIntents: 8, runStateBytes: 4 * 1024,
  exposureBytes: 4 * 1024, rowFenceBytes: 2 * 1024, journalBytes: 32 * 1024, runBytes: 1024 * 1024,
  terminalSlots: 2, terminalBytes: 74 * 1024, actionSlots: 4, actionBytes: 138 * 1024 });
export const REVIEW_STORES = ['reviewRuns', 'itemExposures', 'reviewTransitions'] as const;
export type ReviewStoreName = typeof REVIEW_STORES[number];
export const reviewUtf8Bytes = (value: unknown): number => new TextEncoder().encode(canonicalEvidence(value)).byteLength;
export const reviewStoredRowBytes = (key: IDBValidKey, value: unknown): number => reviewUtf8Bytes(key) + reviewUtf8Bytes(value);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9:_@./-]+$/);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const flag = z.union([z.literal(true), z.null()]);
const scopeSchema = z.object({ ownerId: uuid, generationId: uuid, incarnationId: uuid }).strict();
export type ReviewScope = z.infer<typeof scopeSchema>;
const sourceSchema = z.object({ key: z.literal('japaneseCurriculumReviewV1'), arrayBytes: z.string(), rowIndex: count, rowBytes: z.string() }).strict();
const identitySchema = z.object({ itemId: identifier, contentRevision: revision, taskId: identifier, lessonId: identifier,
  legacyQuestionId: identifier, taskFormat: z.enum(['meaning_choice', 'typed_answer']), gradingVersion: identifier }).strict();
const immutableSchema = z.object({ ...scopeSchema.shape, runId: uuid, episodeId: uuid, rowKey: identifier,
  slot: z.string().min(1).max(1024), sourceSlotKey: z.string().min(1).max(2048), identity: identitySchema,
  mode: z.enum(['starter', 'reader']), initialDraftToken: uuid, originalSource: sourceSchema }).strict();
export type ReviewRunImmutable = z.infer<typeof immutableSchema>;
const sourceRefSchema = z.object({ runKey: z.string().min(1).max(256), immutableSha256: hash }).strict();
const checkpointRefSchema = z.object({ transitionId: uuid, canonicalSha256: hash, sourceSlotKey: z.string().min(1).max(2048),
  checkpointRevision: revision, predecessor: z.object({ eventId: uuid, payloadHash: hash, sequence: count }).strict(),
  eventId: uuid.nullable(), payloadHash: hash.nullable() }).strict();
export type ReviewCaptureRef = z.infer<typeof checkpointRefSchema>;
const handoffRefSchema = z.object({ transitionId: uuid, eventId: uuid, draftToken: uuid }).strict();
const reservationSchema = z.object({ rootActionId: uuid, kind: z.enum(['presentation', 'hint', 'answer', 'retry', 'provenance_loss', 'retirement']),
  remainingSlots: count.max(3), remainingBytes: count.max(REVIEW_LIMITS.actionBytes) }).strict();
const terminalSchema = z.object({ slots: z.literal(2), bytes: z.literal(75776) }).strict();
const resultSchema = z.object({ id: identifier.optional(), intervalDays: z.number().finite().nonnegative().optional(), nextReviewAt: instantSchema.optional(),
  reviewed: z.boolean().optional(), deleted: z.boolean().optional() }).strict();
const outcomeSchema = z.object({ operationId: uuid, result: resultSchema }).strict();
const retirementSchema = z.object({ retirementId: uuid, kind: z.enum(['schedule', 'defer', 'delete']),
  handoff: handoffRefSchema.nullable(), neededHelp: z.boolean(), hadWrong: z.boolean(), outcome: outcomeSchema.nullable() }).strict();
const runStateSchema = z.object({ revision, latestTransitionId: uuid, lifecycle: z.enum(['active', 'retiring', 'closed']),
  phase: z.enum(['unpresented', 'answerable', 'feedback_pending', 'answered', 'unavailable']), currentDraftToken: uuid,
  checkpoint: checkpointRefSchema.nullable(), lastHandoff: handoffRefSchema.nullable(), neededHelp: z.boolean(), hadWrong: z.boolean(),
  feedbackObserved: z.boolean(), compatibilityApplied: z.boolean(), action: reservationSchema.nullable(), terminal: terminalSchema.nullable(),
  retirement: retirementSchema.nullable() }).strict();
export type ReviewRunState = z.infer<typeof runStateSchema>;
const runSchema = z.object({ version: z.literal(1), kind: z.literal('run'), ...scopeSchema.shape,
  managedSlot: z.string().min(1).max(2200), immutable: immutableSchema, state: runStateSchema }).strict();
export type ReviewRun = z.infer<typeof runSchema>;
const pointerSchema = z.object({ slot: z.string().min(1).max(1024), runId: uuid }).strict();
const claimSchema = z.object({ runId: uuid, retirementId: uuid, kind: z.enum(['schedule', 'defer', 'delete']) }).strict();
const rowFenceStateSchema = z.object({ revision, latestTransitionId: uuid, pointers: z.array(pointerSchema).max(2), retirement: claimSchema.nullable() }).strict();
export type ReviewRowFenceState = z.infer<typeof rowFenceStateSchema>;
const rowFenceSchema = z.object({ version: z.literal(1), kind: z.literal('row_fence'), ...scopeSchema.shape,
  rowKey: identifier, state: rowFenceStateSchema }).strict();
export type ReviewRowFence = z.infer<typeof rowFenceSchema>;
const intentSchema = z.object({ actionId: uuid, runId: uuid, immutableSourceRef: sourceRefSchema,
  surface: z.enum(['question', 'hint', 'feedback']), observationId: uuid }).strict();
const exposureSchema = z.object({ version: z.literal(1), ...scopeSchema.shape, itemId: identifier, contentRevision: revision,
  revision, latestTransitionId: uuid, targetText: flag, reading: flag, answer: flag, coverage: z.literal('unknown'),
  pending: z.array(intentSchema).max(REVIEW_LIMITS.pendingIntents) }).strict();
export type ReviewExposure = z.infer<typeof exposureSchema>;
const observedSchema = z.object({ observationId: uuid, actualVisible: z.literal(true), targetText: z.boolean(), reading: z.boolean(), answer: z.boolean() }).strict();
const operationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('acquire'), observationId: uuid }).strict(),
  z.object({ kind: z.literal('begin_reveal'), surface: z.literal('hint'), observationId: uuid }).strict(),
  z.object({ kind: z.enum(['presentation', 'observed_hint', 'observed_reveal', 'observed_visibility', 'observe_feedback']), observed: observedSchema }).strict(),
  z.object({ kind: z.literal('answer'), observationId: uuid }).strict(),
  z.object({ kind: z.enum(['compatibility_applied', 'provenance_loss', 'cancel_reveal', 'ack_retry', 'close_unavailable']) }).strict(),
  z.object({ kind: z.literal('retry'), draftToken: uuid }).strict(),
  z.object({ kind: z.literal('begin_retirement'), retirementKind: z.enum(['schedule', 'defer', 'delete']) }).strict(),
  z.object({ kind: z.literal('close_retirement'), outcome: outcomeSchema }).strict(),
]);
export type ReviewOperation = z.infer<typeof operationSchema>;
const snapshotSchema = z.object({ runState: runStateSchema.nullable(), exposure: exposureSchema.nullable(), rowFence: rowFenceStateSchema.nullable() }).strict();
const payloadSchema = z.object({ version: z.literal(1), kind: z.enum(['metadata_v1', 'capture_v1']), scope: scopeSchema,
  transitionId: uuid, actionId: uuid, operation: operationSchema, runId: uuid, immutableSourceRef: sourceRefSchema,
  before: snapshotSchema, after: z.object({ runState: runStateSchema, exposure: exposureSchema.nullable(), rowFence: rowFenceStateSchema }).strict(),
  captureRef: checkpointRefSchema.nullable() }).strict();
export type ReviewJournalPayload = z.infer<typeof payloadSchema>;
const journalSchema = z.object({ version: z.literal(1), ...scopeSchema.shape, kind: z.enum(['metadata_v1', 'capture_v1']), canonical: z.string() }).strict();
export type ReviewJournal = z.infer<typeof journalSchema>;
export type PreparedReviewTransition = Immutable<{ version: 1; fence: LocalFence; immutable: ReviewRunImmutable;
  journal: ReviewJournal; capture: PreparedCapture | null }>;
export type ReviewRows = { run: ReviewRun; exposure: ReviewExposure | null; rowFence: ReviewRowFence };
function fail(code: 'invalid_input' | 'corrupt_record' | 'review_conflict' | 'review_capacity' | 'review_unavailable' = 'corrupt_record'): never { throw new LocalEvidenceError(code); }
const same = (a: unknown, b: unknown) => canonicalEvidence(a) === canonicalEvidence(b);
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => { const p = schema.safeParse(value); return p.success ? p.data : fail(); };
const limited = (value: unknown, max: number) => { if (reviewUtf8Bytes(value) > max) fail('review_capacity'); };
const scopeOf = (v: ReviewScope): ReviewScope => ({ ownerId: v.ownerId, generationId: v.generationId, incarnationId: v.incarnationId });
export const reviewRunKey = (v: ReviewRunImmutable): string => JSON.stringify(['run', v.ownerId, v.generationId, v.incarnationId, v.runId]);
export const reviewRowFenceKey = (v: ReviewScope & { rowKey: string }): string => JSON.stringify(['row', v.ownerId, v.generationId, v.incarnationId, 'japaneseCurriculumReviewV1', v.rowKey]);
export const reviewExposureKey = (v: ReviewScope & { itemId: string; contentRevision: number }): string => JSON.stringify([v.ownerId, v.generationId, v.incarnationId, v.itemId, v.contentRevision]);
export const reviewJournalKey = (v: ReviewScope, transitionId: string): string => JSON.stringify([v.ownerId, v.generationId, v.incarnationId, transitionId]);
export const reviewManagedSlot = (v: Pick<ReviewRunImmutable, 'ownerId' | 'generationId' | 'sourceSlotKey'>): string => JSON.stringify([v.ownerId, v.generationId, v.sourceSlotKey]);

export function parseReviewImmutable(input: unknown): ReviewRunImmutable {
  const v = parse(immutableSchema, input);
  if (new TextEncoder().encode(v.originalSource.arrayBytes).byteLength > REVIEW_LIMITS.sourceBytes) fail('review_capacity');
  try {
    const doc = languageDocument(v.originalSource.arrayBytes, 'array');
    if (doc.rawAt([v.originalSource.rowIndex]) !== v.originalSource.rowBytes || doc.get([v.originalSource.rowIndex, 'id']) !== v.rowKey) fail();
    let matches = 0;
    for (let i = 0; i < doc.length(); i++) if (doc.get([i, 'id']) === v.rowKey) matches++;
    if (matches !== 1 || v.rowKey !== v.identity.legacyQuestionId) fail();
  } catch (error) { if (error instanceof LocalEvidenceError) throw error; fail(); }
  const task = LEGACY_EVIDENCE_CATALOGUE.filter(t => t.taskId === v.identity.taskId && t.contentRevision === v.identity.contentRevision);
  if (task.length !== 1 || task[0].itemId !== v.identity.itemId || task[0].lessonId !== v.identity.lessonId || task[0].legacyQuestionId !== v.identity.legacyQuestionId ||
    !task[0].bindings.some(b => b.source === 'course_review' && b.taskFormat === v.identity.taskFormat && b.gradingVersion === v.identity.gradingVersion) ||
    v.slot !== JSON.stringify([v.identity.taskId, v.identity.contentRevision, v.identity.taskFormat]) ||
    v.sourceSlotKey !== makeSourceSlotKey(v.ownerId, { ...v.identity, generationId: v.generationId, episodeId: v.episodeId, source: 'course_review' }) ||
    (v.identity.taskFormat === 'typed_answer' && v.mode !== 'reader')) fail();
  return v;
}
export function parseReviewRun(input: unknown): ReviewRun {
  const v = parse(runSchema, input); parseReviewImmutable(v.immutable);
  if (!same(scopeOf(v), scopeOf(v.immutable)) || v.managedSlot !== reviewManagedSlot(v.immutable)) fail();
  limited(v.state, REVIEW_LIMITS.runStateBytes); if (reviewStoredRowBytes(reviewRunKey(v.immutable), v) > REVIEW_LIMITS.runBytes) fail('review_capacity'); return v;
}
export function parseReviewExposure(input: unknown): ReviewExposure {
  const v = parse(exposureSchema, input);
  if (new Set(v.pending.map(p => p.actionId)).size !== v.pending.length || v.pending.some(p => p.immutableSourceRef.runKey !== JSON.stringify(['run', v.ownerId, v.generationId, v.incarnationId, p.runId]))) fail();
  limited(v, REVIEW_LIMITS.exposureBytes); return v;
}
export function parseReviewRowFence(input: unknown): ReviewRowFence {
  const v = parse(rowFenceSchema, input);
  if (new Set(v.state.pointers.map(p => p.slot)).size !== v.state.pointers.length || new Set(v.state.pointers.map(p => p.runId)).size !== v.state.pointers.length ||
    v.state.retirement && !v.state.pointers.some(p => p.runId === v.state.retirement!.runId)) fail();
  limited(v.state, REVIEW_LIMITS.rowFenceBytes); return v;
}
export function parseReviewJournal(input: unknown): { row: ReviewJournal; payload: ReviewJournalPayload } {
  const row = parse(journalSchema, input); let payload: ReviewJournalPayload;
  try { payload = parse(payloadSchema, JSON.parse(row.canonical)); } catch { return fail(); }
  if (canonicalEvidence(payload) !== row.canonical || !same(scopeOf(row), payload.scope) || row.kind !== payload.kind ||
    (payload.kind === 'capture_v1') !== (payload.captureRef !== null)) fail();
  if (payload.immutableSourceRef.runKey !== JSON.stringify(['run', row.ownerId, row.generationId, row.incarnationId, payload.runId])) fail();
  for (const exposure of [payload.before.exposure, payload.after.exposure]) if (exposure) {
    parseReviewExposure(exposure); if (!same(scopeOf(exposure), payload.scope)) fail();
  }
  for (const ref of [payload.captureRef, payload.before.runState?.checkpoint, payload.after.runState.checkpoint]) if (ref) {
    let slot: unknown; try { slot = JSON.parse(ref.sourceSlotKey); } catch { fail(); }
    if (!Array.isArray(slot) || slot[0] !== 'legacy-evidence-slot-v1' || slot[1] !== row.ownerId || slot[2] !== row.generationId) fail();
  }
  limited(row, REVIEW_LIMITS.journalBytes);
  if (reviewStoredRowBytes(reviewJournalKey(payload.scope, payload.transitionId), row) > REVIEW_LIMITS.journalBytes) fail('review_capacity');
  return { row, payload };
}
export function reviewRowIdentity(name: ReviewStoreName, key: IDBValidKey, input: unknown): ReviewScope {
  let row: ReviewScope, expected: string;
  if (name === 'reviewRuns') {
    if ((input as { kind?: unknown })?.kind === 'run') { const v = parseReviewRun(input); row = v; expected = reviewRunKey(v.immutable); }
    else { const v = parseReviewRowFence(input); row = v; expected = reviewRowFenceKey(v); }
  } else if (name === 'itemExposures') { const v = parseReviewExposure(input); row = v; expected = reviewExposureKey(v); }
  else { const v = parseReviewJournal(input); row = v.row; expected = reviewJournalKey(row, v.payload.transitionId); }
  if (key !== expected) fail(); return scopeOf(row);
}
const bump = (n: number): number => { if (!Number.isSafeInteger(n) || n >= Number.MAX_SAFE_INTEGER) fail(); return n + 1; };
function stateReference(capture: PreparedCapture, digest: string): ReviewCaptureRef {
  return { transitionId: capture.transitionId, canonicalSha256: digest, sourceSlotKey: capture.checkpoint.sourceSlotKey,
    checkpointRevision: capture.checkpoint.checkpointRevision, predecessor: structuredClone(capture.checkpoint.predecessor),
    eventId: capture.event?.eventId ?? null, payloadHash: capture.event?.payloadHash ?? null };
}
function initialExposure(immutable: ReviewRunImmutable, transitionId: string): ReviewExposure {
  return { version: 1, ...scopeOf(immutable), itemId: immutable.identity.itemId, contentRevision: immutable.identity.contentRevision,
    revision: 1, latestTransitionId: transitionId, targetText: null, reading: null, answer: null, coverage: 'unknown', pending: [] };
}
/** Replay recomputes an exact finite operation; callers cannot supply arbitrary state patches. */
function plan(payload: Omit<ReviewJournalPayload, 'after'>, immutable: ReviewRunImmutable, capture: PreparedCapture | null): ReviewJournalPayload['after'] {
  const { before, operation: op, transitionId, actionId } = payload, prior = before.runState;
  if (!same(payload.scope, scopeOf(immutable)) || payload.runId !== immutable.runId || payload.immutableSourceRef.runKey !== reviewRunKey(immutable)) fail();
  let run: ReviewRunState;
  const row: ReviewRowFenceState = before.rowFence ? structuredClone(before.rowFence) : { revision: 0, latestTransitionId: transitionId, pointers: [], retirement: null };
  const exposure = before.exposure ? structuredClone(before.exposure) : initialExposure(immutable, transitionId);
  if (before.exposure && (!same(scopeOf(exposure), payload.scope) || exposure.itemId !== immutable.identity.itemId || exposure.contentRevision !== immutable.identity.contentRevision)) fail();
  if (prior) {
    run = structuredClone(prior);
    if (run.lifecycle === 'closed' || !before.rowFence || !row.pointers.some(p => p.runId === immutable.runId && p.slot === immutable.slot)) fail('review_conflict');
    if (row.retirement) {
      const claimantClose = row.retirement.runId === immutable.runId && op.kind === 'close_retirement';
      const reservedSiblingSettlement = row.retirement.runId !== immutable.runId && run.action?.rootActionId === actionId &&
        ['presentation', 'observed_hint', 'observed_reveal', 'observed_visibility', 'observe_feedback', 'compatibility_applied', 'ack_retry', 'provenance_loss', 'cancel_reveal'].includes(op.kind);
      if (!claimantClose && !reservedSiblingSettlement) fail('review_conflict');
    }
    run.revision = bump(run.revision); run.latestTransitionId = transitionId;
  } else {
    if (op.kind !== 'acquire' || row.retirement || row.pointers.some(p => p.slot === immutable.slot) || row.pointers.length >= 2) fail('review_conflict');
    run = { revision: 1, latestTransitionId: transitionId, lifecycle: 'active', phase: 'unpresented', currentDraftToken: immutable.initialDraftToken,
      checkpoint: null, lastHandoff: null, neededHelp: false, hadWrong: false, feedbackObserved: false, compatibilityApplied: false,
      action: null, terminal: { slots: 2, bytes: 75776 }, retirement: null };
    row.pointers.push({ slot: immutable.slot, runId: immutable.runId });
  }
  row.revision = bump(row.revision); row.latestTransitionId = transitionId;
  const root = (kind: NonNullable<ReviewRunState['action']>['kind'], slots: number) => {
    if (run.action || run.lifecycle !== 'active') fail('review_conflict');
    run.action = { rootActionId: actionId, kind, remainingSlots: slots - 1,
      remainingBytes: (slots - 1) * REVIEW_LIMITS.journalBytes + 10 * 1024 };
  };
  const settle = (kind: NonNullable<ReviewRunState['action']>['kind'], finished = true) => {
    if (!run.action || run.action.rootActionId !== actionId || run.action.kind !== kind || run.action.remainingSlots < 1) fail('review_conflict');
    run.action.remainingSlots--; run.action.remainingBytes = run.action.remainingSlots * REVIEW_LIMITS.journalBytes + 10 * 1024;
    if (finished) run.action = null;
  };
  const intent = (surface: 'question' | 'hint' | 'feedback', observationId: string) => {
    if (exposure.pending.length >= REVIEW_LIMITS.pendingIntents || exposure.pending.some(p => p.actionId === actionId)) fail('review_capacity');
    exposure.pending.push({ actionId, runId: immutable.runId, immutableSourceRef: payload.immutableSourceRef, surface, observationId });
  };
  const consume = (surface: 'question' | 'hint' | 'feedback', observationId?: string) => {
    const at = exposure.pending.findIndex(p => p.actionId === actionId && p.runId === immutable.runId && p.surface === surface && same(p.immutableSourceRef, payload.immutableSourceRef) && (observationId === undefined || p.observationId === observationId));
    if (at < 0) fail('review_conflict'); exposure.pending.splice(at, 1);
  };
  const observe = (observed: z.infer<typeof observedSchema>) => {
    exposure.targetText = stickyExposure(exposure.targetText, observed.targetText ? true : null) as true | null;
    exposure.reading = stickyExposure(exposure.reading, observed.reading ? true : null) as true | null;
    exposure.answer = stickyExposure(exposure.answer, observed.answer ? true : null) as true | null;
  };
  const expectedCapture = (kind: 'presentation' | 'answer' | 'checkpoint', action?: string) => {
    if (!capture || !payload.captureRef || capture.mutation.kind !== kind || (action && (capture.mutation.kind !== 'checkpoint' || capture.mutation.action.kind !== action))) fail();
    if (capture.transitionId !== transitionId || capture.checkpoint.sourceSlotKey !== immutable.sourceSlotKey || capture.checkpoint.episodeId !== immutable.episodeId ||
      capture.checkpoint.ownerId !== immutable.ownerId || capture.checkpoint.generationId !== immutable.generationId ||
      !same(Object.fromEntries(Object.keys(identitySchema.shape).map(key => [key, (capture.checkpoint.presentation as unknown as Record<string, unknown>)[key]])), immutable.identity)) fail();
    if (prior?.checkpoint) {
      if (!capture.expected || capture.expected.checkpointRevision !== prior.checkpoint.checkpointRevision || !same(capture.expected.predecessor, prior.checkpoint.predecessor)) fail();
    } else if (capture.expected) fail();
    run.checkpoint = payload.captureRef;
  };
  switch (op.kind) {
    case 'acquire': if (prior || capture) fail(); root('presentation', 2); intent('question', op.observationId); break;
    case 'presentation':
      if (run.phase !== 'unpresented') fail('review_conflict'); expectedCapture('presentation'); consume('question', op.observed.observationId); observe(op.observed); settle('presentation'); run.phase = 'answerable'; break;
    case 'begin_reveal':
      if (capture || run.phase !== 'answerable') fail('review_conflict'); root('hint', 2); intent('hint', op.observationId); run.neededHelp = true; break;
    case 'observed_hint': case 'observed_reveal': case 'observed_visibility':
      if (run.phase !== 'answerable') fail('review_conflict'); expectedCapture('checkpoint', op.kind === 'observed_hint' ? 'hint' : op.kind === 'observed_reveal' ? 'reveal' : 'visibility');
      consume('hint', op.observed.observationId); observe(op.observed); settle('hint'); run.neededHelp = true; break;
    case 'answer': {
      if (run.phase !== 'answerable' || exposure.pending.length || run.action) fail('review_conflict'); expectedCapture('answer'); root('answer', 3); intent('feedback', op.observationId);
      const cp = capture!.checkpoint; if (!cp.handoff || cp.handoff.draftToken !== run.currentDraftToken) fail();
      run.phase = 'feedback_pending'; run.feedbackObserved = false; run.compatibilityApplied = false;
      run.neededHelp ||= cp.handoff.observation.neededHelp; run.hadWrong ||= !cp.handoff.correct;
      run.lastHandoff = { transitionId, eventId: cp.handoff.eventId, draftToken: cp.handoff.draftToken }; break;
    }
    case 'observe_feedback':
      if (capture || run.phase !== 'feedback_pending' || run.feedbackObserved) fail('review_conflict'); consume('feedback', op.observed.observationId); observe(op.observed); run.feedbackObserved = true;
      settle('answer', run.compatibilityApplied); if (run.compatibilityApplied) run.phase = 'answered'; break;
    case 'compatibility_applied':
      if (run.phase !== 'feedback_pending' || run.compatibilityApplied) fail('review_conflict'); expectedCapture('checkpoint', 'compatibility_applied'); run.compatibilityApplied = true;
      settle('answer', run.feedbackObserved); if (run.feedbackObserved) run.phase = 'answered'; break;
    case 'retry':
      if (run.phase !== 'answered' || !run.feedbackObserved || !run.compatibilityApplied || exposure.pending.length) fail('review_conflict'); expectedCapture('checkpoint', 'retry'); root('retry', 2); run.currentDraftToken = op.draftToken; break;
    case 'ack_retry':
      if (capture || run.phase !== 'answered') fail('review_conflict'); settle('retry'); run.phase = 'answerable'; break;
    case 'provenance_loss':
      expectedCapture('checkpoint', 'provenance_loss');
      if (run.action) {
        if (!['hint', 'presentation'].includes(run.action.kind)) fail('review_conflict');
        consume(run.action.kind === 'hint' ? 'hint' : 'question'); settle(run.action.kind);
      } else { root('provenance_loss', 1); run.action = null; } break;
    case 'cancel_reveal':
      if (capture || !run.action || !['presentation', 'hint'].includes(run.action.kind)) fail('review_conflict');
      consume(run.action.kind === 'presentation' ? 'question' : 'hint');
      if (run.action.kind === 'presentation') run.phase = 'unavailable'; settle(run.action.kind); break;
    case 'begin_retirement':
      if (capture || run.action || !run.terminal || run.lifecycle !== 'active') fail('review_conflict');
      if (op.retirementKind === 'schedule' && (!run.lastHandoff || run.phase !== 'answered')) fail('review_conflict');
      run.action = { rootActionId: actionId, kind: 'retirement', remainingSlots: 1, remainingBytes: REVIEW_LIMITS.journalBytes + 10 * 1024 };
      run.terminal = null; run.lifecycle = 'retiring'; run.retirement = { retirementId: actionId, kind: op.retirementKind,
        handoff: run.lastHandoff, neededHelp: run.neededHelp, hadWrong: run.hadWrong, outcome: null };
      row.retirement = { runId: immutable.runId, retirementId: actionId, kind: op.retirementKind }; break;
    case 'close_retirement':
      if (capture || run.lifecycle !== 'retiring' || !run.retirement || run.retirement.retirementId !== actionId || !row.retirement || row.retirement.retirementId !== actionId) fail('review_conflict');
      if (run.retirement.kind === 'delete' ? !same(op.outcome.result, { deleted: true }) :
        Object.keys(op.outcome.result).sort().join(',') !== 'id,intervalDays,nextReviewAt,reviewed' || op.outcome.result.id !== immutable.rowKey ||
        run.retirement.kind === 'defer' && op.outcome.result.reviewed !== false) fail();
      settle('retirement'); run.retirement.outcome = op.outcome; run.lifecycle = 'closed'; row.retirement = null; row.pointers = row.pointers.filter(p => p.runId !== immutable.runId); break;
    case 'close_unavailable':
      if (capture || run.action || run.lifecycle !== 'active') fail('review_conflict');
      run.lifecycle = 'closed'; run.phase = 'unavailable'; run.terminal = null; row.pointers = row.pointers.filter(p => p.runId !== immutable.runId); break;
  }
  const captureOps = ['presentation', 'answer', 'observed_hint', 'observed_reveal', 'observed_visibility', 'compatibility_applied', 'retry', 'provenance_loss'];
  if (captureOps.includes(op.kind) !== Boolean(capture) || (capture ? 'capture_v1' : 'metadata_v1') !== payload.kind) fail();
  // Absence and uninstrumented history are always unknown. Never let a prepared
  // checkpoint export caller-asserted false assistance in this B1 slice.
  if (capture) {
    const cp = capture.checkpoint, event = capture.event ? decodeFrozenEvidence(capture.event) : null;
    if (cp.hintUsed === false || cp.answerPreviouslyRevealed === false || (event && (event.hintUsed === false || event.answerPreviouslyRevealed === false))) fail();
    if ((exposure.answer === true || immutable.identity.taskFormat === 'typed_answer' && (exposure.targetText === true || exposure.reading === true)) && (cp.answerPreviouslyRevealed !== true || event && event.answerPreviouslyRevealed !== true)) fail();
  }
  exposure.revision = before.exposure ? bump(before.exposure.revision) : 1; exposure.latestTransitionId = transitionId;
  // Consume the already reserved growth allowance as settlement changes rows.
  // Keep a conservative 32 KiB for each remaining journal (including its key).
  // The only circular term is the decimal byte-count field; iterate to a stable
  // conservative bound, never refund growth or borrow another action's floor.
  if (prior && run.action && (prior.action || op.kind === 'begin_retirement')) {
    const reserved = prior.action ?? { remainingSlots: prior.terminal!.slots, remainingBytes: prior.terminal!.bytes };
    const growthBudget = reserved.remainingBytes - reserved.remainingSlots * REVIEW_LIMITS.journalBytes;
    const previousBytes = reviewUtf8Bytes(prior) + reviewUtf8Bytes(before.exposure) + reviewUtf8Bytes(before.rowFence);
    let allowance = growthBudget;
    for (let i = 0; i < 8; i++) {
      run.action.remainingBytes = run.action.remainingSlots * REVIEW_LIMITS.journalBytes + allowance;
      const growth = Math.max(0, reviewUtf8Bytes(run) + reviewUtf8Bytes(exposure) + reviewUtf8Bytes(row) - previousBytes);
      const next = Math.min(allowance, growthBudget - growth);
      if (next < 0) fail('review_capacity'); if (next === allowance) break; allowance = next;
      if (i === 7) fail('review_capacity');
    }
  }
  parseReviewExposure(exposure); limited(run, REVIEW_LIMITS.runStateBytes); limited(row, REVIEW_LIMITS.rowFenceBytes);
  return { runState: parse(runStateSchema, run), exposure, rowFence: parse(rowFenceStateSchema, row) };
}

function validateSettlementBounds(payload: ReviewJournalPayload, immutable: ReviewRunImmutable): void {
  if (payload.operation.kind === 'acquire') {
    // Bound all future row forms at admission, including the exact current
    // descriptor/source encoding and the largest permitted retirement result.
    const ref: ReviewCaptureRef = { transitionId: payload.transitionId, canonicalSha256: 'f'.repeat(64), sourceSlotKey: immutable.sourceSlotKey,
      checkpointRevision: Number.MAX_SAFE_INTEGER, predecessor: { eventId: payload.transitionId, payloadHash: 'f'.repeat(64), sequence: Number.MAX_SAFE_INTEGER },
      eventId: payload.transitionId, payloadHash: 'f'.repeat(64) };
    const handoff = { transitionId: payload.transitionId, eventId: payload.transitionId, draftToken: immutable.initialDraftToken };
    const worst: ReviewRunState = { ...payload.after.runState, revision: Number.MAX_SAFE_INTEGER, lifecycle: 'retiring', phase: 'feedback_pending', checkpoint: ref, lastHandoff: handoff,
      action: { rootActionId: payload.actionId, kind: 'provenance_loss', remainingSlots: 3, remainingBytes: REVIEW_LIMITS.actionBytes },
      retirement: { retirementId: payload.actionId, kind: 'schedule', handoff, neededHelp: false, hadWrong: false,
        outcome: { operationId: payload.actionId, result: { id: immutable.rowKey, intervalDays: Number.MAX_VALUE, nextReviewAt: '9999-12-31T23:59:59.999Z', reviewed: false } } } };
    limited(worst, REVIEW_LIMITS.runStateBytes);
    if (reviewStoredRowBytes(reviewRunKey(immutable), { version: 1, kind: 'run', ...payload.scope, managedSlot: reviewManagedSlot(immutable), immutable, state: worst }) > REVIEW_LIMITS.runBytes) fail('review_capacity');
  }
}

export async function prepareReviewTransition(input: { fence: LocalFence; transitionId: string; actionId: string; immutable: ReviewRunImmutable;
  before: Immutable<ReviewJournalPayload['before']>; operation: ReviewOperation; capture?: PreparedCapture | null }): Promise<PreparedReviewTransition> {
  const value = structuredClone(input), immutable = parseReviewImmutable(value.immutable), capture = value.capture ?? null;
  if (capture) await verifyPreparedCapture(capture);
  const captureRef = capture ? stateReference(capture, await canonicalSha256(canonicalEvidence(capture))) : null;
  const payloadBase = { version: 1 as const, kind: capture ? 'capture_v1' as const : 'metadata_v1' as const,
    scope: scopeOf(immutable), transitionId: parse(uuid, value.transitionId), actionId: parse(uuid, value.actionId), operation: parse(operationSchema, value.operation),
    runId: immutable.runId, immutableSourceRef: { runKey: reviewRunKey(immutable), immutableSha256: await canonicalSha256(canonicalEvidence(immutable)) },
    before: parse(snapshotSchema, value.before), captureRef };
  const payload = { ...payloadBase, after: plan(payloadBase, immutable, capture) };
  const journal: ReviewJournal = { version: 1, ...payload.scope, kind: payload.kind, canonical: canonicalEvidence(payload) };
  parseReviewJournal(journal);
  validateSettlementBounds(payload, immutable);
  const prepared = immutableCopy({ version: 1 as const, fence: { ownerId: value.fence.ownerId, generationId: value.fence.generationId, ownerEpoch: value.fence.ownerEpoch }, immutable, journal, capture });
  await verifyReviewTransition(prepared); return prepared;
}
export async function verifyReviewTransition(input: PreparedReviewTransition): Promise<ReviewJournalPayload> {
  if (!input || Object.keys(input).sort().join(',') !== 'capture,fence,immutable,journal,version' || input.version !== 1 ||
    !z.object({ ownerId: uuid, generationId: uuid, ownerEpoch: count }).strict().safeParse(input.fence).success) fail();
  const immutable = parseReviewImmutable(input.immutable), { payload } = parseReviewJournal(input.journal);
  if (input.fence.ownerId !== immutable.ownerId || input.fence.generationId !== immutable.generationId ||
    await canonicalSha256(canonicalEvidence(immutable)) !== payload.immutableSourceRef.immutableSha256) fail();
  if (input.capture) {
    await verifyPreparedCapture(input.capture);
    if (!same(input.capture.fence, input.fence) || !same(payload.captureRef, stateReference(input.capture, await canonicalSha256(canonicalEvidence(input.capture))))) fail();
  } else if (payload.captureRef) fail();
  if (!same(payload.after, plan(payload, immutable, input.capture))) fail();
  validateSettlementBounds(payload, immutable); reviewTransitionRows(input); return payload;
}
export function reviewTransitionRows(input: PreparedReviewTransition): ReviewRows {
  const { payload } = parseReviewJournal(input.journal), immutable = parseReviewImmutable(input.immutable);
  return { run: parseReviewRun({ version: 1, kind: 'run', ...payload.scope, managedSlot: reviewManagedSlot(immutable), immutable, state: payload.after.runState }),
    exposure: payload.after.exposure ? parseReviewExposure(payload.after.exposure) : null,
    rowFence: parseReviewRowFence({ version: 1, kind: 'row_fence', ...payload.scope, rowKey: immutable.rowKey, state: payload.after.rowFence }) };
}
export type ReviewAccountingRow = { store: ReviewStoreName; key: IDBValidKey; value: unknown };
/** One pure accounting rule is used for stored cursors and exact candidate admission. */
export function accountReviewRows(rows: readonly ReviewAccountingRow[], ownerId: string): { bytes: number; runs: number; exposures: number; journals: number; fences: number } {
  const totals = { bytes: 0, runs: 0, exposures: 0, journals: 0, fences: 0 }, runRows: ReviewRun[] = [], fences: ReviewRowFence[] = [];
  const seen = new Set<string>();
  for (const entry of rows) {
    const identity = canonicalEvidence([entry.store, entry.key]); if (seen.has(identity)) fail(); seen.add(identity);
    const scope = reviewRowIdentity(entry.store, entry.key, entry.value); if (scope.ownerId !== ownerId) continue;
    totals.bytes += reviewStoredRowBytes(entry.key, entry.value);
    if (entry.store === 'reviewRuns' && (entry.value as ReviewRun).kind === 'run') {
      const row = parseReviewRun(entry.value); runRows.push(row); totals.runs++;
      totals.bytes += (row.state.terminal?.bytes ?? 0) + (row.state.action?.remainingBytes ?? 0);
      totals.journals += (row.state.terminal?.slots ?? 0) + (row.state.action?.remainingSlots ?? 0);
    } else if (entry.store === 'reviewRuns') { totals.fences++; fences.push(parseReviewRowFence(entry.value)); }
    else if (entry.store === 'itemExposures') totals.exposures++;
    else totals.journals++;
    if (totals.bytes > REVIEW_LIMITS.ownerBytes || totals.runs > REVIEW_LIMITS.runs || totals.exposures > REVIEW_LIMITS.exposures || totals.journals > REVIEW_LIMITS.journals) fail('review_capacity');
  }
  if (runRows.some(r => !fences.some(f => same(scopeOf(f), scopeOf(r)) && f.rowKey === r.immutable.rowKey)) || totals.fences > totals.runs || fences.some(f => !runRows.some(r => same(scopeOf(r), scopeOf(f)) && r.immutable.rowKey === f.rowKey) ||
    f.state.pointers.some(p => !runRows.some(r => same(scopeOf(r), scopeOf(f)) && r.immutable.rowKey === f.rowKey && r.immutable.runId === p.runId && r.immutable.slot === p.slot && r.state.lifecycle !== 'closed')))) fail();
  return totals;
}
