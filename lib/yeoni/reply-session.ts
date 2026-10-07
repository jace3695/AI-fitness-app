import { EMPTY_PLAYBACK, type SpeechSnapshot, type CharacterEmotion, type CharacterGesture } from './character-controller.ts';
import { matchesReplyClip, parseReplyEnvelope, type ReplyPlan } from './reply-plan.ts';
import { verifyLipSyncPair, type LipSyncManifest } from './lip-sync.ts';
import type { LipSyncPlayer } from './lip-sync-player';

export type ReplyTransport = (message: string, signal: AbortSignal) => Promise<unknown>;
export type ReplyClip = Readonly<{ manifest: LipSyncManifest; load(signal: AbortSignal): Promise<{ bytes: ArrayBuffer; mime: string }> }>;
type Player = Pick<LipSyncPlayer, 'load' | 'reset' | 'play' | 'pause' | 'stop' | 'snapshot' | 'manifest' | 'message'>;
export type ReplyState = Readonly<{ status: 'idle' | 'waiting' | 'loading' | 'ready' | 'text-only' | 'error';
  reply: string; plan: ReplyPlan | null; notice: string; emotion: CharacterEmotion;
  gesture: Readonly<{ id: number; kind: CharacterGesture }> | null }>;
const initial: ReplyState = { status: 'idle', reply: '', plan: null, notice: '', emotion: 'neutral', gesture: null };

/** Latest response owns the player. No renderer, TTS, persistent history or cue clock. */
export class ReplySession {
  state: ReplyState = Object.freeze({ ...initial });
  private request = 0;
  private abort: AbortController | null = null;
  private disposed = false;
  private gestureId = 0;
  private performed = false;
  private previous = 'empty';
  private player: Player;
  private clips: readonly ReplyClip[];
  private changed: () => void;
  constructor(player: Player, clips: readonly ReplyClip[], changed: () => void) { this.player = player; this.clips = clips; this.changed = changed; }
  private update(change: Partial<ReplyState>) { this.state = Object.freeze({ ...this.state, ...change }); this.changed(); }
  private invalidate() { ++this.request; this.abort?.abort(); this.abort = null; this.performed = false; this.player.reset(); }
  reset() { this.invalidate(); this.state = Object.freeze({ ...initial }); this.changed(); }
  async submit(message: string, transport: ReplyTransport) {
    if (this.disposed) return;
    this.invalidate(); const id = this.request, abort = new AbortController(); this.abort = abort;
    this.update({ ...initial, status: 'waiting', emotion: 'thinking' });
    try {
      const input = await transport(message, abort.signal);
      if (this.disposed || id !== this.request) return;
      const { reply, plan, notice } = parseReplyEnvelope(input);
      const clip = this.clips.find(item => matchesReplyClip(plan, item.manifest));
      this.update({ reply, plan, notice, status: clip ? 'loading' : 'text-only', emotion: plan.emotion });
      if (!clip) return;
      const data = await clip.load(abort.signal);
      if (this.disposed || id !== this.request) return;
      // Bind the approved reply to the verified file before handing it to the media adapter.
      const manifest = await verifyLipSyncPair(data.bytes, clip.manifest);
      if (this.disposed || id !== this.request) return;
      if (!matchesReplyClip(plan, manifest)) throw new Error('답변에 맞는 음성이 아니에요.');
      await this.player.load(data.bytes, manifest, data.mime);
      if (!this.disposed && id === this.request) this.mediaChanged();
    } catch (error) {
      if (this.disposed || id !== this.request) return;
      this.player.reset(); this.update({ status: 'error', emotion: 'neutral', gesture: null,
        notice: error instanceof Error ? error.message : '답변을 준비하지 못했어요.' });
    }
  }
  mediaChanged() {
    if (this.disposed) return;
    const playback = this.player.snapshot(), previous = this.previous; this.previous = playback.state;
    if (playback.state === 'error') { this.update({ status: 'error', emotion: 'neutral', gesture: null, notice: this.player.message }); return; }
    if (!this.state.plan || !this.player.manifest || !matchesReplyClip(this.state.plan, this.player.manifest)) return;
    if (this.state.status === 'loading' && playback.state === 'ready') this.update({ status: 'ready' });
    if (playback.state === 'playing' && previous !== 'playing') {
      const kind = this.state.plan.gesture;
      this.update({ emotion: this.state.plan.emotion, gesture: !this.performed && kind ? { id: ++this.gestureId, kind } : null });
      this.performed = true;
    } else if (['paused', 'ended', 'waiting', 'seeking', 'error'].includes(playback.state) && previous !== playback.state) {
      this.update({ emotion: 'neutral', gesture: null });
    }
  }
  play() {
    if (this.state.status !== 'ready') return;
    if (this.player.snapshot().state === 'ended') { this.player.stop(); this.performed = false; }
    return this.player.play();
  }
  pause() { this.player.pause(); this.update({ emotion: 'neutral', gesture: null }); }
  stop() { this.player.stop(); this.performed = false; this.update({ emotion: 'neutral', gesture: null }); }
  snapshot = (): SpeechSnapshot => ({ manifest: this.player.manifest, playback: this.player.snapshot() ?? EMPTY_PLAYBACK });
  dispose() { this.disposed = true; this.invalidate(); }
}
