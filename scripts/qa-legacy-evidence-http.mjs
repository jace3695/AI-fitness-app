/** Real local Auth/PostgREST with the production repository/coordinator/store.
 * Explicit CI entry point only. This filename MUST NOT become *.test.ts. */
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { createLegacyEvidenceDiagnostics, diagnosticAssert as assert } from './legacy-evidence-ci-diagnostics.mjs';
import { verifyDisposableStack, createSyntheticAccounts, loopbackFetch, DISPOSABLE_EVIDENCE_RELEASE } from './qa-legacy-evidence-postgres.mjs';

const RAW_ANSWER = 'LOCAL_ONLY_LEGACY_EVIDENCE_HTTP_SENTINEL_合成回答';
const sha = text => createHash('sha256').update(text).digest('hex');

// Execute the shipped orchestrator with the same module registries as the
// production repository. Only client and explicit test release are substituted.
async function loadResetAppRecords(client, release, repository, window) {
  const [ts, transactions, resets, growth, budget, resetFence, boundary] = await Promise.all([
    import('typescript'), import('../app/data/storageTransaction.ts'), import('../app/data/appRecordReset.ts'),
    import('../app/data/growthRoutines.ts'), import('../app/budget/lib/pending-save.ts'),
    import('../app/data/languageResetFence.ts'), import('../app/data/languageStorageBoundary.ts'),
  ]);
  const modules = {
    '../data/storageTransaction': transactions, './supabase': { supabase: client }, '../data/appRecordReset': resets,
    '../data/growthRoutines': growth, '../budget/lib/pending-save': budget,
    '../data/languageResetFence.ts': resetFence, '../data/languageStorageBoundary.ts': boundary,
    '../data/languageLegacyEvidenceRelease.ts': { LANGUAGE_LEGACY_EVIDENCE_RELEASE: release },
    '../data/languageLegacyEvidenceRepository.ts': repository,
  };
  const source = ts.default.transpileModule(readFileSync(new URL('../app/lib/resetAppRecords.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.default.ModuleKind.CommonJS, target: ts.default.ScriptTarget.ES2022 },
  }).outputText;
  const api = {};
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, { window, navigator, Event, Error, crypto })(api, name => {
    assert.ok(Object.hasOwn(modules, name), 'unexpected reset dependency'); return modules[name];
  });
  return { ...api, fence: () => boundary.parseLanguageResetFence(window.localStorage.getItem(boundary.LANGUAGE_RESET_FENCE_KEY)) };
}

export async function runHttpHarness(diagnostics = createLegacyEvidenceDiagnostics()) {
  // Independent preflight, even if invoked as a module from the race gate.
  const stack = verifyDisposableStack(diagnostics);
  diagnostics.start('http', 'execute');
  const [{ loadLegacyEvidenceRepository }, { languageFixture }, { verifyAuthenticatedStorageOwner, revokeAuthenticatedStorageOwner },
    { prepareLocalCloudState }, { createLanguageSyncCoordinator }, { createDeterministicIDBAdapter }, { preparePresentation, prepareAnswer },
    { freezeBatch }, { makeSourceSlotKey }, { LEGACY_EVIDENCE_CATALOGUE }, manifest, { createClient }] = await Promise.all([
    import('../tests/helpers/legacyEvidenceRepositoryHarness.ts'), import('../tests/helpers/languageFixture.ts'),
    import('../app/data/authenticatedStorageOwner.ts'), import('../app/data/cloudSync.ts'), import('../app/data/languageSyncCoordinator.ts'),
    import('../lib/language-legacy-evidence/idb-test-adapter.ts'), import('../lib/language-legacy-evidence/capture.ts'),
    import('../lib/language-legacy-evidence/outbox.ts'), import('../lib/language-legacy-evidence/validation.ts'),
    import('../lib/language-legacy-evidence/catalogue.ts'), import('../lib/language-legacy-evidence/identity-manifest.ts'), import('@supabase/supabase-js'),
  ]);
  const report = { status: 'running', kind: 'real-local-auth-postgrest-production-repository', checks: {},
    limitations: ['Synthetic prospective observations and fake IndexedDB.', 'No real browser, learner capture, hosted installation or provider request.'] };
  const trace = [], nativeFetch = globalThis.fetch;
  let dropAppend = false, dropReadAfterAppend = false, appendCommitted = false, lostRecords, missingRpc = false;
  let dropEnrollment = false, firstEnrollmentRequest, lostEnrollment, missingStatus = false;
  const transport = loopbackFetch(async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const rpc = url.pathname.startsWith('/rest/v1/rpc/') ? url.pathname.slice('/rest/v1/rpc/'.length) : null;
    if (init?.body) assert.equal(String(init.body).includes(RAW_ANSWER), false, 'raw compatibility answer escaped IDB');
    if (rpc) trace.push(rpc);
    if (rpc === 'enroll_language_legacy_evidence_v1' && !firstEnrollmentRequest) firstEnrollmentRequest = JSON.parse(String(init.body));
    if (missingStatus && rpc === 'read_language_legacy_evidence_status') {
      const absent = new URL(url); absent.pathname = '/rest/v1/rpc/qa_missing_legacy_evidence_status';
      return nativeFetch(absent, { ...init, redirect: 'error' });
    }
    // A missing-RPC test still sends a real HTTP request to the same local API.
    if (missingRpc && rpc === 'read_language_legacy_evidence_context') {
      const absent = new URL(url); absent.pathname = '/rest/v1/rpc/qa_missing_legacy_evidence_rpc';
      return nativeFetch(absent, { ...init, redirect: 'error' });
    }
    const response = await nativeFetch(input, { ...init, redirect: 'error' });
    if (dropEnrollment && rpc === 'enroll_language_legacy_evidence_v1' && response.ok) {
      lostEnrollment = await response.json(); assert.equal(lostEnrollment.status, 'enrolled'); dropEnrollment = false;
      throw new Error('synthetic loss after actual committed HTTP enrollment');
    }
    if (dropAppend && rpc === 'append_language_legacy_evidence' && response.ok) {
      // Consume the successful PostgREST response before losing it: SQL committed.
      const committed = await response.json(); assert.ok(committed.records.length);
      lostRecords = committed.records; appendCommitted = true; dropAppend = false;
      throw new Error('synthetic loss after actual committed HTTP append');
    }
    if (dropReadAfterAppend && appendCommitted && rpc === 'read_language_legacy_evidence_events') {
      assert.equal(response.ok, true); await response.arrayBuffer(); dropReadAfterAppend = false;
      throw new Error('synthetic independent read response loss before facade restart');
    }
    return response;
  });
  let fixtures, fixture, lease, coordinator, repository;
  const previousIdb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  try {
    fixtures = await createSyntheticAccounts(stack, 2, transport);
    const [account, other] = fixtures.accounts, client = account.client, owner = account.id;
    const adapter = createDeterministicIDBAdapter(); let activeAdapter = adapter, opens = 0;
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open(...args) { opens++; return activeAdapter.factory.open(...args); } } });
    fixture = languageFixture(); Object.assign(navigator, { onLine: true });
    const sessions = new Map(); Object.assign(fixture.window, { sessionStorage: { getItem(key) { return sessions.get(key) ?? null; }, setItem(key, value) { sessions.set(key, value); } } });
    lease = await verifyAuthenticatedStorageOwner(fixture.storage, () => client.auth.getUser(), prepareLocalCloudState);
    coordinator = createLanguageSyncCoordinator({ lease, storage: fixture.storage, onState() {}, transport: {
      async verifyOwner(expected, signal) { assert.equal(fixture.locks.active, 0); if (signal.aborted) return false; const value = await client.auth.getUser(); return !value.error && value.data.user?.id === expected; },
      async read(expected, signal) { assert.equal(fixture.locks.active, 0); const value = await client.from('language_user_state').select('state,updated_at').eq('user_id', expected).abortSignal(signal).maybeSingle(); if (value.error) throw new Error('language read failed'); return value.data ? { state: value.data.state, updatedAt: value.data.updated_at } : null; },
      async insert(expected, state, signal) { assert.equal(fixture.locks.active, 0); const value = await client.from('language_user_state').insert({ user_id: expected, state }).abortSignal(signal); if (value.error) throw new Error('language insert failed'); return true; },
      async update(expected, state, updatedAt, signal) { assert.equal(fixture.locks.active, 0); const value = await client.from('language_user_state').update({ state }).eq('user_id', expected).eq('updated_at', updatedAt).select('user_id').abortSignal(signal); if (value.error) throw new Error('language update failed'); return value.data.length === 1; },
    } });
    await coordinator.start(); let registered = coordinator.getState(); assert.equal(registered.status, 'ready'); assert.ok(registered.context);
    const inactiveRuntime = await loadLegacyEvidenceRepository(client);
    const beforeInactive = trace.length;
    await assert.rejects(inactiveRuntime.acquireLanguageLegacyEvidenceRepository(registered.context, { studyDayTimezone: 'Asia/Seoul' }), error => error.code === 'feature_inactive');
    assert.equal(trace.length, beforeInactive); assert.equal(opens, 0);
    const inactiveReset = await loadResetAppRecords(client, { resetProtocol: 'inactive', enrollmentEnabled: false, captureEnabled: false }, inactiveRuntime, fixture.window);
    missingStatus = true;
    await inactiveReset.resetAppRecords('language', randomUUID(), owner); missingStatus = false;
    assert.deepEqual(trace.slice(beforeInactive), ['reset_my_app_records']); assert.equal(opens, 0);
    assert.equal(inactiveReset.fence().evidenceCleanup, undefined);
    await coordinator.resume(); registered = coordinator.getState(); assert.equal(registered.status, 'ready');
    const runtime = await loadLegacyEvidenceRepository(client, DISPOSABLE_EVIDENCE_RELEASE);
    const captureDisabledRelease = Object.freeze({ ...DISPOSABLE_EVIDENCE_RELEASE, captureEnabled: false });
    const resetRuntime = await loadLegacyEvidenceRepository(client, captureDisabledRelease);
    const resetApi = await loadResetAppRecords(client, captureDisabledRelease, resetRuntime, fixture.window);
    const beforeUnenrolled = trace.length; await resetApi.resetAppRecords('language', randomUUID(), owner);
    assert.deepEqual(trace.slice(beforeUnenrolled), ['reset_my_app_records', 'read_language_legacy_evidence_status', 'read_language_legacy_evidence_status']);
    assert.equal(opens, 0); assert.equal(resetApi.fence().evidenceCleanup.status, 'verified');
    await coordinator.resume(); registered = coordinator.getState(); assert.equal(registered.status, 'ready');
    report.checks.inactiveResetSkipsEvidenceAndRequiredUnenrolledResetSkipsIdb = 'passed';
    await assert.rejects(runtime.acquireLanguageLegacyEvidenceRepository({ ...registered.context }, { studyDayTimezone: 'Asia/Seoul' }), error => error.code === 'stale_authority');
    dropEnrollment = true;
    await assert.rejects(runtime.acquireLanguageLegacyEvidenceRepository(registered.context, { studyDayTimezone: 'Asia/Seoul' }), error => error.code === 'unavailable');
    assert.ok(lostEnrollment); assert.equal(adapter.entries('enrollmentIntents').length, 1); assert.equal(adapter.entries('admissions').length, 0);
    const beforeAdmissionRetry = trace.length;
    repository = await runtime.acquireLanguageLegacyEvidenceRepository(registered.context, { studyDayTimezone: 'Asia/Seoul' });
    assert.deepEqual(trace.slice(beforeAdmissionRetry), ['read_language_legacy_evidence_status']);
    assert.equal(repository.localContinuity(), 'verified'); assert.equal(adapter.entries('enrollmentIntents').length, 0);
    assert.equal(repository.serverContext().generationId, lostEnrollment.initialGenerationId);
    assert.equal(lostEnrollment.creationRequestId, firstEnrollmentRequest.creation_request_id);
    const enrollmentReplay = await client.rpc('enroll_language_legacy_evidence_v1', firstEnrollmentRequest);
    assert.equal(enrollmentReplay.error, null); assert.equal(enrollmentReplay.data.status, 'enrolled');
    assert.equal(enrollmentReplay.data.initialGenerationId, lostEnrollment.initialGenerationId);
    const changedRequest = await client.rpc('enroll_language_legacy_evidence_v1', { ...firstEnrollmentRequest, proposed_timezone: 'UTC' });
    assert.equal(changedRequest.error?.message, 'legacy_enrollment_conflict');
    const competing = await client.rpc('enroll_language_legacy_evidence_v1', { ...firstEnrollmentRequest, creation_request_id: randomUUID() });
    assert.equal(competing.error, null); assert.equal(competing.data.status, 'existing_enrollment');
    assert.equal(competing.data.creationRequestId, firstEnrollmentRequest.creation_request_id);
    report.checks.requestBoundLostEnrollmentReadFirstAdmissionAndNonceConflict = 'passed';
    report.checks.realAuthAndRegisteredCoordinator = 'passed';
    const original = repository.serverContext(), task = LEGACY_EVIDENCE_CATALOGUE.find(value => value.legacyQuestionId === 'f01:2'); assert.ok(task);
    const binding = task.bindings.find(value => value.source === 'course_lesson' && value.taskFormat === 'meaning_choice'); assert.ok(binding);
    const event = { schemaVersion: 1, eventId: randomUUID(), generationId: original.generationId, episodeId: randomUUID(), sourceSlotKey: '', sequence: 0,
      source: binding.source, itemId: task.itemId, contentRevision: task.contentRevision, taskId: task.taskId, lessonId: task.lessonId,
      legacyQuestionId: task.legacyQuestionId, lessonSessionId: randomUUID(), gradingVersion: binding.gradingVersion, taskFormat: binding.taskFormat,
      occurredAt: original.serverTime, recordTimezone: original.studyDayTimezone, hintUsed: false, answerPreviouslyRevealed: false, isRetry: false,
      responseMs: null, timingComplete: false, audio: { status: 'not_requested', promptMatchesTask: null },
      textVisibility: { targetText: true, reading: false, meaning: false, choices: true }, kind: 'exercise_presented', correct: null };
    event.sourceSlotKey = makeSourceSlotKey(owner, event);
    const presentation = await preparePresentation({ transitionId: randomUUID(), event, actualVisible: true, history: 'new_session', timingObserved: true }, repository.context(), LEGACY_EVIDENCE_CATALOGUE);
    const saved = await repository.store().commit(presentation); assert.equal(saved.status, 'local_committed');
    const presentationBatch = await freezeBatch(randomUUID(), [presentation.event], null);
    const beforePresentation = trace.length; assert.equal((await repository.deliverBatch(presentationBatch)).status, 'acknowledged');
    assert.equal(trace[beforePresentation], 'read_language_legacy_evidence_events');
    const learning = await repository.readPrefix(); assert.equal(learning.status, 'complete_authenticated_prefix');
    assert.equal(repository.project(learning).pairs.find(pair => pair.itemId === task.itemId && pair.modality === 'meaning').stage, 'learning');
    report.checks.presentationLearning = 'passed';
    const contextArgs = { expected_owner: owner, expected_generation: original.generationId, manifest_digest: manifest.LEGACY_EVIDENCE_MANIFEST_DIGEST };
    const observed = await client.rpc('read_language_legacy_evidence_context', contextArgs); assert.equal(observed.error, null);
    const observedAt = observed.data.serverTime, elapsed = Date.parse(observedAt) - Date.parse(event.occurredAt); assert.ok(elapsed >= 0);
    const answer = await prepareAnswer(saved.checkpoint, { transitionId: randomUUID(), eventId: randomUUID(), occurredAt: observedAt, recordTimezone: original.studyDayTimezone, correct: true,
      responseMs: Math.min(5, elapsed), handoff: { draftToken: 'synthetic-existing-draft', answer: RAW_ANSWER, observation: { neededHelp: false, modality: 'meaning' } } },
      { ...repository.context(), now: observedAt }, LEGACY_EVIDENCE_CATALOGUE);
    await repository.store().commit(answer);
    const answerBatch = await freezeBatch(randomUUID(), [answer.event], saved.checkpoint.predecessor);
    const beforeLoss = trace.length; dropAppend = true; dropReadAfterAppend = true;
    await assert.rejects(repository.deliverBatch(answerBatch)); assert.equal(appendCommitted, true);
    assert.deepEqual(trace.slice(beforeLoss), ['read_language_legacy_evidence_events', 'append_language_legacy_evidence', 'read_language_legacy_evidence_events']);
    assert.equal((await repository.store().readDelivery(repository.context(), answer.event.eventId)).status, 'readback_required');
    repository.close(); await coordinator.resume(); const refreshed = coordinator.getState(); assert.equal(refreshed.status, 'ready');
    repository = await runtime.acquireLanguageLegacyEvidenceRepository(refreshed.context, { studyDayTimezone: 'UTC' }); assert.equal(repository.serverContext().studyDayTimezone, 'Asia/Seoul');
    const beforeRecovery = trace.length; const recovered = await repository.deliverBatch(answerBatch); assert.equal(recovered.status, 'acknowledged');
    assert.deepEqual(trace.slice(beforeRecovery), ['read_language_legacy_evidence_events']);
    const exact = await client.rpc('read_language_legacy_evidence_events', { ...contextArgs, event_ids: [answer.event.eventId] }); assert.equal(exact.error, null); assert.deepEqual(exact.data.records, lostRecords);
    const complete = await repository.readPrefix(); assert.equal(complete.status, 'complete_authenticated_prefix'); assert.deepEqual(complete.snapshot.records.map(row => row.serverSequence), [1, 2]);
    assert.equal(repository.project(complete).pairs.find(pair => pair.itemId === task.itemId && pair.modality === 'meaning').stage, 'completed_once');
    assert.equal((await repository.store().readDelivery(repository.context(), answer.event.eventId)).status, 'acknowledged');
    report.checks.committedResponseLossIndependentReadRestartAndAcknowledgement = 'passed'; report.checks.completedOnceAndGapFreePrefix = 'passed';
    report.receiptDigest = sha(JSON.stringify(lostRecords));
    const replay = await client.rpc('append_language_legacy_evidence', { ...contextArgs, batch_id: answerBatch.batchId, source_slot: answerBatch.sourceSlotKey,
      expected_predecessor: answerBatch.expectedPredecessor, canonical_events: answerBatch.events.map(row => row.canonical) });
    assert.equal(replay.error, null); assert.deepEqual(replay.data.records, lostRecords); assert.equal(replay.data.context.highWater, 2);
    report.checks.actualPublicRpcExactReplay = 'passed';
    const anon = createClient(stack.apiUrl, stack.status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport } });
    const anonRead = await anon.rpc('read_language_legacy_evidence_context', contextArgs); assert.ok(anonRead.error);
    const otherRead = await other.client.rpc('read_language_legacy_evidence_context', contextArgs); assert.equal(otherRead.error?.message, 'legacy_auth_mismatch');
    for (const table of ['language_legacy_evidence_events', 'language_legacy_evidence_generations', 'language_legacy_evidence_manifests', 'language_legacy_evidence_manifest_tasks', 'language_legacy_evidence_enrollments']) {
      const read = await client.from(table).select('*').limit(1); assert.equal(read.error?.code, '42501');
    }
    const directInsert = await client.from('language_legacy_evidence_events').insert({ owner_id: owner }); assert.equal(directInsert.error?.code, '42501');
    const directDelete = await client.from('language_legacy_evidence_events').delete().eq('owner_id', owner); assert.equal(directDelete.error?.code, '42501');
    const privateRead = await client.schema('language_legacy_evidence_private').rpc('read_context', contextArgs); assert.ok(privateRead.error); assert.equal(privateRead.error.code, 'PGRST106');
    missingRpc = true; await assert.rejects(repository.readPrefix(), error => error.code === 'unavailable'); missingRpc = false;
    report.checks.anonOtherOwnerDirectDmlPrivateSchemaAndMissingRpc = 'passed';
    const resetId = randomUUID(), beforeRequiredReset = trace.length;
    missingStatus = true; await assert.rejects(resetApi.resetAppRecords('language', resetId, owner)); missingStatus = false;
    assert.equal(resetApi.fence().evidenceCleanup.status, 'pending');
    assert.ok(adapter.entries('events').some(([, row]) => row.generationId === original.generationId));
    await assert.rejects(runtime.acquireLanguageLegacyEvidenceRepository(registered.context, { studyDayTimezone: 'Asia/Seoul', mode: 'existing' }), error => error.code === 'stale_authority');
    const resetResult = await resetApi.resetAppRecords('language', resetId, owner);
    assert.equal(trace.slice(beforeRequiredReset).filter(name => name === 'reset_my_app_records').length, 1);
    assert.equal(resetApi.fence().evidenceCleanup.status, 'verified');
    await coordinator.resume(); const resetState = coordinator.getState(); assert.equal(resetState.status, 'ready');
    await assert.rejects(repository.readPrefix(), error => error.code === 'stale_authority'); repository.close();
    const beforeAcquire = trace.length; repository = await runtime.acquireLanguageLegacyEvidenceRepository(resetState.context, { studyDayTimezone: 'Asia/Seoul', mode: 'existing' });
    assert.equal(trace[beforeAcquire], 'read_language_legacy_evidence_status'); assert.notEqual(repository.serverContext().generationId, original.generationId);
    assert.equal(repository.localContinuity(), 'verified');
    for (const store of ['events', 'checkpoints', 'commits', 'delivery', 'batches', 'audioBindings', 'receipts', 'contexts', 'prefixes', 'admissions']) {
      assert.ok(adapter.entries(store).every(([, row]) => row.ownerId !== owner || row.generationId !== original.generationId), 'old generation survived cleanup');
    }
    assert.equal(adapter.entries('enrollmentIntents').filter(([, row]) => row.ownerId === owner).length, 0);
    assert.equal(adapter.entries('admissions').find(([, row]) => row.ownerId === owner)[1].kind, 'reset_carry');
    const staleEnrollment = await client.rpc('enroll_language_legacy_evidence_v1', { ...firstEnrollmentRequest, expected_marker: { present: true, value: resetResult.marker } });
    assert.equal(staleEnrollment.error?.message, 'legacy_enrollment_stale');
    const staleAppend = await client.rpc('append_language_legacy_evidence', { ...contextArgs, batch_id: answerBatch.batchId, source_slot: answerBatch.sourceSlotKey,
      expected_predecessor: answerBatch.expectedPredecessor, canonical_events: answerBatch.events.map(row => row.canonical) });
    assert.equal(staleAppend.error?.message, 'legacy_stale_generation');
    const zero = await repository.readPrefix(); assert.equal(zero.status, 'complete_authenticated_prefix'); assert.deepEqual(zero.snapshot.records, []);
    report.checks.requiredStatusOutagePendingReadFirstRetryCaptureDisabledCleanupAndContinuityCarry = 'passed';
    // Same-request completion must fence again while retaining current-generation work.
    const freshEvent = { ...event, eventId: randomUUID(), episodeId: randomUUID(), lessonSessionId: randomUUID(),
      generationId: repository.serverContext().generationId, occurredAt: repository.serverContext().serverTime };
    freshEvent.sourceSlotKey = makeSourceSlotKey(owner, freshEvent);
    const freshPresentation = await preparePresentation({ transitionId: randomUUID(), event: freshEvent, actualVisible: true, history: 'new_session', timingObserved: true }, repository.context(), LEGACY_EVIDENCE_CATALOGUE);
    await repository.store().commit(freshPresentation);
    const retainedEvents = adapter.entries('events'), retainedAdmission = adapter.entries('admissions');
    await resetApi.resetAppRecords('language', resetId, owner);
    assert.deepEqual(adapter.entries('events'), retainedEvents); assert.deepEqual(adapter.entries('admissions'), retainedAdmission);
    assert.equal(trace.slice(beforeRequiredReset).filter(name => name === 'reset_my_app_records').length, 1);
    assert.equal(resetApi.fence().evidenceCleanup.status, 'verified');
    report.checks.completedResetRetryPreservesCurrentGeneration = 'passed';
    repository.close(); await coordinator.resume(); const afterRetry = coordinator.getState(); assert.equal(afterRetry.status, 'ready');
    activeAdapter = createDeterministicIDBAdapter();
    repository = await runtime.acquireLanguageLegacyEvidenceRepository(afterRetry.context, { studyDayTimezone: 'Asia/Seoul', mode: 'existing' });
    assert.equal(repository.localContinuity(), 'unknown'); assert.throws(() => repository.store(), error => error.code === 'local_continuity_unknown');
    assert.equal((await repository.readPrefix()).status, 'complete_authenticated_prefix');
    assert.equal(activeAdapter.entries('admissions').length, 0);
    report.checks.evictedEnrolledStoreCannotRecoverCaptureAuthorityFromServerReads = 'passed';
    assert.equal(JSON.stringify(report).includes(RAW_ANSWER), false);
    report.checks.rawAnswerRemainsLocal = 'passed'; report.checks.onlyVerifiedLoopbackRequests = 'passed';
    report.rpcCounts = Object.fromEntries([...new Set(trace)].sort().map(name => [name, trace.filter(value => value === name).length]));
    report.status = 'passed'; return report;
  } catch (error) { diagnostics.failed(error); report.status = 'failed'; error.httpReport = report; throw error; }
  finally {
    await diagnostics.cleanup([
      { checkpoint: 'http_repository', run: () => repository?.close() },
      { checkpoint: 'http_coordinator', run: () => coordinator?.dispose() },
      { checkpoint: 'http_owner', run: () => { if (lease) revokeAuthenticatedStorageOwner(lease); } },
      { checkpoint: 'http_fixture', run: () => fixture?.restore() },
      { checkpoint: 'http_indexeddb', run: () => { if (previousIdb) Object.defineProperty(globalThis, 'indexedDB', previousIdb); else Reflect.deleteProperty(globalThis, 'indexedDB'); } },
      { checkpoint: 'http_accounts', run: async () => { if (fixtures) await fixtures.cleanup(); } },
    ]);
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length > 2) { console.error('The CI HTTP runner accepts no arguments.'); process.exitCode = 1; }
  else { const diagnostics = createLegacyEvidenceDiagnostics(); diagnostics.run('http', 'execute', () => runHttpHarness(diagnostics)).then(() => console.log('Real local HTTP repository checks passed; fake IndexedDB only.')).catch(() => { console.error('Legacy evidence HTTP gate failed; no credentials or request bodies are logged.'); process.exitCode = 1; }); }
}
