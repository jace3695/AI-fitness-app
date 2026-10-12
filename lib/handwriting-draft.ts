import { HANDWRITING_COURSE_ID, HANDWRITING_LESSONS, type HandwritingLesson } from '../app/data/handwritingCourse.ts';
import { HANDWRITING_PACKAGE_FORMAT, handwritingMaterialPath } from '../app/data/handwritingMaterials.ts';

export const HANDWRITING_MAX_PIXELS = 4_194_304;
export const HANDWRITING_MAX_CHECKPOINT_BYTES = 112 * 1024 * 1024;
export const HANDWRITING_MAX_PNG_BYTES = 10 * 1024 * 1024;
export type WorksheetIdentity = { path: string; version: string; sha256: string };
export type Raster = { width: number; height: number; pixels: Uint8ClampedArray; sha256: string };
export type UndoFrame = { raster: Raster; strokes: number; activeMs: number };
export type HandwritingSession = {
  id: string; user_id: string; routine_id: string; session_date: string; status: 'completed';
  planned_minutes: number; actual_minutes: number; memo: string; source: 'handwriting';
  metrics: Record<string, unknown>; started_at: null; ended_at: null; updated_at: string;
};
export type HandwritingResource = {
  id: string; user_id: string; routine_id: string; title: string; category: 'handwriting'; storage_path: string;
  mime_type: 'image/png'; size_bytes: number; classification: 'direct'; notes: string; created_at: string; updated_at: string;
};
export type FrozenHandwritingSave = { session: HandwritingSession; resource: HandwritingResource | null; png: Blob | null; pngSha256: string | null };
export type HandwritingDraft = {
  version: 1; owner: string; courseId: typeof HANDWRITING_COURSE_ID; revision: number; attemptId: string;
  state: 'active'; resetMarker: string | null; lesson: HandwritingLesson; mode: 'paper' | 'screen'; trace: boolean;
  checks: boolean[]; minutes: string; reflection: string; strokes: number; activeMs: number;
  worksheet: WorksheetIdentity | null; raster: Raster | null; undo: UndoFrame[]; pending: FrozenHandwritingSave | null;
};
export type HandwritingTombstone = Pick<HandwritingDraft, 'version' | 'owner' | 'courseId' | 'revision' | 'attemptId' | 'resetMarker'> & { state: 'confirmed' | 'discarded' | 'invalidated' };
export type HandwritingRecord = HandwritingDraft | HandwritingTombstone;
export const handwritingSlot = (owner: string) => `${owner}:${HANDWRITING_COURSE_ID}`;
export function canonical(value: unknown): string { return JSON.stringify(value, (_key, nested) => nested && typeof nested === 'object' && !Array.isArray(nested) ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b))) : nested); }
export async function hashBytes(value: Blob | Uint8ClampedArray | Uint8Array): Promise<string> {
  const bytes = value instanceof Blob ? await value.arrayBuffer() : new Uint8Array(value).buffer;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const bounded = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const invalid = () => { throw Error('handwriting_draft_invalid'); };
export function emptyHandwritingDraft(owner: string, resetMarker: string | null, lesson = HANDWRITING_LESSONS[0]): HandwritingDraft {
  return { version: 1, owner, courseId: HANDWRITING_COURSE_ID, revision: 0, attemptId: crypto.randomUUID(), state: 'active', resetMarker,
    lesson: structuredClone(lesson), mode: 'paper', trace: true, checks: [false, false], minutes: '', reflection: '', strokes: 0, activeMs: 0, worksheet: null, raster: null, undo: [], pending: null };
}
export function terminalHandwritingRecord(draft: HandwritingRecord, state: HandwritingTombstone['state']): HandwritingTombstone {
  const { version, owner, courseId, revision, attemptId, resetMarker } = draft;
  return { version, owner, courseId, revision, attemptId, resetMarker, state };
}
export async function freezeRaster(width: number, height: number, pixels: Uint8ClampedArray): Promise<Raster> {
  if (!bounded(width, 1, 4096) || !bounded(height, 1, 4096) || width * height > HANDWRITING_MAX_PIXELS || pixels.length !== width * height * 4) throw Error('handwriting_checkpoint_oversize');
  const copy = new Uint8ClampedArray(pixels);
  return { width, height, pixels: copy, sha256: await hashBytes(copy) };
}
export function makeHandwritingSave(draft: HandwritingDraft, routineId: string, date: string, timestamp: string, id: string, resourceId: string | null, png: Blob | null, pngSha256: string | null): FrozenHandwritingSave {
  if (!draft.worksheet || !draft.checks.every(Boolean) || !uuid(routineId) || !uuid(id) || draft.pending) invalid();
  const minutes = Number(draft.minutes), activeSeconds = Math.round(draft.activeMs / 1000);
  if (draft.mode === 'paper' ? !bounded(minutes, 1, 240) : !draft.raster || !draft.strokes || !png || !hash(pngSha256) || !uuid(resourceId) || png.type !== 'image/png' || png.size < 1 || png.size > HANDWRITING_MAX_PNG_BYTES) invalid();
  const memo = `${draft.lesson.number}강 ${draft.lesson.title}${draft.reflection.trim() ? ` · ${draft.reflection.trim()}` : ''}`.slice(0, 500);
  const session: HandwritingSession = { id, user_id: draft.owner, routine_id: routineId, session_date: date, status: 'completed', planned_minutes: 15,
    actual_minutes: draft.mode === 'paper' ? minutes : Math.min(1440, Math.round(activeSeconds / 60)), memo, source: 'handwriting', started_at: null, ended_at: null, updated_at: timestamp,
    metrics: { courseId: HANDWRITING_COURSE_ID, lessonId: draft.lesson.id, lessonCompleted: true, pdfPage: draft.lesson.pdfPage, mode: draft.mode,
      practiceMode: draft.mode === 'paper' ? 'paper' : draft.trace ? 'trace' : 'copy', selfChecks: [...draft.checks], lessonSnapshot: structuredClone(draft.lesson), worksheet: { ...draft.worksheet },
      ...(draft.mode === 'screen' ? { resourceId, strokes: draft.strokes, activeSeconds, pngSha256 } : { timeSource: 'self-reported' }) } };
  const resource: HandwritingResource | null = draft.mode === 'screen' ? { id: resourceId!, user_id: draft.owner, routine_id: routineId,
    title: `필림 손글씨 ${draft.lesson.number}강 ${draft.lesson.title}`, category: 'handwriting', storage_path: `${draft.owner}/${date}/handwriting-${resourceId}.png`, mime_type: 'image/png', size_bytes: png!.size, classification: 'direct', notes: memo, created_at: timestamp, updated_at: timestamp } : null;
  return { session, resource, png: resource ? png : null, pngSha256: resource ? pngSha256 : null };
}
/** Unknown schemas, corruption and oversize records are preserved by the caller. */
export async function parseHandwritingRecord(value: unknown, owner: string): Promise<HandwritingRecord | null> {
  if (value === undefined || value === null) return null;
  const d = value as HandwritingDraft;
  if (!d || d.version !== 1 || d.owner !== owner || !uuid(owner) || d.courseId !== HANDWRITING_COURSE_ID || !uuid(d.attemptId) || !bounded(d.revision, 0, Number.MAX_SAFE_INTEGER)
    || d.resetMarker !== null && (typeof d.resetMarker !== 'string' || d.resetMarker.length > 200)) invalid();
  if (['confirmed', 'discarded', 'invalidated'].includes(d.state)) {
    if (canonical(value) !== canonical(terminalHandwritingRecord(d, d.state as HandwritingTombstone['state']))) invalid();
    return d as unknown as HandwritingTombstone;
  }
  const lesson = d.lesson;
  if (d.state !== 'active' || !lesson || !bounded(lesson.pdfPage, 2, 54) || lesson.id !== `film-p${lesson.pdfPage}` || lesson.number !== lesson.pdfPage - 1
    || !['stage', 'title', 'goal'].every(key => typeof lesson[key as keyof HandwritingLesson] === 'string' && String(lesson[key as keyof HandwritingLesson]).length > 0 && String(lesson[key as keyof HandwritingLesson]).length <= 300)
    || !Array.isArray(lesson.steps) || lesson.steps.length !== 3 || !lesson.steps.every(v => typeof v === 'string' && v.length > 0 && v.length <= 300)
    || !Array.isArray(lesson.checks) || lesson.checks.length !== 2 || !lesson.checks.every(v => typeof v === 'string' && v.length > 0 && v.length <= 300)
    || !['paper', 'screen'].includes(d.mode) || typeof d.trace !== 'boolean' || !Array.isArray(d.checks) || d.checks.length !== 2 || !d.checks.every(v => typeof v === 'boolean')
    || typeof d.minutes !== 'string' || d.minutes.length > 20 || typeof d.reflection !== 'string' || d.reflection.length > 200
    || !bounded(d.strokes, 0, 1_000_000) || !Number.isFinite(d.activeMs) || d.activeMs < 0 || d.activeMs > 86_400_000 || !Array.isArray(d.undo) || d.undo.length > 5) invalid();
  if (d.worksheet && (d.worksheet.version !== HANDWRITING_PACKAGE_FORMAT || d.worksheet.path !== handwritingMaterialPath(owner, `page-${String(lesson.pdfPage).padStart(2, '0')}.webp`) || !hash(d.worksheet.sha256))) invalid();
  let size = 0;
  const verifyRaster = async (r: Raster) => {
    if (!r || !bounded(r.width, 1, 4096) || !bounded(r.height, 1, 4096) || r.width * r.height > HANDWRITING_MAX_PIXELS || !(r.pixels instanceof Uint8ClampedArray) || r.pixels.length !== r.width * r.height * 4 || !hash(r.sha256)) invalid();
    size += r.pixels.byteLength;
    if (size > HANDWRITING_MAX_CHECKPOINT_BYTES) throw Error('handwriting_checkpoint_oversize');
    if (await hashBytes(r.pixels) !== r.sha256) invalid();
  };
  if (d.raster) await verifyRaster(d.raster);
  if (d.strokes && (!d.raster || !d.worksheet)) invalid();
  for (const frame of d.undo) {
    if (!d.raster || !bounded(frame.strokes, 0, d.strokes) || !Number.isFinite(frame.activeMs) || frame.activeMs < 0 || frame.activeMs > d.activeMs || frame.raster.width !== d.raster.width || frame.raster.height !== d.raster.height) invalid();
    await verifyRaster(frame.raster);
  }
  if (d.pending) {
    const p = d.pending, s = p.session;
    if (!s || !uuid(s.id) || !uuid(s.routine_id) || typeof s.updated_at !== 'string' || !Number.isFinite(Date.parse(s.updated_at)) || !/^\d{4}-\d{2}-\d{2}$/.test(s.session_date)
      || !Number.isFinite(Date.parse(`${s.session_date}T12:00:00Z`)) || new Date(`${s.session_date}T12:00:00Z`).toISOString().slice(0, 10) !== s.session_date) invalid();
    if (p.png) { if (!(p.png instanceof Blob) || p.png.size > HANDWRITING_MAX_PNG_BYTES || await hashBytes(p.png) !== p.pngSha256) invalid(); size += p.png.size; }
    const expected = makeHandwritingSave({ ...d, pending: null }, s.routine_id, s.session_date, s.updated_at, s.id, p.resource?.id ?? null, p.png, p.pngSha256);
    if (canonical({ ...p, png: null }) !== canonical({ ...expected, png: null })) invalid();
  }
  if (size > HANDWRITING_MAX_CHECKPOINT_BYTES) throw Error('handwriting_checkpoint_oversize');
  return d;
}
export function handwritingRowMatches(expected: Record<string, unknown>, row: unknown): boolean {
  if (!row || typeof row !== 'object') return false;
  const actual = row as Record<string, unknown>;
  return Object.entries(expected).every(([key, value]) => {
    if (['updated_at', 'created_at'].includes(key)) {
      if (typeof actual[key] !== 'string') return false;
      const fraction = (actual[key] as string).match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? '';
      return !/[1-9]/.test(fraction.slice(3)) && Date.parse(actual[key] as string) === Date.parse(value as string);
    }
    return canonical(actual[key]) === canonical(value);
  });
}

/** Hash-validated frame/Blob contents can be compared without serializing every pixel. */
export function handwritingRecordSignature(record: HandwritingRecord): string {
  if (record.state !== 'active') return canonical(record);
  const raster = (value: Raster | null) => value ? { width: value.width, height: value.height, sha256: value.sha256 } : null;
  return canonical({ ...record, raster: raster(record.raster), undo: record.undo.map(frame => ({ ...frame, raster: raster(frame.raster) })), pending: record.pending ? { ...record.pending, png: record.pending.png ? { type: record.pending.png.type, size: record.pending.png.size } : null } : null });
}
