import { calculateTypingMetrics, type GrowthSessionRow } from '../app/data/growthPlatform.ts';
import { typingMistakes } from '../app/data/practiceEvidence.ts';

export const TYPING_PASSAGES = [
  '천천히 정확하게 입력하면 속도는 자연스럽게 따라옵니다.',
  '작은 기록을 매일 이어가면 분명한 성장으로 돌아옵니다.',
  '오늘 할 수 있는 만큼 시작하고 끝난 뒤 한 줄을 남깁니다.',
];
export type SentenceTypingSession = {
  id: string; routineId: string; sessionDate: string; status: 'partial' | 'completed';
  plannedMinutes: number; actualMinutes: number; source: 'typing'; memo: string;
  metrics: Record<string, unknown>; startedAt: string; endedAt: string;
};
export type SentenceTypingDraft = {
  version: 1; ownerId: string; resetMarker: string | null;
  passageIndex: number; passage: string; typed: string; startedAt: number | null;
  pending: SentenceTypingSession | null;
};
export const sentenceTypingDraftKey = (owner: string) => `yeoni-sentence-typing:${owner}:draft:v1`;
export const emptySentenceTypingDraft = (ownerId: string, resetMarker: string | null, passageIndex = 0): SentenceTypingDraft => ({
  version: 1, ownerId, resetMarker, passageIndex, passage: TYPING_PASSAGES[passageIndex], typed: '', startedAt: null, pending: null,
});
const canonical = (value: unknown): string => JSON.stringify(value, (_key, nested) => nested && typeof nested === 'object' && !Array.isArray(nested)
  ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b))) : nested);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const validTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function makeSentenceTypingSession(draft: SentenceTypingDraft, routine: { id: string; target_minutes: number }, id: string, sessionDate: string, endedAt: number): SentenceTypingSession {
  if (!draft.typed || draft.startedAt === null) throw new Error('typing_empty');
  const duration = Math.max(1, Math.round((endedAt - draft.startedAt) / 1000));
  const metrics = calculateTypingMetrics(draft.passage, draft.typed, duration);
  return {
    id, routineId: routine.id, sessionDate, status: draft.typed.length >= draft.passage.length ? 'completed' : 'partial',
    plannedMinutes: Math.min(240, Math.max(0, Math.round(routine.target_minutes))), actualMinutes: Math.min(1440, Math.round(duration / 60)),
    source: 'typing', memo: '타자 연습',
    metrics: { passageIndex: draft.passageIndex, ...metrics, elapsedSeconds: duration, mistakeCharacters: typingMistakes(draft.passage, draft.typed) },
    startedAt: new Date(draft.startedAt).toISOString(), endedAt: new Date(endedAt).toISOString(),
  };
}

/** Local recovery data is never an authorization source or a cloud write until revalidated. */
export function parseSentenceTypingDraft(raw: string | null, owner: string): SentenceTypingDraft | null {
  if (raw === null) return null;
  if (raw.length > 16000) throw new Error('typing_draft_invalid');
  const draft = JSON.parse(raw) as SentenceTypingDraft;
  if (!draft || draft.version !== 1 || draft.ownerId !== owner || !uuid(owner)
    || (draft.resetMarker !== null && (typeof draft.resetMarker !== 'string' || draft.resetMarker.length > 200))
    || !integer(draft.passageIndex, 0, TYPING_PASSAGES.length - 1)
    || typeof draft.passage !== 'string' || !draft.passage.length || draft.passage.length > 500
    || typeof draft.typed !== 'string' || draft.typed.length > draft.passage.length
    || (draft.startedAt !== null && !integer(draft.startedAt, 1, 8640000000000000))
    || (draft.typed.length > 0 && draft.startedAt === null)) throw new Error('typing_draft_invalid');
  if (draft.pending !== null) {
    const session = draft.pending;
    if (!session || !uuid(session.id) || !uuid(session.routineId) || !validTime(session.startedAt) || !validTime(session.endedAt)
      || !/^\d{4}-\d{2}-\d{2}$/.test(session.sessionDate) || !validTime(`${session.sessionDate}T12:00:00Z`)
      || new Date(`${session.sessionDate}T12:00:00Z`).toISOString().slice(0, 10) !== session.sessionDate
      || Date.parse(session.endedAt) < draft.startedAt!
      || !integer(session.plannedMinutes, 0, 240) || !draft.typed || draft.startedAt === null) throw new Error('typing_draft_invalid');
    const expected = makeSentenceTypingSession(draft, { id: session.routineId, target_minutes: session.plannedMinutes }, session.id, session.sessionDate, Date.parse(session.endedAt));
    if (canonical(session) !== canonical(expected)) throw new Error('typing_draft_invalid');
  }
  return draft;
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/** Synchronous, read-back-checked writes; a stale tab cannot knowingly replace a newer draft. */
export function persistSentenceTypingDraft(storage: DraftStorage, draft: SentenceTypingDraft, expected: string | null): string {
  const key = sentenceTypingDraftKey(draft.ownerId);
  if (storage.getItem(key) !== expected) throw new Error('typing_draft_changed');
  const raw = JSON.stringify(draft);
  parseSentenceTypingDraft(raw, draft.ownerId);
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error('typing_draft_changed');
  return raw;
}
export function removeSentenceTypingDraft(storage: DraftStorage, owner: string, expected: string | null) {
  const key = sentenceTypingDraftKey(owner);
  if (storage.getItem(key) !== expected) throw new Error('typing_draft_changed');
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error('typing_draft_changed');
}

export function sentenceTypingRowMatches(row: GrowthSessionRow, owner: string, session: SentenceTypingSession) {
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
export async function confirmSentenceTypingSave(owner: string, session: SentenceTypingSession, retry: boolean, boundary: SaveBoundary): Promise<GrowthSessionRow> {
  const read = async () => {
    await boundary.assertOwner();
    const result = await boundary.read();
    await boundary.assertOwner();
    if (result.error) throw new Error('typing_save_unconfirmed');
    if (result.data && !sentenceTypingRowMatches(result.data, owner, session)) throw new Error('typing_save_conflict');
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

/** Cancel does not mutate the attempt, its timer, or its pending request. */
export function shouldResetSentenceTypingDraft(draft: SentenceTypingDraft, saved: boolean, saving: boolean, confirm: () => boolean) {
  if (saving || draft.pending && !saved) return false;
  return !draft.typed || saved || confirm();
}
