import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { CURRICULUM } from '../data/curriculum.ts';
import { captureLanguageRows } from '../app/data/languageRecordIdentity.ts';
import { LocalEvidenceStore } from '../lib/language-legacy-evidence/local-store.ts';
import { createLegacyReviewCaptureFixture, reviewElement, observeReview, until, deferred, type LegacyReviewCaptureFixture } from './helpers/legacyReviewCaptureHarness.ts';
import { COURSE_REVIEW_KEY } from '../app/data/languageReviewMutations.ts';
import { updateLanguageRecords } from '../app/data/languageCloudSync.ts';
import { LANGUAGE_LEGACY_EVIDENCE_RELEASE } from '../app/data/languageLegacyEvidenceRelease.ts';
import type { CapturedCourseReviewAdapter } from '../app/data/languageLegacyReviewCapture.ts';
import type { CaptureCheckpoint } from '../lib/language-legacy-evidence/persistence-types.ts';
import type { ReviewRun, ReviewExposure, ReviewJournalPayload } from '../lib/language-legacy-evidence/review-capture.ts';
import type { EvidenceEvent } from '../lib/language-legacy-evidence/types.ts';
import type { ReviewObservation } from '../utils/learningReview.ts';

// Never attach raw drafts, source bytes, handoffs or RPC arguments to assertion errors.
const equalPrivate = (actual: unknown, expected: unknown, message = 'Private fixture values differ') => assert.ok(isDeepStrictEqual(actual, expected), message);
const diagnostic = (adapter: CapturedCourseReviewAdapter) => { const { status, failure, busy } = adapter.view(); return JSON.stringify({ status, failure, busy }); };

const RAW = 'PRIVATE_TYPED_ADAPTER_DRAFT_65b6c3';
const observation: ReviewObservation = Object.freeze({ modality: 'typing', neededHelp: false, responseMs: 137.25 });
const events = (f: LegacyReviewCaptureFixture) => f.idb.entries('events').map(([, row]) => JSON.parse((row as { value: { canonical: string } }).value.canonical) as EvidenceEvent).sort((a, b) => a.sequence - b.sequence);
const runs = (f: LegacyReviewCaptureFixture) => f.idb.entries('reviewRuns').map(([, row]) => row as ReviewRun).filter(row => row.kind === 'run');
const run = (f: LegacyReviewCaptureFixture, adapter: CapturedCourseReviewAdapter) => runs(f).find(row => row.immutable.runId === adapter.view().runId)!;
const checkpoint = (f: LegacyReviewCaptureFixture, adapter: CapturedCourseReviewAdapter) => f.idb.entries('checkpoints').map(([, row]) => (row as { value: CaptureCheckpoint }).value).find(row => row.sourceSlotKey === run(f, adapter).immutable.sourceSlotKey)!;
const journals = (f: LegacyReviewCaptureFixture) => f.idb.entries('reviewTransitions').map(([, row]) => JSON.parse((row as { canonical: string }).canonical) as ReviewJournalPayload);
const exposure = (f: LegacyReviewCaptureFixture) => f.idb.entries('itemExposures').map(([, row]) => row as ReviewExposure);
async function ready(f: LegacyReviewCaptureFixture, questionId = 'f01:3') {
  const adapter = f.create(questionId); assert.equal(await adapter.start(), true, diagnostic(adapter));
  assert.equal(await observeReview(adapter), true, diagnostic(adapter)); assert.equal(adapter.view().status, 'ready'); return adapter;
}
async function publish(adapter: CapturedCourseReviewAdapter) {
  const view = adapter.view(), handoff = view.handoff; assert.ok(handoff);
  return adapter.published({ runId: view.runId!, draftToken: view.draftToken!, eventId: handoff.eventId, answer: handoff.answer, correct: handoff.correct, observation: handoff.observation });
}
async function answerAndFeedback(adapter: CapturedCourseReviewAdapter, value: string, input = observation) {
  assert.equal(await adapter.answer(value, input), true, diagnostic(adapter));
  assert.equal(await publish(adapter), true, diagnostic(adapter));
  assert.equal(await observeReview(adapter, 'feedback'), true, diagnostic(adapter));
  assert.equal(adapter.view().status, 'answered');
}

test('shipping inactive adapter never opens evidence IDB, enrolls or dispatches RPC, including explicit methods', async t => {
  equalPrivate(LANGUAGE_LEGACY_EVIDENCE_RELEASE, { resetProtocol: 'inactive', enrollmentEnabled: false, captureEnabled: false });
  const f = await createLegacyReviewCaptureFixture(t, { active: false }), adapter = f.create();
  assert.equal(adapter.view().status, 'inactive'); assert.equal(adapter.view().showQuestion, false);
  assert.equal(f.idbOpenCount, 0); equalPrivate(f.calls, []);
  for (const operation of [() => adapter.start(), () => adapter.recover(), () => adapter.hint(), () => adapter.answer(RAW, observation), () => adapter.retryAnswer(), () => adapter.retire('defer'), () => adapter.deliver()]) assert.equal(await operation(), false);
  assert.equal(f.idbOpenCount, 0); equalPrivate(f.calls, []); equalPrivate(f.submitted, []);
});

test('explicit acquisition precedes question display; two focused visible frames precede a real presentation', async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = f.create(), held = deferred<void>();
  f.rpcHooks(async name => { if (name === 'read_language_legacy_evidence_status') await held.promise; });
  assert.equal(f.idbOpenCount, 0); equalPrivate(f.calls, []); assert.equal(adapter.view().showQuestion, false);
  const starting = adapter.start(); await until(() => f.calls.length === 1);
  assert.equal(adapter.view().status, 'starting'); assert.equal(adapter.view().showQuestion, false); assert.equal(f.idbOpenCount, 0);
  assert.equal(await adapter.start(), false, 'Double Start cannot allocate a second action');
  held.resolve(); assert.equal(await starting, true, diagnostic(adapter)); f.rpcHooks();
  assert.equal(adapter.view().status, 'question_pending'); assert.equal(adapter.view().showQuestion, true);
  assert.equal(runs(f).length, 1); assert.equal(run(f, adapter).state.phase, 'unpresented'); assert.equal(events(f).length, 0);
  assert.equal(f.idb.entries('checkpoints').length, 0); assert.equal(exposure(f)[0].pending.length, 1);
  const element = reviewElement(adapter.view().runId!, 'question', adapter.view().draftToken!), observed = adapter.observe('question', element.element);
  await until(() => element.frames.length === 1); assert.equal(events(f).length, 0); element.frame();
  await until(() => element.frames.length === 1); assert.equal(events(f).length, 0); element.frame();
  assert.equal(await observed, true, diagnostic(adapter)); assert.equal(adapter.view().status, 'ready');
  assert.equal(events(f).length, 1); assert.equal(events(f)[0].kind, 'exercise_presented');
  assert.equal(events(f)[0].hintUsed, null); assert.equal(events(f)[0].answerPreviouslyRevealed, null);
  assert.equal(exposure(f)[0].coverage, 'unknown'); assert.equal(exposure(f)[0].pending.length, 0);
});

test('source handle must remain registered and byte-exact before acquisition and after frame boundaries', async t => {
  const f = await createLegacyReviewCaptureFixture(t), source = f.source(), handle = f.handles.get('f01:3')!;
  assert.throws(() => new f.adapterModule.CapturedCourseReviewAdapter({ handle: { ...handle }, mode: 'reader', source: f.source, actions: f.actions, changed() {} }));
  assert.equal(f.idbOpenCount, 0); equalPrivate(f.calls, []);
  const adapter = f.create(); assert.equal(await adapter.start(), true);
  const element = reviewElement(adapter.view().runId!, 'question', adapter.view().draftToken!), pending = adapter.observe('question', element.element);
  await until(() => element.frames.length === 1);
  await updateLanguageRecords(source.context, fresh => ({ [COURSE_REVIEW_KEY]: `${fresh[COURSE_REVIEW_KEY]} ` }));
  element.frame(); assert.equal(await pending, false); assert.equal(adapter.view().failure, 'source_changed');
  assert.equal(events(f).length, 0); assert.equal(f.idb.entries('checkpoints').length, 0);
});

test('shared observed meaning exposure blocks a stale typed checkpoint without inventing a hint or new event', async t => {
  const f = await createLegacyReviewCaptureFixture(t), typed = await ready(f), original = structuredClone(checkpoint(f, typed));
  const meaning = await ready(f, 'f01:2'); assert.equal(meaning.surface.identity.itemId, typed.surface.identity.itemId);
  assert.equal(exposure(f)[0].targetText, true); assert.equal(exposure(f)[0].reading, true); assert.equal(exposure(f)[0].coverage, 'unknown');
  const before = f.idb.entries('events'), journalCount = journals(f).length;
  assert.equal(await typed.answer(RAW, observation), false); assert.equal(typed.view().status, 'blocked'); assert.equal(typed.view().failure, 'shared_exposure');
  equalPrivate(f.idb.entries('events'), before); assert.equal(journals(f).length, journalCount); equalPrivate(checkpoint(f, typed), original);
  assert.equal(checkpoint(f, typed).hintUsed, null); assert.equal(checkpoint(f, typed).answerPreviouslyRevealed, null); equalPrivate(f.submitted, []);
});

test('new typing after real meaning exposure truthfully inherits reveal=true while hint and coverage remain unknown', async t => {
  const f = await createLegacyReviewCaptureFixture(t); await ready(f, 'f01:2'); const typed = await ready(f);
  const presented = events(f).find(event => event.taskFormat === 'typed_answer')!;
  assert.equal(presented.answerPreviouslyRevealed, true); assert.equal(presented.hintUsed, null);
  assert.equal(await typed.answer(RAW, observation), true, diagnostic(typed));
  const answered = events(f).find(event => event.kind === 'answer_submitted')!;
  assert.equal(answered.answerPreviouslyRevealed, true); assert.equal(answered.hintUsed, null); assert.equal(exposure(f)[0].coverage, 'unknown');
});

test('answer, exact local publication, observed feedback and retry preserve independent flags and original observation', async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = await ready(f), beforeDraft = adapter.view().draftToken;
  assert.equal(await adapter.hint(), true); assert.equal(adapter.view().status, 'hint_pending');
  assert.equal(checkpoint(f, adapter).hintUsed, null, 'Pending reveal alone cannot claim observed hint');
  assert.equal(await observeReview(adapter, 'hint'), true); assert.equal(checkpoint(f, adapter).hintUsed, true);
  const submittedObservation = { modality: 'typing' as const, neededHelp: true, responseMs: 271.5 };
  assert.equal(await adapter.answer(RAW, submittedObservation), true, diagnostic(adapter)); submittedObservation.responseMs = 9999;
  assert.equal(adapter.view().status, 'feedback_pending'); assert.equal(adapter.view().handoff?.answer === RAW, true, 'Exact local draft is preserved');
  equalPrivate(adapter.view().handoff?.observation, { modality: 'typing', neededHelp: true, responseMs: 271.5 });
  assert.equal(run(f, adapter).state.hadWrong, true); assert.equal(run(f, adapter).state.neededHelp, true);
  assert.equal(run(f, adapter).state.compatibilityApplied, false); assert.equal(run(f, adapter).state.feedbackObserved, false);
  assert.equal(await publish(adapter), true); assert.equal(run(f, adapter).state.compatibilityApplied, true);
  assert.equal(adapter.view().status, 'feedback_pending'); assert.equal(run(f, adapter).state.feedbackObserved, false);
  assert.equal(await observeReview(adapter, 'feedback'), true); assert.equal(adapter.view().status, 'answered');
  const appliedHandoff = structuredClone(checkpoint(f, adapter).handoff), beforeRetryEvents = f.idb.entries('events');
  assert.equal(await adapter.retryAnswer(), true); assert.equal(adapter.view().status, 'retry_pending');
  assert.notEqual(adapter.view().draftToken, beforeDraft); assert.equal(run(f, adapter).state.action?.kind, 'retry');
  assert.equal(await adapter.cleared({ runId: adapter.view().runId!, draftToken: adapter.view().draftToken!, answer: '', hintShown: false, feedbackShown: false }), true);
  assert.equal(adapter.view().status, 'ready'); assert.equal(adapter.view().showHint, false);
  equalPrivate(checkpoint(f, adapter).handoff, appliedHandoff, 'Retry retains the exact applied historical handoff');
  assert.equal(checkpoint(f, adapter).handoff?.status, 'applied');
  assert.equal(checkpoint(f, adapter).handoff?.draftToken, beforeDraft);
  assert.notEqual(checkpoint(f, adapter).handoff?.draftToken, adapter.view().draftToken);
  assert.equal(checkpoint(f, adapter).answerReady, true);
  assert.equal(run(f, adapter).state.phase, 'answerable'); assert.equal(run(f, adapter).state.action, null);
  const retryAcknowledgement = journals(f).find(row => row.transitionId === run(f, adapter).state.latestTransitionId);
  assert.equal(retryAcknowledgement?.operation.kind, 'ack_retry');
  equalPrivate(retryAcknowledgement?.after.runState, run(f, adapter).state);
  equalPrivate(f.idb.entries('events'), beforeRetryEvents, 'Retry and clear acknowledgement do not add an answer event');
  assert.equal(run(f, adapter).state.hadWrong, true); assert.equal(run(f, adapter).state.neededHelp, true);
  assert.equal(checkpoint(f, adapter).hintUsed, true); assert.equal(checkpoint(f, adapter).answerPreviouslyRevealed, true); assert.equal(checkpoint(f, adapter).nextSequence, 2);
  const correct = adapter.surface.authored.targetText;
  await answerAndFeedback(adapter, correct, { modality: 'typing', neededHelp: false, responseMs: 801.75 });
  assert.equal(run(f, adapter).state.hadWrong, true); assert.equal(run(f, adapter).state.neededHelp, true);
  assert.equal(events(f).length, 3); assert.equal(events(f)[2].isRetry, true); assert.equal(events(f)[2].hintUsed, true); assert.equal(events(f)[2].answerPreviouslyRevealed, true);
  equalPrivate(adapter.view().handoff?.observation, { modality: 'typing', neededHelp: false, responseMs: 801.75 });
});

for (const boundary of ['hidden', 'unfocused', 'disconnected', 'suspended'] as const) test(`${boundary} between observation frames preserves acquisition but cannot create presentation`, async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = f.create(); assert.equal(await adapter.start(), true);
  const element = reviewElement(adapter.view().runId!, 'question', adapter.view().draftToken!), pending = adapter.observe('question', element.element);
  await until(() => element.frames.length === 1); element.frame(); await until(() => element.frames.length === 1);
  if (boundary === 'hidden') element.setVisible(false);
  else if (boundary === 'unfocused') element.setFocused(false);
  else if (boundary === 'disconnected') element.setConnected(false);
  else adapter.suspend();
  element.frame(); assert.equal(await pending, false); assert.equal(adapter.view().status, 'blocked');
  assert.equal(events(f).length, 0); assert.equal(f.idb.entries('checkpoints').length, 0);
  assert.equal(exposure(f)[0].targetText, null); assert.equal(exposure(f)[0].answer, null); assert.equal(exposure(f)[0].pending.length, 1);
});

test('answer validation preserves raw over-limit input without truncating it or minting an event', async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = await ready(f), before = f.idb.entries('checkpoints');
  const value = `${RAW}${'あ'.repeat(4097)}`;
  assert.equal(await adapter.answer(value, observation), false); assert.equal(adapter.view().failure, 'unsupported_value');
  assert.equal(events(f).length, 1); equalPrivate(f.idb.entries('checkpoints'), before); equalPrivate(f.submitted, []);
});

test('publication rejects a different raw draft/observation and does not mark local compatibility as applied', async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = await ready(f);
  assert.equal(await adapter.answer(RAW, observation), true);
  const view = adapter.view(), handoff = view.handoff!, before = f.idb.entries('checkpoints');
  assert.equal(await adapter.published({ runId: view.runId!, draftToken: view.draftToken!, eventId: handoff.eventId, answer: RAW,
    correct: false, observation: { ...observation, responseMs: 999 } }), false);
  assert.equal(adapter.view().failure, 'source_changed'); assert.equal(run(f, adapter).state.compatibilityApplied, false);
  equalPrivate(f.idb.entries('checkpoints'), before); assert.equal(events(f).length, 2);
});

test('held legacy acknowledgement cannot close retirement, advance the question or dispatch twice', async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = await ready(f);
  await answerAndFeedback(adapter, adapter.surface.authored.targetText);
  const handoff = structuredClone(adapter.view().handoff), held = deferred<void>(); let acknowledged = false;
  f.actionHooks({ after: async () => { await held.promise; }, afterPublish: () => {
    acknowledged = true; assert.equal(run(f, adapter).state.lifecycle, 'retiring', 'The synchronous hook callback cannot close IDB');
    assert.equal(adapter.view().status, 'retiring'); equalPrivate(adapter.view().handoff, handoff);
  } });
  const saving = adapter.retire('schedule'); await until(() => f.outcomes.length === 1);
  assert.equal(f.submitted.length, 1); assert.equal(f.intents.length, 1); assert.equal(acknowledged, false);
  assert.equal(adapter.view().status, 'retiring'); assert.equal(adapter.view().showQuestion, true); equalPrivate(adapter.view().handoff, handoff);
  assert.equal(run(f, adapter).state.lifecycle, 'retiring'); assert.equal(run(f, adapter).state.retirement?.outcome, null);
  assert.equal(await adapter.retire('schedule'), false); assert.equal(await adapter.recover(), false); assert.equal(f.submitted.length, 1);
  held.resolve(); assert.equal(await saving, true, diagnostic(adapter));
  assert.equal(acknowledged, true); assert.equal(adapter.view().status, 'closed'); assert.equal(adapter.view().showQuestion, false);
  assert.equal(run(f, adapter).state.lifecycle, 'closed'); assert.equal(run(f, adapter).state.retirement?.outcome?.operationId, f.intents[0].operationId);
  assert.equal(f.retryCount, 0); assert.equal(f.submitted.length, 1);
});

test('legacy commit with lost acknowledgement recovers the same registered operation read-first, never resubmits', async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = await ready(f);
  await answerAndFeedback(adapter, RAW);
  let drop = true;
  f.actionHooks({ after: () => { if (drop) { drop = false; throw Error('Synthetic response loss after actual planner commit'); } } });
  assert.equal(await adapter.retire('defer'), false); assert.equal(adapter.view().status, 'retiring'); assert.equal(adapter.view().failure, 'uncertain_retirement');
  assert.equal(f.intents.length, 1); assert.equal(f.submitted.length, 1); const bytes = f.source().snapshot.records[COURSE_REVIEW_KEY];
  assert.equal(run(f, adapter).state.lifecycle, 'retiring'); assert.equal(run(f, adapter).state.retirement?.outcome, null);
  assert.equal(await adapter.recover(), true, diagnostic(adapter));
  assert.equal(adapter.view().status, 'closed'); assert.equal(f.retryCount, 1); assert.equal(f.submitted.length, 1); assert.equal(f.intents.length, 1);
  assert.equal(f.outcomes[1].status, 'already-applied'); assert.equal(f.outcomes[0].operationId, f.outcomes[1].operationId);
  equalPrivate(f.source().snapshot.records[COURSE_REVIEW_KEY], bytes, 'Read-first recovery must not rewrite an acknowledged legacy row');
  equalPrivate(f.intents[0].payload.kind === 'schedule' && f.intents[0].payload.observation, observation);
});

test('lost closure authority after acknowledged local save retains the exact retirement across a fresh adapter', async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = await ready(f);
  const original = run(f, adapter).immutable, arrived = deferred<void>(), released = deferred<void>();
  t.after(() => released.resolve());
  f.rpcHooks(undefined, async name => {
    if (name !== 'read_language_legacy_evidence_status') return;
    arrived.resolve(); await released.promise; throw Error('Synthetic closure status response loss');
  });
  const saving = adapter.retire('defer'); await arrived.promise;
  assert.equal(f.outcomes.length, 1); assert.equal(f.outcomes[0].acknowledged, true);
  assert.equal(f.submitted.length, 1); assert.equal(f.syncCalls.filter(call => call.name === 'update').length, 0,
    'The real local mutation acknowledgement does not depend on background cloud synchronization');
  const heldRun = structuredClone(run(f, adapter)), heldJournals = f.idb.entries('reviewTransitions');
  assert.equal(heldRun.state.lifecycle, 'retiring'); assert.equal(heldRun.state.retirement?.outcome, null);
  assert.equal(adapter.view().showQuestion, true);
  const begin = journals(f).find(row => row.transitionId === heldRun.state.latestTransitionId);
  assert.equal(begin?.operation.kind, 'begin_retirement');
  assert.equal(begin?.actionId, heldRun.state.retirement?.retirementId);
  assert.ok(!journals(f).some(row => row.runId === original.runId && row.operation.kind === 'close_retirement'));
  const savedBytes = f.source().snapshot.records[COURSE_REVIEW_KEY];
  released.resolve(); assert.equal(await saving, false);
  assert.equal(adapter.view().failure, 'uncertain_retirement'); assert.equal(adapter.view().busy, false);
  equalPrivate(run(f, adapter), heldRun); equalPrivate(f.idb.entries('reviewTransitions'), heldJournals);
  adapter.dispose(); f.rpcHooks();
  const fresh = captureLanguageRows(f.source().snapshot, COURSE_REVIEW_KEY);
  for (const row of fresh) { const id = (row.value as { id: string }).id; assert.equal(typeof id, 'string'); f.handles.set(id, row.handle); }
  const reloaded = f.create(); assert.equal(await reloaded.start(), false);
  assert.equal(reloaded.view().failure, 'uncertain_retirement'); assert.equal(reloaded.view().showQuestion, false);
  equalPrivate(runs(f).find(row => row.immutable.runId === original.runId), heldRun);
  equalPrivate(f.idb.entries('reviewTransitions'), heldJournals);
  equalPrivate(f.source().snapshot.records[COURSE_REVIEW_KEY], savedBytes);
  assert.equal(f.submitted.length, 1); assert.equal(f.intents.length, 1); assert.equal(f.retryCount, 0);
});

test('post-acknowledgement local admission read failure keeps retirement unresolved and recovery never retries legacy mutation', async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = await ready(f);
  await answerAndFeedback(adapter, adapter.surface.authored.targetText);
  f.actionHooks({ afterPublish: () => { f.idb.failNextRead(); } });
  assert.equal(await adapter.retire('schedule'), false); assert.equal(adapter.view().status, 'retiring'); assert.equal(adapter.view().showQuestion, true);
  assert.equal(adapter.view().failure, 'uncertain_retirement'); assert.equal(run(f, adapter).state.lifecycle, 'retiring');
  assert.equal(f.submitted.length, 1); const operationId = f.intents[0].operationId, bytes = f.source().snapshot.records[COURSE_REVIEW_KEY];
  f.actionHooks(); assert.equal(await adapter.recover(), true, diagnostic(adapter));
  assert.equal(adapter.view().status, 'closed'); assert.equal(f.submitted.length, 1); assert.equal(f.retryCount, 0);
  assert.equal(run(f, adapter).state.retirement?.outcome?.operationId, operationId); equalPrivate(f.source().snapshot.records[COURSE_REVIEW_KEY], bytes);
});

test('committed close with lost IDB completion is held until exact readback, reusing closure and legacy operation IDs', async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = await ready(f);
  await answerAndFeedback(adapter, adapter.surface.authored.targetText);
  let fault: ReturnType<typeof f.idb.loseNextCommitResponseForStoreWrite> | undefined;
  f.actionHooks({ afterPublish: () => { fault = f.idb.loseNextCommitResponseForStoreWrite('reviewTransitions', 'put');
    const failClosureReadback = () => { if (fault!.consumed) f.idb.failNextRead(); else f.idb.afterNextWriteCommit(failClosureReadback); };
    f.idb.afterNextWriteCommit(failClosureReadback); } });
  assert.equal(await adapter.retire('schedule'), false); assert.ok(fault); assert.equal(fault.consumed, 1);
  assert.equal(run(f, adapter).state.lifecycle, 'closed', 'Fault occurs after the real closure transaction commits');
  assert.equal(adapter.view().status, 'retiring'); assert.equal(adapter.view().showQuestion, true);
  const close = journals(f).filter(row => row.operation.kind === 'close_retirement'); assert.equal(close.length, 1);
  const before = f.idb.entries('reviewTransitions'), operationId = f.intents[0].operationId;
  f.actionHooks(); assert.equal(await adapter.recover(), true, diagnostic(adapter));
  assert.equal(adapter.view().status, 'closed'); assert.equal(adapter.view().showQuestion, false);
  equalPrivate(f.idb.entries('reviewTransitions'), before); assert.equal(f.retryCount, 0); assert.equal(f.submitted.length, 1);
  assert.equal(run(f, adapter).state.retirement?.outcome?.operationId, operationId);
});

for (const kind of ['defer', 'delete'] as const) test(`${kind} uses acknowledged real legacy mutation and closes the durable row fence`, async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = await ready(f);
  assert.equal(await adapter.retire(kind, kind === 'delete'), true, diagnostic(adapter));
  assert.equal(adapter.view().status, 'closed'); assert.equal(f.submitted.length, 1); assert.equal(f.intents.length, 1);
  const payload = f.submitted[0];
  if (kind === 'defer') { assert.equal(payload.kind, 'schedule'); if (payload.kind !== 'schedule') throw Error('Wrong payload');
    assert.equal(payload.correct, false); assert.equal(payload.neededHelp, true); assert.equal(payload.hadWrong, false); assert.equal(Object.hasOwn(payload, 'response'), false); assert.equal(Object.hasOwn(payload, 'observation'), false); }
  else { assert.equal(payload.kind, 'delete-group'); assert.equal(JSON.parse(f.source().snapshot.records[COURSE_REVIEW_KEY]!).some((row: { id: string }) => row.id === 'f01:3'), false); }
  assert.equal(run(f, adapter).state.lifecycle, 'closed'); assert.equal(run(f, adapter).state.retirement?.kind, kind);
});

test('unconfirmed deletion is refused before retirement or legacy mutation', async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = await ready(f), before = f.source().snapshot.records[COURSE_REVIEW_KEY];
  assert.equal(await adapter.retire('delete'), false); assert.equal(f.submitted.length, 0); assert.equal(run(f, adapter).state.lifecycle, 'active');
  equalPrivate(f.source().snapshot.records[COURSE_REVIEW_KEY], before); assert.equal(journals(f).some(row => row.operation.kind === 'begin_retirement'), false);
});

test('raw typed draft stays local through actual event delivery, legacy LAST receipt and normal sync wire', async t => {
  const f = await createLegacyReviewCaptureFixture(t, { sql: true }), adapter = await ready(f);
  await answerAndFeedback(adapter, RAW);
  assert.equal(adapter.view().handoff?.answer === RAW, true, 'Exact local draft is preserved'); assert.ok(JSON.stringify(f.idb.entries('checkpoints')).includes(RAW));
  assert.ok(JSON.stringify(f.idb.entries('commits')).includes(RAW), 'Local compatibility journal retains exact entered input');
  assert.equal(await adapter.deliver(), true, diagnostic(adapter)); assert.equal(adapter.view().delivery, 'verified');
  const append = f.calls.filter(call => call.name === 'append_language_legacy_evidence'); assert.equal(append.length, 2);
  assert.equal(JSON.stringify(f.calls).includes(RAW), false); assert.equal(JSON.stringify(f.idb.entries('events')).includes(RAW), false);
  assert.equal(JSON.stringify(f.idb.entries('receipts')).includes(RAW), false);
  const repo = await f.acquire(), prefix = await repo.readPrefix(); assert.equal(prefix.status, 'complete_authenticated_prefix');
  if (prefix.status !== 'complete_authenticated_prefix') throw Error('Missing actual SQL prefix');
  assert.equal(prefix.snapshot.records.length, 2); assert.equal(JSON.stringify(prefix).includes(RAW), false);
  assert.equal(await adapter.retire('defer'), true, diagnostic(adapter));
  const payload = f.submitted[0]; assert.equal(payload.kind, 'schedule'); if (payload.kind !== 'schedule') throw Error('Expected schedule');
  assert.equal(Object.hasOwn(payload, 'response'), false); equalPrivate(payload.observation, observation); assert.equal(payload.hadWrong, true); assert.equal(payload.neededHelp, true);
  const row = JSON.parse(f.source().snapshot.records[COURSE_REVIEW_KEY]!).find((value: { id: string }) => value.id === 'f01:3');
  assert.ok(row.languageLastOperationV1); assert.equal(row.languageLastOperationV1.operationId, f.intents[0].operationId);
  const last = JSON.parse(row.languageLastOperationV1.payload); assert.equal(Object.hasOwn(last, 'response'), false); equalPrivate(last.observation, observation);
  assert.equal(JSON.stringify(row).includes(RAW), false);
  await f.coordinator.refresh(); assert.equal(f.coordinator.getState().status, 'ready');
  const updates = f.syncCalls.filter(call => call.name === 'update'); assert.equal(updates.length, 1);
  assert.ok(JSON.stringify(updates[0].state).includes('languageLastOperationV1')); assert.equal(JSON.stringify(updates).includes(RAW), false);
  const remote = await f.sql!.db.query<{ state: Record<string, unknown> }>('select state from public.language_user_state where user_id=$1', [f.owner]);
  assert.equal(JSON.stringify(remote.rows).includes(RAW), false); assert.equal(JSON.stringify(f.calls).includes(RAW), false);
});

test('enrollment response loss stays target-free and explicit recovery uses the original frozen enrollment nonce', async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = f.create();
  f.rpcHooks(undefined, name => { if (name === 'enroll_language_legacy_evidence_v1') throw Error('Synthetic committed enrollment response loss'); });
  assert.equal(await adapter.start(), false); assert.equal(adapter.view().showQuestion, false); assert.equal(adapter.view().status, 'blocked');
  assert.equal(runs(f).length, 0); assert.equal(events(f).length, 0);
  const enroll = f.calls.filter(call => call.name === 'enroll_language_legacy_evidence_v1'); assert.equal(enroll.length, 1);
  const frozen = f.idb.entries('enrollmentIntents'); assert.equal(frozen.length, 1);
  f.rpcHooks(); assert.equal(await adapter.recover(), true, diagnostic(adapter));
  assert.equal(adapter.view().status, 'question_pending'); assert.equal(runs(f).length, 1); assert.equal(events(f).length, 0);
  assert.equal(f.calls.filter(call => call.name === 'enroll_language_legacy_evidence_v1').length, 1);
  assert.equal(JSON.stringify(f.idb.entries('admissions')).includes(String(enroll[0].args.creation_request_id)), true);
});

test('uncertain durable begin-retirement is reconciled before the first and only legacy dispatch', async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = await ready(f);
  const fault = f.idb.loseNextCommitResponseForStoreWrite('reviewTransitions', 'put');
    const failClosureReadback = () => { if (fault!.consumed) f.idb.failNextRead(); else f.idb.afterNextWriteCommit(failClosureReadback); };
    f.idb.afterNextWriteCommit(failClosureReadback);
  assert.equal(await adapter.retire('defer'), false); assert.equal(fault.consumed, 1);
  assert.equal(adapter.view().status, 'retiring'); assert.equal(run(f, adapter).state.lifecycle, 'retiring'); assert.equal(f.submitted.length, 0);
  const begins = journals(f).filter(row => row.operation.kind === 'begin_retirement'); assert.equal(begins.length, 1);
  assert.equal(await adapter.recover(), true, diagnostic(adapter));
  assert.equal(adapter.view().status, 'closed'); assert.equal(f.submitted.length, 1); assert.equal(f.retryCount, 0);
  equalPrivate(journals(f).filter(row => row.operation.kind === 'begin_retirement'), begins);
});

test('lost frozen-batch completion retains exact committed answer, draft and batch; explicit recovery creates no duplicate event', async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = await ready(f);
  const fault = f.idb.loseNextCommitResponseForStoreWrite('batches', 'add');
  assert.equal(await adapter.answer(RAW, observation), false); assert.equal(fault.consumed, 1);
  assert.equal(adapter.view().status, 'blocked'); assert.equal(checkpoint(f, adapter).handoff?.answer === RAW, true, 'Exact local checkpoint draft is preserved');
  const beforeEvents = f.idb.entries('events'), beforeBatches = f.idb.entries('batches'), beforeCommits = f.idb.entries('commits');
  assert.equal(beforeEvents.length, 2); assert.equal(beforeBatches.length, 2);
  assert.equal(await adapter.recover(), true, diagnostic(adapter)); assert.equal(adapter.view().status, 'feedback_pending');
  equalPrivate(f.idb.entries('events'), beforeEvents); equalPrivate(f.idb.entries('batches'), beforeBatches); equalPrivate(f.idb.entries('commits'), beforeCommits);
  assert.equal(adapter.view().handoff?.answer === RAW, true, 'Exact local draft is preserved'); equalPrivate(adapter.view().handoff?.observation, observation); equalPrivate(f.submitted, []);
});

test('acknowledged presentation and first answer do not prevent exact-predecessor delivery of retry sequence two', async t => {
  const f = await createLegacyReviewCaptureFixture(t, { sql: true }), adapter = await ready(f);
  await answerAndFeedback(adapter, RAW); assert.equal(await adapter.deliver(), true, diagnostic(adapter));
  assert.equal(adapter.view().delivery, 'verified'); const firstAnswer = events(f)[1];
  assert.equal(await adapter.retryAnswer(), true); assert.equal(await adapter.cleared({ runId: adapter.view().runId!, draftToken: adapter.view().draftToken!, answer: '', hintShown: false, feedbackShown: false }), true);
  await answerAndFeedback(adapter, adapter.surface.authored.targetText, { modality: 'typing', neededHelp: false, responseMs: 456.75 });
  const retryEvent = events(f)[2]; assert.equal(retryEvent.sequence, 2); assert.equal(retryEvent.isRetry, true);
  const batches = f.idb.entries('batches').map(([, row]) => JSON.parse((row as { canonical: string }).canonical));
  const retryBatch = batches.find(batch => batch.events[0].sequence === 2); assert.ok(retryBatch);
  assert.equal(retryBatch.expectedPredecessor.eventId, firstAnswer.eventId); assert.equal(retryBatch.expectedPredecessor.sequence, 1);
  assert.equal(await adapter.deliver(), true, diagnostic(adapter)); assert.equal(adapter.view().delivery, 'verified');
  const repo = await f.acquire(), prefix = await repo.readPrefix(); assert.equal(prefix.status, 'complete_authenticated_prefix');
  if (prefix.status !== 'complete_authenticated_prefix') throw Error('Missing SQL readback');
  equalPrivate(prefix.snapshot.records.map(row => row.event.sequence), [0, 1, 2]);
  assert.equal(f.calls.filter(call => call.name === 'append_language_legacy_evidence').length, 3);
  assert.equal(JSON.stringify(f.calls).includes(RAW), false);
});

test('bounded failure diagnostics contain only status, failure and busy, and private equality reports no values', async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = await ready(f);
  assert.equal(await adapter.answer(RAW, observation), true, diagnostic(adapter));
  equalPrivate(Object.keys(JSON.parse(diagnostic(adapter))).sort(), ['busy', 'failure', 'status']);
  assert.equal(diagnostic(adapter).includes(RAW), false);
  let failure: unknown;
  try { equalPrivate({ answer: RAW }, { answer: 'different-local-value' }); } catch (error) { failure = error; }
  assert.ok(failure instanceof Error); assert.equal(String(failure).includes(RAW), false);
  assert.equal(JSON.stringify(failure).includes(RAW), false);
});

test('explicit unavailable close cancels an unobserved question without inventing any presentation or exposure', async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = f.create(); assert.equal(await adapter.start(), true, diagnostic(adapter));
  adapter.suspend(); assert.equal(adapter.view().status, 'blocked'); const before = f.source().snapshot.records[COURSE_REVIEW_KEY];
  assert.equal(await adapter.closeUnavailable(false), false); assert.equal(run(f, adapter).state.lifecycle, 'active');
  assert.equal(await adapter.closeUnavailable(true), true, diagnostic(adapter));
  assert.equal(adapter.view().status, 'closed'); assert.equal(adapter.view().showQuestion, false);
  assert.equal(events(f).length, 0); assert.equal(f.idb.entries('checkpoints').length, 0);
  equalPrivate(journals(f).map(row => row.operation.kind).sort(), ['acquire', 'cancel_reveal', 'close_unavailable'].sort());
  assert.equal(exposure(f)[0].pending.length, 0); assert.equal(exposure(f)[0].targetText, null); assert.equal(exposure(f)[0].reading, null); assert.equal(exposure(f)[0].answer, null);
  assert.equal(exposure(f)[0].coverage, 'unknown'); assert.equal(f.submitted.length, 0);
  equalPrivate(f.source().snapshot.records[COURSE_REVIEW_KEY], before);
});

test('unavailable close cannot escape an uncertain legacy retirement or remove its durable claim', async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = await ready(f);
  f.actionHooks({ after: () => { throw Error('Synthetic unacknowledged legacy completion'); } });
  assert.equal(await adapter.retire('defer'), false); assert.equal(adapter.view().status, 'retiring');
  const before = { runs: f.idb.entries('reviewRuns'), journals: f.idb.entries('reviewTransitions'), source: f.source().snapshot.records[COURSE_REVIEW_KEY] };
  assert.equal(await adapter.closeUnavailable(true), false); assert.equal(adapter.view().status, 'retiring'); assert.equal(adapter.view().failure, 'uncertain_retirement');
  equalPrivate(f.idb.entries('reviewRuns'), before.runs); equalPrivate(f.idb.entries('reviewTransitions'), before.journals);
  equalPrivate(f.source().snapshot.records[COURSE_REVIEW_KEY], before.source); assert.equal(f.submitted.length, 1); assert.equal(f.retryCount, 0);
  assert.equal(run(f, adapter).state.lifecycle, 'retiring'); assert.notEqual(run(f, adapter).state.retirement, null);
});

for (const phase of ['unpublished', 'bad_publication', 'feedback_unobserved'] as const) test(`unavailable close cannot bypass ${phase} answer settlement`, async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = await ready(f);
  assert.equal(await adapter.answer(RAW, observation), true, diagnostic(adapter));
  if (phase === 'feedback_unobserved') assert.equal(await publish(adapter), true, diagnostic(adapter));
  if (phase === 'bad_publication') {
    const view = adapter.view(), handoff = view.handoff!;
    assert.equal(await adapter.published({ runId: view.runId!, draftToken: view.draftToken!, eventId: handoff.eventId, answer: 'a different local draft', correct: handoff.correct, observation: handoff.observation }), false);
  } else adapter.suspend();
  const before = { runs: f.idb.entries('reviewRuns'), journals: f.idb.entries('reviewTransitions'), checkpoint: f.idb.entries('checkpoints'), events: f.idb.entries('events') };
  assert.equal(await adapter.closeUnavailable(true), false); assert.equal(adapter.view().status, 'blocked');
  assert.equal(run(f, adapter).state.lifecycle, 'active'); assert.equal(run(f, adapter).state.action?.kind, 'answer');
  equalPrivate(f.idb.entries('reviewRuns'), before.runs); equalPrivate(f.idb.entries('reviewTransitions'), before.journals);
  equalPrivate(f.idb.entries('checkpoints'), before.checkpoint); equalPrivate(f.idb.entries('events'), before.events);
  assert.equal(checkpoint(f, adapter).handoff?.answer === RAW, true); assert.equal(f.submitted.length, 0);
});

test('surface binding rejects duplicate decoded IDs despite distinct encoded row bytes before IDB or RPC', async t => {
  const f = await createLegacyReviewCaptureFixture(t);
  const row = JSON.parse(f.source().snapshot.records[COURSE_REVIEW_KEY]!).find((value: { id: string }) => value.id === 'f01:3');
  const ordinary = JSON.stringify(row), escaped = ordinary.replace('"id":"f01:3"', '"id":"f01:\\u0033"');
  assert.equal(ordinary === escaped, false); assert.equal(JSON.parse(ordinary).id === JSON.parse(escaped).id, true);
  await updateLanguageRecords(f.source().context, () => ({ [COURSE_REVIEW_KEY]: `[${ordinary},${escaped}]` }));
  const source = f.source(), handles = captureLanguageRows(source.snapshot, COURSE_REVIEW_KEY); assert.equal(handles.length, 2);
  for (const { handle } of handles) assert.throws(() => new f.adapterModule.CapturedCourseReviewAdapter({ handle, mode: 'reader', source: () => source, actions: f.actions, changed() {} }), /source_changed/);
  assert.equal(f.idbOpenCount, 0); assert.equal(f.calls.length, 0);
});

test('surface binding rejects a registered malformed course row without acquiring evidence authority', async t => {
  const f = await createLegacyReviewCaptureFixture(t);
  const row = JSON.parse(f.source().snapshot.records[COURSE_REVIEW_KEY]!).find((value: { id: string }) => value.id === 'f01:3');
  await updateLanguageRecords(f.source().context, () => ({ [COURSE_REVIEW_KEY]: JSON.stringify([{ ...row, explanation: 17 }]) }));
  const source = f.source(), [{ handle }] = captureLanguageRows(source.snapshot, COURSE_REVIEW_KEY);
  assert.throws(() => new f.adapterModule.CapturedCourseReviewAdapter({ handle, mode: 'reader', source: () => source, actions: f.actions, changed() {} }), /unsupported_surface/);
  assert.equal(f.idbOpenCount, 0); assert.equal(f.calls.length, 0);
});

const listeningLesson = CURRICULUM.find(lesson => lesson.quiz.some(quiz => quiz.kind === 'listening'))!;
const unsupportedSurfaces = [
  { label: 'core choice', questionId: 'f01:0', mode: 'reader' as const },
  { label: 'listening', questionId: `${listeningLesson.id}:${listeningLesson.quiz.findIndex(quiz => quiz.kind === 'listening')}`, mode: 'reader' as const },
  { label: 'starter-mode input', questionId: 'f01:3', mode: 'starter' as const },
];
for (const { label, questionId, mode } of unsupportedSurfaces) test(`surface binding rejects ${label} before IDB or RPC`, async t => {
  const f = await createLegacyReviewCaptureFixture(t, { questionIds: [questionId] });
  assert.throws(() => f.create(questionId, mode), /unsupported_surface/);
  assert.equal(f.idbOpenCount, 0); assert.equal(f.calls.length, 0);
});

for (const field of ['prompt', 'explanation', 'choices', 'target', 'reading'] as const) test(`surface binding rejects changed authored ${field} bytes and restores shared curriculum`, async t => {
  const f = await createLegacyReviewCaptureFixture(t), lesson = CURRICULUM.find(row => row.id === 'f01')!, quiz = lesson.quiz[3], word = lesson.words[quiz.generatedReviewSurface!.wordIndex];
  const original = { prompt: quiz.prompt, explanation: quiz.explanation, choices: quiz.choices, japanese: word.japanese, reading: word.reading };
  try {
    if (field === 'prompt') quiz.prompt += ' changed';
    else if (field === 'explanation') quiz.explanation += ' changed';
    else if (field === 'choices') quiz.choices = [...quiz.choices, 'changed'];
    else if (field === 'target') word.japanese += 'changed';
    else word.reading += 'changed';
    assert.throws(() => f.create(), /unsupported_surface/);
    assert.equal(f.idbOpenCount, 0); assert.equal(f.calls.length, 0);
  } finally { quiz.prompt = original.prompt; quiz.explanation = original.explanation; quiz.choices = original.choices; word.japanese = original.japanese; word.reading = original.reading; }
  assert.equal(f.create().view().status, 'idle', 'Restored source binds to the original frozen contract');
});

for (const blockedPrefix of [false, true] as const) test(`orphan retry batch after remount ${blockedPrefix ? 'waits for authenticated prefix recovery' : 'uses the exact authenticated predecessor'} without changing event IDs`, async t => {
  const f = await createLegacyReviewCaptureFixture(t, { sql: true }), original = await ready(f);
  await answerAndFeedback(original, RAW); assert.equal(await original.deliver(), true, diagnostic(original));
  const predecessor = events(f)[1]; assert.equal(original.view().delivery, 'verified');
  assert.equal(await original.retryAnswer(), true); assert.equal(await original.cleared({ runId: original.view().runId!, draftToken: original.view().draftToken!, answer: '', hintShown: false, feedbackShown: false }), true);
  let eventCommittedBeforeQuota = false;
  f.idb.afterNextWriteCommit(() => { eventCommittedBeforeQuota = events(f).length === 3; f.idb.quotaNextWrite(); });
  assert.equal(await original.answer(original.surface.authored.targetText, { modality: 'typing', neededHelp: false, responseMs: 601.5 }), false);
  assert.equal(eventCommittedBeforeQuota, true); assert.equal(original.view().status, 'blocked');
  const orphan = events(f)[2], originalRunId = original.view().runId, originalDraftToken = original.view().draftToken;
  assert.equal(orphan.sequence, 2); assert.equal(f.idb.entries('batches').length, 2, 'Batch write was refused after the immutable event committed');
  const eventRows = f.idb.entries('events'); original.dispose();
  const remounted = f.create(); assert.equal(await remounted.start(), true, diagnostic(remounted));
  assert.equal(remounted.view().runId, originalRunId); assert.equal(remounted.view().draftToken, originalDraftToken);
  assert.equal(remounted.view().handoff?.eventId, orphan.eventId); assert.equal(remounted.view().status, 'feedback_pending');
  assert.equal(await publish(remounted), true, diagnostic(remounted)); assert.equal(await observeReview(remounted, 'feedback'), true, diagnostic(remounted));
  assert.equal(remounted.view().status, 'answered');
  const beforeCalls = f.calls.length, appendCount = f.calls.filter(call => call.name === 'append_language_legacy_evidence').length;
  if (blockedPrefix) {
    f.rpcHooks(name => { if (name === 'read_language_legacy_evidence_page') throw Error('Synthetic unavailable authenticated prefix'); });
    assert.equal(await remounted.deliver(), false); assert.equal(remounted.view().status, 'blocked');
    assert.equal(f.calls.filter(call => call.name === 'append_language_legacy_evidence').length, appendCount);
    assert.equal(f.idb.entries('batches').length, 2); equalPrivate(f.idb.entries('events'), eventRows);
    f.rpcHooks(); assert.equal(await remounted.recover(), true, diagnostic(remounted));
  }
  assert.equal(await remounted.deliver(), true, diagnostic(remounted)); assert.equal(remounted.view().delivery, 'verified');
  equalPrivate(f.idb.entries('events'), eventRows, 'Recovery cannot rewrite historical event IDs or bytes');
  assert.equal(f.calls.slice(beforeCalls).some(call => call.name === 'read_language_legacy_evidence_page'), true);
  const calls = f.calls.filter(call => call.name === 'append_language_legacy_evidence'); assert.equal(calls.length, appendCount + 1);
  const recoveredBatch = calls.at(-1)!;
  assert.equal(JSON.parse((recoveredBatch.args.canonical_events as string[])[0]).eventId, orphan.eventId);
  assert.equal((recoveredBatch.args.expected_predecessor as { eventId: string }).eventId, predecessor.eventId);
  assert.equal((recoveredBatch.args.expected_predecessor as { sequence: number }).sequence, 1);
  assert.equal(JSON.stringify(f.calls).includes(RAW), false);
  const repo = await f.acquire(), prefix = await repo.readPrefix(); assert.equal(prefix.status, 'complete_authenticated_prefix');
  if (prefix.status !== 'complete_authenticated_prefix') throw Error('Expected complete SQL prefix after successful recovery');
  equalPrivate(prefix.snapshot.records.map(row => row.event.eventId), events(f).map(event => event.eventId));
});

for (const marker of ['reviewRun', 'reviewSurface', 'reviewDraft'] as const) test(`question observation rejects changed ${marker} between frames without a presentation`, async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = f.create(); assert.equal(await adapter.start(), true, diagnostic(adapter));
  const element = reviewElement(adapter.view().runId!, 'question', adapter.view().draftToken!);
  const pending = adapter.observe('question', element.element); await until(() => element.frames.length === 1); element.frame();
  await until(() => element.frames.length === 1); element.element.dataset[marker] = 'stale-synthetic-marker'; element.frame();
  assert.equal(await pending, false); assert.equal(adapter.view().status, 'blocked'); assert.equal(adapter.view().failure, 'interrupted');
  assert.equal(events(f).length, 0); assert.equal(f.idb.entries('checkpoints').length, 0); assert.equal(exposure(f)[0].pending.length, 1);
});

test('question observation rejects a stale draft marker before requesting a frame', async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = f.create(); assert.equal(await adapter.start(), true, diagnostic(adapter));
  const element = reviewElement(adapter.view().runId!, 'question', 'stale-synthetic-draft');
  assert.equal(await adapter.observe('question', element.element), false); assert.equal(element.frames.length, 0);
  assert.equal(adapter.view().failure, 'interrupted'); assert.equal(events(f).length, 0);
});

test('feedback observation rejects an event marker changed between frames and retains its pending observation', async t => {
  const f = await createLegacyReviewCaptureFixture(t), adapter = await ready(f);
  assert.equal(await adapter.answer(RAW, observation), true, diagnostic(adapter)); assert.equal(await publish(adapter), true, diagnostic(adapter));
  const view = adapter.view(), element = reviewElement(view.runId!, 'feedback', view.draftToken!, view.handoff!.eventId);
  const before = { events: f.idb.entries('events'), checkpoint: f.idb.entries('checkpoints'), journals: f.idb.entries('reviewTransitions') };
  const pending = adapter.observe('feedback', element.element); await until(() => element.frames.length === 1); element.frame();
  await until(() => element.frames.length === 1); element.element.dataset.reviewEvent = 'stale-synthetic-event'; element.frame();
  assert.equal(await pending, false); assert.equal(adapter.view().failure, 'interrupted'); assert.equal(run(f, adapter).state.feedbackObserved, false);
  equalPrivate(f.idb.entries('events'), before.events); equalPrivate(f.idb.entries('checkpoints'), before.checkpoint); equalPrivate(f.idb.entries('reviewTransitions'), before.journals);
  assert.equal(exposure(f)[0].pending.filter(intent => intent.surface === 'feedback').length, 1);
});

for (const action of ['answer', 'hint', 'retry', 'retire'] as const) test(`stale-tab ${action} cannot bind old UI input to another tab's new durable draft`, async t => {
  const f = await createLegacyReviewCaptureFixture(t), stale = await ready(f);
  if (action === 'retry' || action === 'retire') await answerAndFeedback(stale, RAW);
  const originalDraft = stale.view().draftToken;
  const retainedView = { runId: stale.view().runId, draftToken: stale.view().draftToken, handoff: structuredClone(stale.view().handoff) };
  const other = f.create(); assert.equal(await other.start(), true, diagnostic(other));
  assert.equal(other.view().runId, stale.view().runId, 'Both real facades address the same durable run');
  if (other.view().status === 'ready') await answerAndFeedback(other, RAW);
  assert.equal(await other.retryAnswer(), true); assert.equal(await other.cleared({ runId: other.view().runId!, draftToken: other.view().draftToken!, answer: '', hintShown: false, feedbackShown: false }), true);
  assert.equal(stale.view().draftToken, originalDraft); assert.notEqual(other.view().draftToken, originalDraft);
  await answerAndFeedback(other, other.surface.authored.targetText); assert.ok(other.view().handoff, 'The competing tab has a newer non-null handoff');
  const before = { events: f.idb.entries('events'), checkpoint: f.idb.entries('checkpoints'), journals: f.idb.entries('reviewTransitions') };
  const result = action === 'answer' ? await stale.answer(RAW, observation) : action === 'hint' ? await stale.hint() : action === 'retry' ? await stale.retryAnswer() : await stale.retire('defer');
  assert.equal(result, false); assert.equal(stale.view().status, 'blocked'); assert.equal(stale.view().failure, 'source_changed');
  equalPrivate(f.idb.entries('events'), before.events); equalPrivate(f.idb.entries('checkpoints'), before.checkpoint); equalPrivate(f.idb.entries('reviewTransitions'), before.journals);
  assert.equal(f.submitted.length, 0); assert.equal(run(f, other).state.lifecycle, 'active');
  const identity = () => ({ runId: stale.view().runId, draftToken: stale.view().draftToken, handoff: stale.view().handoff });
  equalPrivate(identity(), retainedView, 'Blocked old UI retains its own draft and handoff');
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal(await stale.recover(), false); assert.equal(stale.view().failure, 'source_changed');
    equalPrivate(identity(), retainedView, 'Read-first recovery cannot adopt another tab’s answer into an old draft');
  }
  equalPrivate(f.idb.entries('events'), before.events); equalPrivate(f.idb.entries('checkpoints'), before.checkpoint); equalPrivate(f.idb.entries('reviewTransitions'), before.journals);
  const fresh = f.create(); assert.equal(await fresh.start(), true, diagnostic(fresh));
  equalPrivate(fresh.view().handoff, other.view().handoff, 'A fresh validated adapter may restore the current durable handoff');
  assert.equal(fresh.view().draftToken, other.view().draftToken);
});

test('remount between durable retry and local clear acknowledgement restores retry_pending and preserves historical flags', async t => {
  const f = await createLegacyReviewCaptureFixture(t), original = await ready(f);
  assert.equal(await original.hint(), true); assert.equal(await observeReview(original, 'hint'), true);
  await answerAndFeedback(original, RAW, { modality: 'typing', neededHelp: true, responseMs: 276.25 });
  assert.equal(await original.retryAnswer(), true, diagnostic(original)); assert.equal(original.view().status, 'retry_pending');
  const token = original.view().draftToken, runId = original.view().runId, beforeEvents = f.idb.entries('events');
  assert.equal(run(f, original).state.action?.kind, 'retry'); original.dispose();
  const remounted = f.create(); assert.equal(await remounted.start(), true, diagnostic(remounted));
  assert.equal(remounted.view().status, 'retry_pending'); assert.equal(remounted.view().draftToken, token); assert.equal(remounted.view().runId, runId);
  assert.equal(await remounted.cleared({ runId: runId!, draftToken: token!, answer: '', hintShown: false, feedbackShown: false }), true, diagnostic(remounted));
  assert.equal(remounted.view().status, 'ready'); assert.equal(run(f, remounted).state.action, null);
  assert.equal(run(f, remounted).state.hadWrong, true); assert.equal(run(f, remounted).state.neededHelp, true);
  assert.equal(checkpoint(f, remounted).hintUsed, true); assert.equal(checkpoint(f, remounted).answerPreviouslyRevealed, true);
  equalPrivate(f.idb.entries('events'), beforeEvents, 'Retry clear is local metadata, never another presentation');
  assert.equal(f.submitted.length, 0);
});

const pendingBytes = (f: LegacyReviewCaptureFixture) => ({ events: f.idb.entries('events'), batches: f.idb.entries('batches'),
  delivery: f.idb.entries('delivery'), checkpoints: f.idb.entries('checkpoints'), commits: f.idb.entries('commits'), transitions: f.idb.entries('reviewTransitions') });
const appendSequences = (f: LegacyReviewCaptureFixture) => f.calls.filter(call => call.name === 'append_language_legacy_evidence')
  .flatMap(call => (call.args.canonical_events as string[]).map(canonical => (JSON.parse(canonical) as EvidenceEvent).sequence));

test('remount and explicit recovery rediscover existing slot pending delivery without capture or append', async t => {
  const f = await createLegacyReviewCaptureFixture(t), original = await ready(f); await answerAndFeedback(original, RAW);
  assert.equal(original.view().delivery, 'pending'); const before = pendingBytes(f), callsBefore = f.calls.length; original.dispose();
  const remounted = f.create(); assert.equal(await remounted.start(), true, diagnostic(remounted));
  assert.equal(remounted.view().status, 'answered'); assert.equal(remounted.view().delivery, 'pending');
  equalPrivate(pendingBytes(f), before, 'Pending discovery may not rewrite captured or delivery records');
  equalPrivate(f.calls.slice(callsBefore).map(call => call.name), ['read_language_legacy_evidence_status'], 'Restore uses no append, enrollment or delivery RPC');
  remounted.suspend(); assert.equal(await remounted.recover(), true, diagnostic(remounted)); assert.equal(remounted.view().delivery, 'pending');
  equalPrivate(pendingBytes(f), before); assert.equal(f.calls.some(call => call.name === 'append_language_legacy_evidence'), false);
});

test('restored pending scan is scoped to the selected source slot', async t => {
  const f = await createLegacyReviewCaptureFixture(t, { questionIds: ['f01:3', 'f01:5'] }), pending = await ready(f); await answerAndFeedback(pending, RAW);
  const empty = f.create('f01:5'); assert.equal(await empty.start(), true, diagnostic(empty)); const emptyRun = empty.view().runId; empty.dispose();
  const before = pendingBytes(f), restored = f.create('f01:5'); assert.equal(await restored.start(), true, diagnostic(restored));
  assert.equal(restored.view().runId, emptyRun); assert.equal(restored.view().status, 'question_pending');
  assert.equal(restored.view().delivery, 'none', 'Another slot’s pending events cannot be attributed to this run');
  equalPrivate(pendingBytes(f), before); assert.equal(f.calls.some(call => call.name === 'append_language_legacy_evidence'), false);
});

test('absence of pending delivery on remount cannot claim fresh server verification', async t => {
  const f = await createLegacyReviewCaptureFixture(t, { sql: true }), original = await ready(f); await answerAndFeedback(original, RAW);
  assert.equal(await original.deliver(), true, diagnostic(original)); assert.equal(original.view().delivery, 'verified');
  const before = pendingBytes(f), callsBefore = f.calls.length; original.dispose();
  const restored = f.create(); assert.equal(await restored.start(), true, diagnostic(restored));
  assert.equal(restored.view().status, 'answered'); assert.equal(restored.view().delivery, 'none'); equalPrivate(pendingBytes(f), before);
  assert.equal(await restored.deliver(), true, diagnostic(restored)); assert.equal(restored.view().delivery, 'none', 'No-work delivery cannot infer a verified receipt');
  equalPrivate(pendingBytes(f), before); equalPrivate(f.calls.slice(callsBefore).map(call => call.name), ['read_language_legacy_evidence_status']);
});

async function orphanPresentationThenAnswer(t: TestContext) {
  const f = await createLegacyReviewCaptureFixture(t, { sql: true }), first = f.create(); assert.equal(await first.start(), true, diagnostic(first));
  let presentationCommitted = false;
  f.idb.afterNextWriteCommit(() => { presentationCommitted = events(f).length === 1; f.idb.quotaNextWrite(); });
  assert.equal(await observeReview(first), false); assert.equal(presentationCommitted, true);
  assert.equal(events(f).length, 1); assert.equal(f.idb.entries('batches').length, 0); first.dispose();
  const remounted = f.create(); assert.equal(await remounted.start(), true, diagnostic(remounted)); assert.equal(remounted.view().status, 'ready');
  await answerAndFeedback(remounted, RAW); assert.equal(events(f).length, 2); assert.equal(f.idb.entries('batches').length, 1);
  const successorBatch = JSON.parse((f.idb.entries('batches')[0][1] as { canonical: string }).canonical);
  assert.equal(successorBatch.events[0].sequence, 1); return { f, remounted, successorBatch };
}

test('orphan presentation is delivered before its persisted answer batch through actual SQL without quarantine', async t => {
  const { f, remounted, successorBatch } = await orphanPresentationThenAnswer(t), beforeEvents = f.idb.entries('events');
  assert.equal(await remounted.deliver(), true, diagnostic(remounted)); equalPrivate(appendSequences(f), [0, 1]);
  assert.equal(remounted.view().delivery, 'verified'); equalPrivate(f.idb.entries('events'), beforeEvents);
  const batches = f.idb.entries('batches').map(([, row]) => row as { canonical: string; delivery: { status: string } });
  assert.equal(batches.length, 2); assert.equal(batches.every(row => row.delivery.status === 'acknowledged'), true);
  assert.equal(batches.some(row => JSON.parse(row.canonical).batchId === successorBatch.batchId), true, 'Existing successor batch identity survives the repair');
  const repo = await f.acquire(), prefix = await repo.readPrefix(); assert.equal(prefix.status, 'complete_authenticated_prefix');
  if (prefix.status !== 'complete_authenticated_prefix') throw Error('Expected complete ordered SQL prefix');
  equalPrivate(prefix.snapshot.records.map(row => row.event.sequence), [0, 1]);
  equalPrivate(prefix.snapshot.records.map(row => row.event.eventId), events(f).map(event => event.eventId));
  assert.equal(JSON.stringify(f.calls).includes(RAW), false);
});

for (const orphan of [false, true] as const) test(`${orphan ? 'orphan' : 'persisted'} lower event readback_required stops before its persisted successor`, async t => {
  let f: LegacyReviewCaptureFixture, adapter: CapturedCourseReviewAdapter;
  if (orphan) { const prepared = await orphanPresentationThenAnswer(t); f = prepared.f; adapter = prepared.remounted; }
  else { f = await createLegacyReviewCaptureFixture(t, { sql: true }); adapter = await ready(f); await answerAndFeedback(adapter, RAW); }
  const beforeEvents = f.idb.entries('events');
  f.rpcHooks((name, args) => {
    if (name === 'append_language_legacy_evidence' && (args.canonical_events as string[]).some(canonical => JSON.parse(canonical).sequence === 0)) throw Error('Synthetic lower append unavailable before SQL commit');
  });
  assert.equal(await adapter.deliver(), false); assert.equal(adapter.view().delivery, 'pending'); equalPrivate(appendSequences(f), [0]);
  const eventIds = events(f).map(event => event.eventId), statuses = new Map(f.idb.entries('delivery').map(([, row]) => {
    const value = row as { eventId: string; status: string }; return [value.eventId, value.status];
  }));
  assert.equal(statuses.get(eventIds[0]), 'readback_required'); assert.equal(statuses.get(eventIds[1]), 'pending');
  assert.equal(f.idb.entries('batches').some(([, row]) => (row as { delivery: { status: string } }).delivery.status === 'quarantined'), false);
  equalPrivate(f.idb.entries('events'), beforeEvents);
  const attemptedLower = f.calls.find(call => call.name === 'append_language_legacy_evidence')!;
  f.rpcHooks(); assert.equal(await adapter.recover(), true, diagnostic(adapter)); assert.equal(adapter.view().delivery, 'pending');
  assert.equal(await adapter.deliver(), true, diagnostic(adapter)); assert.equal(adapter.view().delivery, 'verified');
  equalPrivate(appendSequences(f), [0, 0, 1]); equalPrivate(f.idb.entries('events'), beforeEvents);
  const appends = f.calls.filter(call => call.name === 'append_language_legacy_evidence');
  assert.equal(appends[1].args.batch_id, attemptedLower.args.batch_id, 'Recovery reuses the exact frozen lower batch');
  assert.equal(f.idb.entries('batches').every(([, row]) => (row as { delivery: { status: string } }).delivery.status === 'acknowledged'), true);
  assert.equal(JSON.stringify(f.calls).includes(RAW), false);
});

const viewIdentity = (adapter: CapturedCourseReviewAdapter) => ({ runId: adapter.view().runId, draftToken: adapter.view().draftToken, handoff: adapter.view().handoff });
async function verifiedPresentation(t: TestContext) {
  const f = await createLegacyReviewCaptureFixture(t, { sql: true }), adapter = await ready(f);
  assert.equal(await adapter.deliver(), true, diagnostic(adapter)); assert.equal(adapter.view().delivery, 'verified');
  return { f, adapter, oldIdentity: structuredClone(viewIdentity(adapter)), historyStart: f.views.length,
    oldAppendCount: f.calls.filter(call => call.name === 'append_language_legacy_evidence').length };
}
function assertInvalidationHistory(f: LegacyReviewCaptureFixture, historyStart: number, expectPending: boolean) {
  const history = f.views.slice(historyStart), invalidation = history.findIndex(view => view.delivery === 'unavailable');
  assert.ok(invalidation >= 0, 'A new event must synchronously invalidate the earlier verification claim');
  assert.equal(history.slice(invalidation).some(view => view.delivery === 'verified'), false, 'No old verification claim may survive an in-flight or uncertain new event');
  assert.equal(history.some(view => view.delivery === 'pending'), expectPending);
}
async function recoverAndVerifyExactEvent(f: LegacyReviewCaptureFixture, adapter: CapturedCourseReviewAdapter, beforeEvents: unknown, oldAppendCount: number) {
  assert.equal(await adapter.recover(), true, diagnostic(adapter)); assert.equal(adapter.view().delivery, 'pending');
  equalPrivate(f.idb.entries('events'), beforeEvents, 'Recovery preserves the exact already-committed event IDs and bytes');
  assert.equal(f.calls.filter(call => call.name === 'append_language_legacy_evidence').length, oldAppendCount, 'Local recovery cannot upload implicitly');
  assert.equal(await adapter.deliver(), true, diagnostic(adapter)); assert.equal(adapter.view().delivery, 'verified');
  equalPrivate(f.idb.entries('events'), beforeEvents); assert.equal(f.calls.filter(call => call.name === 'append_language_legacy_evidence').length, oldAppendCount + 1);
  const repo = await f.acquire(), prefix = await repo.readPrefix(); assert.equal(prefix.status, 'complete_authenticated_prefix');
  if (prefix.status !== 'complete_authenticated_prefix') throw Error('Expected independent exact SQL readback');
  equalPrivate(prefix.snapshot.records.map(row => row.event.eventId), events(f).map(event => event.eventId));
  assert.equal(JSON.stringify(f.calls).includes(RAW), false);
}

test('actual new event commit with failed independent readback invalidates verified before the commit and preserves old UI identity', async t => {
  const { f, adapter, oldIdentity, historyStart, oldAppendCount } = await verifiedPresentation(t); let deliveryAtCommit: string | null = null;
  f.idb.afterNextWriteCommit(() => { deliveryAtCommit = adapter.view().delivery; f.idb.failNextRead(); });
  assert.equal(await adapter.answer(RAW, observation), false); assert.equal(deliveryAtCommit, 'unavailable');
  assert.equal(adapter.view().delivery, 'unavailable'); equalPrivate(viewIdentity(adapter), oldIdentity);
  assert.equal(events(f).length, 2); assert.equal(f.idb.entries('batches').length, 1); assertInvalidationHistory(f, historyStart, false);
  await recoverAndVerifyExactEvent(f, adapter, f.idb.entries('events'), oldAppendCount);
});

test('batch quota follows proven event pending status but cannot publish new handoff until exact local recovery', async t => {
  const { f, adapter, oldIdentity, historyStart, oldAppendCount } = await verifiedPresentation(t); let deliveryAtCommit: string | null = null;
  f.idb.afterNextWriteCommit(() => { deliveryAtCommit = adapter.view().delivery; f.idb.quotaNextWrite(); });
  assert.equal(await adapter.answer(RAW, observation), false); assert.equal(deliveryAtCommit, 'unavailable');
  assert.equal(adapter.view().delivery, 'pending'); equalPrivate(viewIdentity(adapter), oldIdentity);
  assert.equal(events(f).length, 2); assert.equal(f.idb.entries('batches').length, 1); assertInvalidationHistory(f, historyStart, true);
  const firstPending = f.views.slice(historyStart).find(view => view.delivery === 'pending')!;
  equalPrivate({ runId: firstPending.runId, draftToken: firstPending.draftToken, handoff: firstPending.handoff }, oldIdentity, 'Pending status before batch persistence is status-only');
  await recoverAndVerifyExactEvent(f, adapter, f.idb.entries('events'), oldAppendCount);
});

test('post-commit observation revocation leaves the new event unavailable until exact explicit recovery', async t => {
  const { f, adapter, oldIdentity, historyStart, oldAppendCount } = await verifiedPresentation(t); let deliveryAtCommit: string | null = null;
  f.idb.afterNextWriteCommit(() => { deliveryAtCommit = adapter.view().delivery; adapter.suspend(); });
  assert.equal(await adapter.answer(RAW, observation), false); assert.equal(deliveryAtCommit, 'unavailable');
  assert.equal(adapter.view().delivery, 'unavailable'); equalPrivate(viewIdentity(adapter), oldIdentity);
  assert.equal(events(f).length, 2); assert.equal(f.idb.entries('batches').length, 1); assertInvalidationHistory(f, historyStart, false);
  await recoverAndVerifyExactEvent(f, adapter, f.idb.entries('events'), oldAppendCount);
});

test('metadata-only hint, publication, feedback, retry and clear do not invalidate a genuine prior verified delivery', async t => {
  const { f, adapter } = await verifiedPresentation(t); let start = f.views.length;
  assert.equal(await adapter.hint(), true); assert.equal(await observeReview(adapter, 'hint'), true);
  assert.equal(f.views.slice(start).every(view => view.delivery === 'verified'), true);
  assert.equal(await adapter.answer(RAW, observation), true, diagnostic(adapter)); assert.equal(await adapter.deliver(), true, diagnostic(adapter));
  assert.equal(adapter.view().delivery, 'verified'); start = f.views.length;
  assert.equal(await publish(adapter), true, diagnostic(adapter)); assert.equal(await observeReview(adapter, 'feedback'), true, diagnostic(adapter));
  assert.equal(await adapter.retryAnswer(), true); assert.equal(await adapter.cleared({ runId: adapter.view().runId!, draftToken: adapter.view().draftToken!, answer: '', hintShown: false, feedbackShown: false }), true);
  assert.equal(f.views.slice(start).every(view => view.delivery === 'verified'), true); assert.equal(events(f).length, 2);
});

// These temporary negative wrappers always execute the actual store first. They
// never manufacture successful admission/proof, and are restored before recovery.
for (const fault of ['transition_thrown', 'transition_absent', 'transition_mismatch', 'graph_thrown', 'graph_absent', 'graph_mismatch'] as const) test(`new event ${fault} readback cannot retain old verified or adopt its new handoff`, async t => {
  const { f, adapter, oldIdentity, historyStart, oldAppendCount } = await verifiedPresentation(t);
  const prototype = LocalEvidenceStore.prototype, realCommit = prototype.commitReviewTransition, realRead = prototype.readReviewTransition, realGraph = prototype.readReviewState;
  let commitReturned = false, faultCount = 0, labelAtCommit: string | null = null;
  prototype.commitReviewTransition = async function(this: LocalEvidenceStore, ...args: Parameters<typeof realCommit>) {
    const target = args[0].capture?.event?.sequence === 1;
    if (target) labelAtCommit = adapter.view().delivery;
    const result = await realCommit.apply(this, args); if (target) commitReturned = true; return result;
  };
  prototype.readReviewTransition = async function(this: LocalEvidenceStore, ...args: Parameters<typeof realRead>) {
    const result = await realRead.apply(this, args);
    if (!commitReturned || args[0].capture?.event?.sequence !== 1 || !fault.startsWith('transition_')) return result;
    faultCount++; assert.ok(result, 'The delegated real transition read must prove actual persistence before the negative response');
    if (fault === 'transition_thrown') throw Error('Synthetic transition readback unavailable');
    if (fault === 'transition_absent') return null;
    return { ...result, run: { ...result.run, state: { ...result.run.state, revision: result.run.state.revision + 1 } } };
  };
  prototype.readReviewState = async function(this: LocalEvidenceStore, ...args: Parameters<typeof realGraph>) {
    const result = await realGraph.apply(this, args);
    if (!commitReturned || !fault.startsWith('graph_')) return result;
    faultCount++; assert.ok(result.rowFence, 'The delegated real graph read must exist before the negative response');
    if (fault === 'graph_thrown') throw Error('Synthetic graph readback unavailable');
    if (fault === 'graph_absent') return { ...result, rowFence: null };
    return { ...result, rowFence: { ...result.rowFence, state: { ...result.rowFence.state, revision: result.rowFence.state.revision + 1 } } };
  };
  const restore = () => { prototype.commitReviewTransition = realCommit; prototype.readReviewTransition = realRead; prototype.readReviewState = realGraph; };
  t.after(restore);
  try {
    assert.equal(await adapter.answer(RAW, observation), false); assert.equal(faultCount, 1); assert.equal(labelAtCommit, 'unavailable');
    assert.equal(adapter.view().delivery, 'unavailable'); equalPrivate(viewIdentity(adapter), oldIdentity);
    assert.equal(events(f).length, 2); assert.equal(f.idb.entries('batches').length, 1); assertInvalidationHistory(f, historyStart, false);
  } finally { restore(); }
  await recoverAndVerifyExactEvent(f, adapter, f.idb.entries('events'), oldAppendCount);
});

async function deliveryBoundary(promise: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('Expected bounded delivery-test boundary')), 5000); })]); }
  finally { clearTimeout(timer); }
}

test('held actual commit and proof reads remain unavailable; pending appears before held batch persistence without handoff adoption', async t => {
  const { f, adapter, oldIdentity, historyStart } = await verifiedPresentation(t);
  const prototype = LocalEvidenceStore.prototype, realCommit = prototype.commitReviewTransition, realRead = prototype.readReviewTransition, realGraph = prototype.readReviewState, realBatch = prototype.putBatch;
  const commitEntered = deferred<void>(), permitCommit = deferred<void>(), commitDurable = deferred<void>(), permitCommitReturn = deferred<void>();
  const transitionRead = deferred<void>(), permitTransition = deferred<void>(), graphRead = deferred<void>(), permitGraph = deferred<void>(), batchEntered = deferred<void>(), permitBatch = deferred<void>();
  let commitReturned = false;
  prototype.commitReviewTransition = async function(this: LocalEvidenceStore, ...args: Parameters<typeof realCommit>) {
    if (args[0].capture?.event?.sequence !== 1) return realCommit.apply(this, args);
    commitEntered.resolve(); await permitCommit.promise;
    const result = await realCommit.apply(this, args); commitDurable.resolve(); await permitCommitReturn.promise; commitReturned = true; return result;
  };
  prototype.readReviewTransition = async function(this: LocalEvidenceStore, ...args: Parameters<typeof realRead>) {
    const result = await realRead.apply(this, args);
    if (commitReturned && args[0].capture?.event?.sequence === 1) { transitionRead.resolve(); await permitTransition.promise; }
    return result;
  };
  prototype.readReviewState = async function(this: LocalEvidenceStore, ...args: Parameters<typeof realGraph>) {
    const result = await realGraph.apply(this, args); if (commitReturned) { graphRead.resolve(); await permitGraph.promise; } return result;
  };
  prototype.putBatch = async function(this: LocalEvidenceStore, ...args: Parameters<typeof realBatch>) {
    if (args[1].events[0].sequence === 1) { batchEntered.resolve(); await permitBatch.promise; } return realBatch.apply(this, args);
  };
  const restore = () => { prototype.commitReviewTransition = realCommit; prototype.readReviewTransition = realRead; prototype.readReviewState = realGraph; prototype.putBatch = realBatch; };
  const release = () => { permitCommit.resolve(); permitCommitReturn.resolve(); permitTransition.resolve(); permitGraph.resolve(); permitBatch.resolve(); };
  t.after(() => { release(); restore(); });
  const answer = adapter.answer(RAW, observation);
  try {
    await deliveryBoundary(commitEntered.promise); assert.equal(adapter.view().delivery, 'unavailable'); equalPrivate(viewIdentity(adapter), oldIdentity); assert.equal(events(f).length, 1);
    permitCommit.resolve(); await deliveryBoundary(commitDurable.promise); assert.equal(adapter.view().delivery, 'unavailable'); equalPrivate(viewIdentity(adapter), oldIdentity); assert.equal(events(f).length, 2);
    permitCommitReturn.resolve(); await deliveryBoundary(transitionRead.promise); assert.equal(adapter.view().delivery, 'unavailable'); equalPrivate(viewIdentity(adapter), oldIdentity);
    permitTransition.resolve(); await deliveryBoundary(graphRead.promise); assert.equal(adapter.view().delivery, 'unavailable'); equalPrivate(viewIdentity(adapter), oldIdentity);
    permitGraph.resolve(); await deliveryBoundary(batchEntered.promise); assert.equal(adapter.view().delivery, 'pending'); equalPrivate(viewIdentity(adapter), oldIdentity); assert.equal(f.idb.entries('batches').length, 1);
    assertInvalidationHistory(f, historyStart, true);
    permitBatch.resolve(); assert.equal(await answer, true, diagnostic(adapter)); assert.equal(adapter.view().delivery, 'pending');
    assert.equal(adapter.view().handoff?.answer === RAW, true); assert.equal(f.idb.entries('batches').length, 2);
  } finally { release(); await answer; restore(); }
});
