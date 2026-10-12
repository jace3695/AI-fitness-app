import { emptyHandwritingEvidence, handwritingMetrics, type HandwritingEvidence } from '../app/data/practiceEvidence.ts';
import { canonical, freezeRaster, hashBytes, type Raster, type HandwritingResource, type HandwritingSession } from './handwriting-draft.ts';

export { canonical, freezeRaster, hashBytes };
export const FREE_HANDWRITING_KIND = 'free-handwriting-v1';
export const FREE_GUIDES = ['오늘도 차분하게 한 걸음', '작은 습관이 큰 변화를 만든다', '정확하게 쓰고 천천히 돌아본다'];
export const FREE_MAX_BYTES = 80 * 1024 * 1024;
export const FREE_MAX_PNG_BYTES = 10 * 1024 * 1024;
export type FreeFrame = { raster: Raster; evidence: HandwritingEvidence };
export type FreeSave = { session: HandwritingSession; resource: HandwritingResource; png: Uint8Array; pngSha256: string };
export type FreeDraft = {
  version: 1; kind: typeof FREE_HANDWRITING_KIND; owner: string; attemptId: string; revision: number;
  state: 'active'; resetMarker: string | null; guideIndex: number; guideText: string; inkColor: string;
  frames: FreeFrame[]; historyIndex: number; pending: FreeSave | null;
};
export type FreeTerminal = Pick<FreeDraft, 'version' | 'kind' | 'owner' | 'attemptId' | 'revision' | 'resetMarker'> & { state: 'confirmed' | 'discarded' };
export type FreeRecord = FreeDraft | FreeTerminal;
export const freeVersion = (record: FreeRecord | null) => record;
export const freeSlot = (owner: string) => `${owner}:${FREE_HANDWRITING_KIND}`;
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const integer = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const invalid = (): never => { throw Error('free_handwriting_draft_invalid'); };
function exact(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) invalid();
}
export function emptyFreeDraft(owner: string, resetMarker: string | null): FreeDraft {
  return { version: 1, kind: FREE_HANDWRITING_KIND, owner, attemptId: crypto.randomUUID(), revision: 0, state: 'active', resetMarker,
    guideIndex: 0, guideText: FREE_GUIDES[0], inkColor: '#242231', frames: [], historyIndex: -1, pending: null };
}
export function terminalFreeRecord(record: FreeRecord, state: FreeTerminal['state']): FreeTerminal {
  return { version: record.version, kind: record.kind, owner: record.owner, attemptId: record.attemptId, revision: record.revision, resetMarker: record.resetMarker, state };
}
export function freeEvidence(draft: FreeDraft): HandwritingEvidence { return draft.frames[draft.historyIndex]?.evidence ?? emptyHandwritingEvidence(); }
export function makeFreeSave(draft: FreeDraft, routineId: string, plannedMinutes: number, date: string, timestamp: string, id: string, resourceId: string, png: Uint8Array, pngSha256: string): FreeSave {
  const evidence = freeEvidence(draft), metrics = handwritingMetrics(evidence);
  if (draft.pending || !uuid(routineId) || !uuid(id) || !uuid(resourceId) || !integer(plannedMinutes, 0, 240) || !metrics.strokes || !(png instanceof Uint8Array) || png.byteLength < 1 || png.byteLength > FREE_MAX_PNG_BYTES || !hash(pngSha256)) invalid();
  const session: HandwritingSession = { id, user_id: draft.owner, routine_id: routineId, session_date: date, status: 'completed', planned_minutes: plannedMinutes,
    actual_minutes: Math.round(metrics.activeSeconds / 60), memo: draft.guideText, source: 'handwriting', started_at: null, ended_at: null, updated_at: timestamp,
    metrics: { practiceKind: FREE_HANDWRITING_KIND, resourceId, guideText: draft.guideText, ...metrics, pngSha256 } };
  const resource: HandwritingResource = { id: resourceId, user_id: draft.owner, routine_id: routineId, title: `손글씨 연습 ${date}`, category: 'handwriting',
    storage_path: `${draft.owner}/${date}/free-handwriting-${resourceId}.png`, mime_type: 'image/png', size_bytes: png.byteLength, classification: 'direct', notes: draft.guideText, created_at: timestamp, updated_at: timestamp };
  return { session, resource, png, pngSha256 };
}
function validateEvidence(e: HandwritingEvidence) {
  exact(e, ['strokes','activeMs','minX','minY','maxX','maxY','penMin','penMax']);
  if (!integer(e.strokes, 0, 1_000_000) || !Number.isFinite(e.activeMs) || e.activeMs < 0 || e.activeMs > 86_400_000) invalid();
  for (const key of ['minX','minY','maxX','maxY','penMin','penMax'] as const) if (e[key] !== null && (!Number.isFinite(e[key]) || e[key]! < 0 || e[key]! > 1)) invalid();
  if ((e.minX === null) !== (e.maxX === null) || (e.minY === null) !== (e.maxY === null) || (e.minX === null) !== (e.minY === null) || (e.penMin === null) !== (e.penMax === null)
    || e.minX !== null && e.minX > e.maxX! || e.minY !== null && e.minY > e.maxY! || e.penMin !== null && (e.penMin <= 0 || e.penMin > e.penMax!)
    || e.strokes === 0 && canonical(e) !== canonical(emptyHandwritingEvidence()) || e.strokes > 0 && e.minX === null) invalid();
}
/** Fail closed without normalizing or deleting unsupported fields/schemas. */
export async function parseFreeRecord(value: unknown, owner: string): Promise<FreeRecord | null> {
  if (value === undefined || value === null) return null;
  const d = value as FreeDraft;
  const common = ['version','kind','owner','attemptId','revision','state','resetMarker'];
  if (!d || d.version !== 1 || d.kind !== FREE_HANDWRITING_KIND || !uuid(owner) || d.owner !== owner || !uuid(d.attemptId) || !integer(d.revision, 0, Number.MAX_SAFE_INTEGER) || d.resetMarker !== null && (typeof d.resetMarker !== 'string' || d.resetMarker.length > 200)) invalid();
  if (['confirmed', 'discarded'].includes(d.state)) { exact(d, common); return d as unknown as FreeTerminal; }
  exact(d, [...common,'guideIndex','guideText','inkColor','frames','historyIndex','pending']);
  if (d.state !== 'active' || !integer(d.guideIndex, 0, 10000) || typeof d.guideText !== 'string' || !d.guideText.length || d.guideText.length > 300 || !/^#[0-9a-fA-F]{6}$/.test(d.inkColor)
    || !Array.isArray(d.frames) || d.frames.length > 20 || !integer(d.historyIndex, -1, d.frames.length - 1) || (d.frames.length === 0) !== (d.historyIndex === -1)) invalid();
  let size = 0, width = 0, height = 0;
  for (const frame of d.frames) {
    exact(frame, ['raster','evidence']); exact(frame.raster, ['width','height','pixels','sha256']); validateEvidence(frame.evidence);
    const r = frame.raster;
    if (!integer(r.width, 1, 1200) || !integer(r.height, 1, 744) || !(r.pixels instanceof Uint8ClampedArray) || r.pixels.length !== r.width * r.height * 4 || !hash(r.sha256) || width && (r.width !== width || r.height !== height)) invalid();
    width = r.width; height = r.height; size += r.pixels.byteLength;
    if (size > FREE_MAX_BYTES) throw Error('free_handwriting_checkpoint_oversize');
    if (await hashBytes(r.pixels) !== r.sha256) invalid();
  }
  if (d.pending) {
    exact(d.pending, ['session','resource','png','pngSha256']);
    const p = d.pending, s = p.session;
    if (!s || !p.resource || typeof s.updated_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s.updated_at) || !Number.isFinite(Date.parse(s.updated_at)) || new Date(s.updated_at).toISOString() !== s.updated_at
      || typeof s.session_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.session_date) || !Number.isFinite(Date.parse(`${s.session_date}T12:00:00Z`)) || new Date(`${s.session_date}T12:00:00Z`).toISOString().slice(0,10) !== s.session_date) invalid();
    const expected = makeFreeSave({ ...d, pending: null }, s.routine_id, s.planned_minutes, s.session_date, s.updated_at, s.id, p.resource.id, p.png, p.pngSha256);
    if (canonical({ ...p, png: null }) !== canonical({ ...expected, png: null }) || await hashBytes(p.png) !== p.pngSha256) invalid();
    size += p.png.byteLength;
  }
  if (size > FREE_MAX_BYTES) throw Error('free_handwriting_checkpoint_oversize');
  return d;
}
/** Synchronous exact byte/field CAS, including every PNG byte. */
export function freeRecordEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) return a?.constructor === b?.constructor && (a instanceof Uint8Array || a instanceof Uint8ClampedArray) && (b instanceof Uint8Array || b instanceof Uint8ClampedArray) && a.length === b.length && a.every((byte, i) => byte === b[i]);
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>, keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every(key => Object.hasOwn(y, key) && freeRecordEqual(x[key], y[key]));
}
