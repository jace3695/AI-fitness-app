import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { canonicalJson, capacityUsage, CONVERSATION_LIMITS } from '../../lib/conversation-session/contracts.ts';
import { draft, fillBudget } from '../../lib/conversation-session/fixtures.test-support.ts';
import { projectClosedConversationRecap } from '../../lib/conversation-session/recap.ts';
import { createLanguageSyncCoordinator } from './languageSyncCoordinator.ts';
import { captureLanguageRemoteObservation, commitLanguageSyncResponse, createLanguageSyncLifecycle, readLanguageSyncRequest } from './languageCloudSync.ts';
import { ConversationLocalError, conversationLocalKey } from './languageLocalParticipants.ts';
import { languageFixture, deferred, settle } from '../../tests/helpers/languageFixture.ts';
import { STORAGE_LOCK_NAME, STORAGE_PROTOCOL_KEY, invalidateStorageOwner, readStorageSnapshot } from './storageTransaction.ts';
import * as api from './conversationLocalRecords.ts';

async function fixture(t: TestContext) {
  const f = languageFixture(); t.after(f.restore);
  const lease = await f.owner();
  let remote: Record<string, unknown> = {};
  const coordinator = createLanguageSyncCoordinator({ lease, storage: f.storage, onState() {}, transport: {
    async verifyOwner() { return true; }, async read() { return { state: remote, updatedAt: 'synthetic' }; },
    async insert(_owner, state) { remote = state; return true; }, async update(_owner, state) { remote = state; return true; },
  } });
  t.after(coordinator.dispose); await coordinator.start();
  const context = () => { const c = coordinator.getState().context; assert.ok(c); return c; };
  const snapshot = () => api.readConversationSnapshot(context());
  const create = async () => { const r = await api.runConversationEdit(api.captureConversationSession(snapshot(), 'legacy-cafe', 'Asia/Seoul')); return r.effect.sessionId; };
  const save = async (id: string, d = draft()) => api.runConversationEdit(api.captureConversationDraft(snapshot(), id, d));
  return { ...f, lease, coordinator, context, snapshot, create, save };
}

test('P2B absence is read-only; explicit new session alone enrolls exact owner outside selected keys', async t => {
  const f = await fixture(t); assert.equal(f.snapshot().envelope, null); assert.equal(f.values.has(conversationLocalKey('a')), false);
  const id = await f.create(), e = f.snapshot().envelope!;
  assert.equal(e.ownerId, 'a'); assert.equal(e.sessions[0].sessionId, id); assert.equal(e.enrollment.kind, 'explicit-enrollment');
  assert.deepEqual(e.enrollment.observation, f.snapshot().observation); assert.ok(Object.isFrozen(e.sessions));
  assert.notEqual(e.generationId, f.snapshot().generation);
});

test('P2B fabricated contexts, copied snapshots and direct raw legacy commits confer no conversation authority', async t => {
  const f = await fixture(t), source = f.snapshot();
  assert.throws(() => api.readConversationSnapshot({ ...f.context() }), ConversationLocalError);
  assert.throws(() => api.captureConversationSession({ ...source }, 'legacy-cafe', 'UTC'), ConversationLocalError);
  const lifecycle = createLanguageSyncLifecycle(), request = readLanguageSyncRequest(f.lease, lifecycle, f.storage);
  const raw = await commitLanguageSyncResponse(request, {}); assert.throws(() => api.readConversationSnapshot(raw.context), ConversationLocalError);
});

test('P2B registered observation receipt rejects copied token, different wire/request, owner and lifecycle retirement', async t => {
  const f = languageFixture(); t.after(f.restore); const { lease, lifecycle, request } = await f.request();
  const receipt = captureLanguageRemoteObservation(request, {});
  await assert.rejects(commitLanguageSyncResponse(request, {}, { observation: { ...receipt } }), ConversationLocalError);
  await assert.rejects(commitLanguageSyncResponse(request, { savedWords: 'other' }, { observation: receipt }), ConversationLocalError);
  const other = readLanguageSyncRequest(lease, lifecycle, f.storage);
  await assert.rejects(commitLanguageSyncResponse(other, {}, { observation: receipt }), ConversationLocalError);
  lifecycle.revoke(); await assert.rejects(commitLanguageSyncResponse(request, {}, { observation: receipt }));
});

test('P2B original append stages/applies once and every old stage reads terminal precedence', async t => {
  const f = await fixture(t), id = await f.create(); await f.save(id);
  const command = api.captureConversationAppend(f.snapshot(), id, 'draft-a');
  assert.ok(Object.isFrozen(command.command));
  const [a, b] = await Promise.all([api.stageConversationIntent(command), api.stageConversationIntent(command)]);
  assert.equal(a.effect.kind, 'staged'); assert.equal(b.effect.operationId, a.effect.operationId);
  const applied = await api.applyConversationIntent(command); assert.equal(applied.effect.kind, 'applied');
  assert.equal((await api.stageConversationIntent(command)).effect.kind, 'applied');
  assert.equal((await api.applyConversationIntent(command)).effect.resultId, applied.effect.resultId);
  assert.equal(f.snapshot().envelope!.sessions[0].turns.length, 1);
  await assert.rejects(api.applyConversationIntent({ ...command }), ConversationLocalError);
});

test('P2B same-context cancellation preserves exact pinned draft, other lane and terminal late stage/apply', async t => {
  const f = await fixture(t), id = await f.create(); await f.save(id);
  const command = api.captureConversationAppend(f.snapshot(), id, 'draft-a'); await api.stageConversationIntent(command);
  await f.save(id, draft('second', 'synthetic newer lane'));
  const cancellation = api.captureConversationCancellation(f.snapshot(), id, command.command.operationId);
  assert.equal((await api.runConversationEdit(cancellation)).effect.kind, 'cancelled');
  assert.equal((await api.stageConversationIntent(command)).effect.kind, 'cancelled');
  assert.equal((await api.applyConversationIntent(command)).effect.kind, 'cancelled');
  const s = f.snapshot().envelope!.sessions[0]; assert.equal(s.turns.length, 0); assert.equal(s.drafts.length, 2);
  assert.equal(api.reconcileConversationEdit(cancellation, f.context()).status, 'observed');
});

test('P2B retired pending append cannot rebind on resumed same owner; new cancellation can resolve it', async t => {
  const f = await fixture(t), id = await f.create(); await f.save(id);
  const command = api.captureConversationAppend(f.snapshot(), id, 'draft-a'); await api.stageConversationIntent(command);
  f.coordinator.pause(); await f.coordinator.resume();
  await assert.rejects(api.applyConversationIntent(command), ConversationLocalError);
  assert.equal(api.reconcileConversationIntent(command, f.context()).status, 'pending');
  const cancellation = api.captureConversationCancellation(f.snapshot(), id, command.command.operationId); await api.runConversationEdit(cancellation);
  assert.equal(api.reconcileConversationIntent(command, f.context()).status, 'cancelled');
  await assert.rejects(api.stageConversationIntent(command), ConversationLocalError);
});

test('P2B close cancellation preserves lanes and does not fabricate a draft/boundary; new close freezes original observation', async t => {
  const f = await fixture(t), id = await f.create(); await f.save(id);
  const close = api.captureConversationClose(f.snapshot(), id); await api.stageConversationIntent(close);
  const before = f.snapshot().envelope!.sessions[0].drafts;
  await api.runConversationEdit(api.captureConversationCancellation(f.snapshot(), id, close.command.operationId));
  assert.deepEqual(f.snapshot().envelope!.sessions[0].drafts, before); assert.equal(f.snapshot().envelope!.sessions[0].closed, null);
  const next = api.captureConversationClose(f.snapshot(), id), original = f.snapshot().observation;
  await api.stageConversationIntent(next); await api.applyConversationIntent(next);
  f.coordinator.pause(); await f.coordinator.resume();
  const e = f.snapshot().envelope!; assert.deepEqual(e.sessions[0].closed!.observation, original);
  assert.notEqual(f.snapshot().observation.requestId, original.requestId);
  const recap = projectClosedConversationRecap(e, id); assert.ok(recap);
});

test('P2B competing captured appends cannot overwrite the one unresolved slot', async t => {
  const f = await fixture(t), id = await f.create(); await f.save(id); const source = f.snapshot();
  const a = api.captureConversationAppend(source, id, 'draft-a'), b = api.captureConversationAppend(source, id, 'draft-a');
  await api.stageConversationIntent(a); await assert.rejects(api.stageConversationIntent(b), ConversationLocalError);
  assert.equal(f.snapshot().envelope!.sessions[0].operations.length, 1);
});

test('P2B append/cancel races honor whichever terminal record wins without replacing later data', async t => {
  for (const first of ['apply', 'cancel']) {
    const f = await fixture(t), id = await f.create(); await f.save(id); const c = api.captureConversationAppend(f.snapshot(), id, 'draft-a'); await api.stageConversationIntent(c);
    const cancel = api.captureConversationCancellation(f.snapshot(), id, c.command.operationId);
    if (first === 'apply') { await api.applyConversationIntent(c); assert.equal((await api.runConversationEdit(cancel)).effect.kind, 'applied'); }
    else { await api.runConversationEdit(cancel); assert.equal((await api.applyConversationIntent(c)).effect.kind, 'cancelled'); }
    f.coordinator.dispose(); f.restore();
  }
});

test('P2B deletion leaves exact tombstone and late stage/apply cannot resurrect a session', async t => {
  const f = await fixture(t), id = await f.create(); await f.save(id); const c = api.captureConversationAppend(f.snapshot(), id, 'draft-a'); await api.stageConversationIntent(c);
  const deletion = api.captureConversationDeletion(f.snapshot(), id); await api.runConversationEdit(deletion);
  assert.equal(api.reconcileConversationEdit(deletion, f.context()).status, 'observed');
  await assert.rejects(api.stageConversationIntent(c), ConversationLocalError); await assert.rejects(api.applyConversationIntent(c), ConversationLocalError);
  assert.equal(f.snapshot().envelope!.sessions.length, 0); assert.equal(f.snapshot().envelope!.tombstones.length, 1);
});

for (const stage of ['prepared', 'replacement', 'marker']) test(`P2B ${stage} quota failure preserves exact prior envelope and distinguishes proven noncommit`, async t => {
  const f = await fixture(t), id = await f.create(), before = f.values.get(conversationLocalKey('a'));
  const edit = api.captureConversationDraft(f.snapshot(), id, draft()), set = f.storage.setItem; let failed = false;
  f.storage.setItem = (key, value) => { if (!failed && (stage === 'replacement' ? key === conversationLocalKey('a') : key === STORAGE_PROTOCOL_KEY && value.includes(stage === 'prepared' ? 'prepared' : 'committed'))) { failed = true; throw new Error('RAW_CANARY_QUOTA'); } set(key, value); };
  await assert.rejects(api.runConversationEdit(edit), error => error instanceof ConversationLocalError && error.outcome === 'not-committed' && !JSON.stringify(error).includes('RAW_CANARY'));
  assert.equal(f.values.get(conversationLocalKey('a')), before); assert.equal(api.reconcileConversationEdit(edit, f.context()).status, 'unresolved');
  f.storage.setItem = set; assert.equal((await api.runConversationEdit(edit)).acknowledged, true);
});

for (const kind of ['create', 'draft', 'cancel', 'delete']) test(`P2B ${kind} unknown after durable marker is read-first reconciled by exact immutable edit proof`, async t => {
  const f = await fixture(t); let id = ''; let edit: api.ConversationEditIntent;
  if (kind === 'create') edit = api.captureConversationSession(f.snapshot(), 'legacy-cafe', 'UTC');
  else {
    id = await f.create();
    if (kind === 'draft') edit = api.captureConversationDraft(f.snapshot(), id, draft());
    else if (kind === 'delete') edit = api.captureConversationDeletion(f.snapshot(), id);
    else { await f.save(id); const c = api.captureConversationAppend(f.snapshot(), id, 'draft-a'); await api.stageConversationIntent(c); edit = api.captureConversationCancellation(f.snapshot(), id, c.command.operationId); }
  }
  const set = f.storage.setItem; let failed = false;
  f.storage.setItem = (key, value) => { set(key, value); if (!failed && key === STORAGE_PROTOCOL_KEY && value.includes('committed')) { failed = true; throw new Error('RAW_CANARY_AFTER_MARKER'); } };
  await assert.rejects(api.runConversationEdit(edit), error => error instanceof ConversationLocalError && error.outcome === 'unknown');
  assert.equal(api.reconcileConversationEdit(edit, f.context()).status, 'observed');
  f.storage.setItem = set; await assert.rejects(api.runConversationEdit(edit), error => error instanceof ConversationLocalError && error.outcome === 'unknown');
});

test('P2B unknown rollback preserves before-image, blocks reads and never auto-retries original stage', async t => {
  const f = await fixture(t), id = await f.create(); await f.save(id); const c = api.captureConversationAppend(f.snapshot(), id, 'draft-a'); const set = f.storage.setItem;
  f.storage.setItem = (key, value) => { if (key === conversationLocalKey('a') || key === STORAGE_PROTOCOL_KEY && value.includes('committed')) throw new Error('RAW_CANARY_ROLLBACK'); set(key, value); };
  await assert.rejects(api.stageConversationIntent(c), error => error instanceof ConversationLocalError && error.outcome === 'unknown');
  assert.equal(readStorageSnapshot(f.storage).pending, true); assert.throws(f.snapshot, ConversationLocalError);
  f.storage.setItem = set; await assert.rejects(api.stageConversationIntent(c));
});

for (const terminal of ['apply', 'cancel', 'delete']) test(`P2B logical reservations survive integration at exact ceiling for ${terminal}`, async t => {
  const f = await fixture(t), id = await f.create(); await f.save(id); const c = api.captureConversationAppend(f.snapshot(), id, 'draft-a'); await api.stageConversationIntent(c);
  const full = fillBudget(f.snapshot().envelope!); assert.equal(capacityUsage(full).admittedCodeUnits, CONVERSATION_LIMITS.envelopeCodeUnits);
  f.values.set(conversationLocalKey('a'), canonicalJson(full));
  if (terminal === 'apply') await api.applyConversationIntent(c);
  else if (terminal === 'cancel') await api.runConversationEdit(api.captureConversationCancellation(f.snapshot(), id, c.command.operationId));
  else await api.runConversationEdit(api.captureConversationDeletion(f.snapshot(), id));
  assert.ok(capacityUsage(f.snapshot().envelope!).admittedCodeUnits <= CONVERSATION_LIMITS.envelopeCodeUnits);
});

test('P2B two lanes and saved empty revisions preserve exact input; third lane is blocked without eviction', async t => {
  const f = await fixture(t), id = await f.create(); await f.save(id); await f.save(id, draft('b', 'newer'));
  assert.throws(() => api.captureConversationDraft(f.snapshot(), id, draft('c', 'third')), ConversationLocalError);
  await f.save(id, { ...draft('b', ''), revision: 2 }); assert.equal(f.snapshot().envelope!.sessions[0].drafts[1].input, '');
});

test('P2B unavailable locks and corrupt/noncanonical partitions fail closed with fixed codes', async t => {
  const f = await fixture(t), id = await f.create(); const edit = api.captureConversationDraft(f.snapshot(), id, draft());
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator')!; Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  try { await assert.rejects(api.runConversationEdit(edit), ConversationLocalError); } finally { Object.defineProperty(globalThis, 'navigator', previous); }
  const raw = ' {"poison":"RAW_CANARY_CORRUPT"}'; f.values.set(conversationLocalKey('a'), raw);
  assert.throws(f.snapshot, error => error instanceof ConversationLocalError && !JSON.stringify(error).includes('RAW_CANARY')); assert.equal(f.values.get(conversationLocalKey('a')), raw);
});

test('P2B owner ABA invalidates original source and cannot import old text into a new owner epoch', async t => {
  const f = await fixture(t), id = await f.create(); await f.save(id); const c = api.captureConversationAppend(f.snapshot(), id, 'draft-a'); await api.stageConversationIntent(c);
  const originalContext = f.context();
  invalidateStorageOwner(f.storage, 'b'); await f.owner('b'); await f.owner('a');
  await assert.rejects(api.applyConversationIntent(c)); assert.throws(() => api.readConversationSnapshot(originalContext), ConversationLocalError);
});

test('P2B notification failure retains durable after-image but does not grant current acknowledgement', async t => {
  const f = await fixture(t), id = await f.create(); await settle(); const edit = api.captureConversationDraft(f.snapshot(), id, draft());
  const queue = globalThis.queueMicrotask; globalThis.queueMicrotask = () => { throw new Error('RAW_CANARY_NOTIFICATION'); };
  let result: api.ConversationWriteResult;
  try { result = await api.runConversationEdit(edit); } finally { globalThis.queueMicrotask = queue; }
  assert.equal(result.acknowledged, false); assert.equal(result.source, null); assert.equal(result.committed.sessions[0].drafts[0].input, draft().input);
  assert.equal(api.reconcileConversationEdit(edit, f.context()).status, 'observed');
});

test('P2B coalesced callers retire acknowledgement if lifecycle changes immediately after durable commit', async t => {
  const f = await fixture(t), id = await f.create(); await f.save(id); const c = api.captureConversationAppend(f.snapshot(), id, 'draft-a');
  const set = f.storage.setItem; let retired = false;
  f.storage.setItem = (key, value) => { set(key, value); if (!retired && key === STORAGE_PROTOCOL_KEY && value.includes('committed')) { retired = true; f.coordinator.pause(); } };
  const [a, b] = await Promise.all([api.stageConversationIntent(c), api.stageConversationIntent(c)]);
  assert.equal(a.acknowledged, false); assert.equal(b.acknowledged, false); assert.equal(a.source, null); assert.equal(b.source, null);
  assert.equal(a.committed.sessions[0].operations.length, 1);
});

test('P2B response timestamp is captured before a delayed local lock and local writes never advance it', async t => {
  const f = languageFixture(); t.after(f.restore); const lease = await f.owner(); const hold = deferred<void>(); let blocked: Promise<unknown> | undefined;
  const coordinator = createLanguageSyncCoordinator({ lease, storage: f.storage, onState() {}, transport: {
    async verifyOwner() { return true; }, async read() { blocked = f.locks.locks.request(STORAGE_LOCK_NAME, {}, () => hold.promise); return { state: {}, updatedAt: 'remote' }; }, async insert() { return true; }, async update() { return true; },
  } }); t.after(coordinator.dispose);
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T01:00:00.000Z').getTime() });
  const pending = coordinator.start(); await settle(); t.mock.timers.tick(60_000); hold.resolve(); await blocked; await pending;
  const context = coordinator.getState().context!; let snapshot = api.readConversationSnapshot(context);
  assert.equal(snapshot.observation.receivedAt, '2026-10-10T01:00:00.000Z');
  await api.runConversationEdit(api.captureConversationSession(snapshot, 'legacy-cafe', 'UTC')); snapshot = api.readConversationSnapshot(context);
  assert.equal(snapshot.observation.receivedAt, '2026-10-10T01:00:00.000Z');
  assert.equal(snapshot.envelope!.enrollment.createdAt, '2026-10-10T01:01:00.000Z');
});

test('P2B read-first operation observation does not reuse an older registered snapshot after cancellation', async t => {
  const f = await fixture(t), id = await f.create(); await f.save(id); const c = api.captureConversationAppend(f.snapshot(), id, 'draft-a'); await api.stageConversationIntent(c);
  const older = f.snapshot(); await api.runConversationEdit(api.captureConversationCancellation(older, id, c.command.operationId));
  assert.equal(api.reconcileConversationOperation(older, id, c.command.operationId).status, 'cancelled');
});

test('P2B unknown draft reconciliation needs exact identity/revision, never merely matching text', async t => {
  const f = await fixture(t), id = await f.create(), edit = api.captureConversationDraft(f.snapshot(), id, draft());
  const set = f.storage.setItem; let failed = false;
  f.storage.setItem = (key, value) => { set(key, value); if (!failed && key === STORAGE_PROTOCOL_KEY && value.includes('committed')) { failed = true; throw new Error('unknown'); } };
  await assert.rejects(api.runConversationEdit(edit)); f.storage.setItem = set;
  await f.save(id, { ...draft(), revision: 2 });
  assert.equal(api.reconcileConversationEdit(edit, f.context()).status, 'unresolved');
  await assert.rejects(api.runConversationEdit(edit), error => error instanceof ConversationLocalError && error.outcome === 'unknown');
});

test('P2B malformed caller accessors never become host exception payloads in facade diagnostics', async t => {
  const f = await fixture(t), id = await f.create();
  const hostile = new Proxy(draft(), { ownKeys() { throw new Error('RAW_CANARY_ACCESSOR'); } });
  assert.throws(() => api.captureConversationDraft(f.snapshot(), id, hostile), error => error instanceof ConversationLocalError && !JSON.stringify(error).includes('RAW_CANARY'));
});
