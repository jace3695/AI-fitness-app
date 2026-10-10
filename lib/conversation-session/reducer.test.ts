import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalJson, capacityUsage, validateEnvelope } from './contracts.ts';
import { planApply, planCreateSession, planDeleteSession, planResolve, planSaveDraft, planStage, sessionSource } from './reducer.ts';
import { append, close, commit, draft, emptySession, fillBudget, getSession, ok, resolution, save, stage, started, TIME } from './fixtures.test-support.ts';

test('append stages frozen bytes, exact replay appends once and consumes only its pinned lane', () => {
  const e = save(save(started(), draft('a')), draft('b', 'other lane'));
  const c = append(e, 'operation-a', getSession(e).drafts[0]); const oldSource = sessionSource(e, c.sessionId)!;
  const pending = stage(e, c); const original = canonicalJson(pending);
  assert.equal(planStage(pending, oldSource, c).status, 'replay');
  const applied = ok(planApply(pending, c)); assert.equal(getSession(applied).turns.length, 1); assert.equal(getSession(applied).drafts[0].draftId, 'b');
  assert.equal(canonicalJson(pending), original);
  for (const replay of [planStage(applied, oldSource, c), planApply(applied, c)]) { assert.equal(replay.status, 'replay'); assert.deepEqual(ok(replay), applied); assert.equal(replay.effect.kind, 'applied'); }
  const divergent = structuredClone(c); divergent.receiptId = 'different'; assert.deepEqual(planApply(applied, divergent), { status: 'blocked', code: 'conflict' });
});

test('two occupied lanes cancel exactly without duplicate recovery, and late stage/apply cannot resurrect', () => {
  const e = save(save(started(), draft('a')), draft('b', 'other lane'));
  const c = append(e, 'operation-a', getSession(e).drafts[0]); const originalSource = sessionSource(e, c.sessionId)!;
  const pending = stage(e, c); const source = sessionSource(pending, c.sessionId)!; const r = resolution(pending, c);
  assert.deepEqual(planSaveDraft(pending, source, { ...draft('a'), revision: 2, input: 'new input' }), { status: 'blocked', code: 'pinned-draft' });
  assert.deepEqual(planSaveDraft(pending, source, draft('third')), { status: 'blocked', code: 'capacity-exceeded' });
  const cancelled = ok(planResolve(pending, source, c, r));
  assert.deepEqual(getSession(cancelled).drafts, getSession(e).drafts); assert.equal(getSession(cancelled).turns.length, 0);
  for (const replay of [planResolve(cancelled, source, c, r), planApply(cancelled, c), planStage(cancelled, originalSource, c)]) { assert.equal(replay.status, 'replay'); assert.deepEqual(ok(replay), cancelled); assert.equal(replay.effect.kind, 'cancelled'); }
  assert.equal(planResolve(cancelled, source, c, { ...r, resolutionId: 'different' }).status, 'blocked');
});

test('append wins a cancellation race and its exact receipt wins; absence never proves no commit', () => {
  const e = save(started()); const c = append(e); const pending = stage(e, c); const source = sessionSource(pending, c.sessionId)!; const r = resolution(pending, c);
  assert.deepEqual(planApply(e, c), { status: 'blocked', code: 'unresolved' });
  assert.deepEqual(planResolve(e, sessionSource(e, c.sessionId)!, c, r), { status: 'blocked', code: 'unresolved' });
  const applied = ok(planApply(pending, c)); const result = planResolve(applied, source, c, r);
  assert.equal(result.status, 'replay'); assert.deepEqual(ok(result), applied); assert.equal(result.effect.kind, 'applied');
});

test('other lane edits survive append and cancel, but same-head competing commands never overwrite the slot', () => {
  const e = save(started()); const c = append(e); const pending = stage(e, c);
  const changed = save(pending, draft('new-draft', 'newer typing'));
  assert.equal(planResolve(changed, sessionSource(pending, c.sessionId)!, c, resolution(pending, c)).status, 'blocked');
  const applied = ok(planApply(changed, c)); assert.equal(getSession(applied).drafts[0].input, 'newer typing');
  const competitor = { ...c, operationId: 'operation-b', receiptId: 'receipt-b' };
  assert.deepEqual(planStage(pending, sessionSource(pending, c.sessionId)!, competitor), { status: 'blocked', code: 'pending-operation' });
  const cancelled = ok(planResolve(changed, sessionSource(changed, c.sessionId)!, c, resolution(changed, c)));
  assert.equal(getSession(cancelled).drafts.length, 2);
});

test('close has a different payload and cancellation creates no learner draft or boundary', () => {
  const e = save(started()); const c = close(e); const pending = stage(e, c); const source = sessionSource(pending, c.sessionId)!;
  const cancelled = ok(planResolve(pending, source, c, resolution(pending, c)));
  assert.equal(getSession(cancelled).closed, null); assert.deepEqual(getSession(cancelled).drafts, getSession(e).drafts);
  assert.equal(getSession(cancelled).operations[0].terminal?.kind, 'cancelled');
  const newClose = close(cancelled, 'close-b'); const closed = commit(cancelled, newClose);
  assert.deepEqual(getSession(closed).drafts, getSession(e).drafts); assert.equal(getSession(closed).closed?.boundaryId, 'boundary-close-b');
  assert.equal(planSaveDraft(closed, sessionSource(closed, c.sessionId)!, draft('new')).status, 'blocked');
  const late = planApply(closed, c); assert.equal(late.status, 'replay'); assert.equal(late.effect.kind, 'cancelled');
});

test('close cannot pass a pending append; coverage and observation marker must be exact', () => {
  const e = save(started()); const pending = stage(e, append(e));
  assert.deepEqual(planStage(pending, sessionSource(pending, 'session-a')!, close(pending)), { status: 'blocked', code: 'pending-operation' });
  const saved = commit(e, append(e)); const c = close(saved); assert.equal(c.kind, 'close'); if (c.kind !== 'close') return;
  const bad = structuredClone(c); bad.boundary.turnRefs = []; assert.equal(planStage(saved, sessionSource(saved, c.sessionId)!, bad).status, 'blocked');
  const wrongOwner = structuredClone(c); wrongOwner.boundary.observation.ownerId = 'other'; assert.equal(planStage(saved, sessionSource(saved, c.sessionId)!, wrongOwner).status, 'blocked');
});

test('delete uses exact source, retains tombstone and blocks recreate, late stage, apply and resolution', () => {
  const e = save(started()); const c = append(e); const pending = stage(e, c); const source = sessionSource(pending, c.sessionId)!;
  const deletion = { deletionId: 'delete-a', tombstoneId: 'tombstone-a', ownerId: pending.ownerId, generationId: pending.generationId, sessionId: c.sessionId, expectedStateRevision: getSession(pending).stateRevision, deletedAt: TIME };
  assert.equal(planDeleteSession(pending, sessionSource(e, c.sessionId)!, deletion).status, 'blocked');
  const deleted = ok(planDeleteSession(pending, source, deletion)); assert.equal(deleted.sessions.length, 0); assert.equal(deleted.tombstones.length, 1);
  assert.equal(planDeleteSession(deleted, source, deletion).status, 'replay');
  for (const result of [planCreateSession(deleted, deleted, emptySession()), planStage(deleted, source, c), planApply(deleted, c), planResolve(deleted, source, c, resolution(pending, c))]) assert.deepEqual(result, { status: 'blocked', code: 'deleted' });
});

test('owner/generation and full session-source CAS reject stale work but preserve unrelated fresh sessions', () => {
  let e = save(started()); const source = sessionSource(e, 'session-a')!; const c = append(e);
  e = ok(planCreateSession(e, e, emptySession('session-b'))); e = save(e, draft('draft-b'), 'session-b');
  const staged = ok(planStage(e, source, c)); assert.deepEqual(getSession(staged, 'session-b'), getSession(e, 'session-b'));
  for (const changed of [{ ...c, ownerId: 'owner-b' }, { ...c, generationId: 'generation-b' }]) assert.equal(planApply(staged, changed).status, 'blocked');
  assert.equal(planSaveDraft(staged, source, draft('draft-c')).status, 'blocked');
});

test('all terminal paths and delete remain logically admitted at exact summed reservation ceiling', () => {
  let e = save(started()); const a = append(e); e = stage(e, a);
  e = ok(planCreateSession(e, e, emptySession('session-b'))); e = save(e, draft('b'), 'session-b'); const b = append(e, 'operation-b', getSession(e, 'session-b').drafts[0], 'session-b'); e = stage(e, b);
  const full = fillBudget(e); assert.equal(capacityUsage(full).reservedTurns, 2);
  assert.equal(planSaveDraft(full, sessionSource(full, 'session-b')!, draft('extra')).status, 'blocked');
  const afterA = ok(planApply(full, a)); assert.equal(validateEnvelope(afterA).status, 'valid');
  const afterB = ok(planResolve(afterA, sessionSource(afterA, 'session-b')!, b, resolution(afterA, b))); assert.equal(validateEnvelope(afterB).status, 'valid');
  const cancelledA = ok(planResolve(full, sessionSource(full, 'session-a')!, a, resolution(full, a))); assert.equal(validateEnvelope(cancelledA).status, 'valid');
  const deletion = { deletionId: '\u0000'.repeat(160), tombstoneId: '\u0001'.repeat(160), ownerId: full.ownerId, generationId: full.generationId, sessionId: 'session-a', expectedStateRevision: getSession(full).stateRevision, deletedAt: TIME };
  assert.equal(planDeleteSession(full, sessionSource(full, 'session-a')!, deletion).status, 'planned');
  const closePending = stage(started(), close(started())); const closeFull = fillBudget(closePending); const cc = getSession(closeFull).operations[0].command;
  assert.equal(planApply(closeFull, cc).status, 'planned'); assert.equal(planResolve(closeFull, sessionSource(closeFull, 'session-a')!, cc, resolution(closeFull, cc)).status, 'planned');
});

test('stage is rejected when only stage bytes fit; raw preexisting pending cannot evade reservations', () => {
  const e = save(started()); const c = append(e); const full = fillBudget(e);
  assert.equal(planStage(full, sessionSource(full, 'session-a')!, c).status, 'blocked');
  const injected = structuredClone(full); injected.sessions[0].operations.push({ command: c, terminal: null }); injected.sessions[0].stateRevision++;
  assert.equal(validateEnvelope(injected).status, 'blocked');
});

test('revision headroom is reserved for terminal transition and other-lane edits cannot spend it', () => {
  const e = structuredClone(save(started())); e.sessions[0].stateRevision = Number.MAX_SAFE_INTEGER - 2;
  const c = append(e); assert.equal(planStage(e, sessionSource(e, 'session-a')!, c).status, 'blocked');
  e.sessions[0].stateRevision = Number.MAX_SAFE_INTEGER - 3; const pending = stage(e, c);
  assert.equal(planSaveDraft(pending, sessionSource(pending, 'session-a')!, draft('other')).status, 'blocked');
  assert.equal(planApply(pending, c).status, 'planned'); assert.equal(planResolve(pending, sessionSource(pending, 'session-a')!, c, resolution(pending, c)).status, 'planned');
});

test('empty and whitespace draft revisions preserve an acknowledged erase without creating a turn', () => {
  let e = save(started()); const original = getSession(e).drafts[0];
  for (const input of ['', ' \n\t']) {
    const next = { ...getSession(e).drafts[0], revision: getSession(e).drafts[0].revision + 1, input };
    e = ok(planSaveDraft(e, sessionSource(e, 'session-a')!, next)); assert.equal(getSession(e).drafts[0].input, input);
  }
  assert.equal(original.input, '  synthetic input\n'); assert.equal(getSession(e).turns.length, 0);
});

test('pending result IDs are reserved across sessions and cancellation never permits identity reuse', () => {
  let e = save(started()); const c = append(e); e = stage(e, c);
  e = ok(planCreateSession(e, e, emptySession('session-b'))); e = save(e, draft('b'), 'session-b');
  const other = append(e, 'other', getSession(e, 'session-b').drafts[0], 'session-b');
  assert.equal(c.kind, 'append'); assert.equal(other.kind, 'append'); if (c.kind !== 'append' || other.kind !== 'append') return;
  const duplicate = structuredClone(other); duplicate.turn.turnId = c.turn.turnId;
  assert.equal(planStage(e, sessionSource(e, 'session-b')!, duplicate).status, 'blocked');
  const cancelled = ok(planResolve(e, sessionSource(e, 'session-a')!, c, resolution(e, c)));
  const reused = { ...c, operationId: 'replacement', receiptId: 'replacement-receipt' };
  assert.equal(planStage(cancelled, sessionSource(cancelled, 'session-a')!, reused).status, 'blocked');
});

test('historical draft identity cannot acquire divergent bytes under the same ID and revision', () => {
  const e = save(started()); const c = append(e); const saved = commit(e, c);
  assert.equal(planSaveDraft(saved, sessionSource(saved, 'session-a')!, { ...draft(), input: 'divergent' }).status, 'blocked');
});

test('maximum-width escaped resolution metadata fits the original reserved terminal budget', () => {
  const e = save(started()); const c = append(e); const pending = fillBudget(stage(e, c));
  const r = resolution(pending, c, '\u0000'.repeat(160)); r.resolvedAt = '2026-10-10T00:00:00.123456789012345678Z';
  const resolved = planResolve(pending, sessionSource(pending, 'session-a')!, c, r);
  assert.equal(resolved.status, 'planned'); assert.ok(capacityUsage(ok(resolved)).admittedCodeUnits <= 262144);
});
