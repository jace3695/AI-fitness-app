import { test as base, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export { expect };
export const test = base.extend<{ isolation: void }>({
  isolation: [async ({ context, page }, use, testInfo) => {
    const errors: string[] = [], external: string[] = [];
    page.on('pageerror', error => errors.push(error.name));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === 'http://127.0.0.1:3107') await route.continue();
      else { external.push(url.origin); await route.abort('blockedbyclient'); }
    });
    await context.addInitScript(() => {
      // Physical microphone access is never part of this synthetic lane.
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new Error('Physical capture forbidden in synthetic QA'); };
    });
    await mkdir('.e2e/component-browser/evidence', { recursive: true });
    await use();
    if (!page.isClosed()) {
      const id = createHash('sha256').update(testInfo.titlePath.join('/')).digest('hex').slice(0, 16);
      await page.screenshot({ path: `.e2e/component-browser/evidence/${testInfo.project.name}-${id}.png`, fullPage: true });
    }
    expect(errors, 'Actual component JavaScript exceptions').toEqual([]);
    expect(external, 'No request leaves the exact synthetic localhost origin').toEqual([]);
  }, { auto: true }],
});
