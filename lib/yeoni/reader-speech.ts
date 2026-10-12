import type { SpeechSnapshot } from './character-controller.ts';
import type { LipSyncManifest } from './lip-sync.ts';

type MediaClock = Pick<HTMLAudioElement, 'currentTime' | 'duration' | 'paused' | 'ended' | 'seeking' | 'readyState' | 'error' | 'currentSrc'>;

/** Reuses the reader's single audio clock. No second player, cue timers or animation loop. */
export function readerSnapshot(audio: MediaClock, manifest: LipSyncManifest, source: string, hidden: boolean): SpeechSnapshot {
  const valid = source && source === audio.currentSrc && Number.isFinite(audio.duration)
    && Math.abs(audio.duration * 1000 - manifest.durationMs) <= 100;
  const state = !valid || audio.error ? 'error' : audio.ended ? 'ended' : audio.paused || hidden ? 'paused'
    : audio.seeking ? 'seeking' : audio.readyState < 2 ? 'waiting' : 'playing';
  return { manifest: valid ? manifest : null, playback: {
    clipId: valid ? manifest.audioSha256 : null, currentTimeMs: audio.currentTime * 1000, state,
  } };
}

/** A page-local, ephemeral source. Callers release only their own lease on teardown. */
export class ReaderSpeechChannel {
  private current: { owner: string; snapshot: () => SpeechSnapshot } | null = null;
  attach(owner: string, snapshot: () => SpeechSnapshot) { this.current = { owner, snapshot }; }
  release(owner: string) { if (this.current?.owner === owner) this.current = null; }
  snapshot() { return this.current?.snapshot() ?? null; }
}
export const readerSpeech = new ReaderSpeechChannel();
