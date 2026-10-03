'use client';

import { useCallback } from 'react';
import { mountCatRenderer } from '@/lib/yeoni/cat-renderer';
import { useYeoniPreferences } from '@/components/useYeoniPreferences';
import styles from './cat-animation.module.css';
import type { SpeechSnapshot } from '@/lib/yeoni/character-controller';
import { CAT_MOTION_ASSET } from '@/lib/yeoni/cat-art';
import { useCharacterStage, type CharacterControlProps, type CharacterStageMount } from './useCharacterStage';

type ExpressionProps = { expressive?: boolean } & CharacterControlProps;

/** Isolated PHASE 4 candidate. Not mounted in any production page yet. */
export default function CatAnimationStage({ assetUrl = CAT_MOTION_ASSET, paused = false, speech, expressive = false, emotion = 'neutral', gesture }: {
  assetUrl?: string; paused?: boolean; speech?: () => SpeechSnapshot;
} & ExpressionProps) {
  const preferences = useYeoniPreferences();
  return preferences.visible ? <Stage assetUrl={assetUrl} enabled={!paused && preferences.motion === 'home'} speech={speech} expressive={expressive} emotion={emotion} gesture={gesture} /> : null;
}

function Stage({ assetUrl, enabled, speech, expressive, emotion, gesture }: { assetUrl: string; enabled: boolean; speech?: () => SpeechSnapshot } & ExpressionProps) {
  const mount = useCallback<CharacterStageMount>((surface, options) => mountCatRenderer(surface, { ...options, assetUrl, expressive }), [assetUrl, expressive]);
  const { canvas, status } = useCharacterStage(mount, enabled, { speech, emotion, gesture });
  return <div className={styles.stage} data-cat-status={status}>
    <canvas ref={canvas} className={styles.canvas} aria-hidden="true" style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }} />
    {status !== 'ready' && <span className={styles.fallback} aria-hidden="true"><span /></span>}
    {status === 'error' && <p className={styles.notice} role="status">연이의 기본 모습을 표시하고 있어요.</p>}
  </div>;
}
