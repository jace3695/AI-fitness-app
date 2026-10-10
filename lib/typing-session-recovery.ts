import type { GrowthSessionRow } from '../app/data/growthPlatform.ts';

export type TypingSession = {
  id: string; routineId: string; sessionDate: string; status: 'partial' | 'completed';
  plannedMinutes: number; actualMinutes: number; source: 'typing'; memo: string;
  metrics: Record<string, unknown>; startedAt: string; endedAt: string;
};

const canonical = (value: unknown): string => JSON.stringify(value, (_key, nested) => nested && typeof nested === 'object' && !Array.isArray(nested)
  ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b))) : nested);

export function typingRowMatches(row: GrowthSessionRow, owner: string, session: TypingSession) {
  return row.id === session.id && row.user_id === owner && row.routine_id === session.routineId
    && row.session_date === session.sessionDate && row.status === session.status && row.planned_minutes === session.plannedMinutes
    && row.actual_minutes === session.actualMinutes && row.source === session.source && row.memo === session.memo
    && row.started_at !== null && Date.parse(row.started_at) === Date.parse(session.startedAt)
    && row.ended_at !== null && Date.parse(row.ended_at) === Date.parse(session.endedAt)
    && canonical(row.metrics) === canonical(session.metrics);
}

type SaveBoundary = {
  assertOwner: () => Promise<void>;
  read: () => Promise<{ data: GrowthSessionRow | null; error: unknown }>;
  insert: () => Promise<unknown>;
};
/** Retried/reloaded attempts read first. Only confirmed absence permits the same ID to be inserted.
 * A successful POST alone never marks the draft saved: the full immutable payload must read back. */
export async function confirmTypingSave(owner: string, session: TypingSession, retry: boolean, boundary: SaveBoundary): Promise<GrowthSessionRow> {
  const read = async () => {
    await boundary.assertOwner();
    const result = await boundary.read();
    await boundary.assertOwner();
    if (result.error) throw new Error('typing_save_unconfirmed');
    if (result.data && !typingRowMatches(result.data, owner, session)) throw new Error('typing_save_conflict');
    return result.data;
  };
  if (retry) {
    const existing = await read();
    if (existing) return existing;
  }
  await boundary.assertOwner();
  // A lost or thrown response is inconclusive; still try a read, never generate another ID.
  try { await boundary.insert(); } catch (error) {
    // These authoritative rejections cannot be reinterpreted as a successful
    // save in an obsolete generation or bypassed through a legacy direct write.
    if (error instanceof Error && ['typing_reset_changed', 'typing_save_schema_unavailable'].includes(error.message)) throw error;
    // Lost responses and other uncertain failures are confirmed independently below.
  }
  const row = await read();
  if (!row) throw new Error('typing_save_unconfirmed');
  return row;
}
