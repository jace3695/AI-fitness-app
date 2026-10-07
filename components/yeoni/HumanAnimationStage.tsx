'use client';

import { useCallback } from 'react';
import { mountHumanRenderer } from '@/lib/yeoni/human-renderer';
import { HUMAN_STATIC_PREVIEW } from '@/lib/yeoni/human-art';
import type { SpeechSnapshot } from '@/lib/yeoni/character-controller';
import { useYeoniPreferences } from '@/components/useYeoniPreferences';
import styles from './human-animation.module.css';
import { useCharacterStage, type CharacterStageMount } from './useCharacterStage';

type SpeechProps = { speech?: () => SpeechSnapshot };
/** Isolated human candidate; media snapshots use the same Controller as the cat. */
export default function HumanAnimationStage({ broken = false, assets, speech }: { broken?: boolean; assets?: Record<string, string> } & SpeechProps) {
  const preferences = useYeoniPreferences();
  return preferences.visible ? <Stage enabled={preferences.motion === 'home'} broken={broken} assets={assets} speech={speech} /> : null;
}

function Stage({ enabled, broken, assets, speech }: { enabled: boolean; broken: boolean; assets?: Record<string, string> } & SpeechProps) {
  const mount = useCallback<CharacterStageMount>((surface, options) => mountHumanRenderer(surface, { ...options,
    assetRoot: broken ? '/missing-human/' : undefined, assetUrls: broken ? undefined : assets }), [broken, assets]);
  const { canvas, status, hasSpeech } = useCharacterStage(mount, enabled, { speech });
  return <div className={styles.stage} data-human-status={status}>
    <canvas ref={canvas} className={styles.canvas} aria-label={hasSpeech ? '인간형 연이의 발화 동작' : '인간형 연이의 기본 동작'} role="img" style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }} />
    {status !== 'ready' && <span className={styles.fallback} role="img" aria-label="인간형 연이의 승인된 기본 모습" style={{ backgroundImage: `url("${assets?.['assembled-preview.webp'] ?? HUMAN_STATIC_PREVIEW}")` }} />}
    {status === 'error' && <p className={styles.notice} role="status">연이의 기본 모습을 표시하고 있어요.</p>}
  </div>;
}
