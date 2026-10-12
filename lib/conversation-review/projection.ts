import { z } from 'zod';
import { isVerifiedAssessment } from './assessment-core.ts';
import { sameTurn, turnIdentity, turnSchema, type ConversationTurn, type VerifiedAssessment } from './contract.ts';

export const ownerContextSchema = turnSchema.pick({ ownerId: true, generationId: true });
export type OwnerContext = z.infer<typeof ownerContextSchema>;

/** Recheck exact source-turn binding and request conflicts at every projection.
 * A copied/serialized or missing-source record can never create a claim/card.
 */
export function selectBoundAssessments(context: OwnerContext, turns: readonly ConversationTurn[], records: readonly VerifiedAssessment[]) {
  const byTurn = new Map(turns.map(turn => [turnIdentity(turn), turn]));
  const slots = new Map<string, VerifiedAssessment>();
  const conflicts = new Set<string>();
  let rejected = 0;
  for (const record of records) {
    if (!isVerifiedAssessment(record)) { rejected++; continue; }
    const binding = record.evidence.request.turn;
    const turn = byTurn.get(turnIdentity(binding));
    if (binding.ownerId !== context.ownerId || binding.generationId !== context.generationId || !turn || !sameTurn(binding, turn)) { rejected++; continue; }
    const prior = slots.get(record.requestSlot);
    if (prior && JSON.stringify(prior.evidence) !== JSON.stringify(record.evidence)) conflicts.add(record.requestSlot);
    else slots.set(record.requestSlot, record);
  }
  // The same source receipt must not be reused under a minted request ID.
  const receipts = new Map<string, VerifiedAssessment>();
  for (const record of slots.values()) {
    const { evidence } = record;
    const receipt = JSON.stringify([evidence.request.source, evidence.receiptId]);
    const prior = receipts.get(receipt);
    if (prior && prior.requestSlot !== record.requestSlot) { conflicts.add(prior.requestSlot); conflicts.add(record.requestSlot); }
    else receipts.set(receipt, record);
  }
  return { records: [...slots.values()].filter(record => !conflicts.has(record.requestSlot)), rejected, conflicts: conflicts.size };
}

export function projectConversationReview(context: unknown, rawTurns: unknown, records: readonly VerifiedAssessment[]) {
  const owner = ownerContextSchema.safeParse(context);
  const turns = z.array(turnSchema).max(1000).safeParse(rawTurns);
  if (!owner.success || !turns.success || !Array.isArray(records) || records.length > 2000 || turns.data.some(turn => turn.ownerId !== owner.data.ownerId || turn.generationId !== owner.data.generationId) || new Set(turns.data.map(turnIdentity)).size !== turns.data.length) {
    return { status: 'unavailable' as const, reason: 'invalid-source-turns', cards: [] };
  }
  const selected = selectBoundAssessments(owner.data, turns.data, records);
  const groups = new Map<string, VerifiedAssessment[]>();
  for (const record of selected.records) {
    if (record.evidence.verdict !== 'confirmed-change' || !record.reviewCardId) continue;
    const group = groups.get(record.reviewCardId) ?? [];
    if (!group.some(item => item.occurrenceId === record.occurrenceId)) group.push(record);
    groups.set(record.reviewCardId, group);
  }
  const cards = [...groups].map(([id, occurrences]) => ({
    id,
    occurrenceCount: occurrences.length,
    repeated: occurrences.length >= 2,
    // Full immutable receipts retain exact original/corrected span, source,
    // explanation, session/turn revision and timestamps without course writes.
    occurrences,
  }));
  return { status: selected.rejected || selected.conflicts ? 'partial' as const : 'ready' as const, cards, rejectedEvidence: selected.rejected, conflictingRequests: selected.conflicts };
}
