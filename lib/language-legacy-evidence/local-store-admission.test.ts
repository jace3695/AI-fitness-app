import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { loadLegacyEvidenceRepository } from '../../tests/helpers/legacyEvidenceRepositoryHarness.ts';
import { languageFixture } from '../../tests/helpers/languageFixture.ts';
import { createLanguageSyncCoordinator } from '../../app/data/languageSyncCoordinator.ts';
import { LocalEvidenceStore, LOCAL_EVIDENCE_DATABASE, LOCAL_EVIDENCE_DATABASE_VERSION } from './local-store.ts';
import { createDeterministicIDBAdapter } from './idb-test-adapter.ts';
import { localContext } from './local-test-fixtures.ts';
import { LEGACY_EVIDENCE_MANIFEST_DIGEST, LEGACY_EVIDENCE_MANIFEST_RELEASE, SERVER_EVIDENCE_PROTOCOL } from './identity-manifest.ts';
import type { ServerEvidenceContext } from './server-types.ts';
import type { FrozenEnrollmentIntent } from './store-admission-types.ts';
import type { AuthenticatedAdmissionStatusProof, AuthenticatedFirstAdmissionProof, AuthenticatedResetEvidenceStateProof } from './receipt-proof.ts';

// This is a transport/IDB fault fixture, not SQL or a browser-engine proof. The
// actual repository, registered owner/coordinator and private proof registries
// execute unchanged; no successful fixture imports a proof registrar.
type Hook = (name: string, args: Record<string, unknown>) => void | Promise<void>;
async function fixture(t: TestContext) {
  const local = languageFixture(), owner = randomUUID(), lease = await local.owner(owner);
  let adapter = createDeterministicIDBAdapter();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get: () => adapter.factory });
  const state: { resetMarker: { present: boolean; value: string | null }; enrollment: { creationRequestId: string; initialGenerationId: string } | null; currentContext: ServerEvidenceContext | null } = {
    resetMarker: { present: false, value: null }, enrollment: null, currentContext: null,
  };
  let before: Hook | undefined, after: Hook | undefined, currentUser: string | null = owner;
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const newContext = (requestId: string = randomUUID(), timezone = 'UTC') => {
    const generationId = randomUUID(), now = new Date().toISOString();
    state.enrollment = { creationRequestId: requestId, initialGenerationId: generationId };
    state.currentContext = { ownerId: owner, generationId, resetMarker: { ...state.resetMarker }, prospectiveStartedAt: now,
      studyDayTimezone: timezone, protocol: SERVER_EVIDENCE_PROTOCOL, manifestRelease: LEGACY_EVIDENCE_MANIFEST_RELEASE,
      manifestDigest: LEGACY_EVIDENCE_MANIFEST_DIGEST, serverTime: now, highWater: 0 };
  };
  const status = () => ({ version: 1, status: state.enrollment ? state.currentContext ? 'enrolled' : 'enrolled_generation_missing' : 'unenrolled',
    ownerId: owner, protocol: SERVER_EVIDENCE_PROTOCOL, manifestRelease: LEGACY_EVIDENCE_MANIFEST_RELEASE,
    manifestDigest: LEGACY_EVIDENCE_MANIFEST_DIGEST, statePresent: true, ...structuredClone(state) });
  const client = { auth: { async getUser() { return { data: { user: currentUser ? { id: currentUser } : null }, error: null }; } },
    rpc(name: string, args: Record<string, unknown>) { return { async abortSignal() {
      calls.push({ name, args: structuredClone(args) }); await before?.(name, args);
      assert.equal(local.locks.active, 0, 'No local-storage transaction spans HTTP');
      assert.equal(args.expected_owner, owner);
      let data: unknown;
      if (name === 'read_language_legacy_evidence_status') data = status();
      else if (name === 'enroll_language_legacy_evidence_v1') {
        assert.equal(JSON.stringify(args.expected_marker), JSON.stringify(state.resetMarker));
        if (!state.enrollment) newContext(String(args.creation_request_id), String(args.proposed_timezone));
        data = { version: 1, status: 'enrolled', ...state.enrollment!, currentContext: structuredClone(state.currentContext) };
      } else throw Error(`Unexpected synthetic RPC ${name}`);
      await after?.(name, args); return { data, error: null };
    } }; },
  };
  const coordinator = createLanguageSyncCoordinator({ lease, storage: local.storage, onState() {}, transport: {
    async verifyOwner() { return currentUser === owner; },
    async read() { return { state: state.resetMarker.present ? { languageRecordResetV1: state.resetMarker.value! } : {}, updatedAt: '2026-10-10T00:00:00.000Z' }; },
    async insert() { assert.fail('Unexpected bootstrap'); }, async update() { assert.fail('Unexpected snapshot write'); },
  } });
  const runtime = await loadLegacyEvidenceRepository(client, { resetProtocol: 'protocol-required', enrollmentEnabled: true, captureEnabled: true });
  await coordinator.start(); assert.equal(coordinator.getState().status, 'ready');
  t.after(() => { coordinator.dispose(); local.restore(); if (previous) Object.defineProperty(globalThis, 'indexedDB', previous); else Reflect.deleteProperty(globalThis, 'indexedDB'); });
  return { owner, local, state, runtime, coordinator, calls, newContext, get adapter() { return adapter; },
    evict() { adapter = createDeterministicIDBAdapter(); },
    hooks(nextBefore?: Hook, nextAfter?: Hook) { before = nextBefore; after = nextAfter; },
    setUser(value: string | null) { currentUser = value; },
    async acquire(mode: 'initialize' | 'existing' = 'initialize', studyDayTimezone = 'UTC') {
      const context = coordinator.getState().context; assert.ok(context);
      return runtime.acquireLanguageLegacyEvidenceRepository(context, { mode, studyDayTimezone });
    },
  };
}
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
