'use client';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { supabase } from '@/app/lib/supabase';
import { RECORD_RESET_EVENT, RECORD_RESET_STORAGE_EVENT, isRecordResetRunning, resetMarkerKey } from '@/app/data/appRecordReset';
import { HANDWRITING_COURSE_ID, completedHandwritingLessons, nextHandwritingLesson, type HandwritingLesson } from '@/app/data/handwritingCourse';
import { HANDWRITING_PACKAGE_FORMAT, handwritingMaterialPath } from '@/app/data/handwritingMaterials';
import type { GrowthRoutineRow } from '@/app/data/growthPlatform';
import { getLocalDateKey } from '@/utils/dateKey';
import { canonical, emptyHandwritingDraft, freezeRaster, hashBytes, makeHandwritingSave, terminalHandwritingRecord, type HandwritingDraft, type HandwritingRecord, type WorksheetIdentity } from '@/lib/handwriting-draft';
import { handwritingVersion, readHandwritingRecord, writeHandwritingRecord, type HandwritingVersion } from '@/lib/handwriting-local-store';
import { confirmHandwritingSave } from '@/lib/handwriting-save';

type Frame = { image: ImageData; strokes: number; activeMs: number };
export function useHandwritingPractice(owner: string, isOwnerActive: (owner: string) => boolean) {
  const [draft, setDraft] = useState(() => emptyHandwritingDraft(owner, null));
  const current = useRef(draft), expected = useRef<HandwritingVersion>(null), stored = useRef<HandwritingRecord | null>(null);
  const alive = useRef(false), generation = useRef(0), working = useRef(false), recovered = useRef(false), dirtyRef = useRef(false), finalizationBlocked = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve()), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetMarker = useRef<string | null>(null), surface = useRef<string | null>(null), history = useRef<Frame[]>([]);
  const drawing = useRef<{ x: number; y: number; started: number; moved: boolean; pointerId: number; frame: Frame } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false), [saving, setSaving] = useState(false), [saved, setSaved] = useState(false);
  const [storageError, setStorageError] = useState(false), [conflict, setConflict] = useState(false), [loadError, setLoadError] = useState(false);
  const [invalidated, setInvalidated] = useState(false), [notice, setNotice] = useState(''), [reload, setReload] = useState(0);
  const [sheetReady, setSheetReady] = useState(false), [sheetError, setSheetError] = useState(false), [sheetRetry, setSheetRetry] = useState(0);
  const [completed, setCompleted] = useState(new Set<string>()), [progressReady, setProgressReady] = useState(false), [progressError, setProgressError] = useState(''), [progressReload, setProgressReload] = useState(0);
  const active = () => alive.current && isOwnerActive(owner);
  const update = (next: HandwritingDraft) => { current.current = next; setDraft(next); };
  const dirty = !saved && (draft.strokes > 0 || draft.checks.some(Boolean) || !!draft.minutes || !!draft.reflection || !!draft.pending);
  dirtyRef.current = dirty;
  async function assertOwner() {
    if (!supabase || !active()) throw Error('handwriting_owner_changed');
    const auth = await supabase.auth.getUser();
    if (!active() || auth.error || auth.data.user?.id !== owner) throw Error('handwriting_owner_changed');
  }
  async function marker() {
    await assertOwner();
    const result = await supabase!.from('user_app_state').select('state').eq('user_id', owner).abortSignal(AbortSignal.timeout(15000)).maybeSingle();
    await assertOwner();
    if (result.error) throw Error('handwriting_save_unconfirmed');
    const value = result.data?.state?.[resetMarkerKey('growth')] ?? null;
    if (value !== null && (typeof value !== 'string' || value.length > 200)) throw Error('handwriting_reset_invalid');
    return value as string | null;
  }
  function checkpointFailed(error: unknown) {
    if (!active()) return;
    const stale = error instanceof Error && error.message === 'handwriting_draft_changed';
    if (stale) setConflict(true);
    setStorageError(true); setNotice(stale ? '다른 창에서 이 연습이 바뀌었어요. 화면의 입력은 유지하며 더 이상 덮어쓰지 않아요. 필요한 내용을 따로 보관한 뒤 다시 열어 주세요.' : '이 기기에 연습을 보관하지 못했어요. 화면과 이전 복구 기록은 유지했어요. 저장 공간을 확인하고 기기 임시 저장을 다시 시도해 주세요.');
  }
  // Capture pixels synchronously; hashing/IDB are queued outside any live canvas or IDB transaction.
  function checkpoint(snapshot = current.current): Promise<void> {
    if (!active()) return Promise.reject(Error('handwriting_owner_changed'));
    if (finalizationBlocked.current) return Promise.reject(Error('handwriting_finalization_unconfirmed'));
    const token = generation.current, canvas = canvasRef.current;
    const pixels = snapshot.mode === 'screen' && surface.current === snapshot.attemptId && canvas
      ? drawing.current?.frame.image ?? canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height) : null;
    const frames = history.current.map(frame => ({ ...frame, image: { width: frame.image.width, height: frame.image.height, data: new Uint8ClampedArray(frame.image.data) } }));
    const task = async () => {
      if (!active() || token !== generation.current) throw Error('handwriting_stale_encoding');
      const raster = pixels ? await freezeRaster(pixels.width, pixels.height, pixels.data) : snapshot.raster;
      const undo = pixels ? await Promise.all(frames.map(async frame => ({ raster: await freezeRaster(frame.image.width, frame.image.height, frame.image.data), strokes: frame.strokes, activeMs: frame.activeMs }))) : snapshot.undo;
      if (!active() || token !== generation.current) throw Error('handwriting_stale_encoding');
      const next = await writeHandwritingRecord({ ...snapshot, raster, undo }, expected.current);
      if (!active() || token !== generation.current) return;
      stored.current = next; expected.current = handwritingVersion(next); setStorageError(false);
    };
    const result = queue.current.then(task);
    queue.current = result.catch(error => { if (token === generation.current && (error as Error)?.message !== 'handwriting_stale_encoding') checkpointFailed(error); });
    return result;
  }
  async function flush() { if (timer.current) { clearTimeout(timer.current); timer.current = null; } await checkpoint(); }
  function schedule() { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => { timer.current = null; void checkpoint().catch(() => {}); }, 180); }
  const mutable = () => active() && ready && !working.current && !saved && !current.current.pending && !storageError && !invalidated;
  function change(patch: Partial<Pick<HandwritingDraft, 'checks' | 'minutes' | 'reflection'>>) {
    if (!mutable()) return;
    update({ ...current.current, ...patch }); recovered.current = true; schedule();
  }
  useEffect(() => {
    alive.current = true; const token = ++generation.current; let cancelled = false;
    const valid = () => !cancelled && active() && token === generation.current;
    setReady(false); setLoadError(false);
    void (async () => {
      try {
        const local = await readHandwritingRecord(owner); if (!valid()) return;
        stored.current = local; expected.current = handwritingVersion(local); recovered.current = local?.state === 'active';
        if (local?.state === 'active') update(local);
        const remoteMarker = await marker(); if (!valid()) return; resetMarker.current = remoteMarker;
        if (local?.state === 'active' && local.resetMarker !== remoteMarker) {
          const tombstone = await writeHandwritingRecord(terminalHandwritingRecord(local, 'invalidated'), expected.current); if (!valid()) return;
          stored.current = tombstone; expected.current = handwritingVersion(tombstone); setInvalidated(true);
          setNotice('기록 초기화 이전의 연습은 다시 저장하지 않아요. 화면의 내용은 유지했어요. 새 연습을 시작해 주세요.');
        } else {
          if (local?.state !== 'active') update(emptyHandwritingDraft(owner, remoteMarker));
          setInvalidated(false); setNotice(local?.state === 'active' ? local.pending ? '확인하지 못한 저장을 복구했어요. 같은 기록 다시 확인은 교재 연결 없이도 할 수 있어요.' : '이 계정의 수업과 입력, 획과 되돌리기를 복구했어요.' : '');
        }
        finalizationBlocked.current = false; setStorageError(false); setConflict(false); setReady(true);
      } catch { if (valid()) { setLoadError(true); setNotice('기기 복구 정보나 기록 초기화 상태를 확인하지 못했어요. 원본은 보존했어요. 연결과 기기 저장 공간을 확인한 뒤 다시 불러와 주세요.'); } }
    })();
    const onReset = () => { if (isRecordResetRunning()) { generation.current++; setReady(false); setNotice('기록 초기화 중에는 연습을 저장할 수 없어요. 완료 후 이 화면을 다시 열어 주세요.'); } };
    const onStorage = (event: StorageEvent) => { if (event.key === RECORD_RESET_STORAGE_EVENT) { try { const value = JSON.parse(event.newValue ?? 'null'); if (value?.userId === owner && value?.app === 'growth') { generation.current++; setReady(false); setNotice('기록 초기화가 감지됐어요. 이 화면을 다시 열어 주세요.'); } } catch {} } };
    window.addEventListener(RECORD_RESET_EVENT, onReset); window.addEventListener('storage', onStorage);
    // Invalidate outstanding asynchronous work, not a DOM-ref cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { cancelled = true; alive.current = false; generation.current++; if (timer.current) clearTimeout(timer.current); window.removeEventListener(RECORD_RESET_EVENT, onReset); window.removeEventListener('storage', onStorage); };
    // Lifecycle is owner keyed; event handlers read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, isOwnerActive, reload]);
  useEffect(() => {
    const bestEffort = () => { if (active() && ready && !saved && !working.current && !drawing.current && !storageError) void flush().catch(() => {}); };
    const visibility = () => { if (document.visibilityState === 'hidden') bestEffort(); };
    window.addEventListener('pagehide', bestEffort); document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('pagehide', bestEffort); document.removeEventListener('visibilitychange', visibility); };
  });
  useEffect(() => {
    if (!ready || !supabase) return;
    const client = supabase; let cancelled = false; setProgressReady(false); setProgressError('');
    void (async () => {
      try {
        const rows: Parameters<typeof completedHandwritingLessons>[0] = [];
        for (let offset = 0; ; offset += 500) {
          await assertOwner();
          const result = await client.from('growth_sessions').select('status,source,metrics').eq('user_id', owner).eq('source', 'handwriting').contains('metrics', { courseId: HANDWRITING_COURSE_ID }).order('id').range(offset, offset + 499).abortSignal(AbortSignal.timeout(15000));
          await assertOwner(); if (cancelled) return; if (result.error) throw result.error;
          rows.push(...result.data ?? []); if ((result.data?.length ?? 0) < 500) break;
        }
        if (cancelled || !active()) return;
        const done = completedHandwritingLessons(rows); setCompleted(done); setProgressReady(true);
        if (!recovered.current && !dirtyRef.current && !working.current) update({ ...current.current, lesson: structuredClone(nextHandwritingLesson(done)), worksheet: null });
      } catch { if (!cancelled && active()) setProgressError('수업 진도를 불러오지 못했어요. 다시 불러온 뒤 이어서 연습해 주세요.'); }
    })();
    return () => { cancelled = true; };
    // Progress must never select over a recovered or edited attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, owner, progressReload]);
  function prepareSheet(imageUrl: string, worksheet: WorksheetIdentity | null) {
    if (!active() || !ready || !worksheet) return () => {};
    const snapshot = current.current;
    if (worksheet.version !== HANDWRITING_PACKAGE_FORMAT || worksheet.path !== handwritingMaterialPath(owner, `page-${String(snapshot.lesson.pdfPage).padStart(2, '0')}.webp`)) return () => {};
    if (snapshot.worksheet && canonical(snapshot.worksheet) !== canonical(worksheet)) return () => {};
    if (!snapshot.worksheet) update({ ...snapshot, worksheet });
    if (snapshot.mode !== 'screen') { setSheetReady(false); return () => {}; }
    const canvas = canvasRef.current; if (!canvas) return () => {};
    if (surface.current === snapshot.attemptId) return () => {};
    if (snapshot.raster) {
      canvas.width = snapshot.raster.width; canvas.height = snapshot.raster.height;
      canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(snapshot.raster.pixels), snapshot.raster.width, snapshot.raster.height), 0, 0);
      history.current = snapshot.undo.map(frame => ({ image: new ImageData(new Uint8ClampedArray(frame.raster.pixels), frame.raster.width, frame.raster.height), strokes: frame.strokes, activeMs: frame.activeMs }));
      surface.current = snapshot.attemptId; setSheetReady(true); setSheetError(false); return () => {};
    }
    if (!imageUrl) return () => {};
    const token = generation.current; let cancelled = false; const image = new window.Image(); setSheetReady(false); setSheetError(false);
    image.onload = () => {
      if (cancelled || !active() || token !== generation.current || current.current.attemptId !== snapshot.attemptId || current.current.pending || surface.current === snapshot.attemptId) return;
      if (image.naturalWidth > 4096 || image.naturalHeight > 4096 || image.naturalWidth * image.naturalHeight > 4_194_304) { setSheetError(true); return; }
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; const ctx = canvas.getContext('2d'); if (!ctx) { setSheetError(true); return; }
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (snapshot.trace) ctx.drawImage(image, 0, 0);
      else { ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1; for (let y = 90; y < canvas.height; y += 90) { ctx.beginPath(); ctx.moveTo(25, y); ctx.lineTo(canvas.width - 25, y); ctx.stroke(); } }
      surface.current = snapshot.attemptId; setSheetReady(true); void checkpoint().catch(() => {});
    };
    image.onerror = () => { if (!cancelled && active() && token === generation.current) setSheetError(true); }; image.src = imageUrl;
    return () => { cancelled = true; };
  }
  // Recovered pixels do not depend on a successful material fetch.
  useEffect(() => { if (ready && draft.raster && draft.mode === 'screen') return prepareSheet('', draft.worksheet); }, [ready, draft.attemptId, draft.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  function point(event: PointerEvent<HTMLCanvasElement>) { const rect = event.currentTarget.getBoundingClientRect(); return { x: (event.clientX - rect.left) * event.currentTarget.width / rect.width, y: (event.clientY - rect.top) * event.currentTarget.height / rect.height }; }
  function start(event: PointerEvent<HTMLCanvasElement>) {
    if (!mutable() || !sheetReady || drawing.current) return;
    const ctx = event.currentTarget.getContext('2d'); if (!ctx) return;
    const frame = { image: ctx.getImageData(0, 0, event.currentTarget.width, event.currentTarget.height), strokes: current.current.strokes, activeMs: current.current.activeMs };
    drawing.current = { ...point(event), started: performance.now(), moved: false, pointerId: event.pointerId, frame }; event.currentTarget.setPointerCapture(event.pointerId);
  }
  function draw(event: PointerEvent<HTMLCanvasElement>) {
    const previous = drawing.current; if (!previous || previous.pointerId !== event.pointerId || !active()) return;
    const next = point(event), ctx = event.currentTarget.getContext('2d'); if (!ctx) return;
    ctx.strokeStyle = '#183a68'; ctx.lineWidth = 2 + (event.pressure || .5) * 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.lineTo(next.x, next.y); ctx.stroke(); drawing.current = { ...previous, ...next, moved: true };
  }
  function stop(event?: PointerEvent<HTMLCanvasElement>) {
    const previous = drawing.current; if (!previous || event && event.pointerId !== previous.pointerId) return;
    drawing.current = null; if (!previous.moved || !active()) return;
    history.current = [...history.current, previous.frame].slice(-5);
    update({ ...current.current, strokes: current.current.strokes + 1, activeMs: Math.min(86_400_000, current.current.activeMs + Math.max(0, performance.now() - previous.started)) }); recovered.current = true; void checkpoint().catch(() => {});
  }
  function undo() {
    if (!mutable() || drawing.current) return; const last = history.current.pop(), ctx = canvasRef.current?.getContext('2d'); if (!last || !ctx) return;
    ctx.putImageData(last.image, 0, 0); update({ ...current.current, strokes: last.strokes, activeMs: last.activeMs }); void checkpoint().catch(() => {});
  }
  async function reset(patch: Partial<Pick<HandwritingDraft, 'lesson' | 'mode' | 'trace'>> = {}) {
    if (!active() || !ready || finalizationBlocked.current || working.current || conflict || storageError || current.current.pending && !invalidated && !saved || drawing.current) return;
    if (dirtyRef.current && !window.confirm('저장하지 않은 이번 연습을 비우고 이동할까요?')) return;
    working.current = true; setSaving(true); const token = generation.current;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    try {
      await queue.current; await assertOwner();
      if (token !== generation.current) throw Error('handwriting_stale_encoding');
      generation.current++;
      if (stored.current?.state === 'active') { const tombstone = await writeHandwritingRecord(terminalHandwritingRecord(stored.current, 'discarded'), expected.current); stored.current = tombstone; expected.current = handwritingVersion(tombstone); }
      const next = { ...emptyHandwritingDraft(owner, resetMarker.current, patch.lesson ?? current.current.lesson), mode: patch.mode ?? current.current.mode, trace: patch.trace ?? current.current.trace };
      const checked = await writeHandwritingRecord(next, expected.current); if (!active()) return;
      stored.current = checked; expected.current = handwritingVersion(checked); surface.current = null; history.current = []; recovered.current = true;
      update(next); setSaved(false); setInvalidated(false); setSheetReady(false); setNotice('');
    } catch (error) { checkpointFailed(error); }
    finally { working.current = false; if (active()) setSaving(false); }
  }
  async function save(routine: GrowthRoutineRow | null) {
    if (!supabase || !active() || !ready || finalizationBlocked.current || working.current || saved || storageError || invalidated || drawing.current || !current.current.pending && (!routine || routine.user_id !== owner)) return;
    working.current = true; setSaving(true); setNotice(''); const client = supabase, saveToken = generation.current; let cloudConfirmed = false;
    try {
      await flush(); await assertOwner();
      if (saveToken !== generation.current) throw Error('handwriting_stale_encoding');
      if (!current.current.pending) {
        const base = stored.current; if (base?.state !== 'active') throw Error('handwriting_draft_invalid');
        const token = generation.current;
        const png = base.mode === 'screen' ? await new Promise<Blob>((resolve, reject) => { const canvas = canvasRef.current; if (!canvas) { reject(Error('handwriting_image_failed')); return; } canvas.toBlob(value => value ? resolve(value) : reject(Error('handwriting_image_failed')), 'image/png'); }) : null;
        await assertOwner(); if (token !== generation.current) throw Error('handwriting_stale_encoding');
        const pngSha256 = png ? await hashBytes(png) : null; await assertOwner(); if (token !== generation.current) throw Error('handwriting_stale_encoding');
        const pending = makeHandwritingSave(base, routine!.id, getLocalDateKey(), new Date().toISOString(), crypto.randomUUID(), png ? crypto.randomUUID() : null, png, pngSha256);
        update({ ...base, pending }); await checkpoint(current.current);
      }
      const snapshot = current.current, job = snapshot.pending!;
      const assertCurrent = async () => {
        await assertOwner();
        if (saveToken !== generation.current) throw Error('handwriting_reset_changed');
        const local = await readHandwritingRecord(owner); await assertOwner();
        if (!local || local.revision !== expected.current?.revision || local.attemptId !== expected.current?.attemptId || local.state !== 'active') throw Error('handwriting_draft_changed');
        if (isRecordResetRunning() || await marker() !== snapshot.resetMarker || saveToken !== generation.current) throw Error('handwriting_reset_changed');
      };
      await confirmHandwritingSave(job, {
        assertCurrent,
        readSession: async () => client.from('growth_sessions').select('*').eq('id', job.session.id).eq('user_id', owner).abortSignal(AbortSignal.timeout(15000)).maybeSingle(),
        readResource: async () => client.from('growth_resources').select('*').eq('id', job.resource!.id).eq('user_id', owner).abortSignal(AbortSignal.timeout(15000)).maybeSingle(),
        download: async () => client.storage.from('growth-resources').download(job.resource!.storage_path),
        upload: async () => client.storage.from('growth-resources').upload(job.resource!.storage_path, job.png!, { contentType: 'image/png', upsert: false }),
        commit: async () => client.rpc('save_handwriting_attempt', { p_session: job.session, p_resource: job.resource, p_expected_owner: owner, p_expected_reset_marker: snapshot.resetMarker }).abortSignal(AbortSignal.timeout(15000)),
      });
      await assertCurrent();
      cloudConfirmed = true; const terminalToken = ++generation.current;
      const terminal = await writeHandwritingRecord(terminalHandwritingRecord(snapshot, 'confirmed'), expected.current); await assertOwner();
      stored.current = terminal; expected.current = handwritingVersion(terminal);
      // A reset immediately after the final GET must not be displayed as retained progress.
      if (await marker() !== snapshot.resetMarker || terminalToken !== generation.current || isRecordResetRunning()) throw Error('handwriting_reset_changed');
      setCompleted(done => new Set([...done, snapshot.lesson.id])); setSaved(true);
      setNotice('이번 수업과 연습 기록을 저장했어요. 다음 수업으로 가거나 같은 수업을 다시 연습할 수 있어요.');
    } catch (error) {
      if (!active()) return; const message = error instanceof Error ? error.message : '';
      if (message === 'handwriting_reset_changed') { setReady(false); setNotice('기록 초기화 이후에는 이전 연습을 다시 저장하지 않아요. 업로드한 비공개 이미지는 자동으로 지우지 않았어요. 이 화면을 다시 열어 주세요.'); }
      else if (cloudConfirmed) { finalizationBlocked.current = true; setReady(false); setNotice('서버에서 이번 수업 저장을 확인했지만, 기기 복구 기록 정리 또는 이후 기록 초기화 상태는 확인하지 못했어요. 이 화면을 다시 열고 저장한 기록을 확인해 주세요.'); }
      else if (message === 'handwriting_draft_changed') checkpointFailed(error);
      else if (message === 'handwriting_save_schema_unavailable') setNotice('저장 기능 업데이트가 아직 서버에 반영되지 않았어요. 같은 요청은 이 기기에 보관했어요. 업데이트 후 같은 기록 다시 확인을 눌러 주세요.');
      else setNotice(message === 'handwriting_save_conflict' ? '같은 ID의 기록이나 이미지가 달라요. 덮어쓰지 않았고 이 기기의 요청은 유지했어요.' : '저장을 확인하지 못했어요. 화면과 같은 요청은 유지했어요. 기기 저장 안내를 확인하고 같은 기록 다시 확인을 눌러 주세요.');
    } finally { working.current = false; if (active()) setSaving(false); }
  }
  return { draft, ready, saving, saved, storageError, conflict, loadError, invalidated, notice, dirty, canvasRef, sheetReady, sheetError, sheetRetry, completed, progressReady, progressError,
    change, prepareSheet, start, draw, stop, undo, reset, save, flush, retrySheet: () => setSheetRetry(n => n + 1), retryProgress: () => setProgressReload(n => n + 1), retryLoad: () => setReload(n => n + 1),
    retryCheckpoint: () => { if (!conflict && active() && !working.current) void flush().catch(checkpointFailed); } };
}
