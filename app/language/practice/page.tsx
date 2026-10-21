'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/app/lib/supabase';
import PracticeWorkspace from './PracticeWorkspace';

export default function PracticePage() {
  const [owner, setOwner] = useState<string | null>(null);
  const [notice, setNotice] = useState('학습 계정을 확인하고 있어요.');
  useEffect(() => {
    let live = true;
    let invalid = false;
    let expected: string | null;
    try { expected = localStorage.getItem('language-cloud-sync-user'); }
    catch { setNotice('브라우저 저장 공간을 읽지 못했어요. 학습 계정을 확인할 수 없어요.'); return; }
    const invalidate = () => {
      invalid = true;
      if (live) { setOwner(null); setNotice('계정이 변경됐거나 확인되지 않았어요. 학습 화면을 다시 열어 주세요.'); }
    };
    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== expected) invalidate();
    }).data.subscription;
    void supabase?.auth.getUser().then(({ data, error }) => {
      if (!live || invalid) return;
      if (error || !expected || data.user?.id !== expected) invalidate();
      else setOwner(expected);
    }).catch(invalidate);
    if (!supabase) invalidate();
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === 'language-cloud-sync-user') invalidate(); };
    window.addEventListener('storage', storage);
    window.addEventListener('yeoni-cloud-session-changed', invalidate);
    return () => { live = false; subscription?.unsubscribe(); window.removeEventListener('storage', storage); window.removeEventListener('yeoni-cloud-session-changed', invalidate); };
  }, []);
  return owner ? <PracticeWorkspace key={owner} owner={owner} /> : <p role="status">{notice}</p>;
}
