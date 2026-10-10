import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createAdmittedLegacyEvidenceRepositoryFixture } from '../../tests/helpers/legacyEvidenceRepositoryHarness.ts';
import { LocalEvidenceStore, checkpointStorageKey } from './local-store.ts';
import { preparePresentation, prepareAnswer, prepareCheckpointTransition } from './capture.ts';
import { LEGACY_EVIDENCE_CATALOGUE } from './catalogue.ts';
import { canonicalEvidence, makeSourceSlotKey } from './validation.ts';
import { id, episode } from './test-fixtures.ts';
import { prepareReviewTransition, reviewTransitionRows, reviewRunKey, reviewRowFenceKey, reviewExposureKey, reviewJournalKey,
  accountReviewRows, REVIEW_LIMITS, type ReviewAccountingRow, type ReviewRunImmutable, type PreparedReviewTransition, type ReviewJournalPayload, type ReviewOperation } from './review-capture.ts';

const snap = (p: PreparedReviewTransition): ReviewJournalPayload['before'] => JSON.parse(p.journal.canonical).after;
async function fixture(t: TestContext) {
  const f = await createAdmittedLegacyEvidenceRepositoryFixture(t), context = { ...f.context, now: new Date(Date.parse(f.context.now) + 10000).toISOString() };
  const event = episode(0, { presentationOnly: true })[0]; event.generationId = f.generationId; event.occurredAt = f.context.now; event.hintUsed = null; event.answerPreviouslyRevealed = null;
  event.sourceSlotKey = makeSourceSlotKey(f.owner, event);
  const rowBytes = `{ "id": ${JSON.stringify(event.legacyQuestionId)}, "untouched":1e999 }`;
  const immutable: ReviewRunImmutable = { ownerId: f.owner, generationId: f.generationId, incarnationId: f.incarnationId, runId: id(), episodeId: event.episodeId,
    rowKey: event.legacyQuestionId!, slot: JSON.stringify([event.taskId, event.contentRevision, event.taskFormat]), sourceSlotKey: event.sourceSlotKey,
    identity: { itemId: event.itemId, contentRevision: event.contentRevision, taskId: event.taskId, lessonId: event.lessonId, legacyQuestionId: event.legacyQuestionId!, taskFormat: 'meaning_choice', gradingVersion: event.gradingVersion },
    mode: 'reader', initialDraftToken: id(), originalSource: { key: 'japaneseCurriculumReviewV1', arrayBytes: `[${rowBytes}]`, rowBytes, rowIndex: 0 } };
  const actionId = id(), observationId = id(), acquire = await prepareReviewTransition({ fence: context, immutable, transitionId: id(), actionId,
    before: { runState: null, exposure: null, rowFence: null }, operation: { kind: 'acquire', observationId } });
  const capture = await preparePresentation({ transitionId: id(), event, actualVisible: true, history: 'new_session', timingObserved: true }, context, LEGACY_EVIDENCE_CATALOGUE);
  const present = await prepareReviewTransition({ fence: context, immutable, transitionId: capture.transitionId, actionId, before: snap(acquire),
    operation: { kind: 'presentation', observed: { observationId, actualVisible: true, targetText: false, reading: false, answer: false } }, capture });
  const metadata = (before: PreparedReviewTransition, actionId: string, operation: ReviewOperation) => prepareReviewTransition({ fence: context, immutable, transitionId: id(), actionId, before: snap(before), operation });
  return { ...f, context, event, immutable, acquire, capture, present, metadata };
}
async function start(t: TestContext) { const f = await fixture(t); await f.store.commitReviewTransition(f.acquire); await f.store.commitReviewTransition(f.present); return f; }

test('registered two-facade acquisition/presentation is atomic and exact read-first retries reuse journals', async t => {
  const f = await fixture(t), second = f.secondRepository.store();
  const replies = await Promise.all([f.store.commitReviewTransition(f.acquire), second.commitReviewTransition(f.acquire, f.secondRepository.context())]);
  assert.equal(replies.length, 2); assert.equal(f.adapter.entries('events').length, 0); assert.equal(f.adapter.entries('checkpoints').length, 0);
  assert.equal(f.adapter.entries('reviewRuns').length, 2); assert.equal(f.adapter.entries('reviewTransitions').length, 1);
  await Promise.all([f.store.commitReviewTransition(f.present), second.commitReviewTransition(f.present, f.secondRepository.context())]);
  assert.equal(f.adapter.entries('events').length, 1); assert.equal(f.adapter.entries('reviewTransitions').length, 2);
  const found = await second.findReviewRun(f.secondRepository.context(), { scope: f.immutable, rowKey: f.immutable.rowKey, slot: f.immutable.slot, originalSource: f.immutable.originalSource, mode: f.immutable.mode });
  assert.equal(found?.run.immutable.runId, f.immutable.runId); assert.equal(found?.run.state.phase, 'answerable');
});
test('review writes require real explicit admission; the old isolated constructor cannot authorize them', async t => {
  const f = await fixture(t), old = new LocalEvidenceStore({ factory: f.adapter.factory, isCurrent: () => true });
  const before = f.adapter.entries('reviewRuns'); await assert.rejects(old.commitReviewTransition(f.acquire), /stale_context/); assert.deepEqual(f.adapter.entries('reviewRuns'), before);
});
test('managed slots permanently reject old commit replay/checkpoint/audio paths, while unrelated legacy slots retain behavior', async t => {
  const f = await start(t); await assert.rejects(f.store.commit(f.capture), /managed_review_slot/);
  const hint = prepareCheckpointTransition(f.capture.checkpoint, { kind: 'hint' }, f.context, id());
  await assert.rejects(f.store.commit(hint), /managed_review_slot/);
  const audio = prepareCheckpointTransition(f.capture.checkpoint, { kind: 'audio_requested', requestId: id(), sourceSlotKey: f.immutable.sourceSlotKey, episodeId: f.immutable.episodeId, promptMatchesTask: true }, f.context, id());
  await assert.rejects(f.store.commit(audio), /managed_review_slot/); assert.equal(f.adapter.entries('audioBindings').length, 0);
  const close = await f.metadata(f.present, id(), { kind: 'close_unavailable' }); await f.store.commitReviewTransition(close);
  await assert.rejects(f.store.commit(f.capture), /managed_review_slot/);
  assert.equal((await f.store.recoverOutbox(f.context)).events.length, 1);
});
test('acquisition cannot adopt an already occupied legacy slot', async t => {
  const f = await fixture(t); await f.store.commit(f.capture);
  await assert.rejects(f.store.commitReviewTransition(f.acquire), /managed_review_slot/); assert.equal(f.adapter.entries('reviewRuns').length, 0);
});
test('historical acquire/presentation proof survives later exposure, retirement and close, but missing dependencies fail closed', async t => {
  const f = await start(t), hintAction = id(), observationId = id();
  const intent = await f.metadata(f.present, hintAction, { kind: 'begin_reveal', surface: 'hint', observationId }); await f.store.commitReviewTransition(intent);
  const capture = prepareCheckpointTransition(f.capture.checkpoint, { kind: 'hint' }, f.context, id());
  const hint = await prepareReviewTransition({ fence: f.context, immutable: f.immutable, transitionId: capture.transitionId, actionId: hintAction, before: snap(intent),
    operation: { kind: 'observed_hint', observed: { observationId, actualVisible: true, targetText: false, reading: false, answer: true } }, capture }); await f.store.commitReviewTransition(hint);
  assert.ok(await f.store.readReviewTransition(f.present)); assert.ok(await f.store.readReviewTransition(f.acquire));
  const retirementId = id(), retiring = await f.metadata(hint, retirementId, { kind: 'begin_retirement', retirementKind: 'delete' }); await f.store.commitReviewTransition(retiring);
  const close = await f.metadata(retiring, retirementId, { kind: 'close_retirement', outcome: { operationId: id(), result: { deleted: true } } }); await f.store.commitReviewTransition(close);
  assert.equal((await f.store.readReviewTransition(f.present))?.run.state.lifecycle, 'closed');
  f.adapter.tamper('commits', JSON.stringify([f.owner, f.generationId, f.capture.transitionId]), value => ({ ...(value as object), canonical: '{}' }));
  await assert.rejects(f.store.readReviewTransition(close), /corrupt_record/);
});
test('pending hint blocks a prepared answer; stale exact run/exposure CAS cannot pass after another facade writes', async t => {
  const f = await start(t), answerCapture = await prepareAnswer(f.capture.checkpoint, { transitionId: id(), eventId: id(), occurredAt: new Date(Date.parse(f.context.now) - 9000).toISOString(), recordTimezone: 'UTC', correct: true, responseMs: 10,
    handoff: { draftToken: f.immutable.initialDraftToken, answer: 'sentinel_PRIVATE_701', observation: { neededHelp: false, modality: 'meaning' } } }, f.context, LEGACY_EVIDENCE_CATALOGUE);
  const answer = await prepareReviewTransition({ fence: f.context, immutable: f.immutable, transitionId: answerCapture.transitionId, actionId: id(), before: snap(f.present), operation: { kind: 'answer', observationId: id() }, capture: answerCapture });
  const hint = await f.metadata(f.present, id(), { kind: 'begin_reveal', surface: 'hint', observationId: id() }); await f.secondRepository.store().commitReviewTransition(hint, f.secondRepository.context());
  await assert.rejects(f.store.commitReviewTransition(answer), /review_conflict/); assert.equal(f.adapter.entries('events').length, 1);
  assert.ok(!JSON.stringify(f.adapter.entries('reviewTransitions')).includes('sentinel_PRIVATE_701'));
});
test('metadata and capture writes remain all-or-none on physical quota and preserve exact reservation on completion loss', async t => {
  for (const phase of ['acquire', 'present'] as const) await t.test(phase, async sub => {
    const f = await fixture(sub); if (phase === 'present') await f.store.commitReviewTransition(f.acquire);
    const before = ['reviewRuns', 'itemExposures', 'reviewTransitions', 'events', 'checkpoints', 'commits'].map(name => [name, f.adapter.entries(name)]);
    f.adapter.quotaNextWrite(); await assert.rejects(f.store.commitReviewTransition(f[phase]), /storage_quota/);
    assert.deepEqual(['reviewRuns', 'itemExposures', 'reviewTransitions', 'events', 'checkpoints', 'commits'].map(name => [name, f.adapter.entries(name)]), before);
    f.adapter.loseNextCommitResponseForStoreWrite('reviewTransitions'); await f.store.commitReviewTransition(f[phase]);
    assert.ok(await f.store.readReviewTransition(f[phase]));
  });
});
test('same-ID canonical mutation and revision-only ABA never become a valid replay', async t => {
  const f = await start(t), changed = structuredClone(f.acquire), payload = JSON.parse(changed.journal.canonical);
  payload.operation.observationId = id(); (changed.journal as { canonical: string }).canonical = canonicalEvidence(payload);
  await assert.rejects(f.store.commitReviewTransition(changed), /corrupt_record|event_conflict/);
  f.adapter.tamper('reviewRuns', reviewRunKey(f.immutable), value => { const row = value as ReturnType<typeof reviewTransitionRows>['run']; row.state.neededHelp = true; return row; });
  await assert.rejects(f.store.readReviewTransition(f.present), /corrupt_record/);
});
test('retirement prevents changed-source activation and every nonsettlement action; closed data retains immutable source', async t => {
  const f = await start(t), actionId = id(), retire = await f.metadata(f.present, actionId, { kind: 'begin_retirement', retirementKind: 'defer' }); await f.store.commitReviewTransition(retire);
  await assert.rejects(f.store.findReviewRun(f.context, { scope: f.immutable, rowKey: f.immutable.rowKey, slot: f.immutable.slot, originalSource: f.immutable.originalSource, mode: 'starter' }), /review_conflict/);
  await assert.rejects(f.metadata(retire, id(), { kind: 'close_unavailable' }), /review_conflict/);
  assert.equal(f.adapter.entries('reviewTransitions').length, 3);
  const close = await f.metadata(retire, actionId, { kind: 'close_retirement', outcome: { operationId: id(), result: { id: f.immutable.rowKey, intervalDays: 1, nextReviewAt: f.context.now, reviewed: false } } }); await f.store.commitReviewTransition(close);
  assert.equal((f.adapter.inspect('reviewRuns', reviewRunKey(f.immutable)) as { immutable: ReviewRunImmutable }).immutable.originalSource.arrayBytes, f.immutable.originalSource.arrayBytes);
  await assert.rejects(f.store.commitReviewTransition(retire).then(result => { assert.equal(result.run.state.lifecycle, 'retiring'); }), /AssertionError/);
});
test('admission removal, repository close and epoch replacement revoke retained review writers', async t => {
  for (const fault of ['admission', 'close', 'epoch'] as const) await t.test(fault, async sub => {
    const f = await fixture(sub);
    if (fault === 'admission') f.adapter.tamper('admissions', JSON.stringify([f.owner, f.generationId]), value => ({ ...(value as object), incarnationId: id() }));
    else if (fault === 'close') f.repository.close();
    else { await f.local.owner(id()); await f.local.owner(f.owner); }
    await assert.rejects(f.store.commitReviewTransition(f.acquire), /stale_context/); assert.equal(f.adapter.entries('reviewRuns').length, 0);
  });
});

test('independent acquisition candidates converge to one stable run, then explicit close permits a distinct episode', async t => {
  const f = await fixture(t), immutable = { ...f.immutable, runId: id(), episodeId: id(), initialDraftToken: id() };
  immutable.sourceSlotKey = makeSourceSlotKey(f.owner, { ...immutable.identity, generationId: f.generationId, episodeId: immutable.episodeId, source: 'course_review' });
  const candidate = await prepareReviewTransition({ fence: f.secondRepository.context(), immutable, transitionId: id(), actionId: id(), before: { runState: null, exposure: null, rowFence: null }, operation: { kind: 'acquire', observationId: id() } });
  const result = await Promise.all([f.store.findOrAcquireReviewRun(f.acquire), f.secondRepository.store().findOrAcquireReviewRun(candidate)]);
  assert.equal(result[0].run.immutable.runId, result[1].run.immutable.runId); assert.equal(f.adapter.entries('reviewTransitions').length, 1);
  const winner = result[0], acquire = winner.run.immutable.runId === f.immutable.runId ? f.acquire : candidate;
  const cancelled = await prepareReviewTransition({ fence: f.context, immutable: acquire.immutable, transitionId: id(), actionId: snap(acquire).runState!.action!.rootActionId, before: snap(acquire), operation: { kind: 'cancel_reveal' } });
  await f.store.commitReviewTransition(cancelled);
  const closed = await prepareReviewTransition({ fence: f.context, immutable: acquire.immutable, transitionId: id(), actionId: id(), before: snap(cancelled), operation: { kind: 'close_unavailable' } }); await f.store.commitReviewTransition(closed);
  const retained = await f.store.readReviewState(f.context, { ...f.immutable, ...f.immutable.identity });
  const next = { ...f.immutable, runId: id(), episodeId: id(), initialDraftToken: id() };
  next.sourceSlotKey = makeSourceSlotKey(f.owner, { ...next.identity, generationId: f.generationId, episodeId: next.episodeId, source: 'course_review' });
  const fresh = await prepareReviewTransition({ fence: f.context, immutable: next, transitionId: id(), actionId: id(), before: { runState: null, exposure: retained.exposure, rowFence: retained.rowFence!.state }, operation: { kind: 'acquire', observationId: id() } });
  const reopened = await f.store.findOrAcquireReviewRun(fresh); assert.equal(reopened.run.immutable.episodeId, next.episodeId);
  assert.notEqual(next.episodeId, winner.run.immutable.episodeId); assert.equal(f.adapter.entries('reviewRuns').length, 3);
  assert.equal((await f.store.readReviewTransition(closed))?.run.state.lifecycle, 'closed');
});

test('cross-format pending question and uncertain retirement cannot be bypassed by another mode/source', async t => {
  const f = await fixture(t), task = LEGACY_EVIDENCE_CATALOGUE.find(task => task.bindings.some(b => b.source === 'course_review' && b.taskFormat === 'typed_answer'))!;
  const rowBytes = JSON.stringify({ id: task.legacyQuestionId });
  const make = (format: 'meaning_choice' | 'typed_answer'): ReviewRunImmutable => {
    const binding = task.bindings.find(b => b.source === 'course_review' && b.taskFormat === format)!;
    const value = { ...f.immutable, runId: id(), episodeId: id(), initialDraftToken: id(), rowKey: task.legacyQuestionId!, slot: JSON.stringify([task.taskId, task.contentRevision, format]),
      identity: { itemId: task.itemId, contentRevision: task.contentRevision, taskId: task.taskId, lessonId: task.lessonId, legacyQuestionId: task.legacyQuestionId!, taskFormat: format, gradingVersion: binding.gradingVersion },
      originalSource: { key: 'japaneseCurriculumReviewV1' as const, arrayBytes: `[${rowBytes}]`, rowBytes, rowIndex: 0 } };
    value.sourceSlotKey = makeSourceSlotKey(f.owner, { ...value.identity, generationId: f.generationId, episodeId: value.episodeId, source: 'course_review' }); return value;
  };
  const first = make('meaning_choice'), aId = id(), a = await prepareReviewTransition({ fence: f.context, immutable: first, transitionId: id(), actionId: aId,
    before: { runState: null, exposure: null, rowFence: null }, operation: { kind: 'acquire', observationId: id() } }); await f.store.commitReviewTransition(a);
  const second = make('typed_answer'), bId = id(), b = await prepareReviewTransition({ fence: f.context, immutable: second, transitionId: id(), actionId: bId,
    before: { runState: null, exposure: snap(a).exposure, rowFence: snap(a).rowFence }, operation: { kind: 'acquire', observationId: id() } }); await f.store.commitReviewTransition(b);
  assert.equal(snap(b).exposure?.pending.length, 2);
  const current = await f.store.readReviewState(f.context, { ...first, ...first.identity });
  const cancel = await prepareReviewTransition({ fence: f.context, immutable: first, transitionId: id(), actionId: aId,
    before: { runState: snap(a).runState, exposure: current.exposure, rowFence: current.rowFence!.state }, operation: { kind: 'cancel_reveal' } }); await f.store.commitReviewTransition(cancel);
  const retire = await prepareReviewTransition({ fence: f.context, immutable: first, transitionId: id(), actionId: id(), before: snap(cancel), operation: { kind: 'begin_retirement', retirementKind: 'delete' } }); await f.store.commitReviewTransition(retire);
  await assert.rejects(f.secondRepository.store().findReviewRun(f.secondRepository.context(), { scope: second, rowKey: second.rowKey, slot: second.slot, originalSource: second.originalSource, mode: second.mode }), /review_conflict/);
  const settled = await prepareReviewTransition({ fence: f.context, immutable: second, transitionId: id(), actionId: bId,
    before: { runState: snap(b).runState, exposure: snap(retire).exposure, rowFence: snap(retire).rowFence }, operation: { kind: 'cancel_reveal' } });
  await f.store.commitReviewTransition(settled);
  assert.deepEqual(snap(settled).rowFence!.retirement, snap(retire).rowFence!.retirement);
  assert.equal(snap(settled).runState!.action, null); assert.equal(snap(settled).exposure!.pending.length, 0);
  await assert.rejects(prepareReviewTransition({ fence: f.context, immutable: second, transitionId: id(), actionId: id(), before: snap(settled), operation: { kind: 'close_unavailable' } }), /review_conflict/);
  assert.equal(f.adapter.entries('events').length, 0);
});

test('an exact full owner-byte budget refuses a new action but its reserved retirement still settles', async t => {
  const f = await start(t), task = LEGACY_EVIDENCE_CATALOGUE.find(task => task.itemId !== f.immutable.identity.itemId && task.bindings.some(b => b.source === 'course_review' && b.taskFormat === 'meaning_choice'))!;
  const binding = task.bindings.find(b => b.source === 'course_review' && b.taskFormat === 'meaning_choice')!;
  let all: ReviewAccountingRow[] = ['reviewRuns', 'itemExposures', 'reviewTransitions'].flatMap(store => f.adapter.entries(store).map(([key, value]) => ({ store: store as ReviewAccountingRow['store'], key, value })));
  let prior: ReviewJournalPayload['before'] = { runState: null, exposure: null, rowFence: null };
  const retain = (base: ReviewAccountingRow[], p: PreparedReviewTransition): ReviewAccountingRow[] => {
    const r = reviewTransitionRows(p), payload = JSON.parse(p.journal.canonical);
    const add: ReviewAccountingRow[] = [{ store: 'reviewRuns', key: reviewRunKey(p.immutable), value: r.run }, { store: 'reviewRuns', key: reviewRowFenceKey(p.immutable), value: r.rowFence },
      { store: 'itemExposures', key: reviewExposureKey({ ...p.immutable, ...p.immutable.identity }), value: r.exposure }, { store: 'reviewTransitions', key: reviewJournalKey(p.immutable, payload.transitionId), value: p.journal }];
    return [...base.filter(row => !add.some(next => next.store === row.store && next.key === row.key)), ...add];
  };
  const build = async (padding: number, extraSpace = '') => {
    const rowBytes = JSON.stringify({ id: task.legacyQuestionId, padding: 'a'.repeat(padding) });
    const immutable = { ...f.immutable, runId: id(), episodeId: id(), initialDraftToken: id(), rowKey: task.legacyQuestionId!, slot: JSON.stringify([task.taskId, task.contentRevision, 'meaning_choice']),
      identity: { itemId: task.itemId, contentRevision: task.contentRevision, taskId: task.taskId, lessonId: task.lessonId, legacyQuestionId: task.legacyQuestionId!, taskFormat: 'meaning_choice' as const, gradingVersion: binding.gradingVersion },
      originalSource: { key: 'japaneseCurriculumReviewV1' as const, arrayBytes: `[${extraSpace}${rowBytes}]`, rowBytes, rowIndex: 0 } };
    immutable.sourceSlotKey = makeSourceSlotKey(f.owner, { ...immutable.identity, generationId: f.generationId, episodeId: immutable.episodeId, source: 'course_review' });
    const actionId = id(), acquire = await prepareReviewTransition({ fence: f.context, immutable, transitionId: id(), actionId, before: { ...prior, runState: null }, operation: { kind: 'acquire', observationId: id() } });
    const cancel = await prepareReviewTransition({ fence: f.context, immutable, transitionId: id(), actionId, before: snap(acquire), operation: { kind: 'cancel_reveal' } });
    const close = await prepareReviewTransition({ fence: f.context, immutable, transitionId: id(), actionId: id(), before: snap(cancel), operation: { kind: 'close_unavailable' } });
    return { rows: retain(retain(retain(all, acquire), cancel), close), after: snap(close) };
  };
  for (let i = 0; i < 20; i++) { const next = await build(190000); all = next.rows; prior = next.after; }
  const bare = await build(0), needed = REVIEW_LIMITS.ownerBytes - accountReviewRows(bare.rows, f.owner).bytes;
  assert.ok(needed > 0 && needed < 510000, String(needed));
  const filled = await build(Math.floor(needed / 2), needed % 2 ? ' ' : '');
  assert.equal(accountReviewRows(filled.rows, f.owner).bytes, REVIEW_LIMITS.ownerBytes);
  const oneByteOver = structuredClone(filled.rows), lastRun = oneByteOver.find(row => row.store === 'reviewRuns' && (row.value as { kind: string }).kind === 'run')!;
  (lastRun.value as { immutable: ReviewRunImmutable }).immutable.originalSource.arrayBytes += ' ';
  assert.throws(() => accountReviewRows(oneByteOver, f.owner), /review_capacity/);
  for (const row of filled.rows) f.adapter.seed(row.store, row.key, row.value);
  const hint = await f.metadata(f.present, id(), { kind: 'begin_reveal', surface: 'hint', observationId: id() });
  await assert.rejects(f.store.commitReviewTransition(hint), /review_capacity/);
  const actionId = id(), retirement = await f.metadata(f.present, actionId, { kind: 'begin_retirement', retirementKind: 'delete' });
  await f.store.commitReviewTransition(retirement);
  const close = await f.metadata(retirement, actionId, { kind: 'close_retirement', outcome: { operationId: id(), result: { deleted: true } } });
  await f.store.commitReviewTransition(close); assert.equal((await f.store.readReviewTransition(close))?.run.state.lifecycle, 'closed');
});

test('two actual facades cannot both claim the last retained-run identity', async t => {
  const f = await start(t), tasks = LEGACY_EVIDENCE_CATALOGUE.filter(task => task.itemId !== f.immutable.identity.itemId && task.bindings.some(b => b.source === 'course_review' && b.taskFormat === 'meaning_choice'));
  const filler = tasks[0], candidates = [tasks.find(task => task.itemId !== filler.itemId)!, tasks.find(task => task.itemId !== filler.itemId && task.itemId !== tasks.find(task => task.itemId !== filler.itemId)!.itemId)!];
  let all: ReviewAccountingRow[] = ['reviewRuns', 'itemExposures', 'reviewTransitions'].flatMap(store => f.adapter.entries(store).map(([key, value]) => ({ store: store as ReviewAccountingRow['store'], key, value })));
  const retain = (p: PreparedReviewTransition) => {
    const next = reviewTransitionRows(p), payload = JSON.parse(p.journal.canonical);
    const replacement: ReviewAccountingRow[] = [{ store: 'reviewRuns', key: reviewRunKey(p.immutable), value: next.run }, { store: 'reviewRuns', key: reviewRowFenceKey(p.immutable), value: next.rowFence },
      { store: 'itemExposures', key: reviewExposureKey({ ...p.immutable, ...p.immutable.identity }), value: next.exposure }, { store: 'reviewTransitions', key: reviewJournalKey(p.immutable, payload.transitionId), value: p.journal }];
    all = [...all.filter(row => !replacement.some(next => next.store === row.store && next.key === row.key)), ...replacement];
  };
  const make = (task: typeof filler): ReviewRunImmutable => {
    const rowBytes = JSON.stringify({ id: task.legacyQuestionId }), binding = task.bindings.find(b => b.source === 'course_review' && b.taskFormat === 'meaning_choice')!;
    const immutable = { ...f.immutable, runId: id(), episodeId: id(), initialDraftToken: id(), rowKey: task.legacyQuestionId!, slot: JSON.stringify([task.taskId, task.contentRevision, 'meaning_choice']),
      identity: { itemId: task.itemId, contentRevision: task.contentRevision, taskId: task.taskId, lessonId: task.lessonId, legacyQuestionId: task.legacyQuestionId!, taskFormat: 'meaning_choice' as const, gradingVersion: binding.gradingVersion },
      originalSource: { key: 'japaneseCurriculumReviewV1' as const, arrayBytes: `[${rowBytes}]`, rowBytes, rowIndex: 0 } };
    immutable.sourceSlotKey = makeSourceSlotKey(f.owner, { ...immutable.identity, generationId: f.generationId, episodeId: immutable.episodeId, source: 'course_review' }); return immutable;
  };
  let prior: ReviewJournalPayload['before'] = { runState: null, exposure: null, rowFence: null };
  for (let i = 0; i < 62; i++) {
    const immutable = make(filler), actionId = id();
    const a = await prepareReviewTransition({ fence: f.context, immutable, transitionId: id(), actionId, before: { ...prior, runState: null }, operation: { kind: 'acquire', observationId: id() } }); retain(a);
    const cancel = await prepareReviewTransition({ fence: f.context, immutable, transitionId: id(), actionId, before: snap(a), operation: { kind: 'cancel_reveal' } }); retain(cancel);
    const close = await prepareReviewTransition({ fence: f.context, immutable, transitionId: id(), actionId: id(), before: snap(cancel), operation: { kind: 'close_unavailable' } }); retain(close); prior = snap(close);
  }
  assert.equal(accountReviewRows(all, f.owner).runs, 63); for (const row of all) f.adapter.seed(row.store, row.key, row.value);
  const prepared = await Promise.all(candidates.map(task => prepareReviewTransition({ fence: f.context, immutable: make(task), transitionId: id(), actionId: id(),
    before: { runState: null, exposure: null, rowFence: null }, operation: { kind: 'acquire', observationId: id() } })));
  const results = await Promise.allSettled([f.store.commitReviewTransition(prepared[0]), f.secondRepository.store().commitReviewTransition(prepared[1], f.secondRepository.context())]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.adapter.entries('reviewRuns').filter(([, row]) => (row as { kind: string }).kind === 'run').length, 64);
  const loser = results.findIndex(result => result.status === 'rejected');
  await assert.rejects(f.store.commitReviewTransition(prepared[loser]), /review_capacity/);
  assert.equal(await f.store.readReviewTransition(prepared[loser]), null);
});

test('metadata-only writes recheck exact capture references inside the transaction before changing any review row', async t => {
  const f = await start(t), hint = await f.metadata(f.present, id(), { kind: 'begin_reveal', surface: 'hint', observationId: id() });
  const before = ['reviewRuns', 'itemExposures', 'reviewTransitions'].map(store => [store, f.adapter.entries(store)]);
  f.adapter.beforeNextTransaction('readwrite', () => f.adapter.tamper('commits', JSON.stringify([f.owner, f.generationId, f.capture.transitionId]), value => {
    const row = value as { canonical: string }, capture = JSON.parse(row.canonical); capture.fence.ownerEpoch++; row.canonical = canonicalEvidence(capture); return row;
  }));
  await assert.rejects(f.store.commitReviewTransition(hint), /corrupt_record/);
  assert.deepEqual(['reviewRuns', 'itemExposures', 'reviewTransitions'].map(store => [store, f.adapter.entries(store)]), before);
});

test('lost independent readback stays uncertain and exact retries preserve committed IDs and reservations', async t => {
  for (const phase of ['acquire', 'present'] as const) await t.test(phase, async sub => {
    const f = await fixture(sub); if (phase === 'present') await f.store.commitReviewTransition(f.acquire);
    f.adapter.afterNextWriteCommit(() => f.adapter.failNextRead());
    await assert.rejects(f.store.commitReviewTransition(f[phase]), /commit_unconfirmed/);
    const rows = ['reviewRuns', 'itemExposures', 'reviewTransitions', 'commits', 'events'].map(store => [store, f.adapter.entries(store)]);
    const replay = await f.store.commitReviewTransition(f[phase]); assert.equal(replay.replay, true);
    assert.deepEqual(['reviewRuns', 'itemExposures', 'reviewTransitions', 'commits', 'events'].map(store => [store, f.adapter.entries(store)]), rows);
  });
});

test('queued transaction admission loss and revocation cannot resurrect a retained writer', async t => {
  for (const fault of ['close', 'admission'] as const) await t.test(fault, async sub => {
    const f = await fixture(sub), key = JSON.stringify([f.owner, f.generationId]), original = f.adapter.inspect('admissions', key);
    f.adapter.beforeNextTransaction('readwrite', () => {
      if (fault === 'close') f.repository.close(); else f.adapter.tamper('admissions', key, value => ({ ...(value as object), incarnationId: id() }));
    });
    await assert.rejects(f.store.commitReviewTransition(f.acquire), /stale_context/); assert.equal(f.adapter.entries('reviewRuns').length, 0);
    if (fault === 'admission') f.adapter.seed('admissions', key, original);
    await assert.rejects(f.store.commitReviewTransition(f.acquire), /stale_context/);
  });
});

for (const first of ['legacy', 'review'] as const) test(`independent actual old/new race, ${first} invoked first`, async t => {
  const f = await fixture(t);
  const otherContext = { ...f.secondRepository.context(), now: f.context.now };
  const old = await preparePresentation({ transitionId: id(), event: f.event, actualVisible: true, history: 'new_session', timingObserved: true }, otherContext, LEGACY_EVIDENCE_CATALOGUE);
  const legacy = () => f.secondRepository.store().commit(old);
  const review = () => f.store.commitReviewTransition(f.acquire);
  const results = await Promise.allSettled(first === 'legacy' ? [legacy(), review()] : [review(), legacy()]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const managed = f.adapter.entries('reviewRuns').filter(([, r]) => (r as {kind:string}).kind === 'run').length;
  if (managed) {
    assert.equal(managed, 1); assert.equal(f.adapter.entries('events').length, 0);
    assert.equal(f.adapter.entries('commits').length, 0); assert.equal(f.adapter.entries('checkpoints').length, 0);
    assert.ok(await f.store.readReviewTransition(f.acquire));
    await assert.rejects(f.secondRepository.store().commit(old), /managed_review_slot/);
  } else {
    assert.equal(f.adapter.entries('reviewRuns').length, 0); assert.equal(f.adapter.entries('reviewTransitions').length, 0);
    assert.equal(f.adapter.entries('events').length, 1); assert.equal(f.adapter.entries('commits').length, 1);
    await assert.rejects(f.store.commitReviewTransition(f.acquire), /managed_review_slot/);
  }
});

test('pending and observed meaning surfaces both invalidate an already prepared typing answer across formats', async t => {
  for (const boundary of ['pending', 'observed'] as const) await t.test(boundary, async sub => {
    const f = await fixture(sub), task = LEGACY_EVIDENCE_CATALOGUE.find(task => task.bindings.some(b => b.source === 'course_review' && b.taskFormat === 'typed_answer'))!;
    const rowBytes = JSON.stringify({ id: task.legacyQuestionId });
    const immutableFor = (format: 'typed_answer' | 'meaning_choice'): ReviewRunImmutable => {
      const binding = task.bindings.find(b => b.source === 'course_review' && b.taskFormat === format)!;
      const value = { ...f.immutable, runId: id(), episodeId: id(), initialDraftToken: id(), rowKey: task.legacyQuestionId!, slot: JSON.stringify([task.taskId, task.contentRevision, format]),
        identity: { itemId: task.itemId, contentRevision: task.contentRevision, taskId: task.taskId, lessonId: task.lessonId, legacyQuestionId: task.legacyQuestionId!, taskFormat: format, gradingVersion: binding.gradingVersion },
        originalSource: { key: 'japaneseCurriculumReviewV1' as const, arrayBytes: `[${rowBytes}]`, rowBytes, rowIndex: 0 } };
      value.sourceSlotKey = makeSourceSlotKey(f.owner, { ...value.identity, generationId: f.generationId, episodeId: value.episodeId, source: 'course_review' }); return value;
    };
    const typed = immutableFor('typed_answer'), typedAction = id(), typedObservation = id();
    const typedAcquire = await prepareReviewTransition({ fence: f.context, immutable: typed, transitionId: id(), actionId: typedAction,
      before: { runState: null, exposure: null, rowFence: null }, operation: { kind: 'acquire', observationId: typedObservation } }); await f.store.commitReviewTransition(typedAcquire);
    const typedEvent = { ...f.event, ...typed.identity, eventId: id(), episodeId: typed.episodeId, sourceSlotKey: typed.sourceSlotKey,
      textVisibility: { targetText: false, reading: false, meaning: true, choices: false } };
    const typedCapture = await preparePresentation({ transitionId: id(), event: typedEvent, actualVisible: true, history: 'new_session', timingObserved: true }, f.context, LEGACY_EVIDENCE_CATALOGUE);
    const typedPresentation = await prepareReviewTransition({ fence: f.context, immutable: typed, transitionId: typedCapture.transitionId, actionId: typedAction, before: snap(typedAcquire),
      operation: { kind: 'presentation', observed: { observationId: typedObservation, actualVisible: true, targetText: false, reading: false, answer: false } }, capture: typedCapture }); await f.store.commitReviewTransition(typedPresentation);
    const raw = 'LOCAL_only_typing_701', answerCapture = await prepareAnswer(typedCapture.checkpoint, { transitionId: id(), eventId: id(), occurredAt: new Date(Date.parse(f.context.now) - 9000).toISOString(), recordTimezone: 'UTC', correct: true, responseMs: null,
      handoff: { draftToken: typed.initialDraftToken, answer: raw, observation: { neededHelp: false, modality: 'typing' } } }, f.context, LEGACY_EVIDENCE_CATALOGUE);
    const answer = await prepareReviewTransition({ fence: f.context, immutable: typed, transitionId: answerCapture.transitionId, actionId: id(), before: snap(typedPresentation), operation: { kind: 'answer', observationId: id() }, capture: answerCapture });
    const meaning = immutableFor('meaning_choice'), meaningAction = id(), meaningObservation = id(), meaningAcquire = await prepareReviewTransition({ fence: f.context, immutable: meaning, transitionId: id(), actionId: meaningAction,
      before: { runState: null, exposure: snap(typedPresentation).exposure, rowFence: snap(typedPresentation).rowFence }, operation: { kind: 'acquire', observationId: meaningObservation } }); await f.secondRepository.store().commitReviewTransition(meaningAcquire, f.secondRepository.context());
    if (boundary === 'observed') {
      const event = { ...f.event, ...meaning.identity, eventId: id(), episodeId: meaning.episodeId, sourceSlotKey: meaning.sourceSlotKey,
        textVisibility: { targetText: true, reading: true, meaning: true, choices: true } };
      const capture = await preparePresentation({ transitionId: id(), event, actualVisible: true, history: 'new_session', timingObserved: true }, f.context, LEGACY_EVIDENCE_CATALOGUE);
      const observed = await prepareReviewTransition({ fence: f.context, immutable: meaning, transitionId: capture.transitionId, actionId: meaningAction, before: snap(meaningAcquire),
        operation: { kind: 'presentation', observed: { observationId: meaningObservation, actualVisible: true, targetText: true, reading: true, answer: false } }, capture }); await f.secondRepository.store().commitReviewTransition(observed, f.secondRepository.context());
    }
    await assert.rejects(f.store.commitReviewTransition(answer), /review_conflict/);
    assert.equal(await f.store.readReviewTransition(answer), null); assert.equal(answerCapture.checkpoint.handoff!.answer, raw);
    const events = f.adapter.entries('events'); assert.equal(events.length, boundary === 'observed' ? 2 : 1);
    assert.ok(!JSON.stringify(f.adapter.entries('reviewTransitions')).includes(raw));
    const state = await f.store.readReviewState(f.context, { ...typed, ...typed.identity });
    assert.equal(state.exposure?.pending.length, boundary === 'pending' ? 1 : 0);
    assert.equal(state.exposure?.targetText, boundary === 'observed' ? true : null);
    if (boundary === 'observed') {
      // A new CAS snapshot is not permission to reuse a capture whose event
      // still understates the already observed shared target/reading facts.
      await assert.rejects(prepareReviewTransition({ fence: f.context, immutable: typed, transitionId: answerCapture.transitionId, actionId: id(),
        before: { runState: snap(typedPresentation).runState, exposure: state.exposure, rowFence: state.rowFence!.state }, operation: { kind: 'answer', observationId: id() }, capture: answerCapture }), /corrupt_record/);
    }
  });
});

test('partial rollback of the row fence cannot hide a retained active sibling', async t => {
  const f = await fixture(t), task = LEGACY_EVIDENCE_CATALOGUE.find(task => task.bindings.some(b => b.source === 'course_review' && b.taskFormat === 'typed_answer'))!;
  const rowBytes = JSON.stringify({ id: task.legacyQuestionId });
  const make = (format: 'meaning_choice' | 'typed_answer'): ReviewRunImmutable => {
    const binding = task.bindings.find(b => b.source === 'course_review' && b.taskFormat === format)!;
    const value = { ...f.immutable, runId: id(), episodeId: id(), initialDraftToken: id(), rowKey: task.legacyQuestionId!, slot: JSON.stringify([task.taskId, task.contentRevision, format]),
      identity: { itemId: task.itemId, contentRevision: task.contentRevision, taskId: task.taskId, lessonId: task.lessonId, legacyQuestionId: task.legacyQuestionId!, taskFormat: format, gradingVersion: binding.gradingVersion },
      originalSource: { key: 'japaneseCurriculumReviewV1' as const, arrayBytes: `[${rowBytes}]`, rowBytes, rowIndex: 0 } };
    value.sourceSlotKey = makeSourceSlotKey(f.owner, { ...value.identity, generationId: f.generationId, episodeId: value.episodeId, source: 'course_review' }); return value;
  };
  const first = make('meaning_choice');
  const a = await prepareReviewTransition({ fence: f.context, immutable: first, transitionId: id(), actionId: id(), before: { runState: null, exposure: null, rowFence: null }, operation: { kind: 'acquire', observationId: id() } });
  await f.store.commitReviewTransition(a);
  const originalFence = f.adapter.inspect('reviewRuns', reviewRowFenceKey(first));
  const second = make('typed_answer');
  const b = await prepareReviewTransition({ fence: f.context, immutable: second, transitionId: id(), actionId: id(), before: { runState: null, exposure: snap(a).exposure, rowFence: snap(a).rowFence }, operation: { kind: 'acquire', observationId: id() } });
  await f.store.commitReviewTransition(b);
  f.adapter.seed('reviewRuns', reviewRowFenceKey(first), originalFence);
  await assert.rejects(f.store.readReviewTransition(b), /corrupt_record/);
});
test('historical exposure rollback cannot erase retained observed true facts', async t => {
  const f = await start(t), originalExposure = f.adapter.inspect('itemExposures', reviewExposureKey({ ...f.immutable, ...f.immutable.identity }));
  const actionId = id(), observationId = id();
  const intent = await f.metadata(f.present, actionId, { kind: 'begin_reveal', surface: 'hint', observationId });
  await f.store.commitReviewTransition(intent);
  const capture = prepareCheckpointTransition(f.capture.checkpoint, { kind: 'hint' }, f.context, id());
  const observed = await prepareReviewTransition({ fence: f.context, immutable: f.immutable, transitionId: capture.transitionId, actionId, before: snap(intent),
    operation: { kind: 'observed_hint', observed: { observationId, actualVisible: true, targetText: true, reading: true, answer: true } }, capture });
  await f.store.commitReviewTransition(observed);
  f.adapter.seed('itemExposures', reviewExposureKey({ ...f.immutable, ...f.immutable.identity }), originalExposure);
  await assert.rejects(f.store.readReviewTransition(observed), /corrupt_record/);
});
test('same-revision journal fork cannot establish a second committed cancellation', async t => {
  const f = await fixture(t); await f.store.commitReviewTransition(f.acquire);
  const actionId = snap(f.acquire).runState!.action!.rootActionId;
  const first = await f.metadata(f.acquire, actionId, { kind: 'cancel_reveal' });
  const fork = await f.metadata(f.acquire, actionId, { kind: 'cancel_reveal' });
  await f.store.commitReviewTransition(first);
  const payload = JSON.parse(fork.journal.canonical);
  f.adapter.seed('reviewTransitions', reviewJournalKey(f.immutable, payload.transitionId), fork.journal);
  await assert.rejects(f.store.readReviewTransition(fork), /corrupt_record/);
});
test('historical run rollback is corrupt even when the earlier state has a valid journal and no checkpoint', async t => {
  const f = await fixture(t); await f.store.commitReviewTransition(f.acquire);
  const original = f.adapter.inspect('reviewRuns', reviewRunKey(f.immutable));
  const cancelled = await f.metadata(f.acquire, snap(f.acquire).runState!.action!.rootActionId, { kind: 'cancel_reveal' });
  await f.store.commitReviewTransition(cancelled);
  assert.ok(await f.store.readReviewTransition(f.acquire));
  f.adapter.seed('reviewRuns', reviewRunKey(f.immutable), original);
  const before = ['reviewRuns', 'itemExposures', 'reviewTransitions', 'commits', 'events'].map(name => f.adapter.entries(name));
  await assert.rejects(f.store.readReviewTransition(cancelled), /corrupt_record/);
  await assert.rejects(f.store.commitReviewTransition(f.acquire), /corrupt_record/);
  assert.deepEqual(['reviewRuns', 'itemExposures', 'reviewTransitions', 'commits', 'events'].map(name => f.adapter.entries(name)), before);
});
