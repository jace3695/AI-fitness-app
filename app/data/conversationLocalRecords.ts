import { buildFrozenTurn, buildGuidedTurn, freezeGuidedSource, isGuidedSource, GUIDED_SUMMARY_POLICY_VERSION, canonicalJson, commandSchema, exact, freezeLegacySource, freezeRecord, isPlainJson, SUMMARY_POLICY_VERSION,
  type ConversationCommand, type ConversationDraft, type ConversationEnvelope, type ConversationSession } from '../../lib/conversation-session/contracts.ts';
import { planApply, planCreateSession, planDeleteSession, planResolve, planSaveDraft, planStage, sessionSource, type PlanResult, type SessionSource } from '../../lib/conversation-session/reducer.ts';
import { languageConversationCapability, type LanguageConversationSnapshot, type LanguageRecordContext } from './languageCloudSync.ts';
import { ConversationLocalError } from './languageLocalParticipants.ts';

/** Registered device-local facade. There is deliberately no page/store instance,
 * automatic enrollment, raw storage escape, runtime registration or cloud export. */
export type ConversationSnapshot = LanguageConversationSnapshot;
export const readConversationSnapshot = (context: LanguageRecordContext): ConversationSnapshot => languageConversationCapability.read(context);
type Planned = Exclude<PlanResult, { status: 'blocked' }>;
export interface ConversationWriteResult {
  readonly status: 'committed'; readonly effect: Planned['effect']; readonly committed: ConversationEnvelope;
  readonly acknowledged: boolean; readonly source: ConversationSnapshot | null; readonly generation: string | null;
}
export interface ConversationCommandIntent { readonly command: ConversationCommand }
export interface ConversationEditIntent { readonly id: string; readonly kind: 'create' | 'draft' | 'cancel' | 'delete' }
type Outcome = 'created' | 'pending' | 'not-committed' | 'committed' | 'unknown';
type Attempt = { state: Outcome; promise?: Promise<ConversationWriteResult>; result?: ConversationWriteResult };
type CommandPrivate = { source: ConversationSnapshot; session: SessionSource; stage: Attempt; apply: Attempt };
type EditPrivate = { source: ConversationSnapshot; plan(fresh: ConversationEnvelope | null): PlanResult; expected: Planned; attempt: Attempt };
const commands = new WeakMap<ConversationCommandIntent, CommandPrivate>(), edits = new WeakMap<ConversationEditIntent, EditPrivate>();
const fail = (): never => { throw new ConversationLocalError('invalid-command'); };
function planned(result: PlanResult): Planned { if (result.status === 'blocked') throw new ConversationLocalError(result.code); return result; }
function validSource(source: ConversationSnapshot) { languageConversationCapability.assertSource(source, source.context); }
function sessionAt(source: ConversationSnapshot, sessionId: string): { envelope: ConversationEnvelope; session: ConversationSession; token: SessionSource } {
  validSource(source);
  const envelope = source.envelope, session = envelope?.sessions.find(item => item.sessionId === sessionId), token = envelope && sessionSource(envelope, sessionId);
  if (!envelope || !session || !token) return fail();
  return { envelope, session, token };
}
function captureEdit(source: ConversationSnapshot, kind: ConversationEditIntent['kind'], plan: EditPrivate['plan']): ConversationEditIntent {
  validSource(source); const expected = planned(plan(source.envelope));
  const intent = Object.freeze({ id: crypto.randomUUID(), kind }); edits.set(intent, { source, plan, expected, attempt: { state: 'created' } }); return intent;
}
export type ConversationSelection = string | Readonly<{ kind: 'guided'; scriptId: string; scriptRevision: string }>;
/** Only an explicit new-session command enrolls or upgrades an owner partition. */
function captureConversationSessionImpl(source: ConversationSnapshot, selection: ConversationSelection, timeZone: string): ConversationEditIntent {
  validSource(source);
  const selected = typeof selection === 'string' ? freezeLegacySource(selection)
    : isPlainJson(selection) && exact(Object.keys(selection).sort(), ['kind', 'scriptId', 'scriptRevision']) && selection.kind === 'guided'
      ? freezeGuidedSource(selection.scriptId, selection.scriptRevision) : undefined;
  if (!selected) return fail();
  const now = new Date().toISOString();
  const base: ConversationEnvelope = source.envelope ?? freezeRecord({ schemaVersion: isGuidedSource(selected) ? 2 : 1, ownerId: source.context.userId,
    generationId: crypto.randomUUID(), marker: source.observation.marker,
    enrollment: { kind: 'explicit-enrollment', enrollmentId: crypto.randomUUID(), createdAt: now, observation: source.observation }, sessions: [], tombstones: [] });
  const session: ConversationSession = freezeRecord({ sessionId: crypto.randomUUID(), createdAt: now, timeZone, source: selected,
    stateRevision: 0, headRevision: 0, drafts: [], turns: [], operations: [], closed: null });
  return captureEdit(source, 'create', fresh => {
    if (fresh && fresh.generationId !== base.generationId || !fresh && source.envelope) return { status: 'blocked', code: 'stale-source' };
    // Upgrade and append together against the fresh locked envelope. Never issue
    // a migration-only write, reconstruct an older partition, or change its identity.
    const current = fresh ?? base;
    return planCreateSession(isGuidedSource(selected) ? { ...current, schemaVersion: 2 } : current, base, session);
  });
}
function captureConversationDraftImpl(source: ConversationSnapshot, sessionId: string, draft: ConversationDraft): ConversationEditIntent {
  const { token } = sessionAt(source, sessionId);
  if (!isPlainJson(draft)) return fail();
  const frozen = freezeRecord(JSON.parse(canonicalJson(draft)) as ConversationDraft);
  return captureEdit(source, 'draft', fresh => planSaveDraft(fresh, token, frozen));
}
function captureCommand(source: ConversationSnapshot, token: SessionSource, raw: ConversationCommand): ConversationCommandIntent {
  if (!isPlainJson(raw)) return fail();
  const checked = commandSchema.safeParse(raw); if (!checked.success) return fail();
  const command = freezeRecord(checked.data);
  planned(planStage(source.envelope, token, command));
  const intent = Object.freeze({ command });
  commands.set(intent, { source, session: token, stage: { state: 'created' }, apply: { state: 'created' } }); return intent;
}
function captureConversationAppendImpl(source: ConversationSnapshot, sessionId: string, draftId: string): ConversationCommandIntent {
  const { envelope, session, token } = sessionAt(source, sessionId), draft = session.drafts.find(item => item.draftId === draftId);
  if (!draft) return fail();
  const fields = { turnId: crypto.randomUUID(), sequence: session.turns.length + 1,
    predecessorTurnId: session.turns.at(-1)?.turnId ?? null, recordedAt: new Date().toISOString() };
  const turn = isGuidedSource(session.source) ? buildGuidedTurn(session, draft, fields) : buildFrozenTurn(session.source, draft, fields);
  if (!turn) return fail();
  return captureCommand(source, token, { kind: 'append', operationId: crypto.randomUUID(), receiptId: crypto.randomUUID(), ownerId: envelope.ownerId,
    generationId: envelope.generationId, sessionId, expectedHeadRevision: session.headRevision, turn });
}
function captureConversationCloseImpl(source: ConversationSnapshot, sessionId: string): ConversationCommandIntent {
  const { envelope, session, token } = sessionAt(source, sessionId);
  return captureCommand(source, token, { kind: 'close', operationId: crypto.randomUUID(), receiptId: crypto.randomUUID(), ownerId: envelope.ownerId,
    generationId: envelope.generationId, sessionId, expectedHeadRevision: session.headRevision,
    boundary: { boundaryId: crypto.randomUUID(), summaryPolicyVersion: isGuidedSource(session.source) ? GUIDED_SUMMARY_POLICY_VERSION : SUMMARY_POLICY_VERSION,
      turnRefs: session.turns.map(turn => ({ turnId: turn.turnId, turnRevision: turn.turnRevision })),
      closedAt: new Date().toISOString(), timeZone: session.timeZone, observation: source.observation } });
}
/** Cancellation is a NEW current-source command. It never reauthorizes the old
 * pending command, creates a close draft, or turns absence into proof of no commit. */
function captureConversationCancellationImpl(source: ConversationSnapshot, sessionId: string, operationId: string): ConversationEditIntent {
  const { envelope, session, token } = sessionAt(source, sessionId), operation = session.operations.find(item => item.command.operationId === operationId);
  if (!operation) return fail();
  const resolution = freezeRecord({ resolutionId: crypto.randomUUID(), operationId, ownerId: envelope.ownerId, generationId: envelope.generationId,
    sessionId, expectedStateRevision: session.stateRevision, resolvedAt: new Date().toISOString() });
  return captureEdit(source, 'cancel', fresh => planResolve(fresh, token, operation.command, resolution));
}
/** The eventual UI must obtain explicit irreversible-deletion confirmation for
 * this exact displayed source before issuing the command. P2-B has no UI caller. */
function captureConversationDeletionImpl(source: ConversationSnapshot, sessionId: string): ConversationEditIntent {
  const { envelope, session, token } = sessionAt(source, sessionId);
  const deletion = freezeRecord({ deletionId: crypto.randomUUID(), tombstoneId: crypto.randomUUID(), ownerId: envelope.ownerId,
    generationId: envelope.generationId, sessionId, expectedStateRevision: session.stateRevision, deletedAt: new Date().toISOString() });
  return captureEdit(source, 'delete', fresh => planDeleteSession(fresh, token, deletion));
}
function acknowledge(result: ConversationWriteResult): ConversationWriteResult {
  if (result.acknowledged && result.source) {
    try { languageConversationCapability.assertSource(result.source, result.source.context); return result; } catch { /* Retired while a coalesced continuation was queued. */ }
  }
  return { ...result, acknowledged: false, source: null };
}
async function run(source: ConversationSnapshot, attempt: Attempt, planner: EditPrivate['plan'], inspectTerminal = false): Promise<ConversationWriteResult> {
  // Even a previously committed cached result is not current acknowledgement.
  if (attempt.result && !inspectTerminal) return { ...attempt.result, acknowledged: false, source: null };
  validSource(source);
  if (attempt.state === 'unknown') throw new ConversationLocalError('storage-unknown', 'unknown');
  if (attempt.promise && attempt.state === 'pending') return acknowledge(await attempt.promise);
  attempt.state = 'pending';
  const promise = (async () => {
    let effect: Planned['effect'] | undefined;
    const result = await languageConversationCapability.update(source.context, source, fresh => {
      const plan = planned(planner(fresh)); effect = plan.effect; return plan.envelope;
    });
    if (!effect) return fail();
    const outcome: ConversationWriteResult = Object.freeze({ ...result, status: 'committed', effect });
    attempt.result = outcome; attempt.state = 'committed'; return outcome;
  })();
  attempt.promise = promise;
  try { return acknowledge(await promise); } catch (error) {
    attempt.promise = undefined;
    attempt.state = error instanceof ConversationLocalError ? error.outcome : 'unknown';
    throw error instanceof ConversationLocalError ? error : new ConversationLocalError('storage-unknown', 'unknown');
  }
}
export function runConversationEdit(intent: ConversationEditIntent): Promise<ConversationWriteResult> {
  const entry = edits.get(intent); if (!entry) return Promise.reject(new ConversationLocalError('invalid-command'));
  return run(entry.source, entry.attempt, fresh => { const result = entry.plan(fresh); if (result.status !== 'blocked') entry.expected = result; return result; });
}
export function stageConversationIntent(intent: ConversationCommandIntent): Promise<ConversationWriteResult> {
  const entry = commands.get(intent); if (!entry) return Promise.reject(new ConversationLocalError('invalid-command'));
  return run(entry.source, entry.stage, fresh => planStage(fresh, entry.session, intent.command), true);
}
export function applyConversationIntent(intent: ConversationCommandIntent): Promise<ConversationWriteResult> {
  const entry = commands.get(intent); if (!entry) return Promise.reject(new ConversationLocalError('invalid-command'));
  if (entry.stage.state !== 'committed') return Promise.reject(new ConversationLocalError(entry.stage.state === 'unknown' ? 'storage-unknown' : 'invalid-command', entry.stage.state === 'unknown' ? 'unknown' : 'not-committed'));
  return run(entry.source, entry.apply, fresh => planApply(fresh, intent.command), true);
}
/** Read-first projection only: no write, no regenerated IDs and no intent rebind.
 * A current registered snapshot can inspect restarted persisted commands by ID. */
function reconcileConversationOperationImpl(source: ConversationSnapshot, sessionId: string, operationId: string) {
  validSource(source);
  const fresh = readConversationSnapshot(source.context);
  if (fresh.envelope?.generationId !== source.envelope?.generationId) throw new ConversationLocalError('stale-source');
  const { session } = sessionAt(fresh, sessionId), operation = session.operations.find(item => item.command.operationId === operationId);
  return freezeRecord(operation ? { status: operation.terminal?.kind ?? 'pending', command: operation.command, terminal: operation.terminal,
    observation: fresh.observation } : { status: 'unresolved' as const, observation: fresh.observation });
}
function reconcileConversationIntentImpl(intent: ConversationCommandIntent, context: LanguageRecordContext) {
  const entry = commands.get(intent); if (!entry) return fail();
  languageConversationCapability.assertSource(entry.source, context);
  const source = readConversationSnapshot(context);
  const observed = reconcileConversationOperation(source, intent.command.sessionId, intent.command.operationId);
  if ('command' in observed && !exact(observed.command, intent.command)) return fail();
  return observed;
}
export function conversationIntentOutcome(intent: ConversationCommandIntent) {
  const entry = commands.get(intent); return entry ? Object.freeze({ stage: entry.stage.state, apply: entry.apply.state }) : Object.freeze({ stage: 'unknown' as const, apply: 'unknown' as const });
}

/** Exact immutable edit proof, including unknown outcomes. This is read-only and
 * leaves the original intent retired/unknown; absence is never no-commit proof. */
function reconcileConversationEditImpl(intent: ConversationEditIntent, context: LanguageRecordContext) {
  const entry = edits.get(intent); if (!entry) return fail();
  languageConversationCapability.assertSource(entry.source, context);
  const source = readConversationSnapshot(context), expected = entry.expected, current = source.envelope;
  let matched = false;
  if (current && current.ownerId === expected.envelope.ownerId && current.generationId === expected.envelope.generationId) {
    const wantedSession = expected.envelope.sessions.find(item => item.sessionId === expected.effect.sessionId);
    const currentSession = current.sessions.find(item => item.sessionId === expected.effect.sessionId);
    if (intent.kind === 'delete') {
      const wanted = expected.envelope.tombstones.find(item => item.sessionId === expected.effect.sessionId);
      matched = Boolean(wanted && current.tombstones.some(item => exact(item, wanted)));
    } else if (intent.kind === 'cancel') {
      const wanted = wantedSession?.operations.find(item => item.command.operationId === expected.effect.operationId);
      matched = Boolean(wanted?.terminal && currentSession?.operations.some(item => exact(item, wanted)));
    } else matched = Boolean(wantedSession && currentSession && exact(wantedSession, currentSession));
  }
  return matched ? Object.freeze({ status: 'observed' as const, effect: expected.effect, source, acknowledged: true as const })
    : Object.freeze({ status: 'unresolved' as const, source, acknowledged: false as const });
}

function safeCommand<T extends unknown[], R>(action: (...args: T) => R): (...args: T) => R {
  return (...args) => { try { return action(...args); } catch (error) { throw error instanceof ConversationLocalError ? error : new ConversationLocalError('invalid-command'); } };
}
export const captureConversationSession = safeCommand(captureConversationSessionImpl);
export const captureConversationDraft = safeCommand(captureConversationDraftImpl);
export const captureConversationAppend = safeCommand(captureConversationAppendImpl);
export const captureConversationClose = safeCommand(captureConversationCloseImpl);
export const captureConversationCancellation = safeCommand(captureConversationCancellationImpl);
export const captureConversationDeletion = safeCommand(captureConversationDeletionImpl);
export const reconcileConversationOperation = safeCommand(reconcileConversationOperationImpl);
export const reconcileConversationIntent = safeCommand(reconcileConversationIntentImpl);
export const reconcileConversationEdit = safeCommand(reconcileConversationEditImpl);
