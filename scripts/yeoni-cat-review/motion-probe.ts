// Isolated review harness only. Never imported by an application page.
import { createCatCanvasRenderer } from '../../lib/yeoni/cat-renderer';
import { CharacterController, EMPTY_PLAYBACK, type CharacterFrame, type CharacterEmotion, type CharacterGesture } from '../../lib/yeoni/character-controller';
import type { Viseme } from '../../lib/yeoni/lip-sync';
import { GESTURE_DURATION } from '../../lib/yeoni/character-expression';
let renderer: ReturnType<typeof createCatCanvasRenderer>;
const policy = { enabled: true, ready: true, visible: true, inView: true, editing: false, modal: false, reducedMotion: false };
export async function init(assetUrl: string, originalUrl: string) {
  const original = document.querySelector<HTMLCanvasElement>('#original')!, canvas = document.querySelector<HTMLCanvasElement>('#revised')!;
  const image = new Image(); image.src = originalUrl; await image.decode();
  const ctx = original.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 360, 360); ctx.drawImage(image, 24, 24);
  await new Promise<void>((resolve, reject) => { renderer = createCatCanvasRenderer(canvas, { assetUrl, speechMouth: true, expressive: true, ready: resolve, fail: () => reject(new Error('Asset failed')) }); });
}
export function show(input: { emotion?: CharacterEmotion; gesture?: CharacterGesture; progress?: number; time?: number; eye?: CharacterFrame['blink']; mouth?: Viseme; still?: boolean }) {
  const controller = new CharacterController(); controller.setEmotion(input.emotion ?? 'neutral');
  controller.sample(EMPTY_PLAYBACK, 0, { ...policy, enabled: false });
  if (input.gesture) controller.requestGesture(input.gesture);
  controller.sample(EMPTY_PLAYBACK, 0, policy);
  const t = input.gesture ? (input.progress ?? 0) * GESTURE_DURATION[input.gesture] : input.time ?? 0;
  // Synthetic artwork endpoints must not inherit the default smooth rest pose,
  // which would override the explicitly selected static mouth below.
  const sample = controller.sample(EMPTY_PLAYBACK, t, policy, 'direct');
  const frame = { ...sample, ...(input.eye ? { blink: input.eye } : {}), ...(input.mouth ? { viseme: input.mouth } : {}), ...(input.still ? { breath: 0, sway: 0 } : {}) };
  return draw(frame);
}
export function draw(frame: CharacterFrame) {
  const start = performance.now(); renderer.render(frame, { size: 360 });
  const milliseconds = performance.now() - start;
  return { frame, milliseconds, artwork: { ...document.querySelector<HTMLCanvasElement>('#revised')!.dataset } };
}
export function dispose() { renderer.dispose(); }
