import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePresentation, prepareAnswer, prepareCheckpointTransition } from './capture.ts';
import { canonicalEvidence, makeSourceSlotKey } from './validation.ts';
import { id, at, episode, catalogue } from './test-fixtures.ts';
import { localContext } from './local-test-fixtures.ts';
import { accountReviewRows, prepareReviewTransition, verifyReviewTransition, reviewTransitionRows, parseReviewImmutable,
  reviewRunKey, reviewRowFenceKey, reviewExposureKey, reviewJournalKey, REVIEW_LIMITS, reviewUtf8Bytes, reviewStoredRowBytes, parseReviewRun, type ReviewRunImmutable,
  type ReviewJournalPayload, type PreparedReviewTransition, type ReviewOperation } from './review-capture.ts';
import type { PreparedCapture } from './persistence-types.ts';

export function reviewFixture() {
  const context = localContext(), event = episode(0, { presentationOnly: true })[0];
  event.hintUsed = null; event.answerPreviouslyRevealed = null;
  const identity = { itemId: event.itemId, contentRevision: event.contentRevision, taskId: event.taskId, lessonId: event.lessonId,
    legacyQuestionId: event.legacyQuestionId!, taskFormat: 'meaning_choice' as const, gradingVersion: event.gradingVersion };
  const rowBytes = `{ "id": ${JSON.stringify(event.legacyQuestionId)}, "opaque":1e999, "escaped":"\\u65e5" }`;
  const immutable: ReviewRunImmutable = { ownerId: context.ownerId, generationId: context.generationId, incarnationId: id(), runId: id(), episodeId: event.episodeId,
    rowKey: event.legacyQuestionId!, slot: JSON.stringify([event.taskId, event.contentRevision, event.taskFormat]), sourceSlotKey: event.sourceSlotKey,
    identity, mode: 'reader', initialDraftToken: id(), originalSource: { key: 'japaneseCurriculumReviewV1', arrayBytes: `[\n${rowBytes}\n]`, rowBytes, rowIndex: 0 } };
  return { context, event, immutable };
}
const snapshot = (p: PreparedReviewTransition): ReviewJournalPayload['before'] => JSON.parse(p.journal.canonical).after;
async function start() {
  const f = reviewFixture(), actionId = id(), observationId = id();
  const acquire = await prepareReviewTransition({ ...f, fence: f.context, transitionId: id(), actionId,
    before: { runState: null, exposure: null, rowFence: null }, operation: { kind: 'acquire', observationId } });
  const capture = await preparePresentation({ transitionId: id(), event: f.event, actualVisible: true, history: 'new_session', timingObserved: true }, f.context, catalogue);
  const present = await prepareReviewTransition({ fence: f.context, immutable: f.immutable, transitionId: capture.transitionId, actionId,
    before: snapshot(acquire), operation: { kind: 'presentation', observed: { observationId, actualVisible: true, targetText: false, reading: false, answer: false } }, capture });
  return { ...f, acquire, present, capture };
}
function rows(p: PreparedReviewTransition) {
  const next = reviewTransitionRows(p), payload = JSON.parse(p.journal.canonical);
  return [{ store: 'reviewRuns' as const, key: reviewRunKey(p.immutable), value: next.run },
    { store: 'reviewRuns' as const, key: reviewRowFenceKey({ ...p.immutable }), value: next.rowFence },
    { store: 'itemExposures' as const, key: reviewExposureKey({ ...p.immutable, ...p.immutable.identity }), value: next.exposure },
    { store: 'reviewTransitions' as const, key: reviewJournalKey(p.immutable, payload.transitionId), value: p.journal }];
}
test('metadata acquisition retains lossless source, unknown history and a pending question without a checkpoint/event', async () => {
  const f = await start(), payload = JSON.parse(f.acquire.journal.canonical), r = reviewTransitionRows(f.acquire);
  assert.equal(f.acquire.capture, null); assert.equal(payload.captureRef, null); assert.equal(r.run.state.checkpoint, null);
  assert.equal(r.exposure?.answer, null); assert.equal(r.exposure?.coverage, 'unknown'); assert.equal(r.exposure?.pending.length, 1);
  assert.equal(r.run.immutable.originalSource.arrayBytes, f.immutable.originalSource.arrayBytes);
  assert.ok(!f.acquire.journal.canonical.includes('opaque'));
  assert.equal(reviewTransitionRows(f.present).run.state.phase, 'answerable');
  assert.equal(reviewTransitionRows(f.present).exposure?.pending.length, 0);
  assert.equal(reviewTransitionRows(f.present).run.state.action, null);
  assert.equal(accountReviewRows(rows(f.acquire), f.context.ownerId).journals, 4);
});
test('strict schemas reject extra keys, source substitution, duplicate decoded IDs, wrong descriptor and unsafe revisions', async () => {
  const f = await start();
  assert.throws(() => parseReviewImmutable({ ...f.immutable, injected: 'answer' }), /corrupt_record/);
  assert.throws(() => parseReviewImmutable({ ...f.immutable, originalSource: { ...f.immutable.originalSource, rowBytes: '{}' } }), /corrupt_record/);
  assert.throws(() => parseReviewImmutable({ ...f.immutable, originalSource: { ...f.immutable.originalSource, arrayBytes: `[${f.immutable.originalSource.rowBytes},${f.immutable.originalSource.rowBytes}]` } }), /corrupt_record/);
  assert.throws(() => parseReviewImmutable({ ...f.immutable, identity: { ...f.immutable.identity, itemId: 'wrong' } }), /corrupt_record/);
  const bad = structuredClone(f.present); const p = JSON.parse(bad.journal.canonical); p.after.runState.revision = Number.MAX_SAFE_INTEGER + 1; (bad.journal as { canonical: string }).canonical = canonicalEvidence(p);
  await assert.rejects(verifyReviewTransition(bad), /corrupt_record/);
});
test('unproven false assistance cannot be introduced by a caller-prepared presentation', async () => {
  const f = await start(), event = { ...f.event, hintUsed: false };
  const capture = await preparePresentation({ transitionId: id(), event, actualVisible: true, history: 'new_session', timingObserved: true }, f.context, catalogue);
  const p = JSON.parse(f.present.journal.canonical);
  await assert.rejects(prepareReviewTransition({ fence: f.context, immutable: f.immutable, transitionId: capture.transitionId,
    actionId: p.actionId, before: snapshot(f.acquire), operation: p.operation, capture }), /corrupt_record/);
});
test('answer reserves feedback and compatibility in either order; retry requires observed feedback and exact local-clear ack', async () => {
  for (const feedbackFirst of [true, false]) {
    const f = await start(), answerId = id(), observationId = id(), sentinel = 'PRIVATE_raw_回答_701';
    const capture = await prepareAnswer(f.capture.checkpoint, { transitionId: id(), eventId: id(), occurredAt: at(0, 1000), recordTimezone: 'Asia/Seoul', correct: false, responseMs: 100,
      handoff: { draftToken: f.immutable.initialDraftToken, answer: sentinel, observation: { neededHelp: true, modality: 'meaning', responseMs: 100.5 } } }, f.context, catalogue);
    let current = await prepareReviewTransition({ fence: f.context, immutable: f.immutable, transitionId: capture.transitionId, actionId: answerId, before: snapshot(f.present), operation: { kind: 'answer', observationId }, capture });
    assert.equal(snapshot(current).runState?.hadWrong, true); assert.equal(snapshot(current).runState?.neededHelp, true);
    assert.ok(!current.journal.canonical.includes(sentinel)); assert.ok(canonicalEvidence(capture).includes(sentinel));
    let cp = capture.checkpoint;
    for (const kind of feedbackFirst ? ['observe_feedback', 'compatibility_applied'] : ['compatibility_applied', 'observe_feedback']) {
      let next: PreparedCapture | null = null; let operation: ReviewOperation;
      if (kind === 'observe_feedback') operation = { kind, observed: { observationId, actualVisible: true, targetText: false, reading: false, answer: true } };
      else { next = prepareCheckpointTransition(cp, { kind: 'compatibility_applied', eventId: cp.handoff!.eventId, survivingDraftToken: f.immutable.initialDraftToken }, f.context, id()); cp = next.checkpoint;
        operation = { kind: 'compatibility_applied' }; }
      current = await prepareReviewTransition({ fence: f.context, immutable: f.immutable, transitionId: next?.transitionId ?? id(), actionId: answerId, before: snapshot(current), operation, capture: next });
    }
    assert.equal(snapshot(current).runState?.phase, 'answered'); assert.equal(snapshot(current).runState?.action, null);
    const retryId = id(), retry = prepareCheckpointTransition(cp, { kind: 'retry', occurredAt: at(0, 2000) }, f.context, id());
    current = await prepareReviewTransition({ fence: f.context, immutable: f.immutable, transitionId: retry.transitionId, actionId: retryId, before: snapshot(current), operation: { kind: 'retry', draftToken: id() }, capture: retry });
    assert.equal(snapshot(current).runState?.phase, 'answered');
    current = await prepareReviewTransition({ fence: f.context, immutable: f.immutable, transitionId: id(), actionId: retryId, before: snapshot(current), operation: { kind: 'ack_retry' } });
    assert.equal(snapshot(current).runState?.phase, 'answerable'); assert.equal(snapshot(current).runState?.neededHelp, true); assert.equal(snapshot(current).runState?.hadWrong, true);
  }
});
test('unobserved question cancellation creates no presentation and never turns unknown into false', async () => {
  const f = await start(), p = JSON.parse(f.acquire.journal.canonical);
  const cancel = await prepareReviewTransition({ fence: f.context, immutable: f.immutable, transitionId: id(), actionId: p.actionId, before: snapshot(f.acquire), operation: { kind: 'cancel_reveal' } });
  const r = reviewTransitionRows(cancel); assert.equal(r.run.state.phase, 'unavailable'); assert.equal(r.run.state.checkpoint, null);
  assert.equal(r.exposure?.pending.length, 0); assert.equal(r.exposure?.answer, null); assert.equal(cancel.capture, null);
});
test('retirement has an exact response-free binding and cannot be cleared by unavailable-close', async () => {
  const f = await start(), retirementId = id();
  const retire = await prepareReviewTransition({ fence: f.context, immutable: f.immutable, transitionId: id(), actionId: retirementId,
    before: snapshot(f.present), operation: { kind: 'begin_retirement', retirementKind: 'defer' } });
  const state = snapshot(retire); assert.equal(state.runState?.lifecycle, 'retiring'); assert.equal(state.runState?.terminal, null);
  assert.equal(state.rowFence?.retirement?.retirementId, retirementId);
  await assert.rejects(prepareReviewTransition({ fence: f.context, immutable: f.immutable, transitionId: id(), actionId: id(), before: state, operation: { kind: 'close_unavailable' } }), /review_conflict/);
  const close = await prepareReviewTransition({ fence: f.context, immutable: f.immutable, transitionId: id(), actionId: retirementId, before: state,
    operation: { kind: 'close_retirement', outcome: { operationId: id(), result: { id: f.immutable.rowKey, intervalDays: 1, nextReviewAt: f.context.now, reviewed: false } } } });
  assert.equal(snapshot(close).runState?.lifecycle, 'closed'); assert.equal(snapshot(close).rowFence?.pointers.length, 0);
  assert.equal(reviewTransitionRows(close).run.managedSlot, reviewTransitionRows(f.acquire).run.managedSlot);
});
test('UTF-8 source and encoded row/journal budgets are distinct, counted with retained reservations', async () => {
  const f = reviewFixture();
  const make = (padding: string) => { const rowBytes = JSON.stringify({ id: f.immutable.rowKey, padding }); return { ...f.immutable,
    originalSource: { ...f.immutable.originalSource, rowBytes, arrayBytes: `[${rowBytes}]` } }; };
  const base = make(''), exact = make('a'.repeat(REVIEW_LIMITS.sourceBytes - new TextEncoder().encode(base.originalSource.arrayBytes).length));
  assert.equal(new TextEncoder().encode(exact.originalSource.arrayBytes).length, REVIEW_LIMITS.sourceBytes); assert.doesNotThrow(() => parseReviewImmutable(exact));
  assert.throws(() => parseReviewImmutable(make('a'.repeat(REVIEW_LIMITS.sourceBytes))), /review_capacity/);
  assert.throws(() => parseReviewImmutable(make('日'.repeat(REVIEW_LIMITS.sourceBytes / 2))), /review_capacity/);
  const s = await start(), totals = accountReviewRows(rows(s.acquire), s.context.ownerId);
  assert.ok(totals.bytes > REVIEW_LIMITS.terminalBytes + REVIEW_LIMITS.journalBytes);
  assert.ok(reviewUtf8Bytes(s.acquire.journal) < REVIEW_LIMITS.journalBytes);
  assert.equal(s.immutable.sourceSlotKey, makeSourceSlotKey(s.context.ownerId, { ...s.immutable.identity, generationId: s.context.generationId, episodeId: s.immutable.episodeId, source: 'course_review' }));
});

test('each maximum authored-identity settlement fits the previously reserved byte and journal allowance', async () => {
  const f = await start(), before = snapshot(f.present), actionId = id();
  const retire = await prepareReviewTransition({ fence: f.context, immutable: f.immutable, transitionId: id(), actionId, before,
    operation: { kind: 'begin_retirement', retirementKind: 'delete' } });
  const close = await prepareReviewTransition({ fence: f.context, immutable: f.immutable, transitionId: id(), actionId, before: snapshot(retire),
    operation: { kind: 'close_retirement', outcome: { operationId: id(), result: { deleted: true } } } });
  const previous = accountReviewRows(rows(retire), f.context.ownerId), nextRows = rows(close);
  nextRows.push({ store: 'reviewTransitions', key: reviewJournalKey(f.immutable, JSON.parse(retire.journal.canonical).transitionId), value: retire.journal });
  const after = accountReviewRows(nextRows, f.context.ownerId);
  assert.ok(after.bytes <= previous.bytes, `${after.bytes} must fit reservation ${previous.bytes}`);
  assert.ok(after.journals <= previous.journals);
  const cancelledAction = snapshot(f.acquire).runState!.action!;
  assert.equal(cancelledAction.remainingSlots, 1); assert.ok(cancelledAction.remainingBytes <= REVIEW_LIMITS.actionBytes);
  const answerId = id(), capture = await prepareAnswer(f.capture.checkpoint, { transitionId: id(), eventId: id(), occurredAt: at(0, 1000), recordTimezone: 'Asia/Seoul', correct: true,
    responseMs: null, handoff: { draftToken: f.immutable.initialDraftToken, answer: 'a'.repeat(4096), observation: { neededHelp: false, modality: 'meaning', responseMs: 600000 } } }, f.context, catalogue);
  const observationId = id(), answer = await prepareReviewTransition({ fence: f.context, immutable: f.immutable, transitionId: capture.transitionId, actionId: answerId, before,
    operation: { kind: 'answer', observationId }, capture });
  const feedback = await prepareReviewTransition({ fence: f.context, immutable: f.immutable, transitionId: id(), actionId: answerId, before: snapshot(answer),
    operation: { kind: 'observe_feedback', observed: { observationId, actualVisible: true, targetText: true, reading: true, answer: true } } });
  const answerRows = rows(answer), feedbackRows = rows(feedback); feedbackRows.push(answerRows[3]);
  assert.ok(accountReviewRows(feedbackRows, f.context.ownerId).bytes <= accountReviewRows(answerRows, f.context.ownerId).bytes);
});

test('accounting enforces exact owner-byte and journal ceilings including UTF-8 keys and terminal reservations', async () => {
  const f = await start(), original = rows(f.acquire), totals = accountReviewRows(original, f.context.ownerId);
  const run = original[0].value as ReturnType<typeof reviewTransitionRows>['run'];
  // Source bytes are charged twice here (array plus selected row). Keep the
  // source ceiling intact; repeated closed runs model retained history.
  const retained = [] as typeof original;
  for (let i = 0; i < 64; i++) {
    const immutable = { ...f.immutable, runId: id(), episodeId: id(), initialDraftToken: id() };
    immutable.sourceSlotKey = makeSourceSlotKey(immutable.ownerId, { ...immutable.identity, generationId: immutable.generationId, episodeId: immutable.episodeId, source: 'course_review' });
    const closed = { ...run, immutable, managedSlot: JSON.stringify([immutable.ownerId, immutable.generationId, immutable.sourceSlotKey]), state: { ...run.state, lifecycle: 'closed' as const, phase: 'unavailable' as const, action: null, terminal: null } };
    retained.push({ store: 'reviewRuns', key: reviewRunKey(immutable), value: closed });
  }
  retained.push({ store: 'reviewRuns', key: reviewRowFenceKey(f.immutable), value: { ...reviewTransitionRows(f.acquire).rowFence, state: { ...reviewTransitionRows(f.acquire).rowFence.state, pointers: [] } } });
  assert.equal(accountReviewRows(retained, f.context.ownerId).runs, 64);
  const duplicate = structuredClone(retained[0]);
  assert.throws(() => accountReviewRows([...retained, duplicate], f.context.ownerId), /corrupt_record/);
  assert.ok(totals.bytes < REVIEW_LIMITS.ownerBytes);
});

test('complete stored-run limit includes the encoded key and escaping; worst-state admission refuses before acquisition', async () => {
  const f = await start(), row = structuredClone(reviewTransitionRows(f.acquire).run);
  row.state = { ...row.state, lifecycle: 'closed', phase: 'unavailable', action: null, terminal: null };
  const source = (slashes: number, spaces: number) => {
    const rowBytes = JSON.stringify({ id: f.immutable.rowKey, padding: '\\'.repeat(slashes) });
    row.immutable.originalSource = { ...row.immutable.originalSource, rowBytes, arrayBytes: `[${rowBytes}]${' '.repeat(spaces)}` };
  };
  source(0, 0); const base = reviewStoredRowBytes(reviewRunKey(row.immutable), row), slashes = Math.floor((REVIEW_LIMITS.runBytes - base) / 8);
  source(slashes, 0); const remainder = REVIEW_LIMITS.runBytes - reviewStoredRowBytes(reviewRunKey(row.immutable), row);
  source(slashes, remainder);
  assert.equal(reviewStoredRowBytes(reviewRunKey(row.immutable), row), REVIEW_LIMITS.runBytes);
  assert.ok(new TextEncoder().encode(row.immutable.originalSource.arrayBytes).byteLength <= REVIEW_LIMITS.sourceBytes);
  assert.doesNotThrow(() => parseReviewRun(row));
  row.immutable.originalSource.arrayBytes += ' ';
  assert.equal(reviewStoredRowBytes(reviewRunKey(row.immutable), row), REVIEW_LIMITS.runBytes + 1);
  assert.throws(() => parseReviewRun(row), /review_capacity/);
  await assert.rejects(prepareReviewTransition({ fence: f.context, immutable: row.immutable, transitionId: id(), actionId: id(),
    before: { runState: null, exposure: null, rowFence: null }, operation: { kind: 'acquire', observationId: id() } }), /review_capacity/);
});
