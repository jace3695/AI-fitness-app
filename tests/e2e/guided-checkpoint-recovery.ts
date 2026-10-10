import { expect, type Page } from '@playwright/test';
import { appliedSession, cancelledSession, exact, getConversationProgress, sourceRef, validateEnvelope, type ConversationDraft, type ConversationEnvelope } from '../../lib/conversation-session/contracts.ts';
import { logGuidedBoundary, logGuidedCheckpointRefusal, readGuidedDiagnostic, sanitizeGuidedDiagnostic, type GuidedCheckpointReason } from './guided-conversation-diagnostics.ts';

type Diagnostic = Awaited<ReturnType<typeof readGuidedDiagnostic>>;
export type GuidedCheckpoint = {
  kind: 'draft' | 'append' | 'close'; before: ConversationEnvelope;
  input?: string; origin?: ConversationDraft['origin']; stepIndex: number;
};
type Result = 'refused' | 'draft-applied' | 'append-applied' | 'close-applied' | 'close-pending';

/** Exact transition proof only. No storage, UI action, authority creation or
 * attempted replay is available to this classifier. */
function checkpointProof(state: Diagnostic, after: ConversationEnvelope, initial: ConversationEnvelope, checkpoint: GuidedCheckpoint, editorInput?: string): { result: Result; reason?: GuidedCheckpointReason } {
  const refuse = (reason: GuidedCheckpointReason) => ({ result: 'refused' as const, reason });
  const accept = (result: Result) => ({ result });
  const before = checkpoint.before;
  if ([initial, before, after].some(envelope => validateEnvelope(envelope).status !== 'valid')) return refuse('invalid-envelope');
  const old = before.sessions[0], current = after.sessions[0], first = initial.sessions[0];
  if (!old || !current || !first || before.sessions.length !== 1 || after.sessions.length !== 1 || initial.sessions.length !== 1
    || before.schemaVersion !== 2 || after.schemaVersion !== 2 || before.ownerId !== initial.ownerId || after.ownerId !== initial.ownerId
    || before.generationId !== initial.generationId || after.generationId !== initial.generationId
    || before.marker !== initial.marker || after.marker !== initial.marker || old.sessionId !== first.sessionId || current.sessionId !== first.sessionId
    || !exact(old.source, first.source) || !exact(current.source, first.source)
    || !exact({ ...initial, sessions: before.sessions }, before) || !exact({ ...before, sessions: after.sessions }, after)) return refuse('changed-scope');
  if (state.available !== true || state.contextCurrent !== true || state.busy !== false || state.errorCode !== 'none'
    || !['saved', 'uncertain'].includes(String(state.status)) || old.closed !== null) return refuse('authority-or-status');
  const progress = getConversationProgress(current), previousProgress = getConversationProgress(old);
  if (!previousProgress || previousProgress.kind !== 'guided'
    || (checkpoint.kind === 'close' ? previousProgress.coverage !== 'all-steps-submitted' || checkpoint.stepIndex !== previousProgress.totalStepCount - 1 : checkpoint.stepIndex !== previousProgress.activeStepIndex)) return refuse('wrong-step');
  if (!progress || state.totalSteps !== progress.totalStepCount || state.submittedSteps !== progress.submittedStepCount
    || state.stepIndex !== (progress.activeStepIndex ?? null) || state.turnCount !== current.turns.length
    || state.draftCount !== current.drafts.length || state.closedBoundary !== Boolean(current.closed)
    || state.editorPresent !== (progress.activeStepIndex !== null) || state.editorOnActiveStep !== (progress.activeStepIndex !== null)) return refuse('progress-or-editor');
  const uncertain = state.status === 'uncertain';
  if (state.pendingKind !== (uncertain ? checkpoint.kind : 'none')) return refuse('pending-kind');
  if (checkpoint.kind === 'draft') {
    const draft = current.drafts[0];
    if (!draft || old.drafts.length !== 0 || current.drafts.length !== 1 || state.editorPresent !== true || state.editorOnActiveStep !== true
      || state.editorDirty !== uncertain || state.stepIndex !== checkpoint.stepIndex || state.submittedSteps !== old.turns.length
      || editorInput !== checkpoint.input || draft.input !== checkpoint.input || !exact(draft.origin, checkpoint.origin) || !exact(draft.exposure, state.exposure)
      || !('steps' in old.source.content) || !old.source.content.steps[checkpoint.stepIndex]
      || !exact(draft.source, sourceRef(old.source, old.source.content.steps[checkpoint.stepIndex].id)) || draft.revision !== 1
      || !exact({ ...old, stateRevision: old.stateRevision + 1, drafts: current.drafts }, current)) return refuse('draft-transition');
    return accept('draft-applied');
  }
  if (state.editorDirty !== false || state.commandKind !== checkpoint.kind
    || uncertain && state.commandBoundary !== (checkpoint.kind === 'close' && current.closed === null ? 'captured' : 'staged')) return refuse('command-boundary');
  const operation = current.operations.at(-1), command = operation?.command;
  if (!operation || !command || command.kind !== checkpoint.kind || current.operations.length !== old.operations.length + 1
    || !exact(current.operations.slice(0, -1), old.operations) || old.operations.some(op => op.terminal === null)
    || command.ownerId !== initial.ownerId || command.generationId !== initial.generationId || command.sessionId !== old.sessionId
    || command.expectedHeadRevision !== old.headRevision) return refuse('operation-identity');
  if (command.kind === 'append') {
    if (old.drafts.length !== 1 || !exact(command.turn.draft, old.drafts[0]) || command.turn.sequence !== old.turns.length + 1
      || command.turn.predecessorTurnId !== (old.turns.at(-1)?.turnId ?? null)) return refuse('command-payload');
  } else if (!exact(command.boundary.turnRefs, old.turns.map(turn => ({ turnId: turn.turnId, turnRevision: turn.turnRevision })))
    || old.drafts.length !== 0 || state.editorPresent !== false) return refuse('command-payload');
  const staged = { ...old, stateRevision: old.stateRevision + 1, operations: [...old.operations, { command, terminal: null }] };
  if (operation.terminal === null) return command.kind === 'close' && uncertain && exact(staged, current) ? accept('close-pending') : refuse('unresolved-operation');
  if (operation.terminal.kind !== 'applied' || !exact(appliedSession(staged, command), current)) return refuse('terminal-transition');
  return accept(command.kind === 'append' ? 'append-applied' : 'close-applied');
}

export function classifyGuidedCheckpoint(state: Diagnostic, after: ConversationEnvelope, initial: ConversationEnvelope, checkpoint: GuidedCheckpoint, editorInput?: string): Result {
  return checkpointProof(state, after, initial, checkpoint, editorInput).result;
}

/** One synchronous browser task reads the rendered facts and their partition.
 * No await, storage write, lock acquisition, or authority creation occurs here. */
export async function readGuidedCheckpoint(page: Page, partitionKey: string) {
  const captured = await page.evaluate(key => {
    const elements = document.querySelectorAll('[data-conversation-diagnostic]');
    let diagnostic: unknown = null;
    if (elements.length === 1) { try { diagnostic = JSON.parse(elements[0].getAttribute('data-conversation-diagnostic') ?? 'null'); } catch { /* Missing evidence. */ } }
    const input = document.getElementById('conversation-input');
    return { diagnostic, raw: localStorage.getItem(key), editorInput: input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement ? input.value : undefined };
  }, partitionKey);
  return { state: { surface: captured.diagnostic ? 'present' : 'missing', ...sanitizeGuidedDiagnostic(captured.diagnostic) }, raw: captured.raw, editorInput: captured.editorInput };
}

/** One readback per original action. A genuinely staged close additionally
 * allows one explicit abandonment and one deliberate new close; it never
 * reuses the old intent or repeats a replacement that becomes uncertain. */
export async function confirmGuidedCheckpoint(page: Page, partitionKey: string, initial: ConversationEnvelope, checkpoint: GuidedCheckpoint, level: 'beginner' | 'elementary' | 'intermediate') {
  const status = page.locator('[data-save-status]');
  let lastState: Diagnostic | undefined;
  const capture = async () => { const value = await readGuidedCheckpoint(page, partitionKey); lastState = value.state; return value; };
  const inspect = async () => {
    const captured = await capture();
    const envelope = captured.raw ? JSON.parse(captured.raw) as ConversationEnvelope : null;
    return { ...captured, envelope, ...(envelope ? checkpointProof(captured.state, envelope, initial, checkpoint, captured.editorInput) : { result: 'refused' as const, reason: 'missing-storage' as const }) };
  };
  let last: Awaited<ReturnType<typeof inspect>> | undefined;
  let refusal: GuidedCheckpointReason | undefined;
  try {
    // The accepted no-action sample is a point-in-time proof. Do not invalidate
    // it by building a second mixed sample across several browser round trips.
    let accepted: Awaited<ReturnType<typeof inspect>> | undefined;
    await expect.poll(async () => { last = await inspect(); if (last.result !== 'refused') accepted = last; return last.result; }).not.toBe('refused');
    const observed = accepted!;
    if (checkpoint.kind === 'draft') expect(observed.editorInput).toBe(checkpoint.input);
    if (observed.state.status === 'saved') return;
    await logGuidedBoundary(page, level, checkpoint.stepIndex, 'before-recovery');
    const recover = page.getByRole('button', { name: '저장 다시 확인', exact: true });
    await expect(recover).toBeVisible(); await expect(recover).toBeEnabled();
    // A retained proof never authorizes a later action. Require the same exact
    // coherent candidate under current authority immediately before readback.
    last = await inspect(); refusal = 'changed-after-observation';
    expect(last.result).toBe(observed.result); expect(last.raw).toBe(observed.raw);
    expect(last.editorInput).toBe(observed.editorInput); expect(last.state).toEqual(observed.state);
    await recover.click();
    if (observed.result !== 'close-pending') {
      await expect.poll(async () => {
        last = await inspect();
        return last.state.status === 'saved' && last.raw === observed.raw && last.result === observed.result ? last.result : 'refused';
      }).not.toBe('refused');
      await logGuidedBoundary(page, level, checkpoint.stepIndex, 'recovered');
      return;
    }
    await expect(status).toHaveAttribute('data-save-status', 'pending');
    const pending = await capture();
    expect(pending.raw).toBe(observed.raw);
    expect(pending.state).toEqual({ ...observed.state, status: 'pending', errorCode: 'other-safe-error' });
    await logGuidedBoundary(page, level, checkpoint.stepIndex, 'pending-close-confirmed');
    const abandon = page.getByRole('button', { name: '보류 종료 취소', exact: true });
    await expect(abandon).toBeVisible(); await expect(abandon).toBeEnabled();
    const pendingBeforeAction = await capture();
    expect(pendingBeforeAction).toEqual(pending);
    await abandon.click();
    await expect(status).toHaveAttribute('data-save-status', 'saved');
    const cancelledView = await capture();
    expect(cancelledView.state).toMatchObject({ status: 'saved', available: true, contextCurrent: true, busy: false, pendingKind: 'none', editorDirty: false, editorPresent: false, closedBoundary: false, errorCode: 'none' });
    const cancelled = JSON.parse(cancelledView.raw!) as ConversationEnvelope;
    const old = observed.envelope!.sessions[0], operation = old.operations.at(-1)!;
    const cancelledSessionValue = cancelled.sessions[0], terminal = cancelledSessionValue.operations.at(-1)!.terminal;
    expect(terminal?.kind).toBe('cancelled');
    if (terminal?.kind !== 'cancelled') throw new Error('Original close cancellation was not confirmed');
    expect(validateEnvelope(cancelled).status).toBe('valid');
    expect(terminal.resolution).toMatchObject({ operationId: operation.command.operationId, ownerId: initial.ownerId, generationId: initial.generationId, sessionId: old.sessionId, expectedStateRevision: old.stateRevision });
    expect(terminal.recoveredDraft).toBeNull();
    expect(cancelled).toEqual({ ...observed.envelope, sessions: [cancelledSession(old, operation.command, terminal.resolution)] });
    expect(cancelledSessionValue.closed).toBeNull();
    await logGuidedBoundary(page, level, checkpoint.stepIndex, 'close-abandoned');
    const close = page.getByRole('button', { name: '대화 종료', exact: true });
    await expect(close).toBeEnabled();
    expect(await capture()).toEqual(cancelledView);
    await close.click();
    await logGuidedBoundary(page, level, checkpoint.stepIndex, 'replacement-close-clicked');
    // Deliberately no recovery/retry if this separate new action is uncertain.
    await expect(status).toHaveAttribute('data-save-status', 'saved');
    const completedView = await capture();
    const completed = JSON.parse(completedView.raw!) as ConversationEnvelope;
    expect(classifyGuidedCheckpoint(completedView.state, completed, initial, { ...checkpoint, before: cancelled })).toBe('close-applied');
    const replacement = completed.sessions[0].operations.at(-1)!.command;
    expect(replacement.operationId).not.toBe(operation.command.operationId); expect(replacement.receiptId).not.toBe(operation.command.receiptId);
    expect(replacement.kind).toBe('close'); expect(operation.command.kind).toBe('close');
    if (replacement.kind !== 'close' || operation.command.kind !== 'close') throw new Error('A close command was required');
    expect(replacement.boundary.boundaryId).not.toBe(operation.command.boundary.boundaryId);
    expect(completed.sessions[0].operations.filter(op => op.command.kind === 'close' && op.terminal?.kind === 'applied')).toHaveLength(1);
  } catch (error) {
    // Only a fixed category and sanitized state leave this helper, never input,
    // owner/operation IDs, partition bytes or the assertion's raw exception.
    logGuidedCheckpointRefusal(lastState, level, checkpoint.stepIndex, checkpoint.kind, refusal ?? last?.reason ?? 'read-failed');
    throw error;
  }
}
