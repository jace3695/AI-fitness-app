'use client';

import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';

/** Closing any enclosing guide pauses the player. Reopening never starts it. */
export function useMotionDisclosurePause(panel: RefObject<HTMLElement | null>, setPlaying: Dispatch<SetStateAction<boolean>>) {
  useEffect(() => {
    const disclosures: HTMLDetailsElement[] = [];
    for (let parent = panel.current?.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) disclosures.push(parent);
    }
    const pauseWhenClosed = () => {
      if (disclosures.some(detail => !detail.open)) setPlaying(false);
    };
    disclosures.forEach(detail => detail.addEventListener('toggle', pauseWhenClosed));
    return () => disclosures.forEach(detail => detail.removeEventListener('toggle', pauseWhenClosed));
  }, [panel, setPlaying]);
}
