'use client';

import { useEffect, useRef, useState } from 'react';
import { mountCatRenderer, type CatRenderer, type CatRendererStatus } from '@/lib/yeoni/cat-renderer';
import { useYeoniPreferences } from '@/components/useYeoniPreferences';
import styles from './cat-animation.module.css';
import type { Viseme } from '@/lib/yeoni/lip-sync';

/** Isolated PHASE 4 candidate. Not mounted in any production page yet. */
export default function CatAnimationStage({ assetUrl = '/yeoni/cat/poc-atlas-v1.png', paused = false, mouth }: {
  assetUrl?: string; paused?: boolean; mouth?: () => Viseme;
}) {
  const preferences = useYeoniPreferences();
  return preferences.visible ? <Stage assetUrl={assetUrl} enabled={!paused && preferences.motion === 'home'} mouth={mouth} /> : null;
}

function Stage({ assetUrl, enabled, mouth }: { assetUrl: string; enabled: boolean; mouth?: () => Viseme }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<CatRenderer | null>(null);
  const [status, setStatus] = useState<CatRendererStatus>('loading');
  const latestEnabled = useRef(enabled);
  latestEnabled.current = enabled;
  const latestMouth = useRef(mouth);
  latestMouth.current = mouth;
  const hasMouth = !!mouth;
  useEffect(() => {
    if (!canvas.current) return;
    let mounted = true;
    try {
      renderer.current = mountCatRenderer(canvas.current, { assetUrl, enabled: latestEnabled.current,
        mouth: hasMouth ? () => latestMouth.current?.() ?? 'rest' : undefined,
        onStatus: next => { if (mounted) setStatus(next); } });
    } catch { setStatus('error'); }
    return () => { mounted = false; renderer.current?.dispose(); renderer.current = null; };
  }, [assetUrl, hasMouth]);
  useEffect(() => { renderer.current?.setEnabled(enabled); }, [enabled]);
  return <div className={styles.stage} data-cat-status={status}>
    <canvas ref={canvas} className={styles.canvas} aria-hidden="true" style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }} />
    {status !== 'ready' && <span className={styles.fallback} aria-hidden="true"><span /></span>}
    {status === 'error' && <p className={styles.notice} role="status">연이의 기본 모습을 표시하고 있어요.</p>}
  </div>;
}
