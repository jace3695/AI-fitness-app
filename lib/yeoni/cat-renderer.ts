import { catFace, createCatArtwork } from './cat-art';
import { catWarp, warpCatPoint, CAT_TRIANGLES } from './cat-warp';
import type { Point } from './cat-warp';
import type { CharacterRenderer } from './character-controller';
import { mouthKey } from './mouth-motion';
import { mountCharacterStage, type CharacterStage, type CharacterStageOptions, type CharacterStageStatus } from './character-stage';

export type CatRenderer = CharacterStage;
export type CatRendererStatus = CharacterStageStatus;

/** Small texture triangles overlap only rasterization edges, preventing white cracks. */
function triangle(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement, s: Point[], d: Point[], scale: number) {
  const [p, q, r] = s, [u, v, w] = d;
  const det = (q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y);
  const a = ((v.x - u.x) * (r.y - p.y) - (w.x - u.x) * (q.y - p.y)) / det;
  const b = ((v.y - u.y) * (r.y - p.y) - (w.y - u.y) * (q.y - p.y)) / det;
  const c = ((q.x - p.x) * (w.x - u.x) - (r.x - p.x) * (v.x - u.x)) / det;
  const e = ((q.x - p.x) * (w.y - u.y) - (r.x - p.x) * (v.y - u.y)) / det;
  ctx.save(); ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const center = { x: (u.x + v.x + w.x) / 3, y: (u.y + v.y + w.y) / 3 };
  ctx.beginPath();
  d.forEach((point, i) => {
    const dx = point.x - center.x, dy = point.y - center.y, length = Math.hypot(dx, dy);
    const x = point.x + dx / length * 2, y = point.y + dy / length * 2;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath(); ctx.clip();
  ctx.transform(a, b, c, e, u.x - a * p.x - c * p.y, u.y - b * p.x - e * p.y);
  const x = Math.max(0, Math.min(p.x, q.x, r.x) - 3), y = Math.max(0, Math.min(p.y, q.y, r.y) - 3);
  const width = Math.min(360, Math.max(p.x, q.x, r.x) + 3) - x, height = Math.min(360, Math.max(p.y, q.y, r.y) + 3) - y;
  ctx.drawImage(source, x, y, width, height, x, y, width, height); ctx.restore();
}

/** Original artwork is one continuous surface; eyes and mouth follow its rigid face. */
export function createCatCanvasRenderer(canvas: HTMLCanvasElement, options: {
  assetUrl: string; speechMouth: boolean; expressive?: boolean; ready(): void; fail(): void;
}): CharacterRenderer {
  const ctx = canvas.getContext('2d'), image = new Image();
  let disposed = false, art: ReturnType<typeof createCatArtwork> | null = null;
  const fail = () => { if (!disposed) options.fail(); };
  canvas.addEventListener('contextlost', fail);
  image.onload = () => {
    if (disposed) return;
    if (!ctx || image.naturalWidth !== 768 || image.naturalHeight !== 384) { fail(); return; }
    try { art = createCatArtwork(image); options.ready(); } catch { fail(); }
  };
  image.onerror = fail; image.src = options.assetUrl;
  return {
    render(frame, { size }) {
      if (!ctx || !art || disposed) return;
      if (canvas.width !== size || canvas.height !== size) { canvas.width = size; canvas.height = size; }
      const expressive = options.expressive ?? false;
      const face = catFace(frame, expressive, options.speechMouth), texture = art.frame(face.eye, face.mouth, options.speechMouth ? frame.mouth : undefined);
      const warp = catWarp(frame, expressive), scale = size / 360;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      // Preserve the approved opaque backdrop. This is not a transparent cutout.
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 360, 360);
      if (Object.values(warp).every(value => value === 0)) ctx.drawImage(texture, 0, 0);
      else for (const points of CAT_TRIANGLES) triangle(ctx, texture, points, points.map(p => warpCatPoint(p, warp)), scale);
      canvas.dataset.artVersion = 'preserved-v3'; canvas.dataset.eyeArtwork = face.eye;
      canvas.dataset.mouthArtwork = options.speechMouth && frame.mouth ? mouthKey(frame.mouth) : face.mouth;
    },
    dispose() {
      disposed = true; image.onload = null; image.onerror = null; image.removeAttribute('src');
      canvas.removeEventListener('contextlost', fail); art?.dispose(); art = null;
      if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); }
    },
  };
}

export function mountCatRenderer(canvas: HTMLCanvasElement, options: CharacterStageOptions & {
  assetUrl: string; expressive?: boolean;
}): CatRenderer {
  return mountCharacterStage(canvas, { ...options,
    createRenderer: (ready, fail) => createCatCanvasRenderer(canvas, {
      assetUrl: options.assetUrl, speechMouth: !!options.speech, expressive: options.expressive, ready, fail,
    }),
  });
}
