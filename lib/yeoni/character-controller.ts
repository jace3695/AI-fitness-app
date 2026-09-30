import { visemeAt, type LipSyncManifest, type Viseme } from './lip-sync.ts';
import { blendExpression, CHARACTER_EMOTIONS, CHARACTER_GESTURES, EXPRESSIONS, GESTURE_DURATION, type CharacterEmotion, type CharacterExpression, type CharacterGesture } from './character-expression.ts';
export type { CharacterEmotion, CharacterGesture } from './character-expression.ts';

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
export type CharacterFrame = Readonly<{
  viseme: Viseme; blink: 'open' | 'half' | 'closed';
  breath: number; sway: number; emotion: CharacterEmotion;
  gesture: CharacterGesture | 'idle'; gestureProgress: number;
  expression: CharacterExpression; headTilt: number; headNod: number; bodyLift: number;
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
  private from: CharacterExpression = EXPRESSIONS.neutral;
  private expression: CharacterExpression = EXPRESSIONS.neutral;
  private changedAt: number | null = null;
  private expressionPending = false;
  private gesture: CharacterGesture | null = null;
  private gestureAt: number | null = null;
  private lastTime = 0;
  // The speech service supplies an already validated, immutable manifest.
  setSpeech(manifest: LipSyncManifest | null) { this.manifest = manifest; }
  setEmotion(emotion: CharacterEmotion) {
    if (!CHARACTER_EMOTIONS.includes(emotion) || emotion === this.emotion) return;
    this.from = this.expression; this.emotion = emotion; this.expressionPending = true;
  }
  /** Latest explicit request wins; no queue, timeout or renderer dependency. */
  requestGesture(gesture: CharacterGesture) {
    if (!CHARACTER_GESTURES.includes(gesture)) return;
    this.gesture = gesture; this.gestureAt = null;
  }
  cancelGesture() { this.gesture = null; this.gestureAt = null; }
  reset() { this.cancelGesture(); this.setEmotion('neutral'); }

  sample(playback: PlaybackSnapshot, idleTimeMs: number, policy: CharacterPolicy): CharacterFrame {
    const animated = canAnimate(policy);
    const t = Math.max(0, Number.isFinite(idleTimeMs) ? idleTimeMs : 0);
    if (t < this.lastTime) { this.cancelGesture(); this.expressionPending = true; }
    this.lastTime = t;
    if (!animated) this.cancelGesture();
    if (this.expressionPending) { this.changedAt = t; this.expressionPending = false; }
    const blend = this.changedAt === null ? 1 : Math.min(1, Math.max(0, (t - this.changedAt) / 240));
    this.expression = animated ? blendExpression(this.from, EXPRESSIONS[this.emotion], blend * blend * (3 - 2 * blend)) : EXPRESSIONS[this.emotion];
    if (!animated) { this.from = this.expression; this.changedAt = null; }
    if (this.gesture && this.gestureAt === null) this.gestureAt = t;
    const progress = this.gesture ? (t - this.gestureAt!) / GESTURE_DURATION[this.gesture] : 0;
    if (progress >= 1) this.cancelGesture();
    const gesture = this.gesture ?? 'idle';
    const p = gesture === 'idle' ? 0 : Math.min(1, Math.max(0, progress));
    const pulse = Math.sin(Math.PI * p) ** 2;
    const phase = t % 5200;
    const blink = !animated || phase < 4100 || phase >= 4440 ? 'open'
      : phase < 4180 || phase >= 4360 ? 'half' : 'closed';
    return Object.freeze({
      viseme: animated && playback.state === 'playing' && this.manifest
        && playback.clipId === this.manifest.audioSha256
        ? visemeAt(this.manifest, playback.currentTimeMs) : 'rest',
      blink, breath: animated ? Math.sin(t / 7000 * Math.PI * 2) * .008 : 0,
      sway: animated ? Math.sin(t / 6200 * Math.PI * 2) * (1 + this.expression.energy * .35) : 0,
      emotion: this.emotion, gesture, gestureProgress: p, expression: this.expression,
      headTilt: animated ? this.expression.headTilt + (gesture === 'tilt' ? Math.sin(p * Math.PI * 2) * .7 * pulse : 0) : 0,
      headNod: animated ? this.expression.headNod + (gesture === 'nod' ? Math.sin(p * Math.PI * 2) ** 2 * .65 * pulse : gesture === 'greet' ? pulse : 0) : 0,
      bodyLift: animated && gesture === 'cheer' ? Math.sin(p * Math.PI * 2) ** 2 * pulse : 0,
    });
  }
}
