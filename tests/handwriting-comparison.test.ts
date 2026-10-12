import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canPairAttempts, comparisonCanonical, comparisonPairNotes, COMPARISON_MAX_PNG_BYTES, inspectComparisonPng, parseComparisonAttempt, validateComparisonResource, type ComparisonAttempt } from '../lib/handwriting-comparison.ts';

// Synthetic metadata only. No private account, image, worksheet or Storage call.
const owner = '00000000-0000-4000-8000-000000000901';
const other = '00000000-0000-4000-8000-000000000902';
const sessionId = '00000000-0000-4000-8000-000000000903';
const resourceId = '00000000-0000-4000-8000-000000000904';
const date = '2026-10-09';
const stamp = '2026-10-09T12:00:00.123456+00:00';
const sha = 'a'.repeat(64);
type Row = Record<string, unknown> & { metrics: Record<string, unknown> };
const lesson = (page = 2) => ({ id: `film-p${page}`, number: page - 1, pdfPage: page, stage: '합성 단계', title: '저장 당시 합성 제목', goal: '합성 목표', steps: ['단계 1', '단계 2', '단계 3'], checks: ['저장 당시 점검 1', '저장 당시 점검 2'] });
function course(mode: 'trace' | 'copy' | 'paper' = 'trace', modern = true, page = 2): Row {
  return { id: sessionId, user_id: owner, source: 'handwriting', status: 'completed', session_date: date, created_at: stamp, updated_at: '2026-10-10T00:00:00Z', routine_id: null,
    metrics: { courseId: 'film-handwriting-v1', lessonId: `film-p${page}`, pdfPage: page, lessonCompleted: true, mode: mode === 'paper' ? 'paper' : 'screen', practiceMode: mode, selfChecks: [true, true],
      ...(modern ? { lessonSnapshot: lesson(page), worksheet: { path: `${owner}/learning/film-v1/page-${String(page).padStart(2, '0')}.webp`, version: 'yeoni-private-handwriting-v1', sha256: 'b'.repeat(64) } } : {}),
      ...(mode === 'paper' ? { timeSource: 'self-reported' } : { resourceId, strokes: 12, activeSeconds: 0, ...(modern ? { pngSha256: sha } : {}) }) } };
}
function free(modern = true): Row {
  return { id: sessionId, user_id: owner, source: 'handwriting', status: 'completed', session_date: date, created_at: stamp,
    metrics: { ...(modern ? { practiceKind: 'free-handwriting-v1', pngSha256: sha } : {}), resourceId, guideText: '합성 안내 문장', strokes: 2, activeSeconds: 1, occupiedWidth: 30, occupiedHeight: 0, pressureRange: [0.15, 0.85] } };
}
function candidate(row: Row): ComparisonAttempt {
  const result = parseComparisonAttempt(row, owner);
  assert.equal(result.status, 'candidate', result.reason);
  assert.ok(result.attempt);
  return result.attempt;
}
function resource(attempt = candidate(course())) {
  return { id: attempt.resourceId, user_id: owner, storage_path: `${owner}/${date}/${attempt.kind === 'free' && !attempt.legacy ? 'free-handwriting-' : 'handwriting-'}${attempt.resourceId}.png`, mime_type: 'image/png', size_bytes: 68 };
}
function rejects(row: unknown) {
  const result = parseComparisonAttempt(row, owner);
  assert.equal(result.status, 'unlinked_or_unsupported');
  assert.equal(result.attempt, null);
}
function pngHeader(width: number, height: number) {
  // IHDR-only fixture exercises preflight, not successful image decoding.
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height); bytes[24] = 8; bytes[25] = 6;
  return bytes;
}

test('current course trace/copy retain saved wording, worksheet identity, hash and source-specific metrics', () => {
  for (const mode of ['trace', 'copy'] as const) {
    const row = course(mode), result = candidate(row);
    assert.equal(result.kind, 'course'); assert.equal(result.mode, mode); assert.equal(result.legacy, false);
    assert.equal(result.expectedHash, sha); assert.equal(result.lessonTitle, '저장 당시 합성 제목');
    assert.deepEqual(result.worksheet, { version: 'yeoni-private-handwriting-v1', sha256: 'b'.repeat(64) });
    assert.deepEqual(result.checks, [{ label: '저장 당시 점검 1', checked: true }, { label: '저장 당시 점검 2', checked: true }]);
    assert.deepEqual(result.metrics, { strokes: 12, activeSeconds: 0, occupiedWidth: null, occupiedHeight: null, pressureRange: null });
    assert.ok(validateComparisonResource(resource(result), result));
    assert.match(parseComparisonAttempt(row, owner).reason, /불러온 뒤/);
  }
});
test('all 53 recorded lesson identities are supported independently of historical title wording', () => {
  for (let page = 2; page <= 54; page++) assert.equal(candidate(course('copy', true, page)).lessonId, `film-p${page}`);
});
test('current free has an explicit discriminator and only free-practice context and measurements', () => {
  const result = candidate(free());
  assert.equal(result.kind, 'free'); assert.equal(result.mode, 'free'); assert.equal(result.legacy, false); assert.equal(result.expectedHash, sha);
  assert.equal(result.guideText, '합성 안내 문장'); assert.equal(result.lessonId, null); assert.equal(result.courseId, null); assert.equal(result.worksheet, null); assert.deepEqual(result.checks, []);
  assert.deepEqual(result.metrics, { strokes: 2, activeSeconds: 1, occupiedWidth: 30, occupiedHeight: 0, pressureRange: [0.15, 0.85] });
  assert.ok(validateComparisonResource(resource(result), result));
});
test('legacy course preserves recorded ids and checks but never fills historical wording/hash from current catalog', () => {
  const row = course('copy', false); row.metrics.selfChecks = [false, true];
  const result = candidate(row);
  assert.equal(result.legacy, true); assert.equal(result.expectedHash, null); assert.equal(result.lessonTitle, null); assert.equal(result.worksheet, null);
  assert.equal(result.lessonId, 'film-p2'); assert.deepEqual(result.checks, [{ label: null, checked: false }, { label: null, checked: true }]);
  assert.match(parseComparisonAttempt(row, owner).reason, /저장 당시 원본 해시 없음.*원본 무결성 미확인/);
});
test('legacy free recognizes its guide/measurement shape and the old handwriting filename', () => {
  const row = free(false), result = candidate(row);
  assert.equal(result.kind, 'free'); assert.equal(result.legacy, true); assert.equal(result.expectedHash, null);
  assert.ok(validateComparisonResource(resource(result), result));
  assert.match(parseComparisonAttempt(row, owner).reason, /원본 무결성 미확인/);
  const image = { ...resource(result), storage_path: `${owner}/${date}/free-handwriting-${resourceId}.png` };
  assert.equal(validateComparisonResource(image, result), null);
});
test('paper completions have a clear non-image state and do not synthesize measured screen data', () => {
  for (const modern of [true, false]) {
    const result = parseComparisonAttempt(course('paper', modern), owner);
    assert.equal(result.status, 'no_saved_image'); assert.match(result.reason, /저장된 손글씨 이미지는 없어요/);
    assert.ok(result.attempt); assert.equal(result.attempt.resourceId, null); assert.equal(result.attempt.expectedHash, null);
    assert.deepEqual(result.attempt.metrics, { strokes: null, activeSeconds: null, occupiedWidth: null, occupiedHeight: null, pressureRange: null });
    assert.equal(validateComparisonResource(resource(), result.attempt), null);
  }
  const conflict = course('paper'); conflict.metrics.resourceId = resourceId; rejects(conflict);
});
test('a missing legacy link is unsupported, never paper or a generated blank original', () => {
  for (const row of [course('trace', false), free(false)]) {
    delete row.metrics.resourceId;
    const result = parseComparisonAttempt(row, owner);
    assert.equal(result.status, 'unlinked_or_unsupported'); assert.ok(result.attempt); assert.equal(result.attempt.resourceId, null); assert.match(result.reason, /식별자가 없어요/);
  }
});
test('every modern hash failure stays invalid and cannot downgrade to legacy', () => {
  for (const original of [course(), free()]) for (const bad of [undefined, null, '', 'a'.repeat(63), 'A'.repeat(64), 1, {}, 'a'.repeat(65)]) {
    const row = structuredClone(original);
    if (bad === undefined) delete row.metrics.pngSha256; else row.metrics.pngSha256 = bad;
    rejects(row);
  }
  for (const field of ['worksheet', 'lessonSnapshot', 'pngSha256']) {
    const row = course('trace', false); row.metrics[field] = null; rejects(row);
  }
  const partialFree = free(false); partialFree.metrics.pngSha256 = sha; rejects(partialFree);
});
test('future/conflicting or generic schemas are not inferred from titles, routines or filenames', () => {
  for (const [key, value] of [['practiceKind', 'free-handwriting-v2'], ['courseId', 'film-handwriting-v2'], ['schemaVersion', 2], ['qualityScore', 95]]) {
    const row = free(); row.metrics[key as string] = value; rejects(row);
  }
  const freeCourse = free(); freeCourse.metrics.lessonId = 'film-p2'; rejects(freeCourse);
  const courseFree = course(); courseFree.metrics.guideText = '혼합'; rejects(courseFree);
  const courseExtension = course('trace', false); courseExtension.metrics.pressureRange = null; rejects(courseExtension);
  const noShape = free(false); noShape.metrics = { resourceId, guideText: '문장' }; rejects(noShape);
  rejects({ ...resource(), category: 'handwriting', title: '손글씨 연습', source: 'handwriting', status: 'completed' });
  rejects({ ...free(), source: 'manual', title: '손글씨' });
});
test('owner/id/source/status/metric object validation fails closed', () => {
  for (const changed of [{ id: 'not-a-uuid' }, { user_id: other }, { source: 'typing' }, { status: 'planned' }, { metrics: null }, { metrics: [] }, { metrics: 'free-handwriting-v1' }]) rejects({ ...free(), ...changed });
  assert.equal(parseComparisonAttempt(free(), 'not-an-owner').status, 'unlinked_or_unsupported');
  for (const id of ['', '../image', resourceId.toUpperCase(), 42, {}]) { const row = free(); row.metrics.resourceId = id; if (id !== resourceId) rejects(row); }
});
test('strict calendar record dates reject impossible dates but permit future dates without chronology claims', () => {
  for (const session_date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-10-9', '2026-10-09T12:00:00Z', '0000-01-01', '', null]) rejects({ ...free(), session_date });
  assert.equal(candidate({ ...free(), session_date: '2028-02-29' }).date, '2028-02-29');
  assert.equal(candidate({ ...free(), session_date: '2099-12-31' }).date, '2099-12-31');
});
test('creation time is saved time; missing/invalid timestamps never fall back to updated/start/end', () => {
  assert.equal(candidate(free()).savedAt, stamp);
  for (const created_at of [undefined, null, '2026-02-30T12:00:00Z', '2026-10-09', '2026-10-09T24:00:00Z', '2026-10-09T12:00:00', {}, 0]) {
    assert.equal(candidate({ ...free(), created_at, updated_at: stamp, started_at: stamp, ended_at: stamp }).savedAt, null);
  }
});
test('course identity, mode and snapshot relationships cannot conflict', () => {
  for (const metrics of [{ lessonId: 'film-p3' }, { pdfPage: 55 }, { pdfPage: '2' }, { courseId: 'other-course' }, { lessonCompleted: false }, { practiceMode: 'free' }, { mode: 'paper' }, { selfChecks: [true] }, { selfChecks: [false, true] }, { selfChecks: ['true', true] }]) rejects({ ...course(), metrics: { ...course().metrics, ...metrics } });
  for (const patch of [{ id: 'film-p3' }, { number: 2 }, { pdfPage: 3 }, { title: '' }, { title: 'x'.repeat(501) }, { checks: ['only one'] }, { steps: [] }, { version: 2 }]) {
    const row = course(); row.metrics.lessonSnapshot = { ...lesson(), ...patch }; rejects(row);
  }
});
test('worksheet metadata must be owned canonical saved context, never a substitute result image', () => {
  for (const patch of [{ path: `${other}/learning/film-v1/page-02.webp` }, { path: `${owner}/learning/film-v1/page-03.webp` }, { path: 'https://example.invalid/page-02.webp' }, { sha256: 'bad' }, { version: '' }, { version: 'v'.repeat(101) }, { extra: true }]) {
    const row = course(); row.metrics.worksheet = { ...(row.metrics.worksheet as object), ...patch }; rejects(row);
  }
});
test('missing legacy scalar values and explicit null remain unknown rather than zero', () => {
  const row = course('trace', false); delete row.metrics.strokes; row.metrics.activeSeconds = null;
  assert.equal(candidate(row).metrics.strokes, null); assert.equal(candidate(row).metrics.activeSeconds, null);
  const f = free(false); delete f.metrics.strokes; delete f.metrics.activeSeconds; f.metrics.occupiedWidth = null; f.metrics.occupiedHeight = null; f.metrics.pressureRange = null;
  assert.deepEqual(candidate(f).metrics, { strokes: null, activeSeconds: null, occupiedWidth: null, occupiedHeight: null, pressureRange: null });
});
test('finite bounded numeric facts preserve valid zero; strings/nonfinite/negative/out-of-range fail closed', () => {
  const f = free(); f.metrics.activeSeconds = 0; f.metrics.occupiedWidth = 0; f.metrics.occupiedHeight = 100; f.metrics.pressureRange = null;
  assert.equal(candidate(f).metrics.activeSeconds, 0); assert.equal(candidate(f).metrics.occupiedWidth, 0); assert.equal(candidate(f).metrics.pressureRange, null);
  for (const modern of [true, false]) for (const [field, bad] of [['strokes', '2'], ['strokes', NaN], ['strokes', 1_000_001], ['activeSeconds', Infinity], ['activeSeconds', -1], ['activeSeconds', 86_401], ['activeSeconds', 0.5], ['occupiedWidth', '30'], ['occupiedWidth', 101], ['occupiedHeight', -1]]) {
    const row = free(modern); row.metrics[field as string] = bad; rejects(row);
  }
  const row = free(); row.metrics.strokes = 0; rejects(row);
});
test('pressure range only represents varying positive finite 0–1 pen values', () => {
  for (const range of [[], [0, 1], [0.4, 0.4], [0.8, 0.2], [0.1, 1.1], [NaN, 0.8], ['0.1', 0.8], [0.1, 0.8, 1], 0]) {
    const row = free(); row.metrics.pressureRange = range; rejects(row);
  }
  const row = free(); row.metrics.pressureRange = [0.01, 1]; assert.deepEqual(candidate(row).metrics.pressureRange, [0.01, 1]);
});
test('resource link owner/id/MIME/size must match and missing resource is not a candidate image', () => {
  const attempt = candidate(course()), valid = resource(attempt);
  for (const row of [null, {}, { ...valid, id: sessionId }, { ...valid, user_id: other }, { ...valid, mime_type: 'image/webp' }, { ...valid, mime_type: 'image/png; charset=utf-8' }, ...[0, -1, 68.5, '68', NaN, Infinity, COMPARISON_MAX_PNG_BYTES + 1].map(size_bytes => ({ ...valid, size_bytes }))]) assert.equal(validateComparisonResource(row, attempt), null);
  assert.equal(validateComparisonResource({ ...valid, size_bytes: COMPARISON_MAX_PNG_BYTES }, attempt)?.size, COMPARISON_MAX_PNG_BYTES);
});
test('canonical resource paths reject foreign/traversal/encoded/query/fragment/workbook/URL structures', () => {
  const attempt = candidate(course()), valid = resource(attempt), filename = `handwriting-${resourceId}.png`;
  for (const storage_path of [`${other}/${date}/${filename}`, `${owner}/../${filename}`, `${owner}//${filename}`, `${owner}/${date}/../${filename}`, `${owner}/${date}/%2f${filename}`, `${owner}/${date}%2f${filename}`, `${owner}/${date}/${filename}?download=1`, `${owner}/${date}/${filename}#fragment`, `${owner}/learning/film-v1/page-02.webp`, `${owner}/learning/film-v1/workbook.pdf`, `${owner}/learning/film-v1/ready.txt`, `https://example.invalid/${valid.storage_path}`, `/${valid.storage_path}`, `${valid.storage_path}/`, valid.storage_path.replaceAll('/', '\\'), `${owner}/2026-02-29/${filename}`, `${owner}/${date}/handwriting-${sessionId}.png`, `${owner}/${date}/free-handwriting-${resourceId}.png`, `${owner}/${date}/${filename.toUpperCase()}`]) assert.equal(validateComparisonResource({ ...valid, storage_path }, attempt), null, storage_path);
});
test('current free paths cannot masquerade as legacy/course paths and vice versa', () => {
  const attempt = candidate(free()), row = resource(attempt);
  assert.ok(validateComparisonResource(row, attempt));
  assert.equal(validateComparisonResource({ ...row, storage_path: row.storage_path.replace('free-handwriting-', 'handwriting-') }, attempt), null);
});
test('a valid path date may differ from record date without rewriting either', () => {
  const attempt = candidate(course()), row = resource(attempt); row.storage_path = row.storage_path.replace(date, '2026-10-08');
  const result = validateComparisonResource(row, attempt);
  assert.equal(result?.pathDate, '2026-10-08'); assert.equal(attempt.date, date);
});
test('routine deletion and unrelated mutable classification/title/notes do not change identity', () => {
  const row = course(), before = candidate(row), after = candidate({ ...row, routine_id: null, memo: '수정 메모', updated_at: '2099-12-31T12:00:00Z' });
  assert.equal(after.fingerprint, before.fingerprint);
  const original = resource(before), first = validateComparisonResource(original, before);
  const edited = validateComparisonResource({ ...original, classification: 'indirect', category: 'other', title: '새 제목', notes: '편집', routine_id: null, last_used_at: stamp, updated_at: stamp }, before);
  assert.deepEqual(edited, first);
});
test('fingerprints detect relevant metadata drift even when updated_at is unchanged', () => {
  const row = course(), before = candidate(row);
  for (const changed of [{ ...row, session_date: '2026-10-08' }, { ...row, created_at: '2026-10-09T13:00:00Z' }, { ...row, metrics: { ...row.metrics, strokes: 13 } }, { ...row, metrics: { ...row.metrics, lessonSnapshot: { ...lesson(), goal: '변경된 저장 문구' } } }]) assert.notEqual(candidate(changed).fingerprint, before.fingerprint);
  const valid = resource(before);
  assert.notEqual(validateComparisonResource({ ...valid, size_bytes: 69 }, before)?.fingerprint, validateComparisonResource(valid, before)?.fingerprint);
});
test('pair rules reject same attempt/resource and cross-owner/paper, while allowing identical saved hashes', () => {
  const a = candidate(course()), b = { ...candidate(free()), id: '00000000-0000-4000-8000-000000000905', resourceId: '00000000-0000-4000-8000-000000000906' };
  assert.equal(canPairAttempts(a, b), true); assert.equal(a.expectedHash, b.expectedHash);
  assert.equal(canPairAttempts(a, a), false); assert.equal(canPairAttempts(a, { ...b, resourceId: a.resourceId }), false); assert.equal(canPairAttempts(a, { ...b, id: a.id }), false);
  assert.equal(canPairAttempts(a, { ...b, owner: other }), false); assert.equal(canPairAttempts(a, { ...b, resourceId: null }), false); assert.equal(canPairAttempts(a, { ...b, mode: 'paper' }), false);
});
test('condition notes distinguish course/mode/worksheet/source/dimensions without an improvement verdict', () => {
  const a = candidate(course()), b = candidate(course('copy', true, 3));
  b.worksheet = { version: 'another-version', sha256: 'c'.repeat(64) };
  const notes = comparisonPairNotes(a, b, { width: 100, height: 140 }, { width: 120, height: 140 }).join(' ');
  assert.match(notes, /수업 식별자가 달라요/); assert.match(notes, /연습 방법이 달라요/); assert.match(notes, /버전 또는 해시가 달라요/); assert.match(notes, /픽셀 크기가 달라요/); assert.match(notes, /실제 연습 시작 시각이 아니에요/); assert.match(notes, /향상을 판정할 수 없어요/);
  assert.match(comparisonPairNotes(a, candidate(free())).join(' '), /수업 연습과 자유 연습/);
  assert.match(comparisonPairNotes(a, a, { width: 100, height: 140 }, { width: 100, height: 140 }).join(' '), /버전과 해시가 같아요/);
});
test('legacy unknown conditions and guide equality are explicit rather than assumed same handwriting', () => {
  const legacy = candidate(course('trace', false));
  const notes = comparisonPairNotes(legacy, candidate(course())).join(' ');
  assert.match(notes, /같은 연습지인지 확인할 수 없어요/); assert.match(notes, /현재 수업 이름은 참고용/); assert.match(notes, /불러온 뒤 확인/);
  const a = candidate(free()), b = candidate(free(false));
  assert.match(comparisonPairNotes(a, b).join(' '), /실제로 쓴 내용을 확인한 것은 아니에요/);
  b.guideText = '다른 문장'; assert.match(comparisonPairNotes(a, b).join(' '), /안내 문장이 달라요/);
});
test('canonical metadata identity ignores object key order but preserves arrays and meaningful values', () => {
  assert.equal(comparisonCanonical({ b: 2, a: { d: 4, c: 3 } }), comparisonCanonical({ a: { c: 3, d: 4 }, b: 2 }));
  assert.notEqual(comparisonCanonical([1, 2]), comparisonCanonical([2, 1]));
  assert.notEqual(comparisonCanonical({ value: null }), comparisonCanonical({ value: 0 }));
});
test('parser is pure and more than 1000 independent metadata rows do not produce a model-side cap', () => {
  const rows = Array.from({ length: 1203 }, (_, index) => ({ ...course(), id: `00000000-0000-4000-8000-${String(index + 2000).padStart(12, '0')}` }));
  const before = comparisonCanonical(rows);
  assert.equal(rows.map(candidate).length, 1203);
  assert.equal(comparisonCanonical(rows), before);
  // Pagination and duplicate-link rejection are tested at the reader boundary.
});
test('PNG preflight accepts real synthetic PNG signature and bounded header including byte offsets', () => {
  const image = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWuQAAAAASUVORK5CYII=', 'base64'));
  assert.deepEqual(inspectComparisonPng(image, 'course'), { width: 1, height: 1 });
  const offset = new Uint8Array(image.length + 10); offset.set(image, 5);
  assert.deepEqual(inspectComparisonPng(offset.subarray(5, 5 + image.length), 'free'), { width: 1, height: 1 });
  assert.deepEqual(inspectComparisonPng(pngHeader(1200, 744), 'free'), { width: 1200, height: 744 });
  assert.deepEqual(inspectComparisonPng(pngHeader(4096, 1024), 'course'), { width: 4096, height: 1024 });
});
test('PNG preflight rejects oversized/truncated/bad signature/header and unsupported dimensions before decode', () => {
  assert.throws(() => inspectComparisonPng(new Uint8Array(0), 'course'), /size/);
  assert.throws(() => inspectComparisonPng(new Uint8Array(32), 'course'), /size/);
  assert.throws(() => inspectComparisonPng(new Uint8Array(COMPARISON_MAX_PNG_BYTES + 1), 'course'), /size/);
  const signature = pngHeader(1, 1); signature[1] = 1; assert.throws(() => inspectComparisonPng(signature, 'course'), /signature/);
  for (const [offset, value] of [[11, 12], [12, 74], [24, 7], [25, 5], [26, 1], [27, 1], [28, 2]]) {
    const header = pngHeader(1, 1); header[offset] = value; assert.throws(() => inspectComparisonPng(header, 'course'), /header/);
  }
  for (const [width, height] of [[0, 1], [1, 0], [4097, 1], [1, 4097], [4096, 1025], [0xffffffff, 1]]) assert.throws(() => inspectComparisonPng(pngHeader(width, height), 'course'), /dimensions/);
  for (const [width, height] of [[1201, 744], [1200, 745]]) assert.throws(() => inspectComparisonPng(pngHeader(width, height), 'free'), /dimensions/);
});
