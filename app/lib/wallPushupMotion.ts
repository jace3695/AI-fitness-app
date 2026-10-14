export type Point = { x: number; y: number };
export const ARM_LENGTH = 53;

/** Original 2D schematic, not a captured or clinically validated body model. */
export function wallPushupPose(progress: number) {
  const phase = Math.max(0, Math.min(1, progress));
  const bend = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
  const angle = 0.10 + bend * 0.25;
  const ankle = { x: 90, y: 270 };
  const alongBody = (length: number): Point => ({ x: ankle.x + Math.sin(angle) * length, y: ankle.y - Math.cos(angle) * length });
  const shoulder = alongBody(165);
  const hand = { x: 210, y: 106 };
  const dx = hand.x - shoulder.x, dy = hand.y - shoulder.y;
  const distance = Math.hypot(dx, dy);
  const height = Math.sqrt(Math.max(0, ARM_LENGTH ** 2 - distance ** 2 / 4));
  const elbow = { x: (hand.x + shoulder.x) / 2 - dy / distance * height, y: (hand.y + shoulder.y) / 2 + dx / distance * height };
  return { ankle, knee: alongBody(52), hip: alongBody(100), shoulder, head: alongBody(190), hand, elbow };
}
