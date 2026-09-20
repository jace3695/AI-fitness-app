'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase';
import { prepareZephyrSpeech, ZephyrAudioCache } from '@/lib/zephyr-playback';

const cache = new ZephyrAudioCache();
const playEvent = 'yeoni-zephyr-play';
let synthesisQueue: Promise<unknown> = Promise.resolve();
let lastSubmission = 0;

// The server reserves at most one request per five seconds. A quick exercise
// change followed by timer start must not consume a cue's attempt on TOO_FAST.
function scheduleSynthesis(send: () => Promise<Response>) {
  const pending = synthesisQueue.then(async () => {
    const delay = Math.max(0, lastSubmission + 5500 - Date.now());
    if (delay) await new Promise(resolve => window.setTimeout(resolve, delay));
    return send();
  });
  synthesisQueue = pending.then(() => undefined, () => undefined);
  return pending;
}
// A short silent WAV unlocks this same media element during the timer's gesture.
const silence = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAESsAAABAAgAZGF0YQIAAACAgA==';

export function useWorkoutVoice(enabled: boolean, initialMessage = '') {
  const audio = useRef<HTMLAudioElement>(null);
  const id = useId();
  const alive = useRef(false);
  const enabledRef = useRef(enabled);
  const owner = useRef<string | null>(null);
  const version = useRef(0);
  const unlocked = useRef(false);
  const source = useRef('');
  const needsReload = useRef(false);
  const firstMessage = useRef(initialMessage);
  const firstAnnounced = useRef(false);
  const [readyOwner, setReadyOwner] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [replayAvailable, setReplayAvailable] = useState(false);

  const stop = useCallback(() => {
    version.current++;
    source.current = ''; unlocked.current = false; needsReload.current = false;
    audio.current?.pause();
    audio.current?.removeAttribute('src');
    setReplayAvailable(false);
    setNotice('');
    setAnnouncement('');
  }, []);

  useEffect(() => {
    alive.current = true;
    const element = audio.current;
    const generation = version;
    const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (owner.current !== next) { stop(); cache.clear(); }
      owner.current = next;
      setReadyOwner(next);
    });
    const stopOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) stop();
    };
    window.addEventListener(playEvent, stopOther);
    const suspend = () => {
      if (document.visibilityState !== 'hidden') return;
      element?.pause(); unlocked.current = false; needsReload.current = true;
    };
    document.addEventListener('visibilitychange', suspend);
    return () => {
      alive.current = false; generation.current++;
      element?.pause(); element?.removeAttribute('src'); element?.load();
      subscription.unsubscribe(); window.removeEventListener(playEvent, stopOther);
      document.removeEventListener('visibilitychange', suspend);
    };
  }, [id, stop]);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) stop();
  }, [enabled, stop]);

  const unlock = useCallback(() => {
    const element = audio.current;
    if (!enabledRef.current || !element || unlocked.current || element.getAttribute('src')) return;
    element.src = silence;
    void element.play().then(() => {
      if (alive.current && element.getAttribute('src') === silence) unlocked.current = true;
    }).catch(() => {
      // A cached cue can replace the silent source before this rejection arrives.
      // Never let that old failure erase the newly assigned voice audio.
      if (element.getAttribute('src') === silence) element.removeAttribute('src');
    });
  }, []);

  const load = useCallback(async (message: string) => {
    const { data: { session } } = await createClient().auth.getSession();
    const userId = session?.user.id;
    if (!alive.current || !enabledRef.current || !userId || owner.current !== userId) throw new Error('로그인 계정을 다시 확인해 주세요.');
    const result = await cache.get(userId, prepareZephyrSpeech(message).text, {
      storage: window.sessionStorage, retainWorkoutAudio: true,
      request: async init => {
        const send = async () => {
          init.signal?.throwIfAborted();
          const { data: { session: current } } = await createClient().auth.getSession();
          if (!alive.current || !enabledRef.current || current?.user.id !== userId || owner.current !== userId) throw new Error('운동 음성 준비를 중단했어요.');
          const headers = new Headers(init.headers);
          headers.set('Authorization', `Bearer ${current.access_token}`);
          if (init.method === 'POST') lastSubmission = Date.now();
          return fetch('/api/tts', { ...init, headers });
        };
        return init.method === 'POST' ? scheduleSynthesis(send) : send();
      },
    });
    if (owner.current !== userId) throw new Error('로그인 계정이 바뀌었어요.');
    return result;
  }, []);

  const reportError = useCallback((error: unknown) => {
    setNotice(error instanceof Error && error.name !== 'TimeoutError' && error.name !== 'TypeError'
      ? error.message : '연이 음성을 준비하지 못했어요. 화면 안내와 타이머는 계속 사용할 수 있어요.');
  }, []);

  const prepare = useCallback((message: string) => {
    if (!enabledRef.current) return;
    unlock();
    const ticket = version.current;
    setNotice('연이 음성 준비 중…');
    void load(message).then(() => {
      if (alive.current && enabledRef.current && ticket === version.current) setNotice('');
    }).catch(error => {
      if (alive.current && enabledRef.current && ticket === version.current) reportError(error);
    });
  }, [load, reportError, unlock]);

  const speak = useCallback((message: string) => {
    if (!enabledRef.current) return;
    unlock();
    const ticket = ++version.current;
    audio.current?.pause();
    setReplayAvailable(false); setAnnouncement(message); setNotice('연이 음성 준비 중…');
    void load(message).then(async result => {
      const element = audio.current;
      // Never play a late response after a new cue, mute, exit, or account switch.
      if (!alive.current || !enabledRef.current || ticket !== version.current || !element) return;
      source.current = `data:audio/mpeg;base64,${result.audioContent}`;
      element.src = source.current;
      needsReload.current = false;
      setReplayAvailable(true); setNotice('');
      if (document.visibilityState === 'hidden') {
        needsReload.current = true;
        setNotice('안내 재생을 눌러 연이 음성을 들어 주세요.'); return;
      }
      window.dispatchEvent(new CustomEvent(playEvent, { detail: id }));
      try { await element.play(); }
      catch { if (alive.current && ticket === version.current) { needsReload.current = true; setNotice('안내 재생을 눌러 연이 음성을 들어 주세요.'); } }
    }).catch(error => {
      if (alive.current && enabledRef.current && ticket === version.current) reportError(error);
    });
  }, [id, load, reportError, unlock]);

  useEffect(() => {
    if (!readyOwner || !enabled || firstAnnounced.current || !firstMessage.current) return;
    firstAnnounced.current = true;
    if (version.current <= 1) speak(firstMessage.current);
  }, [enabled, readyOwner, speak]);

  const replay = useCallback(() => {
    const element = audio.current;
    if (!enabledRef.current || !element || !replayAvailable || !source.current) return;
    const ticket = version.current;
    // Reset a suspended/failed media resource inside this real button gesture.
    // Reuse downloaded bytes; this must never call synthesis again.
    if (needsReload.current || element.error || element.getAttribute('src') !== source.current) {
      element.src = source.current; element.load(); needsReload.current = false;
    }
    element.currentTime = 0;
    window.dispatchEvent(new CustomEvent(playEvent, { detail: id }));
    void element.play().then(() => {
      if (alive.current && ticket === version.current) setNotice('');
    }).catch(() => {
      if (alive.current && ticket === version.current) { needsReload.current = true; setNotice('음성을 재생하지 못했어요. 안내 재생을 눌러 다시 들어 주세요.'); }
    });
  }, [id, replayAvailable]);

  return { audio, speak, prepare, unlock, stop, replay, notice, announcement, replayAvailable };
}
