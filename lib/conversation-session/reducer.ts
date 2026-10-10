import { z } from 'zod';
import { appliedSession, buildGuidedTurn, cancelledSession, canonicalJson, commandSchema, deletionSchema, draftSchema, exact, freezeRecord, isGuidedSource, isPlainJson, resolutionSchema, sessionSchema, sourceRef, supportedSource, validateEnvelope, type ConversationCommand, type ConversationDeletion, type ConversationDraft, type ConversationEnvelope, type ConversationResolution, type ConversationSession, type FailureCode } from './contracts.ts';

/** Pure plans only. A plan or replay is NOT a write, durable receipt, current UI
 * acknowledgement, owner authentication, or proof of an unknown outcome. */
export type SessionSource = Readonly<{ ownerId: string; generationId: string; sessionId: string; sessionBytes: string }>;
type Effect = Readonly<{ kind: 'session-created' | 'draft-saved' | 'staged' | 'applied' | 'cancelled' | 'deleted'; sessionId: string; operationId?: string; resultId?: string; resolutionId?: string }>;
export type PlanResult = { status: 'planned' | 'replay'; envelope: ConversationEnvelope; effect: Effect } | { status: 'blocked'; code: FailureCode };
const blocked = (code: FailureCode): PlanResult => ({ status: 'blocked', code });
const tokenSchema = z.strictObject({ ownerId: z.string(), generationId: z.string(), sessionId: z.string(), sessionBytes: z.string().max(262144) });
export function sessionSource(envelope: ConversationEnvelope, sessionId: string): SessionSource | undefined {
  const checked = validateEnvelope(envelope);
  if (checked.status !== 'valid') return undefined;
  const session = checked.envelope.sessions.find(item => item.sessionId === sessionId);
  return session ? freezeRecord({ ownerId: envelope.ownerId, generationId: envelope.generationId, sessionId, sessionBytes: canonicalJson(session) }) : undefined;
}
function sameSource(envelope: ConversationEnvelope, session: ConversationSession, source: SessionSource) {
  return isPlainJson(source) && tokenSchema.safeParse(source).success && source.ownerId === envelope.ownerId && source.generationId === envelope.generationId && source.sessionId === session.sessionId && source.sessionBytes === canonicalJson(session);
}
function finish(envelope: ConversationEnvelope, effect: Effect): PlanResult {
  const checked = validateEnvelope(envelope);
  return checked.status === 'valid' ? freezeRecord({ status: 'planned', envelope: checked.envelope, effect }) : checked;
}
function replace(envelope: ConversationEnvelope, session: ConversationSession) { return { ...envelope, sessions: envelope.sessions.map(item => item.sessionId === session.sessionId ? session : item) }; }
function binding(envelope: ConversationEnvelope, command: { ownerId: string; generationId: string }) { return command.ownerId === envelope.ownerId && command.generationId === envelope.generationId; }
function terminalEffect(session: ConversationSession, operation: ConversationSession['operations'][number]): Effect {
  const terminal = operation.terminal;
  return { kind: terminal?.kind ?? 'staged', sessionId: session.sessionId, operationId: operation.command.operationId,
    ...(terminal?.kind === 'applied' ? { resultId: terminal.resultId } : terminal?.kind === 'cancelled' ? { resolutionId: terminal.resolution.resolutionId, ...(terminal.recoveredDraft ? { resultId: terminal.recoveredDraft.draftId } : {}) } : {}) };
}
function locate(envelope: ConversationEnvelope, command: ConversationCommand) {
  if (!binding(envelope, command)) return { code: 'stale-source' as const };
  if (envelope.tombstones.some(item => item.sessionId === command.sessionId)) return { code: 'deleted' as const };
  for (const session of envelope.sessions) {
    const operation = session.operations.find(item => item.command.operationId === command.operationId);
    if (operation) return exact(operation.command, command) ? { session, operation } : { code: 'conflict' as const };
  }
  return { session: envelope.sessions.find(item => item.sessionId === command.sessionId), operation: undefined };
}
function safe<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  try { if (!isPlainJson(value)) return undefined; const parsed = schema.safeParse(value); return parsed.success ? parsed.data : undefined; } catch { return undefined; }
}

export function planCreateSession(raw: unknown, source: Pick<ConversationEnvelope, 'ownerId' | 'generationId'>, rawSession: unknown): PlanResult {
  const checked = validateEnvelope(raw); if (checked.status !== 'valid') return checked;
  const envelope = checked.envelope, session = safe(sessionSchema, rawSession);
  if (!session) return blocked('invalid-data');
  if (!source || !isPlainJson(source) || !binding(envelope, source)) return blocked('stale-source');
  if (envelope.tombstones.some(item => item.sessionId === session.sessionId)) return blocked('deleted');
  const existing = envelope.sessions.find(item => item.sessionId === session.sessionId);
  if (existing) return exact(existing, session) ? freezeRecord({ status: 'replay', envelope, effect: { kind: 'session-created', sessionId: session.sessionId } }) : blocked('conflict');
  if (!supportedSource(session.source)) return blocked('unsupported-source');
  if (session.stateRevision || session.headRevision || session.turns.length || session.drafts.length || session.operations.length || session.closed) return blocked('invalid-data');
  return finish({ ...envelope, schemaVersion: isGuidedSource(session.source) ? 2 : envelope.schemaVersion, sessions: [...envelope.sessions, session] }, { kind: 'session-created', sessionId: session.sessionId });
}

/** An unresolved append pins its exact lane. Later input may explicitly save to a
 * different free lane; this function never picks, overwrites or evicts one. */
export function planSaveDraft(raw: unknown, source: SessionSource, rawDraft: unknown): PlanResult {
  const checked = validateEnvelope(raw); if (checked.status !== 'valid') return checked;
  const envelope = checked.envelope, draft = safe(draftSchema, rawDraft);
  if (!draft) return blocked('invalid-data');
  if (!safe(tokenSchema, source)) return blocked('stale-source');
  const session = envelope.sessions.find(item => item.sessionId === source.sessionId);
  if (!session || !sameSource(envelope, session, source)) return blocked('stale-source');
  if (session.closed) return blocked('closed');
  if (!supportedSource(session.source)) return blocked('unsupported-source');
  const guided = isGuidedSource(session.source);
  if (isGuidedSource(session.source)) {
    const stepIndex = session.source.content.steps.findIndex(step => step.id === draft.source.stepId);
    if (stepIndex < 0 || stepIndex > session.turns.length || !exact(draft.source, sourceRef(session.source, draft.source.stepId))) return blocked('conflict');
  } else if (!exact(draft.source, sourceRef(session.source))) return blocked('conflict');
  // A consumed lane is not forgotten identity. Pin guided source references and
  // revision succession across turns, all commands and cancelled recoveries.
  const retained = guided ? [
    ...session.drafts, ...session.turns.map(turn => turn.draft),
    ...session.operations.flatMap(op => op.command.kind === 'append' ? [op.command.turn.draft] : []),
    ...session.operations.flatMap(op => op.terminal?.kind === 'cancelled' && op.terminal.recoveredDraft ? [op.terminal.recoveredDraft] : []),
  ].filter(item => item.draftId === draft.draftId) : [];
  if (retained.some(item => !exact(item.source, draft.source))) return blocked('conflict');
  const previous = session.drafts.find(item => item.draftId === draft.draftId);
  if (previous && exact(previous, draft)) return freezeRecord({ status: 'replay', envelope, effect: { kind: 'draft-saved', sessionId: session.sessionId, resultId: draft.draftId } });
  if (session.operations.some(op => op.terminal === null && op.command.kind === 'append' && op.command.turn.draft.draftId === draft.draftId)) return blocked('pinned-draft');
  if (draft.revision !== (guided ? Math.max(0, ...retained.map(item => item.revision)) : previous?.revision ?? 0) + 1) return blocked('conflict');
  if (!previous && session.drafts.length >= 2) return blocked('capacity-exceeded');
  return finish(replace(envelope, { ...session, stateRevision: session.stateRevision + 1, drafts: previous ? session.drafts.map(item => item.draftId === draft.draftId ? draft : item) : [...session.drafts, draft] }), { kind: 'draft-saved', sessionId: session.sessionId, resultId: draft.draftId });
}

/** Stage replays check terminal state BEFORE stale source/head checks. An old stage
 * cannot resurrect an applied/cancelled command, even after later session edits. */
export function planStage(raw: unknown, source: SessionSource, rawCommand: unknown): PlanResult {
  const checked = validateEnvelope(raw); if (checked.status !== 'valid') return checked;
  const envelope = checked.envelope, command = safe(commandSchema, rawCommand);
  if (!command) return blocked('invalid-data');
  const found = locate(envelope, command); if (found.code) return blocked(found.code);
  if (found.operation) return freezeRecord({ status: 'replay', envelope, effect: terminalEffect(found.session!, found.operation) });
  const session = found.session;
  if (!session || !sameSource(envelope, session, source)) return blocked('stale-source');
  if (session.closed) return blocked('closed');
  if (!supportedSource(session.source)) return blocked('unsupported-source');
  if (session.operations.some(op => op.terminal === null)) return blocked('pending-operation');
  if (command.expectedHeadRevision !== session.headRevision) return blocked('conflict');
  if (isGuidedSource(session.source) && (session.operations.length >= 2000 || session.stateRevision > Number.MAX_SAFE_INTEGER - 3)) return blocked('capacity-exceeded');
  if (command.kind === 'append' && !session.drafts.some(draft => exact(draft, command.turn.draft))) return blocked('conflict');
  if (command.kind === 'append' && isGuidedSource(session.source) && !exact(command.turn, buildGuidedTurn(session, command.turn.draft, command.turn))) return blocked('conflict');
  return finish(replace(envelope, { ...session, stateRevision: session.stateRevision + 1, operations: [...session.operations, { command, terminal: null }] }), { kind: 'staged', sessionId: session.sessionId, operationId: command.operationId });
}

/** Called only by a future original-capability facade. Data equality here cannot
 * authorize a restarted command; restart recovery must use planResolve instead. */
export function planApply(raw: unknown, rawCommand: unknown): PlanResult {
  const checked = validateEnvelope(raw); if (checked.status !== 'valid') return checked;
  const envelope = checked.envelope, command = safe(commandSchema, rawCommand);
  if (!command) return blocked('invalid-data');
  const found = locate(envelope, command); if (found.code) return blocked(found.code);
  if (!found.session || !found.operation) return blocked('unresolved');
  if (found.operation.terminal) return freezeRecord({ status: 'replay', envelope, effect: terminalEffect(found.session, found.operation) });
  if (!supportedSource(found.session.source)) return blocked('unsupported-source');
  return finish(replace(envelope, appliedSession(found.session, command)), { kind: 'applied', sessionId: command.sessionId, operationId: command.operationId, resultId: command.kind === 'append' ? command.turn.turnId : command.boundary.boundaryId });
}

/** New explicit resolution, exact current source plus unchanged original command.
 * Absence is unresolved, never no-commit. Close cancellation creates no draft.
 * Append cancellation keeps its pinned draft and freezes the recovery result. */
export function planResolve(raw: unknown, source: SessionSource, rawCommand: unknown, rawResolution: unknown): PlanResult {
  const checked = validateEnvelope(raw); if (checked.status !== 'valid') return checked;
  const envelope = checked.envelope, command = safe(commandSchema, rawCommand), resolution = safe(resolutionSchema, rawResolution);
  if (!command || !resolution) return blocked('invalid-data');
  if (!binding(envelope, resolution) || resolution.sessionId !== command.sessionId || resolution.operationId !== command.operationId) return blocked('stale-source');
  const found = locate(envelope, command); if (found.code) return blocked(found.code);
  if (!found.session || !found.operation) return blocked('unresolved');
  if (found.operation.terminal) {
    if (found.operation.terminal.kind === 'cancelled' && !exact(found.operation.terminal.resolution, resolution)) return blocked('conflict');
    return freezeRecord({ status: 'replay', envelope, effect: terminalEffect(found.session, found.operation) });
  }
  if (!sameSource(envelope, found.session, source) || resolution.expectedStateRevision !== found.session.stateRevision) return blocked('stale-source');
  return finish(replace(envelope, cancelledSession(found.session, command, resolution)), { kind: 'cancelled', sessionId: command.sessionId, operationId: command.operationId, resolutionId: resolution.resolutionId, ...(command.kind === 'append' ? { resultId: command.turn.draft.draftId } : {}) });
}

/** The caller must separately obtain explicit irreversible-deletion approval tied
 * to this exact source. A planner cannot confirm user consent. */
export function planDeleteSession(raw: unknown, source: SessionSource, rawDeletion: unknown): PlanResult {
  const checked = validateEnvelope(raw); if (checked.status !== 'valid') return checked;
  const envelope = checked.envelope, deletion = safe(deletionSchema, rawDeletion);
  if (!deletion) return blocked('invalid-data');
  if (!binding(envelope, deletion)) return blocked('stale-source');
  const previous = envelope.tombstones.find(item => item.sessionId === deletion.sessionId || item.deletionId === deletion.deletionId);
  if (previous) return exact(previous, deletion) ? freezeRecord({ status: 'replay', envelope, effect: { kind: 'deleted', sessionId: deletion.sessionId, resultId: deletion.tombstoneId } }) : blocked('conflict');
  const session = envelope.sessions.find(item => item.sessionId === deletion.sessionId);
  if (!session || !sameSource(envelope, session, source) || session.stateRevision !== deletion.expectedStateRevision) return blocked('stale-source');
  return finish({ ...envelope, sessions: envelope.sessions.filter(item => item !== session), tombstones: [...envelope.tombstones, deletion] }, { kind: 'deleted', sessionId: deletion.sessionId, resultId: deletion.tombstoneId });
}
export type { ConversationDraft, ConversationDeletion, ConversationResolution };
