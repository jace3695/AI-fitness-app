'use client';

import { useEffect, useRef, useState } from 'react';
import { mountCatRenderer, type CatRenderer, type CatRendererStatus } from '@/lib/yeoni/cat-renderer';
import { useYeoniPreferences } from '@/components/useYeoniPreferences';
import styles from './cat-animation.module.css';
import { EMPTY_PLAYBACK, type SpeechSnapshot } from '@/lib/yeoni/character-controller';

/** Isolated PHASE 4 candidate. Not mounted in any production page yet. */
export default function CatAnimationStage({ assetUrl = '/yeoni/cat/poc-atlas-v1.png', paused = false, speech }: {
  assetUrl?: string; paused?: boolean; speech?: () => SpeechSnapshot;
}) {
  const preferences = useYeoniPreferences();
  return preferences.visible ? <Stage assetUrl={assetUrl} enabled={!paused && preferences.motion === 'home'} speech={speech} /> : null;
}

function Stage({ assetUrl, enabled, speech }: { assetUrl: string; enabled: boolean; speech?: () => SpeechSnapshot }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<CatRenderer | null>(null);
  const [status, setStatus] = useState<CatRendererStatus>('loading');
  const latestEnabled = useRef(enabled);
  latestEnabled.current = enabled;
  const latestSpeech = useRef(speech);
  latestSpeech.current = speech;
  const hasSpeech = !!speech;
  useEffect(() => {
    if (!canvas.current) return;
    let mounted = true;
    try {
      renderer.current = mountCatRenderer(canvas.current, { assetUrl, enabled: latestEnabled.current,
        speech: hasSpeech ? () => latestSpeech.current?.() ?? { manifest: null, playback: EMPTY_PLAYBACK } : undefined,
        onStatus: next => { if (mounted) setStatus(next); } });
    } catch { setStatus('error'); }
    return () => { mounted = false; renderer.current?.dispose(); renderer.current = null; };
  }, [assetUrl, hasSpeech]);
  useEffect(() => { renderer.current?.setEnabled(enabled); }, [enabled]);
  return <div className={styles.stage} data-cat-status={status}>
    <canvas ref={canvas} className={styles.canvas} aria-hidden="true" style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }} />
    {status !== 'ready' && <span className={styles.fallback} aria-hidden="true"><span /></span>}
    {status === 'error' && <p className={styles.notice} role="status">연이의 기본 모습을 표시하고 있어요.</p>}
  </div>;
}
