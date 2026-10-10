import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createLegacyEvidenceAdmissionFixture as fixture, createAdmittedLegacyEvidenceRepositoryFixture } from '../../tests/helpers/legacyEvidenceRepositoryHarness.ts';
import { LocalEvidenceStore, LOCAL_EVIDENCE_DATABASE, LOCAL_EVIDENCE_DATABASE_VERSION } from './local-store.ts';
import { createDeterministicIDBAdapter } from './idb-test-adapter.ts';
import { localContext } from './local-test-fixtures.ts';
import { preparePresentation, prepareAnswer, prepareCheckpointTransition } from './capture.ts';
import { catalogue, episode } from './test-fixtures.ts';
import { canonicalEvidence, makeSourceSlotKey } from './validation.ts';
import { decodeFrozenEvidence } from './canonical-hash.ts';
import { freezeBatch } from './outbox.ts';
import { eventStorageKey } from './local-store.ts';
import type { FrozenEnrollmentIntent } from './store-admission-types.ts';
import type { AuthenticatedAdmissionStatusProof, AuthenticatedFirstAdmissionProof, AuthenticatedResetEvidenceStateProof } from './receipt-proof.ts';

const originalStores = ['events', 'checkpoints', 'commits', 'delivery', 'batches', 'audioBindings', 'receipts', 'contexts', 'prefixes'];
async function oldDatabase(factory: IDBFactory, version = 2) {
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(LOCAL_EVIDENCE_DATABASE, version);
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
const cacheOpener = (factory: IDBFactory) => new LocalEvidenceStore({ factory, isCurrent: () => true });
const incarnation = (f: Awaited<ReturnType<typeof fixture>>) => f.adapter.inspect('incarnations', 'store') as { incarnationId: string; origin: string; continuity: string };

test('every cache opener commits unknown birth before later authenticated first admission', async t => {
  const f = await fixture(t);
  assert.equal(await cacheOpener(f.adapter.factory).readCachedContext(localContext()), null);
  const birth = incarnation(f); assert.equal(birth.origin, 'created'); assert.equal(birth.continuity, 'unknown');
  const repo = await f.acquire(); assert.equal(repo.localContinuity(), 'verified'); assert.ok(repo.store());
  assert.equal(incarnation(f).incarnationId, birth.incarnationId); assert.equal(incarnation(f).continuity, 'verified');
  assert.equal(f.adapter.entries('admissions').length, 1); assert.equal(f.adapter.entries('enrollmentIntents').length, 0);
});
test('eviction/new-device cache-first open never gains continuity from verified context cache', async t => {
  const f = await fixture(t), original = await f.acquire(); assert.equal(original.localContinuity(), 'verified'); original.close();
  const oldBirth = incarnation(f).incarnationId; f.evict();
  await cacheOpener(f.adapter.factory).readCachedPrefix(localContext());
  const reopened = await f.acquire('existing'); assert.equal(reopened.localContinuity(), 'unknown');
  assert.throws(() => reopened.store(), /local_continuity_unknown/);
  assert.notEqual(incarnation(f).incarnationId, oldBirth); assert.equal(incarnation(f).continuity, 'unknown');
  assert.equal(f.adapter.entries('contexts').length, 1, 'Verified server viewing can cache without promoting local continuity');
  assert.equal((await f.acquire('existing')).localContinuity(), 'unknown');
  assert.equal(f.calls.filter(call => call.name === 'enroll_language_legacy_evidence_v1').length, 1);
});
test('unproven upgrade remains unknown and cannot start enrollment even when server says unenrolled', async t => {
  const f = await fixture(t); await oldDatabase(f.adapter.factory);
  await assert.rejects(f.acquire(), /unsupported_history/);
  assert.equal(incarnation(f).origin, 'unproven_upgrade'); assert.equal(incarnation(f).continuity, 'unknown');
  assert.equal(f.calls.filter(call => call.name === 'enroll_language_legacy_evidence_v1').length, 0);
  f.newContext(); assert.equal((await f.acquire('existing')).localContinuity(), 'unknown');
});
test('frozen exact intent precedes HTTP and retries keep nonce, marker, timezone and manifest', async t => {
  const f = await fixture(t); let frozen: FrozenEnrollmentIntent | undefined;
  f.hooks(name => {
    if (name !== 'enroll_language_legacy_evidence_v1') return;
    const rows = f.adapter.entries('enrollmentIntents'); assert.equal(rows.length, 1);
    frozen = (rows[0][1] as { intent: FrozenEnrollmentIntent }).intent; throw Error('Synthetic pre-dispatch failure');
  });
  await assert.rejects(f.acquire('initialize', 'Asia/Seoul'), /unavailable/); assert.ok(frozen);
  assert.equal(frozen.studyDayTimezone, 'Asia/Seoul'); assert.equal(incarnation(f).continuity, 'unknown');
  f.hooks(); const repo = await f.acquire('initialize', 'UTC'); assert.equal(repo.localContinuity(), 'verified');
  const calls = f.calls.filter(call => call.name === 'enroll_language_legacy_evidence_v1');
  assert.equal(calls.length, 2); assert.deepEqual(calls[0].args, calls[1].args);
  assert.equal(repo.serverContext().studyDayTimezone, 'Asia/Seoul');
});
test('lost enrollment response uses authenticated read-first and exact original intent without a second enroll', async t => {
  const f = await fixture(t);
  f.hooks(undefined, name => { if (name === 'enroll_language_legacy_evidence_v1') throw Error('Synthetic response lost after server commit'); });
  await assert.rejects(f.acquire(), /unavailable/);
  assert.equal(f.adapter.entries('enrollmentIntents').length, 1); assert.equal(incarnation(f).continuity, 'unknown');
  f.hooks(); const repo = await f.acquire('existing'); assert.equal(repo.localContinuity(), 'verified');
  assert.equal(f.calls.filter(call => call.name === 'enroll_language_legacy_evidence_v1').length, 1);
  assert.equal(f.adapter.entries('enrollmentIntents').length, 0);
});
test('an inert pre-reset intent is retired on the next authenticated open rather than reused', async t => {
  const f = await fixture(t);
  f.hooks(name => { if (name === 'enroll_language_legacy_evidence_v1') throw Error('Not sent'); });
  await assert.rejects(f.acquire(), /unavailable/);
  const old = (f.adapter.entries('enrollmentIntents')[0][1] as { intent: FrozenEnrollmentIntent }).intent;
  const marker = `2026-10-10T00:00:01.000Z|${randomUUID()}`;
  f.state.resetMarker = { present: true, value: marker }; f.hooks(); await f.coordinator.refresh();
  const repo = await f.acquire(); assert.equal(repo.localContinuity(), 'verified');
  const latest = f.calls.filter(call => call.name === 'enroll_language_legacy_evidence_v1').at(-1)!;
  assert.notEqual(latest.args.creation_request_id, old.requestId);
  assert.deepEqual(latest.args.expected_marker, f.state.resetMarker);
});
test('competing nonce or rotated initial generation retires old intent without promoting the store', async t => {
  for (const changed of ['competing', 'rotated', 'marker_rollback'] as const) {
    await t.test(changed, async t => {
      const f = await fixture(t);
      const lose = (name: string) => { if (name === 'enroll_language_legacy_evidence_v1') throw Error('Lost enrollment request/response'); };
      if (changed === 'competing') f.hooks(lose); else f.hooks(undefined, lose);
      await assert.rejects(f.acquire(), /unavailable/); f.hooks();
      if (changed === 'competing') f.newContext();
      else f.state.currentContext = { ...f.state.currentContext!, generationId: randomUUID() };
      // Marker rollback deliberately leaves the exact old nullable marker. The
      // immutable initial-generation identity still makes admission stale.
      const repo = await f.acquire('existing'); assert.equal(repo.localContinuity(), 'unknown');
      assert.equal(f.adapter.entries('enrollmentIntents').length, 0); assert.equal(f.adapter.entries('admissions').length, 0);
      assert.equal(incarnation(f).continuity, 'unknown'); assert.throws(() => repo.store(), /local_continuity_unknown/);
    });
  }
});
test('first-admission context mismatch cannot complete a frozen request with the same nonce', async t => {
  const f = await fixture(t);
  f.hooks(undefined, name => { if (name === 'enroll_language_legacy_evidence_v1') throw Error('Lost response'); });
  await assert.rejects(f.acquire(), /unavailable/); f.hooks();
  f.state.currentContext = { ...f.state.currentContext!, studyDayTimezone: 'Asia/Seoul' };
  const repo = await f.acquire('existing'); assert.equal(repo.localContinuity(), 'unknown');
  assert.equal(f.adapter.entries('admissions').length, 0); assert.equal(incarnation(f).continuity, 'unknown');
});
test('first-admission quota failure remains pending and a later exact retry can complete', async t => {
  const f = await fixture(t); let injected = false;
  f.hooks(undefined, name => {
    if (!injected && name === 'read_language_legacy_evidence_status' && f.state.enrollment) { injected = true; f.adapter.quotaNextWrite(); }
  });
  await assert.rejects(f.acquire(), /storage_quota/);
  assert.equal(incarnation(f).continuity, 'unknown'); assert.equal(f.adapter.entries('admissions').length, 0);
  assert.equal(f.adapter.entries('contexts').length, 0); assert.equal(f.adapter.entries('enrollmentIntents').length, 1);
  f.hooks(); assert.equal((await f.acquire('existing')).localContinuity(), 'verified');
});
test('admission completion loss and readback loss retain one exact committed admission on retry', async t => {
  for (const fault of ['lost_completion', 'lost_readback'] as const) await t.test(fault, async t => {
    const f = await fixture(t); let injected = false;
    f.hooks(undefined, name => {
      if (injected || name !== 'read_language_legacy_evidence_status' || !f.state.enrollment) return;
      injected = true;
      // readAdmission is readwrite only so it can retire stale inert intents.
      // Queue the fault after that read transaction, for the proof commit.
      f.adapter.afterNextWriteCommit(() => {
        if (fault === 'lost_completion') f.adapter.loseNextCommitResponse();
        else f.adapter.afterNextWriteCommit(() => f.adapter.failNextRead());
      });
    });
    if (fault === 'lost_readback') await assert.rejects(f.acquire(), /commit_unconfirmed/);
    else assert.equal((await f.acquire()).localContinuity(), 'verified');
    assert.equal(f.adapter.entries('admissions').length, 1); assert.equal(incarnation(f).continuity, 'verified');
    f.hooks(); assert.equal((await f.acquire('existing')).localContinuity(), 'verified');
    assert.equal(f.adapter.entries('admissions').length, 1);
    assert.equal(f.calls.filter(call => call.name === 'enroll_language_legacy_evidence_v1').length, 1);
  });
});
test('unknown/future/corrupt IDB is never recreated or silently admitted', async t => {
  for (const fault of ['blocked', 'future', 'corrupt', 'creation_quota'] as const) await t.test(fault, async t => {
    const f = await fixture(t);
    if (fault === 'blocked') f.adapter.blockNextOpen();
    if (fault === 'future') await oldDatabase(f.adapter.factory, LOCAL_EVIDENCE_DATABASE_VERSION + 1);
    if (fault === 'corrupt') {
      await cacheOpener(f.adapter.factory).readCachedContext(localContext());
      f.adapter.tamper('incarnations', 'store', row => ({ ...(row as object), version: 999 }));
    }
    if (fault === 'creation_quota') f.adapter.quotaNextWrite();
    await assert.rejects(f.acquire(), /idb_blocked|idb_version_changed|corrupt_record|storage_quota/);
    assert.equal(f.calls.filter(call => call.name === 'enroll_language_legacy_evidence_v1').length, 0);
    if (fault === 'corrupt') assert.equal((f.adapter.inspect('incarnations', 'store') as { version: number }).version, 999);
    if (fault === 'creation_quota') assert.equal((await f.acquire()).localContinuity(), 'verified');
  });
});
test('copied/fabricated admission/reset proofs cannot open, promote or destructively clean a store', async () => {
  const adapter = createDeterministicIDBAdapter(), store = cacheOpener(adapter.factory);
  const fake = { ownerId: randomUUID(), status: 'unenrolled' };
  await assert.rejects(store.readAdmission(fake as unknown as AuthenticatedAdmissionStatusProof), /stale_context/);
  await assert.rejects(store.freezeEnrollmentIntent({} as FrozenEnrollmentIntent, fake as unknown as AuthenticatedAdmissionStatusProof), /stale_context/);
  await assert.rejects(store.completeFirstAdmission({} as FrozenEnrollmentIntent, fake as unknown as AuthenticatedFirstAdmissionProof), /stale_context/);
  await assert.rejects(store.cleanupConfirmedReset(fake as unknown as AuthenticatedResetEvidenceStateProof), /stale_context/);
  assert.throws(() => adapter.entries('incarnations'), /zero or multiple test databases/);
});
test('owner/lifecycle revocation at an admission await never publishes verified continuity', async t => {
  const f = await fixture(t);
  f.hooks(undefined, name => {
    if (name === 'enroll_language_legacy_evidence_v1') f.coordinator.pause();
  });
  await assert.rejects(f.acquire(), /stale_authority/);
  assert.equal(incarnation(f).continuity, 'unknown'); assert.equal(f.adapter.entries('admissions').length, 0);
  f.hooks(); await f.coordinator.resume(); assert.equal((await f.acquire('existing')).localContinuity(), 'verified');
});

const gateAStores = [...originalStores, 'admissions', 'incarnations', 'enrollmentIntents'];
const reviewStores = ['reviewRuns', 'itemExposures', 'reviewTransitions'];
const currentStores = [...gateAStores, ...reviewStores];
type LayoutFault = 'missing_store' | 'extra_store' | 'inline_key' | 'missing_index' | 'extra_index' | 'wrong_index_path' | 'compound_index_path' | 'nonunique_index' | 'missing_review_store' | 'missing_managed_index' | 'nonunique_managed_index' | 'wrong_managed_index_path';
async function schemaDatabase(factory: IDBFactory, version: number, fault?: LayoutFault) {
  await new Promise<void>((resolve, reject) => {
    const request = factory.open(LOCAL_EVIDENCE_DATABASE, version);
    request.onupgradeneeded = () => {
      const names = version >= 4 ? currentStores : gateAStores;
      for (const name of names) {
        if ((fault === 'missing_store' && name === 'audioBindings') || (fault === 'missing_review_store' && name === 'itemExposures')) continue;
        const store = request.result.createObjectStore(name, fault === 'inline_key' && name === 'contexts' ? { keyPath: 'ownerId' } : undefined);
        const index = name === 'events' ? 'semanticKey' : name === 'checkpoints' ? 'episodeKey' : name === 'reviewRuns' ? 'managedSlot' : null;
        if (index && !(fault === 'missing_index' && name === 'events') && !(fault === 'missing_managed_index' && name === 'reviewRuns')) {
          store.createIndex(index, (fault === 'wrong_index_path' && name === 'events') || (fault === 'wrong_managed_index_path' && name === 'reviewRuns') ? 'wrong' :
            fault === 'compound_index_path' && name === 'events' ? [index] : index,
          { unique: !(fault === 'nonunique_index' && name === 'events') && !(fault === 'nonunique_managed_index' && name === 'reviewRuns') });
        }
        if (fault === 'extra_index' && name === 'delivery') store.createIndex('unexpected', 'eventId');
      }
      if (fault === 'extra_store') request.result.createObjectStore('unexpected');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { request.result.close(); resolve(); };
  });
}
async function inspectDatabase(factory: IDBFactory) {
  return new Promise<{ version: number; names: string[]; indexes: Record<string, { keyPath: string | string[] | null; autoIncrement: boolean; indexes: { name: string; keyPath: string | string[]; unique: boolean; multiEntry: boolean }[] }> }>((resolve, reject) => {
    const request = factory.open(LOCAL_EVIDENCE_DATABASE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, names = [...db.objectStoreNames], tx = db.transaction(names, 'readonly');
      const indexes = Object.fromEntries(names.map(name => { const store = tx.objectStore(name); return [name, {
        keyPath: store.keyPath, autoIncrement: store.autoIncrement,
        indexes: [...store.indexNames].map(name => { const index = store.index(name); return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }; }),
      }]; }));
      tx.onabort = () => { db.close(); reject(tx.error); };
      tx.oncomplete = () => { db.close(); resolve({ version: db.version, names, indexes }); };
    };
  });
}
async function actualAdmissionRows(t: Parameters<typeof fixture>[0]) {
  const f = await fixture(t);
  let pending: [IDBValidKey, unknown][] = [];
  f.hooks(name => { if (name === 'enroll_language_legacy_evidence_v1') pending = f.adapter.entries('enrollmentIntents'); });
  const repository = await f.acquire(); f.hooks();
  assert.equal(repository.localContinuity(), 'verified'); assert.equal(pending.length, 1);
  return { f, repository, pending, birth: f.adapter.entries('incarnations'), admissions: f.adapter.entries('admissions') };
}
function seedGateAAdmission(adapter: ReturnType<typeof createDeterministicIDBAdapter>, rows: Awaited<ReturnType<typeof actualAdmissionRows>>) {
  for (const [name, values] of [['incarnations', rows.birth], ['admissions', rows.admissions], ['enrollmentIntents', rows.pending]] as const)
    for (const [key, value] of values) adapter.seed(name, key, value);
}

test('shared admitted fixture provides two real independently registered writer facades and exact incarnation', async t => {
  const f = await createAdmittedLegacyEvidenceRepositoryFixture(t);
  assert.equal(f.context.ownerId, f.owner); assert.equal(f.context.generationId, f.generationId);
  assert.equal(f.secondRepository.context().ownerId, f.owner);
  assert.equal(f.secondRepository.context().generationId, f.generationId);
  assert.notEqual(f.repository, f.secondRepository); assert.notEqual(f.store, f.secondRepository.store());
  assert.equal(f.incarnationId, incarnation(f).incarnationId);
  assert.equal(f.adapter.entries('admissions').length, 1);
  f.repository.close(); assert.throws(() => f.repository.context(), /stale_authority/);
  assert.equal(f.secondRepository.localContinuity(), 'verified');
});

test('v3 to v4 preserves exact valid incarnation, admission and pending enrollment bytes without promotion', async t => {
  const source = await actualAdmissionRows(t), adapter = createDeterministicIDBAdapter();
  await schemaDatabase(adapter.factory, 3); seedGateAAdmission(adapter, source);
  for (const [key, value] of source.f.adapter.entries('contexts')) adapter.seed('contexts', key, value);
  const before = JSON.stringify(gateAStores.map(name => [name, adapter.entries(name)]));
  await cacheOpener(adapter.factory).readCachedContext(source.repository.context());
  assert.equal(JSON.stringify(gateAStores.map(name => [name, adapter.entries(name)])), before);
  const layout = await inspectDatabase(adapter.factory);
  assert.equal(layout.version, 4); assert.deepEqual(layout.names.sort(), [...currentStores].sort());
  for (const name of currentStores) {
    const expected = name === 'events' ? 'semanticKey' : name === 'checkpoints' ? 'episodeKey' : name === 'reviewRuns' ? 'managedSlot' : null;
    assert.deepEqual(layout.indexes[name], { keyPath: null, autoIncrement: false,
      indexes: expected ? [{ name: expected, keyPath: expected, unique: true, multiEntry: false }] : [] });
  }
  for (const name of reviewStores) assert.deepEqual(adapter.entries(name), [], 'No upgrade invents observed exposure or review history');
  assert.equal((adapter.inspect('incarnations', 'store') as { continuity: string }).continuity, 'verified');
});

test('v0, v1 and v2 opens create the exact v4 layout and retain Gate A unknown birth semantics', async t => {
  for (const version of [0, 1, 2]) await t.test(`v${version}`, async () => {
    const adapter = createDeterministicIDBAdapter();
    if (version) await new Promise<void>((resolve, reject) => {
      const request = adapter.factory.open(LOCAL_EVIDENCE_DATABASE, version);
      request.onupgradeneeded = () => {
        for (const name of originalStores.slice(0, version === 1 ? 6 : 9)) {
          const store = request.result.createObjectStore(name);
          if (name === 'events') store.createIndex('semanticKey', 'semanticKey', { unique: true });
          if (name === 'checkpoints') store.createIndex('episodeKey', 'episodeKey', { unique: true });
        }
      };
      request.onerror = () => reject(request.error); request.onsuccess = () => { request.result.close(); resolve(); };
    });
    await cacheOpener(adapter.factory).readCachedContext(localContext());
    assert.deepEqual((await inspectDatabase(adapter.factory)).names.sort(), [...currentStores].sort());
    const birth = adapter.inspect('incarnations', 'store') as { origin: string; continuity: string };
    assert.equal(birth.origin, version === 0 ? 'created' : 'unproven_upgrade'); assert.equal(birth.continuity, 'unknown');
    for (const name of ['admissions', 'enrollmentIntents', ...reviewStores]) assert.deepEqual(adapter.entries(name), []);
  });
});

test('v3 upgrade and ordinary v4 open reject exact layout and index mismatches without replacing persisted schema', async t => {
  const source = await actualAdmissionRows(t);
  for (const version of [3, 4]) for (const fault of ['missing_store', 'extra_store', 'inline_key', 'missing_index', 'extra_index', 'wrong_index_path', 'compound_index_path', 'nonunique_index'] as const)
    await t.test(`v${version} ${fault}`, async () => {
      const adapter = createDeterministicIDBAdapter(); await schemaDatabase(adapter.factory, version, fault); seedGateAAdmission(adapter, source);
      const before = await inspectDatabase(adapter.factory), admissions = JSON.stringify(adapter.entries('admissions'));
      await assert.rejects(cacheOpener(adapter.factory).readCachedContext(source.repository.context()), /corrupt_record/);
      await adapter.idle(); assert.deepEqual(await inspectDatabase(adapter.factory), before);
      assert.equal(JSON.stringify(adapter.entries('admissions')), admissions);
    });
});

test('v3 upgrade rejects every admission/incarnation/intent key and body inconsistency atomically', async t => {
  const source = await actualAdmissionRows(t);
  const faults = ['missing_birth', 'extra_birth', 'birth_version', 'birth_unknown_key', 'admission_key', 'admission_owner', 'admission_generation', 'admission_incarnation', 'admission_unknown_key', 'unknown_birth_with_admission', 'intent_key', 'intent_owner', 'intent_incarnation', 'intent_unknown_key', 'intent_inner_owner'] as const;
  for (const fault of faults) await t.test(fault, async () => {
    const adapter = createDeterministicIDBAdapter(); await schemaDatabase(adapter.factory, 3);
    if (fault !== 'missing_birth') seedGateAAdmission(adapter, source);
    const [admissionKey] = source.admissions[0], [intentKey] = source.pending[0];
    if (fault === 'extra_birth') adapter.seed('incarnations', 'another', source.birth[0][1]);
    if (fault === 'birth_version') adapter.tamper('incarnations', 'store', value => ({ ...(value as object), version: 2 }));
    if (fault === 'birth_unknown_key') adapter.tamper('incarnations', 'store', value => ({ ...(value as object), extra: true }));
    if (fault === 'unknown_birth_with_admission') adapter.tamper('incarnations', 'store', value => ({ ...(value as object), continuity: 'unknown' }));
    if (fault === 'admission_key') adapter.seed('admissions', JSON.stringify([source.f.owner, randomUUID()]), source.admissions[0][1]);
    if (fault.startsWith('admission_') && fault !== 'admission_key') adapter.tamper('admissions', admissionKey, value => ({ ...(value as object),
      ...(fault === 'admission_owner' ? { ownerId: randomUUID() } : fault === 'admission_generation' ? { generationId: randomUUID() } : fault === 'admission_incarnation' ? { incarnationId: randomUUID() } : { extra: true }) }));
    if (fault === 'intent_key') adapter.seed('enrollmentIntents', randomUUID(), source.pending[0][1]);
    if (fault.startsWith('intent_') && fault !== 'intent_key') adapter.tamper('enrollmentIntents', intentKey, value => ({ ...(value as object),
      ...(fault === 'intent_owner' ? { ownerId: randomUUID() } : fault === 'intent_incarnation' ? { incarnationId: randomUUID() } : fault === 'intent_inner_owner' ? { intent: { ...(value as { intent: object }).intent, ownerId: randomUUID() } } : { extra: true }) }));
    const before = JSON.stringify(gateAStores.map(name => [name, adapter.entries(name)]));
    await assert.rejects(cacheOpener(adapter.factory).readCachedContext(source.repository.context()), /corrupt_record/);
    await adapter.idle(); const layout = await inspectDatabase(adapter.factory);
    assert.equal(layout.version, 3); assert.deepEqual(layout.names.sort(), [...gateAStores].sort());
    assert.equal(JSON.stringify(gateAStores.map(name => [name, adapter.entries(name)])), before);
  });
});

function observeUpgrade(factory: IDBFactory, callback: (request: IDBOpenDBRequest) => void): IDBFactory {
  return { open(name: string, version?: number) { const request = factory.open(name, version); request.addEventListener('upgradeneeded', () => callback(request)); return request; } } as IDBFactory;
}
test('v3 queued upgrade read failure and abort publish neither version 4 nor partial stores, then exact retry succeeds', async t => {
  const source = await actualAdmissionRows(t);
  for (const fault of ['first_read', 'queued_cursor_read', 'queued_abort'] as const) await t.test(fault, async () => {
    const adapter = createDeterministicIDBAdapter(); await schemaDatabase(adapter.factory, 3); seedGateAAdmission(adapter, source);
    const before = JSON.stringify(gateAStores.map(name => [name, adapter.entries(name)]));
    let factory = adapter.factory;
    if (fault === 'first_read') adapter.failNextRead();
    else factory = observeUpgrade(adapter.factory, request => {
      const tx = request.transaction!, read = tx.objectStore('incarnations').get('store');
      read.onsuccess = () => { if (fault === 'queued_abort') tx.abort(); else adapter.failNextRead(); };
    });
    await assert.rejects(cacheOpener(factory).readCachedContext(source.repository.context()), /storage_abort|storage_read_failed/);
    await adapter.idle(); const layout = await inspectDatabase(adapter.factory);
    assert.equal(layout.version, 3); assert.deepEqual(layout.names.sort(), [...gateAStores].sort());
    assert.equal(JSON.stringify(gateAStores.map(name => [name, adapter.entries(name)])), before);
    await cacheOpener(adapter.factory).readCachedContext(source.repository.context());
    assert.equal((await inspectDatabase(adapter.factory)).version, 4);
    assert.equal(JSON.stringify(gateAStores.map(name => [name, adapter.entries(name)])), before);
  });
});

test('a v3 client cannot reopen the v4 database or downgrade any preserved admission bytes', async t => {
  const f = await createAdmittedLegacyEvidenceRepositoryFixture(t), before = JSON.stringify(currentStores.map(name => [name, f.adapter.entries(name)]));
  await assert.rejects(new Promise<void>((resolve, reject) => {
    const request = f.adapter.factory.open(LOCAL_EVIDENCE_DATABASE, 3);
    request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
  }), (error: unknown) => error instanceof DOMException && error.name === 'VersionError');
  assert.equal(JSON.stringify(currentStores.map(name => [name, f.adapter.entries(name)])), before);
  assert.equal(f.repository.localContinuity(), 'verified');
});

test('v3 preservation retains all twelve old stores, exact capture bytes, handoff, caches and verified admission', async t => {
  const source = await actualAdmissionRows(t), { f, repository } = source, context = repository.context(), store = repository.store();
  const event = { ...episode(0, { presentationOnly: true })[0], generationId: context.generationId,
    occurredAt: context.now, recordTimezone: context.studyDayTimezone };
  event.sourceSlotKey = makeSourceSlotKey(context.ownerId, event);
  const start = await preparePresentation({ transitionId: randomUUID(), event, actualVisible: true, history: 'new_session', timingObserved: true }, context, catalogue);
  await store.commit(start);
  const audio = prepareCheckpointTransition(start.checkpoint, { kind: 'audio_requested', requestId: randomUUID(),
    sourceSlotKey: start.checkpoint.sourceSlotKey, episodeId: start.checkpoint.episodeId, promptMatchesTask: true }, context, randomUUID());
  await store.commit(audio);
  const answer = await prepareAnswer(audio.checkpoint, { transitionId: randomUUID(), eventId: randomUUID(), occurredAt: context.now,
    recordTimezone: context.studyDayTimezone, correct: false, responseMs: 0,
    handoff: { draftToken: 'preserved-old-draft', answer: '合成の旧入力\\"한글', observation: { responseMs: 125.5, neededHelp: true, modality: 'meaning' } } }, context, catalogue);
  await store.commit(answer);
  const batch = await freezeBatch(randomUUID(), [start.event!, answer.event!], null); await store.putBatch(context, batch);
  const cachedContext = { ...repository.serverContext(), highWater: 2, serverTime: context.now };
  const receipts = [start.event!, answer.event!].map((frozen, index) => ({ ownerId: context.ownerId, event: decodeFrozenEvidence(frozen),
    canonicalEvent: frozen.canonical, payloadHash: frozen.payloadHash, receivedAt: context.now, serverSequence: index + 1,
    manifestDigest: cachedContext.manifestDigest, manifestRelease: cachedContext.manifestRelease }));
  // These are persisted cache fixtures, not newly authenticated receipt proofs.
  for (const receipt of receipts) {
    const canonical = canonicalEvidence(receipt);
    f.adapter.seed('receipts', JSON.stringify([context.ownerId, context.generationId, receipt.event.eventId]),
      { version: 1, ownerId: context.ownerId, generationId: context.generationId, canonical });
    f.adapter.seed('delivery', eventStorageKey(context.ownerId, receipt.event.eventId), { version: 2, ownerId: context.ownerId,
      generationId: context.generationId, eventId: receipt.event.eventId, payloadHash: receipt.payloadHash, revision: 2, status: 'acknowledged', receiptCanonical: canonical });
  }
  const cache = { version: 1, ownerId: context.ownerId, generationId: context.generationId, context: cachedContext, status: 'previously_verified_offline' };
  f.adapter.seed('contexts', JSON.stringify([context.ownerId, context.generationId]), cache);
  f.adapter.seed('prefixes', JSON.stringify([context.ownerId, context.generationId]), { ...cache, throughSequence: 2, records: receipts });
  const adapter = createDeterministicIDBAdapter(); await schemaDatabase(adapter.factory, 3);
  for (const name of gateAStores) for (const [key, value] of name === 'enrollmentIntents' ? source.pending : f.adapter.entries(name)) adapter.seed(name, key, value);
  for (const name of gateAStores) assert.ok(adapter.entries(name).length > 0, `${name} has a meaningful pre-v4 row`);
  const before = JSON.stringify(gateAStores.map(name => [name, adapter.entries(name)])), oldLayout = await inspectDatabase(adapter.factory);
  const upgraded = cacheOpener(adapter.factory);
  assert.deepEqual((await upgraded.readCheckpoint(context, answer.checkpoint.sourceSlotKey))?.handoff, answer.checkpoint.handoff);
  assert.equal((await upgraded.readCachedPrefix(context))?.throughSequence, 2);
  assert.equal(JSON.stringify(gateAStores.map(name => [name, adapter.entries(name)])), before);
  const layout = await inspectDatabase(adapter.factory); assert.equal(layout.version, 4);
  for (const name of gateAStores) assert.deepEqual(layout.indexes[name], oldLayout.indexes[name]);
  for (const name of reviewStores) assert.deepEqual(adapter.entries(name), []);
});

/** The adapter deliberately has no key-generator/multiEntry implementation.
 * Change only the schema inspection view to exercise these refusal branches. */
function mismatchedMetadataFactory(factory: IDBFactory, fault: 'autoIncrement' | 'multiEntry'): IDBFactory {
  const decorate = (tx: IDBTransaction) => {
    const original = tx.objectStore.bind(tx);
    Object.defineProperty(tx, 'objectStore', { configurable: true, value(name: string) {
      const store = original(name);
      if (name !== 'events') return store;
      return new Proxy(store, { get(target, property) {
        if (property === 'autoIncrement' && fault === 'autoIncrement') return true;
        if (property === 'index' && fault === 'multiEntry') return (name: string) => new Proxy(target.index(name), {
          get(index, property) { return property === 'multiEntry' ? true : Reflect.get(index, property); },
        });
        return Reflect.get(target, property);
      } });
    } });
  };
  return { open(name: string, version?: number) {
    const request = factory.open(name, version);
    request.addEventListener('upgradeneeded', () => decorate(request.transaction!));
    // Application handlers run before listeners in this adapter, so this needs
    // its own callback property interception to present metadata before validation.
    Object.defineProperty(request, 'onupgradeneeded', { configurable: true, set(handler: IDBOpenDBRequest['onupgradeneeded']) {
      request.addEventListener('upgradeneeded', event => { if (handler) handler.call(request, event as IDBVersionChangeEvent); });
    } });
    request.addEventListener('success', () => {
      const db = request.result, original = db.transaction.bind(db);
      Object.defineProperty(db, 'transaction', { configurable: true, value(...args: Parameters<IDBDatabase['transaction']>) { const tx = original(...args); decorate(tx); return tx; } });
    });
    return request;
  } } as IDBFactory;
}
test('v3 and v4 reject autoIncrement and multiEntry schema metadata even with otherwise exact layouts', async t => {
  const source = await actualAdmissionRows(t);
  for (const version of [3, 4]) for (const fault of ['autoIncrement', 'multiEntry'] as const) await t.test(`v${version} ${fault}`, async () => {
    const adapter = createDeterministicIDBAdapter(); await schemaDatabase(adapter.factory, version); seedGateAAdmission(adapter, source);
    const before = await inspectDatabase(adapter.factory);
    await assert.rejects(cacheOpener(mismatchedMetadataFactory(adapter.factory, fault)).readCachedContext(source.repository.context()), /corrupt_record/);
    await adapter.idle(); assert.deepEqual(await inspectDatabase(adapter.factory), before);
  });
});

test('every corrupt review row variant prevents first enrollment before any HTTP enrollment dispatch', async t => {
  for (const variant of ['run', 'row_fence', 'exposure', 'journal']) await t.test(variant, async t => {
    const f = await fixture(t); await cacheOpener(f.adapter.factory).readCachedContext(localContext());
    const name = variant === 'exposure' ? 'itemExposures' : variant === 'journal' ? 'reviewTransitions' : 'reviewRuns';
    f.adapter.seed(name, 'malformed', { version: 1, kind: variant, ownerId: f.owner, generationId: randomUUID(), incarnationId: incarnation(f).incarnationId });
    const before = JSON.stringify(currentStores.map(name => [name, f.adapter.entries(name)]));
    await assert.rejects(f.acquire(), /corrupt_record|unsupported_history/);
    assert.equal(f.calls.filter(call => call.name === 'enroll_language_legacy_evidence_v1').length, 0);
    assert.equal(JSON.stringify(currentStores.map(name => [name, f.adapter.entries(name)])), before);
  });
});

test('v4 ordinary open refuses missing review stores and a missing, nonunique or wrongly keyed managed-slot index', async t => {
  const source = await actualAdmissionRows(t);
  for (const fault of ['missing_review_store', 'missing_managed_index', 'nonunique_managed_index', 'wrong_managed_index_path'] as const) await t.test(fault, async () => {
    const adapter = createDeterministicIDBAdapter(); await schemaDatabase(adapter.factory, 4, fault); seedGateAAdmission(adapter, source);
    const before = await inspectDatabase(adapter.factory);
    await assert.rejects(cacheOpener(adapter.factory).readCachedContext(source.repository.context()), /corrupt_record/);
    await adapter.idle(); assert.deepEqual(await inspectDatabase(adapter.factory), before);
    assert.equal(JSON.stringify(adapter.entries('admissions')), JSON.stringify(source.admissions));
  });
});

test('v3 unknown incarnation is preserved exactly and v4 upgrade never invents admission or exposure history', async () => {
  const source = createDeterministicIDBAdapter(); await oldDatabase(source.factory);
  await cacheOpener(source.factory).readCachedContext(localContext());
  const birth = source.inspect('incarnations', 'store');
  assert.equal((birth as { continuity: string }).continuity, 'unknown');
  const adapter = createDeterministicIDBAdapter(); await schemaDatabase(adapter.factory, 3); adapter.seed('incarnations', 'store', birth);
  const before = JSON.stringify(birth); await cacheOpener(adapter.factory).readCachedContext(localContext());
  assert.equal(JSON.stringify(adapter.inspect('incarnations', 'store')), before);
  assert.equal((await inspectDatabase(adapter.factory)).version, 4);
  for (const name of ['admissions', 'enrollmentIntents', ...reviewStores]) assert.deepEqual(adapter.entries(name), []);
});

test('a live v3 client blocks the upgrade without changing bytes, and closing it permits an exact v4 retry', async t => {
  const source = await actualAdmissionRows(t), adapter = createDeterministicIDBAdapter();
  await schemaDatabase(adapter.factory, 3); seedGateAAdmission(adapter, source);
  const before = JSON.stringify(gateAStores.map(name => [name, adapter.entries(name)]));
  const old = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = adapter.factory.open(LOCAL_EVIDENCE_DATABASE, 3);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  t.after(() => old.close());
  let changed: { oldVersion: number; newVersion: number | null } | undefined;
  old.onversionchange = event => { changed = { oldVersion: event.oldVersion, newVersion: event.newVersion }; };
  await assert.rejects(cacheOpener(adapter.factory).readCachedContext(source.repository.context()), /idb_blocked/);
  assert.deepEqual(changed, { oldVersion: 3, newVersion: 4 });
  assert.equal(old.version, 3);
  assert.equal(JSON.stringify(gateAStores.map(name => [name, adapter.entries(name)])), before);
  old.close(); await adapter.idle();
  // The original blocked request resumes, but the application already rejected
  // it. Its deferred versionchange must abort without publishing v4.
  assert.equal((await inspectDatabase(adapter.factory)).version, 3);
  assert.equal(JSON.stringify(gateAStores.map(name => [name, adapter.entries(name)])), before);
  await cacheOpener(adapter.factory).readCachedContext(source.repository.context());
  assert.equal((await inspectDatabase(adapter.factory)).version, 4);
  assert.equal(JSON.stringify(gateAStores.map(name => [name, adapter.entries(name)])), before);
});
