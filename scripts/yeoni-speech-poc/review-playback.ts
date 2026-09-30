import type { LipSyncPlayer } from '../../lib/yeoni/lip-sync-player';

/** Preview transport only. The existing audio remains the lip-sync clock.
 * One cancellable endpoint timer, never a timer per phone or a second render loop. */
export class ReviewPlayback {
  private range: { start: number; end: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners: [string, EventListener][] = [];
  constructor(private player: LipSyncPlayer) {
    const on = (name: string, fn: () => void) => {
      player.audio.addEventListener(name, fn); this.listeners.push([name, fn]);
    };
    for (const name of ['playing', 'timeupdate', 'seeked', 'ratechange']) on(name, this.check);
    for (const name of ['pause', 'waiting']) on(name, this.clearTimer);
    on('seeking', () => {
      this.clearTimer();
      const range = this.range, time = player.audio.currentTime;
      // Native scrubbing outside the chosen segment exits range mode; never rewind the user.
      if (range && (time < range.start || time >= range.end)) this.cancel();
    });
    for (const name of ['emptied', 'error', 'ended']) on(name, this.cancel);
  }
  private clearTimer = () => { clearTimeout(this.timer); this.timer = undefined; };
  cancel = () => { this.clearTimer(); this.range = null; };
  private check = () => {
    this.clearTimer();
    const audio = this.player.audio, range = this.range;
    if (!range || audio.paused || audio.seeking || audio.readyState < 2) return;
    if (audio.currentTime < range.start - .02) { this.cancel(); return; }
    if (audio.currentTime >= range.end) {
      this.cancel(); this.player.pause(); audio.currentTime = range.end; return;
    }
    // Re-read media time after every wake, seek or rate change; wall time cannot select a mouth.
    this.timer = setTimeout(this.check, Math.max(10, Math.min(250, (range.end - audio.currentTime) * 1000 / audio.playbackRate)));
  };
  start(startMs: number, endMs: number) {
    if (!this.player.manifest || !Number.isFinite(startMs) || !Number.isFinite(endMs)
      || startMs < 0 || endMs <= startMs || endMs > this.player.manifest.durationMs) return;
    this.cancel(); this.player.pause();
    this.range = { start: startMs / 1000, end: endMs / 1000 };
    this.player.audio.currentTime = startMs / 1000;
    void this.player.play();
  }
  dispose() {
    this.cancel();
    for (const [name, fn] of this.listeners) this.player.audio.removeEventListener(name, fn);
  }
}
