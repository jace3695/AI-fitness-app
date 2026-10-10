import { canonicalEvidence } from './validation.ts';
import { immutableCopy, verifyFrozenEvidence } from './canonical-hash.ts';
import { LocalEvidenceError, MAX_BATCH_BYTES, MAX_BATCH_EVENTS, type BatchDelivery, type FrozenBatch, type FrozenEvidence, type Predecessor } from './persistence-types.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** A single exact episode prefix/suffix. IDs and order never change on a retry. */
export async function freezeBatch(batchId: string, events: readonly FrozenEvidence[], expectedPredecessor: Predecessor): Promise<FrozenBatch> {
  if (!events.length) throw new LocalEvidenceError('batch_limit');
  const first = events[0];
  const batch = immutableCopy({ version: 1 as const, batchId, ownerId: first.ownerId, generationId: first.generationId,
    sourceSlotKey: first.sourceSlotKey, episodeId: first.episodeId, expectedPredecessor, events: [...events] });
  await verifyFrozenBatch(batch);
  return batch;
}
export async function verifyFrozenBatch(batch: FrozenBatch): Promise<void> {
  if (!batch || Object.keys(batch).sort().join(',') !== 'batchId,episodeId,events,expectedPredecessor,generationId,ownerId,sourceSlotKey,version' ||
    batch.version !== 1 || !uuid.test(batch.batchId) || !Array.isArray(batch.events) || batch.events.length === 0 ||
    batch.events.length > MAX_BATCH_EVENTS) throw new LocalEvidenceError('batch_limit');
  let bytes = 0;
  const ids = new Set<string>(), predecessor = batch.expectedPredecessor;
  if (predecessor !== null && (Object.keys(predecessor).sort().join(',') !== 'eventId,payloadHash,sequence' ||
    !uuid.test(predecessor.eventId) || !/^[0-9a-f]{64}$/.test(predecessor.payloadHash) ||
    !Number.isSafeInteger(predecessor.sequence) || predecessor.sequence < 0)) throw new LocalEvidenceError('invalid_input');
  for (let index = 0; index < batch.events.length; index++) {
    const value = batch.events[index]; await verifyFrozenEvidence(value);
    bytes += new TextEncoder().encode(value.canonical).byteLength;
    if (value.ownerId !== batch.ownerId || value.generationId !== batch.generationId || value.sourceSlotKey !== batch.sourceSlotKey || value.episodeId !== batch.episodeId ||
      value.sequence !== (predecessor?.sequence ?? -1) + index + 1 || ids.has(value.eventId)) throw new LocalEvidenceError('event_conflict');
    ids.add(value.eventId);
  }
  if (bytes > MAX_BATCH_BYTES) throw new LocalEvidenceError('batch_limit');
}
/** Local delivery state only. An RPC success or caller-supplied receipt/hash cannot acknowledge. */
export function transitionBatchDelivery(current: BatchDelivery, expected: BatchDelivery,
  action: 'append_attempted' | 'readback_missing' | 'readback_failed' | 'conflict'): BatchDelivery {
  if (canonicalEvidence(current) !== canonicalEvidence(expected) || !Number.isSafeInteger(current.revision) || current.revision < 1 ||
    !['pending', 'readback_required', 'quarantined'].includes(current.status)) throw new LocalEvidenceError('checkpoint_conflict');
  if (current.status === 'quarantined') throw new LocalEvidenceError('quarantined');
  if (!['append_attempted', 'readback_missing', 'readback_failed', 'conflict'].includes(action)) throw new LocalEvidenceError('invalid_input');
  return { revision: current.revision + 1, status: action === 'conflict' ? 'quarantined' : 'readback_required' };
}
