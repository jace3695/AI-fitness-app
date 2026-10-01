'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useYeoniPreferences } from '@/components/useYeoniPreferences';
import { mountAppearanceStage, type AppearanceStage } from '@/lib/yeoni/appearance-stage';
import type { AppearanceState, CharacterAppearance } from '@/lib/yeoni/appearance-renderer';
import { useCharacterStage, type CharacterControlProps, type CharacterStageMount } from './useCharacterStage';
import styles from './appearance-stage.module.css';
import catStyles from './cat-animation.module.css';

const names = { cat: '고양이형', human: '인간형' };
export default function SwitchableCharacterStage(props: CharacterControlProps & { assets?: Record<string, string> }) {
  const preferences = useYeoniPreferences();
  return preferences.visible ? <Stage {...props} enabled={preferences.motion === 'home'} /> : null;
}

function Stage({ enabled, assets, ...controls }: CharacterControlProps & { enabled: boolean; assets?: Record<string, string> }) {
  const handle = useRef<AppearanceStage | null>(null);
  const [requested, setRequested] = useState<CharacterAppearance>('cat');
  const latest = useRef(requested); latest.current = requested;
  const [appearance, setAppearance] = useState<AppearanceState>({ appearance: null, requested: 'cat', status: 'loading' });
  const mount = useCallback<CharacterStageMount>((surface, options) => {
    const stage = mountAppearanceStage(surface, { ...options, appearance: latest.current, humanAssets: assets, onAppearance: setAppearance });
    handle.current = stage;
    return stage;
  }, [assets]);
  const { canvas, status } = useCharacterStage(mount, enabled, controls);
  useEffect(() => { handle.current?.setAppearance(requested); }, [requested, mount]);
  const failed = appearance.status === 'error' || status === 'error';
  return <div className={styles.root} data-appearance-status={failed ? 'error' : appearance.status}>
    <div className={styles.choices} aria-label="연이 외형 선택">
      {(['cat', 'human'] as const).map(value => <button key={value} aria-pressed={requested === value}
        onClick={() => setRequested(value)}>{names[value]}</button>)}
    </div>
    <div className={styles.stage} aria-busy={appearance.status === 'loading'}>
      <canvas ref={canvas} className={styles.canvas} role="img" aria-label={`${names[appearance.appearance ?? requested]} 연이`}
        style={{ visibility: appearance.appearance ? 'visible' : 'hidden' }} />
      {!appearance.appearance && <span className={`${catStyles.fallback} ${styles.fallback}`} aria-label="연이의 기본 모습" role="img"><span /></span>}
    </div>
    <p className={styles.notice} role="status">{failed ? '모습을 불러오지 못했어요. 현재 모습으로 계속할게요.'
      : appearance.status === 'loading' ? `${names[requested]} 모습을 준비하고 있어요.` : `${names[appearance.appearance ?? requested]} 연이 · 같은 목소리로 이어서 말해요.`}</p>
    {appearance.status === 'error' && status !== 'error' && <button onClick={() => handle.current?.setAppearance(requested)}>다시 불러오기</button>}
  </div>;
}
