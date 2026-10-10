"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { supabase } from '@/app/lib/supabase';
import { captureStorageOwner, CLOUD_SESSION_CHANGED_EVENT, STORAGE_SESSION_KEY, STORAGE_OWNER_KEY, STORAGE_READY_KEY } from '@/app/data/storageTransaction';
import { RECORD_RESET_EVENT, RECORD_RESET_STORAGE_EVENT, isRecordResetRunning, resetMarkerKey } from '@/app/data/appRecordReset';
import { SavedHandwritingReader, ComparisonReadError, type ComparisonTransport } from '@/lib/handwriting-comparison-reader';

const sessionFields = 'id,user_id,session_date,created_at,source,status,metrics,actual_minutes';
const resourceFields = 'id,user_id,storage_path,mime_type,size_bytes';
const unconfirmed = () => new ComparisonReadError('read_unconfirmed');
/** Authenticated originals only. No signed URL, image transform or mutation surface. */
export function comparisonTransport(owner: string, active: () => boolean): ComparisonTransport {
  const client = supabase;
  const requireClient = () => { if (!client) throw unconfirmed(); return client; };
  return {
    active,
    epoch() { const token = captureStorageOwner(); if (token.userId !== owner || !token.epoch) throw unconfirmed(); return token.epoch; },
    async authenticate(signal) { if (signal.aborted) throw unconfirmed(); const result = await requireClient().auth.getUser(); if (result.error || signal.aborted) throw unconfirmed(); return result.data.user?.id ?? null; },
    async marker(id, signal) {
      const result = await requireClient().from('user_app_state').select('state').eq('user_id', id).abortSignal(signal).maybeSingle();
      if (result.error) throw unconfirmed();
      if (result.data === null) return null;
      const state: unknown = result.data?.state;
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw unconfirmed();
      const value = (state as Record<string, unknown>)[resetMarkerKey('growth')];
      if (value === undefined) return null;
      // Explicit null is not an absent key and cannot certify a reset generation.
      if (typeof value !== 'string' || !value.length || value.length > 200) throw unconfirmed();
      return value;
    },
    async page(id, after, limit, signal) {
      let query = requireClient().from('growth_sessions').select(sessionFields).eq('user_id', id).eq('source', 'handwriting').eq('status', 'completed').order('id', { ascending: true }).limit(limit);
      if (after) query = query.gt('id', after);
      const result = await query.abortSignal(signal); if (result.error || !Array.isArray(result.data)) throw unconfirmed(); return result.data;
    },
    async session(id, sessionId, signal) { const result = await requireClient().from('growth_sessions').select(sessionFields).eq('user_id', id).eq('id', sessionId).abortSignal(signal).maybeSingle(); if (result.error) throw unconfirmed(); return result.data; },
    async resource(id, resourceId, signal) { const result = await requireClient().from('growth_resources').select(resourceFields).eq('user_id', id).eq('id', resourceId).abortSignal(signal).maybeSingle(); if (result.error) throw unconfirmed(); return result.data; },
    async links(id, resourceId, signal) {
      // Check all surviving claims, even outside the loaded page or supported schemas.
      const result = await requireClient().from('growth_sessions').select('id').eq('user_id', id).contains('metrics', { resourceId }).limit(2).abortSignal(signal);
      if (result.error || !Array.isArray(result.data)) throw unconfirmed(); return result.data;
    },
    async download(path, signal) {
      const result = await requireClient().storage.from('growth-resources').download(path, {}, { cache: 'no-store', signal });
      if (result.error) {
        const code = (result.error as { code?: string; statusCode?: string }).code;
        if (code === 'NoSuchKey' || code === 'not_found' || String((result.error as { statusCode?: string }).statusCode) === '404') throw new ComparisonReadError('image_unavailable');
        throw unconfirmed();
      }
      if (!result.data) throw unconfirmed(); return result.data;
    },
    async hash(bytes) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)), byte => byte.toString(16).padStart(2, '0')).join(''); },
    decode(blob, signal) {
      return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(unconfirmed()); return; }
        const image = new Image(), url = URL.createObjectURL(blob); let finished = false;
        const finish = (ok: boolean) => {
          if (finished) return; finished = true;
          const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
          image.onload = null; image.onerror = null; image.removeAttribute('src'); URL.revokeObjectURL(url); signal.removeEventListener('abort', abort);
          if (ok) resolve(dimensions); else reject(new ComparisonReadError('image_unavailable'));
        };
        const abort = () => finish(false); signal.addEventListener('abort', abort, { once: true });
        image.onload = () => finish(true); image.onerror = () => finish(false); image.src = url;
      });
    },
    createUrl: blob => URL.createObjectURL(blob), revokeUrl: url => URL.revokeObjectURL(url),
  };
}

export function useSavedHandwritingComparison(owner: string, isOwnerActive: (id: string) => boolean, injected?: ComparisonTransport) {
  const ownerRef = useRef(owner), activeRef = useRef(isOwnerActive);
  ownerRef.current = owner; activeRef.current = isOwnerActive;
  const [reader] = useState(() => {
    const active = () => ownerRef.current === owner && activeRef.current(owner) && !isRecordResetRunning();
    const transport = injected ? { ...injected, active: () => active() && injected.active() } : comparisonTransport(owner, active);
    return new SavedHandwritingReader(owner, transport);
  });
  const snapshot = useSyncExternalStore(reader.subscribe, reader.snapshot, reader.snapshot);
  useEffect(() => {
    let alive = true; reader.activate();
    const hide = (reason?: string) => { if (alive) flushSync(() => reader.invalidate(reason)); };
    const resume = () => { if (alive && document.visibilityState !== 'hidden' && !isRecordResetRunning()) void reader.resume(); };
    const suspend = (reason: string) => { if (alive) flushSync(() => reader.suspend(reason)); };
    const onHidden = () => { if (document.visibilityState === 'hidden') suspend('다시 열 때 계정과 기록을 확인해요.'); else resume(); };
    // pagehide clears DOM pixels before BFCache can preserve a private pane.
    const pagehide = () => suspend('다시 열 때 계정과 기록을 확인해요.');
    const onSession = () => {
      hide();
      // The same event signals both invalidation and completed owner preparation.
      // epoch() fails closed before preparation; the completion event gets one fresh read.
      if (alive && !isRecordResetRunning()) void reader.refresh();
    };
    const onReset = () => { if (isRecordResetRunning()) suspend('초기화 상태를 확인하는 동안 이미지를 숨겼어요.'); else resume(); };
    const storage = (event: StorageEvent) => {
      if ([STORAGE_SESSION_KEY, STORAGE_OWNER_KEY, STORAGE_READY_KEY].includes(event.key ?? '') || event.key === null) { onSession(); return; }
      if (event.key === RECORD_RESET_STORAGE_EVENT) {
        try { const value = JSON.parse(event.newValue ?? 'null'); if (value?.userId === owner && value?.app === 'growth') hide(); } catch { /* Unrelated malformed cross-tab notices cannot supply an identity. */ }
      }
    };
    const subscription = supabase?.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || session?.user.id !== owner) hide();
      // Same-session TOKEN_REFRESHED does not discard the pair. Epoch is checked at every boundary.
    }).data.subscription;
    window.addEventListener(CLOUD_SESSION_CHANGED_EVENT, onSession);
    window.addEventListener(RECORD_RESET_EVENT, onReset); window.addEventListener('storage', storage);
    window.addEventListener('focus', resume); window.addEventListener('pageshow', resume); window.addEventListener('pagehide', pagehide);
    document.addEventListener('visibilitychange', onHidden);
    void reader.refresh();
    return () => {
      alive = false; subscription?.unsubscribe(); reader.dispose();
      window.removeEventListener(CLOUD_SESSION_CHANGED_EVENT, onSession);
      window.removeEventListener(RECORD_RESET_EVENT, onReset); window.removeEventListener('storage', storage);
      window.removeEventListener('focus', resume); window.removeEventListener('pageshow', resume); window.removeEventListener('pagehide', pagehide);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [owner, reader]);
  return { ...snapshot, reader };
}
