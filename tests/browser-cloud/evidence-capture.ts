import type { Page } from '@playwright/test';

type Dimensions = { width: number; height: number; deviceScaleFactor: number };
type Clip = { x: number; y: number; width: number; height: number };

// Linux WebKit's Cairo backend rejects either device-pixel side above 32767.
// Keep normal captures unchanged; oversized pages use complete native-density tiles.
export function fullPageEvidenceClips({ width, height, deviceScaleFactor }: Dimensions): (Clip | undefined)[] {
  if (![width, height, deviceScaleFactor].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid evidence dimensions');
  if (Math.ceil(width * deviceScaleFactor) > 32767) throw new Error('Evidence width exceeds native capture limit');
  if (Math.ceil(height * deviceScaleFactor) <= 32767) return [undefined];
  const tileHeight = Math.floor(16000 / deviceScaleFactor);
  if (tileHeight < 1) throw new Error('Invalid evidence scale');
  if (Math.ceil(height / tileHeight) > 64) throw new Error('Evidence page exceeds bounded tile budget');
  const clips: Clip[] = [];
  for (let y = 0; y < height; y += tileHeight) clips.push({ x: 0, y, width, height: Math.min(tileHeight, height - y) });
  return clips;
}

export async function captureFullPageEvidence(page: Pick<Page, 'evaluate' | 'screenshot'>, path: string) {
  if (!path.endsWith('.png')) throw new Error('PNG evidence required');
  const dimensions = await page.evaluate(() => {
    const body = document.body, html = document.documentElement;
    return {
      width: Math.max(body.scrollWidth, body.offsetWidth, body.clientWidth, html.clientWidth, html.scrollWidth, html.offsetWidth),
      height: Math.max(body.scrollHeight, body.offsetHeight, body.clientHeight, html.clientHeight, html.scrollHeight, html.offsetHeight),
      deviceScaleFactor: devicePixelRatio,
    };
  });
  const clips = fullPageEvidenceClips(dimensions);
  for (const [index, clip] of clips.entries()) {
    await page.screenshot({ path: index === 0 ? path : path.replace(/\.png$/, `-part-${String(index + 1).padStart(3, '0')}.png`),
      fullPage: true, ...(clip ? { clip } : {}) });
  }
}
