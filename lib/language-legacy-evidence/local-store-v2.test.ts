import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDeterministicIDBAdapter } from './idb-test-adapter.ts';
import { LocalEvidenceStore, LOCAL_EVIDENCE_DATABASE, LOCAL_EVIDENCE_DATABASE_VERSION, eventStorageKey } from './local-store.ts';
import { decodeBatchDelivery, decodeDeliveryMetadata, freezeBatch, transitionBatchDelivery } from './outbox.ts';
import { decodeFrozenEvidence } from './canonical-hash.ts';
import { canonicalEvidence, makeSourceSlotKey } from './validation.ts';
import { answer, localContext, presentation } from './local-test-fixtures.ts';
import { id, uuid } from './test-fixtures.ts';
import type { AuthenticatedReceiptReadback, DeliveryMetadata, LocalFence } from './persistence-types.ts';
import type { AuthenticatedContextProof, AuthenticatedPrefixProof } from './receipt-proof.ts';
import { MAX_PREFIX_BYTES, MAX_PREFIX_EVENTS, SERVER_EVIDENCE_PROTOCOL, type ServerEvidenceContext, type ServerEvidenceReceipt } from './server-types.ts';

const originalStores = ['events', 'checkpoints', 'commits', 'delivery', 'batches', 'audioBindings'] as const;
function harness() {
  const adapter = createDeterministicIDBAdapter(), state = { current: localContext() as LocalFence };
  const store = new LocalEvidenceStore({ factory: adapter.factory, isCurrent: fence => fence.ownerId === state.current.ownerId && fence.generationId === state.current.generationId && fence.ownerEpoch === state.current.ownerEpoch });
  return { adapter, store, state };
}
async function createV1(factory: IDBFactory): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(LOCAL_EVIDENCE_DATABASE, 1);
    request.onupgradeneeded = () => {
      for (const name of originalStores) {
        const store = request.result.createObjectStore(name);
        if (name === 'events') store.createIndex('semanticKey', 'semanticKey', { unique: true });
        if (name === 'checkpoints') store.createIndex('episodeKey', 'episodeKey', { unique: true });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { request.result.close(); resolve(); };
  });
}
function receiptFor(event: NonNullable<Awaited<ReturnType<typeof presentation>>['event']>, serverSequence = 1): ServerEvidenceReceipt {
  return { ownerId: event.ownerId, event: decodeFrozenEvidence(event), canonicalEvent: event.canonical, payloadHash: event.payloadHash,
    receivedAt: localContext().now, serverSequence, manifestDigest: 'a'.repeat(64), manifestRelease: 'synthetic-persisted-cache-v1' };
}
function serverContext(): ServerEvidenceContext {
  const context = localContext();
  return { ownerId: context.ownerId, generationId: context.generationId, resetMarker: { present: false, value: null },
    prospectiveStartedAt: context.prospectiveStartedAt, studyDayTimezone: context.studyDayTimezone, protocol: SERVER_EVIDENCE_PROTOCOL,
    manifestDigest: 'a'.repeat(64), manifestRelease: 'synthetic-persisted-cache-v1', serverTime: context.now, highWater: 1 };
}
/** A persisted cache fixture never registers a proof or claims fresh authentication. */
function seedAcknowledged(qa: ReturnType<typeof harness>, event: Parameters<typeof receiptFor>[0], sequence = 1) {
  const receipt = receiptFor(event, sequence), canonical = canonicalEvidence(receipt);
  const metadata: DeliveryMetadata = { version: 2, ownerId: event.ownerId, generationId: event.generationId, eventId: event.eventId,
    payloadHash: event.payloadHash, revision: 2, status: 'acknowledged', receiptCanonical: canonical };
  qa.adapter.seed('delivery', eventStorageKey(event.ownerId, event.eventId), metadata);
  qa.adapter.seed('receipts', JSON.stringify([event.ownerId, event.generationId, event.eventId]), { version: 1, ownerId: event.ownerId, generationId: event.generationId, canonical });
  return metadata;
}
test('v1 upgrade adds three stores and preserves all six original stores, indexes, immutable bytes and raw handoffs', async () => {
  const before = harness(), start = await presentation(); await before.store.commit(start);
  const submitted = await answer(start.checkpoint); await before.store.commit(submitted);
  const batch = await freezeBatch(id(), [start.event!, submitted.event!], null); await before.store.putBatch(start.fence, batch);
  const qa = harness(); await createV1(qa.adapter.factory);
  for (const name of originalStores) for (const [key, value] of before.adapter.entries(name)) qa.adapter.seed(name, key, value);
  const original = originalStores.map(name => qa.adapter.entries(name));
  assert.deepEqual((await qa.store.recoverOutbox(start.fence)).batches[0].batch, batch);
  assert.deepEqual(originalStores.map(name => qa.adapter.entries(name)), original);
  assert.equal((await qa.store.readCheckpoint(start.fence, start.checkpoint.sourceSlotKey))!.handoff!.answer, '合成入力だけ');
  for (const name of ['receipts', 'contexts', 'prefixes']) assert.deepEqual(qa.adapter.entries(name), []);
  await new Promise<void>((resolve, reject) => {
    const request = qa.adapter.factory.open(LOCAL_EVIDENCE_DATABASE, LOCAL_EVIDENCE_DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      assert.equal(request.result.version, 2);
      const tx = request.result.transaction(['events', 'checkpoints'], 'readonly');
      assert.ok(tx.objectStore('events').indexNames.contains('semanticKey'));
      assert.ok(tx.objectStore('checkpoints').indexNames.contains('episodeKey'));
      tx.oncomplete = () => { request.result.close(); resolve(); };
    };
  });
});
test('blocked v1 upgrade is unavailable and a later retry retains the original bytes (synthetic adapter)', async () => {
  const qa = harness(); await createV1(qa.adapter.factory); qa.adapter.blockNextOpen();
  await assert.rejects(qa.store.recoverOutbox(localContext()), /idb_blocked/);
  assert.deepEqual((await qa.store.recoverOutbox(localContext())).events, []);
});
test('v1/v2 metadata decoders reject future, unknown, malformed and falsely acknowledged forms', async () => {
  const start = await presentation(), receipt = receiptFor(start.event!);
  const pending = { ownerId: start.fence.ownerId, generationId: start.fence.generationId, eventId: start.event!.eventId,
    payloadHash: start.event!.payloadHash, revision: 1, status: 'pending' };
  assert.equal(decodeDeliveryMetadata(pending).status, 'pending');
  const acknowledged = { ...pending, version: 2, status: 'acknowledged', receiptCanonical: canonicalEvidence(receipt) };
  assert.equal(decodeDeliveryMetadata(acknowledged).status, 'acknowledged');
  for (const value of [{ ...pending, version: 1 }, { ...pending, status: 'acknowledged' }, { ...pending, status: 'sent' },
    { ...acknowledged, version: 3 }, { ...acknowledged, receiptCanonical: '{}' }, { ...pending, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...acknowledged, receiptCanonical: canonicalEvidence({ ...receipt, rawAnswer: 'PRIVATE-RAW-INPUT' }) }]) assert.throws(() => decodeDeliveryMetadata(value), /corrupt_record/);
  for (const value of [{ revision: 1, status: 'acknowledged' }, { version: 3, revision: 2, status: 'acknowledged' }, { revision: 1, status: 'pending', extra: true }]) assert.throws(() => decodeBatchDelivery(value), /corrupt_record/);
  assert.throws(() => transitionBatchDelivery({ version: 2, revision: 2, status: 'acknowledged' }, { version: 2, revision: 2, status: 'acknowledged' }, 'append_attempted'), /checkpoint_conflict/);
});
test('caller-created readback/context/prefix proof objects cannot write any authenticated state', async () => {
  const qa = harness(), start = await presentation(); await qa.store.commit(start);
  const batch = await freezeBatch(id(), [start.event!], null); await qa.store.putBatch(start.fence, batch);
  const proof = { context: localContext(), batchId: batch.batchId, exactReceipts: [receiptFor(start.event!)] } as unknown as AuthenticatedReceiptReadback;
  await assert.rejects(qa.store.acknowledgeBatch(start.fence, batch.batchId, proof, [(await qa.store.readDelivery(start.fence, start.event!.eventId))!]), /stale_context/);
  await assert.rejects(qa.store.writeVerifiedContext(start.fence, { context: localContext(), serverContext: serverContext() } as AuthenticatedContextProof), /stale_context/);
  await assert.rejects(qa.store.writeVerifiedPrefix(start.fence, { context: localContext(), serverContext: serverContext(), throughSequence: 1, records: [receiptFor(start.event!)] } as unknown as AuthenticatedPrefixProof), /stale_context/);
  for (const name of ['receipts', 'contexts', 'prefixes']) assert.equal(qa.adapter.entries(name).length, 0);
  assert.equal((await qa.store.readDelivery(start.fence, start.event!.eventId))!.status, 'pending');
});
test('retained acknowledged history is terminal, usable as a predecessor, and excluded from pending-work caps', async () => {
  const qa = harness(), start = await presentation(); await qa.store.commit(start); seedAcknowledged(qa, start.event!);
  await assert.rejects(qa.store.markReadbackRequired(start.fence, start.event!, 2), /checkpoint_conflict/);
  const submitted = await answer(start.checkpoint); await qa.store.commit(submitted);
  const batch = await freezeBatch(id(), [submitted.event!], start.checkpoint.predecessor); await qa.store.putBatch(start.fence, batch);
  assert.equal((await qa.store.recoverOutbox(start.fence, 1)).events.length, 1);
  await qa.store.quarantineBatch(start.fence, batch.batchId);
  assert.equal((await qa.store.readDelivery(start.fence, start.event!.eventId))!.status, 'acknowledged');
  assert.equal((await qa.store.readDelivery(start.fence, submitted.event!.eventId))!.status, 'quarantined');
  assert.equal(qa.adapter.entries('events').length, 2);
});
test('future metadata blocks recovery and CAS; an acknowledged row with missing or changed receipt cache is corrupt', async () => {
  const qa = harness(), start = await presentation(); await qa.store.commit(start);
  const key = eventStorageKey(start.fence.ownerId, start.event!.eventId);
  qa.adapter.tamper('delivery', key, row => ({ ...(row as object), version: 9 }));
  await assert.rejects(qa.store.recoverOutbox(start.fence), /corrupt_record/);
  await assert.rejects(qa.store.markReadbackRequired(start.fence, start.event!, 1), /corrupt_record/);
  seedAcknowledged(qa, start.event!);
  qa.adapter.tamper('receipts', JSON.stringify([start.fence.ownerId, start.fence.generationId, start.event!.eventId]), row => ({ ...(row as object), canonical: '{}' }));
  await assert.rejects(qa.store.readDelivery(start.fence, start.event!.eventId), /corrupt_record/);
  await assert.rejects(qa.store.recoverOutbox(start.fence), /corrupt_record/);
});
test('cached prefix is always offline, verifies exact sequence/hash and is covered by generation cleanup', async () => {
  const qa = harness(), start = await presentation(); await qa.store.commit(start); seedAcknowledged(qa, start.event!);
  const context = serverContext(), key = JSON.stringify([context.ownerId, context.generationId]);
  const cache = { version: 1, ownerId: context.ownerId, generationId: context.generationId, context, status: 'previously_verified_offline' };
  qa.adapter.seed('contexts', key, cache);
  qa.adapter.seed('prefixes', key, { ...cache, throughSequence: 1, records: [receiptFor(start.event!)] });
  assert.equal((await qa.store.readCachedPrefix(start.fence))!.status, 'previously_verified_offline');
  assert.equal((await qa.store.readCachedContext(start.fence))!.status, 'previously_verified_offline');
  qa.adapter.tamper('prefixes', key, row => ({ ...(row as object), throughSequence: 2 }));
  await assert.rejects(qa.store.readCachedPrefix(start.fence), /corrupt_record/);
  qa.adapter.seed('prefixes', key, { ...cache, throughSequence: 1, records: [receiptFor(start.event!)] });
  const fresh = { ...localContext(), generationId: uuid(9001) }; qa.state.current = fresh;
  await qa.store.cleanupStaleGenerations(fresh);
  for (const name of [...originalStores, 'receipts', 'contexts', 'prefixes']) assert.equal(qa.adapter.entries(name).length, 0);
});
test('new cache stores preserve current generation and other owners; forged scope blocks destructive cleanup', async () => {
  for (const corrupt of [null, 'contexts', 'prefixes', 'receipts'] as const) {
    const qa = harness(), start = await presentation(); await qa.store.commit(start); seedAcknowledged(qa, start.event!);
    const oldContext = serverContext(), freshContext = { ...oldContext, generationId: uuid(9101), highWater: 0 }, otherContext = { ...oldContext, ownerId: uuid(9102), highWater: 0 };
    for (const context of [oldContext, freshContext, otherContext]) {
      const key = JSON.stringify([context.ownerId, context.generationId]), row = { version: 1, ownerId: context.ownerId, generationId: context.generationId, context, status: 'previously_verified_offline' };
      qa.adapter.seed('contexts', key, row);
      qa.adapter.seed('prefixes', key, { ...row, throughSequence: 0, records: [] });
    }
    if (corrupt) {
      const key = corrupt === 'receipts' ? JSON.stringify([start.fence.ownerId, start.fence.generationId, start.event!.eventId]) : JSON.stringify([otherContext.ownerId, otherContext.generationId]);
      qa.adapter.tamper(corrupt, key, row => ({ ...(row as object), ownerId: uuid(9103) }));
    }
    const fresh = { ...localContext(), generationId: freshContext.generationId }; qa.state.current = fresh;
    if (corrupt) {
      await assert.rejects(qa.store.cleanupStaleGenerations(fresh), /corrupt_record/);
      assert.equal(qa.adapter.entries('events').length, 1);
    } else {
      await qa.store.cleanupStaleGenerations(fresh);
      for (const name of ['contexts', 'prefixes']) {
        const rows = qa.adapter.entries(name).map(([, row]) => row as { ownerId: string; generationId: string });
        assert.deepEqual(new Set(rows.map(row => `${row.ownerId}:${row.generationId}`)), new Set([`${freshContext.ownerId}:${freshContext.generationId}`, `${otherContext.ownerId}:${otherContext.generationId}`]));
      }
      assert.equal(qa.adapter.entries('receipts').length, 0);
    }
  }
});
test('bounded discovery streams retained acknowledged history and hashes only the pending suffix plus its exact dependencies', async t => {
  const qa = harness();
  let latest: Awaited<ReturnType<typeof presentation>> | undefined;
  for (let index = 0; index < 24; index++) {
    const start = await presentation(); await qa.store.commit(start);
    const batch = await freezeBatch(id(), [start.event!], null); await qa.store.putBatch(start.fence, batch);
    seedAcknowledged(qa, start.event!, index + 1);
    if (index % 2 === 0) qa.adapter.tamper('batches', JSON.stringify([start.fence.ownerId, start.fence.generationId, batch.batchId]), row =>
      ({ ...(row as object), delivery: { version: 2, revision: 2, status: 'acknowledged' } }));
    latest = start;
  }
  assert.ok(latest);
  const submitted = await answer(latest.checkpoint); await qa.store.commit(submitted);
  const suffix = await freezeBatch(id(), [submitted.event!], latest.checkpoint.predecessor); await qa.store.putBatch(latest.fence, suffix);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto.subtle, 'digest'), digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  let hashes = 0;
  Object.defineProperty(globalThis.crypto.subtle, 'digest', { configurable: true, value: (...args: Parameters<SubtleCrypto['digest']>) => { hashes++; return digest(...args); } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis.crypto.subtle, 'digest', descriptor); else Reflect.deleteProperty(globalThis.crypto.subtle, 'digest'); });
  const pending = await qa.store.recoverOutbox(latest.fence, 1);
  assert.deepEqual(pending.events.map(entry => entry.event.eventId), [submitted.event!.eventId]);
  assert.deepEqual(pending.batches.map(entry => entry.batch), [suffix]);
  assert.equal(hashes, 3, 'Only the pending event, its one-event frozen batch and acknowledged predecessor need hashes');
  assert.equal(qa.adapter.entries('events').length, 25, 'Retained acknowledged rows are never evicted');
  assert.equal(qa.adapter.entries('batches').length, 25);
});
test('pending cap aborts during delivery scanning before fetching the excess event; larger bounds still reject its corruption', async () => {
  const qa = harness(), first = await presentation(), excess = await presentation();
  await qa.store.commit(first); await qa.store.commit(excess);
  assert.ok(first.event!.eventId < excess.event!.eventId);
  const key = eventStorageKey(excess.fence.ownerId, excess.event!.eventId);
  qa.adapter.tamper('events', key, row => ({ ...(row as object), value: { ...excess.event!, canonical: '{}' } }));
  await assert.rejects(qa.store.recoverOutbox(first.fence, 1), /batch_limit/);
  await assert.rejects(qa.store.recoverOutbox(first.fence, 2), /corrupt_record/);
  assert.equal(qa.adapter.entries('events').length, 2);
  assert.equal(qa.adapter.entries('delivery').length, 2);
});
test('streaming integrity checks reject orphan immutable events and orphan receipts without treating them as empty history', async () => {
  for (const name of ['events', 'receipts'] as const) {
    const qa = harness(), start = await presentation();
    await qa.store.recoverOutbox(start.fence);
    if (name === 'events') qa.adapter.seed('events', eventStorageKey(start.fence.ownerId, start.event!.eventId), {
      ownerId: start.fence.ownerId, generationId: start.fence.generationId,
      semanticKey: JSON.stringify([start.fence.ownerId, start.fence.generationId, start.event!.sourceSlotKey, start.event!.sequence]), value: start.event,
    });
    else qa.adapter.seed('receipts', JSON.stringify([start.fence.ownerId, start.fence.generationId, start.event!.eventId]), {
      version: 1, ownerId: start.fence.ownerId, generationId: start.fence.generationId, canonical: canonicalEvidence(receiptFor(start.event!)),
    });
    await assert.rejects(qa.store.recoverOutbox(start.fence), /corrupt_record/);
  }
});
test('persisted prefixes reject excessive row counts and cumulative canonical bytes before hashing', async t => {
  const qa = harness(), start = await presentation(); await qa.store.commit(start);
  const context = serverContext(), key = JSON.stringify([context.ownerId, context.generationId]);
  const cache = { version: 1, ownerId: context.ownerId, generationId: context.generationId, context, status: 'previously_verified_offline' };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto.subtle, 'digest'), digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
  let hashes = 0;
  Object.defineProperty(globalThis.crypto.subtle, 'digest', { configurable: true, value: (...args: Parameters<SubtleCrypto['digest']>) => { hashes++; return digest(...args); } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis.crypto.subtle, 'digest', descriptor); else Reflect.deleteProperty(globalThis.crypto.subtle, 'digest'); });
  qa.adapter.seed('prefixes', key, { ...cache, context: { ...context, highWater: MAX_PREFIX_EVENTS + 1 }, throughSequence: MAX_PREFIX_EVENTS + 1, records: Array(MAX_PREFIX_EVENTS + 1).fill(null) });
  await assert.rejects(qa.store.readCachedPrefix(start.fence), /corrupt_record/);
  const base = receiptFor(start.event!), event = { ...base.event, source: 'course_lesson' as const, lessonSessionId: 's'.repeat(200),
    lessonId: 'l'.repeat(200), taskId: 't'.repeat(200), itemId: 'i'.repeat(200), gradingVersion: 'g'.repeat(200), legacyQuestionId: 'q'.repeat(200) };
  event.sourceSlotKey = makeSourceSlotKey(base.ownerId, event);
  const size = new TextEncoder().encode(canonicalEvidence(event)).byteLength, count = Math.floor(MAX_PREFIX_BYTES / size) + 1;
  assert.ok(count <= MAX_PREFIX_EVENTS);
  const records = Array.from({ length: count }, (_, index) => {
    const unique = { ...event, eventId: uuid(50_000 + index) };
    return { ...base, event: unique, canonicalEvent: canonicalEvidence(unique), serverSequence: index + 1 };
  });
  assert.ok(records.reduce((sum, receipt) => sum + new TextEncoder().encode(receipt.canonicalEvent).byteLength, 0) > MAX_PREFIX_BYTES);
  qa.adapter.seed('prefixes', key, { ...cache, context: { ...context, highWater: count }, throughSequence: count, records });
  await assert.rejects(qa.store.readCachedPrefix(start.fence), /corrupt_record/);
  assert.equal(hashes, 0, 'Both persisted-prefix budgets fail before crypto starts');
});
