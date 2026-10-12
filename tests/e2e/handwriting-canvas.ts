import { expect, type Locator, type Page } from '@playwright/test';
import { visibleCanvasStrokePath, type CanvasStrokePath } from '../helpers/handwriting-canvas-path';

export async function drawVisibleCanvasStroke(page: Page, canvas: Locator, offset = 0) {
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  let path: CanvasStrokePath | null = null;
  await expect.poll(async () => {
    path = await canvas.evaluate(visibleCanvasStrokePath, offset);
    return path !== null;
  }, { message: 'A complete handwriting stroke must hit the visible canvas, clear of sticky headers.' }).toBe(true);
  const { start, end } = path!;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  try { await page.mouse.move(end.x, end.y, { steps: 5 }); }
  finally { await page.mouse.up(); }
}
