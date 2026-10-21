'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from '@/app/lib/supabase';
import { isCharacterReviewRoute } from '@/lib/yeoni/common-host-policy';
import { stopAllSpeech } from '@/lib/yeoni/speech-focus';
import CommonCharacterHost from './CommonCharacterHost';
import { CHARACTER_RESET_EVENT } from './CommonCharacterContext';

export default function CommonCharacterShell({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const path = usePathname();
  const [boundary, setBoundary] = useState(0);
  useEffect(() => {
    if (!enabled || !supabase) return;
    let previous: string | null | undefined;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const owner = session?.user.id ?? null;
      if (owner !== previous || event === 'SIGNED_OUT' || event === 'PASSWORD_RECOVERY') {
        previous = owner;
        stopAllSpeech();
        window.dispatchEvent(new Event(CHARACTER_RESET_EVENT));
        setBoundary(value => value + 1);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [enabled]);
  if (!enabled || isCharacterReviewRoute(path)) return children;
  return <CommonCharacterHost path={path} boundary={boundary}>{children}</CommonCharacterHost>;
}
