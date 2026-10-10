import { canonicalEvidence } from './validation.ts';
import { serverEvidenceReceiptSchema } from './server-types.ts';
import { decodeFrozenEvidence, immutableCopy, verifyFrozenEvidence } from './canonical-hash.ts';
import { LocalEvidenceError, MAX_BATCH_BYTES, MAX_BATCH_EVENTS, type BatchDelivery, type DeliveryMetadata, type FrozenBatch, type FrozenEvidence, type Predecessor } from './persistence-types.ts';

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
/** Synchronous structure/byte validation for bounded IDB discovery; no receipt trust. */
export function decodeFrozenBatch(input: unknown): FrozenBatch {
  const batch = input as FrozenBatch;
  if (!batch || Object.keys(batch).sort().join(',') !== 'batchId,episodeId,events,expectedPredecessor,generationId,ownerId,sourceSlotKey,version' ||
    batch.version !== 1 || !uuid.test(batch.batchId) || !Array.isArray(batch.events) || batch.events.length === 0 ||
    batch.events.length > MAX_BATCH_EVENTS) throw new LocalEvidenceError('batch_limit');
  let bytes = 0;
  const ids = new Set<string>(), predecessor = batch.expectedPredecessor;
  if (predecessor !== null && (Object.keys(predecessor).sort().join(',') !== 'eventId,payloadHash,sequence' ||
    !uuid.test(predecessor.eventId) || !/^[0-9a-f]{64}$/.test(predecessor.payloadHash) ||
    !Number.isSafeInteger(predecessor.sequence) || predecessor.sequence < 0)) throw new LocalEvidenceError('invalid_input');
  for (let index = 0; index < batch.events.length; index++) {
    const value = batch.events[index]; decodeFrozenEvidence(value);
    bytes += new TextEncoder().encode(value.canonical).byteLength;
    if (value.ownerId !== batch.ownerId || value.generationId !== batch.generationId || value.sourceSlotKey !== batch.sourceSlotKey || value.episodeId !== batch.episodeId ||
      value.sequence !== (predecessor?.sequence ?? -1) + index + 1 || ids.has(value.eventId)) throw new LocalEvidenceError('event_conflict');
    ids.add(value.eventId);
  }
  if (bytes > MAX_BATCH_BYTES) throw new LocalEvidenceError('batch_limit');
  return immutableCopy(batch);
}
export async function verifyFrozenBatch(input: FrozenBatch): Promise<void> {
  const batch = decodeFrozenBatch(input);
  for (const value of batch.events) await verifyFrozenEvidence(value);
}
/** Local delivery state only. An RPC success or caller-supplied receipt/hash cannot acknowledge. */
export function transitionBatchDelivery(current: BatchDelivery, expected: BatchDelivery,
  action: 'append_attempted' | 'readback_missing' | 'readback_failed' | 'conflict'): BatchDelivery {
  decodeBatchDelivery(current); decodeBatchDelivery(expected);
  if (canonicalEvidence(current) !== canonicalEvidence(expected) || current.status === 'acknowledged' || current.revision >= Number.MAX_SAFE_INTEGER) throw new LocalEvidenceError('checkpoint_conflict');
  if (current.status === 'quarantined') throw new LocalEvidenceError('quarantined');
  if (!['append_attempted', 'readback_missing', 'readback_failed', 'conflict'].includes(action)) throw new LocalEvidenceError('invalid_input');
  return { revision: current.revision + 1, status: action === 'conflict' ? 'quarantined' : 'readback_required' };
}

/** V1 rows have no version key. Only a strict v2 row may represent acknowledgement. */
export function decodeDeliveryMetadata(input: unknown): DeliveryMetadata {
  try {
    if (!input || typeof input !== 'object') throw Error();
    const value = input as DeliveryMetadata;
    const acknowledged = value.status === 'acknowledged';
    if (Object.keys(value).sort().join(',') !== (acknowledged ?
      'eventId,generationId,ownerId,payloadHash,receiptCanonical,revision,status,version' :
      'eventId,generationId,ownerId,payloadHash,revision,status') ||
      !uuid.test(value.ownerId) || !uuid.test(value.generationId) || !uuid.test(value.eventId) ||
      !/^[0-9a-f]{64}$/.test(value.payloadHash) || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      !['pending', 'readback_required', 'quarantined', 'acknowledged'].includes(value.status)) throw Error();
    if (acknowledged) {
      if (value.version !== 2 || typeof value.receiptCanonical !== 'string') throw Error();
      const receipt = serverEvidenceReceiptSchema.parse(JSON.parse(value.receiptCanonical));
      if (canonicalEvidence(receipt) !== value.receiptCanonical || receipt.ownerId !== value.ownerId ||
        receipt.event.generationId !== value.generationId || receipt.event.eventId !== value.eventId || receipt.payloadHash !== value.payloadHash) throw Error();
    }
    return immutableCopy(value);
  } catch { throw new LocalEvidenceError('corrupt_record'); }
}
export function decodeBatchDelivery(input: unknown): BatchDelivery {
  try {
    if (!input || typeof input !== 'object') throw Error();
    const value = input as BatchDelivery;
    if (Object.keys(value).sort().join(',') !== (value.status === 'acknowledged' ? 'revision,status,version' : 'revision,status') ||
      !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      !['pending', 'readback_required', 'quarantined', 'acknowledged'].includes(value.status) ||
      (value.status === 'acknowledged' && value.version !== 2)) throw Error();
    return immutableCopy(value);
  } catch { throw new LocalEvidenceError('corrupt_record'); }
}
