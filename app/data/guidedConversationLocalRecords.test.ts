import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { GUIDED_CONVERSATION_PILOT } from '../../data/guidedConversationPilot.ts';
import { canonicalJson, capacityUsage, CONVERSATION_LIMITS, getConversationProgress, sourceRef, type ConversationDraft } from '../../lib/conversation-session/contracts.ts';
import { projectClosedConversationRecap } from '../../lib/conversation-session/recap.ts';
import { createLanguageSyncCoordinator } from './languageSyncCoordinator.ts';
import { ConversationLocalError, conversationLocalKey, planLanguageLocalParticipants, readConversationPartition } from './languageLocalParticipants.ts';
import { languageFixture, settle, marker } from '../../tests/helpers/languageFixture.ts';
import { STORAGE_PROTOCOL_KEY, readStorageSnapshot } from './storageTransaction.ts';
import { TIME, fillBudget } from '../../lib/conversation-session/fixtures.test-support.ts';
import * as api from './conversationLocalRecords.ts';

async function fixture(t: TestContext) {
  const f = languageFixture(); t.after(f.restore); const lease = await f.owner();
  let remote: Record<string, unknown> = {};
  const coordinator = createLanguageSyncCoordinator({ lease, storage: f.storage, onState() {}, transport: {
    async verifyOwner() { return true; }, async read() { return { state: remote, updatedAt: 'synthetic' }; },
    async insert(_owner, state) { remote = state; return true; }, async update(_owner, state) { remote = state; return true; },
  } }); t.after(coordinator.dispose); await coordinator.start();
  const context = () => { const value = coordinator.getState().context; assert.ok(value); return value; };
  const snapshot = () => api.readConversationSnapshot(context());
  const create = async (index = 0) => { const script = GUIDED_CONVERSATION_PILOT[index]; return api.runConversationEdit(api.captureConversationSession(snapshot(), { kind: 'guided', scriptId: script.scriptId, scriptRevision: script.scriptRevision }, 'Asia/Seoul')); };
  const session = (id: string) => snapshot().envelope!.sessions.find(item => item.sessionId === id)!;
  const draft = (id: string, input: string, draftId: string, stepId = getConversationProgress(session(id))!.activeStepId!): ConversationDraft => ({
    draftId, revision: 1, input, savedAt: TIME, source: sourceRef(session(id).source, stepId), origin: { kind: 'typed', edited: false },
    exposure: { example: 'not-shown', reading: 'not-shown', meaning: 'not-shown', hint: 'not-shown' },
  });
  const save = async (id: string, value: ConversationDraft) => api.runConversationEdit(api.captureConversationDraft(snapshot(), id, value));
  const send = async (id: string, value: ConversationDraft) => { await save(id, value); const command = api.captureConversationAppend(snapshot(), id, value.draftId); await api.stageConversationIntent(command); await api.applyConversationIntent(command); return command; };
  const close = async (id: string) => { const intent = api.captureConversationClose(snapshot(), id); await api.stageConversationIntent(intent); await api.applyConversationIntent(intent); return intent; };
  return { ...f, lease, coordinator, context, snapshot, create, session, draft, save, send, close };
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
