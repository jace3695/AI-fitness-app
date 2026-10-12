import { HANDWRITING_COURSE_ID } from '../app/data/handwritingCourse.ts';

/** Read-only metadata model. A candidate is not proof that its image exists. */
export const COMPARISON_MAX_PNG_BYTES = 10 * 1024 * 1024;
export type ComparisonAttempt = {
  id: string; owner: string; date: string; savedAt: string | null;
  kind: 'course' | 'free'; mode: 'paper' | 'trace' | 'copy' | 'free';
  resourceId: string | null; expectedHash: string | null; legacy: boolean;
  lessonId: string | null; courseId: string | null; lessonTitle: string | null;
  guideText: string | null; worksheet: { version: string; sha256: string } | null;
  checks: { label: string | null; checked: boolean }[];
  metrics: { strokes: number | null; activeSeconds: number | null; occupiedWidth: number | null; occupiedHeight: number | null; pressureRange: [number, number] | null };
  fingerprint: string;
};
export type ComparisonAttemptResult = {
  status: 'candidate' | 'no_saved_image' | 'unlinked_or_unsupported';
  attempt: ComparisonAttempt | null; reason: string;
};
export type ComparisonResource = { id: string; path: string; size: number; pathDate: string; fingerprint: string };
export type ComparisonDimensions = { width: number; height: number };

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value: ObjectValue, key: string) => Object.hasOwn(value, key);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const optionalNumber = (value: unknown, max: number) => value === undefined || value === null || integer(value, 0, max);
const knownShape = (value: ObjectValue, required: string[], allowed = required) => required.every(key => own(value, key)) && Object.keys(value).every(key => allowed.includes(key));
const absent = (value: unknown) => value === undefined || value === null;
const recordDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) === '0000') return false;
  const instant = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value;
};
function savedTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value) || !recordDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

/** Stable JSON identity for relevant metadata, never a cryptographic receipt. */
export function comparisonCanonical(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => object(nested) ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : nested) ?? 'null';
}
const unsupported = (reason: string): ComparisonAttemptResult => ({ status: 'unlinked_or_unsupported', attempt: null, reason });
const emptyMetrics = (): ComparisonAttempt['metrics'] => ({ strokes: null, activeSeconds: null, occupiedWidth: null, occupiedHeight: null, pressureRange: null });
const courseKeys = ['courseId', 'lessonId', 'lessonCompleted', 'pdfPage', 'mode', 'practiceMode', 'selfChecks'];
const freeMeasurements = ['strokes', 'activeSeconds', 'occupiedWidth', 'occupiedHeight', 'pressureRange'];
function pressure(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(part => typeof part === 'number' && Number.isFinite(part)) && value[0] > 0 && value[0] < value[1] && value[1] <= 1;
}
function validSnapshot(value: unknown, page: number, lessonId: string): value is ObjectValue & { title: string; checks: string[] } {
  return object(value) && knownShape(value, ['id', 'number', 'pdfPage', 'stage', 'title', 'goal', 'steps', 'checks'])
    && value.id === lessonId && value.pdfPage === page && value.number === page - 1
    && ['stage', 'title', 'goal'].every(key => text(value[key], 500))
    && Array.isArray(value.steps) && value.steps.length >= 1 && value.steps.length <= 12 && value.steps.every(step => text(step, 500))
    && Array.isArray(value.checks) && value.checks.length === 2 && value.checks.every(check => text(check, 500));
}

/** Only the four observed save contracts are recognized; unknown schemas stay unavailable. */
export function parseComparisonAttempt(row: unknown, owner: string): ComparisonAttemptResult {
  if (!uuid(owner) || !object(row) || !uuid(row.id) || row.user_id !== owner || row.source !== 'handwriting' || row.status !== 'completed') return unsupported('완료된 본인 손글씨 기록으로 확인되지 않아요.');
  if (!recordDate(row.session_date)) return unsupported('기록 날짜를 확인할 수 없어요.');
  const m = row.metrics;
  if (!object(m)) return unsupported('지원하는 손글씨 기록 형식이 아니에요.');
  const base: ComparisonAttempt = {
    id: row.id, owner, date: row.session_date, savedAt: savedTimestamp(row.created_at),
    kind: 'course', mode: 'paper', resourceId: null, expectedHash: null, legacy: false,
    lessonId: null, courseId: null, lessonTitle: null, guideText: null, worksheet: null,
    checks: [], metrics: emptyMetrics(), fingerprint: '',
  };
  // Modern fields select the modern adapter even when their values are null/broken.
  // They must never be stripped to make a corrupt modern row look like legacy.
  if (own(m, 'practiceKind')) {
    if (m.practiceKind !== 'free-handwriting-v1') return unsupported('이 자유 연습 기록의 버전은 지원하지 않아요.');
    if (!knownShape(m, ['practiceKind', 'resourceId', 'guideText', ...freeMeasurements, 'pngSha256']) || !hash(m.pngSha256)) return unsupported('저장 당시 이미지 해시나 자유 연습 정보가 올바르지 않아요.');
    base.kind = 'free'; base.mode = 'free'; base.expectedHash = m.pngSha256;
  } else if (own(m, 'courseId')) {
    const modern = ['lessonSnapshot', 'worksheet', 'pngSha256'].some(key => own(m, key));
    const paper = m.mode === 'paper';
    const allowed = [...courseKeys, ...(modern ? ['lessonSnapshot', 'worksheet'] : []), ...(paper ? ['timeSource'] : ['resourceId', 'strokes', 'activeSeconds', ...(modern ? ['pngSha256'] : [])])];
    const required = modern ? allowed : [...courseKeys, ...(paper ? ['timeSource'] : [])];
    if (!knownShape(m, required, allowed) || m.courseId !== HANDWRITING_COURSE_ID || m.lessonCompleted !== true || !integer(m.pdfPage, 2, 54) || m.lessonId !== `film-p${m.pdfPage}`
      || (paper ? m.practiceMode !== 'paper' || m.timeSource !== 'self-reported' : m.mode !== 'screen' || !['trace', 'copy'].includes(String(m.practiceMode)))
      || !Array.isArray(m.selfChecks) || m.selfChecks.length !== 2 || !m.selfChecks.every(check => typeof check === 'boolean') || modern && !m.selfChecks.every(check => check === true)) return unsupported('수업·연습 방법의 연결을 확인할 수 없어요.');
    base.kind = 'course'; base.mode = paper ? 'paper' : m.practiceMode as 'trace' | 'copy'; base.legacy = !modern;
    base.courseId = m.courseId; base.lessonId = m.lessonId as string;
    if (modern) {
      if (!validSnapshot(m.lessonSnapshot, m.pdfPage, base.lessonId) || !object(m.worksheet) || !knownShape(m.worksheet, ['path', 'version', 'sha256'])
        || m.worksheet.path !== `${owner}/learning/film-v1/page-${String(m.pdfPage).padStart(2, '0')}.webp` || !text(m.worksheet.version, 100) || !hash(m.worksheet.sha256)
        || !paper && !hash(m.pngSha256)) return unsupported('저장 당시 수업·연습지·이미지 해시를 확인할 수 없어요.');
      base.lessonTitle = m.lessonSnapshot.title;
      base.worksheet = { version: m.worksheet.version, sha256: m.worksheet.sha256 };
      base.checks = m.selfChecks.map((checked, index) => ({ checked, label: (m.lessonSnapshot as { checks: string[] }).checks[index] }));
      base.expectedHash = paper ? null : m.pngSha256 as string;
    } else base.checks = m.selfChecks.map(checked => ({ checked, label: null }));
    if (!paper) {
      if (modern ? !integer(m.strokes, 1, 1_000_000) || !integer(m.activeSeconds, 0, 86_400) : !optionalNumber(m.strokes, 1_000_000) || !optionalNumber(m.activeSeconds, 86_400)) return unsupported('저장된 획·접촉 시간의 형식을 확인할 수 없어요.');
      base.metrics.strokes = absent(m.strokes) ? null : m.strokes as number;
      base.metrics.activeSeconds = absent(m.activeSeconds) ? null : m.activeSeconds as number;
    }
  } else {
    // The pre-versioned free writer always included guide and free-only bounds/
    // pressure keys. A generic resourceId or guide alone is not this contract.
    if (!knownShape(m, ['guideText', 'occupiedWidth', 'occupiedHeight', 'pressureRange'], ['resourceId', 'guideText', ...freeMeasurements])) return unsupported('연습 기록과 이미지의 연결 형식이 지원되지 않아요.');
    base.kind = 'free'; base.mode = 'free'; base.legacy = true;
  }
  if (base.kind === 'free') {
    const modern = !base.legacy;
    if (!text(m.guideText, 300) || (modern ? !integer(m.strokes, 1, 1_000_000) || !integer(m.activeSeconds, 0, 86_400) || !integer(m.occupiedWidth, 0, 100) || !integer(m.occupiedHeight, 0, 100)
      : !optionalNumber(m.strokes, 1_000_000) || !optionalNumber(m.activeSeconds, 86_400) || !optionalNumber(m.occupiedWidth, 100) || !optionalNumber(m.occupiedHeight, 100))
      || !absent(m.pressureRange) && !pressure(m.pressureRange) || modern && m.pressureRange === undefined) return unsupported('저장된 자유 연습 문장이나 측정값의 형식을 확인할 수 없어요.');
    base.guideText = m.guideText;
    base.metrics = {
      strokes: absent(m.strokes) ? null : m.strokes as number, activeSeconds: absent(m.activeSeconds) ? null : m.activeSeconds as number,
      occupiedWidth: absent(m.occupiedWidth) ? null : m.occupiedWidth as number, occupiedHeight: absent(m.occupiedHeight) ? null : m.occupiedHeight as number,
      pressureRange: pressure(m.pressureRange) ? [...m.pressureRange] : null,
    };
  }
  if (base.mode !== 'paper') {
    if (!absent(m.resourceId) && !uuid(m.resourceId)) return unsupported('연결된 이미지 식별자가 올바르지 않아요.');
    base.resourceId = uuid(m.resourceId) ? m.resourceId : null;
  }
  // Keep full saved context in the fingerprint, including snapshot text not
  // projected for the pane. Mutable routine/title/classification are irrelevant.
  base.fingerprint = comparisonCanonical({ id: row.id, owner, date: row.session_date, createdAt: base.savedAt, source: row.source, status: row.status, metrics: m });
  if (base.mode === 'paper') return { status: 'no_saved_image', attempt: base, reason: '종이·다른 앱 연습 완료 기록이에요. 저장된 손글씨 이미지는 없어요.' };
  if (!base.resourceId) return { status: 'unlinked_or_unsupported', attempt: base, reason: '저장 이미지와 연결된 식별자가 없어요.' };
  return { status: 'candidate', attempt: base, reason: base.legacy ? '저장 당시 원본 해시 없음 · 원본 무결성 미확인' : '이미지를 불러온 뒤 저장 당시 해시와 대조해요.' };
}

/** Join only by the explicit resource id and owner; never infer from filenames. */
export function validateComparisonResource(row: unknown, attempt: ComparisonAttempt): ComparisonResource | null {
  if (!object(row) || !uuid(attempt.owner) || !uuid(attempt.resourceId) || attempt.mode === 'paper' || row.id !== attempt.resourceId || row.user_id !== attempt.owner
    || row.mime_type !== 'image/png' || !integer(row.size_bytes, 1, COMPARISON_MAX_PNG_BYTES) || typeof row.storage_path !== 'string') return null;
  const parts = row.storage_path.split('/');
  const prefix = attempt.kind === 'free' && !attempt.legacy ? 'free-handwriting-' : 'handwriting-';
  if (parts.length !== 3 || parts[0] !== attempt.owner || !recordDate(parts[1]) || parts[2] !== `${prefix}${attempt.resourceId}.png`) return null;
  const value = { id: attempt.resourceId, path: row.storage_path, size: row.size_bytes, pathDate: parts[1] };
  return { ...value, fingerprint: comparisonCanonical({ ...value, owner: attempt.owner, mime: row.mime_type }) };
}

export function canPairAttempts(a: ComparisonAttempt, b: ComparisonAttempt): boolean {
  return a.owner === b.owner && a.id !== b.id && a.mode !== 'paper' && b.mode !== 'paper' && a.resourceId !== null && b.resourceId !== null && a.resourceId !== b.resourceId;
}

/** Describe observed conditions only, never compute improvement or a score. */
export function comparisonPairNotes(a: ComparisonAttempt, b: ComparisonAttempt, dimensionsA?: ComparisonDimensions, dimensionsB?: ComparisonDimensions): string[] {
  const notes: string[] = [];
  if (a.kind !== b.kind) notes.push('수업 연습과 자유 연습으로 종류가 달라요.');
  if (a.mode !== b.mode) notes.push('연습 방법이 달라요. 따라 쓰기·직접 쓰기·자유 연습은 같은 조건이 아니에요.');
  if (a.kind === 'course' && b.kind === 'course') {
    notes.push(a.courseId === b.courseId && a.lessonId === b.lessonId ? '기록된 수업 식별자가 같아요.' : '기록된 수업 식별자가 달라요.');
    notes.push(!a.worksheet || !b.worksheet ? '저장 당시 연습지 식별 정보가 없어 같은 연습지인지 확인할 수 없어요.'
      : a.worksheet.version === b.worksheet.version && a.worksheet.sha256 === b.worksheet.sha256 ? '저장된 연습지 버전과 해시가 같아요.' : '저장된 연습지 버전 또는 해시가 달라요.');
    if (a.legacy || b.legacy) notes.push('이전 기록에는 저장 당시 수업 이름·점검 문구가 없어요. 현재 수업 이름은 참고용이에요.');
  }
  if (a.kind === 'free' && b.kind === 'free') notes.push(a.guideText === b.guideText ? '선택한 안내 문장이 같아요. 실제로 쓴 내용을 확인한 것은 아니에요.' : '선택한 안내 문장이 달라요.');
  notes.push(!dimensionsA || !dimensionsB ? '두 이미지의 원본 픽셀 크기는 불러온 뒤 확인해요.'
    : dimensionsA.width === dimensionsB.width && dimensionsA.height === dimensionsB.height ? '원본 이미지의 픽셀 크기가 같아요. 같은 표시 크기가 같은 실제 글씨 크기를 뜻하지는 않아요.' : '원본 이미지의 픽셀 크기가 달라요. 같은 표시 크기가 같은 실제 글씨 크기를 뜻하지는 않아요.');
  if (a.date === b.date) notes.push('같은 기록 날짜예요. 저장 시각은 실제 연습 시작 시각이 아니에요.');
  notes.push('기기·펜·실제 크기는 저장되어 있지 않아 같은 연습 조건이나 글씨 향상을 판정할 수 없어요.');
  return notes;
}

/** Bounded PNG header preflight only. The reader must still decode the original
 * bytes successfully and compare a stored hash before publishing an image. */
export function inspectComparisonPng(bytes: Uint8Array, kind: 'course' | 'free'): ComparisonDimensions {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 33 || bytes.byteLength > COMPARISON_MAX_PNG_BYTES) throw Error('comparison_png_size');
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => bytes[index] === byte)) throw Error('comparison_png_signature');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) throw Error('comparison_png_header');
  const width = view.getUint32(16), height = view.getUint32(20), depth = bytes[24], color = bytes[25];
  const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
  if (!depths[color]?.includes(depth) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] > 1) throw Error('comparison_png_header');
  if (!width || !height || (kind === 'free' ? width > 1200 || height > 744 : width > 4096 || height > 4096 || width * height > 4_194_304)) throw Error('comparison_png_dimensions');
  return { width, height };
}
