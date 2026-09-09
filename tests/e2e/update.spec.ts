import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect, login, synced, saveMeal, mealMemo, assertOriginalPreserved } from './fixture';

test.use({ serviceWorkers: 'allow' });
test('production service worker waits during editing, then activates after save and explicit refresh', async ({ page, qa }) => {
  // Same-origin real SW script change, no fake waiting state or SW API mock.
  // This is a worker update against the complete production app, not a Vercel rollout.
  const file = 'public/sw.js'; const before = readFileSync(file, 'utf8');
  try {
    await login(page, qa.account); await synced(page);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload(); await synced(page);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await page.goto('/diet'); await synced(page);
    await page.getByLabel('메모', { exact: true }).fill('CI draft through worker update');
    writeFileSync(file, `${before}\n// Disposable CI worker revision ${Date.now()}\n`);
    await page.evaluate(async () => { const registration = await navigator.serviceWorker.ready; await registration.update(); });
    await expect(page.getByRole('button', { name: '지금 갱신', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '지금 갱신', exact: true })).toBeDisabled();
    expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).waiting?.state)).toBe('installed');
    await expect(page.getByLabel('메모', { exact: true })).toHaveValue('CI draft through worker update');
    await saveMeal(page, 'CI draft through worker update'); await synced(page);
    await expect(page.getByRole('button', { name: '지금 갱신', exact: true })).toBeEnabled();
    const reload = page.waitForEvent('load');
    await page.getByRole('button', { name: '지금 갱신', exact: true }).click(); await reload; await synced(page);
    await expect(page.getByLabel('메모', { exact: true })).toHaveValue('CI draft through worker update');
    expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).waiting === null)).toBe(true);
    const state = await qa.read(); assertOriginalPreserved(state); expect(mealMemo(state)).toBe('CI draft through worker update');
  } finally { writeFileSync(file, before); }
});
