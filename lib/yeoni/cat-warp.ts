import type { CharacterFrame } from './character-controller.ts';

export type Point = Readonly<{ x: number; y: number }>;
export type CatWarp = Readonly<{ headAngle: number; headDrop: number; breath: number; tailAngle: number; lift: number }>;
const smooth = (a: number, b: number, x: number) => {
  const p = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return p * p * (3 - 2 * p);
};
const clamp = (n: number, bound: number) => Math.max(-bound, Math.min(bound, n));

/** Renderer coordinates only. The semantic Controller and its audio clock are unchanged. */
export function catWarp(frame: CharacterFrame, expressive: boolean): CatWarp {
  const e = frame.expression;
  const gestureTilt = frame.gesture === 'idle' ? 0 : frame.headTilt - e.headTilt;
  const gestureNod = frame.gesture === 'idle' ? 0 : frame.headNod - e.headNod;
  return {
    headAngle: expressive ? clamp((e.headTilt + gestureTilt) * .04, .04) : 0,
    headDrop: expressive ? clamp(e.headNod * 3 + gestureNod * 4, 4) : 0,
    breath: clamp(frame.breath, .008),
    tailAngle: clamp(frame.sway * .035, .05),
    lift: expressive ? clamp(frame.bodyLift, 1) * 5 : 0,
  };
}

/** Continuous deformation of the approved original; face landmarks move rigidly together. */
export function warpCatPoint(point: Point, pose: CatWarp): Point {
  const x = point.x - 24, y = point.y - 24;
  const boundary = y < 205 ? 253 - .55 * (y - 185) : 242;
  const tail = smooth(175, 187, y) * smooth(boundary - 5, boundary + 5, x);
  const head = (1 - smooth(207, 240, y)) * (1 - tail)
    * smooth(-24, 25, x) * (1 - smooth(250, 295, x));
  const body = smooth(207, 242, y) * (1 - tail);
  const hx = x - 154, hy = y - 216, tx = x - 237, ty = y - 278;
  const hc = Math.cos(pose.headAngle), hs = Math.sin(pose.headAngle);
  const tc = Math.cos(pose.tailAngle), ts = Math.sin(pose.tailAngle);
  const dx = head * (hx * hc - hy * hs - hx) + tail * (tx * tc - ty * ts - tx)
    + body * (x - 154) * pose.breath * .2;
  const dy = head * (hx * hs + hy * hc - hy + pose.headDrop)
    + tail * (tx * ts + ty * tc - ty)
    - Math.max(0, Math.min(100, 307 - y)) * pose.breath - pose.lift * (1 - smooth(292, 313, y));
  return { x: point.x + dx, y: point.y + dy };
}

export const CAT_GRID = Array.from({ length: 16 }, (_, i) => i * 24);
export const CAT_TRIANGLES = CAT_GRID.slice(0, -1).flatMap((y, row) => CAT_GRID.slice(0, -1).flatMap((x, col) => {
  const a = { x, y }, b = { x: CAT_GRID[col + 1], y }, c = { x, y: CAT_GRID[row + 1] }, d = { x: b.x, y: c.y };
  return [[a, b, c], [b, d, c]];
}));
