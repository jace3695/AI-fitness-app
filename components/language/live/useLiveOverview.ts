'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/app/lib/supabase';
import { createLanguageLiveLearningRepository } from '@/app/data/languageLiveLearningRepository';
import { liveOverviewDate, projectLiveOverview, type LiveOverviewProjection } from '@/lib/language-live/overview';
import { LanguageLiveError } from '@/lib/language-live/types';

type SnapshotState = {
  status: 'loading' | 'ready' | 'error' | 'stale';
  overview: LiveOverviewProjection | null;
  message: string;
};
export type LiveOverviewState = SnapshotState & { refresh: () => void };
const loading: SnapshotState = { status: 'loading', overview: null, message: '' };

/** No cache or writes. Auth events synchronously invalidate the request generation,
 * and every refresh independently verifies the owner through the P2 repository.
 */
export function useLiveOverview(client: SupabaseClient | null = supabase): LiveOverviewState {
  const [state, setState] = useState<SnapshotState>(loading);
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  useEffect(() => {
    let alive = true, epoch = 0;
    let owner: string | null = null, verifiedOwner: string | null = null;
    let authTimer: ReturnType<typeof setTimeout> | undefined;
    let midnightTimer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const request = ++epoch;
      setState(loading);
      if (!client) { setState({ status: 'error', overview: null, message: 'Live 저장소 연결 설정을 확인하지 못했어요.' }); return; }
      let requestedOwner: string | null = null;
      try {
        const { data, error } = await client.auth.getUser();
        if (!alive || request !== epoch) return;
        if (error || !data.user) throw new LanguageLiveError('unauthenticated', '로그인 정보를 다시 확인해 주세요.');
        requestedOwner = data.user.id;
        if (owner !== requestedOwner) verifiedOwner = null;
        owner = requestedOwner;
        const snapshot = await createLanguageLiveLearningRepository(client, requestedOwner).readLearning();
        if (!alive || request !== epoch) return;
        if (snapshot.ownerId !== requestedOwner) throw new LanguageLiveError('account_changed', '계정이 바뀌어 이전 기록을 표시하지 않았어요.');
        const overview = projectLiveOverview(snapshot, liveOverviewDate());
        verifiedOwner = requestedOwner;
        setState({ status: 'ready', overview, message: '' });
      } catch (error) {
        if (!alive || request !== epoch) return;
        const accountError = error instanceof LanguageLiveError && ['unauthenticated', 'account_changed'].includes(error.code);
        setState({ status: !accountError && requestedOwner && requestedOwner === verifiedOwner ? 'stale' : 'error', overview: null,
          message: error instanceof LanguageLiveError ? error.message : 'Live 학습 기록을 확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요.' });
      }
    };
    const visibleRefresh = () => { if (document.visibilityState === 'visible') void run(); };
    const suspend = () => { epoch++; setState({ status: verifiedOwner ? 'stale' : 'loading', overview: null, message: '화면을 떠난 뒤 기록이 바뀌었을 수 있어요. 최신 기록을 다시 확인해 주세요.' }); };
    const visibility = () => { if (document.visibilityState === 'visible') void run(); else suspend(); };
    const scheduleMidnight = () => {
      // Next Korean midnight is 15:00 UTC on the current Korean calendar date.
      const delay = Math.max(1, Date.parse(`${liveOverviewDate()}T15:00:00.000Z`) - Date.now() + 100);
      midnightTimer = setTimeout(() => { if (!alive) return; if (document.visibilityState === 'visible') void run(); else suspend(); scheduleMidnight(); }, delay);
    };
    refreshRef.current = () => { void run(); };
    const subscription = client?.auth.onAuthStateChange((event, session) => {
      if (!alive || (owner && session?.user.id === owner && event !== 'SIGNED_OUT')) return;
      epoch++; owner = null; verifiedOwner = null; setState(loading); clearTimeout(authTimer);
      if (!session?.user) { setState({ status: 'error', overview: null, message: '로그인 정보를 다시 확인해 주세요.' }); return; }
      // Supabase auth callbacks must not await an auth request under its lock.
      authTimer = setTimeout(() => { if (alive) void run(); }, 0);
    });
    void run(); scheduleMidnight();
    window.addEventListener('focus', visibleRefresh); window.addEventListener('online', visibleRefresh);
    window.addEventListener('pagehide', suspend); window.addEventListener('pageshow', visibleRefresh);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive = false; epoch++; refreshRef.current = () => {}; clearTimeout(authTimer); clearTimeout(midnightTimer);
      subscription?.data.subscription.unsubscribe();
      window.removeEventListener('focus', visibleRefresh); window.removeEventListener('online', visibleRefresh);
      window.removeEventListener('pagehide', suspend); window.removeEventListener('pageshow', visibleRefresh);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [client]);
  return { ...state, refresh };
}
