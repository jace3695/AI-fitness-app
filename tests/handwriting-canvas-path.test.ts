import assert from 'node:assert/strict';
import { test } from 'node:test';
import { visibleCanvasStrokePath } from './helpers/handwriting-canvas-path.ts';

function canvas(rect = { left: 10, top: 0, right: 500, bottom: 400 }, obscured = (_x: number, _y: number) => false) {
  const overlay = {};
  const node = {
    getBoundingClientRect: () => rect,
    ownerDocument: {
      defaultView: { innerWidth: 600, innerHeight: 500 },
      elementFromPoint: (x: number, y: number) => x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom && !obscured(x, y) ? node : overlay,
    },
  };
  return node as unknown as Element;
}

test('handwriting pointer path clears a sticky header hiding the old y + 20 start', () => {
  const node = canvas(undefined, (_x, y) => y < 73);
  assert.notEqual(node.ownerDocument.elementFromPoint(30, 20), node);
  const path = visibleCanvasStrokePath(node, 0)!;
  assert.ok(path.start.y >= 73);
  for (let step = 0; step <= 5; step++) assert.equal(node.ownerDocument.elementFromPoint(path.start.x + (path.end.x - path.start.x) * step / 5, path.start.y + (path.end.y - path.start.y) * step / 5), node);
});

test('handwriting path checks intermediate steps, not only unobscured endpoints', () => {
  const node = canvas(undefined, (x, y) => x > 55 && x < 85 && y < 55);
  const path = visibleCanvasStrokePath(node, 0)!;
  assert.ok(path.start.y >= 60);
});

test('clipped canvas uses viewport-visible interior and preserves distinct stroke offsets', () => {
  const node = canvas({ left: -40, top: -100, right: 350, bottom: 800 });
  const first = visibleCanvasStrokePath(node, 0)!, second = visibleCanvasStrokePath(node, 30)!;
  assert.deepEqual(first, { start: { x: 20, y: 20 }, end: { x: 100, y: 40 } });
  assert.equal(second.start.y - first.start.y, 30);
  assert.ok(second.end.y < node.ownerDocument.defaultView!.innerHeight);
});

test('covered and too-small canvases refuse to synthesize a stroke', () => {
  assert.equal(visibleCanvasStrokePath(canvas(undefined, () => true), 0), null);
  assert.equal(visibleCanvasStrokePath(canvas({ left: 0, top: 0, right: 60, bottom: 60 }), 0), null);
});
