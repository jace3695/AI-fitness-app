import { expect, type Page } from '@playwright/test';
import { appliedSession, cancelledSession, exact, getConversationProgress, sourceRef, validateEnvelope, type ConversationDraft, type ConversationEnvelope } from '../../lib/conversation-session/contracts.ts';
import { logGuidedBoundary, readGuidedDiagnostic } from './guided-conversation-diagnostics.ts';

type Diagnostic = Awaited<ReturnType<typeof readGuidedDiagnostic>>;
export type GuidedCheckpoint = {
  kind: 'draft' | 'append' | 'close'; before: ConversationEnvelope;
  input?: string; origin?: ConversationDraft['origin']; stepIndex: number;
};
type Result = 'refused' | 'draft-applied' | 'append-applied' | 'close-applied' | 'close-pending';

/** Exact transition proof only. No storage, UI action, authority creation or
 * attempted replay is available to this classifier. */
export function classifyGuidedCheckpoint(state: Diagnostic, after: ConversationEnvelope, initial: ConversationEnvelope, checkpoint: GuidedCheckpoint, editorInput?: string): Result {
  const before = checkpoint.before;
  if ([initial, before, after].some(envelope => validateEnvelope(envelope).status !== 'valid')) return 'refused';
  const old = before.sessions[0], current = after.sessions[0], first = initial.sessions[0];
  if (!old || !current || !first || before.sessions.length !== 1 || after.sessions.length !== 1 || initial.sessions.length !== 1
    || before.schemaVersion !== 2 || after.schemaVersion !== 2 || before.ownerId !== initial.ownerId || after.ownerId !== initial.ownerId
    || before.generationId !== initial.generationId || after.generationId !== initial.generationId
    || before.marker !== initial.marker || after.marker !== initial.marker || old.sessionId !== first.sessionId || current.sessionId !== first.sessionId
    || !exact(old.source, first.source) || !exact(current.source, first.source)
    || !exact({ ...initial, sessions: before.sessions }, before) || !exact({ ...before, sessions: after.sessions }, after)) return 'refused';
  if (state.available !== true || state.contextCurrent !== true || state.busy !== false || state.errorCode !== 'none'
    || !['saved', 'uncertain'].includes(String(state.status)) || old.closed !== null) return 'refused';
  const progress = getConversationProgress(current), previousProgress = getConversationProgress(old);
  if (!previousProgress || previousProgress.kind !== 'guided'
    || (checkpoint.kind === 'close' ? previousProgress.coverage !== 'all-steps-submitted' || checkpoint.stepIndex !== previousProgress.totalStepCount - 1 : checkpoint.stepIndex !== previousProgress.activeStepIndex)) return 'refused';
  if (!progress || state.totalSteps !== progress.totalStepCount || state.submittedSteps !== progress.submittedStepCount
    || state.stepIndex !== (progress.activeStepIndex ?? null) || state.turnCount !== current.turns.length
    || state.draftCount !== current.drafts.length || state.closedBoundary !== Boolean(current.closed)
    || state.editorPresent !== (progress.activeStepIndex !== null) || state.editorOnActiveStep !== (progress.activeStepIndex !== null)) return 'refused';
  const uncertain = state.status === 'uncertain';
  if (state.pendingKind !== (uncertain ? checkpoint.kind : 'none')) return 'refused';
  if (checkpoint.kind === 'draft') {
    const draft = current.drafts[0];
    if (!draft || old.drafts.length !== 0 || current.drafts.length !== 1 || state.editorPresent !== true || state.editorOnActiveStep !== true
      || state.editorDirty !== uncertain || state.stepIndex !== checkpoint.stepIndex || state.submittedSteps !== old.turns.length
      || editorInput !== checkpoint.input || draft.input !== checkpoint.input || !exact(draft.origin, checkpoint.origin) || !exact(draft.exposure, state.exposure)
      || !('steps' in old.source.content) || !old.source.content.steps[checkpoint.stepIndex]
      || !exact(draft.source, sourceRef(old.source, old.source.content.steps[checkpoint.stepIndex].id)) || draft.revision !== 1
      || !exact({ ...old, stateRevision: old.stateRevision + 1, drafts: current.drafts }, current)) return 'refused';
    return 'draft-applied';
  }
  if (state.editorDirty !== false || state.commandKind !== checkpoint.kind
    || uncertain && state.commandBoundary !== (checkpoint.kind === 'close' && current.closed === null ? 'captured' : 'staged')) return 'refused';
  const operation = current.operations.at(-1), command = operation?.command;
  if (!operation || !command || command.kind !== checkpoint.kind || current.operations.length !== old.operations.length + 1
    || !exact(current.operations.slice(0, -1), old.operations) || old.operations.some(op => op.terminal === null)
    || command.ownerId !== initial.ownerId || command.generationId !== initial.generationId || command.sessionId !== old.sessionId
    || command.expectedHeadRevision !== old.headRevision) return 'refused';
  if (command.kind === 'append') {
    if (old.drafts.length !== 1 || !exact(command.turn.draft, old.drafts[0]) || command.turn.sequence !== old.turns.length + 1
      || command.turn.predecessorTurnId !== (old.turns.at(-1)?.turnId ?? null)) return 'refused';
  } else if (!exact(command.boundary.turnRefs, old.turns.map(turn => ({ turnId: turn.turnId, turnRevision: turn.turnRevision })))
    || old.drafts.length !== 0 || state.editorPresent !== false) return 'refused';
  const staged = { ...old, stateRevision: old.stateRevision + 1, operations: [...old.operations, { command, terminal: null }] };
  if (operation.terminal === null) return command.kind === 'close' && uncertain && exact(staged, current) ? 'close-pending' : 'refused';
  if (operation.terminal.kind !== 'applied' || !exact(appliedSession(staged, command), current)) return 'refused';
  return command.kind === 'append' ? 'append-applied' : 'close-applied';
}

/** One readback per original action. A genuinely staged close additionally
 * allows one explicit abandonment and one deliberate new close; it never
 * reuses the old intent or repeats a replacement that becomes uncertain. */
export async function confirmGuidedCheckpoint(page: Page, readRaw: () => Promise<string | null>, initial: ConversationEnvelope, checkpoint: GuidedCheckpoint, level: 'beginner' | 'elementary' | 'intermediate') {
  const status = page.locator('[data-save-status]');
  const inspect = async () => {
    const state = await readGuidedDiagnostic(page), raw = await readRaw();
    const envelope = raw ? JSON.parse(raw) as ConversationEnvelope : null;
    const editorInput = checkpoint.kind === 'draft' ? await page.getByLabel('일본어 문장', { exact: true }).inputValue() : undefined;
    return { state, raw, envelope, result: envelope ? classifyGuidedCheckpoint(state, envelope, initial, checkpoint, editorInput) : 'refused' };
  };
  // Retain the exact first-attempt outcome; polling here only reads evidence.
  await expect.poll(async () => (await inspect()).result).not.toBe('refused');
  const observed = await inspect(); expect(observed.result).not.toBe('refused');
  if (checkpoint.kind === 'draft') await expect(page.getByLabel('일본어 문장', { exact: true })).toHaveValue(checkpoint.input!);
  if (observed.state.status === 'saved') return;
  await logGuidedBoundary(page, level, checkpoint.stepIndex, 'before-recovery');
  const recover = page.getByRole('button', { name: '저장 다시 확인', exact: true });
  await expect(recover).toBeVisible(); await expect(recover).toBeEnabled(); await recover.click();
  if (observed.result !== 'close-pending') {
    await expect(status).toHaveAttribute('data-save-status', 'saved');
    await expect.poll(() => readGuidedDiagnostic(page)).toMatchObject({ pendingKind: 'none', busy: false, editorDirty: false });
    expect(await readRaw()).toBe(observed.raw);
    const confirmed = await inspect();
    expect(confirmed.result).toBe(observed.result); expect(confirmed.state.status).toBe('saved');
    if (checkpoint.kind === 'draft') await expect(page.getByLabel('일본어 문장', { exact: true })).toHaveValue(checkpoint.input!);
    await logGuidedBoundary(page, level, checkpoint.stepIndex, 'recovered');
    return;
  }
  await expect(status).toHaveAttribute('data-save-status', 'pending');
  await expect.poll(() => readGuidedDiagnostic(page)).toMatchObject({ available: true, contextCurrent: true, busy: false, pendingKind: 'close', commandKind: 'close', commandBoundary: 'captured', editorDirty: false, editorPresent: false, closedBoundary: false });
  expect(await readRaw()).toBe(observed.raw);
  await logGuidedBoundary(page, level, checkpoint.stepIndex, 'pending-close-confirmed');
  const abandon = page.getByRole('button', { name: '보류 종료 취소', exact: true });
  await expect(abandon).toBeVisible(); await expect(abandon).toBeEnabled(); await abandon.click();
  await expect(status).toHaveAttribute('data-save-status', 'saved');
  await expect.poll(() => readGuidedDiagnostic(page)).toMatchObject({ available: true, contextCurrent: true, busy: false, pendingKind: 'none', editorDirty: false, editorPresent: false, closedBoundary: false, errorCode: 'none' });
  const cancelled = JSON.parse((await readRaw())!) as ConversationEnvelope;
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
  await expect(close).toBeEnabled(); await close.click();
  await logGuidedBoundary(page, level, checkpoint.stepIndex, 'replacement-close-clicked');
  // Deliberately no recovery/retry if this separate new action is uncertain.
  await expect(status).toHaveAttribute('data-save-status', 'saved');
  const completed = JSON.parse((await readRaw())!) as ConversationEnvelope;
  expect(classifyGuidedCheckpoint(await readGuidedDiagnostic(page), completed, initial, { ...checkpoint, before: cancelled })).toBe('close-applied');
  const replacement = completed.sessions[0].operations.at(-1)!.command;
  expect(replacement.operationId).not.toBe(operation.command.operationId); expect(replacement.receiptId).not.toBe(operation.command.receiptId);
  expect(replacement.kind).toBe('close'); expect(operation.command.kind).toBe('close');
  if (replacement.kind !== 'close' || operation.command.kind !== 'close') throw new Error('A close command was required');
  expect(replacement.boundary.boundaryId).not.toBe(operation.command.boundary.boundaryId);
  expect(completed.sessions[0].operations.filter(op => op.command.kind === 'close' && op.terminal?.kind === 'applied')).toHaveLength(1);
}
