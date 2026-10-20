import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import type { LipSyncPlayer } from './lip-sync-player';

function fixture() {
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const win = new EventTarget();
  class Media extends EventTarget {
    paused = true; ended = false; seeking = false; readyState = 4; duration = 1; currentTime = 0; src = ''; plays = 0;
    finish: (() => void) | null = null;
    get currentSrc() { return this.src; }
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
    removeAttribute() { this.src = ''; }
    load() { if (this.src) queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata'))); }
    play() { this.plays++; return new Promise<void>(resolve => { this.finish = () => { this.paused = false; this.dispatchEvent(new Event('playing')); resolve(); }; }); }
  }
  const exports = {} as { LipSyncPlayer: typeof LipSyncPlayer };
  const source = ts.transpileModule(readFileSync(new URL('./lip-sync-player.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: () => ({ verifyLipSyncPair: async () => ({ durationMs: 1000, audioSha256: 'synthetic' }) }),
    document: doc, window: win, Blob, URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL() {} }, setTimeout, clearTimeout });
  const audio = new Media(), player = new exports.LipSyncPlayer(audio as unknown as HTMLAudioElement, () => {});
  return { audio, player, doc, win, async ready() { await player.load(new ArrayBuffer(1), {}); await Promise.resolve(); assert.equal(player.state, 'ready'); } };
}

test('pause and pagehide reject a late playing event from pending media.play', async () => {
  for (const reason of ['pause', 'pagehide']) {
    const f = fixture(); await f.ready(); const pending = f.player.play();
    if (reason === 'pause') f.player.pause(); else f.win.dispatchEvent(new Event('pagehide'));
    f.audio.finish!(); await pending;
    assert.equal(f.audio.paused, true); assert.notEqual(f.player.snapshot().state, 'playing'); f.player.dispose();
  }
});

test('repeated play while pending does not start overlapping requests', async () => {
  const f = fixture(); await f.ready(); const pending = f.player.play(); void f.player.play();
  assert.equal(f.audio.plays, 1); f.audio.finish!(); await pending; f.player.dispose();
});

test('stale pause and ended events cannot overwrite currently playing media', async () => {
  const f = fixture(); await f.ready(); const pending = f.player.play(); f.audio.finish!(); await pending;
  f.audio.dispatchEvent(new Event('pause')); assert.equal(f.player.snapshot().state, 'playing');
  f.audio.dispatchEvent(new Event('ended')); assert.equal(f.player.snapshot().state, 'playing'); f.player.dispose();
});

test('disposing while play is pending stops a late promise completion even after listeners are removed', async () => {
  const f = fixture(); await f.ready(); const pending = f.player.play(); f.player.dispose();
  f.audio.finish!(); await pending; assert.equal(f.audio.paused, true); assert.equal(f.audio.src, '');
});
