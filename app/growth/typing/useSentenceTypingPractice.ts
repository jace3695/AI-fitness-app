'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/app/lib/supabase';
import { RECORD_RESET_EVENT, RECORD_RESET_STORAGE_EVENT, isRecordResetRunning, resetMarkerKey } from '@/app/data/appRecordReset';
import type { GrowthRoutineRow, GrowthSessionRow } from '@/app/data/growthPlatform';
import { getLocalDateKey } from '@/utils/dateKey';
import {
  confirmSentenceTypingSave, emptySentenceTypingDraft, makeSentenceTypingSession,
  parseSentenceTypingDraft, persistSentenceTypingDraft, removeSentenceTypingDraft,
  sentenceTypingDraftKey, shouldResetSentenceTypingDraft, type SentenceTypingDraft,
} from '@/lib/sentence-typing-draft';

/** Sentence-only recovery. Other growth screens keep their existing save contract. */
export function useSentenceTypingPractice(owner: string, isOwnerActive: (id: string) => boolean) {
  const [draft, setDraft] = useState(() => emptySentenceTypingDraft(owner, null));
  const current = useRef(draft);
  const raw = useRef<string | null>(null);
  const alive = useRef(false);
  const working = useRef(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [confirmedRow, setConfirmedRow] = useState<GrowthSessionRow | null>(null);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let cancelled = false;
    alive.current = true;
    const active = () => !cancelled && isOwnerActive(owner);
    setReady(false); setLoadError(false);
    void (async () => {
      try {
        raw.current = window.localStorage.getItem(sentenceTypingDraftKey(owner));
        const recovered = parseSentenceTypingDraft(raw.current, owner);
        if (recovered) { current.current = recovered; setDraft(recovered); }
        const auth = await client.auth.getUser();
        if (!active()) return;
        if (auth.error || auth.data.user?.id !== owner) throw Error('typing_owner_changed');
        const result = await client.from('user_app_state').select('state').eq('user_id', owner).abortSignal(AbortSignal.timeout(15000)).maybeSingle();
        if (!active()) return;
        if (result.error) throw result.error;
        const marker = result.data?.state?.[resetMarkerKey('growth')] ?? null;
        if (marker !== null && typeof marker !== 'string') throw Error('typing_reset_invalid');
        let next = recovered ?? emptySentenceTypingDraft(owner, marker);
        if (recovered && recovered.resetMarker !== marker) {
          // A confirmed app-record reset invalidates earlier recovery data too.
          removeSentenceTypingDraft(window.localStorage, owner, raw.current);
          raw.current = null;
          next = emptySentenceTypingDraft(owner, marker);
          setNotice('기록 초기화 이전의 연습은 다시 저장하지 않아요. 새 연습을 시작해 주세요.');
        } else setNotice(recovered?.pending
          ? '확인하지 못한 저장이 있어요. 같은 기록 다시 확인을 누르면 서버를 먼저 조회해요.'
          : recovered?.typed ? '이 계정에서 작성하던 문장과 시작 시각을 복구했어요.' : '');
        current.current = next; setDraft(next); setStorageError(false); setReady(true);
      } catch {
        if (active()) { setLoadError(true); setNotice('기기 복구 정보나 기록 초기화 상태를 확인하지 못했어요. 원본을 유지했으니 연결과 브라우저 저장 공간을 확인한 뒤 다시 불러와 주세요.'); }
      }
    })();
    const storageChanged = (event: StorageEvent) => {
      if (event.key === sentenceTypingDraftKey(owner) && event.newValue !== raw.current) {
        setStorageError(true); setNotice('다른 창에서 이 연습이 바뀌었어요. 현재 입력은 화면에 유지했어요. 덮어쓰지 않으니 입력을 따로 보관한 뒤 다시 열어 주세요.');
      }
      if (event.key === RECORD_RESET_STORAGE_EVENT) {
        try {
          const reset = JSON.parse(event.newValue ?? 'null');
          if (reset?.userId === owner && reset?.app === 'growth') { setReady(false); setNotice('기록 초기화가 감지됐어요. 이 화면을 다시 열어 주세요.'); }
        } catch { /* Unrelated malformed storage events are not reset instructions. */ }
      }
    };
    const resetChanged = () => {
      if (isRecordResetRunning()) { setReady(false); setNotice('기록 초기화 중에는 연습을 저장할 수 없어요. 완료 후 이 화면을 다시 열어 주세요.'); }
    };
    window.addEventListener('storage', storageChanged);
    window.addEventListener(RECORD_RESET_EVENT, resetChanged);
    return () => {
      cancelled = true; alive.current = false;
      window.removeEventListener('storage', storageChanged);
      window.removeEventListener(RECORD_RESET_EVENT, resetChanged);
    };
  }, [owner, isOwnerActive, reload]);

  const active = () => alive.current && isOwnerActive(owner);
  function checkpoint(next: SentenceTypingDraft) {
    if (!active()) throw Error('typing_owner_changed');
    raw.current = persistSentenceTypingDraft(window.localStorage, next, raw.current);
    setStorageError(false);
  }
  function checkpointFailed(error: unknown) {
    setStorageError(true);
    setNotice(error instanceof Error && error.message === 'typing_draft_changed'
      ? '다른 창에서 이 연습이 바뀌었어요. 현재 입력은 화면에 유지했어요. 덮어쓰지 않으니 입력을 따로 보관한 뒤 다시 열어 주세요.'
      : '이 기기에 입력을 보관하지 못했어요. 화면을 닫기 전에 입력을 따로 보관하거나 기기 임시 저장을 다시 시도해 주세요.');
  }
  function changeInput(value: string) {
    if (!active() || !ready || working.current || saved || current.current.pending || storageError) return;
    const typed = value.slice(0, current.current.passage.length);
    const next = { ...current.current, typed, startedAt: current.current.startedAt ?? (typed ? Date.now() : null) };
    current.current = next; setDraft(next);
    try { checkpoint(next); setNotice(''); } catch (error) { checkpointFailed(error); }
  }
  function retryCheckpoint() {
    if (!active() || working.current) return;
    try { checkpoint(current.current); setNotice('이 기기에 입력을 보관했어요.'); } catch (error) { checkpointFailed(error); }
  }
  function reset(nextPassage = current.current.passageIndex) {
    if (!active() || !ready || storageError || !shouldResetSentenceTypingDraft(current.current, saved, working.current, () => window.confirm('저장하지 않은 이번 연습을 지우고 이동할까요?'))) return false;
    const next = emptySentenceTypingDraft(owner, current.current.resetMarker, nextPassage);
    try { checkpoint(next); } catch (error) { checkpointFailed(error); return false; }
    current.current = next; setDraft(next); setSaved(false); setConfirmedRow(null); setNotice('');
    return true;
  }
  async function save(routine: GrowthRoutineRow | null) {
    if (!supabase || !active() || !ready || working.current || saved || storageError || !current.current.typed || (!current.current.pending && (!routine || routine.user_id !== owner))) return;
    const client = supabase;
    const retry = !!current.current.pending;
    const snapshot = current.current.pending ? current.current : { ...current.current, pending: makeSentenceTypingSession(current.current, routine!, crypto.randomUUID(), getLocalDateKey(), Date.now()) };
    const session = snapshot.pending!;
    working.current = true; setSaving(true);
    current.current = snapshot; setDraft(snapshot);
    let staged = false;
    try {
      const assertOwner = async () => {
        if (!active()) throw Error('typing_owner_changed');
        const auth = await client.auth.getUser();
        if (!active() || auth.error || auth.data.user?.id !== owner) throw Error('typing_owner_changed');
        if (window.localStorage.getItem(sentenceTypingDraftKey(owner)) !== raw.current) throw Error('typing_draft_changed');
      };
      const run = async () => {
        // Stage under the same-origin save lock so two restored tabs cannot both
        // allocate different IDs from one pre-save checkpoint. No mutation can
        // begin until this exact payload survives the synchronous read-back.
        checkpoint(snapshot); staged = true;
        await assertOwner();
        if (isRecordResetRunning()) throw Error('typing_reset_changed');
        const reset = await client.from('user_app_state').select('state').eq('user_id', owner).abortSignal(AbortSignal.timeout(15000)).maybeSingle();
        await assertOwner();
        if (reset.error) throw Error('typing_save_unconfirmed');
        if ((reset.data?.state?.[resetMarkerKey('growth')] ?? null) !== snapshot.resetMarker) throw Error('typing_reset_changed');
        return confirmSentenceTypingSave(owner, session, retry, {
          assertOwner,
          read: async () => client.from('growth_sessions').select('*').eq('user_id', owner).eq('id', session.id).abortSignal(AbortSignal.timeout(15000)).maybeSingle(),
          insert: async () => {
            // The RPC shares the server reset transaction lock. A marker GET alone
            // cannot fence a reset committed from another device before this write.
            const result = await client.rpc('save_sentence_typing_session', {
              p_expected_owner: owner, p_expected_reset_marker: snapshot.resetMarker,
              p_payload: {
                id: session.id, user_id: owner, routine_id: session.routineId, session_date: session.sessionDate,
                status: session.status, planned_minutes: session.plannedMinutes, actual_minutes: session.actualMinutes,
                memo: session.memo, source: session.source, metrics: session.metrics,
                started_at: session.startedAt, ended_at: session.endedAt, updated_at: session.endedAt,
              },
            }).abortSignal(AbortSignal.timeout(15000));
            if (result.error?.message === 'typing_reset_changed') throw Error('typing_reset_changed');
            if (result.error?.code === 'PGRST202' || result.error?.code === '42883') throw Error('typing_save_schema_unavailable');
            return result;
          },
        });
      };
      // Coordinate with existing same-origin record-reset and growth migration operations.
      const row = 'locks' in navigator ? await navigator.locks.request('ai-yeoni-growth-sync', { mode: 'exclusive' }, run) : await run();
      if (!active()) return;
      setSaved(true); setConfirmedRow(row);
      try {
        removeSentenceTypingDraft(window.localStorage, owner, raw.current); raw.current = null;
        setNotice('속도와 정확도를 클라우드에 저장했어요.');
      } catch {
        setNotice('클라우드 저장을 확인했어요. 기기 복구 정보는 남아 있어 새로고침하면 같은 기록을 다시 확인할 수 있어요.');
      }
    } catch (error) {
      if (!active()) return;
      if (!staged || error instanceof Error && error.message === 'typing_draft_changed') checkpointFailed(error);
      else if (error instanceof Error && error.message === 'typing_reset_changed') {
        setReady(false); setNotice('기록 초기화 이후에는 이전 연습을 다시 저장하지 않아요. 이 화면을 다시 열어 주세요.');
      } else if (error instanceof Error && error.message === 'typing_save_schema_unavailable') {
        setNotice('저장 기능 업데이트가 아직 서버에 반영되지 않았어요. 입력과 같은 요청은 이 기기에 보관했어요. 업데이트 후 같은 기록 다시 확인을 눌러 주세요.');
      } else setNotice(error instanceof Error && error.message === 'typing_save_conflict'
        ? '같은 ID의 서버 기록이 달라요. 덮어쓰지 않았고 기기 입력도 유지했어요. 기록을 확인해 주세요.'
        : '저장 결과를 확인하지 못했어요. 입력과 같은 요청을 이 기기에 보관했어요. 연결 후 같은 기록 다시 확인을 눌러 주세요.');
    } finally {
      working.current = false;
      if (active()) setSaving(false);
    }
  }
  return { draft, ready, saving, saved, notice, storageError, loadError, confirmedRow, changeInput, reset, save, retryCheckpoint, retryLoad: () => setReload(value => value + 1) };
}
