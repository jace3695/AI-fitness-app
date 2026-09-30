'use client';

import { useEffect, useRef, useState } from 'react';
import { mountCatRenderer, type CatRenderer, type CatRendererStatus } from '@/lib/yeoni/cat-renderer';
import { useYeoniPreferences } from '@/components/useYeoniPreferences';
import styles from './cat-animation.module.css';
import { EMPTY_PLAYBACK, type CharacterEmotion, type CharacterGesture, type SpeechSnapshot } from '@/lib/yeoni/character-controller';
import { CAT_MOTION_ASSET } from '@/lib/yeoni/cat-art';

type ExpressionProps = { expressive?: boolean; emotion?: CharacterEmotion; gesture?: Readonly<{ id: number; kind: CharacterGesture }> | null };

/** Isolated PHASE 4 candidate. Not mounted in any production page yet. */
export default function CatAnimationStage({ assetUrl = CAT_MOTION_ASSET, paused = false, speech, expressive = false, emotion = 'neutral', gesture }: {
  assetUrl?: string; paused?: boolean; speech?: () => SpeechSnapshot;
} & ExpressionProps) {
  const preferences = useYeoniPreferences();
  return preferences.visible ? <Stage assetUrl={assetUrl} enabled={!paused && preferences.motion === 'home'} speech={speech} expressive={expressive} emotion={emotion} gesture={gesture} /> : null;
}

function Stage({ assetUrl, enabled, speech, expressive, emotion, gesture }: { assetUrl: string; enabled: boolean; speech?: () => SpeechSnapshot } & ExpressionProps) {
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
      renderer.current = mountCatRenderer(canvas.current, { assetUrl, enabled: latestEnabled.current, expressive,
        speech: hasSpeech ? () => latestSpeech.current?.() ?? { manifest: null, playback: EMPTY_PLAYBACK } : undefined,
        onStatus: next => { if (mounted) setStatus(next); } });
    } catch { setStatus('error'); }
    return () => { mounted = false; renderer.current?.dispose(); renderer.current = null; };
  }, [assetUrl, hasSpeech, expressive]);
  useEffect(() => { renderer.current?.setEnabled(enabled); }, [enabled]);
  useEffect(() => { renderer.current?.setEmotion(emotion ?? 'neutral'); }, [emotion, assetUrl, expressive, hasSpeech]);
  useEffect(() => { if (gesture) renderer.current?.requestGesture(gesture.kind); else renderer.current?.cancelGesture(); }, [gesture]);
  return <div className={styles.stage} data-cat-status={status}>
    <canvas ref={canvas} className={styles.canvas} aria-hidden="true" style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }} />
    {status !== 'ready' && <span className={styles.fallback} aria-hidden="true"><span /></span>}
    {status === 'error' && <p className={styles.notice} role="status">연이의 기본 모습을 표시하고 있어요.</p>}
  </div>;
}
