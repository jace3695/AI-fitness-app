import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationSessionFixture } from './helpers/conversationSessionFixture.ts';
import { deferred, nodes } from './helpers/storage-ui-fixture.ts';
import { GUIDED_CONVERSATION_PILOT } from '../data/guidedConversationPilot.ts';
import { classifyGuidedCheckpoint, type GuidedCheckpoint } from './e2e/guided-checkpoint-recovery.ts';
import { validateEnvelope, type ConversationEnvelope } from '../lib/conversation-session/contracts.ts';
import { findGuidedConversationCatalogScript } from '../data/guidedConversationCatalog.ts';

type Hook = ReturnType<typeof import('../components/language/useConversationSession.ts')['useConversationSession']>;

for (const boundary of ['refreshed-context', 'unacknowledged-result'] as const) for (const newer of ['none', 'input', 'exposure'] as const) test(`train draft ${boundary} / ${newer} recovery never saves a newer editor implicitly`, async t => {
  const script = findGuidedConversationCatalogScript('guided-train-elementary', 'sha256:ab4d4a40900eb5c232d2a3090843dbe198f8113854248349940c7f791d15c085');
  assert.ok(script);
  const f = await conversationSessionFixture(); t.after(f.dispose);
  // Match the browser helper's localStorage JSON boundary across the VM realm.
  const envelope = (): ConversationEnvelope => JSON.parse(JSON.stringify(f.snapshot().envelope));
  const h = f.mountHook<Hook>(() => (f.tab.loadModule('components/language/useConversationSession.ts') as typeof import('../components/language/useConversationSession.ts')).useConversationSession());
  const selection = Object.assign(Object.create(null), { kind: 'guided', scriptId: script.scriptId, scriptRevision: script.scriptRevision });
  assert.equal(await h.current.start(selection), true); await h.view.settle();
  const initial = envelope();
  for (const step of script.steps.slice(0, -1)) {
    h.current.typeInput(step.learnerExample.japanese); await h.view.settle();
    assert.equal(await h.current.send(), true); await h.view.settle();
  }
  h.current.observeExposure({ example: 'shown', meaning: 'shown', reading: 'shown' }, h.current.activeStepRef!); await h.view.settle();
  const before = envelope();
  const run = f.facade.runConversationEdit; let draftWrites = 0;
  const boundaryFinished = deferred<void>();
  Object.assign(f.facade, { async runConversationEdit(intent: Parameters<typeof run>[0]) {
    if (intent.kind !== 'draft') return run(intent);
    draftWrites++;
    const restore = boundary === 'unacknowledged-result' ? f.failNextNotification() : () => {};
    let result: Awaited<ReturnType<typeof run>>;
    try { result = await run(intent); } finally { restore(); }
    if (boundary === 'refreshed-context') {
      assert.equal(result.acknowledged, true);
      const context = result.source!.context;
      await f.refresh(); await h.view.settle();
      assert.equal(f.language.isLanguageRecordContextCurrent(context), false);
    } else { assert.equal(result.acknowledged, false); assert.equal(result.source, null); }
    if (newer === 'input') h.current.typeInput('SYNTHETIC_NEWER_INPUT');
    if (newer === 'exposure') h.current.observeExposure({ hint: 'shown' }, h.current.activeStepRef!);
    boundaryFinished.resolve(); return result;
  } });
  const text = script.steps.at(-1)!.learnerExample.japanese;
  h.current.typeInput(text); await boundaryFinished.promise; await h.view.settle();
  assert.equal(h.current.status, 'uncertain'); assert.equal(h.current.diagnostics.pendingKind, 'draft');
  assert.equal(h.current.diagnostics.editorDirty, true); assert.equal(h.current.diagnostics.draftCount, 1);
  assert.equal(h.current.diagnostics.contextCurrent, true); assert.equal(h.current.input, newer === 'input' ? 'SYNTHETIC_NEWER_INPUT' : text);
  const checkpoint: GuidedCheckpoint = { kind: 'draft', before, stepIndex: 2, input: text, origin: { kind: 'typed', edited: false } };
  assert.equal(classifyGuidedCheckpoint({ surface: 'present', ...h.current.diagnostics }, envelope(), initial, checkpoint, h.current.input), newer === 'none' ? 'draft-applied' : 'refused');
  const beforeRead = JSON.stringify(f.snapshot().envelope), writes = f.browser.writes.length;
  // The original save click cannot bypass its still-unacknowledged auto-save.
  assert.equal(await h.current.save(), false); assert.equal(draftWrites, 1);
  assert.equal(await h.current.recover(), true); await h.view.settle();
  assert.equal(h.current.status, newer === 'none' ? 'saved' : 'unsaved'); assert.equal(h.current.input, newer === 'input' ? 'SYNTHETIC_NEWER_INPUT' : text);
  assert.equal(h.current.diagnostics.editorDirty, newer !== 'none'); assert.equal(h.current.diagnostics.pendingKind, 'none');
  assert.equal(JSON.stringify(f.snapshot().envelope), beforeRead); assert.equal(f.browser.writes.length, writes); assert.equal(draftWrites, 1);
});

for (const boundary of ['refreshed-context', 'unacknowledged-result'] as const) test(`pilot staged close ${boundary} offers readback then explicit abandonment before a separately captured close`, async t => {
  const f = await conversationSessionFixture(); t.after(f.dispose);
  // Match the browser helper's localStorage JSON boundary across the VM realm.
  const envelope = (): ConversationEnvelope => JSON.parse(JSON.stringify(f.snapshot().envelope));
  const page = f.mountPage(), script = GUIDED_CONVERSATION_PILOT[1];
  const input = (id: string) => {
    const node = nodes(page.render()).find(node => node.props.id === id); assert.ok(node); return node;
  };
  const change = (id: string, value: string) => (input(id).props.onChange as (event: unknown) => void)({ target: { value } });
  page.click('수준별 연습 선택'); await page.settle();
  change('conversation-context', script.contextId); await page.settle();
  change('conversation-level', script.levelId); await page.settle();
  const checkbox = nodes(page.render()).find(node => node.type === 'input' && node.props.type === 'checkbox'); assert.ok(checkbox);
  (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
  page.click('새 대화 시작'); await page.settle();
  const initial = envelope();
  for (const [index, step] of script.steps.entries()) {
    change('conversation-input', step.learnerExample.japanese); await page.settle();
    page.click('입력 저장'); await page.settle();
    page.click(index === script.steps.length - 1 ? '마지막 문장 보내기' : '보내고 다음 단계로'); await page.settle();
  }
  const beforeClose = envelope();
  const stage = f.facade.stageConversationIntent, apply = f.facade.applyConversationIntent;
  let stagedClose: Parameters<typeof stage>[0] | undefined, applies = 0;
  const boundaryFinished = deferred<void>();
  Object.assign(f.facade, {
    async stageConversationIntent(intent: Parameters<typeof stage>[0]) {
      const intercept = intent.command.kind === 'close' && !stagedClose;
      const restore = intercept && boundary === 'unacknowledged-result' ? f.failNextNotification() : () => {};
      let result: Awaited<ReturnType<typeof stage>>;
      try { result = await stage(intent); } finally { restore(); }
      if (intercept) {
        stagedClose = intent;
        if (boundary === 'refreshed-context') {
          assert.equal(result.acknowledged, true);
          const context = result.source!.context;
          await f.refresh(); await page.settle();
          assert.equal(f.language.isLanguageRecordContextCurrent(context), false);
        } else { assert.equal(result.acknowledged, false); assert.equal(result.source, null); }
        boundaryFinished.resolve();
      }
      return result;
    },
    applyConversationIntent(intent: Parameters<typeof apply>[0]) { applies++; return apply(intent); },
  });
  page.click('대화 종료'); await boundaryFinished.promise; await page.settle();
  assert.ok(stagedClose); assert.equal(applies, 0);
  const session = () => envelope().sessions[0];
  const pending = session(), original = pending.operations.at(-1)!;
  const diagnostic = () => JSON.parse(nodes(page.render()).find(node => node.props['data-conversation-diagnostic'])!.props['data-conversation-diagnostic'] as string);
  const checkpoint: GuidedCheckpoint = { kind: 'close', before: beforeClose, stepIndex: 2 };
  assert.equal(classifyGuidedCheckpoint(diagnostic(), envelope(), initial, checkpoint), 'close-pending');
  assert.equal(original.command.kind, 'close'); assert.equal(original.terminal, null); assert.equal(pending.closed, null);
  assert.equal(pending.turns.length, script.steps.length); assert.equal(page.button('대화 종료').props.disabled, true);
  const beforeRead = JSON.stringify(f.snapshot().envelope), readWrites = f.browser.writes.length;
  page.click('저장 다시 확인'); await page.settle();
  assert.equal(JSON.stringify(f.snapshot().envelope), beforeRead); assert.equal(f.browser.writes.length, readWrites);
  assert.equal(page.button('대화 종료').props.disabled, true); assert.match(page.text(), /저장 요청이 보류되어 있어요/);
  if (boundary === 'refreshed-context') await assert.rejects(apply(stagedClose), 'Retired pending command cannot be rebound to fresh authority');
  const partitionWrites = () => f.browser.writes.filter(write => write.key === f.participants.conversationLocalKey(f.lease.userId)).length;
  const beforeAbandonWrites = partitionWrites();
  const verifyOldTerminalCannotChangeStorage = async () => {
    const raw = JSON.stringify(f.snapshot().envelope), writes = f.browser.writes.length;
    if (boundary === 'refreshed-context') {
      await assert.rejects(stage(stagedClose!)); await assert.rejects(apply(stagedClose!));
    } else {
      // Still-current authority may observe the existing terminal idempotently;
      // it cannot reopen/cancel differently or resurrect the original close.
      assert.equal((await stage(stagedClose!)).effect.kind, 'cancelled');
      assert.equal((await apply(stagedClose!)).effect.kind, 'cancelled');
    }
    assert.equal(JSON.stringify(f.snapshot().envelope), raw); assert.equal(f.browser.writes.length, writes);
  };
  page.click('보류 종료 취소'); await page.settle();
  const cancelled = session(), terminal = cancelled.operations.at(-1)!.terminal;
  assert.equal(terminal?.kind, 'cancelled'); assert.equal(cancelled.closed, null);
  assert.equal(JSON.stringify(cancelled.turns), JSON.stringify(pending.turns)); assert.equal(JSON.stringify(cancelled.drafts), JSON.stringify(pending.drafts));
  assert.equal(JSON.stringify(cancelled.operations.at(-1)!.command), JSON.stringify(original.command));
  assert.equal(partitionWrites(), beforeAbandonWrites + 1, 'Explicit cancellation writes exactly one partition revision');
  await verifyOldTerminalCannotChangeStorage();
  assert.equal(cancelled.headRevision, pending.headRevision); assert.equal(cancelled.stateRevision, pending.stateRevision + 1);
  assert.equal(page.button('대화 종료').props.disabled, false); assert.equal(applies, 0);
  page.click('대화 종료'); await page.settle();
  const completed = session(), replacement = completed.operations.at(-1)!;
  assert.ok(completed.closed); assert.equal(replacement.command.kind, 'close'); assert.equal(replacement.terminal?.kind, 'applied');
  assert.notEqual(replacement.command.operationId, original.command.operationId); assert.notEqual(replacement.command.receiptId, original.command.receiptId); assert.equal(applies, 1);
  assert.equal(partitionWrites(), beforeAbandonWrites + 3, 'The distinct new close has one stage and one apply write');
  assert.ok(replacement.command.kind === 'close' && original.command.kind === 'close');
  assert.notEqual(replacement.command.boundary.boundaryId, original.command.boundary.boundaryId);
  await verifyOldTerminalCannotChangeStorage();
  assert.equal(JSON.stringify(completed.operations.at(-2)), JSON.stringify(cancelled.operations.at(-1)));
  assert.equal(completed.operations.filter(op => op.command.kind === 'close' && op.terminal?.kind === 'applied').length, 1);
  assert.equal(completed.operations.filter(op => op.command.kind === 'close' && op.terminal?.kind === 'cancelled').length, 1);
  assert.equal(JSON.stringify(completed.turns), JSON.stringify(pending.turns)); assert.match(page.text(), /종료한 대화 요약/);
});

test('checkpoint classifier proves normal transitions and rejects changed authority, metadata, input and operation identity', async t => {
  const f = await conversationSessionFixture(); t.after(f.dispose);
  const envelope = (): ConversationEnvelope => JSON.parse(JSON.stringify(f.snapshot().envelope));
  const h = f.mountHook<Hook>(() => (f.tab.loadModule('components/language/useConversationSession.ts') as typeof import('../components/language/useConversationSession.ts')).useConversationSession());
  const script = GUIDED_CONVERSATION_PILOT[1];
  assert.equal(await h.current.start(Object.assign(Object.create(null), { kind: 'guided', scriptId: script.scriptId, scriptRevision: script.scriptRevision })), true); await h.view.settle();
  const initial = envelope();
  type Candidate = { state: Parameters<typeof classifyGuidedCheckpoint>[0]; after: ConversationEnvelope; initial: ConversationEnvelope; checkpoint: GuidedCheckpoint; editor?: string };
  const classify = (value: Candidate) => classifyGuidedCheckpoint(value.state, value.after, value.initial, value.checkpoint, value.editor);
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  let draft!: Candidate, append!: Candidate;
  for (const [stepIndex, step] of script.steps.entries()) {
    h.current.observeExposure({ example: 'shown', meaning: 'shown', reading: 'shown' }, h.current.activeStepRef!); await h.view.settle();
    const before = envelope();
    h.current.typeInput(step.learnerExample.japanese); await h.view.settle();
    const savedDraft: Candidate = { state: { surface: 'present', ...h.current.diagnostics }, after: envelope(), initial,
      checkpoint: { kind: 'draft', before, input: step.learnerExample.japanese, origin: { kind: 'typed', edited: false }, stepIndex }, editor: h.current.input };
    assert.equal(classify(savedDraft), 'draft-applied');
    const beforeAppend = envelope();
    assert.equal(await h.current.send(), true); await h.view.settle();
    const sent: Candidate = { state: { surface: 'present', ...h.current.diagnostics }, after: envelope(), initial,
      checkpoint: { kind: 'append', before: beforeAppend, stepIndex } };
    assert.equal(classify(sent), 'append-applied');
    if (stepIndex === 0) { draft = savedDraft; append = sent; }
  }
  const beforeClose = envelope();
  assert.equal(await h.current.end(), true); await h.view.settle();
  const close: Candidate = { state: { surface: 'present', ...h.current.diagnostics }, after: envelope(), initial,
    checkpoint: { kind: 'close', before: beforeClose, stepIndex: script.steps.length - 1 } };
  assert.equal(classify(close), 'close-applied');
  const uncertainDraft = clone(draft); Object.assign(uncertainDraft.state, { status: 'uncertain', pendingKind: 'draft', editorDirty: true });
  assert.equal(classify(uncertainDraft), 'draft-applied');
  const uncertainAppend = clone(append); Object.assign(uncertainAppend.state, { status: 'uncertain', pendingKind: 'append', commandBoundary: 'staged' });
  assert.equal(classify(uncertainAppend), 'append-applied');
  const uncertainClose = clone(close); Object.assign(uncertainClose.state, { status: 'uncertain', pendingKind: 'close', commandBoundary: 'staged' });
  assert.equal(classify(uncertainClose), 'close-applied');
  const pending = (value: Candidate): Candidate => {
    const next = clone(value), old = next.checkpoint.before.sessions[0], command = next.after.sessions[0].operations.at(-1)!.command;
    next.after.sessions[0] = { ...old, stateRevision: old.stateRevision + 1, operations: [...old.operations, { command, terminal: null }] };
    Object.assign(next.state, { status: 'uncertain', pendingKind: next.checkpoint.kind, commandBoundary: 'captured', closedBoundary: false,
      stepIndex: next.checkpoint.kind === 'append' ? next.checkpoint.stepIndex : null, turnCount: old.turns.length, draftCount: old.drafts.length,
      submittedSteps: old.turns.length, editorPresent: next.checkpoint.kind === 'append', editorOnActiveStep: next.checkpoint.kind === 'append' });
    return next;
  };
  const pendingClose = pending(close); assert.equal(classify(pendingClose), 'close-pending');
  const cases: [string, Candidate, (value: Candidate) => void][] = [
    ['missing context', uncertainDraft, v => { v.state.contextCurrent = false; }],
    ['unavailable surface', uncertainDraft, v => { v.state.available = false; }],
    ['busy boundary', uncertainDraft, v => { v.state.busy = true; }],
    ['source conflict', uncertainDraft, v => { v.state.errorCode = 'source-conflict'; }],
    ['still pending result', uncertainDraft, v => { v.state.status = 'pending'; }],
    ['wrong pending action', uncertainDraft, v => { v.state.pendingKind = 'append'; }],
    ['different current editor input', uncertainDraft, v => { v.editor = 'NEWER_INPUT'; }],
    ['different stored draft input', uncertainDraft, v => { v.after.sessions[0].drafts[0].input = 'OTHER_DRAFT'; }],
    ['newer provenance', uncertainDraft, v => { v.state.exposure = { example: 'shown', meaning: 'shown', reading: 'shown', hint: 'shown' }; }],
    ['different draft origin', uncertainDraft, v => { v.checkpoint.origin = { kind: 'inserted-example', edited: false }; }],
    ['newer draft revision', uncertainDraft, v => { v.after.sessions[0].drafts[0].revision++; }],
    ['wrong step', uncertainDraft, v => { v.checkpoint.stepIndex++; }],
    ['wrong append step', uncertainAppend, v => { v.checkpoint.stepIndex++; }],
    ['wrong close step', uncertainClose, v => { v.checkpoint.stepIndex--; }],
    ['newer dirty editor after append', uncertainAppend, v => { v.state.editorDirty = true; }],
    ['different owner', uncertainDraft, v => { v.after.ownerId = 'OTHER_OWNER'; }],
    ['different generation', uncertainDraft, v => { v.after.generationId = 'OTHER_GENERATION'; }],
    ['different reset', uncertainDraft, v => { v.after.marker = '2026-10-10T00:00:00Z|00000000-0000-4000-8000-000000000001'; }],
    ['changed enrollment before action', uncertainDraft, v => { v.checkpoint.before.enrollment.enrollmentId = 'CHANGED_ENROLLMENT'; v.after.enrollment.enrollmentId = 'CHANGED_ENROLLMENT'; }],
    ['changed enrollment during action', uncertainDraft, v => { v.after.enrollment.enrollmentId = 'CHANGED_ENROLLMENT'; }],
    ['changed tombstones before action', uncertainDraft, v => { const tombstone = { deletionId: 'deleted-operation', tombstoneId: 'deleted-receipt', ownerId: v.initial.ownerId, generationId: v.initial.generationId, sessionId: 'deleted-other-session', expectedStateRevision: 0, deletedAt: v.initial.sessions[0].createdAt }; v.checkpoint.before.tombstones.push(tombstone); v.after.tombstones.push(tombstone); }],
    ['changed state revision', uncertainAppend, v => { v.after.sessions[0].stateRevision++; }],
    ['changed session', uncertainDraft, v => { v.after.sessions[0].sessionId = 'OTHER_SESSION'; }],
    ['changed immutable source', uncertainDraft, v => { v.after.sessions[0].source.label += ' CHANGED'; }],
    ['missing operation', uncertainAppend, v => { v.after.sessions[0].operations.pop(); }],
    ['invalid receipt id', uncertainAppend, v => { v.after.sessions[0].operations.at(-1)!.command.receiptId = ''; }],
    ['invalid operation id', uncertainAppend, v => { v.after.sessions[0].operations.at(-1)!.command.operationId = ''; }],
    ['wrong terminal result', uncertainAppend, v => { const terminal = v.after.sessions[0].operations.at(-1)!.terminal; assert.ok(terminal?.kind === 'applied'); terminal.resultId = 'OTHER_RESULT'; }],
    ['wrong captured/applied distinction', uncertainClose, v => { v.state.commandBoundary = 'captured'; }],
    ['wrong staged/pending distinction', pendingClose, v => { v.state.commandBoundary = 'staged'; }],
    ['malformed envelope', uncertainDraft, v => { v.after = {} as ConversationEnvelope; }],
  ];
  for (const [label, candidate, mutate] of cases) await t.test(label, () => { const value = clone(candidate); mutate(value); assert.equal(classify(value), 'refused'); });
  await t.test('truly pending append cannot be sent again', () => { assert.equal(classify(pending(append)), 'refused'); });
  await t.test('valid partial-session close remains outside complete-journey recovery', () => {
    const value = clone(close), old = clone(append.after.sessions[0]), command = clone(value.after.sessions[0].operations.at(-1)!.command);
    assert.ok(command.kind === 'close'); command.expectedHeadRevision = old.headRevision;
    command.boundary.turnRefs = old.turns.map(turn => ({ turnId: turn.turnId, turnRevision: turn.turnRevision }));
    value.checkpoint.before.sessions[0] = old; value.checkpoint.stepIndex = 0;
    value.after.sessions[0] = { ...old, stateRevision: old.stateRevision + 1, operations: [...old.operations, { command, terminal: null }] };
    Object.assign(value.state, { status: 'uncertain', pendingKind: 'close', commandBoundary: 'captured', closedBoundary: false, stepIndex: 1, submittedSteps: 1, turnCount: 1, editorPresent: true, editorOnActiveStep: true });
    assert.equal(validateEnvelope(value.after).status, 'valid'); assert.equal(classify(value), 'refused');
  });
});
