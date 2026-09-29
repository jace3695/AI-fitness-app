import { drawCatMouth } from './cat-mouth';
import type { CharacterController, CharacterRenderer, SpeechSnapshot } from './character-controller';
import { mountCharacterStage, type CharacterStage, type CharacterStageStatus } from './character-stage';

export type CatRenderer = CharacterStage;
export type CatRendererStatus = CharacterStageStatus;

/** Canvas-only adapter. Receives semantic frames; never reads audio or selects phones. */
export function createCatCanvasRenderer(canvas: HTMLCanvasElement, options: {
  assetUrl: string; speechMouth: boolean; ready(): void; fail(): void;
}): CharacterRenderer {
  const ctx = canvas.getContext('2d');
  const image = new Image();
  let disposed = false;
  const fail = () => { if (!disposed) options.fail(); };
  const part = (s: number[], d: number[]) => ctx!.drawImage(image, s[0], s[1], s[2], s[3], d[0], d[1], d[2], d[3]);
  canvas.addEventListener('contextlost', fail);
  image.onload = () => {
    if (disposed) return;
    if (!ctx || image.naturalWidth !== 1254 || image.naturalHeight !== 1254) { fail(); return; }
    options.ready();
  };
  image.onerror = fail;
  image.src = options.assetUrl;
  return {
    render(pose, { size }) {
      if (!ctx || disposed) return;
      if (canvas.width !== size || canvas.height !== size) { canvas.width = size; canvas.height = size; }
      ctx.setTransform(size / 400, 0, 0, size / 400, 0, 0);
      ctx.clearRect(0, 0, 400, 400);
      ctx.save();
      ctx.translate(170, 340); ctx.scale(1 + pose.breath * .4, 1 + pose.breath); ctx.translate(-170, -340);
      ctx.save(); ctx.translate(262, 291); ctx.rotate(pose.sway * .055); ctx.translate(-262, -291);
      part([800, 820, 425, 400], [240, 178, 128, 121]);
      ctx.restore();
      part([0, 0, 660, 805], [35, 18, 264, 322]);
      if (pose.blink === 'closed') part([135, 1000, 395, 90], [89, 148, 153, 35]);
      else {
        const height = pose.blink === 'half' ? 25 : 54;
        part([790, 355, 325, 135], [90, 159 - height / 2, 151, height]);
      }
      if (options.speechMouth) drawCatMouth(ctx, pose.viseme);
      ctx.restore();
    },
    dispose() {
      disposed = true; image.onload = null; image.onerror = null; image.removeAttribute('src');
      canvas.removeEventListener('contextlost', fail);
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}

/** Composition only: swapping this adapter leaves the common controller/clock intact. */
export function mountCatRenderer(canvas: HTMLCanvasElement, options: {
  enabled: boolean; assetUrl: string; onStatus(status: CatRendererStatus): void;
  controller?: CharacterController;
  speech?: () => SpeechSnapshot;
}): CatRenderer {
  return mountCharacterStage(canvas, { ...options,
    createRenderer: (ready, fail) => createCatCanvasRenderer(canvas, {
      assetUrl: options.assetUrl, speechMouth: !!options.speech, ready, fail,
    }),
  });
}
