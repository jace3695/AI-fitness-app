'use client';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { supabase } from '@/app/lib/supabase';
import { RECORD_RESET_EVENT, RECORD_RESET_STORAGE_EVENT, isRecordResetRunning, resetMarkerKey } from '@/app/data/appRecordReset';
import { emptyHandwritingEvidence, handwritingPoint, type HandwritingEvidence } from '@/app/data/practiceEvidence';
import type { GrowthRoutineRow } from '@/app/data/growthPlatform';
import { getLocalDateKey } from '@/utils/dateKey';
import { emptyFreeDraft, freeEvidence, FREE_GUIDES, freezeRaster, hashBytes, makeFreeSave, terminalFreeRecord, freeRecordEqual, type FreeDraft, type FreeRecord, type FreeFrame } from '@/lib/free-handwriting-draft';
import { readFreeRecord, writeFreeRecord } from '@/lib/free-handwriting-local-store';
import { confirmFreeSave } from '@/lib/free-handwriting-save';

export function useFreeHandwritingPractice(owner: string, isOwnerActive: (owner: string) => boolean) {
  const [draft, setDraft] = useState(() => emptyFreeDraft(owner, null));
  const current = useRef(draft), expected = useRef<FreeRecord | null>(null), alive = useRef(false), generation = useRef(0), working = useRef(false), finalized = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve()), checkpointWork = useRef(false), queued = useRef<{ snapshot: FreeDraft; token: number; waiters: { resolve: () => void; reject: (error: unknown) => void }[] } | null>(null), surface = useRef<string | null>(null);
  const drawing = useRef<{ pointerId: number; x: number; y: number; started: number; moved: boolean; evidence: HandwritingEvidence } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false), [saving, setSaving] = useState(false), [saved, setSaved] = useState(false);
  const [storageError, setStorageError] = useState(false), [conflict, setConflict] = useState(false), [loadError, setLoadError] = useState(false), [invalidated, setInvalidated] = useState(false), [notice, setNotice] = useState('');
  const active = () => alive.current && isOwnerActive(owner);
  const update = (next: FreeDraft) => { current.current = next; setDraft(next); };
  const dirty = !saved && (!!draft.pending || draft.frames.length > 1 || freeEvidence(draft).strokes > 0 || draft.guideIndex !== 0 || draft.inkColor !== '#242231');
  const mutable = () => active() && ready && !working.current && !current.current.pending && !saved && !storageError && !invalidated;
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
    if (value !== null && (typeof value !== 'string' || value.length > 200)) throw Error('free_handwriting_reset_invalid');
    return value as string | null;
  }
  function checkpointFailed(error: unknown) {
    if (!active()) return;
    const changed = error instanceof Error && error.message === 'free_handwriting_draft_changed';
    if (changed) setConflict(true);
    setStorageError(true);
    setNotice(changed ? '다른 창에서 이 연습이 바뀌었어요. 화면과 최신 복구 기록을 유지하며 덮어쓰지 않았어요. 필요한 내용을 보관한 뒤 다시 열어 주세요.' : '기기 임시 저장을 확인하지 못했어요. 화면은 유지했지만 마지막 기기 저장 상태는 확인하지 못했어요. 저장 공간을 확인한 뒤 다시 시도해 주세요.');
  }
  // Frames contain only completed strokes. Capturing never reads a live, unfinished canvas.
  async function freeze(snapshot: FreeDraft): Promise<FreeDraft> {
    return { ...snapshot, frames: await Promise.all(snapshot.frames.map(async frame => ({ evidence: { ...frame.evidence }, raster: await freezeRaster(frame.raster.width, frame.raster.height, frame.raster.pixels) }))) };
  }
  function drainCheckpoints() {
    if (checkpointWork.current) return;
    checkpointWork.current = true;
    queue.current = (async () => {
      while (queued.current) {
        const task = queued.current; queued.current = null;
        try {
          if (!active() || task.token !== generation.current) throw Error('free_handwriting_stale_encoding');
          const frozen = await freeze(task.snapshot);
          if (!active() || task.token !== generation.current) throw Error('free_handwriting_stale_encoding');
          const next = await writeFreeRecord(frozen, expected.current);
          if (!active() || task.token !== generation.current) throw Error('free_handwriting_stale_encoding');
          expected.current = next; setStorageError(false); task.waiters.forEach(waiter => waiter.resolve());
        } catch (error) {
          task.waiters.forEach(waiter => waiter.reject(error));
          // Keep the most recent visible draft, but no queued write may skip a failed checkpoint.
          const waiting = queued.current as typeof task | null; queued.current = null;
          waiting?.waiters.forEach(waiter => waiter.reject(error));
          if (active() && (error as Error)?.message !== 'free_handwriting_stale_encoding') checkpointFailed(error);
          break;
        }
      }
    })().finally(() => {
      checkpointWork.current = false;
      // A new caller can arrive after the loop exits but before this finalizer.
      // Its own waiter remains pending until a fresh drain actually writes it.
      if (queued.current) drainCheckpoints();
    });
  }
  function checkpoint(snapshot = current.current): Promise<void> {
    if (!active() || finalized.current) return Promise.reject(Error('free_handwriting_finalization_unconfirmed'));
    // At most one encoding/write and one latest immutable snapshot are queued.
    const result = new Promise<void>((resolve, reject) => {
      const waiters = queued.current?.waiters ?? []; waiters.push({ resolve, reject });
      queued.current = { snapshot, token: generation.current, waiters };
    });
    drainCheckpoints(); return result;
  }
  function paint(frame: FreeFrame) {
    const canvas = canvasRef.current, ctx = canvas?.getContext('2d'); if (!canvas || !ctx) throw Error('free_handwriting_canvas_unavailable');
    canvas.width = frame.raster.width; canvas.height = frame.raster.height;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.raster.pixels), frame.raster.width, frame.raster.height), 0, 0);
  }
  useEffect(() => {
    alive.current = true; const token = ++generation.current; let cancelled = false;
    const valid = () => !cancelled && active() && generation.current === token;
    void (async () => {
      try {
        const local = await readFreeRecord(owner); if (!valid()) return;
        expected.current = local;
        if (local?.state === 'active') update(local);
        try {
          const remote = await marker(); if (!valid()) return;
          if (local?.state === 'active' && local.resetMarker !== remote) { setInvalidated(true); setNotice('기록 초기화 이전의 연습은 다시 저장하지 않아요. 복구 원본과 화면은 유지했어요. 확인 후 새 연습을 시작해 주세요.'); }
          else if (local?.state !== 'active') update(emptyFreeDraft(owner, remote));
          else setNotice(local.pending ? '확인하지 못한 저장을 복구했어요. 같은 기록 다시 확인을 눌러 주세요.' : '이 계정의 연습장, 되돌리기, 문장과 펜 색을 복구했어요.');
          setReady(true);
        } catch {
          if (!valid()) return;
          setLoadError(true);
          if (local?.state === 'active') { setReady(true); setNotice('기기의 연습을 복구했어요. 연결 상태를 확인하지 못해 서버 저장은 보류돼요. 기기 입력은 계속 보관해요.'); }
          else setNotice('기기 복구 정보나 기록 초기화 상태를 확인하지 못했어요. 원본은 보존했어요. 연결을 확인한 뒤 다시 열어 주세요.');
        }
      } catch { if (valid()) { setLoadError(true); setNotice('이 기기의 복구 기록을 안전하게 읽지 못했어요. 원본은 지우거나 덮어쓰지 않았어요.'); } }
    })();
    const reset = () => { generation.current++; drawing.current = null; setInvalidated(true); setReady(false); setNotice('기록 초기화가 감지됐어요. 화면과 복구 원본을 유지하며 이전 연습 저장을 중지했어요. 새 연습 전에 초기화 상태를 확인해 주세요.'); };
    const onReset = () => { if (isRecordResetRunning()) reset(); };
    const onStorage = (event: StorageEvent) => { if (event.key === RECORD_RESET_STORAGE_EVENT) { try { const value = JSON.parse(event.newValue ?? 'null'); if (value?.userId === owner && value?.app === 'growth') reset(); } catch {} } };
    window.addEventListener(RECORD_RESET_EVENT, onReset); window.addEventListener('storage', onStorage);
    // Invalidate queued work rather than retaining an obsolete generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { cancelled = true; alive.current = false; generation.current++; window.removeEventListener(RECORD_RESET_EVENT, onReset); window.removeEventListener('storage', onStorage); };
    // The workspace is keyed by owner; all asynchronous boundaries check that owner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, isOwnerActive]);
  useEffect(() => {
    if (!ready || surface.current === draft.attemptId) return;
    try {
      if (draft.frames.length) paint(draft.frames[draft.historyIndex]);
      else {
        const canvas = canvasRef.current; if (!canvas) return;
        const width = Math.min(1200, Math.max(640, Math.round(canvas.getBoundingClientRect().width * 2))), height = Math.round(width * .62);
        const next = { ...current.current, frames: [{ raster: { width, height, pixels: new Uint8ClampedArray(width * height * 4).fill(255), sha256: '' }, evidence: emptyHandwritingEvidence() }], historyIndex: 0 };
        paint(next.frames[0]); update(next); void checkpoint(next).catch(() => {});
      }
      surface.current = draft.attemptId;
    } catch (error) { checkpointFailed(error); }
    // Never repaint newer edits after a delayed checkpoint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, draft.attemptId]);
  useEffect(() => {
    const bestEffort = () => { if (active() && ready && !working.current && !saved && !invalidated && !storageError) void checkpoint().catch(() => {}); };
    const visibility = () => { if (document.visibilityState === 'hidden') bestEffort(); };
    window.addEventListener('pagehide', bestEffort); document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('pagehide', bestEffort); document.removeEventListener('visibilitychange', visibility); };
  });
  function change(patch: Partial<Pick<FreeDraft, 'guideIndex' | 'guideText' | 'inkColor'>>) {
    if (!mutable() || drawing.current) return;
    const next = { ...current.current, ...patch }; update(next); void checkpoint(next).catch(() => {});
  }
  function point(event: PointerEvent<HTMLCanvasElement>) { const rect = event.currentTarget.getBoundingClientRect(); return { x: (event.clientX - rect.left) * event.currentTarget.width / rect.width, y: (event.clientY - rect.top) * event.currentTarget.height / rect.height }; }
  function start(event: PointerEvent<HTMLCanvasElement>) {
    if (!mutable() || drawing.current || surface.current !== current.current.attemptId) return;
    drawing.current = { ...point(event), pointerId: event.pointerId, started: performance.now(), moved: false, evidence: { ...freeEvidence(current.current) } };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function draw(event: PointerEvent<HTMLCanvasElement>) {
    const previous = drawing.current; if (!previous || previous.pointerId !== event.pointerId || !active()) return;
    const next = point(event), canvas = event.currentTarget, ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.strokeStyle = current.current.inkColor; ctx.lineWidth = 3 + (event.pressure > 0 ? event.pressure : .5) * 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(previous.x, previous.y); ctx.lineTo(next.x, next.y); ctx.stroke();
    let evidence = previous.evidence;
    if (!previous.moved) evidence = handwritingPoint(evidence, previous.x / canvas.width, previous.y / canvas.height, event.pressure, event.pointerType);
    evidence = handwritingPoint(evidence, next.x / canvas.width, next.y / canvas.height, event.pressure, event.pointerType);
    drawing.current = { ...previous, ...next, moved: true, evidence };
  }
  function stop(event?: PointerEvent<HTMLCanvasElement>) {
    const stroke = drawing.current; if (!stroke || event && stroke.pointerId !== event.pointerId) return;
    drawing.current = null;
    if (!active() || !stroke.moved) return;
    const canvas = canvasRef.current, image = canvas?.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height); if (!image) return;
    const evidence = { ...stroke.evidence, strokes: stroke.evidence.strokes + 1, activeMs: stroke.evidence.activeMs + Math.max(0, performance.now() - stroke.started) };
    const frame = { raster: { width: image.width, height: image.height, pixels: new Uint8ClampedArray(image.data), sha256: '' }, evidence };
    const frames = [...current.current.frames.slice(0, current.current.historyIndex + 1), frame].slice(-20), next = { ...current.current, frames, historyIndex: frames.length - 1 };
    update(next); void checkpoint(next).catch(() => {});
  }
  function restore(index: number) {
    if (!mutable() || drawing.current || !current.current.frames[index]) return;
    try { paint(current.current.frames[index]); const next = { ...current.current, historyIndex: index }; update(next); void checkpoint(next).catch(() => {}); } catch (error) { checkpointFailed(error); }
  }
  async function clear() {
    if (!active() || working.current || storageError || conflict || current.current.pending && !saved && !invalidated || drawing.current || !expected.current) return;
    if (invalidated && !window.confirm('초기화 이전의 기기 복구 기록을 새 연습으로 바꿀까요? 비공개 서버 이미지는 지우지 않아요.')) return;
    working.current = true; setSaving(true); const token = ++generation.current;
    try {
      await queue.current; if (!active()) throw Error('handwriting_owner_changed');
      const snapshot = current.current, remote = saved || invalidated ? await marker() : snapshot.resetMarker;
      if (!active() || token !== generation.current || isRecordResetRunning()) throw Error('handwriting_reset_changed');
      const base = saved || invalidated ? { ...emptyFreeDraft(owner, remote), guideIndex: snapshot.guideIndex, guideText: snapshot.guideText, inkColor: snapshot.inkColor } : snapshot;
      const old = snapshot.frames[snapshot.historyIndex]; if (!old) return;
      const blank = { raster: await freezeRaster(old.raster.width, old.raster.height, new Uint8ClampedArray(old.raster.pixels.length).fill(255)), evidence: emptyHandwritingEvidence() };
      const frames = [...(invalidated ? [] : snapshot.frames.slice(0, snapshot.historyIndex + 1)), blank].slice(-20);
      const next = await freeze({ ...base, frames, historyIndex: frames.length - 1 });
      if (!active() || token !== generation.current) throw Error('handwriting_owner_changed');
      const stored = await writeFreeRecord(next, expected.current);
      if (!active() || token !== generation.current) return;
      expected.current = stored; finalized.current = false; update(next); paint(blank); surface.current = next.attemptId;
      setSaved(false); setInvalidated(false); setReady(true); setNotice('연습장을 비웠어요. 기기에 보관했어요.');
    } catch (error) { checkpointFailed(error); }
    finally { working.current = false; if (active()) setSaving(false); }
  }
  async function save(routine: GrowthRoutineRow | null) {
    if (!active() || !ready || working.current || saved || invalidated || storageError || drawing.current || !freeEvidence(current.current).strokes || !current.current.pending && (!routine || routine.user_id !== owner)) return;
    working.current = true; setSaving(true); const token = generation.current; let cloudConfirmed = false;
    try {
      await checkpoint(); await assertOwner();
      let snapshot = current.current;
      const assertCurrent = async () => {
        await assertOwner();
        if (token !== generation.current || isRecordResetRunning() || await marker() !== snapshot.resetMarker) throw Error('handwriting_reset_changed');
        const local = await readFreeRecord(owner); await assertOwner();
        if (!freeRecordEqual(local, expected.current)) throw Error('free_handwriting_draft_changed');
        if (token !== generation.current || isRecordResetRunning()) throw Error('handwriting_reset_changed');
      };
      await assertCurrent();
      if (!snapshot.pending) {
        const canvas = canvasRef.current; if (!canvas) throw Error('free_handwriting_canvas_unavailable');
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob || blob.type !== 'image/png') throw Error('free_handwriting_encoding_failed');
        const png = new Uint8Array(await blob.arrayBuffer()), digest = await hashBytes(png); await assertCurrent();
        const pending = makeFreeSave(snapshot, routine!.id, routine!.target_minutes, getLocalDateKey(), new Date().toISOString(), crypto.randomUUID(), crypto.randomUUID(), png, digest);
        snapshot = { ...snapshot, pending }; update(snapshot);
        await checkpoint(snapshot); await assertCurrent();
      }
      const job = snapshot.pending!, client = supabase!;
      await confirmFreeSave(job, {
        assertCurrent,
        readSession: () => client.from('growth_sessions').select('*').eq('id', job.session.id).eq('user_id', owner).abortSignal(AbortSignal.timeout(15000)).maybeSingle(),
        readResource: () => client.from('growth_resources').select('*').eq('id', job.resource.id).eq('user_id', owner).abortSignal(AbortSignal.timeout(15000)).maybeSingle(),
        download: () => client.storage.from('growth-resources').download(job.resource.storage_path),
        upload: () => client.storage.from('growth-resources').upload(job.resource.storage_path, new Blob([new Uint8Array(job.png).buffer], { type: 'image/png' }), { contentType: 'image/png', upsert: false }),
        commit: () => client.rpc('save_free_handwriting_attempt', { p_session: job.session, p_resource: job.resource, p_expected_owner: owner, p_expected_reset_marker: snapshot.resetMarker }).abortSignal(AbortSignal.timeout(15000)),
      });
      await assertCurrent(); cloudConfirmed = true; finalized.current = true;
      const terminal = await writeFreeRecord(terminalFreeRecord(snapshot, 'confirmed'), expected.current); await assertOwner();
      expected.current = terminal;
      if (token !== generation.current || await marker() !== snapshot.resetMarker || isRecordResetRunning()) throw Error('handwriting_reset_changed');
      setSaved(true); setLoadError(false); setNotice('손글씨 이미지와 실제 측정 기록을 비공개로 저장했어요.');
    } catch (error) {
      if (!active()) return; const message = error instanceof Error ? error.message : '';
      if (cloudConfirmed) { setReady(false); setNotice('서버에서 저장을 확인했지만 기기 복구 기록 정리 또는 이후 초기화 상태는 확인하지 못했어요. 이 화면을 다시 열고 저장한 기록을 확인해 주세요.'); }
      else if (message === 'handwriting_reset_changed') { setInvalidated(true); setNotice('기록 초기화 이후에는 이전 연습을 다시 저장하지 않아요. 기기 복구 원본과 업로드한 비공개 이미지는 지우지 않았어요.'); }
      else if (message === 'free_handwriting_draft_changed') checkpointFailed(error);
      else if (message === 'handwriting_save_schema_unavailable') setNotice('자유 연습 저장 업데이트가 아직 서버에 반영되지 않았어요. 같은 요청을 기기에 보관했어요. 업데이트 후 다시 확인해 주세요.');
      else if (!storageError) setNotice(message === 'handwriting_save_conflict' ? '같은 ID의 기록이나 이미지가 달라요. 덮어쓰지 않았고 기기 요청을 유지했어요.' : '저장을 확인하지 못했어요. 화면과 기기 복구 기록을 유지했어요. 연결과 기기 저장 상태를 확인한 뒤 다시 시도해 주세요.');
    } finally { working.current = false; if (active()) setSaving(false); }
  }
  return { draft, ready, saving, saved, storageError, conflict, loadError, invalidated, notice, dirty, canvasRef,
    start, draw, stop, restore, clear, save, flush: () => checkpoint(), changeColor: (inkColor: string) => change({ inkColor }),
    nextGuide: () => { const guideIndex = (current.current.guideIndex + 1) % FREE_GUIDES.length; change({ guideIndex, guideText: FREE_GUIDES[guideIndex] }); },
    retryCheckpoint: () => { if (!conflict && active() && !working.current && !invalidated) void checkpoint().catch(checkpointFailed); } };
}
