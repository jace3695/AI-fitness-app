import { createHumanCanvasRenderer } from '../../lib/yeoni/human-renderer';
import { CharacterController, EMPTY_PLAYBACK, type CharacterFrame } from '../../lib/yeoni/character-controller';
import { humanPose, humanTransform } from '../../lib/yeoni/human-warp';
import type { Viseme } from '../../lib/yeoni/lip-sync';
let renderer: ReturnType<typeof createHumanCanvasRenderer>;
const policy = { enabled: true, ready: true, visible: true, inView: true, editing: false, modal: false, reducedMotion: false };
export async function init(assets: Record<string, string>, original: string) {
  const canvas = document.querySelector<HTMLCanvasElement>('#revised')!, originalCanvas = document.querySelector<HTMLCanvasElement>('#original')!;
  const image = new Image(); image.src = original; await image.decode();
  const originalContext = originalCanvas.getContext('2d')!;
  originalContext.imageSmoothingQuality = 'high'; originalContext.drawImage(image, 0, 0, 360, 540);
  await new Promise<void>((ready, reject) => { renderer = createHumanCanvasRenderer(canvas, { assetUrls: assets, ready, fail: () => reject(new Error('Human asset failed')) }); });
}
export function show(input: { time?: number; eye?: CharacterFrame['blink']; mouth?: Viseme; still?: boolean; size?: number }) {
  const controller = new CharacterController(), frame = controller.sample(EMPTY_PLAYBACK, input.time ?? 0, { ...policy, enabled: !input.still });
  return draw({ ...frame, ...(input.eye ? { blink: input.eye } : {}), ...(input.mouth ? { viseme: input.mouth } : {}) }, input.size);
}
export function draw(frame: CharacterFrame, size = 360) {
  const start = performance.now(); renderer.render(frame, { size }); const milliseconds = performance.now() - start;
  const canvas = document.querySelector<HTMLCanvasElement>('#revised')!, t = humanTransform(humanPose(frame));
  const landmarks = [[354, 355], [672, 427], [425, 512], [625, 624]].map(([x, y]) => t.forward(x, y));
  return { frame, milliseconds, landmarks, width: canvas.width, height: canvas.height, artwork: { ...canvas.dataset } };
}
export function neckAlpha(frame: CharacterFrame) {
  const canvas = document.querySelector<HTMLCanvasElement>('#revised')!, data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  const t = humanTransform(humanPose(frame)), scale = canvas.width / 1024; let min = 255, count = 0;
  for (let y = 690; y <= 824; y += 2) for (let x = 440; x <= 590; x += 2) {
    const p = t.forward(x, y), i = (Math.floor(p.y * scale) * canvas.width + Math.floor(p.x * scale)) * 4;
    min = Math.min(min, data[i + 3]); count++;
  }
  return { min, count };
}
export function dispose() { renderer.dispose(); }
