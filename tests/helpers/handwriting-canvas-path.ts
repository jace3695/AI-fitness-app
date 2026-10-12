export type CanvasStrokePath = { start: { x: number; y: number }; end: { x: number; y: number } };

// This function is also serialized into the browser by Locator.evaluate, so keep
// its implementation self-contained. Visibility alone does not exclude a sticky
// header covering a canvas after scrollIntoViewIfNeeded.
export function visibleCanvasStrokePath(node: Element, offset: number): CanvasStrokePath | null {
  const document = node.ownerDocument, view = document.defaultView;
  if (!view) return null;
  const rect = node.getBoundingClientRect();
  const left = Math.max(rect.left, 0) + 20, right = Math.min(rect.right, view.innerWidth) - 20;
  const top = Math.max(rect.top, 0) + 20, bottom = Math.min(rect.bottom, view.innerHeight) - 20;
  if (right - left < 30 || bottom - top < 30) return null;
  const dx = Math.min(80, right - left), dy = 20;
  const rows = Array.from({ length: Math.ceil((bottom - top) / 20) }, (_, index) => top + offset + index * 20);
  for (const y of rows) {
    if (y < top || y + dy > bottom) continue;
    // Check the start, every actual mouse-move step, and the end. In particular,
    // never dispatch pointerdown to an overlaid header and mistake it for ink.
    if (Array.from({ length: 6 }, (_, index) => index / 5).every(t => document.elementFromPoint(left + dx * t, y + dy * t) === node)) {
      return { start: { x: left, y }, end: { x: left + dx, y: y + dy } };
    }
  }
  return null;
}
