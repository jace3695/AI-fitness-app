import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { LocalEvidenceStore } from '../lib/language-legacy-evidence/local-store.ts';
import type { PreparedReviewTransition, ReviewJournalPayload, ReviewOperation, ReviewRun } from '../lib/language-legacy-evidence/review-capture.ts';
import { CURRICULUM } from '../data/curriculum.ts';
import { LANGUAGE_MARKER_KEY } from '../app/data/languageStorageBoundary.ts';
import { createLegacyReviewCaptureFixture, deferred, observeReview, until } from './helpers/legacyReviewCaptureHarness.ts';
import { mountCapturedReviewComponent } from './helpers/capturedReviewComponentHarness.ts';
import { nodes, textOf } from './helpers/storage-ui-fixture.ts';

/** These are source-component orchestration tests. Only hooks/DOM/frames,
 * transport and IDB are synthetic; adapter, registered authority, storage
 * transaction/CAS, checkpoint reducer and mutation planner execute unchanged.
 * This does not substitute for Chromium/WebKit runtime acceptance. */
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
const question = CURRICULUM.find(lesson => lesson.id === 'f01')!.quiz[3];
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

test('inactive source component ignores focused URL, environment and stored enable hints with zero evidence IDB/RPC', async t => {
  const names = ['NEXT_PUBLIC_LANGUAGE_LEGACY_EVIDENCE_CAPTURE', 'LANGUAGE_LEGACY_EVIDENCE_CAPTURE', 'NEXT_PUBLIC_LANGUAGE_LEGACY_EVIDENCE_ENABLED'];
  const previous = names.map(name => [name, process.env[name]] as const);
  t.after(() => { for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  for (const name of names) process.env[name] = 'true';
  const f = await fixture(t, { active: false, beforeMount(f) {
    Object.assign(f.local.window, { location: { search: '?capture=course-review&row=f01%3A3&captureEnabled=true&enrollmentEnabled=true' } });
    f.local.storage.setItem('languageLegacyEvidenceCapture', 'true');
    f.local.storage.setItem('LANGUAGE_LEGACY_EVIDENCE_RELEASE', JSON.stringify({ resetProtocol: 'protocol-required', enrollmentEnabled: true, captureEnabled: true }));
  } });
  f.view.render(); f.view.flush(); await f.view.settle();
  assert.match(f.view.text(), /아직 활성화되지/);
  assert.ok(!nodes(f.view.tree()).some(node => node.type === 'button'));
  assert.ok(!hasSurface(f, 'question')); assert.ok(!f.view.text().includes(question.prompt));
  assert.equal(f.pins, 0); assert.equal(f.evidenceOpenCount(), 0); assert.equal(f.calls.length, 0);
  f.view.visibility('hidden'); f.view.pagehide(); await f.view.settle();
  assert.equal(f.evidenceOpenCount(), 0); assert.equal(f.calls.length, 0); assert.equal(f.submitted.length, 0);
});

test('explicit start holds all authored target content until acquired readback and two checked frame callbacks', async t => {
  const probe = transitionProbe(t), hold = probe.hold('acquire', 'after');
  const f = await fixture(t);
  assert.equal(f.evidenceOpenCount(), 0); assert.equal(f.calls.length, 0); assert.equal(f.pins, 0);
  assert.ok(!f.view.text().includes(question.prompt)); assert.ok(!hasSurface(f, 'question'));
  const start = f.view.button('기록형 복습 시작').props.onClick as () => void;
  start(); start(); await hold.entered; f.view.flush();
  assert.equal(f.pins, 1); assert.equal(probe.count('acquire'), 1);
  assert.ok(!hasSurface(f, 'question'), 'Even committed acquisition is insufficient until exact readback');
  assert.ok(!f.view.text().includes(question.prompt)); assert.equal(f.idb.entries('events').length, 0);
  hold.release(); await waitView(f, () => f.view.pendingFrames === 1);
  assert.ok(hasSurface(f, 'question')); assert.ok(f.view.text().includes(question.prompt));
  assert.ok(f.view.input().props.disabled); assert.equal(f.idb.entries('events').length, 0);
  assert.equal(f.view.pendingFrames, 1); f.view.frame(); await waitView(f, () => f.view.pendingFrames === 1);
  assert.equal(probe.count('presentation'), 0); assert.equal(f.view.pendingFrames, 1); assert.ok(f.view.input().props.disabled);
  f.view.frame(); await waitView(f, () => f.view.input().props.disabled === false);
  assert.equal(probe.count('presentation'), 1); assert.equal(f.idb.entries('events').length, 1);
  assert.equal(f.view.input().props.disabled, false); assert.equal(f.submitted.length, 0);
});

test('actual typed input refuses composition Enter and uses one synchronous latch for repeated submit callbacks', async t => {
  const probe = transitionProbe(t), f = await fixture(t); await present(f);
  f.view.type('synthetic-composition-answer'); f.view.flush();
  const input = f.view.input(); (input.props.onCompositionStart as () => void)();
  let prevented = 0;
  const keydown = input.props.onKeyDown as (event: unknown) => void;
  keydown({ key: 'Enter', nativeEvent: { isComposing: false }, keyCode: 13, preventDefault() { prevented++; } });
  f.view.submit(); await f.view.settle(); assert.equal(prevented, 1); assert.equal(probe.count('answer', 'before'), 0);
  (input.props.onCompositionEnd as () => void)();
  keydown({ key: 'Enter', nativeEvent: { isComposing: true }, keyCode: 13, preventDefault() { prevented++; } });
  keydown({ key: 'Enter', nativeEvent: { isComposing: false }, keyCode: 229, preventDefault() { prevented++; } });
  assert.equal(prevented, 3); assert.equal(probe.count('answer', 'before'), 0);
  const hold = probe.hold('answer'); const form = f.view.find(node => node.type === 'form'), submit = form.props.onSubmit as (event: unknown) => void;
  submit({ preventDefault() {} }); submit({ preventDefault() {} }); submit({ preventDefault() {} });
  await hold.entered; assert.equal(probe.count('answer', 'before'), 1); assert.equal(f.idb.entries('events').length, 1);
  (input.props.onChange as (event: unknown) => void)({ target: { value: 'synthetic-late-input' } }); f.view.flush();
  assert.ok(f.view.input().props.value === 'synthetic-composition-answer', 'An old input handler changed the latched draft');
  hold.release(); await waitView(f, () => f.view.pendingFrames === 1); assert.equal(probe.count('answer'), 1); assert.equal(f.idb.entries('events').length, 2);
  assert.equal(f.submitted.length, 0);
});

test('answer publication acknowledges a committed matching local draft, then separately observes feedback', async t => {
  const probe = transitionProbe(t), f = await fixture(t); await present(f);
  const answer = 'synthetic-local-commit-sentinel'; f.view.type(answer); f.view.flush();
  const hold = probe.hold('answer', 'after'); f.view.submit(); await hold.entered; f.view.flush();
  assert.equal(f.idb.entries('events').length, 2); assert.ok(f.view.input().props.value === answer, 'Committed local draft differs');
  assert.ok(!hasSurface(f, 'feedback')); assert.equal(probe.count('compatibility_applied', 'before'), 0);
  hold.release(); await until(() => f.view.queuedView().status === 'feedback_pending' && !f.view.queuedView().busy);
  assert.equal(probe.count('compatibility_applied', 'before'), 0, 'A state setter is not a committed local draft');
  f.view.render(); assert.ok(!hasSurface(f, 'feedback')); f.view.flushEffects();
  assert.equal(probe.count('compatibility_applied', 'before'), 0, 'The publication effect sees the preceding committed draft');
  f.view.render();
  assert.ok(hasSurface(f, 'feedback')); assert.ok(f.view.input().props.value === answer, 'Committed local draft differs');
  assert.ok(f.view.text().includes(`내가 고른 답: ${answer}`)); assert.equal(probe.count('compatibility_applied', 'before'), 0);
  probe.inspect((kind, stage) => { if (kind === 'compatibility_applied' && stage === 'before') { assert.ok(hasSurface(f, 'feedback')); assert.ok(f.view.input().props.value === answer, 'Committed local draft differs'); } });
  f.view.flushEffects(); await waitView(f, () => f.view.pendingFrames === 1);
  assert.equal(probe.count('compatibility_applied'), 1); assert.equal(f.run().state.compatibilityApplied, true);
  assert.equal(f.run().state.feedbackObserved, false); assert.equal(probe.count('observe_feedback'), 0);
  assert.ok(!nodes(f.view.tree()).some(node => node.type === 'button' && textOf(node) === '다시 풀어볼래요'));
  await finishFeedback(f);
  assert.equal(probe.count('observe_feedback'), 1); assert.equal(f.run().state.feedbackObserved, true);
  assert.ok(f.view.button('다시 풀어볼래요')); assert.equal(f.submitted.length, 0);
});

test('retry keeps the old draft until durable readback, then acknowledges only a committed clear', async t => {
  const probe = transitionProbe(t), f = await fixture(t); await present(f);
  const answer = 'synthetic-wrong-retry-draft'; f.view.type(answer); f.view.flush(); f.view.submit(); await finishFeedback(f);
  const token = f.run().state.currentDraftToken, hold = probe.hold('retry', 'after');
  const retry = f.view.button('다시 풀어볼래요').props.onClick as () => void; retry(); retry(); await hold.entered; f.view.flush();
  assert.equal(probe.count('retry'), 1); assert.notEqual(f.run().state.currentDraftToken, token);
  assert.ok(f.view.input().props.value === answer, 'Committed local draft differs'); assert.ok(hasSurface(f, 'feedback')); assert.equal(probe.count('ack_retry', 'before'), 0);
  hold.release(); await until(() => f.view.queuedView().status === 'retry_pending' && !f.view.queuedView().busy);
  f.view.render(); assert.ok(f.view.input().props.value === answer, 'Committed local draft differs'); f.view.flushEffects();
  assert.equal(probe.count('ack_retry', 'before'), 0);
  f.view.render(); assert.ok(f.view.input().props.value === '', 'Committed local draft differs'); assert.ok(!hasSurface(f, 'feedback')); assert.ok(!hasSurface(f, 'hint'));
  assert.ok(f.view.input().props.disabled); assert.equal(probe.count('ack_retry', 'before'), 0);
  probe.inspect((kind, stage) => { if (kind === 'ack_retry' && stage === 'before') { assert.ok(f.view.input().props.value === '', 'Committed local draft differs'); assert.ok(!hasSurface(f, 'feedback')); assert.ok(!hasSurface(f, 'hint')); } });
  f.view.flushEffects(); await waitView(f, () => f.view.input().props.disabled === false);
  assert.equal(probe.count('ack_retry'), 1); assert.equal(f.view.input().props.disabled, false);
  assert.equal(f.run().state.hadWrong, true); assert.equal(f.submitted.length, 0);
});

for (const interruption of ['hidden', 'blur', 'pagehide', 'inert', 'display', 'opacity', 'clipped_top', 'clipped_right', 'marker_mismatch', 'draft_mismatch', 'source_abort', 'unmount'] as const) {
  test(`source component refuses a queued presentation callback after ${interruption}`, async t => {
    const probe = transitionProbe(t), f = await fixture(t);
    f.view.click('기록형 복습 시작'); await waitView(f, () => f.view.pendingFrames === 1);
    f.view.frame(); await waitView(f, () => f.view.pendingFrames === 1);
    if (interruption === 'hidden') f.view.visibility('hidden');
    else if (interruption === 'blur') f.view.focus(false);
    else if (interruption === 'pagehide') f.view.pagehide();
    else if (interruption === 'inert' || interruption === 'display' || interruption === 'opacity') f.view.conceal('question', interruption);
    else if (interruption === 'clipped_top' || interruption === 'clipped_right') f.view.clip('question', interruption === 'clipped_top' ? 'top' : 'right');
    else if (interruption === 'marker_mismatch' || interruption === 'draft_mismatch') f.view.alterMarker('question', interruption === 'marker_mismatch' ? 'run' : 'draft');
    else if (interruption === 'source_abort') f.coordinator.pause();
    else f.view.dispose();
    f.view.frame(); if (interruption === 'unmount') await f.view.asynchronous(8); else await waitView(f, () => !f.view.queuedView().busy);
    assert.equal(probe.count('presentation', 'before'), 0); assert.equal(f.idb.entries('events').length, 0);
    assert.ok(f.run().state.checkpoint === null, 'An interrupted question acquired a checkpoint'); assert.equal(f.closed, 0); assert.equal(f.submitted.length, 0);
    if (interruption !== 'unmount') assert.ok(f.view.input().props.disabled);
  });
}

test('source component unmount during held acquisition refuses reveal, observations and completion callbacks', async t => {
  const probe = transitionProbe(t), hold = probe.hold('acquire', 'after'), f = await fixture(t);
  f.view.click('기록형 복습 시작'); await hold.entered; const commits = f.view.commits;
  f.view.dispose(); hold.release(); await f.view.asynchronous(8);
  assert.equal(f.view.commits, commits); assert.equal(f.view.pendingFrames, 0); assert.equal(probe.count('presentation', 'before'), 0);
  assert.equal(f.idb.entries('events').length, 0); assert.equal(f.closed, 0); assert.equal(f.submitted.length, 0);
});

test('hint pixels wait for begin-reveal readback and hidden feedback never becomes observed', async t => {
  const probe = transitionProbe(t), f = await fixture(t); await present(f);
  const hold = probe.hold('begin_reveal', 'after'); f.view.click('힌트 볼래요'); await hold.entered; f.view.flush();
  assert.ok(!hasSurface(f, 'hint')); assert.equal(f.run().state.neededHelp, true);
  hold.release(); await waitView(f, () => f.view.pendingFrames === 1); assert.ok(hasSurface(f, 'hint')); assert.equal(probe.count('observed_hint'), 0);
  f.view.frame(); await waitView(f, () => f.view.pendingFrames === 1); f.view.frame(); await waitView(f, () => f.view.input().props.disabled === false);
  assert.equal(probe.count('observed_hint'), 1);
  f.view.type('synthetic-hidden-feedback'); f.view.flush(); f.view.submit(); await waitView(f, () => f.view.pendingFrames === 1);
  assert.equal(f.run().state.compatibilityApplied, true); assert.equal(f.view.pendingFrames, 1);
  f.view.visibility('hidden'); f.view.frame(); await f.view.settle(8);
  assert.equal(probe.count('observe_feedback', 'before'), 0); assert.equal(f.run().state.feedbackObserved, false);
  assert.equal(f.submitted.length, 0); assert.equal(f.closed, 0);
});

test('mount-effect replay creates no acquisition and a later explicit start captures only one presentation', async t => {
  const probe = transitionProbe(t), f = await fixture(t);
  f.view.replayMountEffects(); await f.view.settle();
  assert.equal(f.evidenceOpenCount(), 0); assert.equal(f.calls.length, 0); assert.equal(f.pins, 0);
  await present(f);
  assert.equal(f.pins, 1); assert.equal(probe.count('acquire'), 1); assert.equal(probe.count('presentation'), 1);
  assert.equal(f.idb.entries('events').length, 1); assert.equal(f.closed, 0);
});

for (const interruption of ['hidden', 'unmount'] as const) {
  test(`a durable answer cannot trigger local publication or feedback callbacks after ${interruption}`, async t => {
    const probe = transitionProbe(t), f = await fixture(t); await present(f);
    f.view.type('synthetic-retained-interrupted-draft'); f.view.flush();
    const hold = probe.hold('answer', 'after'); f.view.submit(); await hold.entered; f.view.flush();
    assert.equal(f.idb.entries('events').length, 2); assert.ok(!hasSurface(f, 'feedback'));
    if (interruption === 'hidden') f.view.visibility('hidden'); else f.view.dispose();
    hold.release(); if (interruption === 'unmount') await f.view.asynchronous(8); else await waitView(f, () => !f.view.queuedView().busy);
    assert.equal(probe.count('compatibility_applied', 'before'), 0); assert.equal(probe.count('observe_feedback', 'before'), 0);
    assert.equal(f.run().state.compatibilityApplied, false); assert.equal(f.run().state.feedbackObserved, false);
    assert.equal(f.closed, 0); assert.equal(f.submitted.length, 0);
  });
}

test('generated meaning buttons preserve target-free start and synchronously latch repeated choice clicks', async t => {
  const probe = transitionProbe(t), f = await fixture(t, { questionId: 'f01:2' });
  const quiz = CURRICULUM.find(lesson => lesson.id === 'f01')!.quiz[2];
  assert.ok(!f.view.text().includes(quiz.prompt)); assert.ok(!f.view.text().includes(quiz.choices[0]));
  f.view.click('기록형 복습 시작'); await waitView(f, () => f.view.pendingFrames === 1);
  assert.ok(f.view.text().includes(quiz.prompt)); assert.ok(f.view.button(quiz.choices[0]).props.disabled);
  f.view.frame(); await waitView(f, () => f.view.pendingFrames === 1); f.view.frame();
  await waitView(f, () => f.view.button(quiz.choices[0]).props.disabled === false);
  const hold = probe.hold('answer'), click = f.view.button(quiz.choices[0]).props.onClick as () => void;
  click(); click(); click(); await hold.entered;
  assert.equal(probe.count('answer', 'before'), 1); assert.ok(!hasSurface(f, 'feedback'));
  hold.release(); await waitView(f, () => f.view.pendingFrames === 1);
  assert.equal(probe.count('answer'), 1); assert.equal(f.idb.entries('events').length, 2);
  const handoff = f.view.queuedView().handoff; assert.ok(handoff); assert.ok(handoff.answer === quiz.choices[0], 'Committed answer does not match the selected choice'); assert.equal(handoff.correct, true);
  assert.equal(f.submitted.length, 0);
});

for (const interruption of ['hidden', 'unmount'] as const) {
  test(`late acknowledged legacy save cannot close or advance the source component after ${interruption}`, async t => {
    const probe = transitionProbe(t), f = await fixture(t); await present(f);
    f.view.type(question.choices[0]); f.view.flush(); f.view.submit(); await finishFeedback(f);
    const entered = deferred<void>(), released = deferred<void>(); t.after(() => released.resolve());
    f.actionHooks({ async after() { entered.resolve(); await released.promise; } });
    f.view.click('복습 결과 저장 · 다음 문제'); await entered.promise; f.view.flush();
    assert.equal(f.submitted.length, 1); assert.equal(probe.count('begin_retirement'), 1); assert.equal(f.closed, 0);
    assert.equal(f.run().state.lifecycle, 'retiring');
    if (interruption === 'hidden') f.view.visibility('hidden'); else f.view.dispose();
    released.resolve(); if (interruption === 'unmount') await f.view.asynchronous(8); else await waitView(f, () => !f.view.queuedView().busy);
    assert.equal(probe.count('close_retirement', 'before'), 0); assert.equal(f.closed, 0);
    assert.equal(f.submitted.length, 1); assert.equal(f.run().state.lifecycle, 'retiring');
    if (interruption === 'hidden') assert.ok(f.view.input().props.value === question.choices[0], 'Committed local draft differs');
  });
}

test('actual mutation hook acknowledgment and exact evidence close readback independently gate component advancement', async t => {
  const probe = transitionProbe(t), received = deferred<void>(), acknowledge = deferred<void>(); t.after(() => acknowledge.resolve());
  const f = await fixture(t, { component: { mutationHook: true, async afterMutation() { received.resolve(); await acknowledge.promise; } } });
  await present(f); f.view.type(question.choices[0]); f.view.flush(); f.view.submit(); await finishFeedback(f);
  const close = probe.hold('close_retirement', 'after');
  f.view.click('복습 결과 저장 · 다음 문제'); await received.promise; f.view.flush();
  assert.equal(f.view.mutationCalls, 1); assert.equal(f.view.hookAction()?.isPending(), true);
  assert.equal(f.closed, 0); assert.ok(f.view.input().props.value === question.choices[0], 'Committed local draft differs');
  assert.equal(f.run().state.lifecycle, 'retiring'); assert.equal(probe.count('close_retirement', 'before'), 0);
  assert.ok(!nodes(f.view.tree()).some(node => node.type === 'button' && ['저장 다시 확인', '최신 상태에서 새로 저장', '입력 버리기'].includes(textOf(node))));
  acknowledge.resolve(); await close.entered; f.view.flush();
  assert.equal(f.view.hookAction()?.isPending(), false, 'The actual shared hook already published its acknowledged result');
  assert.equal(f.run().state.lifecycle, 'closed', 'The evidence closure is durable but its exact readback is still held');
  assert.equal(f.closed, 0); assert.ok(hasSurface(f, 'question')); assert.ok(f.view.input().props.value === question.choices[0], 'Committed local draft differs');
  close.release(); await waitView(f, () => f.closed === 1);
  assert.equal(f.view.mutationCalls, 1); assert.equal(probe.count('close_retirement'), 1); assert.ok(!hasSurface(f, 'question'));
  assert.match(f.view.text(), /복습 결과와 종료 기록을 확인/);
});

test('component recovery calls the actual retained hook retry and closes the same acknowledged operation without redispatch', async t => {
  const probe = transitionProbe(t); let loseResponse = true;
  const f = await fixture(t, { component: { mutationHook: true, afterMutation() { if (loseResponse) { loseResponse = false; throw Error('synthetic returned acknowledgement loss'); } } } });
  await present(f); f.view.type(question.choices[0]); f.view.flush(); f.view.submit(); await finishFeedback(f);
  f.view.click('복습 결과 저장 · 다음 문제');
  await waitView(f, () => f.view.queuedView().status === 'retiring' && !f.view.queuedView().busy);
  assert.equal(f.view.mutationCalls, 1); assert.equal(f.view.hookAction()?.isPending(), true); assert.equal(f.closed, 0);
  const rowBytes = f.local.storage.getItem('japaneseCurriculumReviewV1')!;
  const operation = JSON.parse(rowBytes)[0].languageLastOperationV1;
  assert.ok(operation, 'The actual planner wrote its original durable receipt');
  assert.equal(f.view.hookAction()?.canResubmit, false);
  f.view.click('같은 기록 다시 확인'); await waitView(f, () => f.closed === 1);
  assert.equal(f.view.mutationCalls, 1, 'Retry reconciles committed bytes instead of running a new legacy mutation');
  assert.ok(f.local.storage.getItem('japaneseCurriculumReviewV1') === rowBytes, 'Retry changed the immutable legacy receipt');
  assert.ok(JSON.parse(f.local.storage.getItem('japaneseCurriculumReviewV1')!)[0].languageLastOperationV1.operationId === operation.operationId, 'Retry changed the operation identity');
  assert.equal(probe.count('begin_retirement'), 1); assert.equal(probe.count('close_retirement'), 1);
  assert.equal(f.view.hookAction()?.isPending(), false);
});

test('feedback frame callback with a replaced event marker cannot acknowledge observation', async t => {
  const probe = transitionProbe(t), f = await fixture(t); await present(f);
  f.view.type('synthetic-stale-feedback'); f.view.flush(); f.view.submit();
  await waitView(f, () => f.view.pendingFrames === 1);
  assert.equal(f.run().state.compatibilityApplied, true); assert.equal(f.run().state.feedbackObserved, false);
  f.view.frame(); await waitView(f, () => f.view.pendingFrames === 1);
  f.view.alterMarker('feedback', 'event'); f.view.frame(); await waitView(f, () => !f.view.queuedView().busy);
  assert.equal(probe.count('observe_feedback', 'before'), 0); assert.equal(f.run().state.feedbackObserved, false);
  assert.equal(f.run().state.phase, 'feedback_pending'); assert.equal(f.idb.entries('events').length, 2);
  assert.equal(f.closed, 0); assert.equal(f.submitted.length, 0);
});

test('another adapter answering a newer draft cannot overwrite the source component raw draft on submit or recovery', async t => {
  const probe = transitionProbe(t), f = await fixture(t); await present(f);
  const original = f.view.queuedView(), raw = 'synthetic-original-unsubmitted-draft', newer = 'synthetic-other-newer-answer';
  f.view.type(raw); f.view.flush();
  const other = f.create(); assert.equal(await other.start(), true);
  assert.ok(other.view().runId === original.runId, 'The second adapter must select the existing run');
  assert.equal(await other.answer('synthetic-other-first-answer', { responseMs: 400, neededHelp: false, modality: 'typing' }), true);
  const first = other.view().handoff; assert.ok(first);
  assert.equal(await other.published({ runId: other.view().runId!, draftToken: first.draftToken, eventId: first.eventId, answer: first.answer, correct: first.correct, observation: first.observation }), true);
  assert.equal(await observeReview(other, 'feedback'), true);
  assert.equal(await other.retryAnswer(), true);
  assert.equal(await other.cleared({ runId: other.view().runId!, draftToken: other.view().draftToken!, answer: '', hintShown: false, feedbackShown: false }), true);
  assert.equal(await other.answer(newer, { responseMs: 600, neededHelp: false, modality: 'typing' }), true);
  assert.ok(other.view().draftToken !== original.draftToken, 'The other answer must belong to a genuinely newer draft');
  assert.ok(other.view().handoff?.answer === newer, 'The newer checkpoint must contain a non-null competing handoff');
  assert.equal(probe.count('answer'), 2); assert.equal(f.idb.entries('events').length, 3);
  f.view.submit(); await waitView(f, () => f.view.queuedView().status === 'blocked' && !f.view.queuedView().busy);
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.ok(f.view.input().props.value === raw, 'Stale refresh replaced the original unsubmitted draft');
    assert.ok(f.view.queuedView().draftToken === original.draftToken, 'Stale refresh adopted the other draft token');
    assert.ok(f.view.queuedView().handoff === null, 'Blocked local draft adopted a competing handoff'); assert.ok(!hasSurface(f, 'feedback'));
    assert.ok(!f.view.text().includes(newer), 'The competing answer leaked into the blocked surface');
    assert.equal(probe.count('answer'), 2); assert.equal(f.idb.entries('events').length, 3);
    if (attempt === 0) { f.view.click('같은 기록 다시 확인'); await waitView(f, () => f.view.queuedView().status === 'blocked' && !f.view.queuedView().busy); }
  }
  assert.equal(f.closed, 0); assert.equal(f.submitted.length, 0);
});

test('stale retry and recovery retain the original committed feedback instead of adopting another adapter handoff', async t => {
  const probe = transitionProbe(t), f = await fixture(t); await present(f);
  const raw = 'synthetic-original-visible-feedback', newer = 'synthetic-other-replacement-feedback';
  f.view.type(raw); f.view.flush(); f.view.submit(); await finishFeedback(f);
  const original = f.view.queuedView(); assert.ok(original.handoff);
  const other = f.create(); assert.equal(await other.start(), true); assert.equal(await other.retryAnswer(), true);
  assert.equal(await other.cleared({ runId: other.view().runId!, draftToken: other.view().draftToken!, answer: '', hintShown: false, feedbackShown: false }), true);
  assert.equal(await other.answer(newer, { responseMs: 600, neededHelp: false, modality: 'typing' }), true);
  assert.ok(other.view().handoff?.answer === newer, 'The competing checkpoint must have a new answer');
  const retries = probe.count('retry');
  f.view.click('다시 풀어볼래요'); await waitView(f, () => f.view.queuedView().status === 'blocked' && !f.view.queuedView().busy);
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.ok(f.view.input().props.value === raw, 'Stale retry replaced the original local answer');
    assert.ok(f.view.queuedView().draftToken === original.draftToken, 'Stale retry adopted another draft token');
    assert.ok(f.view.queuedView().handoff?.eventId === original.handoff?.eventId, 'Stale retry replaced the original feedback identity');
    assert.ok(hasSurface(f, 'feedback')); assert.ok(f.view.text().includes(raw)); assert.ok(!f.view.text().includes(newer));
    assert.equal(probe.count('retry'), retries); assert.equal(probe.count('answer'), 2); assert.equal(f.idb.entries('events').length, 3);
    if (attempt === 0) { f.view.click('같은 기록 다시 확인'); await waitView(f, () => f.view.queuedView().status === 'blocked' && !f.view.queuedView().busy); }
  }
  assert.equal(f.closed, 0); assert.equal(f.submitted.length, 0);
});

test('a stale committed retry-clear effect cannot settle the pending retry after the document is hidden', async t => {
  const probe = transitionProbe(t), f = await fixture(t, { component: { mutationHook: true } }); await present(f);
  f.view.type('synthetic-passive-retry-draft'); f.view.flush(); f.view.submit(); await finishFeedback(f);
  f.view.click('다시 풀어볼래요'); await until(() => f.view.queuedView().status === 'retry_pending' && !f.view.queuedView().busy);
  f.view.render(); f.view.flushEffects(); f.view.render();
  assert.ok(f.view.input().props.value === '', 'Retry clear was not committed to the local input');
  assert.equal(f.run().state.action?.kind, 'retry'); assert.equal(probe.count('ack_retry', 'before'), 0);
  f.view.visibility('hidden'); f.view.flushEffects(); await waitView(f, () => !f.view.queuedView().busy);
  assert.equal(probe.count('ack_retry', 'before'), 0); assert.equal(f.run().state.action?.kind, 'retry');
  assert.equal(f.view.queuedView().status, 'blocked'); assert.ok(f.view.input().props.disabled);
  f.view.visibility('visible'); await f.view.settle();
  assert.equal(probe.count('ack_retry', 'before'), 0, 'Becoming visible must not acknowledge an interrupted clear automatically');
  assert.equal(f.view.queuedView().status, 'blocked'); assert.ok(f.view.button('같은 기록 다시 확인'));
  f.view.click('같은 기록 다시 확인'); await waitView(f, () => f.view.queuedView().status === 'ready' && !f.view.queuedView().busy);
  assert.equal(probe.count('ack_retry'), 1); assert.ok(f.run().state.action === null);
  assert.ok(f.view.input().props.value === '', 'Explicit recovery changed the committed empty draft');
  assert.equal(f.view.input().props.disabled, false); assert.equal(f.run().state.hadWrong, true);
  assert.equal(f.closed, 0); assert.equal(f.view.mutationCalls, 0);
});

test('a stale committed publication effect cannot acknowledge the local handoff after hidden invalidation', async t => {
  const probe = transitionProbe(t), f = await fixture(t, { component: { mutationHook: true } }); await present(f);
  const raw = 'synthetic-passive-publication-draft'; f.view.type(raw); f.view.flush(); f.view.submit();
  await until(() => f.view.queuedView().status === 'feedback_pending' && !f.view.queuedView().busy);
  f.view.render(); f.view.flushEffects(); f.view.render();
  assert.ok(hasSurface(f, 'feedback')); assert.equal(f.run().state.compatibilityApplied, false);
  f.view.visibility('hidden'); f.view.flushEffects(); await waitView(f, () => !f.view.queuedView().busy);
  assert.equal(probe.count('compatibility_applied', 'before'), 0); assert.equal(f.run().state.compatibilityApplied, false);
  assert.equal(probe.count('observe_feedback', 'before'), 0); assert.equal(f.run().state.feedbackObserved, false);
  assert.ok(f.view.input().props.value === raw, 'Hidden publication changed the preserved local answer');
  assert.equal(f.view.queuedView().status, 'blocked'); assert.equal(f.closed, 0); assert.equal(f.view.mutationCalls, 0);
});

for (const interruption of ['hidden', 'owner_abort'] as const) {
  test(`a stale closed-render passive effect cannot advance the source component after ${interruption}`, async t => {
    const probe = transitionProbe(t), f = await fixture(t, { component: { mutationHook: true } }); await present(f);
    f.view.type(question.choices[0]); f.view.flush(); f.view.submit(); await finishFeedback(f);
    f.view.click('복습 결과 저장 · 다음 문제');
    await until(() => f.view.queuedView().status === 'closed' && !f.view.queuedView().busy);
    f.view.render(); assert.equal(f.closed, 0); assert.equal(f.run().state.lifecycle, 'closed');
    if (interruption === 'hidden') f.view.visibility('hidden'); else f.coordinator.pause();
    f.view.flushEffects(); assert.equal(f.closed, 0, 'A stale closed effect advanced after invalidation');
    await f.view.settle(); assert.equal(f.closed, 0);
    assert.equal(probe.count('close_retirement'), 1); assert.equal(f.view.mutationCalls, 1);
  });
}

test('confirmed unavailable close after interrupted acquisition unpins exactly once without an adopted draft', async t => {
  const probe = transitionProbe(t), hold = probe.hold('acquire', 'after');
  const f = await fixture(t, { component: { mutationHook: true } });
  f.view.click('기록형 복습 시작'); await hold.entered;
  f.view.visibility('hidden'); hold.release(); await waitView(f, () => !f.view.queuedView().busy);
  assert.equal(f.pins, 1); assert.equal(f.closed, 0); assert.ok(f.view.queuedView().draftToken === null);
  assert.ok(!hasSurface(f, 'question')); assert.equal(f.idb.entries('events').length, 0);
  f.view.visibility('visible'); f.view.click('기록형 복습 종료 확인');
  await waitView(f, () => f.view.queuedView().status === 'closed' && !f.view.queuedView().busy);
  assert.equal(f.run().state.lifecycle, 'closed'); assert.equal(probe.count('close_unavailable'), 1);
  assert.equal(f.closed, 1, 'Verified closure must not require a local answer draft');
  f.view.render(); f.view.flush(); await f.view.settle(); assert.equal(f.closed, 1);
  assert.equal(f.idb.entries('events').length, 0); assert.equal(f.view.mutationCalls, 0);
});

test('an answered remount discovers its two pending events and exposes explicit server confirmation without capture', async t => {
  const probe = transitionProbe(t), f = await fixture(t, { component: { mutationHook: true } }); await present(f);
  f.view.type('synthetic-answered-remount'); f.view.flush(); f.view.submit(); await finishFeedback(f);
  assert.equal(f.idb.entries('events').length, 2); const firstRun = f.run(), captures = probe.count('presentation') + probe.count('answer');
  f.view.dispose();
  let reopenedClosed = 0;
  const reopened = mountCapturedReviewComponent(f.adapterModule, { ...f.props, source: f.source(), onClosed() { reopenedClosed++; } }, { mutationHook: true });
  t.after(reopened.dispose);
  assert.equal(probe.count('presentation') + probe.count('answer'), captures);
  reopened.click('기록형 복습 시작');
  await until(() => { reopened.flush(); return reopened.queuedView().status === 'answered' && !reopened.queuedView().busy; });
  assert.equal(reopened.queuedView().delivery, 'pending');
  assert.ok(reopened.button('서버 기록 확인')); assert.equal(reopened.button('서버 기록 확인').props.disabled, false);
  assert.equal(reopened.pendingFrames, 0); assert.equal(f.idb.entries('events').length, 2);
  assert.equal(probe.count('presentation') + probe.count('answer'), captures, 'Restored delivery must not need a new capture event');
  assert.ok(f.run().immutable.runId === firstRun.immutable.runId, 'Remount created a different run');
  assert.equal(f.calls.filter(call => call.name === 'append_language_legacy_evidence').length, 0, 'Restoration must not send evidence automatically');
  assert.equal(reopenedClosed, 0); assert.equal(reopened.mutationCalls, 0);
});

async function unavailableClosureInterruptedBeforeEffect(t: TestContext) {
  const probe = transitionProbe(t), hold = probe.hold('acquire', 'after');
  const f = await fixture(t, { component: { mutationHook: true } });
  f.view.click('기록형 복습 시작'); await hold.entered;
  f.view.visibility('hidden'); hold.release(); await waitView(f, () => !f.view.queuedView().busy);
  f.view.visibility('visible'); f.view.click('기록형 복습 종료 확인');
  await until(() => f.view.queuedView().status === 'closed' && !f.view.queuedView().busy);
  f.view.render(); assert.equal(f.closed, 0); assert.equal(f.run().state.lifecycle, 'closed');
  f.view.visibility('hidden'); f.view.flushEffects(); f.view.flush();
  assert.equal(f.closed, 0); assert.equal(f.view.queuedView().status, 'blocked');
  assert.equal(probe.count('close_unavailable'), 1); assert.equal(f.idb.entries('events').length, 0);
  return { f, probe };
}

test('explicit recovery after a hidden closed render proves the retained unavailable closure exactly once without a new write', async t => {
  const { f, probe } = await unavailableClosureInterruptedBeforeEffect(t);
  const commits = probe.calls.filter(call => call.stage === 'before').length;
  const journals = f.idb.entries('reviewTransitions').length, closureId = f.run().state.latestTransitionId;
  f.view.visibility('visible'); await f.view.settle(); assert.equal(f.closed, 0);
  f.view.click('같은 기록 다시 확인'); await waitView(f, () => f.closed === 1);
  assert.equal(f.view.queuedView().status, 'closed'); assert.equal(probe.count('close_unavailable'), 1);
  assert.ok(f.run().state.latestTransitionId === closureId, 'Recovery changed the retained closure identity');
  assert.equal(probe.calls.filter(call => call.stage === 'before').length, commits, 'Closure recovery attempted a new review commit');
  assert.equal(f.idb.entries('reviewTransitions').length, journals); assert.equal(f.idb.entries('events').length, 0);
  f.view.render(); f.view.flush(); await f.view.settle(); assert.equal(f.closed, 1);
  assert.equal(f.view.mutationCalls, 0);
});

test('an unavailable closure read failure leaves completion blocked and preserves the same closure for explicit retry', async t => {
  const { f, probe } = await unavailableClosureInterruptedBeforeEffect(t);
  const commits = probe.calls.filter(call => call.stage === 'before').length;
  const journals = f.idb.entries('reviewTransitions').length, closureId = f.run().state.latestTransitionId;
  const original = LocalEvidenceStore.prototype.readReviewTransition; let reads = 0;
  LocalEvidenceStore.prototype.readReviewTransition = async function (...args: Parameters<typeof original>) {
    const kind = (JSON.parse(args[0].journal.canonical) as ReviewJournalPayload).operation.kind;
    if (kind === 'close_unavailable' && ++reads === 1) f.idb.failNextRead();
    return original.apply(this, args);
  };
  t.after(() => { LocalEvidenceStore.prototype.readReviewTransition = original; });
  f.view.visibility('visible'); f.view.click('같은 기록 다시 확인');
  await waitView(f, () => !f.view.queuedView().busy);
  assert.equal(reads, 1); assert.equal(f.closed, 0); assert.equal(f.view.queuedView().status, 'blocked');
  assert.equal(probe.calls.filter(call => call.stage === 'before').length, commits);
  assert.equal(f.idb.entries('reviewTransitions').length, journals);
  f.view.click('같은 기록 다시 확인'); await waitView(f, () => f.closed === 1);
  assert.equal(reads, 2); assert.equal(probe.count('close_unavailable'), 1);
  assert.ok(f.run().state.latestTransitionId === closureId, 'Read retry changed the retained closure identity');
  assert.equal(probe.calls.filter(call => call.stage === 'before').length, commits);
  assert.equal(f.idb.entries('reviewTransitions').length, journals); assert.equal(f.view.mutationCalls, 0);
});

for (const revocation of ['owner', 'reset_marker'] as const) {
  test(`unavailable closure recovery refuses a held old read after ${revocation} revocation without callback or new write`, async t => {
    const { f, probe } = await unavailableClosureInterruptedBeforeEffect(t);
    const commits = probe.calls.filter(call => call.stage === 'before').length;
    const journals = f.idb.entries('reviewTransitions').length, closureId = f.run().state.latestTransitionId;
    const entered = deferred<void>(), released = deferred<void>();
    const original = LocalEvidenceStore.prototype.readReviewTransition; let held = false;
    LocalEvidenceStore.prototype.readReviewTransition = async function (...args: Parameters<typeof original>) {
      const result = await original.apply(this, args);
      if (!held && (JSON.parse(args[0].journal.canonical) as ReviewJournalPayload).operation.kind === 'close_unavailable') {
        held = true; entered.resolve(); await released.promise;
      }
      return result;
    };
    t.after(() => { released.resolve(); LocalEvidenceStore.prototype.readReviewTransition = original; });
    f.view.visibility('visible'); f.view.click('같은 기록 다시 확인'); await entered.promise;
    if (revocation === 'owner') {
      const nextOwner = crypto.randomUUID(); f.setUser(nextOwner); await f.local.owner(nextOwner);
    } else {
      f.local.storage.setItem(LANGUAGE_MARKER_KEY, `${new Date().toISOString()}|${crypto.randomUUID()}`);
      f.coordinator.notifyStorage(LANGUAGE_MARKER_KEY);
    }
    released.resolve(); await waitView(f, () => !f.view.queuedView().busy);
    assert.equal(f.closed, 0); assert.equal(f.view.queuedView().status, 'blocked');
    assert.equal(probe.calls.filter(call => call.stage === 'before').length, commits);
    assert.equal(probe.count('close_unavailable'), 1); assert.equal(f.idb.entries('reviewTransitions').length, journals);
    assert.ok(f.run().state.latestTransitionId === closureId, 'Revoked recovery changed the retained closure identity');
    assert.equal(f.idb.entries('events').length, 0); assert.equal(f.view.mutationCalls, 0);
  });
}

