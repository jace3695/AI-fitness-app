/** Actual shipped reset/repository/SQL with synthetic auth, locks and IDB.
 * This is not browser durability, PostgREST or multi-connection locking proof. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test, { type TestContext } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as transactions from '../app/data/storageTransaction.ts';
import * as boundary from '../app/data/languageStorageBoundary.ts';
import * as resetFence from '../app/data/languageResetFence.ts';
import * as resets from '../app/data/appRecordReset.ts';
import * as growth from '../app/data/growthRoutines.ts';
import * as budget from '../app/budget/lib/pending-save.ts';
import { createLanguageSyncCoordinator } from '../app/data/languageSyncCoordinator.ts';
import { languageFixture } from './helpers/languageFixture.ts';
import { createLegacyEvidenceSqlFixture } from './helpers/legacy-evidence-sql.ts';
import { loadLegacyEvidenceRepository } from './helpers/legacyEvidenceRepositoryHarness.ts';
import { createDeterministicIDBAdapter } from '../lib/language-legacy-evidence/idb-test-adapter.ts';
import { LEGACY_EVIDENCE_CATALOGUE } from '../lib/language-legacy-evidence/catalogue.ts';
import { preparePresentation } from '../lib/language-legacy-evidence/capture.ts';
import { prepareReviewTransition, reviewTransitionRows, reviewRunKey, reviewRowFenceKey, reviewExposureKey, reviewJournalKey,
  type ReviewAccountingRow, type ReviewRunImmutable } from '../lib/language-legacy-evidence/review-capture.ts';
import { makeSourceSlotKey } from '../lib/language-legacy-evidence/validation.ts';
import type { LocalFence } from '../lib/language-legacy-evidence/persistence-types.ts';
import type { EvidenceEvent } from '../lib/language-legacy-evidence/types.ts';
import type { LanguageLegacyEvidenceRepository } from '../app/data/languageLegacyEvidenceRepository.ts';
import type { LanguageLegacyEvidenceRelease } from '../app/data/languageLegacyEvidenceRelease.ts';
const active: LanguageLegacyEvidenceRelease = { resetProtocol: 'protocol-required', enrollmentEnabled: true, captureEnabled: true };
type Hook = (name: string, args: Record<string, unknown>, result?: unknown) => Promise<unknown> | unknown;
async function fixture(t: TestContext, options: { enroll?: boolean; inactive?: boolean; captureDisabled?: boolean } = {}) {
  const sql = await createLegacyEvidenceSqlFixture({ activateWrites: true, ledgerOnly: options.inactive }), owner = await sql.addOwner();
  const local = languageFixture(), lease = await local.owner(owner);
  const sessions = new Map<string, string>();
  Object.assign(local.window, { sessionStorage: { setItem(key: string, value: string) { sessions.set(key, value); }, getItem(key: string) { return sessions.get(key) ?? null; } } });
  Object.assign(navigator, { onLine: true });
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  let idb = createDeterministicIDBAdapter(), opens = 0;
  const factory = { open(...args: Parameters<IDBFactory['open']>) { opens++; return idb.factory.open(...args); } };
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: factory });
  let before: Hook | undefined, after: Hook | undefined; let authUser: string = owner;
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  async function call(name: string, args: Record<string, unknown>) {
    calls.push({ name, args: structuredClone(args) }); await before?.(name, args);
    let data;
    if (name === 'reset_my_app_records') data = (await sql.db.query<{ result: unknown }>("select public.reset_my_app_records('language',$1,'초기화') result", [args.p_request_id])).rows[0].result;
    else data = await sql.rpc(name, args);
    if (after) data = await after(name, args, data);
    return { data, error: null };
  }
  const client = {
    auth: { async getUser() { await before?.('auth', {}); return { data: { user: { id: authUser } }, error: null }; } },
    rpc(name: string, args: Record<string, unknown>) {
      let pending: Promise<{ data: unknown; error: unknown }> | undefined;
      const execute = () => pending ??= call(name, args).catch(error => ({ data: null, error: { message: (error as Error).message } }));
      return { abortSignal() { return execute(); }, then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { return execute().then(resolve, reject); } };
    },
    from(table: string) { assert.equal(table, 'language_user_state'); return { select() { return { eq(_key: string, id: string) { return { async maybeSingle() {
      await before?.('legacy-read', {});
      const result = await sql.db.query<{ state: Record<string, unknown> }>('select state from public.language_user_state where user_id=$1', [id]);
      return { data: result.rows[0] ?? null, error: null };
    } }; } }; } }; },
  };
  const coordinator = createLanguageSyncCoordinator({ lease, storage: local.storage, onState() {}, transport: {
    async verifyOwner() { return authUser === owner; }, async read() {
      const result = await sql.db.query<{ state: Record<string, unknown>; updated_at: string }>('select state,updated_at from public.language_user_state where user_id=$1', [owner]);
      return result.rows[0] ? { state: result.rows[0].state, updatedAt: result.rows[0].updated_at } : null;
    }, async insert() { assert.fail('No bootstrap'); }, async update() { assert.fail('No snapshot write'); },
  } });
  await coordinator.start();
  const release: LanguageLegacyEvidenceRelease = options.inactive ? { resetProtocol: 'inactive', enrollmentEnabled: false, captureEnabled: false } :
    { ...active, captureEnabled: !options.captureDisabled };
  const runtime = await loadLegacyEvidenceRepository(client, release);
  const acquire = () => runtime.acquireLanguageLegacyEvidenceRepository(coordinator.getState().context!, { studyDayTimezone: 'UTC' });
  const repo = options.enroll ? await acquire() : null;
  const modules: Record<string, unknown> = {
    '../data/storageTransaction': transactions, './supabase': { supabase: client }, '../data/appRecordReset': resets,
    '../data/growthRoutines': growth, '../budget/lib/pending-save': budget,
    '../data/languageResetFence.ts': resetFence, '../data/languageStorageBoundary.ts': boundary,
    '../data/languageLegacyEvidenceRelease.ts': { LANGUAGE_LEGACY_EVIDENCE_RELEASE: release },
    '../data/languageLegacyEvidenceRepository.ts': runtime,
  };
  const source = ts.transpileModule(readFileSync(new URL('../app/lib/resetAppRecords.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const api = {} as { resetAppRecords(app: string, requestId: string, owner: string): Promise<{ marker: string }> };
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, { window: local.window, navigator, Event, Error, crypto })(api, (key: string) => { assert.ok(key in modules, key); return modules[key]; });
  t.after(async () => { coordinator.dispose(); local.restore(); if (prior) Object.defineProperty(globalThis, 'indexedDB', prior); else Reflect.deleteProperty(globalThis, 'indexedDB'); await sql.close(); });
  return { sql, owner, local, repo, runtime, coordinator, acquire, calls, sessions, get opens() { return opens; }, get idb() { return idb; },
    reset(requestId = randomUUID()) { return api.resetAppRecords('language', requestId, owner); },
    hooks(nextBefore?: Hook, nextAfter?: Hook) { before = nextBefore; after = nextAfter; },
    auth(value: string) { authUser = value; },
    evict() { idb = createDeterministicIDBAdapter(); },
  };
}
async function present(repo: LanguageLegacyEvidenceRepository) {
  const context = repo.context(), task = LEGACY_EVIDENCE_CATALOGUE.find(value => value.legacyQuestionId === 'f01:2')!;
  const event: EvidenceEvent = { schemaVersion: 1, eventId: randomUUID(), generationId: context.generationId,
    episodeId: randomUUID(), sourceSlotKey: '', sequence: 0, source: 'course_review', lessonId: task.lessonId, legacyQuestionId: task.legacyQuestionId,
    itemId: task.itemId, contentRevision: task.contentRevision, taskId: task.taskId, gradingVersion: 'legacy-choice-v1', taskFormat: 'meaning_choice',
    occurredAt: context.now, recordTimezone: 'UTC', hintUsed: false, answerPreviouslyRevealed: false, isRetry: false, responseMs: null, timingComplete: false,
    audio: { status: 'not_requested', promptMatchesTask: null }, textVisibility: { targetText: true, reading: false, meaning: false, choices: true }, kind: 'exercise_presented', correct: null };
  event.sourceSlotKey = makeSourceSlotKey(context.ownerId, event);
  await repo.store().commit(await preparePresentation({ transitionId: randomUUID(), event, actualVisible: true, history: 'new_session', timingObserved: true }, context, LEGACY_EVIDENCE_CATALOGUE));
  return event;
}
const fence = (f: Awaited<ReturnType<typeof fixture>>) => boundary.parseLanguageResetFence(f.local.storage.getItem(boundary.LANGUAGE_RESET_FENCE_KEY))!;
type ResetFixture = Awaited<ReturnType<typeof fixture>>;
/** Synthetic persisted history, prepared by the real pure verifier. Acquisition
 * has no observed surface, checkpoint, presentation, answer or proof shortcut. */
async function seedReviewHistory(f: ResetFixture, scope: LocalFence = f.repo!.context()) {
  const task = LEGACY_EVIDENCE_CATALOGUE.find(value => value.legacyQuestionId === 'f01:2')!;
  const identity = { itemId: task.itemId, contentRevision: task.contentRevision, taskId: task.taskId,
    lessonId: task.lessonId, legacyQuestionId: task.legacyQuestionId!, taskFormat: 'meaning_choice' as const, gradingVersion: 'legacy-choice-v1' };
  const episodeId = randomUUID(), transitionId = randomUUID();
  const rowBytes = `{ "id": ${JSON.stringify(identity.legacyQuestionId)}, "syntheticHistory": true }`;
  const immutable: ReviewRunImmutable = { ownerId: scope.ownerId, generationId: scope.generationId,
    incarnationId: (f.idb.inspect('incarnations', 'store') as { incarnationId: string }).incarnationId,
    runId: randomUUID(), episodeId, rowKey: identity.legacyQuestionId,
    slot: JSON.stringify([identity.taskId, identity.contentRevision, identity.taskFormat]),
    sourceSlotKey: makeSourceSlotKey(scope.ownerId, { ...identity, generationId: scope.generationId, episodeId, source: 'course_review' }),
    identity, mode: 'reader', initialDraftToken: randomUUID(),
    originalSource: { key: 'japaneseCurriculumReviewV1', arrayBytes: `[\n${rowBytes}\n]`, rowIndex: 0, rowBytes } };
  const prepared = await prepareReviewTransition({ fence: scope, immutable, transitionId, actionId: randomUUID(),
    before: { runState: null, exposure: null, rowFence: null }, operation: { kind: 'acquire', observationId: randomUUID() } });
  const rows = reviewTransitionRows(prepared);
  assert.equal(prepared.capture, null); assert.equal(rows.run.state.checkpoint, null);
  assert.equal(rows.run.state.phase, 'unpresented'); assert.equal(rows.exposure?.coverage, 'unknown');
  assert.equal(rows.exposure?.answer, null); assert.equal(rows.exposure?.pending.length, 1);
  const records: ReviewAccountingRow[] = [
    { store: 'reviewRuns', key: reviewRunKey(immutable), value: rows.run },
    { store: 'reviewRuns', key: reviewRowFenceKey(immutable), value: rows.rowFence },
    { store: 'itemExposures', key: reviewExposureKey({ ...immutable, ...identity }), value: rows.exposure },
    { store: 'reviewTransitions', key: reviewJournalKey(immutable, transitionId), value: prepared.journal },
  ];
  for (const record of records) f.idb.seed(record.store, record.key, record.value);
  return records;
}
const reviewSnapshot = (f: ResetFixture) => ({ reviewRuns: f.idb.entries('reviewRuns'), itemExposures: f.idb.entries('itemExposures'), reviewTransitions: f.idb.entries('reviewTransitions') });
function assertReviewHistory(f: ResetFixture, records: readonly ReviewAccountingRow[]) {
  const byKey = (a: [IDBValidKey, unknown], b: [IDBValidKey, unknown]) => String(a[0]).localeCompare(String(b[0]));
  for (const store of ['reviewRuns', 'itemExposures', 'reviewTransitions'] as const) {
    const expected = records.filter(record => record.store === store).map(record => [record.key, record.value] as [IDBValidKey, unknown]);
    assert.deepEqual(f.idb.entries(store).sort(byKey), expected.sort(byKey), store);
  }
}

test('default inactive source reset succeeds without new schema, status, IDB or evidence completion claim', async t => {
  const f = await fixture(t, { inactive: true }); const request = randomUUID();
  await f.reset(request); assert.equal(f.opens, 0); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].name, 'reset_my_app_records');
  assert.equal(fence(f).state, 'completed'); assert.equal(fence(f).evidenceCleanup, undefined);
  await assert.rejects(f.acquire(), /feature_inactive/); assert.equal(f.calls.length, 1);
});
test('authoritatively unenrolled required reset uses no IDB and verifies exact status before completion', async t => {
  const f = await fixture(t); await f.reset(); assert.equal(f.opens, 0);
  assert.equal(f.calls.filter(value => value.name === 'read_language_legacy_evidence_status').length, 2);
  assert.equal(fence(f).evidenceCleanup?.status, 'verified');
});
test('required status outage leaves durable cleanup pending and retries cloud read-first without another reset', async t => {
  const f = await fixture(t); const request = randomUUID(); f.local.values.set('savedWords', 'preserved');
  f.hooks(name => { if (name === 'read_language_legacy_evidence_status') throw Error('Unavailable schema or transport'); });
  await assert.rejects(f.reset(request), /클라우드 초기화는 완료됐지만/);
  assert.equal(fence(f).evidenceCleanup?.status, 'pending'); assert.equal(f.local.storage.getItem('savedWords'), 'preserved');
  assert.equal(boundary.readLanguageBoundary(transactions.readStorageSnapshot(f.local.storage), transactions.captureStorageOwner()).status, 'unavailable');
  await assert.rejects(f.reset(request)); assert.equal(f.calls.filter(value => value.name === 'reset_my_app_records').length, 1);
  f.hooks(); await f.reset(request); assert.equal(fence(f).state, 'completed'); assert.equal(f.local.storage.getItem('savedWords'), null);
});
test('enrolled reset erases stale evidence only and atomically carries intact admission to new generation', async t => {
  const f = await fixture(t, { enroll: true }); const old = await present(f.repo!); const other = randomUUID();
  const cached = structuredClone(f.idb.entries('contexts')[0][1]) as { ownerId: string; generationId: string; context: { ownerId: string } };
  cached.ownerId = other; cached.context.ownerId = other; f.idb.seed('contexts', JSON.stringify([other, cached.generationId]), cached);
  await f.reset(); assert.equal(f.idb.entries('events').length, 0); assert.equal(f.idb.entries('contexts').length, 1);
  assert.equal((f.idb.entries('contexts')[0][1] as { ownerId: string }).ownerId, other);
  const admission = f.idb.entries('admissions')[0][1] as { generationId: string; kind: string };
  assert.notEqual(admission.generationId, old.generationId); assert.equal(admission.kind, 'reset_carry');
  await f.coordinator.refresh(); const current = await f.acquire(); assert.equal(current.localContinuity(), 'verified'); await present(current);
});
test('registered reset removes stale review runs, fences, exposures and journals while retaining current generation and other owner exactly', async t => {
  const f = await fixture(t, { enroll: true }), scope = f.repo!.context();
  await seedReviewHistory(f, scope);
  await seedReviewHistory(f, { ...scope, generationId: randomUUID() });
  const other = await seedReviewHistory(f, { ...scope, ownerId: randomUUID() });
  let current: ReviewAccountingRow[] = [], reads = 0;
  f.hooks(undefined, async (name, _args, result) => {
    if (name === 'read_language_legacy_evidence_status' && ++reads === 1) {
      const generationId = (result as { currentContext: { generationId: string } }).currentContext.generationId;
      assert.notEqual(generationId, scope.generationId);
      // Models retained current-generation history before the registered cleanup
      // transaction. Pure fixture preparation confers no writer admission.
      current = await seedReviewHistory(f, { ...scope, generationId });
    }
    return result;
  });
  await f.reset(); assert.equal(reads, 2); assert.equal(fence(f).evidenceCleanup?.status, 'verified');
  assert.equal(current.length, 4); assertReviewHistory(f, [...other, ...current]);
  for (const store of ['events', 'checkpoints', 'commits', 'delivery']) assert.equal(f.idb.entries(store).length, 0, store);
});
test('completed same-request retry fences first and retains current-generation work and admission', async t => {
  const f = await fixture(t, { enroll: true }); const request = randomUUID(); await present(f.repo!); await f.reset(request);
  await f.coordinator.refresh(); const current = await f.acquire(); const fresh = await present(current);
  const review = await seedReviewHistory(f, current.context());
  const events = f.idb.entries('events'), admissions = f.idb.entries('admissions'); let observed = false;
  f.hooks(name => { if (name === 'read_language_legacy_evidence_status') {
    observed = true; assert.equal(fence(f).state, 'completed'); assert.equal(fence(f).evidenceCleanup?.status, 'pending');
    assert.ok(resetFence.readPendingLanguageReset(f.owner)); assert.throws(() => current.context(), /stale_authority/);
  } });
  await f.reset(request); assert.ok(observed); assert.deepEqual(f.idb.entries('events'), events); assert.deepEqual(f.idb.entries('admissions'), admissions);
  assertReviewHistory(f, review);
  assert.equal((f.idb.entries('events')[0][1] as { generationId: string }).generationId, fresh.generationId);
  assert.equal(f.calls.filter(value => value.name === 'reset_my_app_records').length, 1);
});
test('capture disabled still requires and completes enrolled reset cleanup', async t => {
  const f = await fixture(t, { enroll: true, captureDisabled: true }); assert.throws(() => f.repo!.store(), /feature_inactive/);
  await f.reset(); assert.equal(fence(f).evidenceCleanup?.status, 'verified'); assert.ok(f.opens > 0);
});
test('evicted enrolled store stays unknown through reset and cannot regain captured first-use continuity', async t => {
  const f = await fixture(t, { enroll: true }); f.evict(); await f.reset();
  assert.equal(f.idb.entries('admissions').length, 0);
  await f.coordinator.refresh(); const current = await f.acquire(); assert.equal(current.localContinuity(), 'unknown');
  assert.throws(() => current.store(), /local_continuity_unknown/); assert.equal((await current.readPrefix()).status, 'complete_authenticated_prefix');
});
test('enrolled generation loss permits owner cleanup but never reconstructs server history', async t => {
  const f = await fixture(t, { enroll: true }); await present(f.repo!);
  await f.sql.db.exec('reset role'); await f.sql.db.query('delete from public.language_legacy_evidence_generations where owner_id=$1', [f.owner]); await f.sql.asOwner(f.owner);
  await f.reset(); assert.equal(f.idb.entries('events').length, 0); assert.equal(f.idb.entries('admissions').length, 0);
  await f.coordinator.refresh(); await assert.rejects(f.acquire(), /legacy_enrolled_generation_missing/);
  const status = await f.sql.rpc('read_language_legacy_evidence_status', { expected_owner: f.owner, expected_marker: null }) as { status: string };
  assert.equal(status.status, 'enrolled_generation_missing');
});
test('enrollment under unchanged reset marker invalidates skip-IDB proof and same-request retry re-evaluates cleanup', async t => {
  const f = await fixture(t); const request = randomUUID(); let reads = 0;
  f.hooks(undefined, async (name, _args, result) => {
    if (name === 'read_language_legacy_evidence_status' && ++reads === 1) {
      const status = result as { resetMarker: unknown }; await f.sql.context(f.owner, status.resetMarker);
    }
    return result;
  });
  await assert.rejects(f.reset(request)); assert.equal(fence(f).evidenceCleanup?.status, 'pending'); assert.equal(f.opens, 0);
  f.hooks(); await f.reset(request); assert.ok(f.opens > 0); assert.equal(fence(f).evidenceCleanup?.status, 'verified');
});
for (const fault of ['abort', 'quota', 'blocked'] as const) test(`IDB ${fault} leaves cleanup pending and preserved evidence for exact retry`, async t => {
  const f = await fixture(t, { enroll: true }); await present(f.repo!); const request = randomUUID(); const events = f.idb.entries('events');
  await seedReviewHistory(f); const other = await seedReviewHistory(f, { ...f.repo!.context(), ownerId: randomUUID() });
  const review = reviewSnapshot(f);
  f.hooks(undefined, (name, _args, result) => {
    if (name === 'reset_my_app_records') {
      if (fault === 'abort') f.idb.abortNextTransaction(); else if (fault === 'quota') f.idb.quotaNextWrite(); else f.idb.blockNextOpen();
    }
    return result;
  });
  await assert.rejects(f.reset(request)); assert.equal(fence(f).evidenceCleanup?.status, 'pending'); assert.deepEqual(f.idb.entries('events'), events);
  assert.deepEqual(reviewSnapshot(f), review); assert.equal(f.sessions.size, 0);
  f.hooks(); await f.reset(request); assert.equal(fence(f).state, 'completed'); assert.equal(f.idb.entries('events').length, 0);
  assertReviewHistory(f, other); assert.equal(f.calls.filter(value => value.name === 'reset_my_app_records').length, 1);
});
for (const [index, kind] of ['run', 'row_fence', 'exposure', 'journal'].entries()) test(`registered reset rejects ${kind} key/body mismatch before deleting any scoped review history`, async t => {
  const f = await fixture(t, { enroll: true }), request = randomUUID();
  const stale = await seedReviewHistory(f), other = await seedReviewHistory(f, { ...f.repo!.context(), ownerId: randomUUID() });
  // Both bodies are independently valid; only the stored key/body relationship
  // is wrong. A serialized wrapper owner cannot authorize deletion or skipping.
  const original = stale[index]; f.idb.seed(original.store, original.key, other[index].value);
  const before = reviewSnapshot(f), admissions = f.idb.entries('admissions');
  await assert.rejects(f.reset(request)); assert.equal(fence(f).evidenceCleanup?.status, 'pending'); assert.equal(f.sessions.size, 0);
  assert.deepEqual(reviewSnapshot(f), before); assert.deepEqual(f.idb.entries('admissions'), admissions);
  f.idb.seed(original.store, original.key, original.value);
  await f.reset(request); assert.equal(fence(f).evidenceCleanup?.status, 'verified'); assertReviewHistory(f, other);
  assert.equal(f.calls.filter(value => value.name === 'reset_my_app_records').length, 1);
});
test('copied context/authority and serialized verified flag cannot complete reset cleanup', async t => {
  const f = await fixture(t); const request = randomUUID(); let context = await resetFence.establishLanguageReset(resetFence.captureLanguageReset(request, f.owner));
  const receipt = (await f.sql.db.query<{ result: { marker: string } }>("select public.reset_my_app_records('language',$1,'초기화') result", [request])).rows[0].result;
  context = await resetFence.requireLanguageEvidenceCleanup(context, receipt.marker);
  assert.throws(() => resetFence.languageEvidenceResetCapability.acquire({ ...context }, receipt.marker));
  const authority = resetFence.languageEvidenceResetCapability.acquire(context, receipt.marker); assert.throws(() => resetFence.languageEvidenceResetCapability.assertCurrent({ ...authority }));
  await assert.rejects(resetFence.completeLanguageReset(context, receipt.marker));
  f.local.values.set(boundary.LANGUAGE_RESET_FENCE_KEY, JSON.stringify({ ...fence(f), evidenceCleanup: { version: 1, status: 'verified' } }));
  const copiedVerified = resetFence.captureLanguageReset(request, f.owner);
  await assert.rejects(resetFence.completeLanguageReset(copiedVerified, receipt.marker));
});

test('same-marker generation disappearance after cleanup cannot be mistaken for the original target', async t => {
  const f = await fixture(t, { enroll: true }); await present(f.repo!); const request = randomUUID(); let reads = 0;
  f.hooks(name => {
    if (name === 'read_language_legacy_evidence_status' && ++reads === 2) return (async () => {
      await f.sql.db.exec('reset role'); await f.sql.db.query('delete from public.language_legacy_evidence_generations where owner_id=$1', [f.owner]); await f.sql.asOwner(f.owner);
    })();
  });
  await assert.rejects(f.reset(request)); assert.equal(fence(f).evidenceCleanup?.status, 'pending'); assert.equal(f.sessions.size, 0);
  f.hooks(); await f.reset(request); assert.equal(fence(f).evidenceCleanup?.status, 'verified'); assert.equal(f.idb.entries('admissions').length, 0);
});
test('cleanup committed with lost response is independently verified before reset completion', async t => {
  const f = await fixture(t, { enroll: true }); await present(f.repo!);
  await seedReviewHistory(f); const other = await seedReviewHistory(f, { ...f.repo!.context(), ownerId: randomUUID() });
  f.hooks(undefined, (name, _args, result) => { if (name === 'reset_my_app_records') f.idb.loseNextCommitResponse(); return result; });
  await f.reset(); assert.equal(f.idb.entries('events').length, 0); assert.equal(fence(f).evidenceCleanup?.status, 'verified');
  assertReviewHistory(f, other);
});
test('cleanup readback loss keeps pending after commit and exact retry preserves carried continuity', async t => {
  const f = await fixture(t, { enroll: true }); await present(f.repo!); const request = randomUUID();
  await seedReviewHistory(f); const other = await seedReviewHistory(f, { ...f.repo!.context(), ownerId: randomUUID() });
  f.hooks(undefined, (name, _args, result) => { if (name === 'reset_my_app_records') f.idb.afterNextWriteCommit(() => f.idb.failNextRead()); return result; });
  await assert.rejects(f.reset(request)); assert.equal(fence(f).evidenceCleanup?.status, 'pending'); assert.equal(f.idb.entries('events').length, 0);
  assertReviewHistory(f, other);
  const carried = f.idb.entries('admissions'); f.hooks(); await f.reset(request); assert.deepEqual(f.idb.entries('admissions'), carried);
  assertReviewHistory(f, other); assert.equal(fence(f).evidenceCleanup?.status, 'verified');
});
for (const at of ['initial-status', 'cleanup-transaction', 'final-status'] as const) test(`same-owner epoch replacement at ${at} revokes reset evidence authority`, async t => {
  const f = await fixture(t, { enroll: true }); await present(f.repo!); let reads = 0;
  const revoke = () => { transactions.invalidateStorageOwner(f.local.storage, f.owner); };
  f.hooks(name => {
    if (name === 'read_language_legacy_evidence_status') {
      reads++;
      if (at === 'initial-status' && reads === 1 || at === 'final-status' && reads === 2) revoke();
    }
  }, (name, _args, result) => {
    if (at === 'cleanup-transaction' && name === 'reset_my_app_records') f.idb.beforeNextTransaction('readwrite', revoke);
    return result;
  });
  await assert.rejects(f.reset()); assert.equal(f.sessions.size, 0); assert.equal(fence(f).evidenceCleanup?.status, 'pending');
  if (at !== 'final-status') assert.equal(f.idb.entries('events').length, 1);
});
for (const cleanup of [{ version: 2, status: 'verified' }, { version: 1, status: 'invalid' }, { version: 1, status: 'verified', forged: true }, null]) test(`unknown cleanup fence is fail-closed: ${JSON.stringify(cleanup)}`, () => {
  const requestId = randomUUID(); assert.throws(() => boundary.parseLanguageResetFence(JSON.stringify({ version: 1, owner: randomUUID(), requestId,
    expectedMarker: null, state: 'completed', marker: `2026-10-10T04:00:00Z|${requestId}`, evidenceCleanup: cleanup })));
});

test('harmless server high-water growth retains the proven cleanup target', async t => {
  const f = await fixture(t, { enroll: true }); const old = await present(f.repo!); let reads = 0;
  f.hooks(undefined, async (name, _args, result) => {
    if (name === 'read_language_legacy_evidence_status' && ++reads === 1) {
      const context = (result as { currentContext: { generationId: string; serverTime: string; manifestDigest: string } }).currentContext;
      const event = { ...old, eventId: randomUUID(), episodeId: randomUUID(), generationId: context.generationId, occurredAt: context.serverTime };
      event.sourceSlotKey = makeSourceSlotKey(f.owner, event);
      const { canonicalEvidence } = await import('../lib/language-legacy-evidence/validation.ts');
      await f.sql.rpc('append_language_legacy_evidence', { expected_owner: f.owner, expected_generation: context.generationId, manifest_digest: context.manifestDigest,
        batch_id: randomUUID(), source_slot: event.sourceSlotKey, expected_predecessor: null, canonical_events: [canonicalEvidence(event)] });
    }
    return result;
  });
  await f.reset(); assert.equal(fence(f).evidenceCleanup?.status, 'verified'); f.hooks(); await f.coordinator.refresh();
  const prefix = await (await f.acquire()).readPrefix(); assert.equal(prefix.status, 'complete_authenticated_prefix');
  if (prefix.status === 'complete_authenticated_prefix') assert.equal(prefix.snapshot.records.length, 1);
});
for (const mutation of ['missing-state', 'unsupported-protocol', 'missing-witness', 'missing-current', 'extra-field'] as const) test(`malformed status ${mutation} cannot authorize skip-IDB or cleanup completion`, async t => {
  const f = await fixture(t, { enroll: true }); await present(f.repo!); const events = f.idb.entries('events');
  f.hooks(undefined, (name, _args, result) => {
    if (name !== 'read_language_legacy_evidence_status') return result;
    const changes = { 'missing-state': { statePresent: false }, 'unsupported-protocol': { protocol: 'future' },
      'missing-witness': { enrollment: null }, 'missing-current': { currentContext: null }, 'extra-field': { verified: true } };
    return { ...(result as object), ...changes[mutation] };
  });
  await assert.rejects(f.reset()); assert.equal(fence(f).evidenceCleanup?.status, 'pending'); assert.deepEqual(f.idb.entries('events'), events); assert.equal(f.sessions.size, 0);
});

test('repository close revokes retained store and prepared capture, including awaited hashing', async t => {
  const f = await fixture(t, { enroll: true }); const repo = f.repo!, event = await present(repo), store = repo.store(), context = repo.context();
  const next = { ...event, eventId: randomUUID(), episodeId: randomUUID() }; next.sourceSlotKey = makeSourceSlotKey(f.owner, next);
  const value = await preparePresentation({ transitionId: randomUUID(), event: next, actualVisible: true, history: 'new_session', timingObserved: true }, context, LEGACY_EVIDENCE_CATALOGUE);
  const digest = crypto.subtle.digest;
  crypto.subtle.digest = async function (...args: Parameters<SubtleCrypto['digest']>) { const result = await digest.apply(this, args); repo.close(); return result; };
  try { await assert.rejects(store.commit(value), /stale_context|stale_authority/); }
  finally { crypto.subtle.digest = digest; }
  await assert.rejects(store.readCheckpoint(context, event.sourceSlotKey), /stale_context|stale_authority/);
  assert.equal(f.idb.entries('events').length, 1);
});
for (const loss of ['eviction', 'unknown-incarnation', 'changed-admission', 'missing-admission'] as const) test(`already returned writer rejects ${loss}, while cache viewing retains unknown continuity`, async t => {
  const f = await fixture(t, { enroll: true }); const repo = f.repo!, event = await present(repo), store = repo.store(), context = repo.context();
  const next = { ...event, eventId: randomUUID(), episodeId: randomUUID() }; next.sourceSlotKey = makeSourceSlotKey(f.owner, next);
  const prepared = await preparePresentation({ transitionId: randomUUID(), event: next, actualVisible: true, history: 'new_session', timingObserved: true }, context, LEGACY_EVIDENCE_CATALOGUE);
  const originalIncarnation = f.idb.entries('incarnations')[0];
  if (loss === 'eviction') f.evict();
  else if (loss === 'unknown-incarnation') f.idb.tamper('incarnations', f.idb.entries('incarnations')[0][0], value => ({ ...(value as object), continuity: 'unknown' }));
  else if (loss === 'missing-admission') await new Promise<void>((resolve, reject) => {
    const open = f.idb.factory.open('yeoni-legacy-language-evidence-v1');
    open.onerror = () => reject(open.error); open.onsuccess = () => {
      const tx = open.result.transaction(['admissions'], 'readwrite'); tx.objectStore('admissions').delete(f.idb.entries('admissions')[0][0]);
      tx.oncomplete = () => { open.result.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    };
  });
  else f.idb.tamper('admissions', f.idb.entries('admissions')[0][0], value => ({ ...(value as object), resetMarker: { present: true, value: `2026-10-10T04:00:00Z|${randomUUID()}` } }));
  await assert.rejects(store.commit(prepared), /stale_context|stale_authority/);
  assert.equal(repo.localContinuity(), 'unknown'); assert.throws(() => repo.store(), /local_continuity_unknown/);
  if (loss === 'unknown-incarnation') {
    f.idb.seed('incarnations', originalIncarnation[0], originalIncarnation[1]);
    await assert.rejects(store.commit(prepared), /stale_context|stale_authority/, 'Observed loss permanently retires the retained writer even if old bytes return');
  }
  assert.equal((await repo.readPrefix()).status, 'complete_authenticated_prefix'); assert.equal(repo.localContinuity(), 'unknown');
  assert.equal(f.idb.entries('events').length, loss === 'eviction' ? 0 : 1);
});
test('cache-first live eviction invalidates admission before any later retained-writer operation', async t => {
  const f = await fixture(t, { enroll: true }); const repo = f.repo!, event = await present(repo), store = repo.store(), context = repo.context();
  f.evict(); assert.equal((await repo.readPrefix()).status, 'complete_authenticated_prefix'); assert.equal(repo.localContinuity(), 'unknown');
  await assert.rejects(store.readCheckpoint(context, event.sourceSlotKey), /stale_context|stale_authority/); assert.equal(f.idb.entries('events').length, 0);
});
