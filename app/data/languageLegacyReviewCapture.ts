import { CURRICULUM, type CurriculumLesson, type GeneratedReviewSurface } from '../../data/curriculum.ts';
import { getQuestionChoices, isTypedAnswerCorrect, type LearnerMode } from '../../utils/learningSession.ts';
import type { ReviewObservation } from '../../utils/learningReview.ts';
import { assertLanguageRecordSource, isLanguageRecordContextCurrent, readLanguageRecordSnapshot, type LanguageRecordContext, type LanguageRecordSnapshot } from './languageCloudSync.ts';
import { languageRowOriginal, resolveLanguageRow, type LanguageRowHandle } from './languageRecordIdentity.ts';
import { languageDocument } from './languageRecordDocuments.ts';
import { COURSE_REVIEW_KEY, supportedReviewRow, type ReviewMutationPayload, type ReviewMutationResult } from './languageReviewMutations.ts';
import type { LanguageMutationResult } from './languageRecordMutations.ts';
import { LANGUAGE_LEGACY_EVIDENCE_RELEASE } from './languageLegacyEvidenceRelease.ts';
import { acquireLanguageLegacyEvidenceRepository, type LanguageLegacyEvidenceRepository } from './languageLegacyEvidenceRepository.ts';
import { LEGACY_EVIDENCE_CATALOGUE } from '../../lib/language-legacy-evidence/catalogue.ts';
import { preparePresentation, prepareAnswer, prepareCheckpointTransition } from '../../lib/language-legacy-evidence/capture.ts';
import { prepareReviewTransition, type PreparedReviewTransition, type ReviewOperation, type ReviewRows, type ReviewRunImmutable, type ReviewJournalPayload } from '../../lib/language-legacy-evidence/review-capture.ts';
import { canonicalEvidence, makeSourceSlotKey } from '../../lib/language-legacy-evidence/validation.ts';
import { immutableCopy } from '../../lib/language-legacy-evidence/canonical-hash.ts';
import { freezeBatch } from '../../lib/language-legacy-evidence/outbox.ts';
import type { CaptureCheckpoint, CompatibilityHandoff, Immutable, LocalEvidenceContext, PreparedCapture, FrozenBatch } from '../../lib/language-legacy-evidence/persistence-types.ts';
import type { EvidenceEvent, TextVisibility } from '../../lib/language-legacy-evidence/types.ts';

export const capturedReviewAvailable = (): boolean => LANGUAGE_LEGACY_EVIDENCE_RELEASE.resetProtocol === 'protocol-required' && LANGUAGE_LEGACY_EVIDENCE_RELEASE.enrollmentEnabled && LANGUAGE_LEGACY_EVIDENCE_RELEASE.captureEnabled;
type Source = { context: LanguageRecordContext | null; snapshot: LanguageRecordSnapshot | null };
export type CapturedReviewSurface = Readonly<{ lesson: CurriculumLesson; index: number; mode: LearnerMode; authored: GeneratedReviewSurface; identity: ReviewRunImmutable['identity']; originalSource: ReviewRunImmutable['originalSource'] }>;
/** Registered handles plus exact whole-array/source bytes, never a decoded ID or viewId as authority. */
export function resolveCapturedReviewSurface(handle: LanguageRowHandle, mode: LearnerMode, source: Source): CapturedReviewSurface {
  if (!source.context || !source.snapshot || !isLanguageRecordContextCurrent(source.context)) throw Error('source_changed');
  assertLanguageRecordSource(source.snapshot, source.context);
  const original = languageRowOriginal(handle);
  if (original.key !== COURSE_REVIEW_KEY) throw Error('unsupported_surface');
  resolveLanguageRow(handle, source.context, source.snapshot.records);
  const arrayBytes = original.source.records[COURSE_REVIEW_KEY];
  if (typeof arrayBytes !== 'string') throw Error('source_changed');
  const doc = languageDocument(arrayBytes, 'array'), row = doc.get([original.index]);
  if (!supportedReviewRow(COURSE_REVIEW_KEY, row)) throw Error('unsupported_surface');
  const rowId = doc.get([original.index, 'id']), lessonId = doc.get([original.index, 'lessonId']);
  if (typeof rowId !== 'string' || typeof lessonId !== 'string' || Array.from({ length: doc.length() }, (_, i) => doc.get([i, 'id'])).filter(id => id === rowId).length !== 1) throw Error('source_changed');
  const lesson = CURRICULUM.find(entry => entry.id === lessonId);
  const index = lesson?.quiz.findIndex((_quiz, i) => `${lessonId}:${i}` === rowId) ?? -1;
  const quiz = lesson?.quiz[index], authored = quiz?.generatedReviewSurface;
  if (!lesson || !quiz || !authored || !Object.isFrozen(authored) || !['starter', 'reader'].includes(mode)) throw Error('unsupported_surface');
  const word = lesson.words[authored.wordIndex];
  if (!word || authored.targetText !== word.japanese || authored.reading !== word.reading ||
      quiz.prompt !== authored.question.prompt || quiz.explanation !== authored.question.explanation || quiz.answer !== authored.question.answer || quiz.kind !== authored.question.kind || JSON.stringify(quiz.choices) !== JSON.stringify(authored.question.choices)) throw Error('unsupported_surface');
  const taskFormat = authored.origin === 'generated-word-meaning' ? 'meaning_choice' : authored.origin === 'generated-word-input' && mode === 'reader' ? 'typed_answer' : null;
  if (!taskFormat || taskFormat === 'meaning_choice' && quiz.kind !== undefined || taskFormat === 'typed_answer' && quiz.kind !== 'input') throw Error('unsupported_surface');
  const tasks = LEGACY_EVIDENCE_CATALOGUE.filter(task => task.legacyQuestionId === rowId && task.lessonId === lessonId && task.itemId === quiz.evidenceRef?.itemId && task.taskId === quiz.evidenceRef?.taskId && task.contentRevision === quiz.evidenceRef?.contentRevision);
  const task = tasks.length === 1 ? tasks[0] : null;
  const bindings = task?.bindings.filter(binding => binding.source === 'course_review' && binding.taskFormat === taskFormat);
  if (!task || bindings?.length !== 1) throw Error('unsupported_surface');
  return Object.freeze<CapturedReviewSurface>({ lesson, index, mode, authored, identity: { itemId: task.itemId, contentRevision: task.contentRevision, taskId: task.taskId, lessonId, legacyQuestionId: rowId, taskFormat, gradingVersion: bindings[0].gradingVersion },
    originalSource: { key: COURSE_REVIEW_KEY, arrayBytes, rowBytes: original.raw, rowIndex: original.index } });
}
export type CapturedReviewStatus = 'idle' | 'inactive' | 'starting' | 'question_pending' | 'ready' | 'hint_pending' | 'feedback_pending' | 'answered' | 'retry_pending' | 'retiring' | 'blocked' | 'closed';
export type CapturedReviewFailure = 'unavailable' | 'source_changed' | 'interrupted' | 'shared_exposure' | 'unsupported_value' | 'uncertain_retirement';
export type CapturedReviewView = Readonly<{ status: CapturedReviewStatus; busy: boolean; revision: number; failure: CapturedReviewFailure | null; showQuestion: boolean; showHint: boolean; handoff: Immutable<CompatibilityHandoff> | null; draftToken: string | null; runId: string | null; delivery: 'none' | 'pending' | 'verified' | 'unavailable' }>;
export type CapturedLegacyActions = { submit(payload: ReviewMutationPayload, publish: (result: LanguageMutationResult<ReviewMutationResult>) => void, source: LanguageRecordSnapshot): Promise<boolean>; retry(): Promise<boolean> };
type Retirement = { begin: PreparedReviewTransition | null; kind: 'schedule' | 'defer' | 'delete'; actionId: string; dispatched: boolean; acknowledged: Immutable<{ operationId: string; result: ReviewMutationResult }> | null; closure: PreparedReviewTransition | null };
const same = (a: unknown, b: unknown) => canonicalEvidence(a) === canonicalEvidence(b);
const uuid = () => crypto.randomUUID();
/** The element check is performed before AND after two actual frame boundaries. */
export function isCapturedReviewVisible(element: HTMLElement): boolean {
  const doc = element.ownerDocument, win = doc.defaultView;
  if (!win || doc.visibilityState !== 'visible' || !doc.hasFocus() || !element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = win.getComputedStyle(current);
    if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.left >= 0 && rect.bottom <= win.innerHeight && rect.right <= win.innerWidth;
}

/** One explicit, bounded UI episode. It owns no store constructor or structural authority. */
export class CapturedCourseReviewAdapter {
  readonly surface: CapturedReviewSurface;
  private repository: LanguageLegacyEvidenceRepository | null = null;
  private rows: Immutable<ReviewRows> | null = null;
  private checkpoint: CaptureCheckpoint | null = null;
  private prepared: PreparedReviewTransition | null = null;
  private retirement: Retirement | null = null;
  private unavailableClosure: PreparedReviewTransition | null = null;
  private eventBatch: { transitionId: string; batch: FrozenBatch } | null = null;
  private initialized = false;
  private alive = true;
  private serial = 0;
  private running = false;
  private shown = false;
  private hintShown = false;
  private clock: { started: number; wall: number } | null = null;
  private state: CapturedReviewView = Object.freeze({ status: capturedReviewAvailable() ? 'idle' : 'inactive', busy: false, revision: 0, failure: null, showQuestion: false, showHint: false, handoff: null, draftToken: null, runId: null, delivery: 'none' });
  constructor(private readonly options: { handle: LanguageRowHandle; mode: LearnerMode; source: () => Source; actions: CapturedLegacyActions; changed: (view: CapturedReviewView) => void }) {
    this.surface = resolveCapturedReviewSurface(options.handle, options.mode, options.source());
  }
  view(): CapturedReviewView { return this.state; }
  /** Passive UI work must still belong to this exact live published snapshot. */
  isCurrentView(view: CapturedReviewView): boolean {
    if (view !== this.state || this.running) return false;
    try { this.current(this.serial, !this.retirement?.dispatched); return true; } catch { return false; }
  }
  private publish(patch: Partial<CapturedReviewView> = {}, adoptData = false) {
    if (!this.alive) return;
    this.state = Object.freeze({ ...this.state, ...patch, busy: this.running, revision: this.state.revision + 1, showQuestion: this.shown, showHint: this.hintShown,
      ...(adoptData ? { handoff: this.checkpoint?.handoff ?? null, draftToken: this.rows?.run.state.currentDraftToken ?? null, runId: this.rows?.run.immutable.runId ?? null } : {}) });
    this.options.changed(this.state);
  }
  private current(serial: number, sourceRequired = true) {
    if (!this.alive || serial !== this.serial) throw Error('interrupted');
    const source = this.options.source();
    if (!source.context || !isLanguageRecordContextCurrent(source.context) || source.context.userId !== languageRowOriginal(this.options.handle).source.context.userId) throw Error('source_changed');
    if (sourceRequired) {
      const fresh = readLanguageRecordSnapshot(source.context);
      if (fresh.records[COURSE_REVIEW_KEY] !== this.surface.originalSource.arrayBytes) throw Error('source_changed');
      try { resolveLanguageRow(this.options.handle, source.context, fresh.records); } catch { throw Error('source_changed'); }
    }
    return source.context;
  }
  private async step<T>(serial: number, work: () => Promise<T>, sourceRequired = !this.retirement?.dispatched): Promise<T> {
    this.current(serial, sourceRequired); const result = await work(); this.current(serial, sourceRequired); return result;
  }
  private async run(work: (serial: number) => Promise<void>): Promise<boolean> {
    if (this.running || !this.alive || !capturedReviewAvailable()) return false;
    this.running = true; const serial = this.serial; this.publish({ failure: null });
    try { this.current(serial, !this.retirement?.dispatched); await work(serial); return true; }
    catch (error) {
      if (this.alive) {
        const code = error instanceof Error ? error.message : '';
        const failure: CapturedReviewFailure = this.retirement || code === 'uncertain_retirement' ? 'uncertain_retirement' : code === 'source_changed' ? 'source_changed' : code === 'interrupted' ? 'interrupted' : code === 'shared_exposure' ? 'shared_exposure' : code === 'unsupported_value' ? 'unsupported_value' : 'unavailable';
        this.publish({ status: this.retirement ? 'retiring' : 'blocked', failure });
      }
      return false;
    } finally { this.running = false; this.publish(); }
  }
  private context(): Immutable<LocalEvidenceContext> { if (!this.repository) throw Error('unavailable'); return this.repository.context(); }
  private store() { if (!this.repository) throw Error('unavailable'); return this.repository.store(); }
  private async acquire(serial: number, existing = this.initialized) {
    const context = this.current(serial, !this.retirement?.dispatched);
    let acquired: LanguageLegacyEvidenceRepository | null = null;
    let repository: LanguageLegacyEvidenceRepository;
    try { repository = await this.step(serial, async () => { acquired = await acquireLanguageLegacyEvidenceRepository(context, { studyDayTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone, mode: existing ? 'existing' : 'initialize' }); return acquired; }); }
    catch (error) { (acquired as LanguageLegacyEvidenceRepository | null)?.close(); throw error; }
    if (repository.localContinuity() !== 'verified') { repository.close(); throw Error('unavailable'); }
    this.repository?.close(); this.repository = repository; this.initialized = true;
    return this.step(serial, () => this.store().readReviewScope(this.context()));
  }
  private async refresh(serial: number) {
    if (!this.rows) throw Error('unavailable');
    const immutable = this.rows.run.immutable;
    const selected = await this.step(serial, () => this.store().findReviewRun(this.context(), { scope: immutable, rowKey: immutable.rowKey, slot: immutable.slot, originalSource: immutable.originalSource, mode: immutable.mode }));
    if (!selected || selected.run.immutable.runId !== immutable.runId) throw Error('source_changed');
    this.rows = selected;
    this.checkpoint = await this.step(serial, () => this.store().readCheckpoint(this.context(), immutable.sourceSlotKey));
    if (Boolean(this.checkpoint) !== Boolean(selected.run.state.checkpoint)) throw Error('unavailable');
  }
  private async restoreDelivery(serial: number) {
    if (!this.rows) throw Error('unavailable');
    const pending = await this.step(serial, () => this.store().recoverOutbox(this.context(), 500));
    if (pending.status === 'quarantined') throw Error('unavailable');
    const slot = this.rows.run.immutable.sourceSlotKey;
    const hasPending = pending.events.some(row => row.event.sourceSlotKey === slot) || pending.batches.some(row => row.batch.sourceSlotKey === slot);
    // Local absence cannot establish an independently verified server receipt.
    this.publish({ delivery: hasPending ? 'pending' : this.state.delivery === 'verified' ? 'verified' : 'none' });
  }
  private before(): Immutable<ReviewJournalPayload['before']> {
    if (!this.rows) throw Error('unavailable');
    return { runState: this.rows.run.state, rowFence: this.rows.rowFence.state, exposure: this.rows.exposure };
  }
  private async transition(serial: number, operation: ReviewOperation, actionId: string, capture: PreparedCapture | null = null) {
    if (!this.rows || this.prepared) throw Error('unavailable');
    const prepared = await this.step(serial, () => prepareReviewTransition({ fence: this.context(), immutable: this.rows!.run.immutable,
      transitionId: capture?.transitionId ?? uuid(), actionId, before: this.before(), operation, capture }));
    this.prepared = prepared;
    await this.commit(serial, prepared);
    return prepared;
  }
  private async commit(serial: number, prepared: PreparedReviewTransition) {
    // An older receipt cannot verify this new event while commit/readback is
    // uncertain. Status-only publication must not adopt its draft or handoff.
    if (prepared.capture?.event) this.publish({ delivery: 'unavailable' });
    if (prepared.capture?.event && this.eventBatch?.transitionId !== prepared.capture.transitionId) {
      const batch = await this.step(serial, () => freezeBatch(uuid(), [prepared.capture!.event!], prepared.capture!.expected?.predecessor ?? null));
      this.eventBatch = { transitionId: prepared.capture.transitionId, batch };
    }
    await this.step(serial, () => this.store().commitReviewTransition(prepared, this.context()));
    const read = await this.step(serial, () => this.store().readReviewTransition(prepared, this.context()));
    if (!read || !same(read.run.state, read.transition.after.runState)) throw Error('unavailable');
    const latest = await this.step(serial, () => this.store().readReviewState(this.context(), { ...prepared.immutable, ...prepared.immutable.identity }));
    if (!latest.rowFence || read.run.state.lifecycle !== 'closed' && (!same(latest.rowFence.state, read.transition.after.rowFence) || !same(latest.exposure, read.transition.after.exposure))) throw Error('unavailable');
    this.rows = { run: read.run, rowFence: latest.rowFence, exposure: latest.exposure };
    if (prepared.capture) this.checkpoint = structuredClone(prepared.capture.checkpoint);
    if (prepared.capture?.event) {
      // The event is proven durable even if the separate batch write now fails.
      this.publish({ delivery: 'pending' });
      const batch = this.eventBatch!.batch;
      await this.step(serial, () => this.store().putBatch(this.context(), batch));
      const saved = await this.step(serial, () => this.store().readBatch(this.context(), batch.batchId));
      if (!saved || !same(saved.batch, batch)) throw Error('unavailable');
      this.eventBatch = null; this.publish({ delivery: 'pending' }, true);
    }
    this.prepared = null;
  }
  private adoptPhase() {
    const run = this.rows!.run;
    if (run.state.lifecycle === 'closed') { this.shown = false; this.publish({ status: 'closed' }, true); return; }
    if (run.state.lifecycle !== 'active') throw Error('uncertain_retirement');
    if (run.state.phase === 'unpresented') { this.shown = true; this.publish({ status: 'question_pending' }, true); }
    else if (run.state.phase === 'answered' && run.state.action?.kind === 'retry') { this.shown = true; this.publish({ status: 'retry_pending' }, true); }
    else if (run.state.phase === 'feedback_pending' || run.state.phase === 'answered') { this.shown = true; this.publish({ status: run.state.phase }, true); }
    else if (run.state.phase === 'answerable' && !run.state.action) { this.shown = true; this.publish({ status: 'ready' }, true); }
    else this.publish({ status: 'blocked', failure: 'interrupted' });
  }
  start(): Promise<boolean> { return this.run(serial => this.begin(serial)); }
  private async begin(serial: number): Promise<void> {
      if (this.rows || this.prepared || this.retirement) throw Error('unavailable');
      this.publish({ status: 'starting' }); const scope = await this.acquire(serial);
      const slot = JSON.stringify([this.surface.identity.taskId, this.surface.identity.contentRevision, this.surface.identity.taskFormat]);
      const state = await this.step(serial, () => this.store().readReviewState(this.context(), { ...scope, rowKey: this.surface.identity.legacyQuestionId, ...this.surface.identity }));
      if (state.rowFence?.state.retirement) throw Error('uncertain_retirement');
      const query = { scope, rowKey: this.surface.identity.legacyQuestionId, slot, originalSource: this.surface.originalSource, mode: this.surface.mode };
      const prior = await this.step(serial, () => this.store().findReviewRun(this.context(), query));
      if (prior) { this.rows = prior; await this.refresh(serial); await this.restoreDelivery(serial); this.adoptPhase(); return; }
      const episodeId = uuid(), immutable: ReviewRunImmutable = { ...scope, runId: uuid(), episodeId, rowKey: query.rowKey, slot,
        sourceSlotKey: makeSourceSlotKey(scope.ownerId, { ...this.surface.identity, generationId: scope.generationId, episodeId, source: 'course_review' }), identity: this.surface.identity,
        mode: this.surface.mode, initialDraftToken: uuid(), originalSource: this.surface.originalSource };
      const prepared = await this.step(serial, () => prepareReviewTransition({ fence: this.context(), immutable, transitionId: uuid(), actionId: uuid(),
        before: { runState: null, exposure: state.exposure, rowFence: state.rowFence?.state ?? null }, operation: { kind: 'acquire', observationId: uuid() } }));
      this.prepared = prepared;
      this.rows = await this.step(serial, () => this.store().findOrAcquireReviewRun(prepared, this.context()));
      this.prepared = null; await this.refresh(serial); await this.restoreDelivery(serial); this.adoptPhase();
  }
  private pending(surface: 'question' | 'hint' | 'feedback') {
    const row = this.rows?.exposure?.pending.find(intent => intent.runId === this.rows!.run.immutable.runId && intent.surface === surface);
    if (!row || row.actionId !== this.rows?.run.state.action?.rootActionId) throw Error('unavailable');
    return row;
  }
  private visibility(surface: 'question' | 'hint' | 'feedback'): TextVisibility {
    return surface === 'question' ? { targetText: this.surface.identity.taskFormat === 'meaning_choice', reading: this.surface.identity.taskFormat === 'meaning_choice', meaning: true, choices: this.surface.identity.taskFormat === 'meaning_choice' } : { targetText: true, reading: true, meaning: true, choices: this.surface.identity.taskFormat === 'meaning_choice' };
  }
  observe(surface: 'question' | 'hint' | 'feedback', element: HTMLElement): Promise<boolean> {
    return this.run(async serial => {
      if (this.prepared || !this.rows) throw Error('interrupted');
      const expected = { runId: this.rows.run.immutable.runId, draftToken: this.rows.run.state.currentDraftToken,
        actionId: this.pending(surface).actionId, observationId: this.pending(surface).observationId,
        eventId: surface === 'feedback' ? this.checkpoint?.handoff?.eventId : undefined };
      const visible = () => {
        this.current(serial);
        if (element.dataset.reviewRun !== expected.runId || element.dataset.reviewSurface !== surface || element.dataset.reviewDraft !== expected.draftToken ||
          surface === 'feedback' && element.dataset.reviewEvent !== expected.eventId || !isCapturedReviewVisible(element)) throw Error('interrupted');
      };
      visible();
      await this.step(serial, () => new Promise<void>(resolve => element.ownerDocument.defaultView!.requestAnimationFrame(() => resolve()))); visible();
      await this.step(serial, () => new Promise<void>(resolve => element.ownerDocument.defaultView!.requestAnimationFrame(() => resolve()))); visible();
      await this.refresh(serial); visible();
      const intent = this.pending(surface), context = this.context(), visibility = this.visibility(surface);
      if (this.rows!.run.state.currentDraftToken !== expected.draftToken || intent.actionId !== expected.actionId || intent.observationId !== expected.observationId || surface === 'feedback' && this.checkpoint?.handoff?.eventId !== expected.eventId) throw Error('interrupted');
      const observed = { observationId: intent.observationId, actualVisible: true as const, targetText: visibility.targetText === true, reading: visibility.reading === true, answer: surface !== 'question' };
      if (surface === 'question') {
        const immutable = this.rows!.run.immutable, exposure = this.rows!.exposure;
        const revealed = exposure?.answer === true || immutable.identity.taskFormat === 'typed_answer' && (exposure?.targetText === true || exposure?.reading === true);
        const event: EvidenceEvent = { schemaVersion: 1, eventId: uuid(), generationId: immutable.generationId, episodeId: immutable.episodeId, sourceSlotKey: immutable.sourceSlotKey,
          sequence: 0, source: 'course_review', ...immutable.identity, occurredAt: context.now, recordTimezone: context.studyDayTimezone,
          hintUsed: null, answerPreviouslyRevealed: revealed ? true : null, isRetry: false, responseMs: null, timingComplete: false,
          audio: { status: 'not_requested', promptMatchesTask: null }, textVisibility: visibility, kind: 'exercise_presented', correct: null };
        const capture = await this.step(serial, () => preparePresentation({ transitionId: uuid(), event, actualVisible: true, history: 'old_unattempted', timingObserved: true }, context, LEGACY_EVIDENCE_CATALOGUE)); visible();
        await this.transition(serial, { kind: 'presentation', observed }, intent.actionId, capture); visible();
        this.clock = { started: performance.now(), wall: Date.parse(context.now) }; this.publish({ status: 'ready' }, true);
      } else if (surface === 'hint') {
        if (!this.checkpoint) throw Error('unavailable');
        const capture = prepareCheckpointTransition(this.checkpoint, { kind: 'hint' }, context, uuid());
        await this.transition(serial, { kind: 'observed_hint', observed }, intent.actionId, capture); visible(); this.publish({ status: 'ready' }, true);
      } else {
        await this.transition(serial, { kind: 'observe_feedback', observed }, intent.actionId); visible(); this.adoptPhase();
      }
    });
  }
  hint(): Promise<boolean> { return this.run(async serial => {
    if (this.state.status !== 'ready' || this.prepared) throw Error('unavailable');
    const draftToken = this.state.draftToken; await this.refresh(serial);
    if (this.rows!.run.state.currentDraftToken !== draftToken) throw Error('source_changed');
    await this.transition(serial, { kind: 'begin_reveal', surface: 'hint', observationId: uuid() }, uuid());
    this.hintShown = true; this.publish({ status: 'hint_pending' }, true);
  }); }
  answer(value: string, observation: ReviewObservation): Promise<boolean> { return this.run(async serial => {
    if (this.state.status !== 'ready' || this.prepared || !value.trim()) throw Error('unavailable');
    const frozen = immutableCopy({ value, observation }), draftToken = this.state.draftToken;
    if (value.length > 4096 || observation.responseMs !== undefined && (!Number.isFinite(observation.responseMs) || observation.responseMs < 0 || observation.responseMs > 600000)) throw Error('unsupported_value');
    await this.refresh(serial); const cp = this.checkpoint, rows = this.rows!;
    if (!cp || rows.exposure?.pending.length) throw Error('unavailable');
    if (rows.run.state.currentDraftToken !== draftToken) throw Error('source_changed');
    if (cp.answerPreviouslyRevealed !== true && (rows.exposure?.answer === true || this.surface.identity.taskFormat === 'typed_answer' && (rows.exposure?.targetText === true || rows.exposure?.reading === true))) throw Error('shared_exposure');
    const correct = this.surface.identity.taskFormat === 'typed_answer' ? isTypedAnswerCorrect(this.surface.lesson, this.surface.index, value) : getQuestionChoices(this.surface.lesson, this.surface.index, this.surface.mode).find(choice => choice.label === value)?.correct;
    if (correct === undefined) throw Error('unsupported_value');
    const context = this.context(), elapsed = this.clock ? Math.floor(performance.now() - this.clock.started) : null, wall = Date.parse(context.now) - Date.parse(cp.attemptStartedAt);
    const responseMs = elapsed !== null && elapsed >= 0 && elapsed <= 600000 && elapsed <= wall && this.clock!.wall <= Date.parse(context.now) ? elapsed : null;
    const capture = await this.step(serial, () => prepareAnswer(cp, { transitionId: uuid(), eventId: uuid(), occurredAt: context.now, recordTimezone: context.studyDayTimezone,
      correct, responseMs, handoff: { draftToken: rows.run.state.currentDraftToken, answer: frozen.value, observation: frozen.observation } }, context, LEGACY_EVIDENCE_CATALOGUE));
    await this.transition(serial, { kind: 'answer', observationId: uuid() }, uuid(), capture);
    this.publish({ status: 'feedback_pending' }, true);
  }); }
  /** Called from the committed React effect with the exact rendered local draft. */
  published(input: { runId: string; draftToken: string; eventId: string; answer: string; correct: boolean; observation: ReviewObservation }): Promise<boolean> { return this.run(async serial => {
    await this.refresh(serial); const handoff = this.checkpoint?.handoff;
    if (!handoff || this.rows!.run.immutable.runId !== input.runId || this.rows!.run.state.currentDraftToken !== input.draftToken || handoff.draftToken !== input.draftToken || handoff.eventId !== input.eventId || handoff.answer !== input.answer || handoff.correct !== input.correct || !same(handoff.observation, input.observation)) throw Error('source_changed');
    if (this.rows!.run.state.compatibilityApplied && handoff.status === 'applied') return;
    const actionId = this.rows!.run.state.action?.rootActionId; if (!actionId) throw Error('unavailable');
    const capture = prepareCheckpointTransition(this.checkpoint!, { kind: 'compatibility_applied', eventId: input.eventId, survivingDraftToken: input.draftToken }, this.context(), uuid());
    await this.transition(serial, { kind: 'compatibility_applied' }, actionId, capture); this.adoptPhase();
  }); }
  retryAnswer(): Promise<boolean> { return this.run(async serial => {
    if (this.state.status !== 'answered' || this.prepared) throw Error('unavailable');
    const draftToken = this.state.draftToken, eventId = this.state.handoff?.eventId; await this.refresh(serial);
    if (this.rows!.run.state.currentDraftToken !== draftToken || this.checkpoint?.handoff?.eventId !== eventId) throw Error('source_changed');
    const capture = prepareCheckpointTransition(this.checkpoint!, { kind: 'retry', occurredAt: this.context().now }, this.context(), uuid());
    await this.transition(serial, { kind: 'retry', draftToken: uuid() }, uuid(), capture); this.publish({ status: 'retry_pending' }, true);
  }); }
  cleared(input: { runId: string; draftToken: string; answer: string; hintShown: false; feedbackShown: false }): Promise<boolean> { return this.run(async serial => {
    await this.refresh(serial);
    if (this.rows!.run.immutable.runId !== input.runId || this.rows!.run.state.currentDraftToken !== input.draftToken || input.answer !== '' || input.hintShown !== false || input.feedbackShown !== false || this.rows!.run.state.action?.kind !== 'retry') throw Error('source_changed');
    await this.transition(serial, { kind: 'ack_retry' }, this.rows!.run.state.action.rootActionId);
    this.hintShown = false; this.clock = { started: performance.now(), wall: Date.now() }; this.publish({ status: 'ready' }, true);
  }); }
  retire(kind: Retirement['kind'], deleteConfirmed = false): Promise<boolean> { return this.run(async serial => {
    if (this.retirement || this.prepared || kind === 'delete' && !deleteConfirmed) throw Error('unavailable');
    const draftToken = this.state.draftToken, eventId = this.state.handoff?.eventId;
    await this.refresh(serial);
    if (this.rows!.run.state.currentDraftToken !== draftToken || this.checkpoint?.handoff?.eventId !== eventId) throw Error('source_changed');
    if (kind === 'schedule' && (this.rows!.run.state.phase !== 'answered' || this.checkpoint?.handoff?.correct !== true)) throw Error('unavailable');
    const actionId = uuid();
    const attempt: Retirement = { begin: null, kind, actionId, acknowledged: null, closure: null, dispatched: false };
    this.retirement = attempt; this.publish({ status: 'retiring' });
    attempt.begin = await this.transition(serial, { kind: 'begin_retirement', retirementKind: kind }, actionId);
    await this.dispatchRetirement(serial, false);
  }); }
  private async dispatchRetirement(serial: number, retry: boolean) {
    const attempt = this.retirement!;
    if (!attempt.begin) {
      if (!this.prepared || JSON.parse(this.prepared.journal.canonical).operation.kind !== 'begin_retirement') throw Error('uncertain_retirement');
      attempt.begin = this.prepared;
      await this.acquire(serial, true); await this.commit(serial, attempt.begin);
    }
    if (attempt.acknowledged) { await this.closeRetirement(serial); return; }
    let success: boolean;
    if (retry) success = await this.step(serial, () => this.options.actions.retry(), false);
    else {
      this.current(serial); const state = this.rows!.run.state, handoff = this.checkpoint?.handoff;
      // Deliberate prospective omission only. Old frozen operations stay untouched.
      const payload: ReviewMutationPayload = attempt.kind === 'delete' ? { kind: 'delete-group', key: COURSE_REVIEW_KEY, handle: this.options.handle } :
        { kind: 'schedule', handle: this.options.handle, correct: attempt.kind === 'schedule', neededHelp: attempt.kind === 'defer' ? true : state.neededHelp, hadWrong: state.hadWrong, ...(handoff ? { observation: handoff.observation } : {}) };
      attempt.dispatched = true;
      success = await this.step(serial, () => this.options.actions.submit(payload, result => {
        if (!this.alive || this.retirement !== attempt || !result.acknowledged || attempt.acknowledged) return;
        // No publication, advance, clearing or asynchronous work in this callback.
        attempt.acknowledged = immutableCopy({ operationId: result.operationId, result: result.result });
      }, languageRowOriginal(this.options.handle).source), false);
    }
    if (!success || !attempt.acknowledged || this.retirement !== attempt) throw Error('uncertain_retirement');
    await this.closeRetirement(serial);
  }
  private async closeRetirement(serial: number) {
    const attempt = this.retirement!; if (!attempt.acknowledged || !this.rows) throw Error('uncertain_retirement');
    await this.acquire(serial, true);
    const scope = await this.step(serial, () => this.store().readReviewScope(this.context()), false);
    if (scope.ownerId !== this.rows.run.immutable.ownerId || scope.generationId !== this.rows.run.immutable.generationId || scope.incarnationId !== this.rows.run.immutable.incarnationId) throw Error('source_changed');
    if (!attempt.closure) {
      const retiring = await this.step(serial, () => this.store().readReviewTransition(attempt.begin!, this.context()), false);
      const state = await this.step(serial, () => this.store().readReviewState(this.context(), { ...this.rows!.run.immutable, ...this.surface.identity }), false);
      if (!retiring || !state.rowFence || retiring.run.state.lifecycle !== 'retiring' || retiring.run.state.retirement?.retirementId !== attempt.actionId) throw Error('uncertain_retirement');
      this.rows = { run: retiring.run, rowFence: state.rowFence, exposure: state.exposure };
      attempt.closure = await this.step(serial, () => prepareReviewTransition({ fence: this.context(), immutable: this.rows!.run.immutable,
        transitionId: uuid(), actionId: attempt.actionId, before: this.before(), operation: { kind: 'close_retirement', outcome: attempt.acknowledged! } }), false);
    }
    this.prepared = attempt.closure; await this.commit(serial, attempt.closure);
    this.shown = false; this.publish({ status: 'closed', failure: null }, true);
  }
  /** Explicit read-first recovery. No timer, mount or focus handler calls this. */
  recover(): Promise<boolean> { return this.run(async serial => {
    if (this.retirement) { await this.dispatchRetirement(serial, this.retirement.dispatched); return; }
    if (this.unavailableClosure) {
      await this.acquire(serial, true);
      const closure = this.unavailableClosure;
      const read = await this.step(serial, () => this.store().readReviewTransition(closure, this.context()));
      if (!read || read.transition.operation.kind !== 'close_unavailable' || read.run.state.lifecycle !== 'closed' ||
          !same(read.run.immutable, closure.immutable) || !same(read.run.state, read.transition.after.runState)) throw Error('unavailable');
      const state = await this.step(serial, () => this.store().readReviewState(this.context(), { ...closure.immutable, ...closure.immutable.identity }));
      if (!state.rowFence) throw Error('unavailable');
      this.rows = { run: read.run, rowFence: state.rowFence, exposure: state.exposure };
      this.prepared = null; this.shown = false; this.publish({ status: 'closed', failure: null }, true); return;
    }
    if (!this.rows && !this.prepared) { await this.begin(serial); return; }
    const retainedDraft = this.state.draftToken, retainedEvent = this.state.handoff?.eventId ?? null, hadPrepared = Boolean(this.prepared);
    await this.acquire(serial);
    if (this.prepared) {
      const pending = this.prepared, read = await this.step(serial, () => this.store().readReviewTransition(pending, this.context()));
      if (read && !same(read.run.state, read.transition.after.runState)) throw Error('source_changed');
      if (!read) {
        const operation = JSON.parse(pending.journal.canonical).operation as ReviewOperation;
        if (operation.kind === 'acquire') {
          this.rows = await this.step(serial, () => this.store().findOrAcquireReviewRun(pending, this.context()));
          this.prepared = null;
        } else if (operation.kind === 'answer') await this.commit(serial, pending);
        else throw Error('interrupted'); // No fabricated observation after interruption.
      } else if (pending.capture?.event) await this.commit(serial, pending);
      else this.prepared = null;
      const state = await this.step(serial, () => this.store().readReviewState(this.context(), { ...pending.immutable, ...pending.immutable.identity }));
      if (!state.rowFence) throw Error('unavailable'); if (read) this.rows = { run: read.run, rowFence: state.rowFence, exposure: state.exposure };
    }
    if (!this.rows) throw Error('unavailable'); await this.refresh(serial);
    if (!hadPrepared && retainedDraft && (this.rows.run.state.currentDraftToken !== retainedDraft || (this.checkpoint?.handoff?.eventId ?? null) !== retainedEvent)) throw Error('source_changed');
    await this.restoreDelivery(serial); this.clock = null; this.adoptPhase();
  }); }
  /** Explicit mode exit after authoritative readback; never an uncertain retirement escape. */
  closeUnavailable(confirmed: boolean): Promise<boolean> { return this.run(async serial => {
    if (!confirmed || this.retirement || this.unavailableClosure || this.state.status !== 'blocked') throw Error('unavailable');
    await this.acquire(serial);
    if (this.prepared) {
      const candidate = this.prepared;
      const read = await this.step(serial, () => this.store().readReviewTransition(candidate, this.context()));
      if (read) {
        const state = await this.step(serial, () => this.store().readReviewState(this.context(), { ...candidate.immutable, ...candidate.immutable.identity }));
        if (!state.rowFence) throw Error('unavailable'); this.rows = { run: read.run, rowFence: state.rowFence, exposure: state.exposure };
      }
      // The exact absent candidate is retired, never edited or re-used with new facts.
      this.prepared = null; this.eventBatch = null;
    }
    if (!this.rows) throw Error('unavailable');
    await this.refresh(serial);
    const action = this.rows.run.state.action;
    if (action) {
      if (!['presentation', 'hint'].includes(action.kind)) throw Error('unavailable');
      await this.transition(serial, { kind: 'cancel_reveal' }, action.rootActionId);
    }
    if (this.rows.run.state.action || this.rows.rowFence.state.retirement) throw Error('uncertain_retirement');
    const closure = await this.step(serial, () => prepareReviewTransition({ fence: this.context(), immutable: this.rows!.run.immutable,
      transitionId: uuid(), actionId: uuid(), before: this.before(), operation: { kind: 'close_unavailable' } }));
    // Preserve terminal identity even if commit/readback or React completion is
    // interrupted. The active-run pointer is intentionally removed by closure.
    this.unavailableClosure = closure; this.prepared = closure;
    await this.commit(serial, closure);
    this.shown = false; this.publish({ status: 'closed', failure: null }, true);
  }); }
  deliver(): Promise<boolean> { return this.run(async serial => {
    if (!this.rows || this.prepared || this.retirement) throw Error('unavailable');
    const pending = await this.step(serial, () => this.store().recoverOutbox(this.context(), 500));
    const slot = this.rows.run.immutable.sourceSlotKey;
    if (pending.status === 'quarantined') throw Error('unavailable');
    const batches = pending.batches.filter(row => row.batch.sourceSlotKey === slot);
    const events = pending.events.filter(row => row.event.sourceSlotKey === slot);
    // A crash can commit seq0 but lose its batch, then persist a seq1 batch.
    // Merge both kinds before dispatch so the durable successor never overtakes it.
    const work = [
      ...batches.map(row => ({ sequence: row.batch.events[0].sequence, batch: row.batch, event: null })),
      ...events.filter(row => !batches.some(batch => batch.batch.events.some(event => event.eventId === row.event.eventId)))
        .map(row => ({ sequence: row.event.sequence, batch: null, event: row.event })),
    ].sort((left, right) => left.sequence - right.sequence);
    if (work.length) this.publish({ delivery: 'pending' });
    let prefix: Awaited<ReturnType<LanguageLegacyEvidenceRepository['readPrefix']>> | null = null;
    for (const item of work) {
      let batch = item.batch;
      if (item.event) {
        const event = item.event;
        let previous = events.find(row => row.event.sequence === event.sequence - 1)?.event ?? null;
        if (!previous && event.sequence === 1 && this.checkpoint) previous = await this.step(serial, () => this.store().readEvent(this.context(), this.checkpoint!.presentation.eventId));
        if (!previous && event.sequence > 0) {
          prefix ??= await this.step(serial, () => this.repository!.readPrefix({ maxEvents: 500, maxPayloadBytes: 512 * 1024 }));
          if (prefix.status !== 'complete_authenticated_prefix') throw Error('unavailable');
          const receipt = prefix.snapshot.records.find(row => row.event.sourceSlotKey === slot && row.event.sequence === event.sequence - 1);
          if (!receipt) throw Error('unavailable');
          previous = await this.step(serial, () => this.store().readEvent(this.context(), receipt.event.eventId));
          if (!previous || previous.payloadHash !== receipt.payloadHash) throw Error('unavailable');
        }
        if (event.sequence > 0 && (!previous || previous.sourceSlotKey !== slot || previous.sequence !== event.sequence - 1)) throw Error('unavailable');
        batch = await this.step(serial, () => freezeBatch(uuid(), [event], previous ? { eventId: previous.eventId, payloadHash: previous.payloadHash, sequence: previous.sequence } : null));
      }
      if (!batch) throw Error('unavailable');
      const delivered = await this.step(serial, () => this.repository!.deliverBatch(batch));
      // An append attempt or incomplete readback cannot authorize its successor.
      if (delivered.status !== 'acknowledged') throw Error('unavailable');
    }
    const after = await this.step(serial, () => this.store().recoverOutbox(this.context(), 500));
    if (after.status === 'quarantined') throw Error('unavailable');
    const hasPending = after.events.some(row => row.event.sourceSlotKey === slot) || after.batches.some(row => row.batch.sourceSlotKey === slot);
    this.publish({ delivery: hasPending ? 'pending' : work.length ? 'verified' : this.state.delivery });
  }); }
  suspend() { this.serial++; this.clock = null; this.publish({ status: this.retirement ? 'retiring' : 'blocked', failure: 'interrupted' }); }
  dispose() { this.alive = false; this.serial++; this.repository?.close(); this.clock = null; }
}
