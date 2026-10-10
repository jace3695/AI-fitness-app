import { canonicalJson, freezeRecord, parseEnvelope, validateEnvelope, type ConversationEnvelope, type Observation, type FailureCode } from '../../lib/conversation-session/contracts.ts';
import { parseLanguageMarker } from './languageStorageBoundary.ts';
import type { StorageSnapshot } from './storageTransaction.ts';

/** A fixed singleton, not a runtime participant registry or a generic key hook. */
const PREFIX = 'yeoni-conversation-local-v1:';
export type ConversationLocalCode = FailureCode | 'invalid-owner' | 'invalid-partition' | 'unsupported-partition' | 'unproven-enrollment' | 'marker-conflict' | 'stale-authority' | 'storage-unavailable' | 'storage-unknown' | 'invalid-command';
export class ConversationLocalError extends Error {
  readonly code: ConversationLocalCode;
  readonly outcome: 'not-committed' | 'unknown';
  constructor(code: ConversationLocalCode, outcome: 'not-committed' | 'unknown' = 'not-committed') {
    super(`conversation-local:${code}`); this.name = 'ConversationLocalError'; this.code = code; this.outcome = outcome;
  }
}
export function conversationLocalKey(ownerId: string): string {
  if (typeof ownerId !== 'string' || !ownerId || ownerId.length > 160 || ownerId.trim() !== ownerId) throw new ConversationLocalError('invalid-owner');
  try { return PREFIX + encodeURIComponent(ownerId); } catch { throw new ConversationLocalError('invalid-owner'); }
}
export function readConversationPartition(raw: string | null, ownerId: string): ConversationEnvelope | null {
  conversationLocalKey(ownerId);
  if (raw === null) return null;
  const parsed = parseEnvelope(raw);
  if (parsed.status !== 'valid') throw new ConversationLocalError(parsed.code === 'unsupported-schema' ? 'unsupported-partition' : 'invalid-partition');
  const envelope = parsed.envelope;
  if (envelope.ownerId !== ownerId) throw new ConversationLocalError('invalid-partition');
  if (envelope.enrollment.kind === 'explicit-enrollment' && !envelope.enrollment.observation) throw new ConversationLocalError('unproven-enrollment');
  return envelope;
}
export type ConversationResetReplacement = Readonly<{ generationId: string; enrollmentId: string; createdAt: string }>;
/** Allocate once outside any synchronous storage transform. */
export function allocateConversationResetReplacement(): ConversationResetReplacement {
  return Object.freeze({ generationId: crypto.randomUUID(), enrollmentId: crypto.randomUUID(), createdAt: new Date().toISOString() });
}
export type ConversationResetTarget = Readonly<{
  ownerId: string; marker: string | null; reason: 'explicit-reset' | 'remote-reset' | 'observation-catch-up';
  observation?: Observation; replacement: ConversationResetReplacement;
}>;
/** Fresh lock-time input only. No clock, network, storage writes, nested lock or
 * arbitrary caller key output. Absence never enrolls a partition. */
export function planLanguageLocalParticipants(snapshot: Pick<StorageSnapshot, 'getItem'>, target: ConversationResetTarget): Readonly<Record<string, string>> {
  const key = conversationLocalKey(target.ownerId), raw = snapshot.getItem(key);
  const current = readConversationPartition(raw, target.ownerId);
  const marker = parseLanguageMarker(target.marker);
  if (marker.kind === 'invalid') throw new ConversationLocalError('marker-conflict');
  if (target.observation && (target.observation.ownerId !== target.ownerId || target.observation.marker !== target.marker)) throw new ConversationLocalError('stale-authority');
  if (!current) return Object.freeze({});
  if (current.marker === target.marker) return Object.freeze({}); // Canonical receipt or causal explicit enrollment was checked above.
  const previous = parseLanguageMarker(current.marker);
  if (marker.kind !== 'valid' || previous.kind === 'invalid' || previous.kind === 'valid' && marker.time <= previous.time) throw new ConversationLocalError('marker-conflict');
  if (target.reason !== 'explicit-reset' && !target.observation) throw new ConversationLocalError('stale-authority');
  const replacement: ConversationEnvelope = {
    schemaVersion: 1, ownerId: target.ownerId, generationId: target.replacement.generationId, marker: target.marker,
    enrollment: { kind: 'reset-replacement', enrollmentId: target.replacement.enrollmentId, createdAt: target.replacement.createdAt,
      ownerId: target.ownerId, generationId: target.replacement.generationId, previousGenerationId: current.generationId,
      previousMarker: current.marker, marker: marker.raw, reason: target.reason, requestId: marker.requestId,
      ...(target.observation ? { observation: target.observation } : {}) }, sessions: [], tombstones: [],
  };
  const checked = validateEnvelope(replacement);
  if (checked.status !== 'valid') throw new ConversationLocalError('invalid-partition');
  return freezeRecord({ [key]: canonicalJson(checked.envelope) });
}
