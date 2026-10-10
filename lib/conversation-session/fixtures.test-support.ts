import assert from 'node:assert/strict';
import { buildFrozenTurn, capacityUsage, CONVERSATION_LIMITS, freezeLegacySource, sourceRef, SUMMARY_POLICY_VERSION, type ConversationBoundary, type ConversationCommand, type ConversationDraft, type ConversationEnvelope, type ConversationResolution, type ConversationSession } from './contracts.ts';
import { planCreateSession, planSaveDraft, planStage, planApply, sessionSource, type PlanResult } from './reducer.ts';
export const TIME = '2026-10-10T00:00:00.000Z';
export const SOURCE = freezeLegacySource('legacy-cafe')!;
export function base(): ConversationEnvelope { return { schemaVersion: 1, ownerId: 'owner-a', generationId: 'generation-a', marker: null, enrollment: { kind: 'explicit-enrollment', enrollmentId: 'enrollment-a', createdAt: TIME }, sessions: [], tombstones: [] }; }
export function emptySession(sessionId = 'session-a'): ConversationSession { return { sessionId, createdAt: TIME, timeZone: 'Asia/Seoul', source: structuredClone(SOURCE), stateRevision: 0, headRevision: 0, drafts: [], turns: [], operations: [], closed: null }; }
export function ok(result: PlanResult): ConversationEnvelope { assert.notEqual(result.status, 'blocked', JSON.stringify(result)); if (result.status === 'blocked') throw new Error(result.code); return result.envelope; }
export function started(id = 'session-a'): ConversationEnvelope { const b = base(); return ok(planCreateSession(b, b, emptySession(id))); }
export function draft(draftId = 'draft-a', input = '  synthetic input\n'): ConversationDraft { return { draftId, revision: 1, input, savedAt: TIME, source: sourceRef(SOURCE), origin: { kind: 'typed', edited: false }, exposure: { example: 'shown', reading: 'not-shown', meaning: 'not-shown', hint: 'not-shown' } }; }
export function getSession(e: ConversationEnvelope, id = 'session-a') { return e.sessions.find(s => s.sessionId === id)!; }
export function save(e: ConversationEnvelope, d = draft(), id = 'session-a') { return ok(planSaveDraft(e, sessionSource(e, id)!, d)); }
export function append(e: ConversationEnvelope, operationId = 'operation-a', d = getSession(e).drafts[0], id = 'session-a'): ConversationCommand {
  const s = getSession(e, id);
  const turn = buildFrozenTurn(s.source, d, { turnId: `turn-${operationId}`, sequence: s.turns.length + 1, predecessorTurnId: s.turns.at(-1)?.turnId ?? null, recordedAt: TIME });
  assert.ok(turn);
  return { kind: 'append', operationId, receiptId: `receipt-${operationId}`, ownerId: e.ownerId, generationId: e.generationId, sessionId: id, expectedHeadRevision: s.headRevision, turn };
}
export function close(e: ConversationEnvelope, operationId = 'close-a', id = 'session-a'): ConversationCommand {
  const s = getSession(e, id);
  const boundary: ConversationBoundary = { boundaryId: `boundary-${operationId}`, summaryPolicyVersion: SUMMARY_POLICY_VERSION, turnRefs: s.turns.map(t => ({ turnId: t.turnId, turnRevision: t.turnRevision })), closedAt: TIME, timeZone: s.timeZone, observation: { kind: 'authenticated-remote-observation-received', requestId: 'read-a', ownerId: e.ownerId, ownerEpochId: 'epoch-a', lifecycleId: 'lifecycle-a', marker: e.marker, receivedAt: '2026-10-09T01:00:00.000Z' } };
  return { kind: 'close', operationId, receiptId: `receipt-${operationId}`, ownerId: e.ownerId, generationId: e.generationId, sessionId: id, expectedHeadRevision: s.headRevision, boundary };
}
export function stage(e: ConversationEnvelope, c: ConversationCommand) { return ok(planStage(e, sessionSource(e, c.sessionId)!, c)); }
export function commit(e: ConversationEnvelope, c: ConversationCommand) { return ok(planApply(stage(e, c), c)); }
export function resolution(e: ConversationEnvelope, c: ConversationCommand, resolutionId = 'resolution-a'): ConversationResolution { return { resolutionId, operationId: c.operationId, ownerId: e.ownerId, generationId: e.generationId, sessionId: c.sessionId, expectedStateRevision: getSession(e, c.sessionId).stateRevision, resolvedAt: TIME }; }
/** Synthetic metadata only. Fill the logical admission budget without pruning. */
export function fillBudget(e: ConversationEnvelope, target = CONVERSATION_LIMITS.envelopeCodeUnits): ConversationEnvelope {
  const result = structuredClone(e);
  let index = 0;
  while (capacityUsage(result).admittedCodeUnits < target) {
    const tombstone = { deletionId: `deletion-fill-${index}`, tombstoneId: `tombstone-fill-${index}`, sessionId: `deleted-fill-${index}`, ownerId: e.ownerId, generationId: e.generationId, expectedStateRevision: 0, deletedAt: TIME };
    const before = capacityUsage(result).admittedCodeUnits;
    result.tombstones.push(tombstone);
    const after = capacityUsage(result).admittedCodeUnits;
    if (after > target) {
      result.tombstones.pop();
      const last = result.tombstones.at(-1)!;
      let remaining = target - before;
      for (const field of ['deletionId', 'tombstoneId', 'sessionId'] as const) {
        const extra = Math.min(160 - last[field].length, remaining);
        last[field] += 'x'.repeat(extra); remaining -= extra;
      }
      assert.equal(remaining, 0); break;
    }
    index++;
  }
  assert.equal(capacityUsage(result).admittedCodeUnits, target);
  return result;
}
