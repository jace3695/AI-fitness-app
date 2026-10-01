'use client';

import { useEffect, useRef, useState } from 'react';
import { mountHumanRenderer } from '@/lib/yeoni/human-renderer';
import { HUMAN_STATIC_PREVIEW } from '@/lib/yeoni/human-art';
import type { CharacterStage, CharacterStageStatus } from '@/lib/yeoni/character-stage';
import { useYeoniPreferences } from '@/components/useYeoniPreferences';
import styles from './human-animation.module.css';

/** Isolated PHASE 8 candidate. No production page or speech source is connected. */
export default function HumanAnimationStage({ broken = false, assets }: { broken?: boolean; assets?: Record<string, string> }) {
  const preferences = useYeoniPreferences();
  return preferences.visible ? <Stage enabled={preferences.motion === 'home'} broken={broken} assets={assets} /> : null;
}

function Stage({ enabled, broken, assets }: { enabled: boolean; broken: boolean; assets?: Record<string, string> }) {
  const canvas = useRef<HTMLCanvasElement>(null), renderer = useRef<CharacterStage | null>(null);
  const [status, setStatus] = useState<CharacterStageStatus>('loading');
  const latestEnabled = useRef(enabled); latestEnabled.current = enabled;
  useEffect(() => {
    if (!canvas.current) return;
    let mounted = true;
    try { renderer.current = mountHumanRenderer(canvas.current, { enabled: latestEnabled.current,
      assetRoot: broken ? '/missing-human/' : undefined, assetUrls: broken ? undefined : assets,
      onStatus: next => { if (mounted) setStatus(next); } }); } catch { setStatus('error'); }
    return () => { mounted = false; renderer.current?.dispose(); renderer.current = null; };
  }, [broken, assets]);
  useEffect(() => { renderer.current?.setEnabled(enabled); }, [enabled]);
  return <div className={styles.stage} data-human-status={status}>
    <canvas ref={canvas} className={styles.canvas} aria-label="인간형 연이의 기본 동작" role="img" style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }} />
    {status !== 'ready' && <span className={styles.fallback} role="img" aria-label="인간형 연이의 승인된 기본 모습" style={{ backgroundImage: `url("${assets?.['assembled-preview.webp'] ?? HUMAN_STATIC_PREVIEW}")` }} />}
    {status === 'error' && <p className={styles.notice} role="status">연이의 기본 모습을 표시하고 있어요.</p>}
  </div>;
}
