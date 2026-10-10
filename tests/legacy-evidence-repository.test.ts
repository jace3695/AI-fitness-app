import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createLegacyEvidenceSqlFixture } from './helpers/legacy-evidence-sql.ts';
import { loadLegacyEvidenceRepository } from './helpers/legacyEvidenceRepositoryHarness.ts';
import { languageFixture } from './helpers/languageFixture.ts';
import { createLanguageSyncCoordinator } from '../app/data/languageSyncCoordinator.ts';
import { createDeterministicIDBAdapter } from '../lib/language-legacy-evidence/idb-test-adapter.ts';
import { LEGACY_EVIDENCE_CATALOGUE } from '../lib/language-legacy-evidence/catalogue.ts';
import { preparePresentation, prepareAnswer } from '../lib/language-legacy-evidence/capture.ts';
import { freezeBatch } from '../lib/language-legacy-evidence/outbox.ts';
import { canonicalEvidence, makeSourceSlotKey } from '../lib/language-legacy-evidence/validation.ts';
import { canonicalSha256 } from '../lib/language-legacy-evidence/canonical-hash.ts';
import type { AuthenticatedReceiptReadback } from '../lib/language-legacy-evidence/persistence-types.ts';
import type { ServerEvidenceReceipt } from '../lib/language-legacy-evidence/server-types.ts';
import type { EvidenceEvent } from '../lib/language-legacy-evidence/types.ts';
import type { LanguageLegacyEvidenceRepository, VerifiedLegacyEvidencePrefix } from '../app/data/languageLegacyEvidenceRepository.ts';
const RAW = 'PRIVATE_LOCAL_COMPATIBILITY_ONLY_7da9f';
type Hook = (name: string, args: Record<string, unknown>, data?: unknown) => unknown | Promise<unknown>;
async function fixture(t: TestContext) {
  const sql = await createLegacyEvidenceSqlFixture(), owner = await sql.addOwner();
  const local = languageFixture(); const lease = await local.owner(owner);
  const idb = createDeterministicIDBAdapter(), previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: idb.factory });
  let before: Hook | undefined, after: Hook | undefined, currentUser: string | null = owner;
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = { auth: { async getUser() { return { data: { user: currentUser ? { id: currentUser } : null }, error: null }; } },
    rpc(name: string, args: Record<string, unknown>) { return { async abortSignal() {
      assert.equal(local.locks.active, 0, 'No storage lock held over network');
      calls.push({ name, args: structuredClone(args) });
      if (before) await before(name, args);
      let data;
      try { data = await sql.rpc(name, args); } catch (error) { return { data: null, error: { message: (error as Error).message } }; }
      if (after) data = await after(name, args, data);
      return { data, error: null };
    } }; },
  };
  const coordinator = createLanguageSyncCoordinator({ lease, storage: local.storage, onState() {}, transport: {
    async verifyOwner() { return currentUser === owner; },
    async read() { const result = await sql.db.query<{ state: Record<string, unknown>; updated_at: string }>('select state,updated_at from public.language_user_state where user_id=$1', [owner]);
      return result.rows[0] ? { state: result.rows[0].state, updatedAt: result.rows[0].updated_at } : null; },
    async insert() { assert.fail('Repository tests never bootstrap missing language state'); }, async update() { assert.fail('Unexpected snapshot write'); },
  } });
  const runtime = await loadLegacyEvidenceRepository(client);
  await coordinator.start(); assert.equal(coordinator.getState().status, 'ready');
  async function acquire(mode: 'initialize' | 'existing' = 'initialize') {
    const context = coordinator.getState().context; assert.ok(context);
    return runtime.acquireLanguageLegacyEvidenceRepository(context, { studyDayTimezone: 'UTC', mode });
  }
  const repo = await acquire();
  t.after(async () => { coordinator.dispose(); local.restore(); if (previous) Object.defineProperty(globalThis, 'indexedDB', previous); else Reflect.deleteProperty(globalThis, 'indexedDB'); await sql.close(); });
  return { sql, owner, local, idb, client, coordinator, runtime, repo, acquire, calls,
    hooks(beforeHook?: Hook, afterHook?: Hook) { before = beforeHook; after = afterHook; },
    setUser(value: string | null) { currentUser = value; },
  };
}
async function capture(repo: LanguageLegacyEvidenceRepository, options: { answer?: boolean; unknown?: boolean; question?: string } = {}) {
  const context = repo.context();
  const task = LEGACY_EVIDENCE_CATALOGUE.find(task => task.legacyQuestionId === (options.question ?? 'f01:2'))!;
  const event: EvidenceEvent = { schemaVersion: 1, eventId: randomUUID(), generationId: context.generationId,
    episodeId: randomUUID(), sourceSlotKey: '', sequence: 0, source: 'course_review', lessonId: task.lessonId,
    legacyQuestionId: task.legacyQuestionId, itemId: task.itemId, contentRevision: task.contentRevision, taskId: task.taskId,
    gradingVersion: 'legacy-choice-v1', taskFormat: 'meaning_choice', occurredAt: context.now, recordTimezone: 'UTC',
    hintUsed: options.unknown ? null : false, answerPreviouslyRevealed: options.unknown ? null : false,
    isRetry: false, responseMs: null, timingComplete: false, audio: { status: 'not_requested', promptMatchesTask: null },
    textVisibility: { targetText: true, reading: false, meaning: false, choices: true }, kind: 'exercise_presented', correct: null };
  event.sourceSlotKey = makeSourceSlotKey(context.ownerId, event);
  const presented = await preparePresentation({ transitionId: randomUUID(), event, actualVisible: true, history: 'new_session', timingObserved: !options.unknown }, repo.context(), LEGACY_EVIDENCE_CATALOGUE);
  await repo.store().commit(presented);
  if (!options.answer) return { task, presented, answered: null, batch: await freezeBatch(randomUUID(), [presented.event!], null) };
  const now = repo.context().now, responseMs = Math.min(1, Date.parse(now) - Date.parse(event.occurredAt));
  const answered = await prepareAnswer(presented.checkpoint, { transitionId: randomUUID(), eventId: randomUUID(), occurredAt: now,
    recordTimezone: 'UTC', correct: true, responseMs, handoff: { draftToken: 'exact-original-draft', answer: RAW,
      observation: { neededHelp: false, modality: 'meaning', responseMs } } }, repo.context(), LEGACY_EVIDENCE_CATALOGUE);
  await repo.store().commit(answered);
  return { task, presented, answered, batch: await freezeBatch(randomUUID(), [presented.event!, answered.event!], null) };
}
function complete(value: Awaited<ReturnType<LanguageLegacyEvidenceRepository['readPrefix']>>): VerifiedLegacyEvidencePrefix {
  assert.equal(value.status, 'complete_authenticated_prefix'); if (value.status !== 'complete_authenticated_prefix') throw Error('Expected complete'); return value;
}
const meaningful = (repo: LanguageLegacyEvidenceRepository, prefix: VerifiedLegacyEvidencePrefix, itemId: string) => repo.project(prefix).pairs.find(pair => pair.itemId === itemId && pair.modality === 'meaning')!;

test('actual IDB/outbox → registered repository → SQL/readback → gap-free A1 presentation and answer', async t => {
  const f = await fixture(t), value = await capture(f.repo);
  const first = await f.repo.deliverBatch(value.batch); assert.equal(first.status, 'acknowledged');
  const presentation = complete(await f.repo.readPrefix()); assert.equal(presentation.snapshot.records.length, 1);
  assert.equal(meaningful(f.repo, presentation, value.task.itemId).stage, 'learning');
  const now = f.repo.context().now;
  const answered = await prepareAnswer(value.presented.checkpoint, { transitionId: randomUUID(), eventId: randomUUID(), occurredAt: now,
    recordTimezone: 'UTC', correct: true, responseMs: 1, handoff: { draftToken: 'exact-original-draft', answer: RAW,
      observation: { neededHelp: false, modality: 'meaning', responseMs: 1 } } }, f.repo.context(), LEGACY_EVIDENCE_CATALOGUE);
  await f.repo.store().commit(answered);
  const suffix = await freezeBatch(randomUUID(), [answered.event!], value.presented.checkpoint.predecessor);
  await f.repo.deliverBatch(suffix);
  const result = complete(await f.repo.readPrefix()); assert.equal(result.snapshot.records.length, 2);
  assert.equal(meaningful(f.repo, result, value.task.itemId).stage, 'completed_once');
  assert.deepEqual(Object.keys(result.snapshot.records[0]).sort(), ['event', 'ownerId', 'payloadHash', 'receivedAt', 'serverSequence']);
  assert.equal((await f.repo.store().recoverOutbox(f.repo.context())).events.length, 0);
  assert.ok(JSON.stringify(f.idb.entries('checkpoints')).includes(RAW));
  for (const exported of [f.calls, result, f.idb.entries('receipts'), f.idb.entries('prefixes')]) assert.ok(!JSON.stringify(exported).includes(RAW));
  await f.repo.deliverBatch(value.batch); assert.equal(complete(await f.repo.readPrefix()).snapshot.completeness.throughServerSequence, 2);
});

test('committed append response loss + failed independent readback survives restart and recovers without second append', async t => {
  const f = await fixture(t), value = await capture(f.repo, { answer: true });
  let committed = false;
  f.hooks((name) => { if (committed && name === 'read_language_legacy_evidence_events') throw Error('Synthetic readback offline'); },
    (name, _args, data) => { if (name === 'append_language_legacy_evidence') { committed = true; throw Error('Synthetic response lost after SQL commit'); } return data; });
  await assert.rejects(f.repo.deliverBatch(value.batch), /unavailable/);
  assert.equal(f.calls.filter(call => call.name === 'append_language_legacy_evidence').length, 1);
  assert.equal((await f.repo.store().readDelivery(f.repo.context(), value.batch.events[0].eventId))!.status, 'readback_required');
  const oldFence = f.repo.context(); f.repo.close(); f.hooks();
  await f.coordinator.refresh(); const current = await f.acquire(); assert.notEqual(current.context().ownerEpoch, oldFence.ownerEpoch);
  assert.equal((await current.store().recoverOutbox(current.context())).batches[0].batch.batchId, value.batch.batchId);
  const recovered = await current.deliverBatch(value.batch); assert.equal(recovered.status, 'acknowledged');
  assert.equal(f.calls.filter(call => call.name === 'append_language_legacy_evidence').length, 1);
  const prefix = complete(await current.readPrefix()); assert.equal(prefix.snapshot.completeness.throughServerSequence, 2);
  assert.deepEqual(prefix.snapshot.records.map(row => row.payloadHash), value.batch.events.map(event => event.payloadHash));
  assert.equal((await current.store().readCachedPrefix(current.context()))!.status, 'previously_verified_offline');
  assert.throws(() => current.project({ ...prefix }), /stale_authority/);
});

test('unknown prospective provenance is preserved through SQL and produces partial A1 coverage', async t => {
  const f = await fixture(t), value = await capture(f.repo, { answer: true, unknown: true });
  await f.repo.deliverBatch(value.batch); const prefix = complete(await f.repo.readPrefix());
  const pair = meaningful(f.repo, prefix, value.task.itemId);
  assert.equal(pair.coverage, 'partial'); assert.equal(pair.unknownProvenanceResponses, 1); assert.notEqual(pair.stage, 'completed_once');
  assert.equal(prefix.snapshot.records[1].event.hintUsed, null);
});

test('first exact read failure or incomplete partition cannot authorize append', async t => {
  const f = await fixture(t), value = await capture(f.repo);
  f.hooks(name => { if (name === 'read_language_legacy_evidence_events') throw Error('offline'); });
  await assert.rejects(f.repo.deliverBatch(value.batch), /unavailable/);
  f.hooks(undefined, (name, _args, data) => name === 'read_language_legacy_evidence_events' ? { ...(data as object), missingEventIds: [] } : data);
  await assert.rejects(f.repo.deliverBatch(value.batch), /invalid_response/);
  assert.equal(f.calls.filter(call => call.name === 'append_language_legacy_evidence').length, 0);
});

test('known prefix is independently acknowledged, missing suffix appended, and original batch stays frozen', async t => {
  const f = await fixture(t), value = await capture(f.repo, { answer: true });
  const [first] = value.batch.events;
  await f.sql.rpc('append_language_legacy_evidence', { expected_owner: f.owner, expected_generation: value.batch.generationId,
    manifest_digest: f.repo.serverContext().manifestDigest, batch_id: randomUUID(), source_slot: value.batch.sourceSlotKey,
    expected_predecessor: null, canonical_events: [first.canonical] });
  assert.equal((await f.repo.store().readDelivery(f.repo.context(), first.eventId))!.status, 'pending');
  assert.equal((await f.repo.deliverBatch(value.batch)).status, 'acknowledged');
  const append = f.calls.find(call => call.name === 'append_language_legacy_evidence')!;
  assert.deepEqual(append.args.canonical_events, value.batch.events.map(event => event.canonical));
  assert.equal(complete(await f.repo.readPrefix()).snapshot.completeness.throughServerSequence, 2);
});

test('acknowledgement completion loss recovers by exact read-first CAS; two facades cannot downgrade it', async t => {
  const f = await fixture(t), value = await capture(f.repo, { answer: true });
  let injected = false;
  f.hooks(undefined, (name, _args, data) => {
    if (!injected && name === 'read_language_legacy_evidence_events' && (data as { records: unknown[] }).records.length) {
      injected = true; f.idb.loseNextCommitResponse();
    }
    return data;
  });
  const other = await f.acquire();
  const result = await Promise.all([f.repo.deliverBatch(value.batch), other.deliverBatch(value.batch)]);
  assert.ok(injected); assert.ok(result.every(value => value.status === 'acknowledged'));
  const metadata = await other.store().readDelivery(other.context(), value.batch.events[0].eventId); assert.equal(metadata!.status, 'acknowledged');
  await assert.rejects(other.store().markReadbackRequired(other.context(), value.batch.events[0], metadata!.revision), /checkpoint_conflict/);
  assert.deepEqual(await other.store().readDelivery(other.context(), value.batch.events[0].eventId), metadata);
  assert.equal(complete(await other.readPrefix()).snapshot.completeness.throughServerSequence, 2);
});

test('real SQL conflicting immutable bytes quarantine pending work without replacing local event or raw handoff', async t => {
  const f = await fixture(t), value = await capture(f.repo, { answer: true });
  const event = { ...JSON.parse(value.batch.events[0].canonical), hintUsed: true };
  await f.sql.rpc('append_language_legacy_evidence', { expected_owner: f.owner, expected_generation: value.batch.generationId,
    manifest_digest: f.repo.serverContext().manifestDigest, batch_id: randomUUID(), source_slot: value.batch.sourceSlotKey,
    expected_predecessor: null, canonical_events: [canonicalEvidence(event)] });
  await assert.rejects(f.repo.deliverBatch(value.batch), /event_conflict/);
  assert.equal((await f.repo.store().readDelivery(f.repo.context(), value.batch.events[0].eventId))!.status, 'quarantined');
  assert.equal((await f.repo.store().readEvent(f.repo.context(), value.batch.events[0].eventId))!.canonical, value.batch.events[0].canonical);
  assert.ok(JSON.stringify(f.idb.entries('checkpoints')).includes(RAW));
});

test('copied repository, same-owner retired context and authenticated owner mismatch cannot publish', async t => {
  const f = await fixture(t), empty = complete(await f.repo.readPrefix());
  assert.equal(empty.snapshot.records.length, 0);
  assert.throws(() => ({ ...f.repo }).context(), /stale_authority/);
  f.setUser(randomUUID()); await assert.rejects(f.repo.readPrefix(), /legacy_auth_mismatch/);
  f.setUser(f.owner); assert.throws(() => f.repo.context(), /stale_authority/);
  await f.coordinator.refresh(); const newRepo = await f.acquire();
  assert.throws(() => newRepo.project(empty), /stale_authority/);
  assert.equal(complete(await newRepo.readPrefix()).snapshot.records.length, 0);
});

test('owner/lifecycle changes during IDB commit, transport and acknowledgement retire results', async t => {
  const f = await fixture(t), value = await capture(f.repo);
  f.hooks(undefined, (name, _args, data) => { if (name === 'read_language_legacy_evidence_events') f.coordinator.pause(); return data; });
  await assert.rejects(f.repo.deliverBatch(value.batch), /stale_authority/);
  assert.equal(f.calls.filter(call => call.name === 'append_language_legacy_evidence').length, 0);
  f.hooks(); await f.coordinator.resume(); const next = await f.acquire();
  f.idb.beforeNextTransaction('readwrite', () => f.coordinator.pause());
  await assert.rejects(next.deliverBatch(value.batch), /stale_context|stale_authority/);
  await f.coordinator.resume(); const current = await f.acquire();
  f.hooks(undefined, (name, _args, data) => {
    if (name === 'read_language_legacy_evidence_events' && (data as { records: unknown[] }).records.length) f.idb.beforeNextTransaction('readwrite', () => f.coordinator.pause());
    return data;
  });
  await assert.rejects(current.deliverBatch(value.batch), /stale_context|stale_authority/);
  const entries = f.idb.entries('delivery') as [unknown, { status: string }][];
  assert.ok(entries.every(([, row]) => row.status !== 'acknowledged'));
});

test('actual SQL reset requires fresh coordinator authority, noninitializing cleanup, and preserves new-generation replay', async t => {
  const f = await fixture(t), old = await capture(f.repo, { answer: true });
  await f.repo.deliverBatch(old.batch); const prefix = complete(await f.repo.readPrefix());
  const requestId = randomUUID();
  await f.sql.db.query("select public.reset_my_app_records('language',$1,'초기화')", [requestId]);
  await assert.rejects(f.repo.readPrefix(), /legacy_stale_generation|stale_authority/);
  await f.coordinator.refresh(); f.calls.length = 0;
  const fresh = await f.acquire('existing'); assert.notEqual(fresh.context().generationId, old.batch.generationId);
  assert.equal(f.calls[0].name, 'read_language_legacy_evidence_context');
  assert.throws(() => fresh.project(prefix), /stale_authority/);
  const next = await capture(fresh); await fresh.deliverBatch(next.batch);
  await fresh.cleanupAfterReset(fresh.serverContext().resetMarker);
  assert.equal(f.idb.entries('events').length, 1); assert.equal(f.idb.entries('checkpoints').length, 1);
  assert.ok(f.idb.entries('receipts').every(([, row]) => (row as { generationId: string }).generationId === fresh.context().generationId));
  assert.ok(!JSON.stringify(f.idb.entries('commits')).includes(RAW));
  await f.sql.db.query("select public.reset_my_app_records('language',$1,'초기화')", [requestId]);
  assert.equal(complete(await fresh.readPrefix()).snapshot.records.length, 1);
  await assert.rejects(fresh.deliverBatch(old.batch), /legacy_stale_generation/);
  await assert.rejects(fresh.cleanupAfterReset({ present: false, value: null }), /legacy_marker_conflict/);
});

test('prefix rejects missing sequence, false exhaustion, wrong cursor, extra receipt fields, hash conflict and final failure', async t => {
  const f = await fixture(t), value = await capture(f.repo, { answer: true }); await f.repo.deliverBatch(value.batch);
  const mutations = [
    (data: { records: ServerEvidenceReceipt[]; [key: string]: unknown }) => ({ ...data, records: data.records.slice(1), rowCount: 1, payloadBytes: new TextEncoder().encode(data.records[1].canonicalEvent).length }),
    (data: { records: ServerEvidenceReceipt[]; [key: string]: unknown }) => ({ ...data, exhausted: false }),
    (data: { records: ServerEvidenceReceipt[]; [key: string]: unknown }) => ({ ...data, afterSequence: 1 }),
    (data: { records: ServerEvidenceReceipt[]; [key: string]: unknown }) => ({ ...data, records: data.records.map((row: object) => ({ ...row, trusted: true })) }),
    (data: { records: ServerEvidenceReceipt[]; [key: string]: unknown }) => ({ ...data, records: data.records.map((row: object) => ({ ...row, payloadHash: '0'.repeat(64) })) }),
    (data: { records: ServerEvidenceReceipt[]; [key: string]: unknown }) => ({ ...data, throughSequence: Number.MAX_SAFE_INTEGER + 1 }),
  ];
  for (const mutate of mutations) {
    f.hooks(undefined, (name, _args, data) => name === 'read_language_legacy_evidence_page' ? mutate(data as { records: ServerEvidenceReceipt[]; [key: string]: unknown }) : data);
    await assert.rejects(f.repo.readPrefix(), /invalid_response/);
  }
  let contexts = 0;
  f.hooks(name => { if (name === 'read_language_legacy_evidence_context' && ++contexts === 2) throw Error('Final unavailable'); });
  await assert.rejects(f.repo.readPrefix(), /unavailable/);
  f.hooks(); const limited = await f.repo.readPrefix({ maxEvents: 1 });
  assert.equal(limited.status, 'partial'); assert.ok(!('snapshot' in limited));
  assert.equal((await f.repo.store().readCachedPrefix(f.repo.context())), null);
});

test('generation authority is rechecked after crypto hashing before any IDB or RPC action', async t => {
  const f = await fixture(t), value = await capture(f.repo), original = crypto.subtle.digest;
  const before = f.calls.length;
  crypto.subtle.digest = async function (...args: Parameters<SubtleCrypto['digest']>) {
    const result = await original.apply(this, args); f.coordinator.pause(); return result;
  };
  try { await assert.rejects(f.repo.deliverBatch(value.batch), /stale_authority/); }
  finally { crypto.subtle.digest = original; }
  assert.equal(f.calls.length, before);
});

test('prefix retains structurally valid historical identity rows and A1 suppresses a positive stage', async t => {
  const f = await fixture(t), value = await capture(f.repo, { answer: true }); await f.repo.deliverBatch(value.batch);
  // Historical compatibility response fixture: storage authenticity is not a
  // current catalogue qualification. This does not claim current SQL admits it.
  f.hooks(undefined, async (name, _args, data) => {
    if (name !== 'read_language_legacy_evidence_page') return data;
    const page = data as { records: ServerEvidenceReceipt[]; [key: string]: unknown };
    const records = [];
    for (const row of page.records) {
      const event = { ...row.event, taskId: 'retired:authored:descriptor' };
      event.sourceSlotKey = makeSourceSlotKey(f.owner, event);
      const canonicalEvent = canonicalEvidence(event);
      records.push({ ...row, event, canonicalEvent, payloadHash: await canonicalSha256(canonicalEvent) });
    }
    return { ...page, records, payloadBytes: records.reduce((sum, row) => sum + new TextEncoder().encode(row.canonicalEvent).length, 0) };
  });
  const prefix = complete(await f.repo.readPrefix()); assert.equal(prefix.snapshot.records.length, 2);
  assert.equal(prefix.snapshot.records[0].event.taskId, 'retired:authored:descriptor');
  const projection = f.repo.project(prefix); assert.equal(projection.status, 'partial');
  assert.ok(projection.warnings.some(warning => warning.code === 'unknown_or_conflicting_source'));
  assert.ok(!projection.pairs.some(pair => pair.stage === 'completed_once'));
});

for (const boundary of ['start', 'page', 'final'] as const) test(`actual reset at prefix ${boundary} invalidates the complete result`, async t => {
  const f = await fixture(t), value = await capture(f.repo); await f.repo.deliverBatch(value.batch);
  let contexts = 0, reset = false;
  f.hooks(async name => {
    if (name === 'read_language_legacy_evidence_context') contexts++;
    if (!reset && ((boundary === 'start' && contexts === 1) ||
      (boundary === 'page' && name === 'read_language_legacy_evidence_page') || (boundary === 'final' && contexts === 2))) {
      reset = true; await f.sql.db.query("select public.reset_my_app_records('language',$1,'초기화')", [randomUUID()]);
    }
  });
  await assert.rejects(f.repo.readPrefix(), /legacy_stale_generation|stale_authority/);
  assert.ok(reset); assert.equal(f.idb.entries('prefixes').length, 0);
});

test('exact read partition rejects duplicated, overlapping, extra and omitted IDs without authorizing a write', async t => {
  const f = await fixture(t), value = await capture(f.repo, { answer: true });
  for (const ids of [[], [value.batch.events[0].eventId], [value.batch.events[0].eventId, value.batch.events[0].eventId],
    [value.batch.events[0].eventId, value.batch.events[1].eventId, randomUUID()]]) {
    f.hooks(undefined, (name, _args, data) => name === 'read_language_legacy_evidence_events' ? { ...(data as object), missingEventIds: ids } : data);
    await assert.rejects(f.repo.deliverBatch(value.batch), /invalid_response/);
  }
  assert.equal(f.calls.filter(call => call.name === 'append_language_legacy_evidence').length, 0);
});

test('only the exact live repository-produced proof acknowledges; copies, serialization and append output cannot', async t => {
  const f = await fixture(t), value = await capture(f.repo);
  const store = f.repo.store(), original = store.acknowledgeBatch.bind(store);
  let proof: AuthenticatedReceiptReadback | undefined, append: unknown;
  store.acknowledgeBatch = async (fence, batch, registered, expected) => { proof = registered; return original(fence, batch, registered, expected); };
  f.hooks(undefined, (name, _args, data) => { if (name === 'append_language_legacy_evidence') append = data; return data; });
  await f.repo.deliverBatch(value.batch); assert.ok(proof);
  const metadata = [await store.readDelivery(f.repo.context(), value.batch.events[0].eventId)]; assert.ok(metadata[0]);
  for (const fake of [{ ...proof }, JSON.parse(JSON.stringify(proof)), append]) {
    await assert.rejects(original(f.repo.context(), value.batch.batchId, fake as AuthenticatedReceiptReadback, [metadata[0]]), /stale_context/);
  }
  await f.coordinator.refresh(); const fresh = await f.acquire();
  await assert.rejects(fresh.store().acknowledgeBatch(fresh.context(), value.batch.batchId, proof, [metadata[0]]), /stale_context|stale_authority/);
});

test('201-row actual SQL history uses bounded pages and keeps captured H when newer writes arrive', async t => {
  const f = await fixture(t), value = await capture(f.repo);
  const base = JSON.parse(value.batch.events[0].canonical) as EvidenceEvent;
  async function appendRemote() {
    const event = { ...base, eventId: randomUUID(), episodeId: randomUUID() };
    event.sourceSlotKey = makeSourceSlotKey(f.owner, event);
    return f.sql.rpc('append_language_legacy_evidence', { expected_owner: f.owner, expected_generation: value.batch.generationId,
      manifest_digest: f.repo.serverContext().manifestDigest, batch_id: randomUUID(), source_slot: event.sourceSlotKey,
      expected_predecessor: null, canonical_events: [canonicalEvidence(event)] });
  }
  for (let count = 0; count < 201; count++) await appendRemote();
  let advanced = false;
  f.hooks(undefined, async (name, _args, data) => {
    if (!advanced && name === 'read_language_legacy_evidence_context') { advanced = true; await appendRemote(); }
    return data;
  });
  const prefix = complete(await f.repo.readPrefix()); assert.equal(prefix.snapshot.completeness.throughServerSequence, 201);
  assert.deepEqual(prefix.snapshot.records.map(row => row.serverSequence), Array.from({ length: 201 }, (_, index) => index + 1));
  const pages = f.calls.filter(call => call.name === 'read_language_legacy_evidence_page');
  assert.ok(pages.length >= 2); assert.ok(pages.every(call => call.args.through_sequence === 201));
  const cache = await f.repo.store().readCachedPrefix(f.repo.context()); assert.equal(cache!.context.highWater, 202); assert.equal(cache!.throughSequence, 201);
  f.hooks(); const bounded = await f.repo.readPrefix({ maxPayloadBytes: 1 });
  assert.deepEqual(structuredClone(bounded), { status: 'partial', reason: 'resource_limit', throughSequence: 202, afterSequence: 0, generationId: base.generationId });
  assert.equal((await f.repo.store().readCachedPrefix(f.repo.context()))!.throughSequence, 201);
});

test('typed SQL semantic-slot rejection quarantines the frozen pending batch after independent readback', async t => {
  const f = await fixture(t), value = await capture(f.repo);
  const competitor = { ...JSON.parse(value.batch.events[0].canonical), eventId: randomUUID() };
  await f.sql.rpc('append_language_legacy_evidence', { expected_owner: f.owner, expected_generation: value.batch.generationId,
    manifest_digest: f.repo.serverContext().manifestDigest, batch_id: randomUUID(), source_slot: value.batch.sourceSlotKey,
    expected_predecessor: null, canonical_events: [canonicalEvidence(competitor)] });
  await assert.rejects(f.repo.deliverBatch(value.batch), /legacy_source_slot_conflict/);
  assert.equal((await f.repo.store().readDelivery(f.repo.context(), value.batch.events[0].eventId))!.status, 'quarantined');
  assert.equal((await f.repo.store().readBatch(f.repo.context(), value.batch.batchId))!.delivery.status, 'quarantined');
  assert.equal((await f.repo.store().readEvent(f.repo.context(), value.batch.events[0].eventId))!.canonical, value.batch.events[0].canonical);
});

test('confirmed missing language state retires a prior complete prefix while transport uncertainty preserves local work', async t => {
  const f = await fixture(t), value = await capture(f.repo, { answer: true }); await f.repo.deliverBatch(value.batch);
  const prefix = complete(await f.repo.readPrefix()); assert.equal(meaningful(f.repo, prefix, value.task.itemId).stage, 'completed_once');
  f.hooks(name => { if (name === 'read_language_legacy_evidence_context') throw Error('Synthetic unavailable, not absence'); });
  await assert.rejects(f.repo.readPrefix(), /unavailable/); assert.equal(f.repo.context().generationId, value.batch.generationId);
  f.hooks(); await f.sql.db.query('delete from public.language_user_state where user_id=$1', [f.owner]);
  await assert.rejects(f.repo.readPrefix(), /legacy_state_not_ready/);
  assert.throws(() => f.repo.project(prefix), /stale_authority/);
  assert.throws(() => f.repo.context(), /stale_authority/);
});
