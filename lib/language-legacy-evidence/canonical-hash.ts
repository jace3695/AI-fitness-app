import { canonicalEvidence, evidenceEventSchema, makeSourceSlotKey, validateEvidenceEvent } from './validation.ts';
import type { EvidenceEvent, ProjectionContext, TaskDescriptor } from './types.ts';
import { LOCAL_EVIDENCE_PROTOCOL, LocalEvidenceError, MAX_EVENT_BYTES, type FrozenEvidence, type Immutable } from './persistence-types.ts';

export function immutableCopy<T>(value: T): Immutable<T> {
  const copy = structuredClone(value);
  const freeze = (node: unknown): void => {
    if (node && typeof node === 'object') { Object.values(node).forEach(freeze); Object.freeze(node); }
  };
  freeze(copy);
  return copy as Immutable<T>;
}
export async function canonicalSha256(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new LocalEvidenceError('crypto_unavailable');
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}
/** SHA proves byte integrity, never authenticated storage, hearing or learner truth. */
export async function freezeEvidence(input: unknown, context: ProjectionContext, catalogue: readonly TaskDescriptor[]): Promise<FrozenEvidence> {
  const { ownerId, generationId, prospectiveStartedAt, studyDayTimezone, now } = context;
  const checked = validateEvidenceEvent(input, { ownerId, generationId, prospectiveStartedAt, studyDayTimezone, now }, catalogue);
  if (!checked.ok) throw new LocalEvidenceError('invalid_input');
  if (checked.event.source === 'item_practice') throw new LocalEvidenceError('unsupported_source');
  // Zod preserves explicit undefined on optional fields; omit those JSON-absent
  // values locally so A1's canonical serializer never receives undefined.
  const event: EvidenceEvent = JSON.parse(JSON.stringify(checked.event)), canonical = canonicalEvidence(event);
  if (new TextEncoder().encode(canonical).byteLength > MAX_EVENT_BYTES) throw new LocalEvidenceError('invalid_input');
  return immutableCopy({ protocol: LOCAL_EVIDENCE_PROTOCOL, ownerId: context.ownerId, generationId: event.generationId,
    eventId: event.eventId, episodeId: event.episodeId, sourceSlotKey: event.sourceSlotKey, sequence: event.sequence,
    canonical, payloadHash: await canonicalSha256(canonical) });
}
/** Reparse and recanonicalize: duplicate keys, extra keys and noncanonical encodings fail. */
export function decodeFrozenEvidence(value: FrozenEvidence): EvidenceEvent {
  try {
    if (Object.keys(value).sort().join(',') !== 'canonical,episodeId,eventId,generationId,ownerId,payloadHash,protocol,sequence,sourceSlotKey') throw Error();
    const event = evidenceEventSchema.parse(JSON.parse(value.canonical));
    if (value.protocol !== LOCAL_EVIDENCE_PROTOCOL || !/^[0-9a-f]{64}$/.test(value.payloadHash) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.ownerId) ||
      canonicalEvidence(event) !== value.canonical || new TextEncoder().encode(value.canonical).byteLength > MAX_EVENT_BYTES ||
      event.source === 'item_practice' || event.generationId !== value.generationId || event.eventId !== value.eventId ||
      event.episodeId !== value.episodeId || event.sourceSlotKey !== value.sourceSlotKey || event.sequence !== value.sequence ||
      event.sourceSlotKey !== makeSourceSlotKey(value.ownerId, event)) throw Error();
    return event;
  } catch { throw new LocalEvidenceError('corrupt_record'); }
}
export async function verifyFrozenEvidence(value: FrozenEvidence): Promise<EvidenceEvent> {
  const event = decodeFrozenEvidence(value);
  if (await canonicalSha256(value.canonical) !== value.payloadHash) throw new LocalEvidenceError('corrupt_record');
  return event;
}
