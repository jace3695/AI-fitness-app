import type { GrowthRoutineRow, GrowthSessionRow, GrowthSessionStatus } from '../app/data/growthPlatform.ts';
import { GROWTH_STOP_REASONS } from '../app/data/growthPlatform.ts';
import { GROWTH_DIFFICULTIES } from '../app/data/growthRoutineProgression.ts';

export type RoutineForm = Record<string, unknown> & {
  routineId: string; date: string; status: GrowthSessionStatus; minutes: string;
  memo: string; difficulty: string; stopReason: string; startedAt: string | null; open: boolean;
};
export type RoutinePayload = Omit<GrowthSessionRow, 'created_at'> & { routine_id: string; source: 'manual' };
export type RoutineAttempt = { mode: 'active' | 'manual' | 'quick'; payload: RoutinePayload; input: RoutineForm | null };
export type RoutineDraft = Record<string, unknown> & {
  version: 1; ownerId: string; resetMarker: string | null; revision: string;
  active: RoutineForm; manual: RoutineForm; pending: RoutineAttempt | null; lastConfirmed: string | null;
};
export function readRoutineResetMarker(data: unknown): string | null {
  if (data === null) return null;
  if (!object(data) || !object(data.state)) throw Error('routine_reset_unknown');
  const value = data.state['ai-fitness-record-reset-growth'];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > 200) throw Error('routine_reset_unknown');
  return value;
}
export const routineDraftKey = (owner: string) => `yeoni-routine-record:${owner}:draft:v1`;
export const canonicalRoutineValue = (value: unknown): string => JSON.stringify(value, (_key, nested) => nested && typeof nested === 'object' && !Array.isArray(nested)
  ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b))) : nested);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, max: number): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;
const time = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)) && routineDateValid(v.slice(0, 10)) && !/[1-9]/.test((v.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? '').slice(3));
export const routineDateValid = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v) && Number.isFinite(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
export const emptyRoutineForm = (date: string): RoutineForm => ({ routineId: '', date, status: 'completed', minutes: '10', memo: '', difficulty: 'unrecorded', stopReason: 'unrecorded', startedAt: null, open: false });
export const emptyRoutineDraft = (ownerId: string, resetMarker: string | null, date: string): RoutineDraft => ({ version: 1, ownerId, resetMarker, revision: crypto.randomUUID(), active: emptyRoutineForm(date), manual: emptyRoutineForm(date), pending: null, lastConfirmed: null });
const formFields = ['routineId','date','status','minutes','memo','difficulty','stopReason','startedAt','open'];
const knownForm = (form: RoutineForm): RoutineForm => Object.fromEntries(formFields.map(key => [key, form[key]])) as RoutineForm;
function assertForm(form: unknown): asserts form is RoutineForm {
  if (!object(form) || typeof form.routineId !== 'string' || form.routineId !== '' && !uuid(form.routineId)
    || typeof form.date !== 'string' || form.date.length > 20 || !['completed','partial','stopped'].includes(form.status as string)
    || typeof form.minutes !== 'string' || form.minutes.length > 100 || typeof form.memo !== 'string' || form.memo.length > 500
    || typeof form.difficulty !== 'string' || !Object.hasOwn(GROWTH_DIFFICULTIES, form.difficulty) || typeof form.stopReason !== 'string' || !Object.hasOwn(GROWTH_STOP_REASONS, form.stopReason)
    || form.startedAt !== null && !time(form.startedAt) || typeof form.open !== 'boolean') throw Error('routine_draft_invalid');
}
const payloadFields = ['id','user_id','routine_id','session_date','status','planned_minutes','actual_minutes','memo','source','metrics','started_at','ended_at','updated_at'];
export function assertRoutinePayload(value: unknown, owner: string): asserts value is RoutinePayload {
  if (!object(value) || Object.keys(value).length !== payloadFields.length || !payloadFields.every(key => Object.hasOwn(value, key))
    || !uuid(value.id) || value.user_id !== owner || !uuid(owner) || !uuid(value.routine_id) || !routineDateValid(value.session_date)
    || !['completed','partial','stopped'].includes(value.status as string) || !integer(value.planned_minutes, 240) || !integer(value.actual_minutes, 1440)
    || typeof value.memo !== 'string' || value.memo.length > 500 || value.source !== 'manual' || !time(value.updated_at) || !object(value.metrics)) throw Error('routine_attempt_invalid');
  const m = value.metrics;
  if (!['active','manual','quick'].includes(m.recordMode as string) || typeof m.actualMinutesRecorded !== 'boolean'
    || Object.keys(m).some(key => !['recordMode','actualMinutesRecorded','routineDifficulty','stopReason'].includes(key))) throw Error('routine_attempt_invalid');
  if ('routineDifficulty' in m && (value.status !== 'completed' || !['too_easy','appropriate','difficult'].includes(m.routineDifficulty as string))
    || 'stopReason' in m && (value.status === 'completed' || typeof m.stopReason !== 'string' || !Object.hasOwn(GROWTH_STOP_REASONS, m.stopReason))) throw Error('routine_attempt_invalid');
  if (m.recordMode === 'quick') {
    if (m.actualMinutesRecorded !== false || value.actual_minutes !== 0 || value.status !== 'completed' || Object.keys(m).length !== 2) throw Error('routine_attempt_invalid');
  } else if (m.actualMinutesRecorded !== true || value.status !== 'completed' && !Object.hasOwn(m, 'stopReason')) throw Error('routine_attempt_invalid');
  if (m.recordMode === 'active') {
    if (!time(value.started_at) || !time(value.ended_at) || Date.parse(value.ended_at) < Date.parse(value.started_at) || Date.parse(value.ended_at) - Date.parse(value.started_at) > 86400000
      || Date.parse(value.updated_at) !== Date.parse(value.ended_at)
      || Math.round((Date.parse(value.ended_at) - Date.parse(value.started_at)) / 60000) !== value.actual_minutes) throw Error('routine_attempt_invalid');
  } else if (value.started_at !== null || value.ended_at !== null) throw Error('routine_attempt_invalid');
}
export function makeRoutineAttempt(owner: string, mode: RoutineAttempt['mode'], form: RoutineForm | null, routine: GrowthRoutineRow, id: string, date: string, now: string): RoutineAttempt {
  if (routine.user_id !== owner || !uuid(routine.id) || !integer(routine.target_minutes, 240)) throw Error('routine_routine_invalid');
  if (mode !== 'quick' && !form) throw Error('routine_input_invalid');
  const active = mode === 'active', manual = mode === 'manual';
  if (form) { assertForm(form); if (form.routineId !== routine.id) throw Error('routine_routine_invalid'); }
  const sessionDate = manual ? form!.date : date;
  if (!routineDateValid(sessionDate) || sessionDate > date || !time(now)) throw Error('routine_input_invalid');
  let minutes = 0;
  if (manual) {
    if (!/^\d+$/.test(form!.minutes) || !integer(Number(form!.minutes), 1440)) throw Error('routine_minutes_invalid');
    minutes = Number(form!.minutes);
  } else if (active) {
    if (!time(form!.startedAt) || Date.parse(now) < Date.parse(form!.startedAt) || Date.parse(now) - Date.parse(form!.startedAt) > 86400000) throw Error('routine_elapsed_invalid');
    minutes = Math.round((Date.parse(now) - Date.parse(form!.startedAt)) / 60000);
    if (!integer(minutes, 1440)) throw Error('routine_elapsed_invalid');
  }
  const status = form?.status ?? 'completed';
  const metrics: Record<string, unknown> = { recordMode: mode, actualMinutesRecorded: mode !== 'quick' };
  if (mode !== 'quick' && status === 'completed' && form!.difficulty !== 'unrecorded') metrics.routineDifficulty = form!.difficulty;
  if (mode !== 'quick' && status !== 'completed') metrics.stopReason = form!.stopReason;
  const payload: RoutinePayload = { id, user_id: owner, routine_id: routine.id, session_date: sessionDate, status, planned_minutes: routine.target_minutes,
    actual_minutes: minutes, memo: mode === 'quick' ? '빠른 완료 기록' : form!.memo, source: 'manual', metrics,
    started_at: active ? form!.startedAt : null, ended_at: active ? now : null, updated_at: now };
  assertRoutinePayload(payload, owner);
  return { mode, payload, input: form ? knownForm(form) : null };
}
export function parseRoutineDraft(raw: string | null, owner: string): RoutineDraft | null {
  if (raw === null) return null;
  if (raw.length > 65536) throw Error('routine_draft_invalid');
  const draft = JSON.parse(raw) as RoutineDraft;
  if (!object(draft) || draft.version !== 1 || draft.ownerId !== owner || !uuid(owner) || !uuid(draft.revision)
    || draft.resetMarker !== null && (typeof draft.resetMarker !== 'string' || draft.resetMarker.length > 200)
    || draft.lastConfirmed !== null && !uuid(draft.lastConfirmed)) throw Error('routine_draft_invalid');
  assertForm(draft.active); assertForm(draft.manual);
  if (draft.pending !== null) {
    const pending = draft.pending;
    if (!object(pending) || Object.keys(pending).sort().join(',') !== 'input,mode,payload' || !['active','manual','quick'].includes(pending.mode)) throw Error('routine_draft_invalid');
    assertRoutinePayload(pending.payload, owner);
    if (pending.payload.metrics.recordMode !== pending.mode) throw Error('routine_draft_invalid');
    if (pending.mode === 'quick') { if (pending.input !== null) throw Error('routine_draft_invalid'); }
    else {
      assertForm(pending.input);
      if (Object.keys(pending.input).length !== formFields.length) throw Error('routine_draft_invalid');
      const rebuilt = makeRoutineAttempt(owner, pending.mode, pending.input, { id: pending.payload.routine_id, user_id: owner, target_minutes: pending.payload.planned_minutes } as GrowthRoutineRow,
        pending.payload.id, pending.payload.session_date, pending.payload.updated_at);
      if (canonicalRoutineValue(rebuilt) !== canonicalRoutineValue(pending)) throw Error('routine_draft_invalid');
    }
  }
  return draft;
}
type Store = Pick<Storage, 'getItem' | 'setItem'>;
/** Terminal states remain UUID-revision tombstones. Never remove the key, including empty initial drafts. */
export function persistRoutineDraft(storage: Store, draft: RoutineDraft, expected: string | null): string {
  const key = routineDraftKey(draft.ownerId);
  if (storage.getItem(key) !== expected) throw Error('routine_draft_changed');
  const raw = JSON.stringify(draft); parseRoutineDraft(raw, draft.ownerId);
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw Error('routine_draft_changed');
  return raw;
}
export function completeRoutineAttempt(draft: RoutineDraft, attempt: RoutineAttempt): RoutineDraft {
  if (canonicalRoutineValue(draft.pending) !== canonicalRoutineValue(attempt)) throw Error('routine_draft_changed');
  const next = { ...draft, revision: crypto.randomUUID(), pending: null, lastConfirmed: attempt.payload.id };
  if (attempt.mode !== 'quick' && canonicalRoutineValue(knownForm(draft[attempt.mode])) === canonicalRoutineValue(attempt.input)) {
    next[attempt.mode] = { ...draft[attempt.mode], ...emptyRoutineForm(draft[attempt.mode].date) };
  }
  return next;
}
export function routineRowMatches(row: GrowthSessionRow, payload: RoutinePayload) {
  return payloadFields.every(key => {
    const a = row[key as keyof GrowthSessionRow], b = payload[key as keyof RoutinePayload];
    return ['started_at','ended_at','updated_at'].includes(key) && a !== null && b !== null
      ? typeof a === 'string' && typeof b === 'string' && !/[1-9]/.test((a.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? '').slice(3)) && Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b)
      : canonicalRoutineValue(a) === canonicalRoutineValue(b);
  });
}
export async function confirmRoutineSave(payload: RoutinePayload, boundary: {
  assertCurrent: () => Promise<void>; read: () => Promise<{ data: GrowthSessionRow | null; error: unknown }>; insert: () => Promise<void>;
}) {
  const read = async () => {
    await boundary.assertCurrent(); const result = await boundary.read(); await boundary.assertCurrent();
    if (result.error || result.data !== null && (!result.data || typeof result.data !== 'object' || Array.isArray(result.data))) throw Error('routine_save_unconfirmed');
    if (result.data && !routineRowMatches(result.data, payload)) throw Error('routine_save_conflict');
    return result.data;
  };
  // Always read first, even on the first request: uncertain GET never authorizes a write.
  const existing = await read(); if (existing) return existing;
  await boundary.assertCurrent();
  try { await boundary.insert(); } catch (error) {
    if (error instanceof Error && ['routine_reset_changed','routine_save_schema_unavailable','routine_owner_changed','routine_save_conflict','routine_routine_invalid','routine_invalid_payload'].includes(error.message)) throw error;
  }
  const row = await read(); if (!row) throw Error('routine_save_unconfirmed');
  return row;
}
