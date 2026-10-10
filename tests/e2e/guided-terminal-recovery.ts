import { exact, type ConversationEnvelope, type ConversationSession } from '../../lib/conversation-session/contracts.ts';
import type { readGuidedDiagnostic } from './guided-conversation-diagnostics.ts';

type ExpectedTerminal = {
  ownerId: string; generationId: string; marker: ConversationEnvelope['marker']; sessionId: string;
  source: ConversationSession['source']; totalSteps: number;
};

/** Authorize one explicit readback, never a resend, only for the observed CI
 * boundary with an exact original applied command for every authored turn. */
export function isAppliedGuidedRecoveryCandidate(
  state: Awaited<ReturnType<typeof readGuidedDiagnostic>>,
  envelope: ConversationEnvelope,
  expected: ExpectedTerminal,
): boolean {
  if (!Number.isInteger(expected.totalSteps) || expected.totalSteps < 1) return false;
  if (state.status !== 'uncertain' || state.busy !== false || state.available !== true || state.contextCurrent !== true
    || state.commandKind !== 'append' || state.commandBoundary !== 'staged' || state.pendingKind !== 'append'
    || state.errorCode !== 'none' || state.editorDirty !== false || state.editorPresent !== true
    || state.editorOnActiveStep !== false || state.stepIndex !== null || state.closedBoundary !== false
    || state.totalSteps !== expected.totalSteps || state.submittedSteps !== expected.totalSteps || state.turnCount !== expected.totalSteps || state.draftCount !== 0) return false;
  if (envelope.schemaVersion !== 2 || envelope.ownerId !== expected.ownerId || envelope.generationId !== expected.generationId || envelope.marker !== expected.marker
    || envelope.sessions.length !== 1) return false;
  const session = envelope.sessions[0];
  if (session.sessionId !== expected.sessionId || !exact(session.source, expected.source) || session.closed !== null
    || session.headRevision !== expected.totalSteps || session.turns.length !== expected.totalSteps
    || session.drafts.length !== 0 || session.operations.length !== expected.totalSteps) return false;
  return session.operations.every((operation, index) => {
    const command = operation.command, turn = session.turns[index];
    return command.kind === 'append' && command.ownerId === expected.ownerId && command.generationId === expected.generationId
      && command.sessionId === expected.sessionId && command.expectedHeadRevision === index && exact(command.turn, turn)
      && operation.terminal?.kind === 'applied' && operation.terminal.resultId === turn.turnId;
  });
}
