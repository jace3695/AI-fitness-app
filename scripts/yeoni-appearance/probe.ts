import { createAppearanceRenderer, type AppearanceState, type AppearanceFactory } from '../../lib/yeoni/appearance-renderer';
import { mountAppearanceStage } from '../../lib/yeoni/appearance-stage';
import { createCatCanvasRenderer } from '../../lib/yeoni/cat-renderer';
import { createHumanCanvasRenderer } from '../../lib/yeoni/human-renderer';
import { CharacterController, EMPTY_PLAYBACK, type CharacterPolicy, type PlaybackSnapshot } from '../../lib/yeoni/character-controller';
import { mouthAt } from '../../lib/yeoni/mouth-motion';
import { parseLipSyncManifest, visemeAt } from '../../lib/yeoni/lip-sync';
import timeline from '../../docs/yeoni-phase5/fixtures/zephyr-ko-39.timeline.json';
const manifest = parseLipSyncManifest(timeline);

const policy: CharacterPolicy = { enabled: true, ready: true, visible: true, inView: true, editing: false, modal: false, reducedMotion: false };
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const data = () => window as unknown as Window & { CAT_OFFLINE_ASSET: string; HUMAN_OFFLINE_ASSETS: Record<string, string> };
export function expected(time: number) { const m = manifest; return { mouth: mouthAt(m, time), viseme: visemeAt(m, time) }; }
const pixels = (canvas: HTMLCanvasElement) => canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
const frame = () => new CharacterController().sample(EMPTY_PLAYBACK, 0, policy);

export async function lifecycle() {
  const rows: { name: string; passed: boolean }[] = [];
  for (const mode of ['latest-request', 'cancel-to-active', 'load-failure', 'render-failure', 'initial-failure', 'dispose-before-ready', 'synchronous-factory']) {
    const surface = document.createElement('canvas'), states: AppearanceState[] = [];
    const slots: { ready(): void; fail(): void; disposed: number; frames: number }[] = [];
    let renders = 0, invalidations = 0, readyCount = 0;
    const renderer = createAppearanceRenderer(surface, { initial: 'cat', ready() { readyCount++; }, fail() { throw new Error('Unexpected host failure'); },
      invalidate() { invalidations++; }, onChange: s => states.push(s), create: (appearance, canvas, ready, fail) => {
        if (mode === 'initial-failure' && !states.some(s => s.status === 'error')) throw new Error('Initial factory failure');
        const slot = { ready, fail, disposed: 0, frames: 0 }; slots.push(slot);
        if (mode === 'synchronous-factory') ready();
        return { render() {
          slot.frames++; renders++;
          if (mode === 'render-failure' && appearance === 'human') throw new Error('Candidate cannot render');
          canvas.width = canvas.height = 4; const c = canvas.getContext('2d')!;
          c.fillStyle = appearance === 'cat' ? '#f00' : '#0f0'; c.fillRect(0, 0, 4, 4);
        }, dispose() { slot.disposed++; canvas.getContext('2d')!.clearRect(0, 0, 4, 4); } };
      } });
    if (mode === 'initial-failure') { assert(states.at(-1)?.status === 'error', mode); renderer.setAppearance('cat'); }
    slots[0].ready(); await flush(); renderer.render(frame(), { size: 4 });
    assert(surface.dataset.appearance === 'cat' && pixels(surface)[0] === 255, 'initial output');
    const before = [...pixels(surface)];
    renderer.setAppearance('human'); const candidate = slots.at(-1)!;
    assert(JSON.stringify([...pixels(surface)]) === JSON.stringify(before), 'loading cleared existing frame');
    if (mode === 'latest-request' || mode === 'cancel-to-active') {
      renderer.setAppearance('cat'); assert(candidate.disposed === 1, 'superseded candidate not disposed');
      if (mode === 'latest-request') renderer.setAppearance('human');
      candidate.ready(); candidate.fail(); await flush();
      if (mode === 'latest-request') { slots.at(-1)!.ready(); await flush(); }
      renderer.render(frame(), { size: 4 });
      assert(surface.dataset.appearance === (mode === 'latest-request' ? 'human' : 'cat'), 'late callback won');
    } else if (mode === 'load-failure' || mode === 'render-failure') {
      if (mode === 'load-failure') candidate.fail(); else candidate.ready();
      await flush(); renderer.render(frame(), { size: 4 });
      assert(states.at(-1)?.status === 'error' && surface.dataset.appearance === 'cat', 'failed swap replaced active');
      assert(JSON.stringify([...pixels(surface)]) === JSON.stringify(before), 'failure changed visible pixels');
      if (mode === 'load-failure') {
        renderer.setAppearance('human'); slots.at(-1)!.ready(); await flush(); renderer.render(frame(), { size: 4 });
        assert(surface.dataset.appearance === 'human', 'retry did not recover');
      }
    } else if (mode === 'dispose-before-ready') {
      renderer.dispose(); const count = states.length, draws = renders, wakes = invalidations;
      candidate.ready(); candidate.fail(); await flush(); renderer.setAppearance('cat'); renderer.render(frame(), { size: 4 });
      assert(states.length === count && renders === draws && wakes === invalidations, 'disposed renderer revived');
    } else { candidate.ready(); await flush(); renderer.render(frame(), { size: 4 }); assert(surface.dataset.appearance === 'human', 'swap failed'); }
    renderer.dispose(); renderer.dispose();
    assert(slots.every(s => s.disposed === 1), 'resource disposed more/less than once');
    assert(readyCount === 1, 'host initialized more than once');
    rows.push({ name: mode, passed: true });
  }
  return rows;
}

const factory: AppearanceFactory = (skin, canvas, ready, fail) => skin === 'cat'
  ? createCatCanvasRenderer(canvas, { assetUrl: data().CAT_OFFLINE_ASSET, speechMouth: true, expressive: true, ready, fail })
  : createHumanCanvasRenderer(canvas, { assetUrls: data().HUMAN_OFFLINE_ASSETS, ready, fail });

export async function renderParity() {
  const surface = document.createElement('canvas'), direct = document.createElement('canvas');
  let awake: (() => void) | undefined;
  const loaded = () => awake?.();
  let wait = new Promise<void>(r => { awake = r; });
  const renderer = createAppearanceRenderer(surface, { initial: 'cat', create: factory, ready: loaded, invalidate: loaded,
    fail() { throw new Error('Wrapper failed'); }, onChange() {} });
  const controller = new CharacterController(); controller.setSpeech(manifest);
  const rows = [];
  try {
    await wait;
    for (const skin of ['cat', 'human'] as const) {
      if (skin === 'human') { wait = new Promise<void>(r => { awake = r; }); renderer.setAppearance(skin); await wait; }
      let ready!: () => void; const available = new Promise<void>(r => { ready = r; });
      const adapter = factory(skin, direct, ready, () => { throw new Error('Direct adapter failed'); });
      try {
        await available;
        for (const [i, time] of [0, 320, 740, 1500, 2690, 3200, 3970, 4710].entries()) {
          if (i === 3) { controller.setEmotion('happy'); controller.requestGesture('greet'); }
          const pose = controller.sample({ clipId: manifest.audioSha256, state: 'playing', currentTimeMs: time }, i * 240, policy);
          const before = JSON.stringify(pose); renderer.render(pose, { size: 160 }); adapter.render(pose, { size: 160 });
          const a = pixels(surface), b = pixels(direct); let mismatch = 0;
          for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) mismatch++;
          assert(surface.width === direct.width && surface.height === direct.height && !mismatch, 'changed approved adapter pixels');
          assert(JSON.stringify(pose) === before, 'mutated shared frame');
          rows.push({ skin, time, changedChannels: mismatch, width: surface.width, height: surface.height });
        }
      } finally { adapter.dispose(); }
    }
  } finally { renderer.dispose(); }
  return rows;
}

export async function controllerContinuity() {
  const box = document.createElement('div'), surface = document.createElement('canvas');
  box.style.cssText = 'position:fixed;top:0;left:0;width:120px;opacity:0;pointer-events:none'; box.append(surface); document.body.append(box);
  const times: number[] = [];
  class Tracked extends CharacterController {
    sample(playback: PlaybackSnapshot, time: number, p: CharacterPolicy) { times.push(time); return super.sample(playback, time, p); }
  }
  const controller = new Tracked(); let resolve!: () => void;
  let switched = new Promise<void>(r => { resolve = r; });
  const stage = mountAppearanceStage(surface, { enabled: true, controller, appearance: 'cat', catAsset: data().CAT_OFFLINE_ASSET,
    humanAssets: data().HUMAN_OFFLINE_ASSETS, onStatus() {}, onAppearance(s) { if (s.status === 'ready') resolve(); } });
  try {
    await switched;
    await new Promise<void>(r => { const check = () => surface.dataset.running === 'true' ? r() : requestAnimationFrame(check); check(); });
    stage.setEmotion('happy'); stage.requestGesture('greet');
    await new Promise(r => setTimeout(r, 120));
    const before = { time: times.at(-1)!, progress: Number(surface.dataset.gestureProgress), emotion: surface.dataset.emotion };
    switched = new Promise<void>(r => { resolve = r; }); stage.setAppearance('human'); await switched;
    const after = { time: times.at(-1)!, progress: Number(surface.dataset.gestureProgress), emotion: surface.dataset.emotion, gesture: surface.dataset.gesture };
    assert(after.time >= before.time && after.progress >= before.progress && after.progress > 0 && after.gesture === 'greet' && after.emotion === 'happy', 'switch reset shared state');
    assert(times.every((t, i) => !i || t >= times[i - 1]), 'idle clock moved backwards');
    return { before, after, samples: times.length, backwardsClockSteps: 0 };
  } finally { stage.dispose(); box.remove(); }
}
