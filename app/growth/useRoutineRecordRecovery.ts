'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/app/lib/supabase';
import { RECORD_RESET_EVENT, RECORD_RESET_STORAGE_EVENT, isRecordResetRunning } from '@/app/data/appRecordReset';
import type { GrowthRoutineRow, GrowthSessionRow, GrowthSessionStatus } from '@/app/data/growthPlatform';
import { getLocalDateKey } from '@/utils/dateKey';
import { completeRoutineAttempt, confirmRoutineSave, emptyRoutineDraft, emptyRoutineForm, makeRoutineAttempt,
  parseRoutineDraft, persistRoutineDraft, readRoutineResetMarker, routineDraftKey, type RoutineDraft, type RoutineForm, type RoutineAttempt } from '@/lib/routine-record-recovery';

export function useRoutineRecordRecovery(owner: string | null) {
  const [draft, setDraft] = useState(() => emptyRoutineDraft(owner ?? '', null, getLocalDateKey()));
  const current = useRef(draft), raw = useRef<string | null>(null), epoch = useRef(0), working = useRef(false);
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const [ready, setReady] = useState(false), [saving, setSaving] = useState(false), [storageError, setStorageError] = useState(false);
  const [ownerInvalid, setOwnerInvalid] = useState(false);
  const [loadError, setLoadError] = useState(false), [notice, setNotice] = useState(''), [reload, setReload] = useState(0);
  const [confirmedRow, setConfirmedRow] = useState<GrowthSessionRow | null>(null);
  const readyRef = useRef(false);
  const lock = async <T,>(run: () => T | Promise<T>): Promise<T> => {
    if (!('locks' in navigator)) throw Error('routine_lock_unavailable');
    return navigator.locks.request('ai-yeoni-growth-sync', { mode: 'exclusive' }, run);
  };
  const active = (captured = epoch.current) => !!owner && ownerRef.current === owner && captured === epoch.current;
  const install = (next: RoutineDraft) => { current.current = next; setDraft(next); };
  const failCheckpoint = (error: unknown) => {
    setStorageError(true);
    setNotice(error instanceof Error && error.message === 'routine_draft_changed'
      ? '다른 창의 입력이 바뀌었어요. 덮어쓰지 않고 현재 입력을 유지했어요. 내용을 따로 보관한 뒤 다시 열어 주세요.'
      : '기기에 입력을 보관하지 못했어요. 화면을 닫기 전에 내용을 따로 보관하거나 기기 임시 저장을 다시 시도해 주세요.');
  };
  useEffect(() => {
    const captured = ++epoch.current;
    const invalidate = () => { epoch.current++; readyRef.current = false; };
    readyRef.current = false; setReady(false); setSaving(false); working.current = false;
    setOwnerInvalid(true); setLoadError(false); setStorageError(false); setConfirmedRow(null); setNotice('');
    if (!owner || !supabase) return;
    const client = supabase;
    const live = () => ownerRef.current === owner && epoch.current === captured;
    void (async () => {
      try {
        const initialRaw = window.localStorage.getItem(routineDraftKey(owner));
        raw.current = initialRaw;
        const recovered = parseRoutineDraft(initialRaw, owner);
        const auth = await client.auth.getUser();
        if (!live()) return;
        if (auth.error || auth.data.user?.id !== owner) { setOwnerInvalid(true); throw Error('routine_owner_changed'); }
        setOwnerInvalid(false);
        if (recovered) { current.current = recovered; setDraft(recovered); }
        const reset = await client.from('user_app_state').select('state').eq('user_id', owner).abortSignal(AbortSignal.timeout(15000)).maybeSingle();
        if (!live()) return;
        if (reset.error) throw Error('routine_reset_unknown');
        const marker = readRoutineResetMarker(reset.data);
        if (marker !== null && (typeof marker !== 'string' || marker.length > 200)) throw Error('routine_reset_unknown');
        await lock(() => {
          if (!live()) return;
          if (isRecordResetRunning()) throw Error('routine_reset_changed');
          if (window.localStorage.getItem(routineDraftKey(owner)) !== initialRaw) throw Error('routine_draft_changed');
          const resetChanged = recovered && recovered.resetMarker !== marker;
          const next = !recovered ? emptyRoutineDraft(owner, marker, getLocalDateKey()) : !resetChanged ? recovered : {
            ...recovered, ...emptyRoutineDraft(owner, marker, getLocalDateKey()),
            active: { ...recovered.active, ...emptyRoutineForm(getLocalDateKey()) }, manual: { ...recovered.manual, ...emptyRoutineForm(getLocalDateKey()) },
          };
          // Establish a revision even when empty; stale tabs can never see an ABA null after cleanup/reset.
          raw.current = persistRoutineDraft(window.localStorage, next, initialRaw);
          current.current = next; setDraft(next); readyRef.current = true; setReady(true);
          setNotice(resetChanged ? '기록 초기화 이전 입력은 다시 저장하지 않아요. 새 기록을 시작해 주세요.'
            : recovered?.pending ? '확인하지 못한 저장이 있어요. 같은 기록 다시 확인은 서버부터 조회해요.'
              : recovered && (recovered.active.routineId || recovered.manual.open) ? '이 계정에서 작성하던 루틴 기록을 복구했어요.' : '');
        });
      } catch {
        if (live()) { setLoadError(true); setNotice('기기 입력이나 기록 초기화 상태를 확인하지 못했어요. 기존 내용을 보존했으니 연결과 저장 공간을 확인한 뒤 다시 불러와 주세요.'); }
      }
    })();
    const resetChanged = () => { if (isRecordResetRunning() && live()) { epoch.current++; readyRef.current = false; setReady(false); setNotice('기록 초기화 중이에요. 완료 후 복구 상태를 다시 불러와 주세요.'); } };
    const storageChanged = (event: StorageEvent) => {
      if (!live()) return;
      if (event.key === routineDraftKey(owner) && event.newValue !== raw.current) failCheckpoint(Error('routine_draft_changed'));
      if (event.key === RECORD_RESET_STORAGE_EVENT) {
        try { const data = JSON.parse(event.newValue ?? 'null'); if (data?.userId === owner && data?.app === 'growth') { epoch.current++; readyRef.current = false; setReady(false); setNotice('기록 초기화를 감지했어요. 복구 상태를 다시 불러와 주세요.'); } } catch { /* Not a reset instruction. */ }
      }
    };
    const subscription = client.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.id !== owner && live()) { setOwnerInvalid(true); epoch.current++; readyRef.current = false; setReady(false); setSaving(false); }
    }).data.subscription;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (live() && JSON.stringify(current.current) !== raw.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('storage', storageChanged); window.addEventListener(RECORD_RESET_EVENT, resetChanged);
    return () => { invalidate(); subscription.unsubscribe(); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('storage', storageChanged); window.removeEventListener(RECORD_RESET_EVENT, resetChanged); };
  }, [owner, reload]); // All async continuations capture the owner and epoch, including A -> B -> A.

  async function persistCurrent() {
    const captured = epoch.current;
    try {
      await lock(() => {
        if (!active(captured) || !readyRef.current) throw Error('routine_owner_changed');
        raw.current = persistRoutineDraft(window.localStorage, current.current, raw.current); setStorageError(false);
      });
    } catch (error) { if (active(captured)) failCheckpoint(error); }
  }
  function changeForm(mode: 'active' | 'manual', updates: Partial<RoutineForm>) {
    if (!active() || !readyRef.current || storageError) return;
    const next = { ...current.current, revision: crypto.randomUUID(), [mode]: { ...current.current[mode], ...updates } };
    install(next); void persistCurrent();
  }
  function start(routine: GrowthRoutineRow) {
    if (!active() || !readyRef.current || storageError || working.current || current.current.pending || current.current.active.routineId || routine.user_id !== owner) return;
    changeForm('active', { ...emptyRoutineForm(getLocalDateKey()), routineId: routine.id, startedAt: new Date().toISOString(), open: true });
    setNotice('타이머를 시작했어요. 시작 시각과 입력을 기기에 보관해요.');
  }
  async function save(mode: RoutineAttempt['mode'], routine: GrowthRoutineRow | null, status?: GrowthSessionStatus) {
    if (!supabase || !owner || !active() || !readyRef.current || storageError || working.current) return null;
    const client = supabase, captured = epoch.current;
    working.current = true; setSaving(true); setConfirmedRow(null);
    let attempt: RoutineAttempt | null = null;
    let serverConfirmed = false;
    try {
      await lock(() => {
        if (!active(captured) || !readyRef.current) throw Error('routine_owner_changed');
        // CAS validates the original bytes before allocating an immutable attempt.
        if (window.localStorage.getItem(routineDraftKey(owner)) !== raw.current) throw Error('routine_draft_changed');
        const base = current.current;
        if (base.pending) attempt = base.pending;
        else {
          if (!routine) throw Error('routine_routine_invalid');
          const input = mode === 'quick' ? null : { ...base[mode], ...(status ? { status } : {}) };
          attempt = makeRoutineAttempt(owner, mode, input, routine, crypto.randomUUID(), getLocalDateKey(), new Date().toISOString());
          const next = { ...base, ...(mode === 'quick' ? {} : { [mode]: input }), revision: crypto.randomUUID(), pending: attempt };
          raw.current = persistRoutineDraft(window.localStorage, next, raw.current); install(next);
        }
      });
      if (!attempt) throw Error('routine_owner_changed');
      const frozen = attempt as RoutineAttempt, marker = current.current.resetMarker;
      const assertCurrent = async () => {
        if (!active(captured) || !readyRef.current) throw Error('routine_owner_changed');
        const auth = await client.auth.getUser();
        if (!active(captured)) throw Error('routine_owner_changed');
        if (auth.error || auth.data.user?.id !== owner) {
          if (!auth.error && auth.data.user?.id !== owner) { setOwnerInvalid(true); readyRef.current = false; setReady(false); }
          throw Error('routine_owner_changed');
        }
        if (isRecordResetRunning()) throw Error('routine_reset_changed');
        if (window.localStorage.getItem(routineDraftKey(owner)) !== raw.current) throw Error('routine_draft_changed');
        // Recheck reset after each network boundary, including successful readback.
        const reset = await client.from('user_app_state').select('state').eq('user_id', owner).abortSignal(AbortSignal.timeout(15000)).maybeSingle();
        if (!active(captured) || !readyRef.current) throw Error('routine_owner_changed');
        if (reset.error) throw Error('routine_save_unconfirmed');
        if (readRoutineResetMarker(reset.data) !== marker) throw Error('routine_reset_changed');
        if (window.localStorage.getItem(routineDraftKey(owner)) !== raw.current) throw Error('routine_draft_changed');
      };
      const row = await confirmRoutineSave(frozen.payload, {
        assertCurrent,
        read: async () => client.from('growth_sessions').select('*').eq('user_id', owner).eq('id', frozen.payload.id).abortSignal(AbortSignal.timeout(15000)).maybeSingle(),
        insert: async () => {
          const result = await client.rpc('save_routine_session', { p_payload: frozen.payload, p_expected_owner: owner, p_expected_reset_marker: marker }).abortSignal(AbortSignal.timeout(15000));
          if (result.error?.code === 'PGRST202' || result.error?.code === '42883') throw Error('routine_save_schema_unavailable');
          if (result.error) throw Error(result.error.message);
        },
      });
      if (!active(captured)) return null;
      serverConfirmed = true; setConfirmedRow(row);
      try {
        await lock(() => {
          if (!active(captured) || !readyRef.current) throw Error('routine_owner_changed');
          const next = completeRoutineAttempt(current.current, frozen);
          raw.current = persistRoutineDraft(window.localStorage, next, raw.current); install(next); setStorageError(false);
        });
        await assertCurrent();
        setNotice('기록을 클라우드에서 확인했어요. 저장 중 새로 입력한 내용은 유지했어요.');
      } catch (error) {
        if (error instanceof Error && ['routine_owner_changed', 'routine_reset_changed', 'routine_save_unconfirmed'].includes(error.message)) throw error;
        if (active(captured)) { readyRef.current = false; setReady(false); setStorageError(false); setNotice('클라우드 저장은 확인했지만 기기 정리 결과는 확인하지 못했어요. 새 저장을 중지했어요. 복구 상태를 다시 불러와 주세요.'); }
      }
      return row;
    } catch (error) {
      if (!active(captured)) return null;
      const reason = error instanceof Error ? error.message : '';
      if (reason === 'routine_draft_changed') failCheckpoint(error);
      else if (reason === 'routine_reset_changed') { readyRef.current = false; setReady(false); setNotice('기록 초기화 이후에는 이전 입력을 다시 저장하지 않아요. 복구 상태를 다시 불러와 주세요.'); }
      else if (reason === 'routine_save_schema_unavailable') setNotice('루틴 저장 업데이트가 아직 서버에 반영되지 않았어요. 입력과 같은 요청을 기기에 보관했어요.');
      else if (['routine_minutes_invalid','routine_elapsed_invalid','routine_input_invalid'].includes(reason)) setNotice('날짜와 시간을 확인해 주세요. 실행 시간은 0~1440분의 정수여야 해요. 타이머가 거꾸로 갔거나 하루를 넘긴 경우 시간을 임의로 바꾸지 않아요.');
      else if (reason === 'routine_save_conflict') setNotice('같은 ID의 서버 기록이 달라요. 덮어쓰지 않고 기기 입력을 유지했어요.');
      else if (reason === 'routine_routine_invalid') setNotice('원래 루틴을 확인하지 못했어요. 다른 루틴으로 바꾸어 저장하지 않고 입력을 유지했어요.');
      else if (serverConfirmed) { readyRef.current = false; setReady(false); setNotice('서버에서 기록을 확인한 뒤 현재 계정이나 초기화 상태의 최종 확인이 끊겼어요. 새 저장을 중지했으니 복구 상태를 다시 불러와 주세요.'); }
      else if (!attempt) failCheckpoint(error);
      else setNotice('저장 결과를 확인하지 못했어요. 입력과 같은 요청을 보관했으니 연결 후 같은 기록 다시 확인을 눌러 주세요.');
      return null;
    } finally { if (active(captured)) { working.current = false; setSaving(false); } }
  }
  async function discardActive() {
    if (!active() || !readyRef.current || working.current || storageError || current.current.pending || !window.confirm('저장하지 않은 실행 초안을 비울까요? 필요한 메모를 먼저 따로 보관해 주세요.')) return;
    const captured = epoch.current;
    try { await lock(() => {
      if (!active(captured) || !readyRef.current || current.current.pending) throw Error('routine_owner_changed');
      const next = { ...current.current, revision: crypto.randomUUID(), active: { ...current.current.active, ...emptyRoutineForm(getLocalDateKey()) } };
      raw.current = persistRoutineDraft(window.localStorage, next, raw.current); install(next);
    }); } catch (error) { if (active(captured)) failCheckpoint(error); }
  }
  const visible = !ownerInvalid && draft.ownerId === owner ? draft : emptyRoutineDraft(owner ?? '', null, getLocalDateKey());
  return { draft: visible, ready: ready && draft.ownerId === owner, saving, storageError, loadError, notice, confirmedRow,
    changeForm, start, save, discardActive, retryCheckpoint: persistCurrent, retryLoad: () => setReload(value => value + 1),
    blocked: !ready || draft.ownerId !== owner || storageError || saving || !!visible.pending };
}
