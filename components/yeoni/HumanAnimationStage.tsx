'use client';

import { useEffect, useRef, useState } from 'react';
import { mountHumanRenderer } from '@/lib/yeoni/human-renderer';
import { HUMAN_STATIC_PREVIEW } from '@/lib/yeoni/human-art';
import type { CharacterStage, CharacterStageStatus } from '@/lib/yeoni/character-stage';
import { EMPTY_PLAYBACK, type SpeechSnapshot } from '@/lib/yeoni/character-controller';
import { useYeoniPreferences } from '@/components/useYeoniPreferences';
import styles from './human-animation.module.css';

type SpeechProps = { speech?: () => SpeechSnapshot };
/** Isolated human candidate; media snapshots use the same Controller as the cat. */
export default function HumanAnimationStage({ broken = false, assets, speech }: { broken?: boolean; assets?: Record<string, string> } & SpeechProps) {
  const preferences = useYeoniPreferences();
  return preferences.visible ? <Stage enabled={preferences.motion === 'home'} broken={broken} assets={assets} speech={speech} /> : null;
}

function Stage({ enabled, broken, assets, speech }: { enabled: boolean; broken: boolean; assets?: Record<string, string> } & SpeechProps) {
  const canvas = useRef<HTMLCanvasElement>(null), renderer = useRef<CharacterStage | null>(null);
  const [status, setStatus] = useState<CharacterStageStatus>('loading');
  const latestEnabled = useRef(enabled); latestEnabled.current = enabled;
  const latestSpeech = useRef(speech); latestSpeech.current = speech;
  const hasSpeech = !!speech;
  useEffect(() => {
    if (!canvas.current) return;
    let mounted = true;
    try { renderer.current = mountHumanRenderer(canvas.current, { enabled: latestEnabled.current,
      assetRoot: broken ? '/missing-human/' : undefined, assetUrls: broken ? undefined : assets,
      speech: hasSpeech ? () => latestSpeech.current?.() ?? { manifest: null, playback: EMPTY_PLAYBACK } : undefined,
      onStatus: next => { if (mounted) setStatus(next); } }); } catch { setStatus('error'); }
    return () => { mounted = false; renderer.current?.dispose(); renderer.current = null; };
  }, [broken, assets, hasSpeech]);
  useEffect(() => { renderer.current?.setEnabled(enabled); }, [enabled]);
  return <div className={styles.stage} data-human-status={status}>
    <canvas ref={canvas} className={styles.canvas} aria-label={hasSpeech ? '인간형 연이의 발화 동작' : '인간형 연이의 기본 동작'} role="img" style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }} />
    {status !== 'ready' && <span className={styles.fallback} role="img" aria-label="인간형 연이의 승인된 기본 모습" style={{ backgroundImage: `url("${assets?.['assembled-preview.webp'] ?? HUMAN_STATIC_PREVIEW}")` }} />}
    {status === 'error' && <p className={styles.notice} role="status">연이의 기본 모습을 표시하고 있어요.</p>}
  </div>;
}
