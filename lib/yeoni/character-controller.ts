import { visemeAt, type LipSyncManifest, type Viseme } from './lip-sync.ts';

/** Engine-independent input. Only the media adapter reads HTMLAudioElement. */
export type PlaybackSnapshot = Readonly<{
  clipId: string | null;
  currentTimeMs: number;
  state: 'empty' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'waiting' | 'seeking' | 'error';
}>;
export type CharacterPolicy = Readonly<{
  enabled: boolean; ready: boolean; visible: boolean; inView: boolean;
  editing: boolean; modal: boolean; reducedMotion: boolean;
}>;
export type CharacterEmotion = 'neutral' | 'happy' | 'concerned';
export type CharacterFrame = Readonly<{
  viseme: Viseme; blink: 'open' | 'half' | 'closed';
  breath: number; sway: number; emotion: CharacterEmotion;
  gesture: 'idle'; gaze: 'forward';
}>;
export type CharacterRenderer = {
  render(frame: CharacterFrame, viewport: Readonly<{ size: number }>): void;
  dispose(): void;
};
export type SpeechSnapshot = Readonly<{ manifest: LipSyncManifest | null; playback: PlaybackSnapshot }>;
export const EMPTY_PLAYBACK: PlaybackSnapshot = Object.freeze({ clipId: null, currentTimeMs: 0, state: 'empty' });

export function canAnimate(input: CharacterPolicy) {
  return input.enabled && input.ready && input.visible && input.inView
    && !input.editing && !input.modal && !input.reducedMotion;
}

/** No DOM, React, audio element, canvas, engine handles, network or cue timers. */
export class CharacterController {
  private manifest: LipSyncManifest | null = null;
  private emotion: CharacterEmotion = 'neutral';
  // The speech service supplies an already validated, immutable manifest.
  setSpeech(manifest: LipSyncManifest | null) { this.manifest = manifest; }
  setEmotion(emotion: CharacterEmotion) { this.emotion = emotion; }

  sample(playback: PlaybackSnapshot, idleTimeMs: number, policy: CharacterPolicy): CharacterFrame {
    const animated = canAnimate(policy);
    const t = Math.max(0, Number.isFinite(idleTimeMs) ? idleTimeMs : 0);
    const phase = t % 5200;
    const blink = !animated || phase < 4100 || phase >= 4440 ? 'open'
      : phase < 4180 || phase >= 4360 ? 'half' : 'closed';
    return Object.freeze({
      viseme: animated && playback.state === 'playing' && this.manifest
        && playback.clipId === this.manifest.audioSha256
        ? visemeAt(this.manifest, playback.currentTimeMs) : 'rest',
      blink, breath: animated ? Math.sin(t / 7000 * Math.PI * 2) * .008 : 0,
      sway: animated ? Math.sin(t / 6200 * Math.PI * 2) : 0,
      emotion: this.emotion, gesture: 'idle', gaze: 'forward',
    });
  }
}
