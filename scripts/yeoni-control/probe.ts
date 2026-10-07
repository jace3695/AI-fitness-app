import { CharacterController, EMPTY_PLAYBACK, type CharacterRenderer, type CharacterPolicy } from '../../lib/yeoni/character-controller';
import { mountCharacterStage } from '../../lib/yeoni/character-stage';
import { createCatCanvasRenderer, mountCatRenderer } from '../../lib/yeoni/cat-renderer';
import { createHumanCanvasRenderer, mountHumanRenderer } from '../../lib/yeoni/human-renderer';
import { CAT_MOTION_ASSET } from '../../lib/yeoni/cat-art';
import { clockFixture } from '../yeoni-speech-poc/fixture';

const policy: CharacterPolicy = { enabled: true, ready: true, visible: true, inView: true, editing: false, modal: false, reducedMotion: false };
const makeSurface = () => {
  const box = document.createElement('div'), canvas = document.createElement('canvas');
  box.style.cssText = 'position:fixed;left:0;top:0;width:160px;pointer-events:none;opacity:0';
  box.append(canvas); document.body.append(box); return { box, canvas };
};
async function pixels(canvas: HTMLCanvasElement) {
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(data).buffer);
  return { hash: [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join(''),
    visiblePixels: data.filter((alpha, i) => i % 4 === 3 && alpha > 0).length, width: canvas.width, height: canvas.height };
}

/** Same immutable Controller frame through both real Canvas adapters. No new artwork. */
export async function renderContract() {
  const canvases = [document.createElement('canvas'), document.createElement('canvas')];
  const renderers: CharacterRenderer[] = [];
  try {
    for (const [i, canvas] of canvases.entries()) {
      let ready!: () => void, fail!: () => void;
      const loaded = new Promise<void>((resolve, reject) => { ready = resolve; fail = () => reject(new Error('Artwork unavailable')); });
      renderers.push(i === 0 ? createCatCanvasRenderer(canvas, { assetUrl: CAT_MOTION_ASSET, speechMouth: true, ready, fail })
        : createHumanCanvasRenderer(canvas, { ready, fail }));
      await loaded;
    }
    const { manifest } = await clockFixture(), controller = new CharacterController(); controller.setSpeech(manifest);
    const rows = [];
    for (const time of [0, 500, 1500, 2700, 3800, 4700, 5700, 6700]) {
      const frame = controller.sample({ clipId: manifest.audioSha256, currentTimeMs: time, state: 'playing' }, 0, policy);
      const before = JSON.stringify(frame);
      for (const renderer of renderers) renderer.render(frame, { size: 160 });
      rows.push({ time, viseme: frame.viseme, immutable: Object.isFrozen(frame) && Object.isFrozen(frame.expression),
        unchangedByAdapters: before === JSON.stringify(frame), cat: await pixels(canvases[0]), human: await pixels(canvases[1]) });
    }
    renderers.forEach(renderer => renderer.dispose());
    const afterDispose = await Promise.all(canvases.map(pixels));
    renderers.forEach(renderer => renderer.render(controller.sample(EMPTY_PLAYBACK, 0, policy), { size: 160 }));
    return { rows, afterDispose, afterLateRender: await Promise.all(canvases.map(pixels)) };
  } finally { renderers.forEach(renderer => renderer.dispose()); }
}

export async function injectedControllers() {
  const rows = [];
  for (const skin of ['cat', 'human']) {
    const { box, canvas } = makeSurface(), controller = new CharacterController(); controller.setEmotion('thinking');
    let ready!: () => void;
    const loaded = new Promise<void>(resolve => { ready = resolve; });
    const options = { enabled: false, controller, onStatus: (status: string) => { if (status === 'ready') ready(); } };
    const stage = skin === 'cat' ? mountCatRenderer(canvas, { ...options, assetUrl: CAT_MOTION_ASSET }) : mountHumanRenderer(canvas, options);
    try {
      await loaded;
      const emotion = canvas.dataset.emotion;
      stage.dispose(); controller.setEmotion('happy'); controller.requestGesture('nod');
      stage.setEmotion('sleepy'); stage.cancelGesture(); stage.requestGesture('cheer'); stage.setEnabled(true); stage.dispose();
      const frame = controller.sample(EMPTY_PLAYBACK, 0, policy);
      rows.push({ skin, injectedEmotion: emotion, emotionAfterDisposedCalls: frame.emotion, gestureAfterDisposedCalls: frame.gesture });
    } finally { stage.dispose(); box.remove(); }
  }
  return rows;
}

export async function failedFactories() {
  const rows = [];
  for (const mode of ['throw', 'fail-then-ready', 'dispose-before-ready']) {
    const { box, canvas } = makeSurface(), statuses: string[] = [];
    let lateReady = () => {}, rendered = 0, disposed = 0;
    const stage = mountCharacterStage(canvas, { enabled: true, onStatus: value => statuses.push(value),
      createRenderer: (ready, fail) => {
        if (mode === 'throw') throw new Error('Synthetic constructor failure');
        lateReady = ready;
        if (mode === 'fail-then-ready') fail();
        return { render() { rendered++; }, dispose() { disposed++; } };
      } });
    if (mode === 'dispose-before-ready') stage.dispose();
    lateReady(); await Promise.resolve();
    stage.dispose(); stage.dispose(); box.remove();
    rows.push({ mode, statuses, rendered, disposed });
  }
  return rows;
}
