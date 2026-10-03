import { verifyLipSyncPair, type LipSyncManifest } from './lip-sync';
import type { PlaybackSnapshot } from './character-controller';

export type SpeechState = 'empty' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error';
/** One existing media element is the sole clock. No TTS, fetch, RAF or timers per cue. */
export class LipSyncPlayer {
  manifest: LipSyncManifest | null = null;
  state: SpeechState = 'empty';
  message = '';
  private generation = 0;
  private disposed = false;
  private url = '';
  private stalled = false;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private metadataRetry: ReturnType<typeof setTimeout> | undefined;
  private listeners: [string, EventListener][] = [];

  constructor(readonly audio: HTMLAudioElement, private onChange: () => void) {
    const on = (name: string, fn: () => void) => { audio.addEventListener(name, fn); this.listeners.push([name, fn]); };
    const validateMetadata = () => {
      clearTimeout(this.metadataRetry);
      if (this.state !== 'loading' || !this.manifest || !this.currentSource()) return;
      // WebKit may initially report zero/unknown MP3 duration. Keep the load
      // timeout active. Some replacements update duration without another event,
      // so recheck while loading as well as on native metadata events.
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
        this.metadataRetry = setTimeout(validateMetadata, 100); return;
      }
      if (Math.abs(audio.duration * 1000 - this.manifest.durationMs) > 100) {
        this.fail('음성 길이와 타임라인이 맞지 않아요.'); return;
      }
      clearTimeout(this.timeout);
      this.setState('ready');
    };
    on('loadedmetadata', validateMetadata);
    on('durationchange', validateMetadata);
    on('playing', () => {
      if (!this.usable() || audio.paused) { audio.pause(); return; }
      this.stalled = false; this.setState('playing');
    });
    on('pause', () => {
      // pause() queues a native event. stop() may already have rewound and set
      // ready before that event arrives (notably WebKit's MP3 path).
      if (this.usable() && !audio.ended && this.state !== 'ready') this.setState('paused');
    });
    on('ended', () => { if (this.usable()) this.setState('ended'); });
    on('waiting', () => { this.stalled = true; this.onChange(); });
    on('seeking', () => { this.stalled = true; this.onChange(); });
    on('seeked', () => { this.stalled = false; this.onChange(); });
    on('error', () => { if (this.url && this.currentSource()) this.fail('음성을 읽지 못했어요. 파일을 다시 확인해 주세요.'); });
    on('timeupdate', () => { if (!this.disposed) this.onChange(); });
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('pagehide', this.hide);
  }
  private hide = () => { this.pause(); };
  private visibility = () => { if (document.hidden) this.pause(); };
  private currentSource() { return this.audio.currentSrc === this.url && !!this.url; }
  private usable() { return !this.disposed && !!this.manifest && this.currentSource() && !['empty', 'loading', 'error'].includes(this.state); }
  private setState(state: SpeechState) { if (!this.disposed) { this.state = state; this.onChange(); } }
  private clear() {
    clearTimeout(this.timeout);
    clearTimeout(this.metadataRetry);
    this.manifest = null; this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = ''; this.stalled = false;
  }
  private fail(message: string) { this.clear(); this.message = message; this.setState('error'); }
  reset() {
    if (this.disposed) return;
    ++this.generation; this.clear(); this.message = ''; this.setState('empty');
  }
  async load(bytes: ArrayBuffer, input: unknown, mime = 'audio/wav') {
    if (this.disposed) return;
    const token = ++this.generation;
    this.clear(); this.message = ''; this.setState('loading');
    try {
      // Copy so callers cannot change the bytes between hashing and playback.
      const owned = bytes.slice(0);
      const manifest = await verifyLipSyncPair(owned, input);
      if (this.disposed || token !== this.generation) return;
      this.manifest = manifest;
      this.url = URL.createObjectURL(new Blob([owned], { type: mime }));
      this.audio.src = this.url;
      this.timeout = setTimeout(() => { if (token === this.generation) this.fail('음성을 불러오는 시간이 길어졌어요. 다시 파일을 선택해 주세요.'); }, 15_000);
      this.audio.load();
    } catch (error) {
      if (!this.disposed && token === this.generation) this.fail(error instanceof Error ? error.message : '음성을 확인하지 못했어요.');
    }
  }
  async play() {
    if (!this.usable() || document.hidden) return;
    const token = this.generation;
    this.message = '';
    try { await this.audio.play(); }
    catch {
      if (!this.disposed && token === this.generation) {
        this.audio.pause(); this.message = '재생 버튼을 다시 눌러 주세요.'; this.setState('paused');
      }
    }
  }
  pause() { this.audio.pause(); if (this.usable() && !this.audio.ended) this.setState('paused'); }
  stop() { this.pause(); if (this.usable()) { this.audio.currentTime = 0; this.setState('ready'); } }
  snapshot = (): PlaybackSnapshot => {
    let state: PlaybackSnapshot['state'] = this.state;
    if (this.usable() && state === 'playing') {
      if (this.audio.ended) state = 'ended';
      else if (this.audio.paused || document.hidden) state = 'paused';
      else if (this.audio.seeking) state = 'seeking';
      else if (this.stalled || this.audio.readyState < 2) state = 'waiting';
    } else if (!this.usable() && state === 'playing') state = 'empty';
    return { clipId: this.manifest?.audioSha256 ?? null, currentTimeMs: this.audio.currentTime * 1000, state };
  };
  dispose() {
    if (this.disposed) return;
    this.disposed = true; ++this.generation;
    this.listeners.forEach(([name, fn]) => this.audio.removeEventListener(name, fn));
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('pagehide', this.hide);
    this.clear();
  }
}
