import { canonicalEvidence, makeSourceSlotKey } from './validation.ts';
import { canonicalSha256, decodeFrozenEvidence, immutableCopy, verifyFrozenEvidence } from './canonical-hash.ts';
import { parseCheckpoint, verifyPreparedCapture } from './capture.ts';
import { LocalEvidenceError, MAX_EVENT_BYTES, type CaptureCheckpoint, type DeliveryMetadata, type FrozenBatch, type FrozenEvidence,
  type AuthenticatedReceiptReadback, type BatchDelivery, type LocalCommitResult, type LocalEvidenceContext, type LocalFence, type PreparedCapture } from './persistence-types.ts';
import { decodeBatchDelivery, decodeDeliveryMetadata, decodeFrozenBatch, verifyFrozenBatch } from './outbox.ts';
import { assertAuthenticatedContext, assertAuthenticatedPrefix, assertAuthenticatedReceiptReadback, type AuthenticatedContextProof, type AuthenticatedPrefixProof } from './receipt-proof.ts';
import { MAX_PREFIX_BYTES, MAX_PREFIX_EVENTS, serverEvidenceContextSchema, serverEvidenceReceiptSchema, type CachedEvidenceContext, type CachedEvidencePrefix, type ServerEvidenceReceipt } from './server-types.ts';

export const LOCAL_EVIDENCE_DATABASE = 'yeoni-legacy-language-evidence-v1';
export const LOCAL_EVIDENCE_DATABASE_VERSION = 2;
const STORES = ['events', 'checkpoints', 'commits', 'delivery', 'batches', 'audioBindings', 'receipts', 'contexts', 'prefixes'] as const;
type StoreName = typeof STORES[number];
type ScopedRow = { ownerId: string; generationId: string };
type EventRow = ScopedRow & { semanticKey: string; value: FrozenEvidence };
type CheckpointRow = ScopedRow & { episodeKey: string; latestTransitionId: string; value: CaptureCheckpoint };
type CommitRow = ScopedRow & { canonical: string };
type BatchRow = ScopedRow & { canonical: string; delivery: BatchDelivery };
type ReceiptRow = ScopedRow & { version: 1; canonical: string };
const scopeKey = (scope: ScopedRow) => JSON.stringify([scope.ownerId, scope.generationId]);
const receiptKey = (scope: ScopedRow, eventId: string) => JSON.stringify([scope.ownerId, scope.generationId, eventId]);
const batchStorageKey = (scope: ScopedRow, batchId: string) => JSON.stringify([scope.ownerId, scope.generationId, batchId]);
export const eventStorageKey = (owner: string, eventId: string) => JSON.stringify([owner, eventId]);
export const checkpointStorageKey = (owner: string, generation: string, slot: string) => JSON.stringify([owner, generation, slot]);
const commitKey = (value: PreparedCapture) => JSON.stringify([value.fence.ownerId, value.fence.generationId, value.transitionId]);
const episodeKey = (cp: CaptureCheckpoint) => JSON.stringify([cp.ownerId, cp.generationId, cp.episodeId]);
const same = (a: unknown, b: unknown) => canonicalEvidence(a) === canonicalEvidence(b);
const advanceRevision = (revision: number): number => {
  if (!Number.isSafeInteger(revision) || revision < 1 || revision >= Number.MAX_SAFE_INTEGER) throw new LocalEvidenceError('corrupt_record');
  return revision + 1;
};

function checkedReceiptRow(row: ReceiptRow): ServerEvidenceReceipt {
  try {
    if (Object.keys(row).sort().join(',') !== 'canonical,generationId,ownerId,version' || row.version !== 1) throw Error();
    const receipt = serverEvidenceReceiptSchema.parse(JSON.parse(row.canonical));
    if (canonicalEvidence(receipt) !== row.canonical || receipt.ownerId !== row.ownerId || receipt.event.generationId !== row.generationId) throw Error();
    return receipt;
  } catch { throw new LocalEvidenceError('corrupt_record'); }
}
function checkedCacheRow(input: unknown, prefix: boolean): CachedEvidenceContext | CachedEvidencePrefix {
  try {
    const value = input as CachedEvidencePrefix;
    if (!value || Object.keys(value).sort().join(',') !== (prefix ? 'context,generationId,ownerId,records,status,throughSequence,version' : 'context,generationId,ownerId,status,version') ||
      value.version !== 1 || value.status !== 'previously_verified_offline') throw Error();
    const context = serverEvidenceContextSchema.parse(value.context);
    if (value.ownerId !== context.ownerId || value.generationId !== context.generationId) throw Error();
    if (prefix) {
      if (!Number.isSafeInteger(value.throughSequence) || value.throughSequence < 0 || value.throughSequence > context.highWater ||
        !Array.isArray(value.records) || value.records.length > MAX_PREFIX_EVENTS || value.records.length !== value.throughSequence) throw Error();
      const ids = new Set<string>(), encoder = new TextEncoder();
      let payloadBytes = 0;
      value.records.forEach((input, index) => {
        if (!input || typeof input.canonicalEvent !== 'string' || input.canonicalEvent.length > MAX_EVENT_BYTES) throw Error();
        payloadBytes += encoder.encode(input.canonicalEvent).byteLength;
        if (payloadBytes > MAX_PREFIX_BYTES) throw Error();
        const receipt = serverEvidenceReceiptSchema.parse(input);
        if (receipt.ownerId !== value.ownerId || receipt.event.generationId !== value.generationId || receipt.serverSequence !== index + 1 || ids.has(receipt.event.eventId) ||
          receipt.event.sourceSlotKey !== makeSourceSlotKey(value.ownerId, receipt.event) || Date.parse(receipt.event.occurredAt) < Date.parse(context.prospectiveStartedAt) ||
          Date.parse(receipt.receivedAt) < Date.parse(receipt.event.occurredAt) || Date.parse(receipt.receivedAt) > Date.parse(context.serverTime)) throw Error();
        ids.add(receipt.event.eventId);
      });
    }
    return value;
  } catch { throw new LocalEvidenceError('corrupt_record'); }
}

/** Destructive cleanup never trusts wrapper scope without the immutable key/body. */
function cleanupIdentity(name: StoreName, key: IDBValidKey, input: unknown): ScopedRow {
  try {
    const row = input as ScopedRow & Record<string, unknown>;
    if (!row || typeof row.ownerId !== 'string' || typeof row.generationId !== 'string' || typeof key !== 'string') throw Error();
    let expectedKey: string;
    if (name === 'events') {
      const value = row.value as FrozenEvidence; decodeFrozenEvidence(value);
      if (value.ownerId !== row.ownerId || value.generationId !== row.generationId || row.semanticKey !== JSON.stringify([row.ownerId, row.generationId, value.sourceSlotKey, value.sequence])) throw Error();
      expectedKey = eventStorageKey(row.ownerId, value.eventId);
    } else if (name === 'checkpoints') {
      const value = parseCheckpoint(row.value);
      if (value.ownerId !== row.ownerId || value.generationId !== row.generationId || row.episodeKey !== episodeKey(value)) throw Error();
      expectedKey = checkpointStorageKey(row.ownerId, row.generationId, value.sourceSlotKey);
    } else if (name === 'commits' || name === 'batches') {
      if (typeof row.canonical !== 'string') throw Error();
      const value = JSON.parse(row.canonical);
      const scope = name === 'commits' ? value.fence : value;
      if (canonicalEvidence(value) !== row.canonical || scope.ownerId !== row.ownerId || scope.generationId !== row.generationId) throw Error();
      expectedKey = JSON.stringify([row.ownerId, row.generationId, name === 'commits' ? value.transitionId : value.batchId]);
    } else if (name === 'delivery') {
      const delivery = decodeDeliveryMetadata(row);
      expectedKey = eventStorageKey(delivery.ownerId, delivery.eventId);
    } else if (name === 'receipts') {
      const receipt = checkedReceiptRow(row as ReceiptRow);
      expectedKey = receiptKey(row, receipt.event.eventId);
    } else if (name === 'contexts' || name === 'prefixes') {
      checkedCacheRow(row, name === 'prefixes'); expectedKey = scopeKey(row);
    } else {
      if (typeof row.requestId !== 'string' || typeof row.sourceSlotKey !== 'string' || typeof row.episodeId !== 'string') throw Error();
      expectedKey = JSON.stringify([row.ownerId, row.generationId, row.requestId]);
    }
    if (key !== expectedKey) throw Error();
    return { ownerId: row.ownerId, generationId: row.generationId };
  } catch { throw new LocalEvidenceError('corrupt_record'); }
}
function checkedCheckpointRow(row: CheckpointRow, journal: CommitRow | undefined): CaptureCheckpoint {
  const cp = parseCheckpoint(row.value);
  try {
    if (!journal || journal.ownerId !== cp.ownerId || journal.generationId !== cp.generationId || row.ownerId !== cp.ownerId ||
      row.generationId !== cp.generationId || row.episodeKey !== episodeKey(cp)) throw Error();
    const committed = JSON.parse(journal.canonical) as PreparedCapture;
    if (canonicalEvidence(committed) !== journal.canonical || committed.transitionId !== row.latestTransitionId ||
      committed.fence.ownerId !== cp.ownerId || committed.fence.generationId !== cp.generationId || !same(committed.checkpoint, cp)) throw Error();
    return cp;
  } catch { throw new LocalEvidenceError('corrupt_record'); }
}
function storageError(error: unknown, fallback: 'storage_abort' | 'storage_read_failed' = 'storage_abort'): LocalEvidenceError {
  if (error instanceof LocalEvidenceError) return error;
  if (error && typeof error === 'object' && 'name' in error && error.name === 'QuotaExceededError') return new LocalEvidenceError('storage_quota');
  if (error && typeof error === 'object' && 'name' in error && error.name === 'ConstraintError') return new LocalEvidenceError('event_conflict');
  if (error && typeof error === 'object' && 'name' in error && error.name === 'SecurityError') return new LocalEvidenceError('idb_unavailable');
  if (error && typeof error === 'object' && 'name' in error && error.name === 'VersionError') return new LocalEvidenceError('idb_version_changed');
  return new LocalEvidenceError(fallback);
}
type Connection = { db: IDBDatabase; versionChanged: boolean; transactions: Set<IDBTransaction> };
function openDatabase(factory: IDBFactory | undefined): Promise<Connection> {
  if (!factory) return Promise.reject(new LocalEvidenceError('idb_unavailable'));
  return new Promise((resolve, reject) => {
    let failed = false;
    let request: IDBOpenDBRequest;
    try { request = factory.open(LOCAL_EVIDENCE_DATABASE, LOCAL_EVIDENCE_DATABASE_VERSION); } catch (error) { reject(storageError(error)); return; }
    request.onupgradeneeded = () => {
      for (const name of STORES) {
        if (request.result.objectStoreNames.contains(name)) continue;
        const store = request.result.createObjectStore(name);
        if (name === 'events') store.createIndex('semanticKey', 'semanticKey', { unique: true });
        if (name === 'checkpoints') store.createIndex('episodeKey', 'episodeKey', { unique: true });
      }
    };
    request.onblocked = () => { failed = true; reject(new LocalEvidenceError('idb_blocked')); };
    request.onerror = () => { failed = true; reject(storageError(request.error)); };
    request.onsuccess = () => {
      if (failed) { request.result.close(); return; }
      const connection: Connection = { db: request.result, versionChanged: false, transactions: new Set() };
      connection.db.onversionchange = () => {
        connection.versionChanged = true;
        for (const tx of connection.transactions) { try { tx.abort(); } catch { /* already settled */ } }
        connection.db.close();
      };
      resolve(connection);
    };
  });
}

/** Inactive until explicitly constructed. No fallback, network, timers or global listeners. */
export class LocalEvidenceStore {
  private readonly factory: IDBFactory | undefined;
  private readonly isCurrent: (fence: LocalFence) => boolean;
  constructor(options: { factory?: IDBFactory; isCurrent: (fence: LocalFence) => boolean }) {
    this.factory = options.factory ?? globalThis.indexedDB;
    this.isCurrent = options.isCurrent;
  }
  private fence(value: LocalFence): void {
    if (!this.isCurrent(value)) throw new LocalEvidenceError('stale_context');
  }
  /** All callbacks are synchronous. Crypto/validation awaits happen outside IDB transactions. */
  private async transaction<T>(fence: LocalFence, mode: IDBTransactionMode,
    work: (tx: IDBTransaction, setResult: (result: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
    this.fence(fence);
    const connection = await openDatabase(this.factory);
    try {
      this.fence(fence);
      const result = await new Promise<T>((resolve, reject) => {
        if (connection.versionChanged) { reject(new LocalEvidenceError('idb_version_changed')); return; }
        let tx: IDBTransaction;
        try { tx = connection.db.transaction([...STORES], mode); } catch (error) { reject(storageError(error)); return; }
        connection.transactions.add(tx);
        let result: T, failure: unknown;
        const fail = (error: unknown) => { failure = error; try { tx.abort(); } catch { reject(storageError(error)); } };
        tx.oncomplete = () => { connection.transactions.delete(tx); resolve(result); };
        tx.onerror = () => { failure ??= tx.error; };
        tx.onabort = () => {
          connection.transactions.delete(tx);
          reject(connection.versionChanged ? new LocalEvidenceError('idb_version_changed') : storageError(failure ?? tx.error, mode === 'readonly' ? 'storage_read_failed' : 'storage_abort'));
        };
        try { work(tx, value => { result = value; }, fail); } catch (error) { fail(error); }
      });
      if (connection.versionChanged) throw new LocalEvidenceError('idb_version_changed');
      this.fence(fence);
      return result;
    } finally { connection.db.close(); }
  }
  async readCheckpoint(fence: LocalFence, sourceSlotKey: string): Promise<CaptureCheckpoint | null> {
    const result = await this.transaction<{ row: CheckpointRow; journal?: CommitRow } | null>(fence, 'readonly', (tx, done) => {
      const request = tx.objectStore('checkpoints').get(checkpointStorageKey(fence.ownerId, fence.generationId, sourceSlotKey));
      request.onsuccess = () => {
        const row = request.result as CheckpointRow | undefined;
        if (!row) { done(null); return; }
        const journal = tx.objectStore('commits').get(JSON.stringify([row.ownerId, row.generationId, row.latestTransitionId]));
        journal.onsuccess = () => done({ row, journal: journal.result });
      };
    });
    if (!result) return null;
    const { row, journal } = result, cp = checkedCheckpointRow(row, journal);
    if (row.ownerId !== fence.ownerId || row.generationId !== fence.generationId || cp.ownerId !== fence.ownerId ||
      cp.generationId !== fence.generationId || cp.sourceSlotKey !== sourceSlotKey || row.episodeKey !== episodeKey(cp)) throw new LocalEvidenceError('corrupt_record');
    return cp;
  }
  async readEvent(fence: LocalFence, eventId: string): Promise<FrozenEvidence | null> {
    const row = await this.transaction<EventRow | undefined>(fence, 'readonly', (tx, done) => {
      const request = tx.objectStore('events').get(eventStorageKey(fence.ownerId, eventId)); request.onsuccess = () => done(request.result);
    });
    if (!row) return null;
    await verifyFrozenEvidence(row.value); this.fence(fence);
    if (row.ownerId !== fence.ownerId || row.generationId !== fence.generationId || row.value.ownerId !== fence.ownerId ||
      row.value.generationId !== fence.generationId || row.value.eventId !== eventId ||
      row.semanticKey !== JSON.stringify([fence.ownerId, fence.generationId, row.value.sourceSlotKey, row.value.sequence])) throw new LocalEvidenceError('corrupt_record');
    return immutableCopy(row.value);
  }
  private async readCommit(value: PreparedCapture): Promise<CaptureCheckpoint | null> {
    const rows = await this.transaction<{ commit?: CommitRow; event?: EventRow; checkpoint?: CheckpointRow; delivery?: DeliveryMetadata }>(value.fence, 'readonly', (tx, done) => {
      const result: { commit?: CommitRow; event?: EventRow; checkpoint?: CheckpointRow; delivery?: DeliveryMetadata } = {}; done(result);
      const commit = tx.objectStore('commits').get(commitKey(value)); commit.onsuccess = () => { result.commit = commit.result; };
      const cp = value.checkpoint;
      const checkpoint = tx.objectStore('checkpoints').get(checkpointStorageKey(cp.ownerId, cp.generationId, cp.sourceSlotKey)); checkpoint.onsuccess = () => { result.checkpoint = checkpoint.result; };
      if (value.event) { const event = tx.objectStore('events').get(eventStorageKey(cp.ownerId, value.event.eventId)); event.onsuccess = () => { result.event = event.result; }; }
      const delivery = tx.objectStore('delivery').get(eventStorageKey(cp.ownerId, value.event?.eventId ?? cp.predecessor.eventId)); delivery.onsuccess = () => { result.delivery = delivery.result; };
    });
    if (value.event && rows.event && !same(rows.event.value, value.event)) {
      await this.quarantineDivergentId(value.fence, value.event);
      throw new LocalEvidenceError('event_conflict');
    }
    if (rows.delivery) rows.delivery = decodeDeliveryMetadata(rows.delivery);
    if (rows.delivery?.status === 'acknowledged') await this.readDelivery(value.fence, rows.delivery.eventId);
    if (rows.delivery?.status === 'quarantined') throw new LocalEvidenceError('quarantined');
    if (!rows.commit) return null;
    if (!rows.delivery || rows.delivery.ownerId !== value.fence.ownerId || rows.delivery.generationId !== value.fence.generationId ||
      rows.delivery.eventId !== (value.event?.eventId ?? value.checkpoint.predecessor.eventId) ||
      rows.delivery.payloadHash !== (value.event?.payloadHash ?? value.checkpoint.predecessor.payloadHash)) throw new LocalEvidenceError('corrupt_record');
    if (rows.commit.ownerId !== value.fence.ownerId || rows.commit.generationId !== value.fence.generationId || rows.commit.canonical !== canonicalEvidence(value)) throw new LocalEvidenceError('event_conflict');
    const current = await this.readCheckpoint(value.fence, value.checkpoint.sourceSlotKey);
    if (!current) throw new LocalEvidenceError('corrupt_record');
    if (current.ownerId !== value.fence.ownerId || current.generationId !== value.fence.generationId ||
      current.sourceSlotKey !== value.checkpoint.sourceSlotKey || current.episodeId !== value.checkpoint.episodeId ||
      current.checkpointRevision < value.checkpoint.checkpointRevision ||
      (current.checkpointRevision === value.checkpoint.checkpointRevision && !same(current, value.checkpoint))) throw new LocalEvidenceError('corrupt_record');
    if (value.event) {
      if (!rows.event || !same(rows.event.value, value.event)) throw new LocalEvidenceError('event_conflict');
      await verifyFrozenEvidence(rows.event.value); this.fence(value.fence);
    }
    return current;
  }
  private async quarantineDivergentId(fence: LocalFence, divergent: FrozenEvidence): Promise<void> {
    await this.transaction<void>(fence, 'readwrite', (tx, done, fail) => {
      const key = eventStorageKey(fence.ownerId, divergent.eventId), event = tx.objectStore('events').get(key);
      event.onsuccess = () => {
        try {
          this.fence(fence); const row = event.result as EventRow | undefined;
          if (!row || row.generationId !== fence.generationId || same(row.value, divergent)) { done(); return; }
          const cursorRequest = tx.objectStore('events').openCursor();
          cursorRequest.onsuccess = () => {
            try {
              this.fence(fence); const cursor = cursorRequest.result; if (!cursor) { done(); return; }
              const candidate = cursor.value as EventRow;
              if (candidate.ownerId === fence.ownerId && candidate.generationId === fence.generationId && candidate.value.sourceSlotKey === row.value.sourceSlotKey) {
                const store = tx.objectStore('delivery'), candidateKey = eventStorageKey(fence.ownerId, candidate.value.eventId), read = store.get(candidateKey);
                read.onsuccess = () => {
                  try {
                    this.fence(fence); const current = read.result === undefined ? undefined : decodeDeliveryMetadata(read.result);
                    if (!current || current.payloadHash !== candidate.value.payloadHash || current.generationId !== fence.generationId) throw new LocalEvidenceError('corrupt_record');
                    if (current.status !== 'quarantined' && current.status !== 'acknowledged') store.put({ ...current, revision: advanceRevision(current.revision), status: 'quarantined' }, candidateKey);
                  } catch (error) { fail(error); }
                };
              }
              cursor.continue();
            } catch (error) { fail(error); }
          };
        } catch (error) { fail(error); }
      };
    });
  }
  /** Uncertain writes are read first. Retries always use the same frozen transition and IDs. */
  async commit(input: PreparedCapture): Promise<LocalCommitResult> {
    const value = immutableCopy(input); await verifyPreparedCapture(value); this.fence(value.fence);
    const previouslyCommitted = await this.readCommit(value);
    if (previouslyCommitted) return { status: 'local_committed', delivery: 'pending', replay: true, checkpoint: immutableCopy(previouslyCommitted) };
    let writeFailure: unknown;
    try {
      await this.transaction<void>(value.fence, 'readwrite', (tx, done, fail) => {
        const commits = tx.objectStore('commits'), request = commits.get(commitKey(value));
        request.onsuccess = () => {
          try {
            this.fence(value.fence);
            const committed = request.result as CommitRow | undefined;
            if (committed) { if (committed.canonical !== canonicalEvidence(value)) throw new LocalEvidenceError('event_conflict'); done(); return; }
            const cp = value.checkpoint, checkpoints = tx.objectStore('checkpoints');
            const key = checkpointStorageKey(cp.ownerId, cp.generationId, cp.sourceSlotKey), read = checkpoints.get(key);
            read.onsuccess = () => {
              try {
                this.fence(value.fence);
                const row = read.result as CheckpointRow | undefined;
                const write = () => {
                  this.fence(value.fence);
                  if (value.mutation.kind === 'checkpoint' && value.mutation.action.kind === 'audio_requested') {
                    const action = value.mutation.action;
                    tx.objectStore('audioBindings').add({ ownerId: cp.ownerId, generationId: cp.generationId,
                      requestId: action.requestId, sourceSlotKey: cp.sourceSlotKey, episodeId: cp.episodeId, transitionId: value.transitionId },
                    JSON.stringify([cp.ownerId, cp.generationId, action.requestId]));
                  }
                  if (value.event) {
                  const event = value.event, eventKey = eventStorageKey(cp.ownerId, event.eventId);
                  const eventRow: EventRow = { ownerId: cp.ownerId, generationId: cp.generationId,
                    semanticKey: JSON.stringify([cp.ownerId, cp.generationId, cp.sourceSlotKey, event.sequence]), value: event };
                  tx.objectStore('events').add(eventRow, eventKey);
                  const delivery: DeliveryMetadata = { ownerId: cp.ownerId, generationId: cp.generationId,
                    eventId: event.eventId, payloadHash: event.payloadHash, revision: 1, status: 'pending' };
                  tx.objectStore('delivery').add(delivery, eventKey);
                  }
                checkpoints.put({ ownerId: cp.ownerId, generationId: cp.generationId, episodeKey: episodeKey(cp), latestTransitionId: value.transitionId, value: cp }, key);
                commits.add({ ownerId: cp.ownerId, generationId: cp.generationId, canonical: canonicalEvidence(value) }, commitKey(value)); done();
                };
                if (!row) { if (value.expected) throw new LocalEvidenceError('checkpoint_conflict'); write(); }
                else {
                  if (!value.expected) throw new LocalEvidenceError('checkpoint_conflict');
                  const journal = tx.objectStore('commits').get(JSON.stringify([row.ownerId, row.generationId, row.latestTransitionId]));
                  journal.onsuccess = () => {
                    try {
                      if (canonicalEvidence(checkedCheckpointRow(row, journal.result)) !== value.expected!.canonical) throw new LocalEvidenceError('checkpoint_conflict');
                      const delivery = tx.objectStore('delivery').get(eventStorageKey(cp.ownerId, row.value.predecessor.eventId));
                      delivery.onsuccess = () => {
                        try {
                          const metadata = delivery.result === undefined ? undefined : decodeDeliveryMetadata(delivery.result);
                          if (!metadata || metadata.ownerId !== cp.ownerId || metadata.eventId !== row.value.predecessor.eventId || metadata.payloadHash !== row.value.predecessor.payloadHash || metadata.generationId !== cp.generationId) throw new LocalEvidenceError('corrupt_record');
                          if (metadata.status === 'quarantined') throw new LocalEvidenceError('quarantined');
                          write();
                        } catch (error) { fail(error); }
                      };
                    } catch (error) { fail(error); }
                  };
                }
              } catch (error) { fail(error); }
            };
          } catch (error) { fail(error); }
        };
      });
    } catch (error) { writeFailure = error; }
    // Even a reported completion is not success until exact independent readback.
    try {
      const committed = await this.readCommit(value);
      if (committed) return { status: 'local_committed', delivery: 'pending', replay: Boolean(writeFailure), checkpoint: immutableCopy(committed) };
    } catch (error) {
      if (error instanceof LocalEvidenceError && ['stale_context', 'corrupt_record', 'event_conflict'].includes(error.code)) throw error;
      throw new LocalEvidenceError('commit_unconfirmed');
    }
    if (writeFailure) throw storageError(writeFailure);
    throw new LocalEvidenceError('commit_unconfirmed');
  }
  /** Immutable batch intent is saved before any future remote attempt. No upload occurs here. */
  async putBatch(fence: LocalFence, input: FrozenBatch): Promise<void> {
    const batch = immutableCopy(input); await verifyFrozenBatch(batch); this.fence(fence);
    if (batch.ownerId !== fence.ownerId || batch.generationId !== fence.generationId) throw new LocalEvidenceError('stale_context');
    const key = JSON.stringify([batch.ownerId, batch.generationId, batch.batchId]), canonical = canonicalEvidence(batch);
    await this.transaction<void>(fence, 'readwrite', (tx, done, fail) => {
      const store = tx.objectStore('batches'), request = store.get(key);
      request.onsuccess = () => {
        try {
          this.fence(fence);
          const existing = request.result;
          if (existing) decodeBatchDelivery(existing.delivery);
          if (existing && existing.canonical !== canonical) throw new LocalEvidenceError('event_conflict');
          let remaining = (batch.events.length + (batch.expectedPredecessor ? 1 : 0)) * 2;
          const ready = () => { if (--remaining === 0) { if (!existing) store.add({ ownerId: batch.ownerId, generationId: batch.generationId, canonical, delivery: { revision: 1, status: 'pending' } }, key); done(); } };
          for (const event of [...batch.events, ...(batch.expectedPredecessor ? [{ eventId: batch.expectedPredecessor.eventId, payloadHash: batch.expectedPredecessor.payloadHash }] : [])]) {
            const metadata = tx.objectStore('delivery').get(eventStorageKey(batch.ownerId, event.eventId));
            metadata.onsuccess = () => {
              try {
                this.fence(fence); const value = metadata.result === undefined ? undefined : decodeDeliveryMetadata(metadata.result);
                if (!value || value.ownerId !== batch.ownerId || value.eventId !== event.eventId || value.payloadHash !== event.payloadHash || value.generationId !== batch.generationId) throw new LocalEvidenceError('event_conflict');
                if (value.status === 'quarantined') throw new LocalEvidenceError('quarantined'); ready();
              } catch (error) { fail(error); }
            };
          }
          if (batch.expectedPredecessor) {
            const predecessor = tx.objectStore('events').get(eventStorageKey(batch.ownerId, batch.expectedPredecessor.eventId));
            predecessor.onsuccess = () => {
              try {
                this.fence(fence); const prior = (predecessor.result as EventRow | undefined)?.value;
                if (!prior || prior.ownerId !== batch.ownerId || prior.generationId !== batch.generationId || prior.sourceSlotKey !== batch.sourceSlotKey ||
                  prior.episodeId !== batch.episodeId || prior.sequence !== batch.expectedPredecessor!.sequence || prior.payloadHash !== batch.expectedPredecessor!.payloadHash) throw new LocalEvidenceError('event_conflict');
                ready();
              } catch (error) { fail(error); }
            };
          }
          for (const event of batch.events) {
            const read = tx.objectStore('events').get(eventStorageKey(batch.ownerId, event.eventId));
            read.onsuccess = () => {
              try {
                this.fence(fence);
                if (!read.result || !same(read.result.value, event)) throw new LocalEvidenceError('event_conflict');
                ready();
              } catch (error) { fail(error); }
            };
          }
        } catch (error) { fail(error); }
      };
    });
    const readback = await this.transaction<{ canonical: string } | undefined>(fence, 'readonly', (tx, done) => {
      const request = tx.objectStore('batches').get(key); request.onsuccess = () => done(request.result);
    });
    if (readback?.canonical !== canonical) throw new LocalEvidenceError('commit_unconfirmed');
  }
  /** Exact delivery CAS; never marks acknowledgement or upgrades receipt trust. */
  async markReadbackRequired(fence: LocalFence, event: FrozenEvidence, expectedRevision: number): Promise<void> {
    await verifyFrozenEvidence(event); this.fence(fence);
    if (event.ownerId !== fence.ownerId || event.generationId !== fence.generationId) throw new LocalEvidenceError('stale_context');
    await this.transaction<void>(fence, 'readwrite', (tx, done, fail) => {
      const store = tx.objectStore('delivery'), key = eventStorageKey(event.ownerId, event.eventId), request = store.get(key);
      request.onsuccess = () => {
        try {
          this.fence(fence);
          const current = request.result === undefined ? undefined : decodeDeliveryMetadata(request.result);
          if (!current || current.ownerId !== event.ownerId || current.generationId !== event.generationId || current.eventId !== event.eventId ||
            current.payloadHash !== event.payloadHash || current.revision !== expectedRevision || current.status === 'quarantined' || current.status === 'acknowledged') throw new LocalEvidenceError('checkpoint_conflict');
          store.put({ ...current, revision: advanceRevision(current.revision), status: 'readback_required' }, key); done();
        } catch (error) { fail(error); }
      };
    });
    const checked = await this.transaction<DeliveryMetadata | undefined>(fence, 'readonly', (tx, done) => {
      const read = tx.objectStore('delivery').get(eventStorageKey(event.ownerId, event.eventId)); read.onsuccess = () => done(read.result);
    });
    if (checked) decodeDeliveryMetadata(checked);
    if (!checked || checked.revision !== expectedRevision + 1 || checked.status !== 'readback_required' || checked.payloadHash !== event.payloadHash) throw new LocalEvidenceError('commit_unconfirmed');
  }
  async readDelivery(fence: LocalFence, eventId: string): Promise<DeliveryMetadata | null> {
    const rows = await this.transaction<{ value?: unknown; receipt?: ReceiptRow; event?: EventRow }>(fence, 'readonly', (tx, done) => {
      const result: { value?: unknown; receipt?: ReceiptRow; event?: EventRow } = {}; done(result);
      const request = tx.objectStore('delivery').get(eventStorageKey(fence.ownerId, eventId)); request.onsuccess = () => { result.value = request.result; };
      const receipt = tx.objectStore('receipts').get(receiptKey(fence, eventId)); receipt.onsuccess = () => { result.receipt = receipt.result; };
      const event = tx.objectStore('events').get(eventStorageKey(fence.ownerId, eventId)); event.onsuccess = () => { result.event = event.result; };
    });
    if (rows.value === undefined) {
      if (rows.receipt || rows.event) throw new LocalEvidenceError('corrupt_record');
      return null;
    }
    const delivery = decodeDeliveryMetadata(rows.value);
    if (delivery.ownerId !== fence.ownerId || delivery.generationId !== fence.generationId || delivery.eventId !== eventId ||
      !rows.event || rows.event.ownerId !== fence.ownerId || rows.event.generationId !== fence.generationId ||
      rows.event.value.ownerId !== fence.ownerId || rows.event.value.generationId !== fence.generationId || rows.event.value.eventId !== eventId ||
      rows.event.semanticKey !== JSON.stringify([fence.ownerId, fence.generationId, rows.event.value.sourceSlotKey, rows.event.value.sequence]) || rows.event.value.payloadHash !== delivery.payloadHash) throw new LocalEvidenceError('corrupt_record');
    await verifyFrozenEvidence(rows.event.value); this.fence(fence);
    if (delivery.status === 'acknowledged') {
      if (!rows.receipt || rows.receipt.canonical !== delivery.receiptCanonical || checkedReceiptRow(rows.receipt).canonicalEvent !== rows.event.value.canonical) throw new LocalEvidenceError('corrupt_record');
    }
    return delivery;
  }
  async readBatch(fence: LocalFence, batchId: string): Promise<{ batch: FrozenBatch; delivery: BatchDelivery } | null> {
    const row = await this.transaction<BatchRow | undefined>(fence, 'readonly', (tx, done) => {
      const request = tx.objectStore('batches').get(batchStorageKey(fence, batchId)); request.onsuccess = () => done(request.result);
    });
    if (!row) return null;
    try {
      if (Object.keys(row).sort().join(',') !== 'canonical,delivery,generationId,ownerId') throw Error();
      const batch = JSON.parse(row.canonical) as FrozenBatch;
      await verifyFrozenBatch(batch); this.fence(fence);
      if (canonicalEvidence(batch) !== row.canonical || batch.batchId !== batchId || row.ownerId !== fence.ownerId || row.generationId !== fence.generationId ||
        batch.ownerId !== row.ownerId || batch.generationId !== row.generationId) throw Error();
      return { batch: immutableCopy(batch), delivery: decodeBatchDelivery(row.delivery) };
    } catch (error) {
      if (error instanceof LocalEvidenceError && error.code === 'stale_context') throw error;
      throw new LocalEvidenceError('corrupt_record');
    }
  }
  /** No new IDs or bytes: terminal acknowledged events survive a conflict elsewhere. */
  async quarantineBatch(fence: LocalFence, batchId: string): Promise<void> {
    const stored = await this.readBatch(fence, batchId); this.fence(fence);
    if (!stored) throw new LocalEvidenceError('invalid_input');
    await this.transaction<void>(fence, 'readwrite', (tx, done, fail) => {
      const batches = tx.objectStore('batches'), request = batches.get(batchStorageKey(fence, batchId));
      request.onsuccess = () => {
        try {
          this.fence(fence); const row = request.result as BatchRow | undefined;
          if (!row || row.canonical !== canonicalEvidence(stored.batch)) throw new LocalEvidenceError('event_conflict');
          const batchDelivery = decodeBatchDelivery(row.delivery);
          if (batchDelivery.status !== 'acknowledged' && batchDelivery.status !== 'quarantined') batches.put({ ...row, delivery: { revision: advanceRevision(batchDelivery.revision), status: 'quarantined' } }, batchStorageKey(fence, batchId));
          for (const event of stored.batch.events) {
            const key = eventStorageKey(fence.ownerId, event.eventId), delivery = tx.objectStore('delivery'), read = delivery.get(key);
            read.onsuccess = () => {
              try {
                this.fence(fence); const value = decodeDeliveryMetadata(read.result);
                if (value.ownerId !== fence.ownerId || value.generationId !== fence.generationId || value.payloadHash !== event.payloadHash || value.eventId !== event.eventId) throw new LocalEvidenceError('corrupt_record');
                if (value.status !== 'acknowledged' && value.status !== 'quarantined') delivery.put({ ...value, revision: advanceRevision(value.revision), status: 'quarantined' }, key);
              } catch (error) { fail(error); }
            };
          }
          done();
        } catch (error) { fail(error); }
      };
    });
  }
  /** Exact proof + frozen batch + bytes + metadata CAS, with independent read-first recovery. */
  async acknowledgeBatch(fence: LocalFence, batchId: string, proof: AuthenticatedReceiptReadback, expected: readonly DeliveryMetadata[]): Promise<void> {
    const guard = () => { this.fence(fence); assertAuthenticatedReceiptReadback(proof, fence); };
    guard();
    if (proof.batchId !== batchId || !proof.exactReceipts.length) throw new LocalEvidenceError('invalid_input');
    const stored = await this.readBatch(fence, batchId); guard();
    if (!stored) throw new LocalEvidenceError('event_conflict');
    const batch = stored.batch, expectedById = new Map<string, DeliveryMetadata>(), receipts = new Map<string, string>();
    for (const input of expected) {
      const value = decodeDeliveryMetadata(input);
      if (value.ownerId !== fence.ownerId || value.generationId !== fence.generationId || expectedById.has(value.eventId) || !batch.events.some(event => event.eventId === value.eventId && event.payloadHash === value.payloadHash)) throw new LocalEvidenceError('invalid_input');
      expectedById.set(value.eventId, value);
    }
    for (const input of proof.exactReceipts) {
      const parsed = serverEvidenceReceiptSchema.safeParse(input);
      if (!parsed.success) throw new LocalEvidenceError('corrupt_record');
      const receipt = parsed.data, event = batch.events.find(event => event.eventId === receipt.event.eventId);
      if (!event || receipts.has(event.eventId) || !expectedById.has(event.eventId) || receipt.ownerId !== fence.ownerId || receipt.event.generationId !== fence.generationId ||
        event.canonical !== receipt.canonicalEvent || event.payloadHash !== receipt.payloadHash) throw new LocalEvidenceError('event_conflict');
      if (await canonicalSha256(receipt.canonicalEvent) !== receipt.payloadHash) throw new LocalEvidenceError('corrupt_record');
      guard(); receipts.set(event.eventId, canonicalEvidence(receipt));
    }
    const check = async (write: boolean): Promise<boolean> => {
      guard();
      const matches = await this.transaction<boolean>(fence, write ? 'readwrite' : 'readonly', (tx, done, fail) => {
        const rows = new Map<string, { event?: EventRow; delivery?: DeliveryMetadata; receipt?: ReceiptRow }>();
        let batchRow: BatchRow | undefined, remaining = 1 + batch.events.length * 3;
        const finish = () => {
          try {
            guard(); if (--remaining) return;
            if (!batchRow || batchRow.ownerId !== fence.ownerId || batchRow.generationId !== fence.generationId || batchRow.canonical !== canonicalEvidence(batch)) throw new LocalEvidenceError('event_conflict');
            const batchDelivery = decodeBatchDelivery(batchRow.delivery);
            if (batchDelivery.status === 'quarantined') throw new LocalEvidenceError('quarantined');
            let already = true, allAcknowledged = true;
            for (const event of batch.events) {
              const row = rows.get(event.eventId)!, metadata = decodeDeliveryMetadata(row.delivery);
              if (!row.event || !same(row.event.value, event) || row.event.ownerId !== fence.ownerId || row.event.generationId !== fence.generationId ||
                row.event.semanticKey !== JSON.stringify([event.ownerId, event.generationId, event.sourceSlotKey, event.sequence]) || metadata.ownerId !== fence.ownerId ||
                metadata.generationId !== fence.generationId || metadata.eventId !== event.eventId || metadata.payloadHash !== event.payloadHash) throw new LocalEvidenceError('event_conflict');
              if (metadata.status === 'quarantined') throw new LocalEvidenceError('quarantined');
              if (row.receipt) checkedReceiptRow(row.receipt);
              const canonical = receipts.get(event.eventId);
              if (metadata.status === 'acknowledged') {
                if (!row.receipt || row.receipt.canonical !== metadata.receiptCanonical || (canonical !== undefined && canonical !== metadata.receiptCanonical)) throw new LocalEvidenceError('event_conflict');
              } else if (canonical !== undefined) {
                already = false;
                if (row.receipt && row.receipt.canonical !== canonical) throw new LocalEvidenceError('event_conflict');
                if (write) {
                  if (!same(metadata, expectedById.get(event.eventId))) throw new LocalEvidenceError('checkpoint_conflict');
                  tx.objectStore('receipts').put({ version: 1, ownerId: fence.ownerId, generationId: fence.generationId, canonical } satisfies ReceiptRow, receiptKey(fence, event.eventId));
                  tx.objectStore('delivery').put({ version: 2, ownerId: metadata.ownerId, generationId: metadata.generationId, eventId: metadata.eventId,
                    payloadHash: metadata.payloadHash, revision: advanceRevision(metadata.revision), status: 'acknowledged', receiptCanonical: canonical } satisfies DeliveryMetadata, eventStorageKey(fence.ownerId, event.eventId));
                }
              } else { allAcknowledged = false; }
            }
            if (batchDelivery.status === 'acknowledged' && !allAcknowledged) throw new LocalEvidenceError('corrupt_record');
            if (write && batchDelivery.status !== 'acknowledged') {
              const next: BatchDelivery = allAcknowledged ? { version: 2, revision: advanceRevision(batchDelivery.revision), status: 'acknowledged' } :
                { revision: advanceRevision(batchDelivery.revision), status: 'readback_required' };
              tx.objectStore('batches').put({ ...batchRow, delivery: next }, batchStorageKey(fence, batchId));
            }
            done(already && (!allAcknowledged || batchDelivery.status === 'acknowledged'));
          } catch (error) { fail(error); }
        };
        const readBatch = tx.objectStore('batches').get(batchStorageKey(fence, batchId));
        readBatch.onsuccess = () => { batchRow = readBatch.result; finish(); };
        for (const event of batch.events) {
          const row: { event?: EventRow; delivery?: DeliveryMetadata; receipt?: ReceiptRow } = {}; rows.set(event.eventId, row);
          const readEvent = tx.objectStore('events').get(eventStorageKey(fence.ownerId, event.eventId)); readEvent.onsuccess = () => { row.event = readEvent.result; finish(); };
          const readDelivery = tx.objectStore('delivery').get(eventStorageKey(fence.ownerId, event.eventId)); readDelivery.onsuccess = () => { row.delivery = readDelivery.result; finish(); };
          const readReceipt = tx.objectStore('receipts').get(receiptKey(fence, event.eventId)); readReceipt.onsuccess = () => { row.receipt = readReceipt.result; finish(); };
        }
      });
      guard(); return matches;
    };
    if (await check(false)) { guard(); return; }
    guard(); let failure: unknown;
    try { await check(true); } catch (error) { failure = error; }
    guard();
    try { if (await check(false)) { guard(); return; } }
    catch (error) {
      if (error instanceof LocalEvidenceError && ['stale_context', 'corrupt_record', 'event_conflict', 'quarantined'].includes(error.code)) throw error;
      throw new LocalEvidenceError('commit_unconfirmed');
    }
    if (failure) throw storageError(failure);
    throw new LocalEvidenceError('commit_unconfirmed');
  }
  async writeVerifiedContext(fence: LocalFence, proof: AuthenticatedContextProof): Promise<void> {
    const guard = () => { this.fence(fence); assertAuthenticatedContext(proof, fence); }; guard();
    const row: CachedEvidenceContext = { version: 1, ownerId: fence.ownerId, generationId: fence.generationId, context: proof.serverContext, status: 'previously_verified_offline' };
    checkedCacheRow(row, false);
    if (proof.context.prospectiveStartedAt !== row.context.prospectiveStartedAt || proof.context.studyDayTimezone !== row.context.studyDayTimezone) throw new LocalEvidenceError('stale_context');
    await this.writeCache(fence, 'contexts', row, guard); guard();
  }
  async writeVerifiedPrefix(fence: LocalFence, proof: AuthenticatedPrefixProof): Promise<void> {
    const guard = () => { this.fence(fence); assertAuthenticatedPrefix(proof, fence); }; guard();
    const row: CachedEvidencePrefix = { version: 1, ownerId: fence.ownerId, generationId: fence.generationId, context: proof.serverContext,
      throughSequence: proof.throughSequence, records: proof.records, status: 'previously_verified_offline' };
    checkedCacheRow(row, true);
    if (proof.context.prospectiveStartedAt !== row.context.prospectiveStartedAt || proof.context.studyDayTimezone !== row.context.studyDayTimezone) throw new LocalEvidenceError('stale_context');
    for (const receipt of row.records) {
      if (await canonicalSha256(receipt.canonicalEvent) !== receipt.payloadHash) throw new LocalEvidenceError('corrupt_record'); guard();
    }
    await this.writeCache(fence, 'prefixes', row, guard); guard();
  }
  private async writeCache(fence: LocalFence, name: 'contexts' | 'prefixes', row: CachedEvidenceContext | CachedEvidencePrefix, guard: () => void): Promise<void> {
    const covers = (input: unknown): boolean => {
      const value = checkedCacheRow(input, name === 'prefixes');
      const stable = (context: CachedEvidenceContext['context']) => ({ ...context, serverTime: null, highWater: null });
      if (value.ownerId !== row.ownerId || value.generationId !== row.generationId || !same(stable(value.context), stable(row.context))) throw new LocalEvidenceError('corrupt_record');
      if (name === 'prefixes') {
        const old = value as CachedEvidencePrefix, next = row as CachedEvidencePrefix;
        for (let index = 0; index < Math.min(old.records.length, next.records.length); index++) {
          if (!same(old.records[index], next.records[index])) throw new LocalEvidenceError('event_conflict');
        }
        return old.throughSequence >= next.throughSequence;
      }
      return value.context.highWater >= row.context.highWater && Date.parse(value.context.serverTime) >= Date.parse(row.context.serverTime);
    };
    guard(); let failure: unknown;
    try {
      await this.transaction<void>(fence, 'readwrite', (tx, done, fail) => {
        const store = tx.objectStore(name), read = store.get(scopeKey(fence));
        read.onsuccess = () => {
          try { guard(); if (read.result === undefined || !covers(read.result)) store.put(row, scopeKey(fence)); done(); }
          catch (error) { fail(error); }
        };
      });
    } catch (error) { failure = error; }
    guard();
    const read = await this.transaction<unknown>(fence, 'readonly', (tx, done) => {
      const request = tx.objectStore(name).get(scopeKey(fence)); request.onsuccess = () => done(request.result);
    }); guard();
    if (read === undefined || !covers(read)) { if (failure) throw storageError(failure); throw new LocalEvidenceError('commit_unconfirmed'); }
  }
  async readCachedContext(fence: LocalFence): Promise<CachedEvidenceContext | null> {
    const value = await this.readCache(fence, 'contexts'); return value as CachedEvidenceContext | null;
  }
  async readCachedPrefix(fence: LocalFence): Promise<CachedEvidencePrefix | null> {
    const value = await this.readCache(fence, 'prefixes') as CachedEvidencePrefix | null;
    if (value) for (const receipt of value.records) {
      if (await canonicalSha256(receipt.canonicalEvent) !== receipt.payloadHash) throw new LocalEvidenceError('corrupt_record'); this.fence(fence);
    }
    return value;
  }
  private async readCache(fence: LocalFence, name: 'contexts' | 'prefixes'): Promise<CachedEvidenceContext | CachedEvidencePrefix | null> {
    const row = await this.transaction<unknown>(fence, 'readonly', (tx, done) => {
      const request = tx.objectStore(name).get(scopeKey(fence)); request.onsuccess = () => done(request.result);
    });
    if (row === undefined) return null;
    const checked = checkedCacheRow(row, name === 'prefixes');
    if (checked.ownerId !== fence.ownerId || checked.generationId !== fence.generationId) throw new LocalEvidenceError('corrupt_record');
    return immutableCopy(checked);
  }
  /** Read-only discovery retains bounded pending work, never the acknowledged history. */
  async recoverOutbox(fence: LocalFence, limit = 500): Promise<{
    status: 'pending' | 'quarantined'; events: { event: FrozenEvidence; delivery: DeliveryMetadata }[];
    batches: { batch: FrozenBatch; delivery: BatchDelivery }[];
  }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) throw new LocalEvidenceError('invalid_input');
    type Pending = { events: { event: FrozenEvidence; delivery: DeliveryMetadata }[];
      batches: { batch: FrozenBatch; delivery: BatchDelivery }[]; predecessors: FrozenEvidence[] };
    const result = await this.transaction<Pending>(fence, 'readonly', (tx, done, fail) => {
      const result: Pending = { events: [], batches: [], predecessors: [] }; done(result);
      const guarded = (work: () => void) => { try { this.fence(fence); work(); } catch (error) { fail(error); } };
      const read = <T>(name: StoreName, key: string, accept: (value: T | undefined) => void) => {
        const request = tx.objectStore(name).get(key); request.onsuccess = () => guarded(() => accept(request.result));
      };
      const readEvent = (eventId: string, accept: (event: FrozenEvidence) => void) => {
        const key = eventStorageKey(fence.ownerId, eventId);
        read<EventRow>('events', key, row => {
          if (!row) throw new LocalEvidenceError('corrupt_record');
          const scope = cleanupIdentity('events', key, row);
          if (scope.ownerId !== fence.ownerId || scope.generationId !== fence.generationId) throw new LocalEvidenceError('corrupt_record');
          accept(row.value);
        });
      };
      const readDelivery = (eventId: string, accept: (delivery: DeliveryMetadata) => void) => {
        read<unknown>('delivery', eventStorageKey(fence.ownerId, eventId), row => {
          const delivery = decodeDeliveryMetadata(row);
          if (delivery.ownerId !== fence.ownerId || delivery.generationId !== fence.generationId || delivery.eventId !== eventId) throw new LocalEvidenceError('corrupt_record');
          accept(delivery);
        });
      };
      // A cursor advances only after its row's exact dependencies have been read.
      // The live working set is one row/batch plus <=limit pending results.
      const walk = (name: 'delivery' | 'events' | 'receipts' | 'batches', visit: (cursor: IDBCursorWithValue, advance: () => void) => void, next: () => void) => {
        const request = tx.objectStore(name).openCursor();
        request.onsuccess = () => guarded(() => {
          const cursor = request.result; if (!cursor) { next(); return; }
          const scope = cleanupIdentity(name, cursor.primaryKey, cursor.value);
          if (scope.ownerId !== fence.ownerId || scope.generationId !== fence.generationId) { cursor.continue(); return; }
          visit(cursor, () => cursor.continue());
        });
      };
      const batches = () => walk('batches', (cursor, advance) => {
        const row = cursor.value as BatchRow;
        let batch: FrozenBatch;
        try { batch = decodeFrozenBatch(JSON.parse(row.canonical)); }
        catch { throw new LocalEvidenceError('corrupt_record'); }
        if (Object.keys(row).sort().join(',') !== 'canonical,delivery,generationId,ownerId' || batch.ownerId !== fence.ownerId || batch.generationId !== fence.generationId) throw new LocalEvidenceError('corrupt_record');
        const delivery = decodeBatchDelivery(row.delivery);
        let actionable = delivery.status === 'quarantined', allAcknowledged = true, predecessor: FrozenEvidence | undefined;
        const bound = () => { if (actionable && result.batches.length >= limit) throw new LocalEvidenceError('batch_limit'); }; bound();
        const finish = () => {
          if (delivery.status === 'acknowledged' && !allAcknowledged) throw new LocalEvidenceError('corrupt_record');
          if (actionable) {
            bound(); result.batches.push({ batch, delivery });
            if (predecessor) result.predecessors.push(predecessor);
          }
          advance();
        };
        const checkEvent = (index: number) => {
          if (index === batch.events.length) { finish(); return; }
          const frozen = batch.events[index];
          readEvent(frozen.eventId, event => {
            if (!same(event, frozen)) throw new LocalEvidenceError('corrupt_record');
            readDelivery(event.eventId, metadata => {
              if (metadata.payloadHash !== event.payloadHash) throw new LocalEvidenceError('corrupt_record');
              if (metadata.status !== 'acknowledged') {
                allAcknowledged = false; actionable = true; bound();
              }
              checkEvent(index + 1);
            });
          });
        };
        if (!batch.expectedPredecessor) { checkEvent(0); return; }
        const expected = batch.expectedPredecessor;
        readEvent(expected.eventId, event => {
          if (event.payloadHash !== expected.payloadHash || event.sequence !== expected.sequence || event.sourceSlotKey !== batch.sourceSlotKey || event.episodeId !== batch.episodeId) throw new LocalEvidenceError('corrupt_record');
          readDelivery(event.eventId, metadata => {
            if (metadata.payloadHash !== event.payloadHash) throw new LocalEvidenceError('corrupt_record');
            predecessor = event; checkEvent(0);
          });
        });
      }, () => {});
      // These two streaming passes preserve orphan/key/cache corruption checks;
      // they do not retain, return or cryptographically rehash old acknowledged rows.
      const receipts = () => walk('receipts', (cursor, advance) => {
        const row = cursor.value as ReceiptRow, receipt = checkedReceiptRow(row);
        readDelivery(receipt.event.eventId, delivery => {
          if (delivery.status !== 'acknowledged' || delivery.receiptCanonical !== row.canonical) throw new LocalEvidenceError('corrupt_record');
          advance();
        });
      }, batches);
      const events = () => walk('events', (cursor, advance) => {
        const event = (cursor.value as EventRow).value;
        readDelivery(event.eventId, delivery => {
          if (delivery.payloadHash !== event.payloadHash) throw new LocalEvidenceError('corrupt_record'); advance();
        });
      }, receipts);
      walk('delivery', (cursor, advance) => {
        const delivery = decodeDeliveryMetadata(cursor.value);
        // Enforce the work cap before fetching or accumulating the next event.
        if (delivery.status !== 'acknowledged' && result.events.length >= limit) throw new LocalEvidenceError('batch_limit');
        readEvent(delivery.eventId, event => {
          if (event.payloadHash !== delivery.payloadHash) throw new LocalEvidenceError('corrupt_record');
          if (delivery.status !== 'acknowledged') {
            result.events.push({ event, delivery }); advance(); return;
          }
          read<ReceiptRow>('receipts', receiptKey(fence, delivery.eventId), row => {
            if (!row || row.canonical !== delivery.receiptCanonical || checkedReceiptRow(row).canonicalEvent !== event.canonical) throw new LocalEvidenceError('corrupt_record');
            advance();
          });
        });
      }, events);
    });
    // Crypto is outside IDB, and its input count is bounded by pending work and
    // <=50-event frozen batch dependencies, independent of retained ack history.
    for (const entry of result.events) { await verifyFrozenEvidence(entry.event); this.fence(fence); }
    for (const entry of result.batches) { await verifyFrozenBatch(entry.batch); this.fence(fence); }
    for (const predecessor of result.predecessors) { await verifyFrozenEvidence(predecessor); this.fence(fence); }
    this.fence(fence);
    return { status: result.events.some(entry => entry.delivery.status === 'quarantined') || result.batches.some(entry => entry.delivery.status === 'quarantined') ? 'quarantined' : 'pending',
      events: result.events.map(entry => ({ event: immutableCopy(entry.event), delivery: entry.delivery })), batches: result.batches };
  }
  /** Caller must supply a freshly revalidated generation fence. No reset integration is installed. */
  async cleanupStaleGenerations(freshContext: LocalEvidenceContext): Promise<void> {
    if (freshContext.freshness !== 'fresh') throw new LocalEvidenceError('stale_context');
    const freshFence: LocalFence = { ownerId: freshContext.ownerId, generationId: freshContext.generationId, ownerEpoch: freshContext.ownerEpoch };
    await this.transaction<void>(freshFence, 'readwrite', (tx, done, fail) => {
      const candidates: { name: StoreName; key: IDBValidKey; scope: ScopedRow }[] = [];
      const events = new Map<string, FrozenEvidence>(), delivery: DeliveryMetadata[] = [];
      let remaining = STORES.length;
      const finish = () => {
        if (--remaining !== 0) return;
        this.fence(freshFence);
        // Delivery keys omit generation for event-ID uniqueness. Check their
        // generation/hash against the event before issuing any deletion.
        for (const value of delivery) {
          const event = events.get(eventStorageKey(value.ownerId, value.eventId));
          if (!event || event.generationId !== value.generationId || event.payloadHash !== value.payloadHash) throw new LocalEvidenceError('corrupt_record');
        }
        for (const candidate of candidates) {
          if (candidate.scope.ownerId === freshFence.ownerId && candidate.scope.generationId !== freshFence.generationId) tx.objectStore(candidate.name).delete(candidate.key);
        }
        done();
      };
      for (const name of STORES) {
        const store = tx.objectStore(name), request = store.openCursor();
        request.onsuccess = () => {
          try {
            this.fence(freshFence);
            const cursor = request.result;
            if (!cursor) { finish(); return; }
            const scope = cleanupIdentity(name, cursor.primaryKey, cursor.value);
            candidates.push({ name, key: cursor.primaryKey, scope });
            if (name === 'events') { const value = (cursor.value as EventRow).value; events.set(eventStorageKey(value.ownerId, value.eventId), value); }
            if (name === 'delivery') delivery.push(cursor.value as DeliveryMetadata);
            cursor.continue();
          } catch (error) { fail(error); }
        };
      }
    });
    const remaining = await this.transaction<boolean>(freshFence, 'readonly', (tx, done, fail) => {
      let stale = false; done(false);
      for (const name of STORES) {
        const request = tx.objectStore(name).openCursor();
        request.onsuccess = () => {
          try {
            this.fence(freshFence); const cursor = request.result; if (!cursor) return;
            const row = cleanupIdentity(name, cursor.primaryKey, cursor.value);
            stale ||= row.ownerId === freshFence.ownerId && row.generationId !== freshFence.generationId;
            done(stale); cursor.continue();
          } catch (error) { fail(error); }
        };
      }
    });
    if (remaining) throw new LocalEvidenceError('commit_unconfirmed');
  }
}
