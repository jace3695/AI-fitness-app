import { TYPING_LESSONS, TYPING_KEYS, TYPING_BASICS_ID, emptyTypingAttempt, typingKeyAccuracy, type TypingAttempt } from '../app/data/typingBasics.ts';
import type { TypingSession } from './typing-session-recovery.ts';

export type TypingBasicsDraft = {
  version: 1; ownerId: string; resetMarker: string | null;
  lessonIndex: number; lesson: { id: string; title: string; goal: string; keys: string };
  attempt: TypingAttempt; startedAt: number | null; endedAt: number | null;
  checks: boolean[]; pending: TypingSession | null;
};
export const typingBasicsDraftKey = (owner: string) => `yeoni-typing-basics:${owner}:draft:v1`;
export function emptyTypingBasicsDraft(ownerId: string, resetMarker: string | null, lessonIndex = 0): TypingBasicsDraft {
  if (!Number.isInteger(lessonIndex) || !TYPING_LESSONS[lessonIndex]) throw Error('typing_draft_invalid');
  return { version: 1, ownerId, resetMarker, lessonIndex, lesson: { ...TYPING_LESSONS[lessonIndex] },
    attempt: emptyTypingAttempt(), startedAt: null, endedAt: null, checks: [false, false], pending: null };
}
const canonical = (value: unknown): string => JSON.stringify(value, (_key, nested) => nested && typeof nested === 'object' && !Array.isArray(nested)
  ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b))) : nested);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

export function makeTypingBasicsSession(draft: TypingBasicsDraft, routineId: string, id: string, sessionDate: string): TypingSession {
  const { attempt, startedAt, endedAt, checks, lesson, lessonIndex } = draft;
  if (attempt.position !== lesson.keys.length || startedAt === null || endedAt === null || !checks.every(Boolean)) throw Error('typing_incomplete');
  const seconds = Math.max(1, Math.round((endedAt - startedAt) / 1000));
  const actualMinutes = Math.round(seconds / 60);
  // Do not silently shorten an interrupted multi-day attempt to fit the server.
  if (actualMinutes > 1440) throw Error('typing_duration_out_of_range');
  return { id, routineId, sessionDate, status: 'completed', source: 'typing', plannedMinutes: 5, actualMinutes,
    memo: `타자 자리 ${lessonIndex + 1}강 · ${lesson.title}`,
    startedAt: new Date(startedAt).toISOString(), endedAt: new Date(endedAt).toISOString(),
    metrics: { courseId: TYPING_BASICS_ID, lessonId: lesson.id, lessonCompleted: true,
      keyPresses: attempt.attempts, correctKeyPresses: attempt.position, keyAccuracy: typingKeyAccuracy(attempt),
      mistakeKeys: { ...attempt.mistakes }, elapsedSeconds: seconds, selfChecks: [...checks], inputMode: 'physical-key-position' } };
}

/** Bounded local snapshots are recovery data, never authority to write cloud records. */
export function parseTypingBasicsDraft(raw: string | null, owner: string): TypingBasicsDraft | null {
  if (raw === null) return null;
  if (raw.length > 16000) throw Error('typing_draft_invalid');
  const draft = JSON.parse(raw) as TypingBasicsDraft;
  if (!object(draft) || draft.version !== 1 || draft.ownerId !== owner || !uuid(owner)
    || (draft.resetMarker !== null && (typeof draft.resetMarker !== 'string' || draft.resetMarker.length > 200))
    || !integer(draft.lessonIndex, 0, 999) || !object(draft.lesson)
    || !text(draft.lesson.id, 100) || !text(draft.lesson.title, 200) || !text(draft.lesson.goal, 1000)
    || !text(draft.lesson.keys, 500) || [...draft.lesson.keys].some(key => !Object.hasOwn(TYPING_KEYS, key))
    || !object(draft.attempt) || !integer(draft.attempt.position, 0, draft.lesson.keys.length)
    || !integer(draft.attempt.attempts, draft.attempt.position, 1000000) || !object(draft.attempt.mistakes)
    || Object.entries(draft.attempt.mistakes).some(([key, count]) => !draft.lesson.keys.includes(key) || key.length !== 1 || !integer(count, 1, 1000000))
    || Object.values(draft.attempt.mistakes).reduce((sum, count) => sum + count, 0) !== draft.attempt.attempts - draft.attempt.position
    || (draft.startedAt !== null && !integer(draft.startedAt, 1, 8640000000000000))
    || (draft.endedAt !== null && !integer(draft.endedAt, draft.startedAt ?? 1, 8640000000000000))
    || (draft.attempt.attempts > 0) !== (draft.startedAt !== null)
    || (draft.attempt.position === draft.lesson.keys.length) !== (draft.endedAt !== null)
    || !Array.isArray(draft.checks) || draft.checks.length !== 2 || draft.checks.some(value => typeof value !== 'boolean')
    || (draft.endedAt === null && draft.checks.some(Boolean))) throw Error('typing_draft_invalid');
  if (draft.pending !== null) {
    const session = draft.pending;
    if (!object(session) || !uuid(session.id) || !uuid(session.routineId) || typeof session.sessionDate !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/.test(session.sessionDate)
      || !Number.isFinite(Date.parse(`${session.sessionDate}T12:00:00Z`))
      || new Date(`${session.sessionDate}T12:00:00Z`).toISOString().slice(0, 10) !== session.sessionDate) throw Error('typing_draft_invalid');
    const expected = makeTypingBasicsSession(draft, session.routineId, session.id, session.sessionDate);
    if (canonical(expected) !== canonical(session)) throw Error('typing_draft_invalid');
  }
  return draft;
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function persistTypingBasicsDraft(storage: DraftStorage, draft: TypingBasicsDraft, expected: string | null): string {
  const key = typingBasicsDraftKey(draft.ownerId);
  if (storage.getItem(key) !== expected) throw Error('typing_draft_changed');
  const raw = JSON.stringify(draft);
  parseTypingBasicsDraft(raw, draft.ownerId);
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw Error('typing_draft_changed');
  return raw;
}
export function removeTypingBasicsDraft(storage: DraftStorage, owner: string, expected: string | null) {
  const key = typingBasicsDraftKey(owner);
  if (storage.getItem(key) !== expected) throw Error('typing_draft_changed');
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw Error('typing_draft_changed');
}
export function shouldResetTypingBasicsDraft(draft: TypingBasicsDraft, saved: boolean, saving: boolean, confirm: () => boolean) {
  if (saving || draft.pending && !saved) return false;
  return !draft.attempt.attempts || saved || confirm();
}
