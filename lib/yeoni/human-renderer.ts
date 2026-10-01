import type { CharacterRenderer } from './character-controller';
import { mountCharacterStage, type CharacterStageOptions } from './character-stage';
import { createHumanArtwork, humanFace, HUMAN_ASSET_ROOT, HUMAN_IMAGE_NAMES } from './human-art';
import { humanPose, humanTransform, type HumanPose } from './human-warp';

/** One inverse sample per destination pixel avoids overlapping alpha and mesh cracks. */
export function warpHumanPixels(source: Uint8ClampedArray, target: Uint8ClampedArray, width: number, height: number, pose: HumanPose) {
  const transform = humanTransform(pose), scale = 1024 / width;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = transform.inverse((x + .5) * scale, (y + .5) * scale);
    const sx = p.x / scale - .5, sy = p.y / scale - .5, ix = Math.floor(sx), iy = Math.floor(sy), at = (y * width + x) * 4;
    const fx = sx - ix, fy = sy - iy;
    let alpha = 0, red = 0, green = 0, blue = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const xx = ix + dx, yy = iy + dy; if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
      const i = (yy * width + xx) * 4, a = source[i + 3] * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
      alpha += a; red += source[i] * a; green += source[i + 1] * a; blue += source[i + 2] * a;
    }
    target[at] = alpha ? red / alpha : 0; target[at + 1] = alpha ? green / alpha : 0;
    target[at + 2] = alpha ? blue / alpha : 0; target[at + 3] = alpha;
  }
}

export function createHumanCanvasRenderer(canvas: HTMLCanvasElement, options: {
  assetRoot?: string; assetUrls?: Record<string, string>; ready(): void; fail(): void;
}): CharacterRenderer {
  const ctx = canvas.getContext('2d');
  const images = new Map<string, HTMLImageElement>();
  let disposed = false, art: ReturnType<typeof createHumanArtwork> | null = null;
  const cache = new Map<string, ImageData>();
  const texture = document.createElement('canvas'), tc = texture.getContext('2d', { willReadFrequently: true });
  let output: ImageData | null = null;
  const fail = () => { if (!disposed) options.fail(); };
  canvas.addEventListener('contextlost', fail);
  void Promise.all(HUMAN_IMAGE_NAMES.map(name => new Promise<void>((resolve, reject) => {
    const image = new Image(); images.set(name, image);
    image.onload = () => resolve(); image.onerror = () => reject(new Error('Human asset failed'));
    image.src = options.assetUrls?.[name] ?? (options.assetRoot ?? HUMAN_ASSET_ROOT) + name;
  }))).then(() => {
    if (disposed) return;
    if (!ctx || !tc || images.get('head.png')?.naturalWidth !== 1024 || images.get('head.png')?.naturalHeight !== 740
      || images.get('body.png')?.naturalWidth !== 1024 || images.get('body.png')?.naturalHeight !== 796) { fail(); return; }
    art = createHumanArtwork(images); options.ready();
  }).catch(fail);
  return {
    render(frame, { size }) {
      if (!ctx || !tc || !art || disposed) return;
      // Bounded CPU surface; high-DPR hosts cannot silently quadruple the per-frame work.
      const width = Math.max(2, Math.min(512, Math.round(size / 2) * 2)), height = width * 1.5;
      if (!output || canvas.width !== width || canvas.height !== height) {
        canvas.width = texture.width = width; canvas.height = texture.height = height;
        output = ctx.createImageData(width, height); cache.clear();
      }
      const face = humanFace(frame), pose = humanPose(frame), key = face.eye + ':' + face.mouth;
      if (!cache.has(key)) {
        tc.imageSmoothingEnabled = true; tc.imageSmoothingQuality = 'high';
        tc.clearRect(0, 0, width, height); tc.drawImage(art.frame(face.eye, face.mouth), 0, 0, width, height);
        if (cache.size >= 3) cache.delete(cache.keys().next().value!);
        cache.set(key, tc.getImageData(0, 0, width, height));
      }
      const source = cache.get(key)!;
      if (pose.angle === 0 && pose.drop === 0 && pose.breath === 0) ctx.putImageData(source, 0, 0);
      else { warpHumanPixels(source.data, output!.data, width, height, pose); ctx.putImageData(output!, 0, 0); }
      canvas.dataset.artVersion = 'human-rig-v4'; canvas.dataset.eyeArtwork = face.eye; canvas.dataset.mouthArtwork = face.mouth;
      canvas.dataset.angle = String(pose.angle); canvas.dataset.drop = String(pose.drop);
    },
    dispose() {
      disposed = true; for (const image of images.values()) { image.onload = image.onerror = null; image.removeAttribute('src'); }
      images.clear(); cache.clear(); art?.dispose(); art = null; output = null; texture.width = texture.height = 0;
      canvas.removeEventListener('contextlost', fail); ctx?.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}

export function mountHumanRenderer(canvas: HTMLCanvasElement, options: CharacterStageOptions & {
  assetRoot?: string; assetUrls?: Record<string, string>;
}) {
  return mountCharacterStage(canvas, { ...options,
    createRenderer: (ready, fail) => createHumanCanvasRenderer(canvas, { ...options, ready, fail }),
  });
}
