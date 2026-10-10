import { z } from 'zod';
import { buildFreeConversation } from '../../data/freeConversation.ts';
import { FREE_CONVERSATION_CATALOG_VERSION, FREE_CONVERSATION_SAMPLE_MATCH_POLICY, LEGACY_FREE_CONVERSATION_REVISION, findLegacyFreeConversationScript, matchFreeConversationSample } from '../../data/freeConversationCatalog.ts';
import { freezeRecord, timestampSchema as p1TimestampSchema } from '../conversation-review/contract.ts';
import { SUMMARY_POLICY_VERSION } from '../conversation-review/summary.ts';

/** Pure conversation data contracts. Nothing here grants owner or write authority. */
export const CONVERSATION_LIMITS = Object.freeze({ envelopeCodeUnits: 262_144, sessions: 25, totalTurns: 500, sessionTurns: 200, inputCodeUnits: 8000, draftLanes: 2 });
export const RESPONSE_POLICY = 'legacy-fixed-response-v1';
export const SESSION_SCHEMA_VERSION = 1;
const timestampSchema = p1TimestampSchema.max(40);
const id = z.string().min(1).max(160).refine(value => value.trim() === value);
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
const text = z.string().min(1).max(8000).refine(value => value.trim().length > 0);
// Exact legacy reset marker bytes, including fractional precision and request ID.
// Parsing a supplied time is deterministic; this never reads the clock.
export const markerSchema = z.string().max(64).refine(value => {
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z)\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(value);
  if (!match) return false;
  const time = Date.parse(match[1]);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === match[1].slice(0, 19);
}).nullable();
const marker = markerSchema;
const ref = z.strictObject({ scriptId: id, scriptRevision: id, stepId: id });
export const exposureSchema = z.strictObject({ example: z.enum(['shown', 'not-shown', 'unknown']), reading: z.enum(['shown', 'not-shown', 'unknown']), meaning: z.enum(['shown', 'not-shown', 'unknown']), hint: z.enum(['shown', 'not-shown', 'unknown']) });
export const sourceSchema = z.strictObject({
  catalogVersion: id, builderPolicy: id, matchPolicy: id, contextId: id, scriptId: id, scriptRevision: id, stepId: id,
  label: text, levelId: z.literal('unlevelled'),
  contentSource: z.strictObject({ kind: z.literal('legacy-example'), module: z.literal('data/freeConversation.ts'), exportName: z.literal('FREE_CONVERSATIONS'), entryKey: id, revision: id }),
  content: z.strictObject({ japanese: text, reading: text, pronunciation: text, meaning: text, reply: text, replyReading: text, replyPronunciation: text, hint: text }),
});
export const draftSchema = z.strictObject({
  draftId: id, revision: counter.refine(value => value > 0), savedAt: timestampSchema, input: z.string().max(8000), source: ref,
  origin: z.strictObject({ kind: z.enum(['typed', 'inserted-example']), edited: z.boolean() }), exposure: exposureSchema,
});
const emissionSchema = z.strictObject({
  branch: z.enum(['script-response', 'sample-fallback']), reply: text, replyReading: text, replyKoreanPronunciation: text,
  correction: z.literal(''), correctionReading: z.literal(''), correctionKoreanPronunciation: z.literal(''), explanation: text, source: z.literal('local'), postAnswerHint: z.literal(true),
});
const matchSchema = z.strictObject({ policyVersion: id, matched: z.boolean(), matchedAgainst: z.enum(['example', 'reading']).nullable(), assessment: z.literal('unavailable') });
export const turnSchema = z.strictObject({ turnId: id, turnRevision: z.literal(1), sequence: counter.refine(value => value > 0), predecessorTurnId: id.nullable(), recordedAt: timestampSchema, draft: draftSchema.refine(value => value.input.trim().length > 0), emission: emissionSchema, sampleMatch: matchSchema });
/** This is historical data supplied by a future trusted coordinator, never a capability,
 * signed server timestamp, local write timestamp, or claim that no later reset occurred. */
export const observationSchema = z.strictObject({ kind: z.literal('authenticated-remote-observation-received'), requestId: id, ownerId: id, ownerEpochId: id, lifecycleId: id, marker, receivedAt: timestampSchema });
const turnRefSchema = z.strictObject({ turnId: id, turnRevision: z.literal(1) });
export const boundarySchema = z.strictObject({ boundaryId: id, summaryPolicyVersion: id, turnRefs: z.array(turnRefSchema).max(200), closedAt: timestampSchema, timeZone: z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }), observation: observationSchema });
const commandBase = { operationId: id, receiptId: id, ownerId: id, generationId: id, sessionId: id, expectedHeadRevision: counter };
export const commandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...commandBase, kind: z.literal('append'), turn: turnSchema }),
  z.strictObject({ ...commandBase, kind: z.literal('close'), boundary: boundarySchema }),
]);
export const resolutionSchema = z.strictObject({ resolutionId: id, operationId: id, ownerId: id, generationId: id, sessionId: id, expectedStateRevision: counter, resolvedAt: timestampSchema });
const terminalSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('applied'), resultId: id }),
  z.strictObject({ kind: z.literal('cancelled'), resolution: resolutionSchema, recoveredDraft: draftSchema.nullable() }),
]);
const operationSchema = z.strictObject({ command: commandSchema, terminal: terminalSchema.nullable() });
export const sessionSchema = z.strictObject({
  sessionId: id, createdAt: timestampSchema, timeZone: boundarySchema.shape.timeZone, source: sourceSchema,
  stateRevision: counter, headRevision: counter, drafts: z.array(draftSchema).max(2), turns: z.array(turnSchema).max(200),
  operations: z.array(operationSchema).max(2000), closed: boundarySchema.nullable(),
});
export const deletionSchema = z.strictObject({ deletionId: id, tombstoneId: id, ownerId: id, generationId: id, sessionId: id, expectedStateRevision: counter, deletedAt: timestampSchema });
export const envelopeSchema = z.strictObject({
  schemaVersion: z.literal(1), ownerId: id, generationId: id, marker,
  enrollment: z.discriminatedUnion('kind', [
    // Optional only for compatibility with inactive pure fixtures. The production
    // participant requires a causally bound observation before preserving this form.
    z.strictObject({ kind: z.literal('explicit-enrollment'), enrollmentId: id, createdAt: timestampSchema, observation: observationSchema.optional() }),
    z.strictObject({ kind: z.literal('reset-replacement'), enrollmentId: id, createdAt: timestampSchema,
      ownerId: id, generationId: id, previousGenerationId: id, previousMarker: marker, marker: markerSchema.unwrap(),
      reason: z.enum(['explicit-reset', 'remote-reset', 'observation-catch-up']), requestId: id,
      observation: observationSchema.optional() }),
  ]),
  sessions: z.array(sessionSchema).max(25), tombstones: z.array(deletionSchema).max(2000),
});
export type ConversationSource = z.infer<typeof sourceSchema>;
export type ConversationDraft = z.infer<typeof draftSchema>;
export type ConversationTurn = z.infer<typeof turnSchema>;
export type ConversationCommand = z.infer<typeof commandSchema>;
export type ConversationResolution = z.infer<typeof resolutionSchema>;
export type ConversationDeletion = z.infer<typeof deletionSchema>;
export type ConversationSession = z.infer<typeof sessionSchema>;
export type ConversationEnvelope = z.infer<typeof envelopeSchema>;
export type ConversationBoundary = z.infer<typeof boundarySchema>;
export type Observation = z.infer<typeof observationSchema>;
export type FailureCode = 'invalid-data' | 'unsupported-schema' | 'noncanonical-data' | 'invalid-envelope' | 'capacity-exceeded' | 'unsupported-source' | 'conflict' | 'stale-source' | 'deleted' | 'closed' | 'pending-operation' | 'pinned-draft' | 'unresolved';

/** Reject symbols, hidden properties, accessors, custom prototypes and array extras.
 * Strict schemas alone would silently strip some of these in in-memory callers. */
export function isPlainJson(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Object.getPrototypeOf(value) !== (Array.isArray(value) ? Array.prototype : Object.prototype) && Object.getPrototypeOf(value) !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value) && keys.length !== value.length + 1) return false;
  for (const key of keys) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !('value' in descriptor) || !isPlainJson(descriptor.value, seen)) return false;
  }
  seen.delete(value);
  return true;
}
/** Stable exact encoding is also the persisted parser's duplicate-member defense. */
export function canonicalJson(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort) : item !== null && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sort((item as Record<string, unknown>)[key])])) : item;
  return JSON.stringify(sort(value));
}
export const exact = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
export function sourceRef(source: ConversationSource) { return { scriptId: source.scriptId, scriptRevision: source.scriptRevision, stepId: source.stepId }; }
export function freezeLegacySource(scriptId: string): ConversationSource | undefined {
  const script = findLegacyFreeConversationScript(scriptId, LEGACY_FREE_CONVERSATION_REVISION);
  if (!script) return undefined;
  return freezeRecord(sourceSchema.parse({ catalogVersion: FREE_CONVERSATION_CATALOG_VERSION, builderPolicy: RESPONSE_POLICY, matchPolicy: FREE_CONVERSATION_SAMPLE_MATCH_POLICY, contextId: script.contextId, scriptId: script.scriptId, scriptRevision: script.scriptRevision, stepId: script.steps[0].id, label: script.label, levelId: script.levelId, contentSource: script.contentSource, content: script.content }));
}
export function supportedSource(source: ConversationSource): boolean {
  const supported = freezeLegacySource(source.scriptId);
  return !!supported && exact(source, supported);
}
/** Versioned frozen-snapshot implementation. Keep aligned with actual emitted legacy
 * builder output; compatibility tests fail if either current implementation drifts. */
export function buildFrozenTurn(source: ConversationSource, draft: ConversationDraft, fields: Pick<ConversationTurn, 'turnId' | 'sequence' | 'predecessorTurnId' | 'recordedAt'>): ConversationTurn | undefined {
  if (!supportedSource(source) || !draftSchema.safeParse(draft).success || !draft.input.trim() || !exact(draft.source, sourceRef(source))) return undefined;
  const sampleMatch = matchFreeConversationSample(draft.input, source.content);
  const c = source.content;
  const response = { reply: sampleMatch.matched ? c.reply : c.japanese, replyReading: sampleMatch.matched ? c.replyReading : c.reading, replyKoreanPronunciation: sampleMatch.matched ? c.replyPronunciation : c.pronunciation, correction: '' as const, correctionReading: '' as const, correctionKoreanPronunciation: '' as const, explanation: `${sampleMatch.matched ? '연습 문장과 일치해요. 다음 응답을 듣고 따라 해보세요.' : `이 상황의 연습 문장: ${c.meaning} 자유 문장의 자동 교정은 보류 중이에요.`} ${c.hint}`, source: 'local' as const };
  const actual = buildFreeConversation(source.contentSource.entryKey as Parameters<typeof buildFreeConversation>[0], draft.input);
  if (!exact(response, actual)) return undefined;
  const parsed = turnSchema.safeParse({ ...fields, turnRevision: 1, draft, sampleMatch, emission: { ...response, branch: sampleMatch.matched ? 'script-response' : 'sample-fallback', postAnswerHint: true } });
  return parsed.success ? freezeRecord(parsed.data) : undefined;
}
export { freezeRecord, SUMMARY_POLICY_VERSION };

export function appliedSession(session: ConversationSession, command: ConversationCommand): ConversationSession {
  return { ...session, stateRevision: session.stateRevision + 1, headRevision: session.headRevision + 1,
    turns: command.kind === 'append' ? [...session.turns, command.turn] : session.turns,
    drafts: command.kind === 'append' ? session.drafts.filter(draft => !exact(draft, command.turn.draft)) : session.drafts,
    closed: command.kind === 'close' ? command.boundary : session.closed,
    operations: session.operations.map(op => op.command.operationId === command.operationId ? { command: op.command, terminal: { kind: 'applied' as const, resultId: command.kind === 'append' ? command.turn.turnId : command.boundary.boundaryId } } : op),
  };
}
export function cancelledSession(session: ConversationSession, command: ConversationCommand, resolution: ConversationResolution): ConversationSession {
  return { ...session, stateRevision: session.stateRevision + 1, operations: session.operations.map(op => op.command.operationId === command.operationId ? { command: op.command, terminal: { kind: 'cancelled' as const, resolution, recoveredDraft: command.kind === 'append' ? command.turn.draft : null } } : op) };
}
/** Conservative exact-serialization budget. Metadata placeholders cover maximum
 * escaping, not just visible ID length. No unused reservation can be spent by
 * another session, and pending turns reserve count capacity too. This is NOT a
 * browser quota reservation; the shared journal and other owner partitions cost more. */
export function capacityUsage(envelope: ConversationEnvelope) {
  const worstId = '\u0000'.repeat(160), worstTime = '0'.repeat(40), worstCounter = Number.MAX_SAFE_INTEGER - 1;
  let reservedCodeUnits = 0, reservedTurns = 0;
  for (const session of envelope.sessions) {
    const pending = session.operations.find(op => op.terminal === null);
    if (pending) {
      const command = pending.command;
      const resolution = { resolutionId: worstId, operationId: command.operationId, ownerId: envelope.ownerId, generationId: envelope.generationId, sessionId: session.sessionId, expectedStateRevision: worstCounter, resolvedAt: worstTime };
      const applied = appliedSession(session, command);
      const cancelled = cancelledSession(session, command, resolution);
      // Future edits can increase the state revision's serialized digit count.
      applied.stateRevision = worstCounter; cancelled.stateRevision = worstCounter;
      reservedCodeUnits += Math.max(0, canonicalJson(applied).length - canonicalJson(session).length, canonicalJson(cancelled).length - canonicalJson(session).length);
      if (command.kind === 'append') reservedTurns++;
    }
    // Reserve an additional full tombstone even though deletion removes the session.
    // This deliberately overestimates; permanent metadata is never silently pruned.
    reservedCodeUnits += canonicalJson({ deletionId: worstId, tombstoneId: worstId, ownerId: envelope.ownerId, generationId: envelope.generationId, sessionId: session.sessionId, expectedStateRevision: worstCounter, deletedAt: worstTime }).length + 1;
  }
  const actualCodeUnits = canonicalJson(envelope).length;
  const committedTurns = envelope.sessions.reduce((sum, session) => sum + session.turns.length, 0);
  return { actualCodeUnits, reservedCodeUnits, admittedCodeUnits: actualCodeUnits + reservedCodeUnits, committedTurns, reservedTurns };
}

function coherent(envelope: ConversationEnvelope): boolean {
  const enrollment = envelope.enrollment;
  if (enrollment.observation && (enrollment.observation.ownerId !== envelope.ownerId || enrollment.observation.marker !== envelope.marker)) return false;
  if (enrollment.kind === 'reset-replacement') {
    if (enrollment.ownerId !== envelope.ownerId || enrollment.generationId !== envelope.generationId || enrollment.previousGenerationId === envelope.generationId
      || enrollment.marker !== envelope.marker || enrollment.requestId !== enrollment.marker.split('|')[1]
      || (enrollment.reason !== 'explicit-reset' && !enrollment.observation)) return false;
    if (enrollment.previousMarker !== null && Date.parse(enrollment.previousMarker.split('|')[0]) >= Date.parse(enrollment.marker.split('|')[0])) return false;
  }
  const draftOwners = new Map<string, string>(), draftVersions = new Map<string, string>();
  const sessionIds = new Set<string>(), operationIds = new Set<string>(), turnIds = new Set<string>(), resultIds = new Set<string>(), resolutionIds = new Set<string>(), commandResultIds = new Set<string>(), deletionIds = new Set<string>(), draftIds = new Set<string>();
  const add = (set: Set<string>, value: string) => { if (set.has(value)) return false; set.add(value); return true; };
  for (const tombstone of envelope.tombstones) {
    if (tombstone.ownerId !== envelope.ownerId || tombstone.generationId !== envelope.generationId || !add(sessionIds, tombstone.sessionId) || !add(deletionIds, tombstone.deletionId) || !add(resultIds, tombstone.tombstoneId)) return false;
  }
  for (const session of envelope.sessions) {
    if (!add(sessionIds, session.sessionId) || session.headRevision !== session.turns.length + (session.closed ? 1 : 0) || session.stateRevision < session.headRevision || session.operations.filter(op => op.terminal === null).length > 1) return false;
    const pinnedSource = freezeLegacySource(session.source.scriptId);
    // Known revision/policies cannot be used to launder fabricated authored text.
    if (session.source.scriptRevision === LEGACY_FREE_CONVERSATION_REVISION && pinnedSource && !exact(session.source, pinnedSource)) return false;
    if (session.source.contentSource.revision !== session.source.scriptRevision) return false;
    const checkDraft = (draft: ConversationDraft) => {
      const identity = canonicalJson([draft.draftId, draft.revision]), bytes = canonicalJson(draft);
      if ((draftOwners.has(draft.draftId) && draftOwners.get(draft.draftId) !== session.sessionId) || (draftVersions.has(identity) && draftVersions.get(identity) !== bytes)) return false;
      draftOwners.set(draft.draftId, session.sessionId); draftVersions.set(identity, bytes);
      return exact(draft.source, sourceRef(session.source)) && !(draft.origin.kind === 'typed' && draft.origin.edited) && !(draft.origin.kind === 'inserted-example' && (draft.exposure.example !== 'shown' || (!draft.origin.edited && draft.input !== session.source.content.japanese)));
    };
    for (const draft of session.drafts) if (!add(draftIds, draft.draftId) || !checkDraft(draft)) return false;
    for (let i = 0; i < session.turns.length; i++) {
      const turn = session.turns[i];
      if (!add(turnIds, turn.turnId) || turn.sequence !== i + 1 || turn.predecessorTurnId !== (session.turns[i - 1]?.turnId ?? null) || !checkDraft(turn.draft)) return false;
      if (supportedSource(session.source) && !exact(turn, buildFrozenTurn(session.source, turn.draft, turn))) return false;
    }
    const appliedTurns = new Set<string>(); let appliedClose = 0;
    for (const operation of session.operations) {
      const command = operation.command;
      if (command.ownerId !== envelope.ownerId || command.generationId !== envelope.generationId || command.sessionId !== session.sessionId || !add(operationIds, command.operationId) || !add(resultIds, command.receiptId)) return false;
      if (command.expectedHeadRevision > session.turns.length || !add(commandResultIds, command.kind === 'append' ? command.turn.turnId : command.boundary.boundaryId)) return false;
      if (command.kind === 'append') {
        if (command.turn.sequence !== command.expectedHeadRevision + 1 || command.turn.predecessorTurnId !== (session.turns[command.expectedHeadRevision - 1]?.turnId ?? null) || !checkDraft(command.turn.draft)) return false;
        if (supportedSource(session.source) && !exact(command.turn, buildFrozenTurn(session.source, command.turn.draft, command.turn))) return false;
      } else {
        if (command.boundary.observation.ownerId !== envelope.ownerId || command.boundary.observation.marker !== envelope.marker || !exact(command.boundary.turnRefs, session.turns.slice(0, command.expectedHeadRevision).map(turn => ({ turnId: turn.turnId, turnRevision: turn.turnRevision })))) return false;
      }
      if (operation.terminal === null) {
        if (session.closed || command.expectedHeadRevision !== session.headRevision || session.stateRevision >= Number.MAX_SAFE_INTEGER - 1) return false;
        if (command.kind === 'append' && !session.drafts.some(draft => exact(draft, command.turn.draft))) return false;
      } else if (operation.terminal.kind === 'applied') {
        if (command.kind === 'append') {
          if (operation.terminal.resultId !== command.turn.turnId || appliedTurns.has(command.turn.turnId) || !session.turns.some(turn => exact(turn, command.turn))) return false;
          appliedTurns.add(command.turn.turnId);
        } else {
          if (operation.terminal.resultId !== command.boundary.boundaryId || !exact(session.closed, command.boundary)) return false;
          appliedClose++;
        }
      } else {
        const r = operation.terminal.resolution;
        if (!add(resolutionIds, r.resolutionId) || r.ownerId !== envelope.ownerId || r.generationId !== envelope.generationId || r.sessionId !== session.sessionId || r.operationId !== command.operationId || r.expectedStateRevision >= session.stateRevision || !exact(operation.terminal.recoveredDraft, command.kind === 'append' ? command.turn.draft : null)) return false;
        if (command.kind === 'append' && session.turns.some(turn => turn.turnId === command.turn.turnId)) return false;
      }
    }
    if (appliedTurns.size !== session.turns.length || appliedClose !== (session.closed ? 1 : 0)) return false;
    if (session.closed && !exact(session.closed.turnRefs, session.turns.map(turn => ({ turnId: turn.turnId, turnRevision: turn.turnRevision })))) return false;
    if (session.turns.length + session.operations.filter(op => op.terminal === null && op.command.kind === 'append').length > CONVERSATION_LIMITS.sessionTurns) return false;
  }
  return true;
}
export function validateEnvelope(value: unknown): { status: 'valid'; envelope: ConversationEnvelope } | { status: 'blocked'; code: FailureCode } {
  try {
    if (!isPlainJson(value)) return { status: 'blocked', code: 'invalid-data' };
    const parsed = envelopeSchema.safeParse(value);
    if (!parsed.success) return { status: 'blocked', code: 'invalid-envelope' };
    if (!coherent(parsed.data)) return { status: 'blocked', code: 'invalid-envelope' };
    if (parsed.data.tombstones.length + parsed.data.sessions.length > 2000) return { status: 'blocked', code: 'capacity-exceeded' };
    const capacity = capacityUsage(parsed.data);
    if (capacity.admittedCodeUnits > CONVERSATION_LIMITS.envelopeCodeUnits || capacity.committedTurns + capacity.reservedTurns > CONVERSATION_LIMITS.totalTurns) return { status: 'blocked', code: 'capacity-exceeded' };
    return { status: 'valid', envelope: freezeRecord(parsed.data) };
  } catch { return { status: 'blocked', code: 'invalid-data' }; }
}
/** Failure carries a fixed code only. The caller retains raw bytes untouched; do
 * not overwrite, log, normalize, render or attach opaque source on failure. */
export function parseEnvelope(raw: string): ReturnType<typeof validateEnvelope> {
  if (typeof raw !== 'string' || raw.length > CONVERSATION_LIMITS.envelopeCodeUnits) return { status: 'blocked', code: 'capacity-exceeded' };
  try {
    const value: unknown = JSON.parse(raw);
    if (value !== null && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion !== 1) return { status: 'blocked', code: 'unsupported-schema' };
    if (canonicalJson(value) !== raw) return { status: 'blocked', code: 'noncanonical-data' };
    return validateEnvelope(value);
  } catch { return { status: 'blocked', code: 'invalid-data' }; }
}
export function encodeEnvelope(value: unknown): { status: 'encoded'; raw: string } | { status: 'blocked'; code: FailureCode } {
  const validated = validateEnvelope(value);
  return validated.status === 'valid' ? { status: 'encoded', raw: canonicalJson(validated.envelope) } : validated;
}
