import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { LocalEvidenceStore } from '../lib/language-legacy-evidence/local-store.ts';
import type { PreparedReviewTransition, ReviewJournalPayload, ReviewOperation, ReviewRun } from '../lib/language-legacy-evidence/review-capture.ts';
import { createLegacyReviewCaptureFixture, deferred } from './helpers/legacyReviewCaptureHarness.ts';
import { mountCapturedReviewComponent } from './helpers/capturedReviewComponentHarness.ts';
import { nodes, textOf } from './helpers/storage-ui-fixture.ts';

// Process isolation keeps this unchanged SQL case separate from the preceding
// 40 synthetic component cases. These six helpers are copied byte-for-byte.

function transitionProbe(t: TestContext) {
  type Kind = ReviewOperation['kind'];
  type Stage = 'before' | 'after';
  const calls: { kind: Kind; stage: Stage; input: PreparedReviewTransition }[] = [];
  const holds = new Map<string, { entered: ReturnType<typeof deferred<void>>; released: ReturnType<typeof deferred<void>> }>();
  let inspect: ((kind: Kind, stage: Stage) => void) | undefined;
  const original = LocalEvidenceStore.prototype.commitReviewTransition;
  LocalEvidenceStore.prototype.commitReviewTransition = async function (...args: Parameters<typeof original>) {
    const input = args[0], kind = (JSON.parse(input.journal.canonical) as ReviewJournalPayload).operation.kind;
    async function boundary(stage: Stage) {
      calls.push({ kind, stage, input }); inspect?.(kind, stage);
      const hold = holds.get(`${kind}:${stage}`);
      if (hold) { holds.delete(`${kind}:${stage}`); hold.entered.resolve(); await hold.released.promise; }
    }
    await boundary('before'); const result = await original.apply(this, args); await boundary('after'); return result;
  };
  t.after(() => { LocalEvidenceStore.prototype.commitReviewTransition = original; for (const hold of holds.values()) hold.released.resolve(); });
  return { calls,
    count(kind: Kind, stage: Stage = 'after') { return calls.filter(call => call.kind === kind && call.stage === stage).length; },
    inspect(callback: (kind: Kind, stage: Stage) => void) { inspect = callback; },
    hold(kind: Kind, stage: Stage = 'before') {
      const entered = deferred<void>(), released = deferred<void>(); holds.set(`${kind}:${stage}`, { entered, released });
      t.after(() => released.resolve()); return { entered: entered.promise, release: () => released.resolve() };
    },
  };
}

async function fixture(t: TestContext, options: { active?: boolean; sql?: boolean; questionId?: string; beforeMount?: (f: Awaited<ReturnType<typeof createLegacyReviewCaptureFixture>>) => void; component?: Parameters<typeof mountCapturedReviewComponent>[2] } = {}) {
  const f = await createLegacyReviewCaptureFixture(t, { active: options.active, sql: options.sql, questionIds: [options.questionId ?? 'f01:3'] });
  options.beforeMount?.(f);
  let pins = 0, closed = 0;
  const props = { handle: f.handles.get(options.questionId ?? 'f01:3')!, mode: 'reader', source: f.source(), actions: f.actions,
    onPin() { pins++; }, onClosed() { closed++; } };
  const view = mountCapturedReviewComponent(f.adapterModule, props, options.component); t.after(view.dispose);
  return { ...f, view, props, get pins() { return pins; }, get closed() { return closed; },
    evidenceOpenCount: () => f.idbOpenCount,
    run() { const row = f.idb.entries('reviewRuns').map(([, value]) => value).find(value => (value as ReviewRun).kind === 'run') as ReviewRun | undefined; assert.ok(row); return row; },
  };
}

const hasSurface = (f: Awaited<ReturnType<typeof fixture>>, surface: string) => nodes(f.view.tree()).some(node => node.props['data-review-surface'] === surface);

async function waitView(f: Awaited<ReturnType<typeof fixture>>, predicate: () => boolean) {
  const deadline = performance.now() + 5000;
  do {
    f.view.flush(); if (predicate()) return;
    await new Promise<void>(resolve => setTimeout(resolve, 2));
  } while (performance.now() < deadline);
  assert.fail(`Source component did not reach boundary: ${f.view.queuedView().status}/${f.view.queuedView().failure}; busy=${f.view.queuedView().busy}; frames=${f.view.pendingFrames}; closedCallbacks=${f.closed}`);
}

async function present(f: Awaited<ReturnType<typeof fixture>>) {
  f.view.click('기록형 복습 시작'); await waitView(f, () => f.view.pendingFrames === 1);
  assert.equal(f.view.pendingFrames, 1); assert.ok(f.view.input().props.disabled);
  assert.equal(f.view.frame(), 1); await waitView(f, () => f.view.pendingFrames === 1);
  assert.equal(f.view.pendingFrames, 1); assert.ok(f.view.input().props.disabled);
  assert.equal(f.view.frame(), 1); await waitView(f, () => f.view.input().props.disabled === false);
  assert.equal(f.view.input().props.disabled, false);
}

async function finishFeedback(f: Awaited<ReturnType<typeof fixture>>) {
  await waitView(f, () => f.view.pendingFrames === 1);
  f.view.frame(); await waitView(f, () => f.view.pendingFrames === 1);
  f.view.frame(); await waitView(f, () => f.run().state.phase === 'answered' && f.view.queuedView().status === 'answered' && !f.view.queuedView().busy);
  assert.equal(f.run().state.phase, 'answered');
}

test('a SQL-verified component demotes every next-event commit/readback view, reports proved local pending before batch persistence, and recovers exact IDs', async t => {
  const probe = transitionProbe(t), f = await fixture(t, { sql: true, component: { mutationHook: true } });
  await present(f); f.view.click('서버 기록 확인');
  await waitView(f, () => f.view.queuedView().delivery === 'verified' && !f.view.queuedView().busy);
  assert.ok(f.sql, 'This status regression requires the actual SQL fixture');
  const independent = await f.acquire(), priorPrefix = await independent.readPrefix();
  assert.equal(priorPrefix.status, 'complete_authenticated_prefix');
  if (priorPrefix.status !== 'complete_authenticated_prefix') assert.fail('Missing independently authenticated SQL prefix');
  assert.equal(priorPrefix.snapshot.records.length, 1);
  const appendCount = () => f.calls.filter(call => call.name === 'append_language_legacy_evidence').length;
  const appendedBefore = appendCount(); assert.equal(appendedBefore, 1);
  const prior = f.view.queuedView(), raw = 'synthetic-delivery-label-raw-draft';
  f.view.type(raw); f.view.flush();
  const before = probe.hold('answer', 'before'), committed = probe.hold('answer', 'after');
  const readEntered = deferred<void>(), readReleased = deferred<void>(), batchEntered = deferred<void>(), batchReleased = deferred<void>();
  const originalRead = LocalEvidenceStore.prototype.readReviewTransition, originalBatch = LocalEvidenceStore.prototype.putBatch;
  let heldRead = false, readArmed = false, heldBatch = false, commitPublicationStart = -1, attemptPublicationStart = 0;
  const batchAttempts: Parameters<typeof originalBatch>[1][] = [];
  LocalEvidenceStore.prototype.readReviewTransition = async function (...args: Parameters<typeof originalRead>) {
    const result = await originalRead.apply(this, args);
    if (readArmed && !heldRead && (JSON.parse(args[0].journal.canonical) as ReviewJournalPayload).operation.kind === 'answer') {
      heldRead = true; readEntered.resolve(); await readReleased.promise;
    }
    return result;
  };
  LocalEvidenceStore.prototype.putBatch = async function (...args: Parameters<typeof originalBatch>) {
    if (args[1].events[0].sequence === 1) {
      batchAttempts.push(args[1]);
      if (!heldBatch) { heldBatch = true; batchEntered.resolve(); await batchReleased.promise; f.idb.quotaNextWrite(); }
    }
    return originalBatch.apply(this, args);
  };
  t.after(() => { readReleased.resolve(); batchReleased.resolve(); LocalEvidenceStore.prototype.readReviewTransition = originalRead; LocalEvidenceStore.prototype.putBatch = originalBatch; });
  probe.inspect((kind, stage) => { if (kind === 'answer' && stage === 'before' && commitPublicationStart < 0) {
    const firstUnavailable = f.view.publications.slice(attemptPublicationStart).findIndex(view => view.delivery === 'unavailable');
    if (firstUnavailable >= 0) commitPublicationStart = attemptPublicationStart + firstUnavailable;
  } });
  const UNAVAILABLE = '기록 저장과 서버 확인 상태를 아직 확인하지 못했어요.';
  const PENDING = '로컬 기록이 있어요. 서버 확인은 대기 중이에요.';
  const VERIFIED = '서버에서 별도로 확인했어요.';
  function assertRetained() {
    assert.ok(f.view.input().props.value === raw, 'An incomplete capture replaced the local raw draft');
    assert.ok(f.view.queuedView().draftToken === prior.draftToken, 'An incomplete capture adopted another draft token');
    assert.ok(f.view.queuedView().handoff === prior.handoff, 'An incomplete phase adopted a new compatibility handoff');
    assert.ok(!hasSurface(f, 'feedback'), 'Feedback appeared before the complete capture phase');
    assert.equal(probe.count('compatibility_applied', 'before'), 0); assert.equal(probe.count('observe_feedback', 'before'), 0);
    assert.equal(appendCount(), appendedBefore, 'Capture or recovery automatically delivered evidence');
  }
  function assertLabel(expected: 'unavailable' | 'pending') {
    f.view.flush(); assert.equal(f.view.queuedView().delivery, expected);
    const statuses = nodes(f.view.tree()).filter(node => node.props.role === 'status').map(textOf);
    assert.ok(statuses.includes(expected === 'unavailable' ? UNAVAILABLE : PENDING), 'The delivery label does not match its proved state');
    assert.ok(!statuses.includes(VERIFIED), 'A new event inherited the older server verification claim');
    if (expected === 'unavailable') assert.ok(!statuses.includes(PENDING), 'An unproved event claimed local persistence');
    assertRetained();
  }
  attemptPublicationStart = f.view.publications.length; f.view.submit(); await before.entered;
  const renderStart = f.view.rendered.length; assertLabel('unavailable');
  assert.equal(f.idb.entries('events').length, 1);
  before.release(); await committed.entered; assertLabel('unavailable');
  assert.equal(f.idb.entries('events').length, 2);
  readArmed = true; committed.release(); await readEntered.promise; assertLabel('unavailable');
  readReleased.resolve(); await batchEntered.promise; assertLabel('pending');
  const publicationBeforeFailure = f.view.publications.length;
  batchReleased.resolve(); await waitView(f, () => f.view.queuedView().status === 'blocked' && !f.view.queuedView().busy);
  assertLabel('pending'); assert.equal(batchAttempts.length, 1);
  assert.ok(f.view.publications.slice(publicationBeforeFailure).every(view => view.delivery === 'pending'), 'Batch failure changed the proved pending status');
  assert.ok(commitPublicationStart >= 0);
  assert.ok(f.view.publications.slice(commitPublicationStart).every(view => view.delivery !== 'verified'), 'A transient source publication reused server verification');
  assert.ok(f.view.publications.slice(commitPublicationStart).every(view => view.draftToken === prior.draftToken && view.handoff === prior.handoff), 'A status publication adopted uncommitted UI state');
  for (const sample of f.view.rendered.slice(renderStart)) {
    const statuses = nodes(sample.tree).filter(node => node.props.role === 'status').map(textOf);
    assert.ok(!statuses.includes(VERIFIED), 'A committed render reused an older verified claim');
    if (sample.view.delivery === 'unavailable') assert.ok(statuses.includes(UNAVAILABLE) && !statuses.includes(PENDING), 'An unavailable render claimed a locally saved record');
    else assert.equal(sample.view.delivery, 'pending');
    assert.ok(!nodes(sample.tree).some(node => node.props['data-review-surface'] === 'feedback'), 'A pre-success render revealed feedback');
  }
  const firstAnswer = probe.calls.find(call => call.kind === 'answer' && call.stage === 'before')!.input;
  const frozenBatch = JSON.stringify(batchAttempts[0]);
  f.view.click('같은 기록 다시 확인'); await waitView(f, () => f.view.pendingFrames === 1);
  assert.equal(f.idb.entries('events').length, 2); assert.equal(batchAttempts.length, 2);
  assert.ok(JSON.stringify(batchAttempts[1]) === frozenBatch, 'Recovery changed the frozen batch identity or bytes');
  assert.ok(probe.calls.filter(call => call.kind === 'answer').every(call => call.input.journal.canonical === firstAnswer.journal.canonical), 'Recovery changed the prepared answer identity or bytes');
  assert.ok(f.view.queuedView().handoff?.eventId === firstAnswer.capture?.event?.eventId, 'Recovered publication used a different event');
  assert.ok(f.view.queuedView().handoff?.answer === raw, 'Recovered publication changed the original raw draft');
  assert.equal(probe.count('compatibility_applied'), 1); assert.equal(appendCount(), appendedBefore);
  assert.ok(f.view.publications.slice(commitPublicationStart).every(view => view.delivery !== 'verified'), 'Recovery inferred server verification without delivery');
  await finishFeedback(f); assert.equal(f.view.queuedView().delivery, 'pending'); assert.equal(appendCount(), appendedBefore);
  f.view.click('서버 기록 확인'); await waitView(f, () => f.view.queuedView().delivery === 'verified' && !f.view.queuedView().busy);
  assert.equal(appendCount(), appendedBefore + 1);
  const afterPrefix = await independent.readPrefix(); assert.equal(afterPrefix.status, 'complete_authenticated_prefix');
  if (afterPrefix.status !== 'complete_authenticated_prefix') assert.fail('Missing authenticated post-recovery prefix');
  assert.equal(afterPrefix.snapshot.records.length, 2); assert.equal(f.view.mutationCalls, 0);
});
