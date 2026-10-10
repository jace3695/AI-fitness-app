import { canonicalEvidence, makeSourceSlotKey } from './validation.ts';
import { canonicalSha256, decodeFrozenEvidence, immutableCopy, verifyFrozenEvidence } from './canonical-hash.ts';
import { parseCheckpoint, verifyPreparedCapture } from './capture.ts';
import { LocalEvidenceError, MAX_EVENT_BYTES, type CaptureCheckpoint, type DeliveryMetadata, type FrozenBatch, type FrozenEvidence,
  type Immutable, type AuthenticatedReceiptReadback, type BatchDelivery, type LocalCommitResult, type LocalEvidenceContext, type LocalFence, type PreparedCapture } from './persistence-types.ts';
import { decodeBatchDelivery, decodeDeliveryMetadata, decodeFrozenBatch, verifyFrozenBatch } from './outbox.ts';
import { assertAuthenticatedContext, assertAuthenticatedPrefix, assertAuthenticatedReceiptReadback, assertAuthenticatedAdmissionStatus,
  assertAuthenticatedFirstAdmission, assertAuthenticatedResetEvidenceState, type AuthenticatedAdmissionStatusProof,
  type AuthenticatedFirstAdmissionProof, type AuthenticatedResetEvidenceStateProof, type AuthenticatedContextProof, type AuthenticatedPrefixProof } from './receipt-proof.ts';
import { MAX_PREFIX_BYTES, MAX_PREFIX_EVENTS, serverEvidenceContextSchema, serverEvidenceReceiptSchema, type CachedEvidenceContext, type CachedEvidencePrefix, type ServerEvidenceReceipt } from './server-types.ts';
import { checkedAdmissionValue, enrollmentIntentRowSchema, frozenEnrollmentIntentSchema, localGenerationAdmissionSchema,
  storeIncarnationSchema, type AdmissionSnapshot, type EnrollmentIntentRow, type FrozenEnrollmentIntent,
  type LocalGenerationAdmission, type StoreIncarnation } from './store-admission-types.ts';

import { REVIEW_STORES, REVIEW_LIMITS, accountReviewRows, parseReviewRun, parseReviewExposure, parseReviewRowFence,
  parseReviewJournal, reviewRowIdentity, reviewRunKey, reviewRowFenceKey, reviewExposureKey, reviewJournalKey,
  reviewManagedSlot, reviewTransitionRows, verifyReviewTransition, type PreparedReviewTransition,
  type ReviewRun, type ReviewExposure, type ReviewRowFence, type ReviewJournalPayload, type ReviewAccountingRow,
  type ReviewScope, type ReviewRows, type ReviewRunImmutable } from './review-capture.ts';

export const LOCAL_EVIDENCE_DATABASE = 'yeoni-legacy-language-evidence-v1';
export const LOCAL_EVIDENCE_DATABASE_VERSION = 4;
const SCOPED_STORES = [...REVIEW_STORES, 'events', 'checkpoints', 'commits', 'delivery', 'batches', 'audioBindings', 'receipts', 'contexts', 'prefixes', 'admissions'] as const;
const STORES = [...SCOPED_STORES, 'incarnations', 'enrollmentIntents'] as const;
type StoreName = typeof STORES[number];
type ScopedStoreName = typeof SCOPED_STORES[number];
const INCARNATION_KEY = 'store';
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
function cleanupIdentity(name: ScopedStoreName, key: IDBValidKey, input: unknown, incarnationId?: string): ScopedRow {
  try {
    const row = input as ScopedRow & Record<string, unknown>;
    if (!row || typeof row.ownerId !== 'string' || typeof row.generationId !== 'string' || typeof key !== 'string') throw Error();
    let expectedKey: string;
    if ((REVIEW_STORES as readonly string[]).includes(name)) {
      const scope = reviewRowIdentity(name as typeof REVIEW_STORES[number], key, input);
      if (incarnationId && scope.incarnationId !== incarnationId) throw Error(); return scope;
    }
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
    } else if (name === 'admissions') {
      checkedAdmissionValue(localGenerationAdmissionSchema, row); expectedKey = scopeKey(row);
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
const VERSION_STORES: Record<number, readonly string[]> = {
  0: [], 1: ['events', 'checkpoints', 'commits', 'delivery', 'batches', 'audioBindings'],
  2: ['events', 'checkpoints', 'commits', 'delivery', 'batches', 'audioBindings', 'receipts', 'contexts', 'prefixes'],
  3: ['events', 'checkpoints', 'commits', 'delivery', 'batches', 'audioBindings', 'receipts', 'contexts', 'prefixes', 'admissions', 'incarnations', 'enrollmentIntents'],
  4: STORES,
};
function validateLayout(db: IDBDatabase, tx: IDBTransaction | null, version: number): void {
  const expected = VERSION_STORES[version];
  if (!expected || [...db.objectStoreNames].sort().join(',') !== [...expected].sort().join(',')) throw new LocalEvidenceError('corrupt_record');
  for (const name of expected) {
    const store = tx!.objectStore(name), indexName = name === 'events' ? 'semanticKey' : name === 'checkpoints' ? 'episodeKey' : name === 'reviewRuns' ? 'managedSlot' : null;
    if (store.keyPath !== null || store.autoIncrement !== false || [...store.indexNames].sort().join(',') !== (indexName ?? '')) throw new LocalEvidenceError('corrupt_record');
    if (indexName) { const index = store.index(indexName);
      if (index.keyPath !== indexName || !index.unique || index.multiEntry !== false) throw new LocalEvidenceError('corrupt_record'); }
  }
}
function openDatabase(factory: IDBFactory | undefined): Promise<Connection> {
  if (!factory) return Promise.reject(new LocalEvidenceError('idb_unavailable'));
  return new Promise((resolve, reject) => {
    let failed = false;
    let request: IDBOpenDBRequest;
    try { request = factory.open(LOCAL_EVIDENCE_DATABASE, LOCAL_EVIDENCE_DATABASE_VERSION); } catch (error) { reject(storageError(error)); return; }
    const abort = (error: unknown) => { failed = true; try { request.transaction?.abort(); } catch { /* already aborted */ } reject(storageError(error)); };
    request.onupgradeneeded = event => {
      // A blocked open remains pending in real IndexedDB. If it later unblocks,
      // our already-rejected request must not publish a surprise upgrade.
      if (failed) { try { request.transaction?.abort(); } catch { /* already aborted */ } return; }
      try {
        const tx = request.transaction!; validateLayout(request.result, tx, event.oldVersion);
        if (event.oldVersion === 3) {
          // Validate, but never rewrite, prior incarnation/admission/intent bytes.
          const birth = tx.objectStore('incarnations').get(INCARNATION_KEY);
          birth.onsuccess = () => { try {
            const incarnation = checkedAdmissionValue(storeIncarnationSchema, birth.result);
            for (const name of ['incarnations', 'admissions', 'enrollmentIntents'] as const) {
              const read = tx.objectStore(name).openCursor();
              read.onsuccess = () => { try {
                const cursor = read.result; if (!cursor) return;
                if (name === 'incarnations') {
                  if (cursor.primaryKey !== INCARNATION_KEY || !same(checkedAdmissionValue(storeIncarnationSchema, cursor.value), incarnation)) throw new LocalEvidenceError('corrupt_record');
                } else if (name === 'admissions') {
                  const row = checkedAdmissionValue(localGenerationAdmissionSchema, cursor.value);
                  if (cursor.primaryKey !== scopeKey(row) || row.incarnationId !== incarnation.incarnationId || incarnation.continuity !== 'verified') throw new LocalEvidenceError('corrupt_record');
                } else {
                  const row = checkedAdmissionValue(enrollmentIntentRowSchema, cursor.value);
                  if (cursor.primaryKey !== row.ownerId || row.incarnationId !== incarnation.incarnationId) throw new LocalEvidenceError('corrupt_record');
                }
                cursor.continue();
              } catch (error) { abort(error); } };
            }
          } catch (error) { abort(error); } };
        }
        for (const name of STORES) {
          if (request.result.objectStoreNames.contains(name)) continue;
          const store = request.result.createObjectStore(name);
          if (name === 'events') store.createIndex('semanticKey', 'semanticKey', { unique: true });
          if (name === 'checkpoints') store.createIndex('episodeKey', 'episodeKey', { unique: true });
          if (name === 'reviewRuns') store.createIndex('managedSlot', 'managedSlot', { unique: true });
          if (name === 'incarnations') store.put({ version: 1, incarnationId: crypto.randomUUID(),
            origin: event.oldVersion === 0 ? 'created' : 'unproven_upgrade', continuity: 'unknown' } satisfies StoreIncarnation, INCARNATION_KEY);
        }
      } catch (error) { abort(error); }
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
  private readonly writerAdmission: Readonly<LocalGenerationAdmission> | null | undefined;
  private readonly onAdmissionLost?: () => void;
  private admissionLost = false;
  constructor(options: { factory?: IDBFactory; isCurrent: (fence: LocalFence) => boolean; writerAdmission?: LocalGenerationAdmission | null; onAdmissionLost?: () => void }) {
    this.factory = options.factory ?? globalThis.indexedDB;
    this.isCurrent = options.isCurrent;
    // Production constructors always provide this field. Undefined preserves the
    // isolated A2.1 library contract; it is forbidden by production source closure.
    this.writerAdmission = options.writerAdmission == null ? options.writerAdmission : immutableCopy(checkedAdmissionValue(localGenerationAdmissionSchema, options.writerAdmission));
    this.onAdmissionLost = options.onAdmissionLost;
  }
  private fence(value: LocalFence): void {
    if (!this.isCurrent(value)) throw new LocalEvidenceError('stale_context');
  }
  /** All callbacks are synchronous. Crypto/validation awaits happen outside IDB transactions. */
  private async transaction<T>(fence: LocalFence, mode: IDBTransactionMode,
    work: (tx: IDBTransaction, setResult: (result: T) => void, fail: (error: unknown) => void) => void, cacheOnly = false): Promise<T> {
    const guard = () => { this.fence(fence); if (this.admissionLost && !cacheOnly) throw new LocalEvidenceError('stale_context'); };
    return this.guardedTransaction(guard, mode, (tx, done, fail, incarnation) => {
      const expected = this.writerAdmission;
      if (expected === undefined) { work(tx, done, fail); return; }
      const lost = () => { this.admissionLost = true; this.onAdmissionLost?.(); if (!cacheOnly) throw new LocalEvidenceError('stale_context'); };
      if (!expected) { lost(); work(tx, done, fail); return; }
      if (incarnation.incarnationId !== expected.incarnationId || incarnation.continuity !== 'verified'
        || expected.ownerId !== fence.ownerId || expected.generationId !== fence.generationId) {
        lost(); work(tx, done, fail); return;
      }
      // The admission comparison and operation share one all-stores transaction.
      // An already returned writer cannot reopen an evicted DB as a fresh window.
      const read = tx.objectStore('admissions').get(scopeKey(expected));
      read.onsuccess = () => {
        try {
          guard();
          if (read.result === undefined || !same(checkedAdmissionValue(localGenerationAdmissionSchema, read.result), expected)) lost();
          work(tx, done, fail);
        } catch (error) { fail(error); }
      };
    });
  }
  private async guardedTransaction<T>(guard: () => void, mode: IDBTransactionMode,
    work: (tx: IDBTransaction, setResult: (result: T) => void, fail: (error: unknown) => void, incarnation: StoreIncarnation) => void): Promise<T> {
    guard();
    const connection = await openDatabase(this.factory);
    try {
      guard();
      const result = await new Promise<T>((resolve, reject) => {
        if (connection.versionChanged) { reject(new LocalEvidenceError('idb_version_changed')); return; }
        let tx: IDBTransaction;
        try {
          if ([...connection.db.objectStoreNames].sort().join(',') !== [...STORES].sort().join(',')) throw new LocalEvidenceError('corrupt_record');
          tx = connection.db.transaction([...STORES], mode); validateLayout(connection.db, tx, 4); } catch (error) { reject(storageError(error)); return; }
        connection.transactions.add(tx);
        let result: T, failure: unknown;
        const fail = (error: unknown) => { failure = error; try { tx.abort(); } catch { reject(storageError(error)); } };
        tx.oncomplete = () => { connection.transactions.delete(tx); resolve(result); };
        tx.onerror = () => { failure ??= tx.error; };
        tx.onabort = () => {
          connection.transactions.delete(tx);
          reject(connection.versionChanged ? new LocalEvidenceError('idb_version_changed') : storageError(failure ?? tx.error, mode === 'readonly' ? 'storage_read_failed' : 'storage_abort'));
        };
        const birth = tx.objectStore('incarnations').get(INCARNATION_KEY);
        birth.onsuccess = () => {
          try {
            guard();
            const incarnation = checkedAdmissionValue(storeIncarnationSchema, birth.result);
            work(tx, value => { result = value; }, fail, incarnation);
          } catch (error) { fail(error); }
        };
      });
      if (connection.versionChanged) throw new LocalEvidenceError('idb_version_changed');
      guard();
      return result;
    } finally { connection.db.close(); }
  }
  /** Status proofs authenticate admission reads without inventing a generation. */
  async readAdmission(proof: AuthenticatedAdmissionStatusProof): Promise<AdmissionSnapshot> {
    const guard = () => assertAuthenticatedAdmissionStatus(proof); guard();
    return this.guardedTransaction<AdmissionSnapshot>(guard, 'readwrite', (tx, done, fail, incarnation) => {
      const guarded = (work: () => void) => { try { guard(); work(); } catch (error) { fail(error); } };
      const intents = tx.objectStore('enrollmentIntents'), readIntent = intents.get(proof.ownerId);
      readIntent.onsuccess = () => guarded(() => {
        let intent: FrozenEnrollmentIntent | null = null;
        if (readIntent.result !== undefined) {
          const row = checkedAdmissionValue(enrollmentIntentRowSchema, readIntent.result);
          if (row.ownerId !== proof.ownerId || row.incarnationId !== incarnation.incarnationId) throw new LocalEvidenceError('corrupt_record');
          const stale = !same(row.intent.resetMarker, proof.resetMarker) || proof.status === 'enrolled_generation_missing' ||
            proof.status === 'enrolled' && (proof.creationRequestId !== row.intent.requestId || proof.initialGenerationId !== proof.currentContext?.generationId);
          if (stale) intents.delete(proof.ownerId); else intent = row.intent;
        }
        const finish = (admission: LocalGenerationAdmission | null) => done(immutableCopy({ incarnationId: incarnation.incarnationId,
          origin: incarnation.origin, continuity: admission && incarnation.continuity === 'verified' ? 'verified' : 'unknown', admission, intent }));
        if (proof.status !== 'enrolled' || !proof.currentContext) { finish(null); return; }
        const context = proof.currentContext, read = tx.objectStore('admissions').get(scopeKey(context));
        read.onsuccess = () => guarded(() => {
          if (read.result === undefined) { finish(null); return; }
          const admission = checkedAdmissionValue(localGenerationAdmissionSchema, read.result);
          if (admission.ownerId !== proof.ownerId || admission.generationId !== context.generationId || admission.incarnationId !== incarnation.incarnationId ||
            admission.creationRequestId !== proof.creationRequestId || admission.initialGenerationId !== proof.initialGenerationId ||
            !same(admission.resetMarker, proof.resetMarker)) throw new LocalEvidenceError('corrupt_record');
          // A row never repairs lost/corrupt incarnation metadata.
          finish(incarnation.continuity === 'verified' ? admission : null);
        });
      });
    });
  }
  async freezeEnrollmentIntent(input: FrozenEnrollmentIntent, proof: AuthenticatedAdmissionStatusProof): Promise<FrozenEnrollmentIntent> {
    const guard = () => assertAuthenticatedAdmissionStatus(proof); guard();
    const intent = immutableCopy(checkedAdmissionValue(frozenEnrollmentIntentSchema, input));
    if (proof.status !== 'unenrolled' || proof.currentContext !== null || proof.creationRequestId !== null || proof.initialGenerationId !== null ||
      proof.ownerId !== intent.ownerId || !same(proof.resetMarker, intent.resetMarker)) throw new LocalEvidenceError('stale_context');
    let failure: unknown;
    try {
      await this.guardedTransaction<void>(guard, 'readwrite', (tx, done, fail, incarnation) => {
        if (incarnation.origin !== 'created') throw new LocalEvidenceError('unsupported_history');
        const guarded = (work: () => void) => { try { guard(); work(); } catch (error) { fail(error); } };
        let remaining = SCOPED_STORES.length + 1;
        const finish = () => {
          if (--remaining) return;
          guard();
          tx.objectStore('enrollmentIntents').put({ version: 1, ownerId: intent.ownerId, incarnationId: incarnation.incarnationId, intent } satisfies EnrollmentIntentRow, intent.ownerId);
          done();
        };
        const current = tx.objectStore('enrollmentIntents').get(intent.ownerId);
        current.onsuccess = () => guarded(() => {
          if (current.result !== undefined) {
            const row = checkedAdmissionValue(enrollmentIntentRowSchema, current.result);
            if (row.ownerId !== intent.ownerId || row.incarnationId !== incarnation.incarnationId) throw new LocalEvidenceError('corrupt_record');
            if (!same(row.intent, intent)) throw new LocalEvidenceError('checkpoint_conflict');
          }
          finish();
        });
        for (const name of SCOPED_STORES) {
          const request = tx.objectStore(name).openCursor();
          request.onsuccess = () => guarded(() => {
            const cursor = request.result; if (!cursor) { finish(); return; }
            const scope = cleanupIdentity(name, cursor.primaryKey, cursor.value, incarnation.incarnationId);
            if (scope.ownerId === intent.ownerId) throw new LocalEvidenceError('unsupported_history');
            cursor.continue();
          });
        }
      });
    } catch (error) { failure = error; }
    guard();
    if (failure instanceof LocalEvidenceError && ['stale_context', 'corrupt_record', 'checkpoint_conflict', 'unsupported_history'].includes(failure.code)) throw failure;
    const snapshot = await this.readAdmission(proof); guard();
    if (!snapshot.intent || !same(snapshot.intent, intent)) {
      if (failure) throw storageError(failure);
      throw new LocalEvidenceError('commit_unconfirmed');
    }
    return snapshot.intent;
  }
  /** Only an independently checked receipt/read-first proof can promote a birth. */
  async completeFirstAdmission(input: FrozenEnrollmentIntent, proof: AuthenticatedFirstAdmissionProof): Promise<void> {
    const guard = () => assertAuthenticatedFirstAdmission(proof); guard();
    const intent = immutableCopy(checkedAdmissionValue(frozenEnrollmentIntentSchema, input));
    const context = serverEvidenceContextSchema.parse(proof.currentContext);
    if (!same(proof.intent, intent) || proof.ownerId !== intent.ownerId || context.ownerId !== intent.ownerId ||
      proof.creationRequestId !== intent.requestId || proof.initialGenerationId !== context.generationId || !same(context.resetMarker, intent.resetMarker) ||
      context.studyDayTimezone !== intent.studyDayTimezone || context.protocol !== intent.protocol || context.manifestRelease !== intent.manifestRelease ||
      context.manifestDigest !== intent.manifestDigest) throw new LocalEvidenceError('stale_context');
    const admission: LocalGenerationAdmission = { version: 1, ownerId: intent.ownerId, generationId: context.generationId,
      incarnationId: proof.incarnationId, continuity: 'verified', kind: 'first_enrollment', creationRequestId: proof.creationRequestId,
      initialGenerationId: proof.initialGenerationId, resetMarker: context.resetMarker, resetRequestId: null };
    checkedAdmissionValue(localGenerationAdmissionSchema, admission);
    const cache: CachedEvidenceContext = { version: 1, ownerId: context.ownerId, generationId: context.generationId, context, status: 'previously_verified_offline' };
    const check = (write: boolean) => this.guardedTransaction<boolean>(guard, write ? 'readwrite' : 'readonly', (tx, done, fail, incarnation) => {
      if (incarnation.origin !== 'created' || incarnation.incarnationId !== proof.incarnationId) throw new LocalEvidenceError('unsupported_history');
      const guarded = (work: () => void) => { try { guard(); work(); } catch (error) { fail(error); } };
      const read = tx.objectStore('admissions').get(scopeKey(admission));
      read.onsuccess = () => guarded(() => {
        if (read.result !== undefined) {
          const current = checkedAdmissionValue(localGenerationAdmissionSchema, read.result);
          if (!same(current, admission)) throw new LocalEvidenceError('checkpoint_conflict');
          if (incarnation.continuity !== 'verified') { done(false); return; }
          const cached = tx.objectStore('contexts').get(scopeKey(admission));
          cached.onsuccess = () => guarded(() => {
            const checked = checkedCacheRow(cached.result, false);
            const stable = (value: CachedEvidenceContext['context']) => ({ ...value, serverTime: null, highWater: null });
            if (checked.ownerId !== admission.ownerId || checked.generationId !== admission.generationId || !same(stable(checked.context), stable(context))) throw new LocalEvidenceError('corrupt_record');
            done(true);
          });
          return;
        }
        if (!write) { done(false); return; }
        const pending = tx.objectStore('enrollmentIntents').get(intent.ownerId);
        pending.onsuccess = () => guarded(() => {
          const row = checkedAdmissionValue(enrollmentIntentRowSchema, pending.result);
          if (row.ownerId !== intent.ownerId || row.incarnationId !== proof.incarnationId || !same(row.intent, intent)) throw new LocalEvidenceError('checkpoint_conflict');
          let remaining = SCOPED_STORES.length;
          for (const name of SCOPED_STORES) {
            const request = tx.objectStore(name).openCursor();
            request.onsuccess = () => guarded(() => {
              const cursor = request.result;
              if (cursor) {
                const scope = cleanupIdentity(name, cursor.primaryKey, cursor.value, incarnation.incarnationId);
                if (scope.ownerId === intent.ownerId) throw new LocalEvidenceError('unsupported_history');
                cursor.continue(); return;
              }
              if (--remaining) return;
              guard();
              tx.objectStore('incarnations').put({ ...incarnation, continuity: 'verified' } satisfies StoreIncarnation, INCARNATION_KEY);
              tx.objectStore('admissions').add(admission, scopeKey(admission));
              tx.objectStore('contexts').put(cache, scopeKey(cache));
              tx.objectStore('enrollmentIntents').delete(intent.ownerId);
              done(true);
            });
          }
        });
      });
    });
    if (await check(false)) return;
    let failure: unknown; try { await check(true); } catch (error) { failure = error; }
    guard();
    try { if (await check(false)) { guard(); return; } }
    catch (error) {
      if (error instanceof LocalEvidenceError && ['stale_context', 'corrupt_record', 'checkpoint_conflict', 'unsupported_history'].includes(error.code)) throw error;
      throw new LocalEvidenceError('commit_unconfirmed');
    }
    if (failure) throw storageError(failure);
    throw new LocalEvidenceError('commit_unconfirmed');
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
    const rows = await this.transaction<{ commit?: CommitRow; event?: EventRow; checkpoint?: CheckpointRow; delivery?: DeliveryMetadata }>(value.fence, 'readonly', (tx, done, fail) => {
      this.rejectManagedSlot(tx, value, fail, () => {});
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
  private rejectManagedSlot(tx: IDBTransaction, value: PreparedCapture, fail: (error: unknown) => void, next: () => void): void {
    const read = tx.objectStore('reviewRuns').index('managedSlot').get(reviewManagedSlot(value.checkpoint));
    read.onsuccess = () => { try { this.fence(value.fence); if (read.result !== undefined) throw new LocalEvidenceError('managed_review_slot'); next(); } catch (error) { fail(error); } };
  }
  private writeCaptureInTransaction(tx: IDBTransaction, value: PreparedCapture, done: () => void, fail: (error: unknown) => void, authority: LocalFence = value.fence): void {
        const commits = tx.objectStore('commits'), request = commits.get(commitKey(value));
        request.onsuccess = () => {
          try {
            this.fence(authority);
            const committed = request.result as CommitRow | undefined;
            if (committed) { if (committed.canonical !== canonicalEvidence(value)) throw new LocalEvidenceError('event_conflict'); done(); return; }
            const cp = value.checkpoint, checkpoints = tx.objectStore('checkpoints');
            const key = checkpointStorageKey(cp.ownerId, cp.generationId, cp.sourceSlotKey), read = checkpoints.get(key);
            read.onsuccess = () => {
              try {
                this.fence(authority);
                const row = read.result as CheckpointRow | undefined;
                const write = () => {
                  this.fence(authority);
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

  }
  /** Uncertain writes are read first. Retries always use the same frozen transition and IDs. */
  async commit(input: PreparedCapture): Promise<LocalCommitResult> {
    const value = immutableCopy(input); await verifyPreparedCapture(value); this.fence(value.fence);
    const previouslyCommitted = await this.readCommit(value);
    if (previouslyCommitted) return { status: 'local_committed', delivery: 'pending', replay: true, checkpoint: immutableCopy(previouslyCommitted) };
    let writeFailure: unknown;
    try {
      await this.transaction<void>(value.fence, 'readwrite', (tx, done, fail) => {
        this.rejectManagedSlot(tx, value, fail, () => this.writeCaptureInTransaction(tx, value, done, fail));
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
  private requireReviewAdmission(fence: LocalFence, scope?: ReviewScope): void {
    this.fence(fence);
    const admission = this.writerAdmission;
    if (!admission || this.admissionLost || admission.ownerId !== fence.ownerId || admission.generationId !== fence.generationId ||
      scope && (scope.ownerId !== admission.ownerId || scope.generationId !== admission.generationId || scope.incarnationId !== admission.incarnationId)) throw new LocalEvidenceError('stale_context');
  }
  private reviewCursorRows(tx: IDBTransaction, ownerId: string, fail: (error: unknown) => void, done: (rows: ReviewAccountingRow[]) => void): void {
    const rows: ReviewAccountingRow[] = []; let remaining = REVIEW_STORES.length, bytes = 0;
    const maxRows = REVIEW_LIMITS.runs * 2 + REVIEW_LIMITS.exposures + REVIEW_LIMITS.journals;
    for (const store of REVIEW_STORES) {
      const read = tx.objectStore(store).openCursor();
      read.onsuccess = () => { try {
        const cursor = read.result;
        if (!cursor) { if (--remaining === 0) done(rows); return; }
        const scope = reviewRowIdentity(store, cursor.primaryKey, cursor.value);
        if (scope.incarnationId !== this.writerAdmission?.incarnationId) throw new LocalEvidenceError('corrupt_record');
        if (scope.ownerId === ownerId) {
          bytes += new TextEncoder().encode(canonicalEvidence(cursor.value)).byteLength;
          if (rows.length >= maxRows || bytes > REVIEW_LIMITS.ownerBytes) throw new LocalEvidenceError('review_capacity');
          rows.push({ store, key: cursor.primaryKey, value: cursor.value });
        }
        cursor.continue();
      } catch (error) { fail(error); } };
    }
  }
  /** Reads a bounded complete owner graph, including immutable dependencies. */
  private async readReviewGraph(fence: LocalFence): Promise<{ rows: ReviewAccountingRow[]; captures: Map<string, PreparedCapture> }> {
    this.requireReviewAdmission(fence);
    const data = await this.transaction<{ rows: ReviewAccountingRow[]; commits: Map<string, CommitRow>; events: Map<string, EventRow>; checkpoints: Map<string, CheckpointRow>; deliveries: Map<string, DeliveryMetadata> }>(fence, 'readonly', (tx, done, fail) => {
      this.reviewCursorRows(tx, fence.ownerId, fail, rows => { try {
        this.requireReviewAdmission(fence); accountReviewRows(rows, fence.ownerId);
        const result = { rows, commits: new Map<string, CommitRow>(), events: new Map<string, EventRow>(), checkpoints: new Map<string, CheckpointRow>(), deliveries: new Map<string, DeliveryMetadata>() }; done(result);
        const requested = new Set<string>(), events = new Set<string>();
        const readEvent = (ownerId: string, eventId: string) => {
          const key = eventStorageKey(ownerId, eventId); if (events.has(key)) return; events.add(key);
          const read = tx.objectStore('events').get(key); read.onsuccess = () => { if (read.result !== undefined) result.events.set(key, read.result); };
          const delivery = tx.objectStore('delivery').get(key); delivery.onsuccess = () => { if (delivery.result !== undefined) result.deliveries.set(key, delivery.result); };
        };
        const readCapture = (scope: ReviewScope, transitionId: string) => {
          const key = JSON.stringify([scope.ownerId, scope.generationId, transitionId]); if (requested.has(key)) return; requested.add(key);
          const read = tx.objectStore('commits').get(key); read.onsuccess = () => { try {
            if (read.result === undefined) return; result.commits.set(key, read.result);
            const capture = JSON.parse((read.result as CommitRow).canonical) as PreparedCapture;
            if (!capture?.checkpoint?.predecessor || !capture.checkpoint.presentation) throw new LocalEvidenceError('corrupt_record');
            readEvent(scope.ownerId, capture.checkpoint.predecessor.eventId); readEvent(scope.ownerId, capture.checkpoint.presentation.eventId);
          } catch (error) { fail(error); } };
        };
        for (const row of rows) {
          if (row.store === 'reviewTransitions') {
            const { payload } = parseReviewJournal(row.value);
            for (const ref of [payload.captureRef, payload.before.runState?.checkpoint, payload.after.runState.checkpoint]) if (ref) readCapture(payload.scope, ref.transitionId);
            for (const ref of [payload.before.runState?.lastHandoff, payload.after.runState.lastHandoff, payload.after.runState.retirement?.handoff]) if (ref) readCapture(payload.scope, ref.transitionId);
          } else if (row.store === 'reviewRuns' && (row.value as ReviewRun).kind === 'run') {
            const run = parseReviewRun(row.value), key = checkpointStorageKey(run.ownerId, run.generationId, run.immutable.sourceSlotKey);
            const read = tx.objectStore('checkpoints').get(key); read.onsuccess = () => { if (read.result !== undefined) result.checkpoints.set(key, read.result); };
          }
        }
      } catch (error) { fail(error); } });
    });
    this.requireReviewAdmission(fence);
    const captures = new Map<string, PreparedCapture>();
    for (const [key, row] of data.commits) {
      const capture = JSON.parse(row.canonical) as PreparedCapture; await verifyPreparedCapture(capture); this.requireReviewAdmission(fence);
      if (row.canonical !== canonicalEvidence(capture) || key !== commitKey(capture) || row.ownerId !== capture.fence.ownerId || row.generationId !== capture.fence.generationId) throw new LocalEvidenceError('corrupt_record');
      for (const ref of [capture.checkpoint.predecessor, { eventId: capture.checkpoint.presentation.eventId, payloadHash: null }]) {
        const eventKey = eventStorageKey(row.ownerId, ref.eventId), eventRow = data.events.get(eventKey), metadata = data.deliveries.get(eventKey);
        if (!eventRow || !metadata) throw new LocalEvidenceError('corrupt_record');
        const event = await verifyFrozenEvidence(eventRow.value); this.requireReviewAdmission(fence); const delivery = decodeDeliveryMetadata(metadata);
        if (eventRow.ownerId !== row.ownerId || eventRow.generationId !== row.generationId || eventRow.value.ownerId !== row.ownerId || event.generationId !== row.generationId ||
          event.sourceSlotKey !== capture.checkpoint.sourceSlotKey || event.episodeId !== capture.checkpoint.episodeId || event.eventId !== ref.eventId ||
          ref.payloadHash === null && !same(event, capture.checkpoint.presentation) ||
          eventRow.semanticKey !== JSON.stringify([row.ownerId, row.generationId, event.sourceSlotKey, event.sequence]) || ref.payloadHash && eventRow.value.payloadHash !== ref.payloadHash ||
          delivery.eventId !== event.eventId || delivery.ownerId !== row.ownerId || delivery.generationId !== row.generationId || delivery.payloadHash !== eventRow.value.payloadHash) throw new LocalEvidenceError('corrupt_record');
        if (delivery.status === 'quarantined') throw new LocalEvidenceError('quarantined');
        if (delivery.status === 'acknowledged') await this.readDelivery(fence, delivery.eventId);
      }
      if (capture.event && !same(data.events.get(eventStorageKey(row.ownerId, capture.event.eventId))?.value, capture.event)) throw new LocalEvidenceError('corrupt_record');
      captures.set(key, capture);
    }
    const runs = new Map(data.rows.filter(r => r.store === 'reviewRuns' && (r.value as ReviewRun).kind === 'run').map(r => [String(r.key), parseReviewRun(r.value)]));
    const journals = new Map(data.rows.filter(r => r.store === 'reviewTransitions').map(r => [String(r.key), parseReviewJournal(r.value)]));
    type State = NonNullable<ReviewJournalPayload['before'][keyof ReviewJournalPayload['before']]>;
    const histories = new Map<string, Map<number, { before: State | null; after: State }>>();
    const entityKey = (store: 'reviewRuns' | 'itemExposures', key: IDBValidKey) => canonicalEvidence([store, key]);
    const retainHistory = (store: 'reviewRuns' | 'itemExposures', key: string, before: State | null, after: State | null) => {
      if (!after) { if (before) throw new LocalEvidenceError('corrupt_record'); return; }
      const identity = entityKey(store, key), history = histories.get(identity) ?? new Map<number, { before: State | null; after: State }>();
      if (history.has(after.revision)) throw new LocalEvidenceError('corrupt_record');
      history.set(after.revision, { before, after }); histories.set(identity, history);
    };
    const priorJournal = (scope: ReviewScope, transitionId: string) => {
      const found = journals.get(reviewJournalKey(scope, transitionId)); if (!found) throw new LocalEvidenceError('corrupt_record'); return found.payload;
    };
    for (const { row, payload } of journals.values()) {
      const run = runs.get(payload.immutableSourceRef.runKey); if (!run || run.immutable.runId !== payload.runId || !same({ ownerId: run.ownerId, generationId: run.generationId, incarnationId: run.incarnationId }, payload.scope)) throw new LocalEvidenceError('corrupt_record');
      const capture = payload.captureRef ? captures.get(JSON.stringify([row.ownerId, row.generationId, payload.captureRef.transitionId])) : null;
      if (payload.captureRef && !capture) throw new LocalEvidenceError('corrupt_record');
      await verifyReviewTransition({ version: 1, fence: capture?.fence ?? { ownerId: fence.ownerId, generationId: fence.generationId, ownerEpoch: fence.ownerEpoch }, immutable: run.immutable, journal: row, capture: capture ?? null }); this.requireReviewAdmission(fence);
      retainHistory('reviewRuns', reviewRunKey(run.immutable), payload.before.runState, payload.after.runState);
      retainHistory('reviewRuns', reviewRowFenceKey(run.immutable), payload.before.rowFence, payload.after.rowFence);
      retainHistory('itemExposures', reviewExposureKey({ ...run.immutable, ...run.immutable.identity }), payload.before.exposure, payload.after.exposure);
      for (const [kind, before] of [['runState', payload.before.runState], ['exposure', payload.before.exposure], ['rowFence', payload.before.rowFence]] as const) {
        if (!before) continue;
        const prior = priorJournal(payload.scope, before.latestTransitionId);
        if (!same(prior.after[kind], before) || kind === 'runState' && prior.runId !== payload.runId || kind === 'rowFence' && runs.get(prior.immutableSourceRef.runKey)?.immutable.rowKey !== run.immutable.rowKey) throw new LocalEvidenceError('corrupt_record');
      }
      for (const ref of [payload.captureRef, payload.before.runState?.checkpoint, payload.after.runState.checkpoint]) {
        if (!ref) continue; const linked = captures.get(JSON.stringify([row.ownerId, row.generationId, ref.transitionId]));
        if (!linked || await canonicalSha256(canonicalEvidence(linked)) !== ref.canonicalSha256 || linked.checkpoint.checkpointRevision !== ref.checkpointRevision ||
          linked.checkpoint.sourceSlotKey !== ref.sourceSlotKey || !same(linked.checkpoint.predecessor, ref.predecessor) || (linked.event?.eventId ?? null) !== ref.eventId || (linked.event?.payloadHash ?? null) !== ref.payloadHash) throw new LocalEvidenceError('corrupt_record');
      }
      if (capture?.expected && payload.before.runState?.checkpoint) {
        const prior = captures.get(JSON.stringify([row.ownerId, row.generationId, payload.before.runState.checkpoint.transitionId]));
        if (!prior || capture.expected.canonical !== canonicalEvidence(prior.checkpoint)) throw new LocalEvidenceError('corrupt_record');
      }
      for (const ref of [payload.before.runState?.lastHandoff, payload.after.runState.lastHandoff, payload.after.runState.retirement?.handoff]) {
        if (!ref) continue; const handoff = captures.get(JSON.stringify([row.ownerId, row.generationId, ref.transitionId]))?.checkpoint.handoff;
        if (!handoff || handoff.eventId !== ref.eventId || handoff.draftToken !== ref.draftToken) throw new LocalEvidenceError('corrupt_record');
      }
    }
    // A pointer to any valid old journal is not a current-state proof. Every
    // retained entity must have one contiguous, unforked history from creation,
    // and its stored mutable row must equal that history's unique terminal tip.
    const currentStates = new Map<string, State>();
    const rowFences = new Map<string, ReviewRowFence>();
    for (const entry of data.rows) {
      if (entry.store === 'itemExposures') currentStates.set(entityKey(entry.store, entry.key), parseReviewExposure(entry.value));
      else if (entry.store === 'reviewRuns') {
        if ((entry.value as ReviewRun).kind === 'run') currentStates.set(entityKey(entry.store, entry.key), parseReviewRun(entry.value).state);
        else { const row = parseReviewRowFence(entry.value); rowFences.set(String(entry.key), row); currentStates.set(entityKey(entry.store, entry.key), row.state); }
      }
    }
    if (currentStates.size !== histories.size) throw new LocalEvidenceError('corrupt_record');
    for (const [identity, history] of histories) {
      let previous: State | null = null;
      for (let revision = 1; revision <= history.size; revision++) {
        const step = history.get(revision);
        if (!step || !same(step.before, previous)) throw new LocalEvidenceError('corrupt_record');
        previous = step.after;
      }
      if (!currentStates.has(identity) || !same(currentStates.get(identity), previous)) throw new LocalEvidenceError('corrupt_record');
    }
    // Accounting checks pointer -> live run. Check the reverse as well, and
    // bind both sides of an outstanding retirement to its exact claimant.
    for (const run of runs.values()) {
      const row = rowFences.get(reviewRowFenceKey(run.immutable));
      if (!row || row.state.pointers.some(p => p.runId === run.immutable.runId && p.slot === run.immutable.slot) !== (run.state.lifecycle !== 'closed')) throw new LocalEvidenceError('corrupt_record');
      const claim = row.state.retirement?.runId === run.immutable.runId ? row.state.retirement : null;
      if (run.state.lifecycle === 'retiring') {
        if (!run.state.retirement || run.state.retirement.outcome || !same(claim, { runId: run.immutable.runId, retirementId: run.state.retirement.retirementId, kind: run.state.retirement.kind }) ||
          run.state.action?.kind !== 'retirement' || run.state.action.rootActionId !== run.state.retirement.retirementId) throw new LocalEvidenceError('corrupt_record');
      } else if (claim) throw new LocalEvidenceError('corrupt_record');
    }
    for (const entry of data.rows) {
      if (entry.store === 'reviewRuns' && (entry.value as ReviewRun).kind === 'run') {
        const run = parseReviewRun(entry.value), latest = priorJournal(run, run.state.latestTransitionId);
        if (latest.runId !== run.immutable.runId || !same(latest.after.runState, run.state)) throw new LocalEvidenceError('corrupt_record');
        const cp = data.checkpoints.get(checkpointStorageKey(run.ownerId, run.generationId, run.immutable.sourceSlotKey));
        if (run.state.checkpoint) {
          const committed = captures.get(JSON.stringify([run.ownerId, run.generationId, run.state.checkpoint.transitionId]));
          if (!committed || !cp || cp.ownerId !== run.ownerId || cp.generationId !== run.generationId || cp.latestTransitionId !== committed.transitionId || !same(cp.value, committed.checkpoint) || cp.episodeKey !== episodeKey(committed.checkpoint)) throw new LocalEvidenceError('corrupt_record');
        } else if (cp) throw new LocalEvidenceError('corrupt_record');
      } else if (entry.store === 'reviewRuns') {
        const row = parseReviewRowFence(entry.value), latest = priorJournal(row, row.state.latestTransitionId);
        if (runs.get(latest.immutableSourceRef.runKey)?.immutable.rowKey !== row.rowKey || !same(latest.after.rowFence, row.state)) throw new LocalEvidenceError('corrupt_record');
      } else if (entry.store === 'itemExposures') {
        const row = parseReviewExposure(entry.value); if (!same(priorJournal(row, row.latestTransitionId).after.exposure, row)) throw new LocalEvidenceError('corrupt_record');
      }
    }
    this.requireReviewAdmission(fence); return { rows: data.rows, captures };
  }
  async readReviewTransition(input: PreparedReviewTransition, currentFence: LocalFence = input.fence): Promise<{ status: 'local_committed'; run: Immutable<ReviewRun>; transition: Immutable<ReviewJournalPayload> } | null> {
    const prepared = immutableCopy(input), payload = await verifyReviewTransition(prepared); this.requireReviewAdmission(currentFence, payload.scope);
    const graph = await this.readReviewGraph(currentFence), found = graph.rows.find(r => r.store === 'reviewTransitions' && r.key === reviewJournalKey(payload.scope, payload.transitionId));
    if (!found) return null;
    if (!same(found.value, prepared.journal)) throw new LocalEvidenceError('event_conflict');
    if (prepared.capture) {
      const capture = graph.captures.get(commitKey(prepared.capture)); if (!capture || canonicalEvidence(capture) !== canonicalEvidence(prepared.capture)) throw new LocalEvidenceError('event_conflict');
    }
    const run = graph.rows.find(r => r.store === 'reviewRuns' && r.key === reviewRunKey(prepared.immutable));
    if (!run || !same(parseReviewRun(run.value).immutable, prepared.immutable)) throw new LocalEvidenceError('corrupt_record');
    return { status: 'local_committed', run: immutableCopy(parseReviewRun(run.value)), transition: immutableCopy(payload) };
  }
  async readReviewState(fence: LocalFence, query: ReviewScope & { rowKey: string; itemId: string; contentRevision: number }): Promise<Immutable<{ rowFence: ReviewRowFence | null; exposure: ReviewExposure | null }>> {
    this.requireReviewAdmission(fence, query); const graph = await this.readReviewGraph(fence);
    const row = graph.rows.find(r => r.store === 'reviewRuns' && r.key === reviewRowFenceKey(query));
    const exposure = graph.rows.find(r => r.store === 'itemExposures' && r.key === reviewExposureKey(query));
    return immutableCopy({ rowFence: row ? parseReviewRowFence(row.value) : null, exposure: exposure ? parseReviewExposure(exposure.value) : null });
  }
  async findReviewRun(fence: LocalFence, query: { scope: ReviewScope; rowKey: string; slot: string; originalSource: ReviewRunImmutable['originalSource']; mode: ReviewRunImmutable['mode'] }): Promise<Immutable<ReviewRows> | null> {
    this.requireReviewAdmission(fence, query.scope); const graph = await this.readReviewGraph(fence);
    const rowEntry = graph.rows.find(r => r.store === 'reviewRuns' && r.key === reviewRowFenceKey({ ...query.scope, rowKey: query.rowKey })); if (!rowEntry) return null;
    const rowFence = parseReviewRowFence(rowEntry.value); if (rowFence.state.retirement) throw new LocalEvidenceError('review_conflict');
    const active = graph.rows.filter(r => r.store === 'reviewRuns' && (r.value as ReviewRun).kind === 'run').map(r => parseReviewRun(r.value))
      .filter(r => r.ownerId === query.scope.ownerId && r.generationId === query.scope.generationId && r.incarnationId === query.scope.incarnationId && rowFence.state.pointers.some(p => p.runId === r.immutable.runId));
    if (active.some(r => !same(r.immutable.originalSource, query.originalSource))) throw new LocalEvidenceError('review_conflict');
    const run = active.find(r => r.immutable.slot === query.slot); if (!run) return null;
    if (run.immutable.mode !== query.mode) throw new LocalEvidenceError('review_conflict');
    const exposureEntry = graph.rows.find(r => r.store === 'itemExposures' && r.key === reviewExposureKey({ ...query.scope, ...run.immutable.identity }));
    if (!exposureEntry) throw new LocalEvidenceError('corrupt_record');
    return immutableCopy({ run, rowFence, exposure: parseReviewExposure(exposureEntry.value) });
  }
  /** Durable same-slot find-or-create; a losing candidate is never called committed. */
  async findOrAcquireReviewRun(input: PreparedReviewTransition, currentFence: LocalFence = input.fence): Promise<Immutable<ReviewRows>> {
    const value = immutableCopy(input), payload = await verifyReviewTransition(value);
    if (payload.operation.kind !== 'acquire') throw new LocalEvidenceError('invalid_input');
    this.requireReviewAdmission(currentFence, payload.scope);
    const query = { scope: payload.scope, rowKey: value.immutable.rowKey, slot: value.immutable.slot, originalSource: value.immutable.originalSource, mode: value.immutable.mode };
    const prior = await this.findReviewRun(currentFence, query); if (prior) return prior;
    try { await this.commitReviewTransition(value, currentFence); }
    catch (error) {
      if (!(error instanceof LocalEvidenceError) || error.code !== 'review_conflict') throw error;
      const winner = await this.findReviewRun(currentFence, query); if (winner) return winner; throw error;
    }
    const committed = await this.findReviewRun(currentFence, query); if (!committed) throw new LocalEvidenceError('commit_unconfirmed'); return committed;
  }
  /** One all-stores transaction, followed by exact independent historical proof. */
  async commitReviewTransition(input: PreparedReviewTransition, currentFence: LocalFence = input.fence): Promise<{ status: 'local_committed'; replay: boolean; run: Immutable<ReviewRun>; transition: Immutable<ReviewJournalPayload> }> {
    const prepared = immutableCopy(input), payload = await verifyReviewTransition(prepared); this.requireReviewAdmission(currentFence, payload.scope);
    const existing = await this.readReviewTransition(prepared, currentFence); if (existing) return { ...existing, replay: true };
    const verifiedGraph = await this.readReviewGraph(currentFence);
    let writeFailure: unknown;
    try {
      await this.transaction<void>(currentFence, 'readwrite', (tx, done, fail) => {
        this.requireReviewAdmission(currentFence, payload.scope);
        this.reviewCursorRows(tx, prepared.fence.ownerId, fail, rows => { try {
          this.requireReviewAdmission(currentFence, payload.scope); accountReviewRows(rows, prepared.fence.ownerId);
          const key = reviewJournalKey(payload.scope, payload.transitionId), replay = rows.find(r => r.store === 'reviewTransitions' && r.key === key);
          if (replay) { if (!same(replay.value, prepared.journal)) throw new LocalEvidenceError('event_conflict'); done(); return; }
          if (!same(rows, verifiedGraph.rows)) throw new LocalEvidenceError('review_conflict');
          if (!payload.before.runState?.action && rows.some(r => r.store === 'reviewTransitions' && parseReviewJournal(r.value).payload.actionId === payload.actionId)) throw new LocalEvidenceError('review_conflict');
          const next = reviewTransitionRows(prepared), runKey = reviewRunKey(prepared.immutable), rowKey = reviewRowFenceKey({ ...payload.scope, rowKey: prepared.immutable.rowKey }),
            exposureKey = reviewExposureKey({ ...payload.scope, ...prepared.immutable.identity });
          const persistedRun = rows.find(r => r.store === 'reviewRuns' && r.key === runKey), persistedFence = rows.find(r => r.store === 'reviewRuns' && r.key === rowKey), persistedExposure = rows.find(r => r.store === 'itemExposures' && r.key === exposureKey);
          const oldRun = persistedRun ? parseReviewRun(persistedRun.value) : null;
          if (oldRun && !same(oldRun.immutable, prepared.immutable) || !same(oldRun?.state ?? null, payload.before.runState) ||
            !same(persistedFence ? parseReviewRowFence(persistedFence.value).state : null, payload.before.rowFence) || !same(persistedExposure?.value ?? null, payload.before.exposure)) throw new LocalEvidenceError('review_conflict');
          // Stable row identity fences source replacement across both formats.
          if (persistedFence) for (const pointer of parseReviewRowFence(persistedFence.value).state.pointers) {
            const sibling = rows.find(r => r.store === 'reviewRuns' && (r.value as ReviewRun).kind === 'run' && (r.value as ReviewRun).immutable.runId === pointer.runId && (r.value as ReviewRun).generationId === payload.scope.generationId && (r.value as ReviewRun).incarnationId === payload.scope.incarnationId);
            if (!sibling || !same(parseReviewRun(sibling.value).immutable.originalSource, prepared.immutable.originalSource)) throw new LocalEvidenceError('review_conflict');
          }
          const replacements: ReviewAccountingRow[] = [{ store: 'reviewRuns', key: runKey, value: next.run }, { store: 'reviewRuns', key: rowKey, value: next.rowFence },
            ...(next.exposure ? [{ store: 'itemExposures' as const, key: exposureKey, value: next.exposure }] : []), { store: 'reviewTransitions', key, value: prepared.journal }];
          accountReviewRows([...rows.filter(r => !replacements.some(n => n.store === r.store && n.key === r.key)), ...replacements], prepared.fence.ownerId);
          const write = () => {
            this.requireReviewAdmission(currentFence, payload.scope);
            const dependencies = new Set([payload.before.runState?.checkpoint?.transitionId, payload.before.runState?.lastHandoff?.transitionId].filter((id): id is string => Boolean(id)));
            let remaining = dependencies.size + (payload.before.runState?.checkpoint ? 1 : 0) + (prepared.capture ? 1 : 0);
            const persist = () => {
              this.requireReviewAdmission(currentFence, payload.scope);
              for (const row of replacements) tx.objectStore(row.store).put(row.value, row.key);
              if (prepared.capture) this.writeCaptureInTransaction(tx, prepared.capture, done, fail, currentFence); else done();
            };
            const ready = () => { if (--remaining === 0) persist(); };
            if (!remaining) { persist(); return; }
            for (const id of dependencies) {
              const key = JSON.stringify([payload.scope.ownerId, payload.scope.generationId, id]), expected = verifiedGraph.captures.get(key);
              const read = tx.objectStore('commits').get(key); read.onsuccess = () => { try {
                if (!expected || !read.result || !same(read.result, { ownerId: payload.scope.ownerId, generationId: payload.scope.generationId, canonical: canonicalEvidence(expected) })) throw new LocalEvidenceError('corrupt_record');
                ready();
              } catch (error) { fail(error); } };
            }
            if (payload.before.runState?.checkpoint) {
              const ref = payload.before.runState.checkpoint, expected = verifiedGraph.captures.get(JSON.stringify([payload.scope.ownerId, payload.scope.generationId, ref.transitionId]));
              const read = tx.objectStore('checkpoints').get(checkpointStorageKey(payload.scope.ownerId, payload.scope.generationId, prepared.immutable.sourceSlotKey));
              read.onsuccess = () => { try {
                if (!expected || !read.result || !same(read.result, { ownerId: payload.scope.ownerId, generationId: payload.scope.generationId, episodeKey: episodeKey(expected.checkpoint), latestTransitionId: ref.transitionId, value: expected.checkpoint })) throw new LocalEvidenceError('checkpoint_conflict');
                ready();
              } catch (error) { fail(error); } };
            }
            if (prepared.capture) {
              const read = tx.objectStore('commits').get(commitKey(prepared.capture)); read.onsuccess = () => { try {
                // An underlying commit without its atomic review journal is
                // corruption, never permission to adopt an old capture.
                if (read.result !== undefined) throw new LocalEvidenceError('corrupt_record'); ready();
              } catch (error) { fail(error); } };
            }
          };
          if (!oldRun) {
            let remaining = 2;
            const occupied = (value: unknown) => { if (value !== undefined) { fail(new LocalEvidenceError('managed_review_slot')); return; } if (--remaining === 0) write(); };
            const cp = tx.objectStore('checkpoints').get(checkpointStorageKey(prepared.fence.ownerId, prepared.fence.generationId, prepared.immutable.sourceSlotKey)); cp.onsuccess = () => occupied(cp.result);
            const event = tx.objectStore('events').index('semanticKey').get(JSON.stringify([prepared.fence.ownerId, prepared.fence.generationId, prepared.immutable.sourceSlotKey, 0])); event.onsuccess = () => occupied(event.result);
          } else write();
        } catch (error) { fail(error); } });
      });
    } catch (error) { writeFailure = error; }
    try { const readback = await this.readReviewTransition(prepared, currentFence); if (readback) return { ...readback, replay: Boolean(writeFailure) }; }
    catch (error) { if (error instanceof LocalEvidenceError && ['stale_context', 'corrupt_record', 'event_conflict', 'review_conflict', 'review_capacity'].includes(error.code)) throw error; throw new LocalEvidenceError('commit_unconfirmed'); }
    if (writeFailure) throw storageError(writeFailure); throw new LocalEvidenceError('commit_unconfirmed');
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
      }, true);
    } catch (error) { failure = error; }
    guard();
    const read = await this.transaction<unknown>(fence, 'readonly', (tx, done) => {
      const request = tx.objectStore(name).get(scopeKey(fence)); request.onsuccess = () => done(request.result);
    }, true); guard();
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
    }, true);
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
  /** Reset authority is a distinct registered proof; missing generation never gets a fake fence. */
  async cleanupConfirmedReset(proof: AuthenticatedResetEvidenceStateProof): Promise<void> {
    const guard = () => assertAuthenticatedResetEvidenceState(proof); guard();
    const retain = proof.status === 'enrolled' ? proof.context?.generationId : null;
    if (proof.status === 'enrolled' ? !proof.context || !retain || proof.context.ownerId !== proof.ownerId || !same(proof.context.resetMarker, proof.resetMarker)
      : proof.context !== null) throw new LocalEvidenceError('stale_context');
    let carried: LocalGenerationAdmission | null = null;
    const sweep = (write: boolean) => this.guardedTransaction<boolean>(guard, write ? 'readwrite' : 'readonly', (tx, done, fail, incarnation) => {
      const candidates: { name: ScopedStoreName; key: IDBValidKey; scope: ScopedRow }[] = [];
      const events = new Map<string, FrozenEvidence>(), delivery: DeliveryMetadata[] = [], admissions: LocalGenerationAdmission[] = [];
      const intents: { key: IDBValidKey; row: EnrollmentIntentRow }[] = [];
      const guarded = (work: () => void) => { try { guard(); work(); } catch (error) { fail(error); } };
      let remaining = SCOPED_STORES.length + 1;
      const intentIsCurrent = (row: EnrollmentIntentRow) => !!retain && row.intent.requestId === proof.creationRequestId && proof.initialGenerationId === retain &&
        same(row.intent.resetMarker, proof.resetMarker) && row.intent.studyDayTimezone === proof.context!.studyDayTimezone &&
        row.intent.protocol === proof.context!.protocol && row.intent.manifestRelease === proof.context!.manifestRelease && row.intent.manifestDigest === proof.context!.manifestDigest;
      const finish = () => {
        if (--remaining) return;
        guard();
        for (const value of delivery) {
          const event = events.get(eventStorageKey(value.ownerId, value.eventId));
          if (!event || event.generationId !== value.generationId || event.payloadHash !== value.payloadHash) throw new LocalEvidenceError('corrupt_record');
        }
        const owned = admissions.filter(row => row.ownerId === proof.ownerId);
        if (owned.some(row => row.creationRequestId !== proof.creationRequestId || row.initialGenerationId !== proof.initialGenerationId)) throw new LocalEvidenceError('corrupt_record');
        const current = owned.find(row => row.generationId === retain);
        if (current && !same(current.resetMarker, proof.resetMarker)) throw new LocalEvidenceError('corrupt_record');
        // Existing current-generation admission wins, including a same-request
        // retry after legitimate current-generation work. Unknown never rises.
        if (write && retain && !current && incarnation.continuity === 'verified' && owned.length) {
          carried = { version: 1, ownerId: proof.ownerId, generationId: retain, incarnationId: incarnation.incarnationId,
            continuity: 'verified', kind: 'reset_carry', creationRequestId: proof.creationRequestId, initialGenerationId: proof.initialGenerationId,
            resetMarker: proof.resetMarker, resetRequestId: proof.requestId };
          checkedAdmissionValue(localGenerationAdmissionSchema, carried);
          tx.objectStore('admissions').add(carried, scopeKey(carried));
        }
        let stale = false;
        for (const candidate of candidates) {
          if (candidate.scope.ownerId === proof.ownerId && candidate.scope.generationId !== retain) {
            stale = true; if (write) tx.objectStore(candidate.name).delete(candidate.key);
          }
        }
        for (const candidate of intents) {
          if (candidate.row.ownerId === proof.ownerId && !intentIsCurrent(candidate.row)) {
            stale = true; if (write) tx.objectStore('enrollmentIntents').delete(candidate.key);
          }
        }
        if (!write && carried && (!current || !same(current, carried) || incarnation.continuity !== 'verified')) throw new LocalEvidenceError('commit_unconfirmed');
        done(!stale);
      };
      for (const name of SCOPED_STORES) {
        const request = tx.objectStore(name).openCursor();
        request.onsuccess = () => guarded(() => {
          const cursor = request.result; if (!cursor) { finish(); return; }
          const scope = cleanupIdentity(name, cursor.primaryKey, cursor.value, incarnation.incarnationId);
          candidates.push({ name, key: cursor.primaryKey, scope });
          if (name === 'events') { const event = (cursor.value as EventRow).value; events.set(eventStorageKey(event.ownerId, event.eventId), event); }
          if (name === 'delivery') delivery.push(cursor.value as DeliveryMetadata);
          if (name === 'admissions') {
            const row = checkedAdmissionValue(localGenerationAdmissionSchema, cursor.value);
            if (row.incarnationId !== incarnation.incarnationId) throw new LocalEvidenceError('corrupt_record');
            admissions.push(row);
          }
          cursor.continue();
        });
      }
      const request = tx.objectStore('enrollmentIntents').openCursor();
      request.onsuccess = () => guarded(() => {
        const cursor = request.result; if (!cursor) { finish(); return; }
        const row = checkedAdmissionValue(enrollmentIntentRowSchema, cursor.value);
        if (cursor.primaryKey !== row.ownerId || row.incarnationId !== incarnation.incarnationId) throw new LocalEvidenceError('corrupt_record');
        intents.push({ key: cursor.primaryKey, row }); cursor.continue();
      });
    });
    let failure: unknown;
    try { await sweep(true); } catch (error) { failure = error; }
    guard();
    try { if (await sweep(false)) { guard(); return; } }
    catch (error) {
      if (error instanceof LocalEvidenceError && ['stale_context', 'corrupt_record'].includes(error.code)) throw error;
      if (failure) throw storageError(failure);
      throw new LocalEvidenceError('commit_unconfirmed');
    }
    if (failure) throw storageError(failure);
    throw new LocalEvidenceError('commit_unconfirmed');
  }
  /** Inactive A2.1 compatibility surface, never the shipping reset authority. */
  async cleanupStaleGenerations(freshContext: LocalEvidenceContext): Promise<void> {
    if (freshContext.freshness !== 'fresh') throw new LocalEvidenceError('stale_context');
    const freshFence: LocalFence = { ownerId: freshContext.ownerId, generationId: freshContext.generationId, ownerEpoch: freshContext.ownerEpoch };
    await this.transaction<void>(freshFence, 'readwrite', (tx, done, fail) => {
      const candidates: { name: ScopedStoreName; key: IDBValidKey; scope: ScopedRow }[] = [];
      const events = new Map<string, FrozenEvidence>(), delivery: DeliveryMetadata[] = [];
      let remaining = SCOPED_STORES.length;
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
      for (const name of SCOPED_STORES) {
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
      for (const name of SCOPED_STORES) {
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
