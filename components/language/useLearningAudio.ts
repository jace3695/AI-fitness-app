"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { speakJapaneseWithPreferredTts } from "@/utils/speakJapanese";

export function useLearningAudio() {
  const controller = useRef<AbortController | null>(null);
  const [playing, setPlaying] = useState(false);
  const [audioError, setAudioError] = useState("");
  const stop = useCallback(() => { controller.current?.abort(); controller.current = null; setPlaying(false); }, []);
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { controller.current?.abort(); controller.current = null; document.removeEventListener("visibilitychange", onVisibility); };
  }, [stop]);
  const play = useCallback(async (text: string, rate = 0.9, repeatCount = 1) => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setPlaying(true);
    setAudioError("");
    try {
      await speakJapaneseWithPreferredTts(text, { rate, repeatCount, repeatDelayMs: 500, signal: request.signal });
    } catch {
      if (!request.signal.aborted) setAudioError("소리를 재생하지 못했어요. 기기의 소리·일본어 음성 설정을 확인하거나, 읽는 법을 보며 계속해 주세요.");
    } finally {
      if (controller.current === request) { controller.current = null; setPlaying(false); }
    }
  }, []);
  return { play, stop, playing, audioError };
}
