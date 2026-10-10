import { canonicalEvidence } from './validation.ts';
import { decodeFrozenEvidence, immutableCopy, verifyFrozenEvidence } from './canonical-hash.ts';
import { parseCheckpoint, verifyPreparedCapture } from './capture.ts';
import { LocalEvidenceError, type CaptureCheckpoint, type DeliveryMetadata, type FrozenBatch, type FrozenEvidence,
  type BatchDelivery, type LocalCommitResult, type LocalEvidenceContext, type LocalFence, type PreparedCapture } from './persistence-types.ts';
import { verifyFrozenBatch } from './outbox.ts';

export const LOCAL_EVIDENCE_DATABASE = 'yeoni-legacy-language-evidence-v1';
const STORES = ['events', 'checkpoints', 'commits', 'delivery', 'batches', 'audioBindings'] as const;
type StoreName = typeof STORES[number];
type ScopedRow = { ownerId: string; generationId: string };
type EventRow = ScopedRow & { semanticKey: string; value: FrozenEvidence };
type CheckpointRow = ScopedRow & { episodeKey: string; latestTransitionId: string; value: CaptureCheckpoint };
type CommitRow = ScopedRow & { canonical: string };
export const eventStorageKey = (owner: string, eventId: string) => JSON.stringify([owner, eventId]);
export const checkpointStorageKey = (owner: string, generation: string, slot: string) => JSON.stringify([owner, generation, slot]);
const commitKey = (value: PreparedCapture) => JSON.stringify([value.fence.ownerId, value.fence.generationId, value.transitionId]);
const episodeKey = (cp: CaptureCheckpoint) => JSON.stringify([cp.ownerId, cp.generationId, cp.episodeId]);
const same = (a: unknown, b: unknown) => canonicalEvidence(a) === canonicalEvidence(b);
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
      if (typeof row.eventId !== 'string') throw Error();
      expectedKey = eventStorageKey(row.ownerId, row.eventId);
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
    try { request = factory.open(LOCAL_EVIDENCE_DATABASE, 1); } catch (error) { reject(storageError(error)); return; }
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
    if (rows.delivery?.status === 'quarantined') throw new LocalEvidenceError('quarantined');
    if (!rows.commit) return null;
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
                    this.fence(fence); const current = read.result as DeliveryMetadata | undefined;
                    if (!current || current.payloadHash !== candidate.value.payloadHash || current.generationId !== fence.generationId) throw new LocalEvidenceError('corrupt_record');
                    if (current.status !== 'quarantined') store.put({ ...current, revision: current.revision + 1, status: 'quarantined' }, candidateKey);
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
                          const metadata = delivery.result as DeliveryMetadata | undefined;
                          if (!metadata || metadata.payloadHash !== row.value.predecessor.payloadHash || metadata.generationId !== cp.generationId) throw new LocalEvidenceError('corrupt_record');
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
          if (existing && existing.canonical !== canonical) throw new LocalEvidenceError('event_conflict');
          let remaining = (batch.events.length + (batch.expectedPredecessor ? 1 : 0)) * 2;
          const ready = () => { if (--remaining === 0) { if (!existing) store.add({ ownerId: batch.ownerId, generationId: batch.generationId, canonical, delivery: { revision: 1, status: 'pending' } }, key); done(); } };
          for (const event of [...batch.events, ...(batch.expectedPredecessor ? [{ eventId: batch.expectedPredecessor.eventId, payloadHash: batch.expectedPredecessor.payloadHash }] : [])]) {
            const metadata = tx.objectStore('delivery').get(eventStorageKey(batch.ownerId, event.eventId));
            metadata.onsuccess = () => {
              try {
                this.fence(fence); const value = metadata.result as DeliveryMetadata | undefined;
                if (!value || value.payloadHash !== event.payloadHash || value.generationId !== batch.generationId) throw new LocalEvidenceError('event_conflict');
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
          const current = request.result as DeliveryMetadata | undefined;
          if (!current || current.ownerId !== event.ownerId || current.generationId !== event.generationId || current.eventId !== event.eventId ||
            current.payloadHash !== event.payloadHash || current.revision !== expectedRevision || current.status === 'quarantined') throw new LocalEvidenceError('checkpoint_conflict');
          store.put({ ...current, revision: current.revision + 1, status: 'readback_required' }, key); done();
        } catch (error) { fail(error); }
      };
    });
    const checked = await this.transaction<DeliveryMetadata | undefined>(fence, 'readonly', (tx, done) => {
      const read = tx.objectStore('delivery').get(eventStorageKey(event.ownerId, event.eventId)); read.onsuccess = () => done(read.result);
    });
    if (!checked || checked.revision !== expectedRevision + 1 || checked.status !== 'readback_required' || checked.payloadHash !== event.payloadHash) throw new LocalEvidenceError('commit_unconfirmed');
  }
  /** Read-only restart discovery. A cap fails visibly; it never silently drops pending evidence. */
  async recoverOutbox(fence: LocalFence, limit = 500): Promise<{
    status: 'pending' | 'quarantined'; events: { event: FrozenEvidence; delivery: DeliveryMetadata }[];
    batches: { batch: FrozenBatch; delivery: BatchDelivery }[];
  }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) throw new LocalEvidenceError('invalid_input');
    const rows = await this.transaction<{ events: EventRow[]; delivery: DeliveryMetadata[]; batches: (ScopedRow & { canonical: string; delivery: BatchDelivery })[] }>(fence, 'readonly', (tx, done, fail) => {
      const result: { events: EventRow[]; delivery: DeliveryMetadata[]; batches: (ScopedRow & { canonical: string; delivery: BatchDelivery })[] } = { events: [], delivery: [], batches: [] }; done(result);
      for (const name of ['events', 'delivery', 'batches'] as const) {
        const request = tx.objectStore(name).openCursor();
        request.onsuccess = () => {
          try {
            this.fence(fence); const cursor = request.result; if (!cursor) return;
            const row = cursor.value as ScopedRow;
            if (row.ownerId === fence.ownerId && row.generationId === fence.generationId) {
              if (result[name].length >= limit) throw new LocalEvidenceError('batch_limit');
              // Store-name discrimination is explicit; raw compatibility input is never included.
              if (name === 'events') result.events.push(cursor.value as EventRow);
              else if (name === 'delivery') result.delivery.push(cursor.value as DeliveryMetadata);
              else result.batches.push(cursor.value as ScopedRow & { canonical: string; delivery: BatchDelivery });
            }
            cursor.continue();
          } catch (error) { fail(error); }
        };
      }
    });
    const metadata = new Map<string, DeliveryMetadata>();
    for (const delivery of rows.delivery) {
      if (Object.keys(delivery).sort().join(',') !== 'eventId,generationId,ownerId,payloadHash,revision,status' ||
        !Number.isSafeInteger(delivery.revision) || delivery.revision < 1 || !['pending', 'readback_required', 'quarantined'].includes(delivery.status) ||
        metadata.has(delivery.eventId)) throw new LocalEvidenceError('corrupt_record');
      metadata.set(delivery.eventId, delivery);
    }
    const events: { event: FrozenEvidence; delivery: DeliveryMetadata }[] = [];
    for (const row of rows.events) {
      await verifyFrozenEvidence(row.value); this.fence(fence);
      const event = row.value, delivery = metadata.get(event.eventId);
      if (event.ownerId !== fence.ownerId || event.generationId !== fence.generationId || !delivery || delivery.payloadHash !== event.payloadHash ||
        row.semanticKey !== JSON.stringify([event.ownerId, event.generationId, event.sourceSlotKey, event.sequence])) throw new LocalEvidenceError('corrupt_record');
      events.push({ event: immutableCopy(event), delivery }); metadata.delete(event.eventId);
    }
    if (metadata.size) throw new LocalEvidenceError('corrupt_record');
    const byId = new Map(events.map(entry => [entry.event.eventId, entry.event]));
    const batches: { batch: FrozenBatch; delivery: BatchDelivery }[] = [];
    for (const row of rows.batches) {
      let batch: FrozenBatch;
      try { batch = JSON.parse(row.canonical); } catch { throw new LocalEvidenceError('corrupt_record'); }
      await verifyFrozenBatch(batch); this.fence(fence);
      if (canonicalEvidence(batch) !== row.canonical || batch.ownerId !== fence.ownerId || batch.generationId !== fence.generationId ||
        Object.keys(row.delivery).sort().join(',') !== 'revision,status' || !Number.isSafeInteger(row.delivery.revision) || row.delivery.revision < 1 ||
        !['pending', 'readback_required', 'quarantined'].includes(row.delivery.status) || batch.events.some(event => !same(event, byId.get(event.eventId)))) throw new LocalEvidenceError('corrupt_record');
      batches.push({ batch: immutableCopy(batch), delivery: row.delivery });
    }
    return { status: events.some(entry => entry.delivery.status === 'quarantined') || batches.some(entry => entry.delivery.status === 'quarantined') ? 'quarantined' : 'pending', events, batches };
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
