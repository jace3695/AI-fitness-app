import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { conversationSessionFixture } from './helpers/conversationSessionFixture.ts';
import { tick } from './helpers/storage-ui-fixture.ts';
import { findGuidedConversationCatalogScript } from '../data/guidedConversationCatalog.ts';
import { GUIDED_CONVERSATION_PILOT } from '../data/guidedConversationPilot.ts';
import { isAppliedGuidedRecoveryCandidate } from './e2e/guided-terminal-recovery.ts';
import { sanitizeGuidedDiagnostic } from './e2e/guided-conversation-diagnostics.ts';

type Hook = ReturnType<typeof import('../components/language/useConversationSession.ts')['useConversationSession']>;
async function started(t: TestContext, script: { scriptId: string; scriptRevision: string } = GUIDED_CONVERSATION_PILOT[1]) {
  const f = await conversationSessionFixture(); t.after(f.dispose);
  const h = f.mountHook<Hook>(() => (f.tab.loadModule('components/language/useConversationSession.ts') as typeof import('../components/language/useConversationSession.ts')).useConversationSession());
  const selection = Object.assign(Object.create(null), { kind: 'guided', scriptId: script.scriptId, scriptRevision: script.scriptRevision });
  assert.equal(await h.current.start(selection), true); await h.view.settle();
  const session = () => f.snapshot().envelope!.sessions[0];
  return { f, h, session };
}

// The shipped hook, facade, reducer and local protocol execute against a synthetic
// host. These adversarial orderings prove guards, not the historical WebKit cause.
test('guided delayed exposure during a draft acknowledgement remains dirty until another explicit save', async t => {
  const { f, h, session } = await started(t);
  const release = f.browser.holdLock();
  h.current.typeInput('SYNTHETIC_DELAYED_EXPOSURE'); await tick();
  assert.equal(h.current.status, 'saving');
  h.current.observeExposure({ example: 'shown', meaning: 'shown' }, h.current.activeStepRef!);
  release(); await h.view.settle();
  assert.equal(h.current.status, 'unsaved');
  assert.equal(h.current.diagnostics.editorDirty, true);
  assert.equal(h.current.diagnostics.exposure.example, 'shown');
  assert.equal(h.current.diagnostics.pendingKind, 'none');
  assert.equal(session().drafts.length, 1);
  const original = session().drafts[0];
  assert.equal(original.exposure.example, 'not-shown');
  assert.equal(original.exposure.meaning, 'not-shown');
  assert.equal(session().turns.length, 0);
  assert.equal(await h.current.save(), true); await h.view.settle();
  assert.equal(h.current.status, 'saved');
  assert.equal(session().drafts[0].draftId, original.draftId);
  assert.equal(session().drafts[0].revision, original.revision + 1);
  assert.equal(session().drafts[0].exposure.example, 'shown');
  assert.equal(session().drafts[0].exposure.meaning, 'shown');
  assert.equal(await h.current.send(), true); await h.view.settle();
  assert.equal(session().turns.length, 1); assert.equal(h.current.input, '');
});

test('catalogue observed assistance before typing makes the first saved draft exact without a retry', async t => {
  const script = findGuidedConversationCatalogScript('guided-company-mechanical-design-intermediate', 'sha256:e7122f518361da4322d717ce5f3873c1cd67a51a44a1b824a136a54b0ca47afa');
  assert.ok(script);
  const { f, h, session } = await started(t, script);
  let draftWrites = 0;
  const run = f.facade.runConversationEdit;
  Object.assign(f.facade, { runConversationEdit(intent: Parameters<typeof run>[0]) {
    if (intent.kind === 'draft') draftWrites++;
    return run(intent);
  } });
  h.current.observeExposure({ example: 'shown', meaning: 'shown', hint: 'shown' }, h.current.activeStepRef!);
  await h.view.settle();
  assert.equal(h.current.diagnostics.exposure.example, 'shown'); assert.equal(h.current.diagnostics.exposure.meaning, 'shown');
  assert.equal(h.current.diagnostics.exposure.hint, 'shown'); assert.equal(h.current.diagnostics.editorOnActiveStep, true);
  h.current.insertExample(); await h.view.settle();
  assert.equal(await h.current.save(), true); await h.view.settle();
  assert.equal(h.current.status, 'saved'); assert.equal(draftWrites, 1);
  assert.equal(session().drafts[0].input, script.steps[0].learnerExample.japanese);
  assert.equal(session().drafts[0].exposure.example, 'shown'); assert.equal(session().drafts[0].exposure.meaning, 'shown');
  assert.equal(session().drafts[0].exposure.hint, 'shown'); assert.equal(session().drafts[0].origin.kind, 'inserted-example');
  assert.equal(session().turns.length, 0); assert.equal(session().operations.length, 0);
});

test('guided new exposure during an explicit save cannot silently acknowledge the newer editor', async t => {
  const { f, h, session } = await started(t);
  h.current.typeInput('SYNTHETIC_EXPLICIT_SAVE'); await h.view.settle();
  h.current.observeExposure({ example: 'shown' }, h.current.activeStepRef!);
  const release = f.browser.holdLock(), saving = h.current.save(); await tick();
  h.current.observeExposure({ hint: 'shown' }, h.current.activeStepRef!);
  release(); assert.equal(await saving, true); await h.view.settle();
  assert.equal(h.current.status, 'unsaved');
  assert.equal(session().drafts[0].exposure.example, 'shown');
  assert.equal(session().drafts[0].exposure.hint, 'not-shown');
  assert.equal(session().turns.length, 0); assert.equal(session().operations.length, 0);
  assert.equal(await h.current.save(), true); await h.view.settle();
  assert.equal(h.current.status, 'saved'); assert.equal(session().drafts[0].exposure.hint, 'shown');
});

test('guided close from a stale rendered editor is rejected without a command or lost input', async t => {
  const { h, session } = await started(t);
  h.current.typeInput('SYNTHETIC_CLOSE_BOUNDARY'); await h.view.settle();
  const closeFromPreviousRender = h.current.end;
  h.current.observeExposure({ hint: 'shown' }, h.current.activeStepRef!);
  const before = JSON.stringify(session());
  assert.equal(await closeFromPreviousRender(), false); await h.view.settle();
  assert.equal(JSON.stringify(session()), before); assert.equal(session().closed, null);
  assert.equal(session().operations.length, 0); assert.equal(h.current.input, 'SYNTHETIC_CLOSE_BOUNDARY');
  assert.equal(h.current.status, 'unsaved'); assert.match(h.current.error!, /원본이나 입력이 바뀌었어요/);
  assert.equal(h.current.diagnostics.commandKind, 'close');
  assert.equal(h.current.diagnostics.commandBoundary, 'editor-changed');
  assert.equal(h.current.diagnostics.errorCode, 'changed-before-action');
  assert.equal(h.current.diagnostics.closedBoundary, false);
  // A fresh deliberate action may save the observed facts and close once.
  assert.equal(await h.current.end(), true); await h.view.settle();
  assert.ok(session().closed); assert.equal(session().operations.filter(operation => operation.command.kind === 'close').length, 1);
  assert.equal(session().drafts[0].exposure.hint, 'shown');
});


test('guided diagnostic logging allowlists categories and never serializes raw text, identities or errors', () => {
  const privateValue = 'PRIVATE_DIAGNOSTIC_MUST_NOT_ESCAPE';
  const value = sanitizeGuidedDiagnostic({
    status: privateValue, errorCode: privateValue, commandKind: privateValue, commandBoundary: privateValue,
    available: privateValue, busy: {}, contextCurrent: privateValue, editorPresent: privateValue, editorDirty: privateValue,
    editorOnActiveStep: privateValue, stepIndex: privateValue, submittedSteps: -1, totalSteps: 1e12, turnCount: [], draftCount: privateValue,
    pendingKind: privateValue, exposure: { example: privateValue, reading: {}, meaning: ['shown'], hint: { toString: () => 'shown', input: privateValue } },
    closedBoundary: privateValue, input: privateValue, sessionId: privateValue, draftId: privateValue, rawError: privateValue,
  });
  assert.equal(JSON.stringify(value).includes(privateValue), false);
  assert.equal(value.status, 'unknown'); assert.equal(value.turnCount, null);
  assert.deepEqual(value.exposure, { example: 'unknown', reading: 'unknown', meaning: 'unknown', hint: 'unknown' });
});

test('guided unavailable diagnostics clear session counts and editor exposure alongside the private UI', async t => {
  const { f, h } = await started(t);
  h.current.typeInput('PRIVATE_RETIRED_DIAGNOSTIC_INPUT'); await h.view.settle();
  h.current.observeExposure({ hint: 'shown' }, h.current.activeStepRef!);
  assert.equal(h.current.diagnostics.draftCount, 1); assert.equal(h.current.diagnostics.exposure.hint, 'shown');
  await f.switchOwner(null); await h.view.settle();
  const diagnostic = h.current.diagnostics;
  assert.equal(diagnostic.available, false); assert.equal(diagnostic.contextCurrent, false);
  assert.equal(diagnostic.editorPresent, false); assert.equal(diagnostic.editorDirty, false);
  assert.equal(diagnostic.draftCount, 0); assert.equal(diagnostic.turnCount, 0);
  assert.equal(diagnostic.exposure.hint, 'not-shown'); assert.equal(diagnostic.commandBoundary, 'none');
  assert.equal(JSON.stringify(diagnostic).includes('PRIVATE_RETIRED_DIAGNOSTIC_INPUT'), false);
});


for (const boundary of ['refreshed-context', 'unacknowledged-result'] as const) test(`guided final append ${boundary} stays fenced until exact read-only recovery`, async t => {
  const script = findGuidedConversationCatalogScript('guided-company-mechanical-design-intermediate', 'sha256:e7122f518361da4322d717ce5f3873c1cd67a51a44a1b824a136a54b0ca47afa');
  assert.ok(script);
  const { f, h, session } = await started(t, script);
  for (const step of script.steps.slice(0, -1)) {
    h.current.typeInput(step.learnerExample.japanese); await h.view.settle();
    assert.equal(await h.current.send(), true); await h.view.settle();
  }
  const finalText = script.steps.at(-1)!.learnerExample.japanese;
  h.current.typeInput(finalText); await h.view.settle();
  const apply = f.facade.applyConversationIntent, stage = f.facade.stageConversationIntent, capture = f.facade.captureConversationAppend;
  let applies = 0, stages = 0, captures = 0;
  const restoreFacades = () => Object.assign(f.facade, { applyConversationIntent: apply, stageConversationIntent: stage, captureConversationAppend: capture });
  t.after(restoreFacades);
  Object.assign(f.facade, {
    captureConversationAppend(...args: Parameters<typeof capture>) { captures++; return capture(...args); },
    stageConversationIntent(intent: Parameters<typeof stage>[0]) { stages++; return stage(intent); },
    async applyConversationIntent(intent: Parameters<typeof apply>[0]) {
      applies++;
      const restore = boundary === 'unacknowledged-result' ? f.failNextNotification() : () => {};
      let result: Awaited<ReturnType<typeof apply>>;
      try { result = await apply(intent); } finally { restore(); }
      if (boundary === 'refreshed-context') {
        assert.equal(result.acknowledged, true);
        const originalContext = result.source!.context;
        await f.refresh(); await h.view.settle();
        assert.equal(f.language.isLanguageRecordContextCurrent(originalContext), false);
      } else { assert.equal(result.acknowledged, false); assert.equal(result.source, null); }
      return result;
    },
  });
  assert.equal(await h.current.send(), false); await h.view.settle();
  assert.equal(captures, 1); assert.equal(stages, 1); assert.equal(applies, 1); assert.equal(session().turns.length, script.steps.length);
  assert.equal(session().drafts.length, 0); assert.equal(session().turns.at(-1)!.draft.input, finalText);
  assert.equal(h.current.status, 'uncertain'); assert.equal(h.current.diagnostics.commandBoundary, 'staged');
  assert.equal(h.current.diagnostics.pendingKind, 'append'); assert.equal(h.current.diagnostics.contextCurrent, true);
  assert.equal(h.current.canClose, false); assert.equal(h.current.diagnostics.editorDirty, false);
  const envelope = f.snapshot().envelope!;
  const expected = { ownerId: envelope.ownerId, generationId: envelope.generationId, marker: envelope.marker,
    sessionId: session().sessionId, source: session().source, totalSteps: script.steps.length };
  const diagnostic = { surface: 'present', ...h.current.diagnostics };
  assert.equal(isAppliedGuidedRecoveryCandidate(diagnostic, envelope, expected), true);
  // The fixture must not offer even a readback shortcut for a different
  // operation, owner/reset scope, unresolved result or newer dirty editor.
  const negativeCases: [string, Parameters<typeof isAppliedGuidedRecoveryCandidate>[0], Parameters<typeof isAppliedGuidedRecoveryCandidate>[1]][] = [
    ['unavailable private context', { ...diagnostic, available: false }, envelope],
    ['retired context', { ...diagnostic, contextCurrent: false }, envelope],
    ['truly pending', { ...diagnostic, status: 'pending' }, envelope],
    ['unresolved result', diagnostic, { ...envelope, sessions: [{ ...session(), operations: session().operations.slice(0, -1) }] }],
    ['absent session', diagnostic, { ...envelope, sessions: [] }],
    ['different owner', diagnostic, { ...envelope, ownerId: 'other-owner' }],
    ['different generation', diagnostic, { ...envelope, generationId: 'different-generation' }],
    ['reset marker', diagnostic, { ...envelope, marker: '2026-10-11T00:00:00.000Z|11111111-1111-4111-8111-111111111111' }],
    ['stale handler boundary', { ...diagnostic, commandBoundary: 'head-changed' }, envelope],
    ['newer dirty input', { ...diagnostic, editorDirty: true }, envelope],
    ['pending terminal', diagnostic, { ...envelope, sessions: [{ ...session(), operations: session().operations.map((operation, index) => index === script.steps.length - 1 ? { ...operation, terminal: null } : operation) }] }],
    ['mismatched applied receipt', diagnostic, { ...envelope, sessions: [{ ...session(), operations: session().operations.map((operation, index) => index === script.steps.length - 1 ? { ...operation, terminal: { kind: 'applied' as const, resultId: 'different-turn' } } : operation) }] }],
    ['mismatched command turn', diagnostic, { ...envelope, sessions: [{ ...session(), turns: session().turns.map((turn, index) => index === script.steps.length - 1 ? { ...turn, draft: { ...turn.draft, input: 'different-input' } } : turn) }] }],
  ];
  for (const [label, state, source] of negativeCases) assert.equal(isAppliedGuidedRecoveryCandidate(state, source, expected), false, label);
  const frozen = JSON.stringify(session()), writes = f.browser.writes.length;
  assert.equal(await h.current.recover(), true); await h.view.settle();
  assert.equal(f.browser.writes.length, writes, 'Recover only reads the exact original terminal operation');
  assert.equal(JSON.stringify(session()), frozen);
  assert.equal(captures, 1); assert.equal(stages, 1); assert.equal(applies, 1);
  assert.equal(h.current.status, 'saved'); assert.equal(h.current.canClose, true); assert.equal(h.current.input, '');
  restoreFacades();
  assert.equal(await h.current.end(), true); await h.view.settle();
  assert.ok(session().closed); assert.equal(session().operations.filter(op => op.command.kind === 'append').length, script.steps.length);
  assert.equal(session().operations.filter(op => op.command.kind === 'close').length, 1);
});
