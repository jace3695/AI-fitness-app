import { test, expect } from '@playwright/test';

test('isolated Next denies the hosted-only speech diagnostic page and body-free gate', async ({ page, context }) => {
  const external: string[] = [];
  await context.route('**/*', async route => {
    const origin = new URL(route.request().url()).origin;
    if (origin === 'http://127.0.0.1:3000') await route.continue();
    else { external.push(origin); await route.abort('blockedbyclient'); }
  });
  // The production page gate must remain closed here; no Preview flags/owner/hosted URL are fabricated.
  const response = await page.goto('/language/practice/access-check');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('button', { name: '권한 확인하기', exact: true })).toHaveCount(0);
  const gate = await page.evaluate(async () => {
    const response = await fetch('/api/language/access-check', {
      method: 'HEAD', cache: 'no-store', headers: { 'X-Yeoni-Boundary-Owner': '0'.repeat(64) },
    });
    return { status: response.status, cache: response.headers.get('cache-control'), text: await response.text() };
  });
  expect(gate).toEqual({ status: 404, cache: 'private, no-store', text: '' });
  await page.reload();
  expect(external, 'Denied diagnostic must not mount cloud data or provider clients').toEqual([]);
});
