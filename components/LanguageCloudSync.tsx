"use client";

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../app/lib/supabase.ts';
import { useAuthenticatedStorageOwner } from '../app/components/AuthenticatedStorageOwner.tsx';
import { isLanguageRecordContextCurrent, type LanguageRecordContext } from '../app/data/languageCloudSync.ts';
import { readPendingLanguageReset } from '../app/data/languageResetFence.ts';
import { LanguageRecordsProvider } from './language/LanguageRecordsProvider.tsx';
import RecordResetPanel from '../app/components/RecordResetPanel.tsx';
import { createLanguageSyncCoordinator } from '../app/data/languageSyncCoordinator.ts';
import { LANGUAGE_BINDING_KEY, LANGUAGE_MARKER_KEY, LANGUAGE_OWNER_KEY, LANGUAGE_RESET_FENCE_KEY, LANGUAGE_STORAGE_KEYS } from '../app/data/languageStorageBoundary.ts';
import { CLOUD_RECORDS_REFRESH_EVENT, CLOUD_SESSION_CHANGED_EVENT, RECORDS_CHANGED_EVENT, STORAGE_JOURNAL_KEY, STORAGE_OWNER_KEY, STORAGE_READY_KEY, STORAGE_SESSION_KEY } from '../app/data/storageTransaction.ts';
import { isRecordResetRunning, RECORD_RESET_EVENT, RECORD_RESET_STORAGE_EVENT } from '../app/data/appRecordReset.ts';

type Coordinator = ReturnType<typeof createLanguageSyncCoordinator>;
type SyncState = { status: 'checking' | 'ready' | 'pending' | 'paused' | 'blocked' | 'error' | 'uncertain'; message: string; initialized: boolean; context?: LanguageRecordContext; reset?: boolean };
const INITIAL: SyncState = { status: 'checking', message: '', initialized: false };
const CONTROL_KEYS = new Set([STORAGE_OWNER_KEY, STORAGE_SESSION_KEY, STORAGE_READY_KEY, STORAGE_JOURNAL_KEY, LANGUAGE_BINDING_KEY, LANGUAGE_OWNER_KEY, LANGUAGE_RESET_FENCE_KEY, LANGUAGE_MARKER_KEY, RECORD_RESET_STORAGE_EVENT]);
const isControl = (key: string | null) => key === null || CONTROL_KEYS.has(key) || key.startsWith('language-cloud-sync-base:') || key.startsWith('language-cloud-sync-ack:');

/** Shipped lifecycle driver, separately testable with synthetic DOM events. */
export function bindLanguageSyncLifecycle(coordinator: Coordinator, signal: AbortSignal, ownerId: string): () => void {
  const resume = () => {
    // Retire old requests before an asynchronous auth/readiness check can begin.
    coordinator.pause('학습 기록을 다시 확인하고 있어요.');
    if (document.visibilityState === 'visible' && !isRecordResetRunning() && !signal.aborted) void coordinator.resume();
  };
  const onStorage = (event: StorageEvent) => {
    try { if (event.storageArea && event.storageArea !== window.localStorage) return; }
    catch { coordinator.pause('기기 저장 공간을 확인하지 못했습니다. 원본은 보존합니다.'); return; }
    if (isControl(event.key)) coordinator.pause('다른 창의 학습 기록 상태를 확인하고 있어요.');
    coordinator.notifyStorage(event.key);
  };
  const onSession = () => { coordinator.pause('로그인 상태를 다시 확인해 주세요.'); };
  const onReset = () => { coordinator.pause('기록 초기화 상태를 확인하고 있어요.'); if (!isRecordResetRunning()) resume(); };
  const onVisibility = () => { if (document.visibilityState === 'hidden') coordinator.pause('다시 열면 학습 기록을 확인합니다.'); else resume(); };
  const onPageHide = () => coordinator.pause('다시 열면 학습 기록을 확인합니다.');
  const onFocus = () => { if (document.visibilityState === 'visible' && !signal.aborted) void coordinator.refresh(); };
  const onRecords = () => coordinator.notifyStorage('records');
  const onRemoteRecords = (event: Event) => {
    if ((event as CustomEvent<{ ownerId?: string }>).detail?.ownerId === ownerId && document.visibilityState === 'visible' && !signal.aborted) void coordinator.refresh();
  };
  let observed = new Map<string, string | null>();
  const poll = () => {
    if (document.visibilityState !== 'visible' || signal.aborted || isRecordResetRunning()) return;
    try {
      const next = new Map(LANGUAGE_STORAGE_KEYS.map(key => [key, window.localStorage.getItem(key)]));
      if (observed.size) for (const [key, value] of next) if (observed.get(key) !== value) coordinator.notifyStorage(key);
      observed = next;
    } catch { coordinator.pause('기기 저장 공간을 확인하지 못했습니다. 원본은 보존합니다.'); }
  };
  poll();
  const localWatch = setInterval(poll, 500);
  const remoteWatch = setInterval(onFocus, 30_000);
  window.addEventListener('storage', onStorage);
  window.addEventListener(CLOUD_SESSION_CHANGED_EVENT, onSession);
  window.addEventListener(RECORDS_CHANGED_EVENT, onRecords);
  window.addEventListener(CLOUD_RECORDS_REFRESH_EVENT, onRemoteRecords);
  window.addEventListener(RECORD_RESET_EVENT, onReset);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', resume);
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', resume);
  document.addEventListener('visibilitychange', onVisibility);
  signal.addEventListener('abort', onSession);
  return () => {
    coordinator.dispose();
    clearInterval(localWatch); clearInterval(remoteWatch);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CLOUD_SESSION_CHANGED_EVENT, onSession);
    window.removeEventListener(RECORDS_CHANGED_EVENT, onRecords);
    window.removeEventListener(CLOUD_RECORDS_REFRESH_EVENT, onRemoteRecords);
    window.removeEventListener(RECORD_RESET_EVENT, onReset);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', resume);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('online', resume);
    document.removeEventListener('visibilitychange', onVisibility);
    signal.removeEventListener('abort', onSession);
  };
}

export default function LanguageCloudSync({ children }: { children?: ReactNode }) {
  const lease = useAuthenticatedStorageOwner();
  const [state, setState] = useState<SyncState>(INITIAL);
  const [pendingReset, setPendingReset] = useState(false);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const coordinatorRef = useRef<Coordinator | null>(null);
  useEffect(() => {
    if (!supabase || !lease) { setState({ ...INITIAL, status: 'error', message: '학습 기록 연결과 로그인 상태를 확인해 주세요.' }); return; }
    const client = supabase;
    let storage: Storage;
    try { storage = window.localStorage; } catch { setState({ ...INITIAL, status: 'error', message: '기기 저장 공간을 확인하지 못했습니다. 원본은 보존합니다.' }); return; }
    let active = true;
    const coordinator = createLanguageSyncCoordinator({
      lease, storage,
      onState: next => {
        if (!active) return;
        // A confirmed reset is a new record generation. Retaining the old raw
        // editor here would let its pre-reset draft repopulate cleared records.
        if (next.reset && next.context && isLanguageRecordContextCurrent(next.context)) setEditorGeneration(value => value + 1);
        try { setPendingReset(Boolean(readPendingLanguageReset(lease.userId))); } catch { setPendingReset(false); }
        setState(next);
      },
      transport: {
        async verifyOwner(userId, signal) {
          const { data, error } = await client.auth.getUser();
          return !signal.aborted && !error && data.user?.id === userId && lease.isCurrent();
        },
        async read(userId, signal) {
          const { data, error } = await client.from('language_user_state').select('state, updated_at').eq('user_id', userId).abortSignal(signal).maybeSingle();
          if (error) throw error;
          return data ? { state: data.state as Record<string, unknown>, updatedAt: data.updated_at as string } : null;
        },
        async insert(userId, state, signal) {
          const { error } = await client.from('language_user_state').insert({ user_id: userId, state, updated_at: new Date().toISOString() }).abortSignal(signal);
          if (error) throw error;
          return true;
        },
        async update(userId, state, expectedUpdatedAt, signal) {
          const { data, error } = await client.from('language_user_state').update({ state, updated_at: new Date().toISOString() })
            .eq('user_id', userId).eq('updated_at', expectedUpdatedAt).select('updated_at').abortSignal(signal).maybeSingle();
          if (error) throw error;
          return Boolean(data);
        },
      },
    });
    coordinatorRef.current = coordinator;
    const cleanup = bindLanguageSyncLifecycle(coordinator, lease.signal, lease.userId);
    if (document.visibilityState === 'visible' && !isRecordResetRunning()) void coordinator.start();
    else coordinator.pause('다시 열면 학습 기록을 확인합니다.');
    return () => { active = false; cleanup(); if (coordinatorRef.current === coordinator) coordinatorRef.current = null; };
  }, [lease]);
  const editable = state.initialized && Boolean(state.context && isLanguageRecordContextCurrent(state.context)) && (state.status === 'ready' || state.status === 'pending');
  const needsAttention = ['error', 'blocked', 'uncertain'].includes(state.status);
  const label = state.status === 'ready' ? '학습 기록 · 서버 저장 확인'
    : state.status === 'pending' ? '학습 기록 · 기기 저장, 서버 반영 대기'
      : needsAttention ? '학습 기록 · 동기화 확인 필요' : '학습 기록 · 상태 확인 중…';
  const retry = () => { void coordinatorRef.current?.resume(); };
  return <>
    {state.initialized && <div key={editorGeneration} hidden={!editable} inert={!editable} aria-hidden={!editable}><LanguageRecordsProvider context={editable ? state.context! : null} refresh={retry}>{children}</LanguageRecordsProvider></div>}
    {!editable && <section style={{ padding: 24 }} aria-live="polite"><p>{state.message || '이 계정의 학습 기록을 준비하고 있어요.'}</p>{needsAttention && <button type="button" className="btn" onClick={retry}>다시 연결하기</button>}</section>}
    {!editable && pendingReset && <RecordResetPanel app="language" />}
    <div role={needsAttention ? 'alert' : 'status'} className={`yeoni-sync-notice fixed z-[95] flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold shadow-md ring-1 backdrop-blur ${needsAttention ? 'bg-red-50/95 text-red-700 ring-red-200' : state.status === 'ready' ? 'bg-emerald-50/95 text-emerald-700 ring-emerald-200' : 'bg-amber-50/95 text-amber-700 ring-amber-200'}`}>
      <span>{label}</span>{needsAttention && <button type="button" onClick={retry} className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-red-700 shadow-sm">다시 시도</button>}
    </div>
  </>;
}
