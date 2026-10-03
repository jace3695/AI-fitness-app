'use client';

import { useEffect, useRef, useState } from 'react';
import { EMPTY_PLAYBACK, type CharacterEmotion, type CharacterGesture, type SpeechSnapshot } from '@/lib/yeoni/character-controller';
import type { CharacterStage, CharacterStageOptions, CharacterStageStatus } from '@/lib/yeoni/character-stage';

export type CharacterStageMount = (canvas: HTMLCanvasElement, options: CharacterStageOptions) => CharacterStage;
export type CharacterControlProps = {
  speech?: () => SpeechSnapshot;
  emotion?: CharacterEmotion;
  gesture?: Readonly<{ id: number; kind: CharacterGesture }> | null;
};

/** React owns resource lifetime; the common DOM host owns the only render loop.
 * A changing speech callback is an input update, not a renderer replacement. */
export function useCharacterStage(mount: CharacterStageMount, enabled: boolean, {
  speech, emotion = 'neutral', gesture,
}: CharacterControlProps) {
  const canvas = useRef<HTMLCanvasElement>(null), stage = useRef<CharacterStage | null>(null);
  const [status, setStatus] = useState<CharacterStageStatus>('loading');
  const latestEnabled = useRef(enabled); latestEnabled.current = enabled;
  const latestSpeech = useRef(speech); latestSpeech.current = speech;
  const hasSpeech = !!speech;
  useEffect(() => {
    if (!canvas.current) return;
    let mounted = true;
    setStatus('loading');
    try {
      stage.current = mount(canvas.current, {
        enabled: latestEnabled.current,
        speech: hasSpeech ? () => latestSpeech.current?.() ?? { manifest: null, playback: EMPTY_PLAYBACK } : undefined,
        onStatus: next => { if (mounted) setStatus(next); },
      });
    } catch { setStatus('error'); }
    return () => { mounted = false; stage.current?.dispose(); stage.current = null; };
  }, [mount, hasSpeech]);
  useEffect(() => { stage.current?.setEnabled(enabled); }, [enabled, mount, hasSpeech]);
  useEffect(() => { stage.current?.setEmotion(emotion); }, [emotion, mount, hasSpeech]);
  const gestureId = gesture?.id, gestureKind = gesture?.kind;
  useEffect(() => {
    if (gestureId !== undefined && gestureKind) stage.current?.requestGesture(gestureKind);
    else stage.current?.cancelGesture();
  }, [gestureId, gestureKind]);
  return { canvas, status, hasSpeech };
}
