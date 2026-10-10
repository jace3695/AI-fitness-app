import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GUIDED_CONVERSATION_PILOT } from '../../data/guidedConversationPilot.ts';
import { buildFrozenTurn, buildGuidedTurn, canonicalJson, capacityUsage, CONVERSATION_LIMITS, encodeEnvelope, exact, freezeGuidedSource, getConversationProgress, getConversationStep, GUIDED_SUMMARY_POLICY_VERSION, isGuidedSource, legacyEnvelopeSchema, parseEnvelope, sessionSchema, sourceRef, supportedSource, validateEnvelope, type ConversationCommand, type ConversationDraft, type ConversationEnvelope, type ConversationSession } from './contracts.ts';
import { planApply, planCreateSession, planResolve, planSaveDraft, planStage, sessionSource } from './reducer.ts';
import { base, close, draft, emptySession, getSession, ok, resolution, SOURCE, TIME } from './fixtures.test-support.ts';

function guided(level = 'elementary', sessionId = 'session-a'): ConversationSession {
  const script = GUIDED_CONVERSATION_PILOT.find(item => item.levelId === level)!;
  return { ...emptySession(sessionId), source: freezeGuidedSource(script.scriptId, script.scriptRevision)! };
}
function start(level = 'elementary') { const e = base(); return ok(planCreateSession(e, e, guided(level))); }
function current(e: ConversationEnvelope) { return getConversationProgress(getSession(e))!; }
function input(e: ConversationEnvelope, id = `draft-${getSession(e).turns.length}`, text = 'unassessed arbitrary input', stepId = current(e).activeStepId!): ConversationDraft {
  return { ...draft(id, text), source: sourceRef(getSession(e).source, stepId) };
}
function save(e: ConversationEnvelope, d = input(e)) { return ok(planSaveDraft(e, sessionSource(e, 'session-a')!, d)); }
function command(e: ConversationEnvelope, operationId = `append-${getSession(e).operations.length}`, d = getSession(e).drafts.at(-1)!): ConversationCommand {
  const s = getSession(e), turn = buildGuidedTurn(s, d, { turnId: `turn-${operationId}`, sequence: s.turns.length + 1, predecessorTurnId: s.turns.at(-1)?.turnId ?? null, recordedAt: TIME });
  assert.ok(turn);
  return { kind: 'append', operationId, receiptId: `receipt-${operationId}`, ownerId: e.ownerId, generationId: e.generationId, sessionId: s.sessionId, expectedHeadRevision: s.headRevision, turn };
}
function stage(e: ConversationEnvelope, c: ConversationCommand) { return ok(planStage(e, sessionSource(e, c.sessionId)!, c)); }
function apply(e: ConversationEnvelope, c: ConversationCommand) { return ok(planApply(e, c)); }
function commit(e: ConversationEnvelope, c: ConversationCommand) { return apply(stage(e, c), c); }
function closing(e: ConversationEnvelope, id = `close-${getSession(e).operations.length}`): ConversationCommand {
  const c = close(e, id); assert.equal(c.kind, 'close'); if (c.kind !== 'close') throw new Error('close fixture');
  c.boundary.summaryPolicyVersion = GUIDED_SUMMARY_POLICY_VERSION; return c;
}
function cancel(e: ConversationEnvelope, c: ConversationCommand, id = `resolution-${getSession(e).operations.length}`) { return ok(planResolve(e, sessionSource(e, c.sessionId)!, c, resolution(e, c, id))); }
/** Tombstones have additive canonical length; avoid repeated quadratic sizing. */
function full(e: ConversationEnvelope, target = CONVERSATION_LIMITS.envelopeCodeUnits): ConversationEnvelope {
  const v = structuredClone(e); let remaining = target - capacityUsage(v).admittedCodeUnits, i = v.tombstones.length;
  assert.ok(remaining >= 0);
  while (remaining > 400) {
    const tombstone = { deletionId: `fill-delete-${i}`, tombstoneId: `fill-result-${i}`, sessionId: `fill-session-${i}`, ownerId: e.ownerId, generationId: e.generationId, expectedStateRevision: 0, deletedAt: TIME };
    const size = canonicalJson(tombstone).length + (v.tombstones.length ? 1 : 0);
    v.tombstones.push(tombstone); remaining -= size; i++;
  }
  if (!v.tombstones.length) throw new Error('test needs tombstone padding');
  for (const field of ['deletionId', 'tombstoneId', 'sessionId'] as const) {
    const last = v.tombstones.at(-1)!, size = Math.min(160 - last[field].length, remaining); last[field] += 'x'.repeat(size); remaining -= size;
  }
  assert.equal(remaining, 0); assert.equal(capacityUsage(v).admittedCodeUnits, target); assert.equal(validateEnvelope(v).status, 'valid'); return v;
}

for (const script of GUIDED_CONVERSATION_PILOT) {
  test(`${script.levelId}: exact pinned source, explicit step reference and unreviewed metadata`, () => {
    const s = guided(script.levelId).source; assert.ok(isGuidedSource(s));
    assert.deepEqual(s.content, script); assert.equal(s.levelLabelKo, script.levelLabelKo); assert.equal(Object.isFrozen(s.content.steps), true);
    assert.equal('stepId' in s, false); assert.throws(() => sourceRef(s)); assert.throws(() => sourceRef(s, 'absent'));
    for (const step of script.steps) { assert.deepEqual(getConversationStep(s, step.id), step); assert.equal(sourceRef(s, step.id).stepId, step.id); }
    assert.equal(getConversationStep(s, 'absent'), undefined); assert.equal(freezeGuidedSource(script.scriptId, 'unknown'), undefined);
    assert.equal(buildFrozenTurn(s, input(start(script.levelId)), { turnId: 't', sequence: 1, predecessorTurnId: null, recordedAt: TIME }), undefined);
  });
  test(`${script.levelId}: every prefix advances only on apply and historical replay survives lane consumption and close`, () => {
    let e = start(script.levelId); const commands: ConversationCommand[] = [];
    for (let i = 0; i < script.steps.length; i++) {
      assert.equal(current(e).activeStepId, script.steps[i].id); assert.equal(current(e).submittedStepCount, i);
      const d = input(e, `d-${i}`, i % 2 ? script.steps[i].learnerExample.reading : 'nonsense 한글'); e = save(e, d);
      const c = command(e); commands.push(c); const token = sessionSource(e, 'session-a')!; e = stage(e, c);
      assert.equal(current(e).submittedStepCount, i); assert.equal(buildGuidedTurn(getSession(e), d, c.kind === 'append' ? c.turn : {} as never), undefined);
      e = apply(e, c); assert.equal(current(e).submittedStepCount, i + 1); assert.equal(getSession(e).drafts.length, 0);
      assert.equal(validateEnvelope(e).status, 'valid'); assert.equal(planStage(e, token, c).status, 'replay'); assert.equal(planApply(e, c).status, 'replay');
      const t = getSession(e).turns.at(-1)!; assert.ok('kind' in t.emission); assert.equal(t.emission.stepId, script.steps[i].id);
      assert.equal(t.emission.reply, script.steps[i].fixedReply.japanese); assert.equal(t.emission.replyMeaningKo, script.steps[i].fixedReply.meaningKo);
      assert.deepEqual(t.emission.exampleFallback, i % 2 ? null : script.steps[i].learnerExample);
      assert.equal(t.emission.progression.toStepId, script.steps[i + 1]?.id ?? null); assert.equal(t.sampleMatch.assessment, 'unavailable');
    }
    assert.equal(current(e).activeStepId, null); assert.equal(current(e).coverage, 'all-steps-submitted'); assert.equal(getSession(e).closed, null);
    const retained = { ...input(e, 'after-final', 'retained', script.steps.at(-1)!.id) }; e = save(e, retained);
    assert.equal(buildGuidedTurn(getSession(e), retained, { turnId: 'extra', sequence: script.steps.length + 1, predecessorTurnId: getSession(e).turns.at(-1)!.turnId, recordedAt: TIME }), undefined);
    e = commit(e, closing(e)); assert.equal(validateEnvelope(e).status, 'valid'); assert.equal(getSession(e).drafts[0].input, 'retained');
    for (const c of commands) { assert.equal(planStage(e, {} as never, c).status, 'replay'); assert.equal(planApply(e, c).status, 'replay'); }
    const encoded = encodeEnvelope(e); assert.equal(encoded.status, 'encoded'); if (encoded.status === 'encoded') assert.equal(parseEnvelope(encoded.raw).status, 'valid');
  });
  test(`${script.levelId}: equality and arbitrary nonblank inputs share explicit progression and fixed response`, () => {
    const step = script.steps[0];
    for (const text of [step.learnerExample.japanese, step.learnerExample.reading, `　${step.learnerExample.japanese}　`, '。！？', '한국어', '別の選択肢', 'x'.repeat(8000), '😀\ud800e\u0301']) {
      const e = save(start(script.levelId), input(start(script.levelId), 'd', text)), c = command(e); assert.equal(c.kind, 'append'); if (c.kind !== 'append') continue;
      assert.equal(c.turn.draft.input, text); assert.ok('kind' in c.turn.emission); assert.equal(c.turn.emission.reply, step.fixedReply.japanese);
      assert.equal(c.turn.emission.correction, ''); assert.equal(c.turn.emission.progression.toStepId, script.steps[1].id);
      assert.equal(c.turn.emission.exampleFallback === null, c.turn.sampleMatch.matched);
      assert.equal(current(commit(e, c)).submittedStepCount, 1);
    }
    for (const text of ['', ' \t\n']) { const e = save(start(script.levelId), input(start(script.levelId), 'd', text)); assert.equal(buildGuidedTurn(getSession(e), getSession(e).drafts[0], { turnId: 't', sequence: 1, predecessorTurnId: null, recordedAt: TIME }), undefined); }
  });
}

test('only explicit guided creation upgrades a fresh v1 after-image and preserves exact legacy session bytes', () => {
  const b = base(), legacy = ok(planCreateSession(b, b, emptySession('legacy-s'))), before = canonicalJson(legacy.sessions[0]);
  assert.equal(legacy.schemaVersion, 1); const mixed = ok(planCreateSession(legacy, legacy, guided()));
  assert.equal(mixed.schemaVersion, 2); assert.equal(canonicalJson(mixed.sessions[0]), before); assert.equal(mixed.generationId, legacy.generationId); assert.deepEqual(mixed.enrollment, legacy.enrollment);
  const laterLegacy = ok(planCreateSession(mixed, mixed, emptySession('legacy-new'))); assert.equal(laterLegacy.schemaVersion, 2);
  assert.equal(legacyEnvelopeSchema.safeParse(mixed).success, false); assert.equal(validateEnvelope({ ...mixed, schemaVersion: 1 }).status, 'blocked');
  assert.equal(encodeEnvelope(legacy).status, 'encoded'); assert.equal(parseEnvelope(canonicalJson(legacy)).status, 'valid');
  const near = full(legacy), original = canonicalJson(near); assert.equal(planCreateSession(near, near, guided()).status, 'blocked'); assert.equal(canonicalJson(near), original);
});

test('known guided revision pins wrapper, order, text, labels and policies; unknown revision remains controlled unsupported', () => {
  const e = start();
  const changes: ((s: ReturnType<typeof guided>['source']) => void)[] = [
    s => { s.label += 'x'; }, s => { s.builderPolicy += 'x'; }, s => { s.matchPolicy += 'x'; },
    s => { if (isGuidedSource(s)) s.content.steps.reverse(); }, s => { if (isGuidedSource(s)) s.content.steps[0].fixedReply.japanese += 'x'; },
    s => { if (isGuidedSource(s)) s.levelLabelKo += 'x'; }, s => { if (isGuidedSource(s)) s.content.turnPolicy += 'x'; },
  ];
  for (const change of changes) { const v = structuredClone(e); change(v.sessions[0].source); assert.equal(validateEnvelope(v).status, 'blocked'); }
  const unknown = structuredClone(e), s = unknown.sessions[0].source; assert.ok(isGuidedSource(s)); s.scriptRevision = s.content.scriptRevision = s.contentSource.revision = 'unknown-revision';
  assert.equal(validateEnvelope(unknown).status, 'valid'); assert.equal(supportedSource(s), false); assert.equal(getConversationProgress(unknown.sessions[0]), undefined);
  assert.equal(planSaveDraft(unknown, sessionSource(unknown, 'session-a')!, input(e)).status, 'blocked');
  for (const value of [{ ...e, schemaVersion: 3 }, { ...e, sessions: [{ ...e.sessions[0], source: { ...s, sourceVersion: 2 } }] }]) assert.equal(parseEnvelope(canonicalJson(value)).status, 'blocked');
  assert.equal(parseEnvelope(canonicalJson(e).replace('"schemaVersion":2', '"schemaVersion":2,"schemaVersion":2')).status, 'blocked');
});

test('fresh builder rejects unsaved drafts, wrong prefix/head, future steps, and a skipped/repeated step', () => {
  let e = start(), d = input(e); const fields = { turnId: 'turn', sequence: 1, predecessorTurnId: null, recordedAt: TIME };
  assert.equal(buildGuidedTurn(getSession(e), d, fields), undefined); e = save(e, d);
  for (const f of [{ ...fields, sequence: 2 }, { ...fields, predecessorTurnId: 'wrong' }]) assert.equal(buildGuidedTurn(getSession(e), d, f), undefined);
  const future = input(e, 'future', 'text', GUIDED_CONVERSATION_PILOT[1].steps[1].id); assert.equal(planSaveDraft(e, sessionSource(e, 'session-a')!, future).status, 'blocked');
  e = commit(e, command(e)); d = { ...d, revision: 2, input: 'old step newer input' }; e = save(e, d);
  assert.equal(buildGuidedTurn(getSession(e), d, { ...fields, sequence: 2, predecessorTurnId: getSession(e).turns[0].turnId }), undefined);
});

test('R3 pins a draft ID across consumed lanes, higher revisions, cancelled commands and recovered drafts', () => {
  let e = save(start()); const original = getSession(e).drafts[0], c = command(e); e = stage(e, c); e = cancel(e, c);
  const changed = { ...original, revision: 2, source: { ...original.source, stepId: GUIDED_CONVERSATION_PILOT[1].steps[1].id } };
  assert.equal(planSaveDraft(e, sessionSource(e, 'session-a')!, changed).status, 'blocked');
  e = commit(e, command(e, 'apply-different-a')); assert.equal(getSession(e).drafts.length, 0);
  assert.equal(planSaveDraft(e, sessionSource(e, 'session-a')!, changed).status, 'blocked');
  const old = { ...original, revision: 2, input: 'new retained A text' }; e = save(e, old); assert.deepEqual(getSession(e).drafts[0], old);
  const newB = input(e, 'new-b'); e = save(e, newB); assert.equal(getSession(e).drafts.length, 2);
  const forged = structuredClone(e); forged.sessions[0].drafts[0] = changed; assert.equal(validateEnvelope(forged).status, 'blocked');
  const wrongRevision = structuredClone(e); wrongRevision.sessions[0].drafts[1].source.scriptRevision = 'wrong'; assert.equal(validateEnvelope(wrongRevision).status, 'blocked');
  const cancelledOnly = structuredClone(e), op = cancelledOnly.sessions[0].operations[0]; assert.ok(op.command.kind === 'append' && op.terminal?.kind === 'cancelled');
  op.command.turn.draft = { ...op.command.turn.draft, revision: 3, source: newB.source }; op.terminal.recoveredDraft = structuredClone(op.command.turn.draft);
  assert.equal(validateEnvelope(cancelledOnly).status, 'blocked');
});

test('unedited inserted older-step draft uses its own exact example and keeps reference immutable', () => {
  let e = save(start()); const original = getSession(e).drafts[0]; e = commit(e, command(e));
  const source = getSession(e).source; assert.ok(isGuidedSource(source));
  const retained = { ...original, revision: 2, origin: { kind: 'inserted-example' as const, edited: false }, input: source.content.steps[0].learnerExample.japanese };
  e = save(e, retained); assert.equal(validateEnvelope(e).status, 'valid');
  const wrong = { ...retained, revision: 3, input: source.content.steps[1].learnerExample.japanese }; assert.equal(planSaveDraft(e, sessionSource(e, 'session-a')!, wrong).status, 'blocked');
});

for (const level of ['elementary', 'intermediate']) test(`R1 ${level}: retained A/B lanes survive partial close at exact capacity and fresh session restarts A`, () => {
  let e = start(level); const a = input(e, 'retained-a'); e = save(e, a); e = commit(e, command(e)); e = save(e, { ...a, revision: 2, input: 'newer unsent A' });
  const b = input(e, 'retained-b'); e = save(e, b); e = commit(e, command(e)); e = save(e, { ...b, revision: 2, input: 'newer unsent B' });
  const laneBytes = canonicalJson(getSession(e).drafts), progress = current(e); assert.equal(progress.submittedStepCount, 2); assert.equal(progress.coverage, 'partial');
  assert.equal(planSaveDraft(e, sessionSource(e, 'session-a')!, input(e, 'third')).status, 'blocked');
  e = full(e); e = commit(e, closing(e)); assert.equal(canonicalJson(getSession(e).drafts), laneBytes); assert.equal(current(e).unsubmittedStepIds.length, 1); assert.equal(current(e).activeStepId, null);
  assert.equal(current(start(level)).activeStepIndex, 0); assert.equal(current(start(level)).submittedStepCount, 0);
});

test('R4 cancelled A append and early cancelled close replay after later A/B/C and final close', () => {
  let e = save(start()); const first = command(e), token = sessionSource(e, 'session-a')!; e = cancel(stage(e, first), first);
  const earlyClose = closing(e); e = cancel(stage(e, earlyClose), earlyClose);
  e = commit(e, command(e, 'second-a'));
  while (current(e).activeStepId) { e = save(e); e = commit(e, command(e)); }
  e = commit(e, closing(e)); assert.equal(validateEnvelope(e).status, 'valid');
  for (const c of [first, earlyClose]) { const replay = planStage(e, token, c); assert.equal(replay.status, 'replay'); assert.equal(replay.effect.kind, 'cancelled'); assert.equal(planApply(e, c).status, 'replay'); }
});

test('historical turn and operation tampering rejects exact reply, transition, fallback and ordinal changes', () => {
  let e = save(start()); e = commit(e, command(e));
  const mutate = [
    (t: typeof e.sessions[number]['turns'][number]) => { t.sequence = 2; },
    (t: typeof e.sessions[number]['turns'][number]) => { t.emission.reply += 'x'; },
    (t: typeof e.sessions[number]['turns'][number]) => { if ('kind' in t.emission) t.emission.progression.toStepId = null; },
    (t: typeof e.sessions[number]['turns'][number]) => { if ('kind' in t.emission) t.emission.exampleFallback = null; },
    (t: typeof e.sessions[number]['turns'][number]) => { t.draft.source.stepId = 'decline-bag'; },
  ];
  for (const mutation of mutate) {
    const v = structuredClone(e), op = v.sessions[0].operations[0]; mutation(v.sessions[0].turns[0]); assert.ok(op.command.kind === 'append'); op.command.turn = structuredClone(v.sessions[0].turns[0]);
    assert.equal(validateEnvelope(v).status, 'blocked');
  }
});

for (const outcome of ['apply', 'cancel'] as const) test(`R2 exact initial-close budget covers ${outcome}, read-first replay, and cannot be spent by mixed-session writes`, () => {
  let e = full(save(start())); const before = capacityUsage(e); assert.equal(before.admittedCodeUnits, 262144);
  const over = structuredClone(e); over.tombstones[0].deletionId += 'x'; assert.deepEqual(validateEnvelope(over), { status: 'blocked', code: 'capacity-exceeded' });
  const bigger = { ...getSession(e).drafts[0], revision: 2, input: getSession(e).drafts[0].input + 'x' }; assert.equal(planSaveDraft(e, sessionSource(e, 'session-a')!, bigger).status, 'blocked');
  assert.equal(planCreateSession(e, e, emptySession('unrelated')).status, 'blocked');
  const c = closing(e), oldSource = sessionSource(e, 'session-a')!; e = stage(e, c); assert.equal(validateEnvelope(e).status, 'valid'); e = outcome === 'apply' ? apply(e, c) : cancel(e, c);
  assert.equal(validateEnvelope(e).status, 'valid'); assert.equal(planStage(e, oldSource, c).status, 'replay'); assert.equal(planApply(e, c).status, 'replay');
  if (outcome === 'cancel') {
    assert.equal(getSession(e).closed, null); const next = closing(e, 'second-close'); assert.equal(stage(e, next).sessions[0].operations.at(-1)!.terminal, null);
    e = full(e); const original = canonicalJson(e); assert.deepEqual(planStage(e, sessionSource(e, 'session-a')!, next), { status: 'blocked', code: 'capacity-exceeded' }); assert.equal(canonicalJson(e), original);
    assert.equal(planStage(e, oldSource, c).status, 'replay'); assert.equal(planApply(e, c).status, 'replay');
  }
});

for (const outcome of ['apply', 'cancel'] as const) test(`R2 pending append at exact cap can ${outcome} and still stage/apply initial close`, () => {
  let e = save(start()); const append = command(e); e = full(stage(e, append)); e = outcome === 'apply' ? apply(e, append) : cancel(e, append);
  assert.equal(validateEnvelope(e).status, 'valid'); const c = closing(e); e = commit(e, c); assert.equal(validateEnvelope(e).status, 'valid');
});

test('R2 worst escaped close metadata is covered with no literal-ID-length shortcut', () => {
  let e = full(save(start())); const c = closing(e); assert.ok(c.kind === 'close'); const worst = '\u0000'.repeat(160);
  c.operationId = worst; c.receiptId = '\u0001'.repeat(160); c.boundary.boundaryId = '\u0002'.repeat(160);
  c.boundary.observation.requestId = worst; c.boundary.observation.ownerEpochId = worst; c.boundary.observation.lifecycleId = worst;
  e = stage(e, c); const r = resolution(e, c, '\u0003'.repeat(160)); e = ok(planResolve(e, sessionSource(e, 'session-a')!, c, r)); assert.equal(validateEnvelope(e).status, 'valid');
});

test('R2 reserves state transitions for initial close and an already pending append terminal', () => {
  const maximum = Number.MAX_SAFE_INTEGER - 1; let e = start(); e = { ...e, sessions: [{ ...e.sessions[0], stateRevision: maximum - 2 }] };
  assert.equal(validateEnvelope(e).status, 'valid'); assert.equal(planSaveDraft(e, sessionSource(e, 'session-a')!, input(e)).status, 'blocked');
  let c = closing(e); e = commit(e, c); assert.equal(e.sessions[0].stateRevision, maximum);
  let pending = save(start()); c = command(pending); pending = stage(pending, c); pending = { ...pending, sessions: [{ ...pending.sessions[0], stateRevision: maximum - 3 }] };
  assert.equal(validateEnvelope(pending).status, 'valid'); const invalid = { ...pending, sessions: [{ ...pending.sessions[0], stateRevision: maximum - 2 }] }; assert.equal(validateEnvelope(invalid).status, 'blocked');
  pending = apply(pending, c); pending = commit(pending, closing(pending)); assert.equal(pending.sessions[0].stateRevision, maximum);
});

test('source/emission/summary branches cannot mix despite individually valid shapes', () => {
  let e = save(start()); const c = command(e); e = commit(e, c);
  const wrong = structuredClone(e); wrong.sessions[0].source = structuredClone(SOURCE); assert.equal(validateEnvelope(wrong).status, 'blocked');
  const badClose = close(e); assert.equal(planStage(e, sessionSource(e, 'session-a')!, badClose).status, 'blocked');
  assert.equal(exact(sourceRef(SOURCE), { scriptId: SOURCE.scriptId, scriptRevision: SOURCE.scriptRevision, stepId: SOURCE.stepId }), true);
});


test('R2 sizing ID collision cannot overwrite retained cancelled append metadata', () => {
  let e = save(start(), input(start(), 'large-draft', '\u0005'.repeat(8000)));
  const c = command(e, 'collision'); c.operationId = '\u0000'.repeat(160); c.receiptId = 'collision-receipt';
  assert.ok(c.kind === 'append');
  e = cancel(stage(e, c), c); const retained = canonicalJson(getSession(e).operations[0]);
  e = full(e); const final = closing(e, 'safe-close'); e = commit(e, final);
  assert.equal(canonicalJson(getSession(e).operations[0]), retained); assert.equal(validateEnvelope(e).status, 'valid');
});

test('known guided digest cannot be laundered by changing the script identity too', () => {
  const e = structuredClone(start()), s = e.sessions[0].source; assert.ok(isGuidedSource(s));
  s.scriptId = s.content.scriptId = s.contentSource.entryKey = 'unknown-script';
  assert.equal(validateEnvelope(e).status, 'blocked');
});

test('R2 an otherwise empty last lane and an existing mixed legacy session cannot spend another session close reserve', () => {
  let e = start(); e = ok(planCreateSession(e, e, emptySession('legacy-other'))); e = save(e); e = full(e);
  const candidate = input(e, 'last-lane', 'x');
  assert.ok(capacityUsage(e).actualCodeUnits + canonicalJson(candidate).length + 1 < CONVERSATION_LIMITS.envelopeCodeUnits);
  assert.deepEqual(planSaveDraft(e, sessionSource(e, 'session-a')!, candidate), { status: 'blocked', code: 'capacity-exceeded' });
  assert.deepEqual(planSaveDraft(e, sessionSource(e, 'legacy-other')!, draft('legacy-draft', 'x')), { status: 'blocked', code: 'capacity-exceeded' });
  const c = closing(e); assert.equal(validateEnvelope(commit(e, c)).status, 'valid');
});

test('all zero/partial close prefixes preserve exact unsubmitted steps and no automatic close', () => {
  for (const script of GUIDED_CONVERSATION_PILOT) {
    for (let submitted = 0; submitted < script.stepCount; submitted++) {
      let e = start(script.levelId);
      for (let i = 0; i < submitted; i++) { e = save(e); e = commit(e, command(e)); }
      assert.equal(getSession(e).closed, null); e = commit(e, closing(e));
      assert.deepEqual(current(e).submittedStepIds, script.steps.slice(0, submitted).map(step => step.id));
      assert.deepEqual(current(e).unsubmittedStepIds, script.steps.slice(submitted).map(step => step.id));
      assert.equal(current(e).coverage, submitted ? 'partial' : 'none'); assert.equal(current(e).activeStepIndex, null);
    }
  }
});


test('R2 spent initial reserve: a new close checks its own two state transitions without breaking old replay', () => {
  let e = start(); const first = closing(e, 'first-close'), oldSource = sessionSource(e, 'session-a')!; e = cancel(stage(e, first), first);
  const maximum = Number.MAX_SAFE_INTEGER - 1;
  for (const remaining of [0, 1]) {
    const edge = { ...e, sessions: [{ ...e.sessions[0], stateRevision: maximum - remaining }] };
    assert.equal(validateEnvelope(edge).status, 'valid');
    assert.deepEqual(planStage(edge, sessionSource(edge, 'session-a')!, closing(edge, 'new-close')), { status: 'blocked', code: 'capacity-exceeded' });
    assert.equal(planStage(edge, oldSource, first).status, 'replay'); assert.equal(planApply(edge, first).status, 'replay');
  }
  const allowed = { ...e, sessions: [{ ...e.sessions[0], stateRevision: maximum - 2 }] };
  assert.equal(validateEnvelope(allowed).status, 'valid'); const finished = commit(allowed, closing(allowed, 'new-close'));
  assert.equal(getSession(finished).stateRevision, maximum); assert.equal(validateEnvelope(finished).status, 'valid');
});

test('R2 retains the strict 2000 operation ceiling; large history is already byte-capacity blocked', () => {
  const e = start(), c = closing(e, 'prototype'); assert.ok(c.kind === 'close');
  const operations = Array.from({ length: 2000 }, (_, index): ConversationSession['operations'][number] => {
    const command: ConversationCommand = { ...c, operationId: `op-${index}`, receiptId: `receipt-${index}`, boundary: { ...c.boundary, boundaryId: `boundary-${index}` } };
    return { command, terminal: { kind: 'cancelled', recoveredDraft: null, resolution: { ...resolution(e, command, `resolution-${index}`), expectedStateRevision: index * 2 + 1 } } };
  });
  const atCeiling = { ...e, sessions: [{ ...e.sessions[0], stateRevision: 4000, operations }] };
  assert.equal(sessionSchema.safeParse(atCeiling.sessions[0]).success, true);
  // Such a large history cannot fit the unchanged byte budget; the count ceiling
  // is intentionally not relaxed just because bytes normally bind first.
  assert.deepEqual(validateEnvelope(atCeiling), { status: 'blocked', code: 'capacity-exceeded' });
  assert.deepEqual(planStage(atCeiling, {} as never, closing(e, 'new-close')), { status: 'blocked', code: 'capacity-exceeded' });
  assert.equal(sessionSchema.safeParse({ ...atCeiling.sessions[0], operations: [...operations, operations[0]] }).success, false);
});
