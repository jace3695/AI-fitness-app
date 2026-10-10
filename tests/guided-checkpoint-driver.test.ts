import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInThisContext } from 'node:vm';
import { expect as playwrightExpect, type Page } from '@playwright/test';
import ts from 'typescript';
import { GUIDED_CONVERSATION_PILOT } from '../data/guidedConversationPilot.ts';
import * as contracts from '../lib/conversation-session/contracts.ts';
import type { ConversationCommand, ConversationEnvelope } from '../lib/conversation-session/contracts.ts';
import { base, close, draft, emptySession, ok, resolution, TIME } from '../lib/conversation-session/fixtures.test-support.ts';
import { planApply, planCreateSession, planResolve, planSaveDraft, planStage, sessionSource } from '../lib/conversation-session/reducer.ts';
import * as diagnostics from './e2e/guided-conversation-diagnostics.ts';
import type { GuidedCheckpoint } from './e2e/guided-checkpoint-recovery.ts';

const READBACK = '저장 다시 확인', CANCEL = '보류 종료 취소', CLOSE = '대화 종료';
type Frame = { envelope: ConversationEnvelope; diagnostic: Record<string, unknown>; input?: string; raw?: string | null; hiddenButtons?: string[]; disabledButtons?: string[] };
type Transition = { button: string; frame: Frame };

/** A read-only DOM boundary with explicit click transitions. No browser, storage
 * writer, hook replacement, or production recovery implementation is involved. */
class FakeLocator {
  readonly kind: 'diagnostic' | 'status' | 'editor' | 'button';
  readonly name?: string;
  readonly host: ReturnType<typeof fakePage>;
  constructor(host: ReturnType<typeof fakePage>, kind: FakeLocator['kind'], name?: string) {
    this.host = host; this.kind = kind; this.name = name;
  }
  async evaluateAll<T>(read: (elements: { getAttribute(name: string): string | null }[]) => T): Promise<T> {
    assert.equal(this.kind, 'diagnostic');
    return read([{ getAttribute: name => {
      assert.equal(name, 'data-conversation-diagnostic'); return JSON.stringify(this.host.frame.diagnostic);
    } }]);
  }
  async inputValue() { assert.equal(this.kind, 'editor'); return this.host.frame.input ?? ''; }
  async click() {
    assert.equal(this.kind, 'button');
    this.host.clicks.push(this.name!);
    const next = this.host.transitions.shift();
    assert.ok(next, 'The driver attempted an additional action');
    assert.equal(this.name, next.button, 'The driver attempted an out-of-order action');
    this.host.frame = next.frame;
  }
}

function fakePage(frame: Frame, transitions: Transition[] = []) {
  const host = { frame, transitions: [...transitions], clicks: [] as string[], buttonChecks: [] as string[], reads: 0,
    locator(selector: string): FakeLocator {
      assert.ok(['[data-save-status]', '[data-conversation-diagnostic]'].includes(selector));
      return new FakeLocator(host, selector === '[data-save-status]' ? 'status' : 'diagnostic');
    },
    getByLabel(label: string, options: { exact: boolean }): FakeLocator {
      assert.equal(label, '일본어 문장'); assert.deepEqual(options, { exact: true }); return new FakeLocator(host, 'editor');
    },
    getByRole(role: string, options: { name: string; exact: boolean }): FakeLocator {
      assert.equal(role, 'button'); assert.equal(options.exact, true);
      assert.ok([READBACK, CANCEL, CLOSE].includes(options.name)); return new FakeLocator(host, 'button', options.name);
    },
    async readRaw() {
      host.reads++; return 'raw' in host.frame ? host.frame.raw! : contracts.canonicalJson(host.frame.envelope);
    },
  };
  return host;
}

/** Only Playwright's locator/timing boundary is substituted. Generic assertions
 * are real Playwright assertions; the driver, classifier, contract validation,
 * and DOM diagnostic sanitizer execute their actual source. Frames change only
 * on clicks, so a poll takes one sample instead of waiting for an impossible
 * asynchronous change. This suite does not establish browser/polling behavior. */
const expectBoundary = Object.assign((actual: unknown) => {
  if (!(actual instanceof FakeLocator)) return playwrightExpect(actual);
  return {
    async toHaveAttribute(name: string, value: unknown) {
      assert.equal(actual.kind, 'status'); assert.equal(name, 'data-save-status');
      playwrightExpect(actual.host.frame.diagnostic.status).toBe(value);
    },
    async toHaveValue(value: unknown) { playwrightExpect(await actual.inputValue()).toBe(value); },
    async toBeVisible() {
      assert.equal(actual.kind, 'button'); playwrightExpect(actual.name).toBe(actual.host.transitions[0]?.button);
      playwrightExpect(actual.host.frame.hiddenButtons ?? []).not.toContain(actual.name);
      actual.host.buttonChecks.push(`visible:${actual.name}`);
    },
    async toBeEnabled() {
      assert.equal(actual.kind, 'button'); playwrightExpect(actual.name).toBe(actual.host.transitions[0]?.button);
      playwrightExpect(actual.host.frame.disabledButtons ?? []).not.toContain(actual.name);
      actual.host.buttonChecks.push(`enabled:${actual.name}`);
    },
  };
}, {
  poll(read: () => unknown | Promise<unknown>) {
    return {
      not: { async toBe(value: unknown) { playwrightExpect(await read()).not.toBe(value); } },
      async toMatchObject(value: Record<string, unknown>) { playwrightExpect(await read()).toMatchObject(value); },
    };
  },
});
const driverSource = ts.transpileModule(readFileSync(new URL('./e2e/guided-checkpoint-recovery.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const driverDependencies = new Map<string, unknown>([
  ['@playwright/test', { expect: expectBoundary }],
  ['../../lib/conversation-session/contracts.ts', contracts],
  ['./guided-conversation-diagnostics.ts', diagnostics],
]);
const driverExports: Record<string, unknown> = {};
runInThisContext(`(function(exports, require) { ${driverSource}\n})`)(driverExports, (name: string) => {
  assert.ok(driverDependencies.has(name), `Unexpected driver dependency: ${name}`); return driverDependencies.get(name);
});
const { confirmGuidedCheckpoint, classifyGuidedCheckpoint } = driverExports as typeof import('./e2e/guided-checkpoint-recovery.ts');

function start() {
  const script = GUIDED_CONVERSATION_PILOT[1], envelope = base();
  const source = contracts.freezeGuidedSource(script.scriptId, script.scriptRevision); assert.ok(source);
  return ok(planCreateSession(envelope, envelope, { ...emptySession(), source }));
}
function save(envelope: ConversationEnvelope) {
  const session = envelope.sessions[0], progress = contracts.getConversationProgress(session)!;
  const value = { ...draft(`driver-draft-${progress.submittedStepCount}`, '合成の入力'), source: contracts.sourceRef(session.source, progress.activeStepId!) };
  return ok(planSaveDraft(envelope, sessionSource(envelope, session.sessionId)!, value));
}
function append(envelope: ConversationEnvelope): ConversationCommand {
  const session = envelope.sessions[0], operationId = `driver-append-${session.turns.length}`;
  const turn = contracts.buildGuidedTurn(session, session.drafts[0], { turnId: `turn-${operationId}`, sequence: session.turns.length + 1, predecessorTurnId: session.turns.at(-1)?.turnId ?? null, recordedAt: TIME });
  assert.ok(turn);
  return { kind: 'append', operationId, receiptId: `receipt-${operationId}`, ownerId: envelope.ownerId, generationId: envelope.generationId, sessionId: session.sessionId, expectedHeadRevision: session.headRevision, turn };
}
function closing(envelope: ConversationEnvelope, id = 'driver-close-original') {
  const command = close(envelope, id); assert.ok(command.kind === 'close');
  command.boundary.summaryPolicyVersion = contracts.GUIDED_SUMMARY_POLICY_VERSION; return command;
}
function stage(envelope: ConversationEnvelope, command: ConversationCommand) {
  return ok(planStage(envelope, sessionSource(envelope, command.sessionId)!, command));
}
function apply(envelope: ConversationEnvelope, command: ConversationCommand) { return ok(planApply(envelope, command)); }
function scenario(kind: GuidedCheckpoint['kind']) {
  const initial = start(); let before = initial;
  if (kind === 'close') for (let step = 0; step < GUIDED_CONVERSATION_PILOT[1].steps.length; step++) {
    before = save(before); const command = append(before); before = apply(stage(before, command), command);
  }
  if (kind === 'append') before = save(before);
  const stepIndex = kind === 'close' ? GUIDED_CONVERSATION_PILOT[1].steps.length - 1 : 0;
  if (kind === 'draft') {
    const after = save(before), value = after.sessions[0].drafts[0];
    return { initial, before, after, pending: undefined, command: undefined,
      checkpoint: { kind, before, stepIndex, input: value.input, origin: value.origin } satisfies GuidedCheckpoint };
  }
  const command = kind === 'append' ? append(before) : closing(before), pending = stage(before, command);
  return { initial, before, pending, command, after: apply(pending, command), checkpoint: { kind, before, stepIndex } satisfies GuidedCheckpoint };
}
function frame(envelope: ConversationEnvelope, kind: GuidedCheckpoint['kind'], status: 'saved' | 'uncertain' | 'pending' = 'saved'): Frame {
  assert.equal(contracts.validateEnvelope(envelope).status, 'valid', 'Every normal fixture must pass the actual envelope contract');
  const session = envelope.sessions[0], progress = contracts.getConversationProgress(session)!;
  const hasEditor = progress.activeStepIndex !== null;
  return { envelope, input: session.drafts[0]?.input, diagnostic: {
    status, available: true, contextCurrent: true, busy: false, errorCode: 'none',
    pendingKind: status === 'saved' ? 'none' : kind, commandKind: kind === 'draft' ? 'none' : kind,
    commandBoundary: kind === 'draft' ? 'none' : status === 'saved' ? 'applied' : kind === 'close' && !session.closed ? 'captured' : 'staged',
    editorPresent: hasEditor, editorOnActiveStep: hasEditor, editorDirty: kind === 'draft' && status === 'uncertain',
    stepIndex: progress.activeStepIndex, totalSteps: progress.totalStepCount, submittedSteps: progress.submittedStepCount,
    turnCount: session.turns.length, draftCount: session.drafts.length, closedBoundary: Boolean(session.closed),
    exposure: session.drafts[0]?.exposure ?? { example: 'unknown', reading: 'unknown', meaning: 'unknown', hint: 'unknown' },
  } };
}
function run(host: ReturnType<typeof fakePage>, value: ReturnType<typeof scenario>) {
  return confirmGuidedCheckpoint(host as unknown as Page, host.readRaw, value.initial, value.checkpoint, 'elementary');
}
function cancelled(value: ReturnType<typeof scenario>) {
  assert.ok(value.pending && value.command);
  return ok(planResolve(value.pending, sessionSource(value.pending, value.command.sessionId)!, value.command, resolution(value.pending, value.command, 'driver-cancellation')));
}

for (const kind of ['draft', 'append', 'close'] as const) {
  test(`actual checkpoint driver: ready ${kind} returns without clicking any action`, async () => {
    const value = scenario(kind), host = fakePage(frame(value.after, kind));
    await run(host, value); assert.deepEqual(host.clicks, []); assert.ok(host.reads >= 2);
  });
  test(`actual checkpoint driver: exact applied ${kind} uncertainty clicks visible readback once`, async () => {
    const value = scenario(kind), before = contracts.canonicalJson(value.after);
    const host = fakePage(frame(value.after, kind, 'uncertain'), [{ button: READBACK, frame: frame(value.after, kind) }]);
    await run(host, value);
    assert.deepEqual(host.clicks, [READBACK]); assert.equal(await host.readRaw(), before); assert.equal(host.transitions.length, 0);
    assert.deepEqual(host.buttonChecks, [`visible:${READBACK}`, `enabled:${READBACK}`]);
  });
}

test('actual checkpoint driver: pending close reads back, cancels, and separately closes once each', async () => {
  const value = scenario('close'); assert.ok(value.pending && value.command);
  const abandoned = cancelled(value), replacement = closing(abandoned, 'driver-close-replacement');
  const completed = apply(stage(abandoned, replacement), replacement);
  const host = fakePage(frame(value.pending, 'close', 'uncertain'), [
    { button: READBACK, frame: frame(value.pending, 'close', 'pending') },
    { button: CANCEL, frame: frame(abandoned, 'close') },
    { button: CLOSE, frame: frame(completed, 'close') },
  ]);
  await run(host, value);
  assert.deepEqual(host.clicks, [READBACK, CANCEL, CLOSE]); assert.equal(host.transitions.length, 0);
  assert.deepEqual(host.buttonChecks, [`visible:${READBACK}`, `enabled:${READBACK}`, `visible:${CANCEL}`, `enabled:${CANCEL}`, `enabled:${CLOSE}`]);
  assert.notEqual(replacement.operationId, value.command.operationId); assert.notEqual(replacement.receiptId, value.command.receiptId);
  assert.ok(value.command.kind === 'close'); assert.notEqual(replacement.boundary.boundaryId, value.command.boundary.boundaryId);
  assert.equal(completed.sessions[0].operations.filter(operation => operation.command.kind === 'close' && operation.terminal?.kind === 'applied').length, 1);
});

for (const interruption of ['readback', 'cancellation', 'replacement'] as const) test(`actual checkpoint driver: ${interruption} uncertainty rejects without another action`, async () => {
  const value = scenario('close'); assert.ok(value.pending);
  const abandoned = cancelled(value), replacement = closing(abandoned, 'driver-close-replacement');
  const completed = apply(stage(abandoned, replacement), replacement);
  const transitions: Transition[] = [{ button: READBACK, frame: frame(value.pending, 'close', interruption === 'readback' ? 'uncertain' : 'pending') }];
  if (interruption !== 'readback') transitions.push({ button: CANCEL, frame: frame(abandoned, 'close', interruption === 'cancellation' ? 'uncertain' : 'saved') });
  if (interruption === 'replacement') transitions.push({ button: CLOSE, frame: frame(completed, 'close', 'uncertain') });
  const host = fakePage(frame(value.pending, 'close', 'uncertain'), transitions);
  await assert.rejects(run(host, value));
  assert.deepEqual(host.clicks, transitions.map(transition => transition.button)); assert.equal(host.transitions.length, 0);
});

test('actual checkpoint driver: a staged append is refused without readback or replay', async () => {
  const value = scenario('append'); assert.ok(value.pending);
  const host = fakePage(frame(value.pending, 'append', 'uncertain'));
  assert.equal(classifyGuidedCheckpoint(await diagnostics.readGuidedDiagnostic(host as unknown as Page), value.pending, value.initial, value.checkpoint), 'refused');
  await assert.rejects(run(host, value)); assert.deepEqual(host.clicks, []);
});

for (const failure of ['dirty-editor', 'stale-context', 'wrong-pending-kind', 'missing-storage', 'changed-envelope', 'invalid-envelope'] as const) test(`actual checkpoint driver: ${failure} recovery is unproved and clicks nothing`, async () => {
  const value = scenario('close'), observed = frame(value.after, 'close', 'uncertain');
  if (failure === 'dirty-editor') observed.diagnostic.editorDirty = true;
  if (failure === 'stale-context') observed.diagnostic.contextCurrent = false;
  if (failure === 'wrong-pending-kind') observed.diagnostic.pendingKind = 'append';
  if (failure === 'missing-storage') observed.raw = null;
  if (failure === 'changed-envelope') {
    observed.envelope = structuredClone(observed.envelope); observed.envelope.enrollment.enrollmentId = 'different-enrollment';
    assert.equal(contracts.validateEnvelope(observed.envelope).status, 'valid');
  }
  if (failure === 'invalid-envelope') {
    observed.envelope = structuredClone(observed.envelope);
    // Unknown keys are rejected even when the otherwise plausible session passes progress checks.
    Object.assign(observed.envelope, { unexpected: true }); assert.equal(contracts.validateEnvelope(observed.envelope).status, 'blocked');
  }
  const host = fakePage(observed); await assert.rejects(run(host, value)); assert.deepEqual(host.clicks, []);
});

test('actual checkpoint driver: saved cancellation with unrelated metadata cannot authorize a new close', async () => {
  const value = scenario('close'); assert.ok(value.pending);
  const abandoned = structuredClone(cancelled(value)); abandoned.enrollment.enrollmentId = 'unrelated-enrollment';
  assert.equal(contracts.validateEnvelope(abandoned).status, 'valid');
  const host = fakePage(frame(value.pending, 'close', 'uncertain'), [
    { button: READBACK, frame: frame(value.pending, 'close', 'pending') },
    { button: CANCEL, frame: frame(abandoned, 'close') },
  ]);
  await assert.rejects(run(host, value)); assert.deepEqual(host.clicks, [READBACK, CANCEL]);
});

for (const boundary of ['applied-readback', 'pending-readback', 'cancellation'] as const) test(`actual checkpoint driver: stale context after ${boundary} rejects without continuing`, async () => {
  const value = scenario('close'); assert.ok(value.pending);
  const applied = boundary === 'applied-readback';
  const changed = frame(boundary === 'cancellation' ? cancelled(value) : applied ? value.after : value.pending, 'close', boundary === 'pending-readback' ? 'pending' : 'saved');
  changed.diagnostic.contextCurrent = false;
  const transitions: Transition[] = boundary === 'cancellation'
    ? [{ button: READBACK, frame: frame(value.pending, 'close', 'pending') }, { button: CANCEL, frame: changed }]
    : [{ button: READBACK, frame: changed }];
  const host = fakePage(frame(applied ? value.after : value.pending, 'close', 'uncertain'), transitions);
  await assert.rejects(run(host, value)); assert.deepEqual(host.clicks, transitions.map(transition => transition.button));
});

test('actual checkpoint driver: draft readback cannot accept newer editor text with the same stored bytes', async () => {
  const value = scenario('draft'), changed = frame(value.after, 'draft'); changed.input = 'newer synthetic input';
  const host = fakePage(frame(value.after, 'draft', 'uncertain'), [{ button: READBACK, frame: changed }]);
  await assert.rejects(run(host, value)); assert.deepEqual(host.clicks, [READBACK]);
  assert.equal(await host.readRaw(), contracts.canonicalJson(value.after));
});

for (const obstruction of ['hiddenButtons', 'disabledButtons'] as const) test(`actual checkpoint driver: ${obstruction} readback cannot be clicked`, async () => {
  const value = scenario('close'), observed = frame(value.after, 'close', 'uncertain'); observed[obstruction] = [READBACK];
  const host = fakePage(observed, [{ button: READBACK, frame: frame(value.after, 'close') }]);
  await assert.rejects(run(host, value)); assert.deepEqual(host.clicks, []);
});
