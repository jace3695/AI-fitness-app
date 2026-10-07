import type { CharacterFrame } from './character-controller.ts';

export type HumanPoint = Readonly<{ x: number; y: number }>;
export type HumanPose = Readonly<{ angle: number; drop: number; breath: number }>;
export const HUMAN_NECK = [696, 816] as const;
export const HUMAN_PIVOT = { x: 524, y: 696 } as const;
const clamp = (n: number, bound: number) => Math.max(-bound, Math.min(bound, n));

/** Only artwork coordinates. Controller, visemes and clocks remain shared. */
export function humanPose(frame: CharacterFrame): HumanPose {
  return { angle: clamp(frame.sway * .008 + frame.headTilt * .022, .024),
    drop: clamp(frame.headNod, 1) * 9 - clamp(frame.breath, .008) * 240,
    breath: clamp(frame.breath, .008) };
}

/** Rigid face including every approved patch; continuous neck; anchored torso bottom. */
export function humanTransform(pose: HumanPose) {
  const c = Math.cos(pose.angle), s = Math.sin(pose.angle), k = pose.breath * .35;
  function forward(x: number, y: number): HumanPoint {
    const u = Math.max(0, Math.min(1, (y - HUMAN_NECK[0]) / (HUMAN_NECK[1] - HUMAN_NECK[0])));
    const h = 1 - u * u * (3 - 2 * u), px = x - HUMAN_PIVOT.x, py = y - HUMAN_PIVOT.y;
    return { x: x + h * (px * c - py * s - px),
      y: y + h * (px * s + py * c - py + pose.drop) - (1 - h) * k * (1536 - y) };
  }
  function inverse(x: number, y: number): HumanPoint {
    const px = x - HUMAN_PIVOT.x, py = y - HUMAN_PIVOT.y - pose.drop;
    const hx = HUMAN_PIVOT.x + px * c + py * s, hy = HUMAN_PIVOT.y - px * s + py * c;
    if (hy <= HUMAN_NECK[0]) return { x: hx, y: hy };
    const by = (y + k * 1536) / (1 + k);
    if (by >= HUMAN_NECK[1]) return { x, y: by };
    let sx = x, sy = y;
    // The bounded small deformation is contractive in the neck band.
    for (let n = 0; n < 6; n++) { const p = forward(sx, sy); sx += x - p.x; sy += y - p.y; }
    return { x: sx, y: sy };
  }
  return { forward, inverse };
}
