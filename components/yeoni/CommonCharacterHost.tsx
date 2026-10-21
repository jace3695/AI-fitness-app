'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EMPTY_PLAYBACK } from '@/lib/yeoni/character-controller';
import { isQuietCharacterRoute } from '@/lib/yeoni/common-host-policy';
import { stopAllSpeech } from '@/lib/yeoni/speech-focus';
import { updateYeoniPreferences, useYeoniPreferences } from '../useYeoniPreferences';
import SwitchableCharacterStage from './SwitchableCharacterStage';
import type { CharacterControlProps } from './useCharacterStage';
import styles from './common-character-host.module.css';
import { CHARACTER_RESET_EVENT, CommonCharacterContext, type CharacterChannel } from './CommonCharacterContext';
const emptySpeech = () => ({ manifest: null, playback: EMPTY_PLAYBACK });

/** One renderer per app shell. Only ephemeral control inputs enter this channel;
 * no reply text, owner ID, record, or audio is persisted by the host. */
export default function CommonCharacterHost({ children, path, boundary = 0 }: {
  children: ReactNode; path: string; boundary?: number;
}) {
  const preferences = useYeoniPreferences();
  const [editing, setEditing] = useState(false);
  const quietRequests = useRef(new Set<symbol>());
  const [quietCount, setQuietCount] = useState(0);
  const [controls, setControls] = useState<CharacterControlProps>({});
  const current = useRef<CharacterControlProps | null>(null);
  const scope = `${path}:${boundary}`;
  const liveScope = useRef(scope); liveScope.current = scope;
  const channel = useMemo<CharacterChannel>(() => ({ publish(next) {
    if (liveScope.current !== scope) return () => {};
    current.current = next; setControls(next);
    return () => { if (current.current === next) { current.current = null; setControls({}); } };
  }, requestQuiet() {
    if (liveScope.current !== scope) return () => {};
    const token = Symbol(); quietRequests.current.add(token); setQuietCount(quietRequests.current.size);
    return () => { quietRequests.current.delete(token); setQuietCount(quietRequests.current.size); };
  } }), [scope]);
  const speech = useCallback(() => current.current?.speech?.() ?? emptySpeech(), []);
  useLayoutEffect(() => {
    current.current = null; setControls({}); quietRequests.current.clear(); setQuietCount(0); stopAllSpeech();
    window.dispatchEvent(new Event(CHARACTER_RESET_EVENT));
    return () => { current.current = null; stopAllSpeech(); };
  }, [scope]);
  useEffect(() => {
    const focus = () => {
      const el = document.activeElement;
      setEditing(el instanceof HTMLElement && (el.matches('input,textarea,select') || el.isContentEditable));
    };
    const suspend = () => { if (document.hidden) stopAllSpeech(); };
    document.addEventListener('focusin', focus); document.addEventListener('focusout', focus);
    document.addEventListener('visibilitychange', suspend); focus();
    return () => {
      document.removeEventListener('focusin', focus); document.removeEventListener('focusout', focus);
      document.removeEventListener('visibilitychange', suspend);
    };
  }, []);
  const quiet = editing || quietCount > 0 || isQuietCharacterRoute(path);
  return <CommonCharacterContext.Provider value={channel}>
    <aside className={styles.host} data-yeoni-common-host data-quiet={quiet} aria-label="공통 연이">
      <div className={styles.controls}>
        <strong>연이</strong>
        <button type="button" onClick={() => {
          stopAllSpeech();
          try { updateYeoniPreferences({ visible: !preferences.visible }); } catch { /* Memory fallback. */ }
        }}>{preferences.visible ? '연이 숨기기' : '연이 보이기'}</button>
        <button type="button" onClick={() => {
          try { updateYeoniPreferences({ motion: preferences.motion === 'home' ? 'off' : 'home' }); } catch { /* Memory fallback. */ }
        }}>{preferences.motion === 'home' ? '움직임 끄기' : '움직임 켜기'}</button>
      </div>
      {preferences.visible && <div className={styles.portrait}>
        <SwitchableCharacterStage key={scope} speech={speech} emotion={controls.emotion} gesture={controls.gesture} quiet={quiet} />
      </div>}
    </aside>
    {children}
  </CommonCharacterContext.Provider>;
}
