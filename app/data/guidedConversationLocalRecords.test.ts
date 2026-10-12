import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { GUIDED_CONVERSATION_PILOT } from '../../data/guidedConversationPilot.ts';
import { GUIDED_CONVERSATION_REMAINING } from '../../data/guidedConversationCatalog.ts';
import { canonicalJson, capacityUsage, CONVERSATION_LIMITS, encodeEnvelope, freezeGuidedSource, getConversationProgress, parseEnvelope, sourceRef, type ConversationDraft } from '../../lib/conversation-session/contracts.ts';
import { projectClosedConversationRecap } from '../../lib/conversation-session/recap.ts';
import { createLanguageSyncCoordinator } from './languageSyncCoordinator.ts';
import { ConversationLocalError, conversationLocalKey, planLanguageLocalParticipants, readConversationPartition } from './languageLocalParticipants.ts';
import { languageFixture, settle, marker } from '../../tests/helpers/languageFixture.ts';
import { STORAGE_PROTOCOL_KEY, readStorageSnapshot } from './storageTransaction.ts';
import { TIME, fillBudget } from '../../lib/conversation-session/fixtures.test-support.ts';
import * as api from './conversationLocalRecords.ts';

async function fixture(t: TestContext, ownerId = 'a') {
  const f = languageFixture(); t.after(f.restore); const lease = await f.owner(ownerId);
  let remote: Record<string, unknown> = {};
  const coordinator = createLanguageSyncCoordinator({ lease, storage: f.storage, onState() {}, transport: {
    async verifyOwner() { return true; }, async read() { return { state: remote, updatedAt: 'synthetic' }; },
    async insert(_owner, state) { remote = state; return true; }, async update(_owner, state) { remote = state; return true; },
  } }); t.after(coordinator.dispose); await coordinator.start();
  const context = () => { const value = coordinator.getState().context; assert.ok(value); return value; };
  const snapshot = () => api.readConversationSnapshot(context());
  const createScript = async (script: { readonly scriptId: string; readonly scriptRevision: string }) => api.runConversationEdit(api.captureConversationSession(snapshot(), { kind: 'guided', scriptId: script.scriptId, scriptRevision: script.scriptRevision }, 'Asia/Seoul'));
  const create = (index = 0) => createScript(GUIDED_CONVERSATION_PILOT[index]);
  const session = (id: string) => snapshot().envelope!.sessions.find(item => item.sessionId === id)!;
  const draft = (id: string, input: string, draftId: string, stepId = getConversationProgress(session(id))!.activeStepId!): ConversationDraft => ({
    draftId, revision: 1, input, savedAt: TIME, source: sourceRef(session(id).source, stepId), origin: { kind: 'typed', edited: false },
    exposure: { example: 'not-shown', reading: 'not-shown', meaning: 'not-shown', hint: 'not-shown' },
  });
  const save = async (id: string, value: ConversationDraft) => api.runConversationEdit(api.captureConversationDraft(snapshot(), id, value));
  const send = async (id: string, value: ConversationDraft) => { await save(id, value); const command = api.captureConversationAppend(snapshot(), id, value.draftId); await api.stageConversationIntent(command); await api.applyConversationIntent(command); return command; };
  const close = async (id: string) => { const intent = api.captureConversationClose(snapshot(), id); await api.stageConversationIntent(intent); await api.applyConversationIntent(intent); return intent; };
  return { ...f, lease, coordinator, context, snapshot, create, createScript, session, draft, save, send, close };
}

for (const [index, script] of GUIDED_CONVERSATION_PILOT.entries()) test(`G5 facade ${script.levelId} freezes each real step, explicit close and exact history`, async t => {
  const f = await fixture(t), created = await f.create(index), id = created.effect.sessionId;
  assert.equal(f.snapshot().envelope!.schemaVersion, 2); assert.equal(created.acknowledged, true);
  const intents: api.ConversationCommandIntent[] = [];
  for (const [ordinal, step] of script.steps.entries()) {
    assert.equal(getConversationProgress(f.session(id))!.activeStepId, step.id);
    const input = ordinal === 0 ? step.learnerExample.reading : ` exact unassessed 한국어\n${ordinal} `;
    intents.push(await f.send(id, f.draft(id, input, `draft-${ordinal}`)));
    assert.equal(f.session(id).turns.length, ordinal + 1); assert.equal(f.session(id).drafts.length, 0);
    assert.equal(f.session(id).closed, null);
    assert.equal(f.session(id).turns[ordinal].draft.input, input);
    const emission = f.session(id).turns[ordinal].emission;
    assert.equal(emission.reply, step.fixedReply.japanese);
    assert.equal('kind' in emission && emission.kind, 'guided-fixed-emission');
  }
  assert.equal(getConversationProgress(f.session(id))!.activeStepId, null);
  assert.throws(() => api.captureConversationAppend(f.snapshot(), id, 'draft-0'), ConversationLocalError);
  const close = await f.close(id), frozen = canonicalJson(f.session(id));
  for (const intent of [...intents, close]) {
    assert.equal((await api.stageConversationIntent(intent)).effect.kind, 'applied');
    assert.equal((await api.applyConversationIntent(intent)).effect.kind, 'applied');
    assert.equal(api.reconcileConversationIntent(intent, f.context()).status, 'applied');
  }
  assert.equal(canonicalJson(f.session(id)), frozen);
  const recap = projectClosedConversationRecap(f.snapshot().envelope, id);
  assert.equal(recap.status, 'ready'); assert.ok('progress' in recap);
  assert.equal(recap.progress.coverage, 'all-steps-submitted'); assert.equal(recap.progress.totalStepCount, script.steps.length);
  assert.equal(recap.assessmentCoverage.assessedTurns, 0); assert.deepEqual(recap.correctableExpressions.claims, []);
  assert.deepEqual(recap.recordedTurns.map(turn => turn.emitted), f.session(id).turns.map(turn => turn.emission));
  f.coordinator.pause(); await f.coordinator.resume(); assert.equal(canonicalJson(f.session(id)), frozen);
});

for (const index of [1, 2]) test(`G5 facade two earlier-step lanes in ${index} preserve partial close and separate restart`, async t => {
  const f = await fixture(t), id = (await f.create(index)).effect.sessionId, script = GUIDED_CONVERSATION_PILOT[index];
  const retained: ConversationDraft[] = [];
  for (const [ordinal, step] of script.steps.slice(0, 2).entries()) {
    await f.send(id, f.draft(id, step.learnerExample.japanese, `sent-${ordinal}`));
    const value = f.draft(id, ` unsent older ${ordinal}\n `, `retained-${ordinal}`, step.id); retained.push(value); await f.save(id, value);
  }
  assert.deepEqual(f.session(id).drafts, retained);
  assert.throws(() => api.captureConversationDraft(f.snapshot(), id, f.draft(id, 'third input', 'third')), error => error instanceof ConversationLocalError && error.code === 'capacity-exceeded');
  await f.close(id); assert.deepEqual(f.session(id).drafts, retained);
  const recap = projectClosedConversationRecap(f.snapshot().envelope, id); assert.equal(recap.status, 'ready'); assert.ok('progress' in recap);
  assert.equal(recap.progress.coverage, 'partial'); assert.equal(recap.progress.submittedStepCount, 2); assert.deepEqual(recap.progress.unsubmittedStepIds, [script.steps[2]!.id]);
  assert.deepEqual(recap.unsentDrafts.map(item => item.source.stepId), script.steps.slice(0, 2).map(step => step.id));
  const next = (await f.create(index)).effect.sessionId; assert.notEqual(next, id); assert.equal(getConversationProgress(f.session(next))!.activeStepId, script.steps[0].id);
});

test('G5 explicit upgrade preserves exact v1 peer writes, owner generation enrollment and v2 on later legacy creation', async t => {
  const f = await fixture(t), original = await api.runConversationEdit(api.captureConversationSession(f.snapshot(), 'legacy-cafe', 'UTC'));
  const before = f.snapshot().envelope!, source = f.snapshot(), script = GUIDED_CONVERSATION_PILOT[0];
  const captured = api.captureConversationSession(source, { kind: 'guided', scriptId: script.scriptId, scriptRevision: script.scriptRevision }, 'UTC');
  assert.equal(f.snapshot().envelope!.schemaVersion, 1);
  const peer = await api.runConversationEdit(api.captureConversationSession(f.snapshot(), 'legacy-work', 'UTC'));
  const fresh = f.snapshot().envelope!, oldBytes = fresh.sessions.map(canonicalJson);
  await api.runConversationEdit(captured); const migrated = f.snapshot().envelope!;
  assert.equal(migrated.schemaVersion, 2); assert.equal(migrated.generationId, before.generationId); assert.equal(migrated.ownerId, before.ownerId);
  assert.equal(migrated.marker, before.marker); assert.deepEqual(migrated.enrollment, before.enrollment); assert.deepEqual(migrated.tombstones, before.tombstones);
  assert.deepEqual(migrated.sessions.slice(0, 2).map(canonicalJson), oldBytes); assert.deepEqual(migrated.sessions.slice(0, 2).map(item => item.sessionId), [original.effect.sessionId, peer.effect.sessionId]);
  await api.runConversationEdit(api.captureConversationSession(f.snapshot(), 'legacy-daily', 'UTC')); assert.equal(f.snapshot().envelope!.schemaVersion, 2);
});

test('G5 concurrent guided create transforms a peer v2 upgrade without duplicate intent or generation replacement', async t => {
  const f = await fixture(t); await api.runConversationEdit(api.captureConversationSession(f.snapshot(), 'legacy-cafe', 'UTC'));
  const source = f.snapshot(), captures = GUIDED_CONVERSATION_PILOT.slice(0, 2).map(script => api.captureConversationSession(source, { kind: 'guided', scriptId: script.scriptId, scriptRevision: script.scriptRevision }, 'UTC'));
  await api.runConversationEdit(captures[0]); const first = canonicalJson(f.snapshot().envelope!.sessions[1]); await api.runConversationEdit(captures[1]);
  assert.equal(f.snapshot().envelope!.sessions.length, 3); assert.equal(canonicalJson(f.snapshot().envelope!.sessions[1]), first);
});

for (const bad of [ { kind: 'guided', scriptId: 'missing', scriptRevision: 'missing' }, { kind: 'guided', scriptId: 'guided-convenience-store-beginner', scriptRevision: 'wrong' }, { kind: 'guided', scriptId: GUIDED_CONVERSATION_PILOT[0].scriptId, scriptRevision: GUIDED_CONVERSATION_PILOT[0].scriptRevision, extra: true } ]) test(`G5 invalid exact selection cannot enroll: ${JSON.stringify(bad)}`, async t => {
  const f = await fixture(t); assert.throws(() => api.captureConversationSession(f.snapshot(), bad as api.ConversationSelection, 'UTC'), ConversationLocalError); assert.equal(f.snapshot().envelope, null);
});

for (const mode of ['prepared', 'replacement', 'marker'] as const) test(`G5 migration ${mode} failure preserves complete original v1 bytes`, async t => {
  const f = await fixture(t); await api.runConversationEdit(api.captureConversationSession(f.snapshot(), 'legacy-cafe', 'UTC'));
  const key = conversationLocalKey('a'), before = f.storage.getItem(key), set = f.storage.setItem; let failed = false;
  f.storage.setItem = (name, value) => { if (!failed && (mode === 'prepared' ? name === STORAGE_PROTOCOL_KEY && value.includes('prepared') : mode === 'replacement' ? name === key : name === STORAGE_PROTOCOL_KEY && value.includes('committed'))) { failed = true; throw new Error('synthetic quota'); } set(name, value); };
  await assert.rejects(f.create(), ConversationLocalError); f.storage.setItem = set;
  assert.equal(f.storage.getItem(key), before); assert.equal(f.snapshot().envelope!.schemaVersion, 1);
});

test('G5 uncertain creation requires exact captured session and cannot retry migration with new identity', async t => {
  const f = await fixture(t); await api.runConversationEdit(api.captureConversationSession(f.snapshot(), 'legacy-cafe', 'UTC'));
  const script = GUIDED_CONVERSATION_PILOT[0], intent = api.captureConversationSession(f.snapshot(), { kind: 'guided', scriptId: script.scriptId, scriptRevision: script.scriptRevision }, 'UTC');
  const set = f.storage.setItem; let failed = false;
  f.storage.setItem = (name, value) => { set(name, value); if (!failed && name === STORAGE_PROTOCOL_KEY && value.includes('committed')) { failed = true; throw new Error('uncertain committed marker'); } };
  await assert.rejects(api.runConversationEdit(intent)); f.storage.setItem = set;
  const observed = api.reconcileConversationEdit(intent, f.context()); assert.equal(observed.status, 'observed');
  assert.equal(f.snapshot().envelope!.schemaVersion, 2); assert.equal(f.snapshot().envelope!.sessions.length, 2);
  await assert.rejects(api.runConversationEdit(intent), error => error instanceof ConversationLocalError && error.outcome === 'unknown');
  const id = observed.status === 'observed' ? observed.effect.sessionId : '';
  await f.save(id, f.draft(id, 'peer altered target', 'peer-draft'));
  assert.equal(api.reconcileConversationEdit(intent, f.context()).status, 'unresolved');
});

for (const reason of ['explicit-reset', 'remote-reset', 'observation-catch-up'] as const) test(`G5 ${reason} keeps v2 replacement and exact causal receipt`, async t => {
  const f = await fixture(t); await f.create(); const current = f.snapshot().envelope!, mark = marker();
  const target = { ownerId: 'a', marker: mark, reason, replacement: { generationId: 'replacement-generation', enrollmentId: 'replacement-enrollment', createdAt: TIME }, observation: { ...f.snapshot().observation, marker: mark } };
  const plan = planLanguageLocalParticipants(readStorageSnapshot(f.storage), target), key = conversationLocalKey('a'), reset = readConversationPartition(plan[key], 'a')!;
  assert.equal(reset.schemaVersion, 2); assert.equal(reset.generationId, 'replacement-generation'); assert.deepEqual(reset.sessions, []);
  assert.equal(reset.enrollment.kind, 'reset-replacement'); if (reset.enrollment.kind !== 'reset-replacement') assert.fail();
  assert.equal(reset.enrollment.previousGenerationId, current.generationId); assert.equal(reset.enrollment.previousMarker, current.marker); assert.equal(reset.enrollment.reason, reason);
  assert.deepEqual(reset.enrollment.observation, target.observation);
  assert.deepEqual(planLanguageLocalParticipants({ getItem: () => plan[key] }, target), {});
  assert.deepEqual(planLanguageLocalParticipants({ getItem: () => null }, target), {});
  assert.throws(() => planLanguageLocalParticipants({ getItem: () => canonicalJson({ ...current, schemaVersion: 9 }) }, target), error => error instanceof ConversationLocalError && error.code === 'unsupported-partition');
});

test('G5 unassessed close before sending preserves blank storage lane without listing a blank expression', async t => {
  const f = await fixture(t), id = (await f.create()).effect.sessionId; await f.save(id, f.draft(id, '  ', 'empty')); await f.close(id);
  const recap = projectClosedConversationRecap(f.snapshot().envelope, id); assert.equal(recap.status, 'ready'); assert.ok('progress' in recap);
  assert.equal(recap.progress.coverage, 'none'); assert.equal(recap.unsentDraftCount, 0); assert.deepEqual(recap.unsentDrafts, []); assert.equal(f.session(id).drafts.length, 1);
});

test('G5 close observation failure never fabricates current acknowledgement or changes its source policy', async t => {
  const f = await fixture(t), id = (await f.create()).effect.sessionId; await settle();
  const intent = api.captureConversationClose(f.snapshot(), id); await api.stageConversationIntent(intent);
  const queue = globalThis.queueMicrotask; globalThis.queueMicrotask = () => { throw new Error('PRIVATE_GUIDED_NOTICE_CANARY'); };
  let result: api.ConversationWriteResult; try { result = await api.applyConversationIntent(intent); } finally { globalThis.queueMicrotask = queue; }
  assert.equal(result.acknowledged, false); assert.equal(result.source, null); assert.equal(api.reconcileConversationIntent(intent, f.context()).status, 'applied');
  assert.equal(f.session(id).closed!.summaryPolicyVersion, 'guided-conversation-recap-v1');
});

for (const terminal of ['apply', 'cancel'] as const) test(`G5 real facade initial close ${terminal} fits exact logical edge after lane saturation`, async t => {
  const f = await fixture(t), id = (await f.create(1)).effect.sessionId, script = GUIDED_CONVERSATION_PILOT[1];
  for (const [i, step] of script.steps.slice(0, 2).entries()) {
    await f.send(id, f.draft(id, step.learnerExample.japanese, `submitted-${i}`));
    await f.save(id, f.draft(id, `retained ${i}`, `old-${i}`, step.id));
  }
  const edge = fillBudget(f.snapshot().envelope!); f.values.set(conversationLocalKey('a'), canonicalJson(edge));
  assert.equal(capacityUsage(f.snapshot().envelope!).admittedCodeUnits, CONVERSATION_LIMITS.envelopeCodeUnits);
  const retained = canonicalJson(f.session(id).drafts), close = api.captureConversationClose(f.snapshot(), id);
  await api.stageConversationIntent(close);
  if (terminal === 'apply') { await api.applyConversationIntent(close); assert.equal(f.session(id).closed?.boundaryId, close.command.kind === 'close' ? close.command.boundary.boundaryId : null); }
  else {
    await api.runConversationEdit(api.captureConversationCancellation(f.snapshot(), id, close.command.operationId)); assert.equal(f.session(id).closed, null);
    // Spent guarantee is not renewed: another unrelated write can fill actual room.
    const afterCancel = f.snapshot().envelope!, refilled = fillBudget(afterCancel);
    for (const tombstone of refilled.tombstones.slice(afterCancel.tombstones.length)) for (const field of ['deletionId', 'tombstoneId', 'sessionId'] as const) tombstone[field] = tombstone[field].replace('-fill-', '-next-');
    f.values.set(conversationLocalKey('a'), canonicalJson(refilled));
    assert.throws(() => api.captureConversationClose(f.snapshot(), id), error => error instanceof ConversationLocalError && error.code === 'capacity-exceeded');
  }
  assert.equal(canonicalJson(f.session(id).drafts), retained);
});

for (const terminal of ['apply', 'cancel'] as const) test(`G5 facade pending append ${terminal} cannot consume initial close reserve`, async t => {
  const f = await fixture(t), id = (await f.create()).effect.sessionId;
  await f.save(id, f.draft(id, 'unmatched pending canary', 'pending'));
  const append = api.captureConversationAppend(f.snapshot(), id, 'pending'); await api.stageConversationIntent(append);
  f.values.set(conversationLocalKey('a'), canonicalJson(fillBudget(f.snapshot().envelope!)));
  if (terminal === 'apply') await api.applyConversationIntent(append);
  else await api.runConversationEdit(api.captureConversationCancellation(f.snapshot(), id, append.command.operationId));
  await f.close(id); assert.ok(f.session(id).closed); assert.equal(f.session(id).turns.length, terminal === 'apply' ? 1 : 0);
});

/** Read the registered participant again at every boundary, not a model-only clone. */
function assertRoundTrip(f: Awaited<ReturnType<typeof fixture>>) {
  const snapshot = f.snapshot(), encoded = encodeEnvelope(snapshot.envelope);
  assert.equal(encoded.status, 'encoded'); if (encoded.status !== 'encoded') assert.fail();
  const parsed = parseEnvelope(encoded.raw); assert.equal(parsed.status, 'valid'); if (parsed.status !== 'valid') assert.fail();
  assert.deepEqual(encodeEnvelope(parsed.envelope), encoded);
  assert.equal(f.storage.getItem(conversationLocalKey(f.lease.userId)), encoded.raw);
  assert.equal(canonicalJson(readConversationPartition(encoded.raw, f.lease.userId)), encoded.raw);
  assert.equal(canonicalJson(f.snapshot().envelope), encoded.raw);
  return encoded.raw;
}

for (const script of GUIDED_CONVERSATION_REMAINING) {
  test(`catalogue facade ${script.scriptId}: exact create/save/reload/pending/cancel/apply/close/pause/recap`, async t => {
    const f = await fixture(t, `synthetic-${script.scriptId}`), key = conversationLocalKey(f.lease.userId);
    assert.equal(f.snapshot().envelope, null); assert.equal(f.storage.getItem(key), null);
    // Exact-source lookup and capture are read-only until the explicit write.
    const selected = freezeGuidedSource(script.scriptId, script.scriptRevision)!;
    assert.deepEqual(selected.content, script); assert.equal(f.storage.getItem(key), null);
    const create = api.captureConversationSession(f.snapshot(), { kind: 'guided', scriptId: script.scriptId, scriptRevision: script.scriptRevision }, 'Asia/Seoul');
    assert.equal(f.storage.getItem(key), null);
    const created = await api.runConversationEdit(create), id = created.effect.sessionId;
    assert.equal(created.acknowledged, true); assert.equal(f.snapshot().envelope!.schemaVersion, 2);
    assert.deepEqual(f.session(id).source, selected); assertRoundTrip(f);
    const completed: api.ConversationCommandIntent[] = [];
    for (const [ordinal, step] of script.steps.entries()) {
      const input = ordinal === 0 ? step.learnerExample.japanese : ordinal === 1 ? step.learnerExample.reading : `  UNASSESSED_${script.contextId}\n한국어 e\u0301 😀  `;
      const draft = f.draft(id, input, `catalogue-draft-${ordinal}`);
      assert.equal(getConversationProgress(f.session(id))!.activeStepId, step.id);
      assert.equal((await f.save(id, draft)).acknowledged, true); assertRoundTrip(f);
      assert.deepEqual(f.session(id).drafts, [draft]);
      const saved = canonicalJson(f.session(id)); f.coordinator.pause(); await f.coordinator.resume();
      assert.equal(canonicalJson(f.session(id)), saved);
      const cancelled = api.captureConversationAppend(f.snapshot(), id, draft.draftId);
      await api.stageConversationIntent(cancelled); assertRoundTrip(f);
      assert.equal(f.session(id).turns.length, ordinal); assert.equal(getConversationProgress(f.session(id))!.activeStepId, step.id);
      assert.equal(api.reconcileConversationOperation(f.snapshot(), id, cancelled.command.operationId).status, 'pending');
      // Reload a persisted pending operation under a fresh coordinator authority.
      const pending = canonicalJson(f.session(id)); f.coordinator.pause(); await f.coordinator.resume();
      assert.equal(canonicalJson(f.session(id)), pending);
      assert.equal(api.reconcileConversationOperation(f.snapshot(), id, cancelled.command.operationId).status, 'pending');
      await api.runConversationEdit(api.captureConversationCancellation(f.snapshot(), id, cancelled.command.operationId));
      assertRoundTrip(f); assert.equal(f.session(id).turns.length, ordinal); assert.deepEqual(f.session(id).drafts, [draft]);
      assert.equal(api.reconcileConversationOperation(f.snapshot(), id, cancelled.command.operationId).status, 'cancelled');
      assert.equal(getConversationProgress(f.session(id))!.activeStepId, step.id);
      const append = api.captureConversationAppend(f.snapshot(), id, draft.draftId);
      await api.stageConversationIntent(append); const staged = assertRoundTrip(f);
      await api.stageConversationIntent(append); assert.equal(assertRoundTrip(f), staged);
      assert.equal(f.session(id).turns.length, ordinal);
      await api.applyConversationIntent(append); const applied = assertRoundTrip(f);
      await api.applyConversationIntent(append); await api.stageConversationIntent(append);
      assert.equal(assertRoundTrip(f), applied); completed.push(append);
      assert.equal(api.reconcileConversationIntent(append, f.context()).status, 'applied');
      const turn = f.session(id).turns[ordinal], emission = turn.emission;
      assert.ok('kind' in emission); assert.equal(emission.kind, 'guided-fixed-emission');
      assert.equal(emission.builderPolicy, 'guided-fixed-exchange-v2');
      assert.equal(emission.reply, step.fixedReply.japanese); assert.equal(emission.replyReading, step.fixedReply.reading);
      assert.equal(emission.replyMeaningKo, step.fixedReply.meaningKo); assert.equal(emission.replyKoreanPronunciation, step.fixedReply.koreanPronunciation);
      assert.match(emission.explanation, /상대방 응답/); assert.doesNotMatch(emission.explanation, /점원/);
      assert.equal(emission.branch, ordinal < 2 ? 'script-response' : 'sample-fallback-with-response');
      assert.deepEqual(emission.exampleFallback, ordinal < 2 ? null : step.learnerExample);
      assert.deepEqual([emission.correction, emission.correctionReading, emission.correctionKoreanPronunciation], ['', '', '']);
      assert.equal(emission.progression.fromStepId, step.id); assert.equal(emission.progression.toStepId, script.steps[ordinal + 1]?.id ?? null);
      assert.deepEqual(turn.draft, draft); assert.deepEqual(turn.draft.source, sourceRef(selected, step.id));
      assert.equal(turn.sampleMatch.assessment, 'unavailable'); assert.equal(f.session(id).turns.length, ordinal + 1);
      assert.equal(f.session(id).closed, null);
    }
    assert.equal(getConversationProgress(f.session(id))!.activeStepId, null);
    const unsent = f.draft(id, ` PRIVATE_UNSENT_${script.scriptId}\n `, 'catalogue-unsent', script.steps.at(-1)!.id);
    await f.save(id, unsent);
    const cancelledClose = api.captureConversationClose(f.snapshot(), id); await api.stageConversationIntent(cancelledClose); assertRoundTrip(f);
    await api.runConversationEdit(api.captureConversationCancellation(f.snapshot(), id, cancelledClose.command.operationId)); assertRoundTrip(f);
    assert.equal(f.session(id).closed, null); assert.deepEqual(f.session(id).drafts, [unsent]);
    assert.equal((await api.stageConversationIntent(cancelledClose)).effect.kind, 'cancelled');
    assert.equal((await api.applyConversationIntent(cancelledClose)).effect.kind, 'cancelled');
    const close = await f.close(id), frozen = canonicalJson(f.session(id)); assertRoundTrip(f);
    assert.equal((await api.stageConversationIntent(close)).effect.kind, 'applied');
    assert.equal((await api.applyConversationIntent(close)).effect.kind, 'applied');
    for (const intent of completed) assert.equal(api.reconcileConversationOperation(f.snapshot(), id, intent.command.operationId).status, 'applied');
    f.coordinator.pause(); await f.coordinator.resume(); assert.equal(canonicalJson(f.session(id)), frozen); assertRoundTrip(f);
    const recap = projectClosedConversationRecap(f.snapshot().envelope, id);
    assert.equal(recap.status, 'ready'); assert.ok('progress' in recap);
    assert.equal(recap.progress.coverage, 'all-steps-submitted'); assert.equal(recap.progress.submittedStepCount, script.steps.length);
    assert.deepEqual(recap.progress.submittedStepIds, script.steps.map(step => step.id)); assert.deepEqual(recap.progress.unsubmittedStepIds, []);
    assert.equal(recap.provenance.source.contextId, script.contextId); assert.equal(recap.provenance.source.levelId, script.levelId);
    assert.deepEqual(recap.provenance.source, selected); assert.equal(recap.assessmentCoverage.status, 'unavailable');
    assert.equal(recap.assessmentCoverage.assessedTurns, 0); assert.deepEqual(recap.correctableExpressions.claims, []);
    assert.deepEqual(recap.wellUsedExpressions.claims, []); assert.equal(recap.unsentDraftCount, 1);
    assert.equal(recap.unsentDrafts[0].input, unsent.input); assert.deepEqual(recap.unsentDrafts[0].source, unsent.source);
    assert.deepEqual(recap.recordedTurns.map(turn => turn.emitted), f.session(id).turns.map(turn => turn.emission));
  });
  for (let prefix = 0; prefix <= script.steps.length; prefix++) test(`catalogue facade ${script.scriptId}: independent explicit close at prefix ${prefix}`, async t => {
    const f = await fixture(t, `prefix-${prefix}-${script.scriptId}`), id = (await f.createScript(script)).effect.sessionId;
    for (const [ordinal, step] of script.steps.slice(0, prefix).entries()) {
      await f.send(id, f.draft(id, step.learnerExample.japanese, `prefix-draft-${ordinal}`)); assertRoundTrip(f);
    }
    const step = script.steps[Math.min(prefix, script.steps.length - 1)];
    const unsent = f.draft(id, `unsent-prefix-${prefix}`, 'prefix-unsent', step.id); await f.save(id, unsent);
    const close = api.captureConversationClose(f.snapshot(), id); await api.stageConversationIntent(close); assertRoundTrip(f);
    assert.equal(f.session(id).closed, null); await api.applyConversationIntent(close); const raw = assertRoundTrip(f);
    f.coordinator.pause(); await f.coordinator.resume(); assert.equal(assertRoundTrip(f), raw);
    const recap = projectClosedConversationRecap(f.snapshot().envelope, id); assert.equal(recap.status, 'ready'); assert.ok('progress' in recap);
    assert.equal(recap.progress.coverage, prefix === 0 ? 'none' : prefix === script.steps.length ? 'all-steps-submitted' : 'partial');
    assert.deepEqual(recap.progress.submittedStepIds, script.steps.slice(0, prefix).map(item => item.id));
    assert.deepEqual(recap.progress.unsubmittedStepIds, script.steps.slice(prefix).map(item => item.id));
    assert.equal(recap.recordedTurns.length, prefix); assert.equal(recap.assessmentCoverage.assessedTurns, 0);
    assert.equal(recap.unsentDraftCount, 1); assert.equal(recap.unsentDrafts[0].input, unsent.input);
  });
}

test('catalogue facade mixed legacy/pilot/new sessions preserve exact source, generation and pending bytes across new creation', async t => {
  const f = await fixture(t), legacy = await api.runConversationEdit(api.captureConversationSession(f.snapshot(), 'legacy-cafe', 'UTC'));
  const original = f.snapshot().envelope!, legacyBytes = canonicalJson(f.session(legacy.effect.sessionId));
  const pilotId = (await f.create(1)).effect.sessionId;
  await f.save(pilotId, f.draft(pilotId, 'PRIVATE_MIXED_PILOT_PENDING', 'mixed-pilot-draft'));
  const pilotPending = api.captureConversationAppend(f.snapshot(), pilotId, 'mixed-pilot-draft'); await api.stageConversationIntent(pilotPending);
  const pilotBytes = canonicalJson(f.session(pilotId));
  const company = GUIDED_CONVERSATION_REMAINING.find(script => script.scriptId === 'guided-company-mechanical-design-intermediate')!;
  const newId = (await f.createScript(company)).effect.sessionId;
  await f.save(newId, f.draft(newId, 'PRIVATE_MIXED_NEW_PENDING', 'mixed-new-draft'));
  const newPending = api.captureConversationAppend(f.snapshot(), newId, 'mixed-new-draft'); await api.stageConversationIntent(newPending);
  const current = f.snapshot().envelope!;
  assert.equal(current.schemaVersion, 2); assert.equal(current.ownerId, original.ownerId); assert.equal(current.generationId, original.generationId);
  assert.equal(current.marker, original.marker); assert.deepEqual(current.enrollment, original.enrollment);
  assert.equal(canonicalJson(f.session(legacy.effect.sessionId)), legacyBytes); assert.equal(canonicalJson(f.session(pilotId)), pilotBytes);
  const raw = assertRoundTrip(f); f.coordinator.pause(); await f.coordinator.resume(); assert.equal(assertRoundTrip(f), raw);
  for (const intent of [pilotPending, newPending]) assert.equal(api.reconcileConversationOperation(f.snapshot(), intent.command.sessionId, intent.command.operationId).status, 'pending');
  const stale = api.captureConversationSession(f.snapshot(), 'legacy-work', 'UTC');
  await f.owner('synthetic-other-catalogue-owner'); await assert.rejects(api.runConversationEdit(stale), ConversationLocalError);
  assert.equal(f.storage.getItem(conversationLocalKey('a')), raw); assert.equal(f.storage.getItem(conversationLocalKey('synthetic-other-catalogue-owner')), null);
});

test('catalogue facade same-level cross-context source cannot authorize another session draft or rename captured creation', async t => {
  const f = await fixture(t), restaurant = GUIDED_CONVERSATION_REMAINING.find(script => script.scriptId === 'guided-restaurant-beginner')!, company = GUIDED_CONVERSATION_REMAINING.find(script => script.scriptId === 'guided-company-general-beginner')!;
  const restaurantId = (await f.createScript(restaurant)).effect.sessionId;
  const captured = api.captureConversationSession(f.snapshot(), { kind: 'guided', scriptId: company.scriptId, scriptRevision: company.scriptRevision }, 'UTC');
  await f.save(restaurantId, f.draft(restaurantId, ' restaurant-only raw\n ', 'restaurant-only'));
  const companyId = (await api.runConversationEdit(captured)).effect.sessionId;
  assert.deepEqual(f.session(companyId).source, freezeGuidedSource(company.scriptId, company.scriptRevision));
  const wrong = { ...f.draft(companyId, 'cross-context canary', 'wrong-context'), source: f.session(restaurantId).drafts[0].source };
  const before = assertRoundTrip(f); assert.throws(() => api.captureConversationDraft(f.snapshot(), companyId, wrong), ConversationLocalError);
  assert.equal(assertRoundTrip(f), before); assert.equal(f.session(restaurantId).drafts[0].input, ' restaurant-only raw\n ');
});

for (const scriptId of ['guided-restaurant-beginner', 'guided-company-mechanical-design-intermediate']) {
  for (const terminal of ['apply', 'cancel'] as const) test(`catalogue facade ${scriptId}: saturated new-source initial close ${terminal} at exact capacity`, async t => {
    const script = GUIDED_CONVERSATION_REMAINING.find(item => item.scriptId === scriptId)!, f = await fixture(t), id = (await f.createScript(script)).effect.sessionId;
    for (const [ordinal, step] of script.steps.slice(0, 2).entries()) {
      await f.send(id, f.draft(id, step.learnerExample.japanese, `cap-submitted-${ordinal}`));
      await f.save(id, f.draft(id, ` escaped retained ${ordinal}\n\u0000\\\" `, `cap-retained-${ordinal}`, step.id));
    }
    const lanes = canonicalJson(f.session(id).drafts);
    f.values.set(conversationLocalKey('a'), canonicalJson(fillBudget(f.snapshot().envelope!)));
    assert.equal(capacityUsage(f.snapshot().envelope!).admittedCodeUnits, CONVERSATION_LIMITS.envelopeCodeUnits);
    const close = api.captureConversationClose(f.snapshot(), id); await api.stageConversationIntent(close); assertRoundTrip(f);
    if (terminal === 'apply') { await api.applyConversationIntent(close); assert.ok(f.session(id).closed); }
    else {
      await api.runConversationEdit(api.captureConversationCancellation(f.snapshot(), id, close.command.operationId));
      assert.equal(f.session(id).closed, null);
      const cancelled = f.snapshot().envelope!, edge = fillBudget(cancelled);
      for (const item of edge.tombstones.slice(cancelled.tombstones.length)) for (const field of ['deletionId', 'tombstoneId', 'sessionId'] as const) item[field] = item[field].replace('-fill-', '-next-');
      f.values.set(conversationLocalKey('a'), canonicalJson(edge));
      assert.throws(() => api.captureConversationClose(f.snapshot(), id), error => error instanceof ConversationLocalError && error.code === 'capacity-exceeded');
    }
    assertRoundTrip(f); assert.equal(canonicalJson(f.session(id).drafts), lanes);
    assert.equal(api.reconcileConversationIntent(close, f.context()).status, terminal === 'apply' ? 'applied' : 'cancelled');
  });
  for (const terminal of ['apply', 'cancel'] as const) test(`catalogue facade ${scriptId}: escaped pending append ${terminal} preserves the reserved initial close`, async t => {
    const script = GUIDED_CONVERSATION_REMAINING.find(item => item.scriptId === scriptId)!, f = await fixture(t), id = (await f.createScript(script)).effect.sessionId;
    const input = '\u0000\\"😀'.repeat(1000), draft = f.draft(id, input, 'escaped-pending'); await f.save(id, draft);
    const append = api.captureConversationAppend(f.snapshot(), id, draft.draftId); await api.stageConversationIntent(append);
    f.values.set(conversationLocalKey('a'), canonicalJson(fillBudget(f.snapshot().envelope!)));
    assert.equal(capacityUsage(f.snapshot().envelope!).admittedCodeUnits, CONVERSATION_LIMITS.envelopeCodeUnits);
    if (terminal === 'apply') await api.applyConversationIntent(append);
    else await api.runConversationEdit(api.captureConversationCancellation(f.snapshot(), id, append.command.operationId));
    await f.close(id); assertRoundTrip(f); assert.ok(f.session(id).closed);
    assert.equal(f.session(id).turns.length, terminal === 'apply' ? 1 : 0);
    if (terminal === 'apply') assert.equal(f.session(id).turns[0].draft.input, input);
    else assert.deepEqual(f.session(id).drafts, [draft]);
  });
}

for (const phase of ['create', 'stage', 'apply', 'cancel', 'close'] as const) test(`catalogue facade new source ${phase} lost durable acknowledgement reconciles exact outcome once`, async t => {
  const f = await fixture(t), script = GUIDED_CONVERSATION_REMAINING.find(item => item.scriptId === 'guided-company-mechanical-design-intermediate')!;
  let id = '', edit: api.ConversationEditIntent | undefined, command: api.ConversationCommandIntent | undefined;
  if (phase === 'create') edit = api.captureConversationSession(f.snapshot(), { kind: 'guided', scriptId: script.scriptId, scriptRevision: script.scriptRevision }, 'UTC');
  else {
    id = (await f.createScript(script)).effect.sessionId;
    if (phase === 'close') { command = api.captureConversationClose(f.snapshot(), id); await api.stageConversationIntent(command); }
    else {
      await f.save(id, f.draft(id, 'PRIVATE_NEW_LOST_ACK\n한국어', 'lost-ack-draft'));
      command = api.captureConversationAppend(f.snapshot(), id, 'lost-ack-draft');
      if (phase !== 'stage') await api.stageConversationIntent(command);
      if (phase === 'cancel') edit = api.captureConversationCancellation(f.snapshot(), id, command.command.operationId);
    }
  }
  const set = f.storage.setItem; let failed = false;
  f.storage.setItem = (name, value) => { set(name, value); if (!failed && name === STORAGE_PROTOCOL_KEY && value.includes('committed')) { failed = true; throw new Error('PRIVATE_NEW_DURABLE_ACK_ERROR'); } };
  const run = () => edit ? api.runConversationEdit(edit) : phase === 'stage' ? api.stageConversationIntent(command!) : api.applyConversationIntent(command!);
  await assert.rejects(run(), error => error instanceof ConversationLocalError && error.outcome === 'unknown'); f.storage.setItem = set;
  assert.equal(failed, true); const raw = assertRoundTrip(f);
  if (edit) {
    const read = api.reconcileConversationEdit(edit, f.context()); assert.equal(read.status, 'observed');
    if (read.status === 'observed') id = read.effect.sessionId;
  }
  if (command) assert.equal(api.reconcileConversationOperation(f.snapshot(), id, command.command.operationId).status, phase === 'stage' ? 'pending' : phase === 'cancel' ? 'cancelled' : 'applied');
  assert.equal(f.snapshot().envelope!.sessions.length, 1); assert.deepEqual(f.session(id).source, freezeGuidedSource(script.scriptId, script.scriptRevision));
  assert.equal(f.session(id).turns.length, phase === 'apply' ? 1 : 0); assert.equal(Boolean(f.session(id).closed), phase === 'close');
  await assert.rejects(run(), error => error instanceof ConversationLocalError && error.outcome === 'unknown'); assert.equal(assertRoundTrip(f), raw);
});
