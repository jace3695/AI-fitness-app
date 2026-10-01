import type { Viseme } from './lip-sync';
import { mouthKey, type MouthPose } from './mouth-motion.ts';

/** Five columns: left corner, left lip, centre, right lip, right corner.
 * Four curves align both the outer lip and opening, including the sloping smile.
 * Coordinates were inspected on the existing approved patches; no images are generated. */
type Five = readonly [number, number, number, number, number];
export type MouthLandmarks = Readonly<{ x: Five; upper: Five; openingTop: Five; openingBottom: Five; lower: Five }>;
export type MouthGeometry = Readonly<Record<Viseme, MouthLandmarks>>;
export const HUMAN_MOUTH_RECT = [425, 512, 200, 112] as const;
export const CAT_MOUTH_RECT = [153, 187, 51, 36] as const;
const shape = (x: Five, upper: Five, openingTop: Five, openingBottom: Five, lower: Five): MouthLandmarks => ({ x, upper, openingTop, openingBottom, lower });
const humanRest = shape([31,63,96,130,161], [28,22,18,20,15], [30,35,35,28,17], [30.6,35.6,35.6,28.6,17.6], [33,53,61,48,21]);
export const HUMAN_MOUTH_GEOMETRY: MouthGeometry = {
  rest: humanRest, closed: humanRest,
  a: shape([40,67,94,124,154], [38,20,15,17,26], [40,36,33,30,28], [41,49,57,47,29], [44,70,82,66,32]),
  i: shape([31,64,97,131,162], [28,19,15,16,16], [30,32,33,25,18], [31,38,40,31,19], [34,55,63,51,22]),
  e: shape([39,67,95,125,156], [32,17,14,16,18], [34,32,31,26,20], [35,41,46,35,21], [38,61,70,54,24]),
  u: shape([55,74,96,118,140], [41,24,19,24,33], [43,40,39,38,35], [43.6,40.6,44,38.6,35.6], [47,63,76,60,39]),
  o: shape([62,80,96,116,135], [46,22,14,21,40], [48,37,35,37,42], [49,51,57,50,43], [54,76,85,75,48]),
  small: shape([40,68,96,125,154], [37,20,17,19,26], [39,35,33,29,28], [40,45,48,38,29], [44,63,74,60,32]),
};
const catX: Five = [10,17,25,33,40];
// A closed W has no interior contour. Keep a shallow U-shaped virtual cavity
// for opening/closing, so the tongue is never folded into a W. Exact rest bypasses it.
const catRest = shape(catX, [5,8,2,8,5], [7,10,4,10,7], [7.2,10.2,11,10.2,7.2], [10,12,14,12,10]);
export const CAT_MOUTH_GEOMETRY: MouthGeometry = {
  rest: catRest, closed: catRest,
  a: shape(catX, [5,8,2,8,5], [7,10,5,10,7], [9,18,21,18,9], [11,21,23,21,11]),
  i: shape(catX, [5,7,3,7,5], [7,9,6,9,7], [9,15,17,15,9], [11,18,19,18,11]),
  e: shape(catX, [5,7,3,7,5], [7,9,6,9,7], [10,16,19,16,10], [12,18,20,18,12]),
  u: shape([20,22,25,28,30], [9,6,4,6,9], [10,8,6,8,10], [13,15,16,15,13], [15,18,19,18,15]),
  o: shape([17,21,25,29,34], [10,5,3,5,10], [11,7,5,7,11], [15,19,20,19,15], [17,22,23,22,17]),
  small: shape(catX, [5,8,2,8,5], [7,10,5,10,7], [9,16,19,16,9], [11,19,21,19,11]),
};
type Point = Readonly<{ x: number; y: number }>;
export function mouthMesh(g: MouthLandmarks, width: number, height: number): readonly Point[] {
  const points: Point[] = [], curves = [g.upper, g.openingTop, g.openingBottom, g.lower];
  for (let row = 0; row < 6; row++) for (let col = 0; col < 7; col++) {
    const border = row === 0 || row === 5 || col === 0 || col === 6;
    points.push({ x: border ? col / 6 * (width - 1) : g.x[col - 1], y: border ? row / 5 * (height - 1) : curves[row - 1][col - 1] });
  }
  return points;
}
export const MOUTH_TRIANGLES: readonly (readonly [number, number, number])[] = Object.freeze(Array.from({ length: 30 }, (_, cell) => {
  const i = Math.floor(cell / 6) * 7 + cell % 6;
  return [[i, i + 1, i + 8], [i, i + 8, i + 7]] as const;
}).flat());

/** Warp both source contours into one intermediate mesh before colour interpolation.
 * Fixed patch border; exact endpoint bypass; no whole-face dissolve or cue history. */
export function morphMouthPixels(a: Uint8ClampedArray, b: Uint8ClampedArray, output: Uint8ClampedArray,
  width: number, height: number, from: MouthLandmarks, to: MouthLandmarks, mix: number, colourMix = mix, pinnedTopRows = 0) {
  if (mix <= 0) { output.set(a); return; } if (mix >= 1) { output.set(b); return; }
  if (from === to && a === b) { output.set(a); return; }
  const sourceA = mouthMesh(from, width, height), sourceB = mouthMesh(to, width, height);
  const target = sourceA.map((p, i) => ({ x: p.x * (1 - mix) + sourceB[i].x * mix, y: p.y * (1 - mix) + sourceB[i].y * mix }));
  const channels = new Float64Array(3);
  const sample = (data: Uint8ClampedArray, sx: number, sy: number, weight: number, add: boolean) => {
    const xx = Math.max(0, Math.min(width - 1, sx)), yy = Math.max(0, Math.min(height - 1, sy));
    const ix = Math.floor(xx), iy = Math.floor(yy), fx = xx - ix, fy = yy - iy;
    const p = (iy * width + ix) * 4, q = (iy * width + Math.min(width - 1, ix + 1)) * 4;
    const r = (Math.min(height - 1, iy + 1) * width + ix) * 4, s = (Math.min(height - 1, iy + 1) * width + Math.min(width - 1, ix + 1)) * 4;
    for (let c = 0; c < 3; c++) {
      const value = (data[p + c] * (1 - fx) + data[q + c] * fx) * (1 - fy) + (data[r + c] * (1 - fx) + data[s + c] * fx) * fy;
      channels[c] = (add ? channels[c] : 0) + value * weight;
    }
  };
  for (const [pi, qi, ri] of MOUTH_TRIANGLES) {
    const p = target[pi], q = target[qi], r = target[ri];
    const determinant = (q.y - r.y) * (p.x - r.x) + (r.x - q.x) * (p.y - r.y);
    const minX = Math.max(0, Math.ceil(Math.min(p.x, q.x, r.x))), maxX = Math.min(width - 1, Math.floor(Math.max(p.x, q.x, r.x)));
    const minY = Math.max(0, Math.ceil(Math.min(p.y, q.y, r.y))), maxY = Math.min(height - 1, Math.floor(Math.max(p.y, q.y, r.y)));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const u = ((q.y - r.y) * (x - r.x) + (r.x - q.x) * (y - r.y)) / determinant;
      const v = ((r.y - p.y) * (x - r.x) + (p.x - r.x) * (y - r.y)) / determinant, w = 1 - u - v;
      if (Math.min(u, v, w) < -1e-8) continue;
      const i = (y * width + x) * 4;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        for (let c = 0; c < 4; c++) output[i + c] = a[i + c] * (1 - colourMix) + b[i + c] * colourMix;
        continue;
      }
      // The cat's nose enters the top of the mouth patch. Pin it and feather the
      // coordinate displacement over two rows before reaching the lip mesh.
      const pin = pinnedTopRows ? Math.max(0, Math.min(1, (y - pinnedTopRows) / 2)) : 1;
      const fade = pin * pin * (3 - 2 * pin);
      sample(a, x + (sourceA[pi].x * u + sourceA[qi].x * v + sourceA[ri].x * w - x) * fade,
        y + (sourceA[pi].y * u + sourceA[qi].y * v + sourceA[ri].y * w - y) * fade, 1 - colourMix, false);
      sample(b, x + (sourceB[pi].x * u + sourceB[qi].x * v + sourceB[ri].x * w - x) * fade,
        y + (sourceB[pi].y * u + sourceB[qi].y * v + sourceB[ri].y * w - y) * fade, colourMix, true);
      for (let c = 0; c < 3; c++) output[i + c] = channels[c];
      output[i + 3] = a[i + 3] * (1 - mix) + b[i + 3] * mix;
    }
  }
}

export function createMouthMorph(width: number, height: number, geometry: MouthGeometry, read: (shape: Viseme) => ImageData, collapseCavity = false) {
  const endpoints = new Map<Viseme, ImageData>(), output = new ImageData(width, height);
  let key = '';
  return {
    frame(pose: MouthPose) {
      const nextKey = mouthKey(pose); if (key === nextKey) return output;
      for (const shape of [pose.from, pose.to]) if (!endpoints.has(shape)) endpoints.set(shape, read(shape));
      let colourMix = pose.mix;
      if (collapseCavity) {
        // The cat's closed W has no cavity texture. Reveal the existing open texture
        // through its shrinking mesh instead of stretching white fur into the cavity.
        const closed = (shape: Viseme) => shape === 'rest' || shape === 'closed';
        const ease = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
        if (closed(pose.from) && !closed(pose.to)) colourMix = ease(pose.mix / .12);
        else if (!closed(pose.from) && closed(pose.to)) colourMix = 1 - ease((1 - pose.mix) / .12);
      }
      morphMouthPixels(endpoints.get(pose.from)!.data, endpoints.get(pose.to)!.data, output.data,
        width, height, geometry[pose.from], geometry[pose.to], pose.mix, colourMix, collapseCavity ? 4 : 0);
      key = nextKey; return output;
    },
    dispose() { endpoints.clear(); key = ''; },
  };
}
