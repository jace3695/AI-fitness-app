import { test, expect, login, synced, saveMeal, mealSaved, mealMemo, assertOriginalPreserved } from './fixture';

for (const width of [320, 390]) {
  test(`full diet app at ${width}px: input, scroll, save, settings and reload`, async ({ page, qa }) => {
    await page.setViewportSize({ width, height: 844 });
    await login(page, qa.account); await synced(page);
    await page.goto('/diet'); await synced(page);
    await expect(page.getByLabel('메모', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await saveMeal(page, `CI ${width}px`); await mealSaved(page, qa, `CI ${width}px`);
    const state = await qa.read(); assertOriginalPreserved(state); expect(mealMemo(state)).toBe(`CI ${width}px`);
    qa.traffic.assertConfirmed(state);
    await page.getByRole('link', { name: '설정', exact: true }).click();
    await expect(page.getByRole('heading', { name: '식단 설정', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('link', { name: /식단 앱으로 돌아가기/ }).click();
    await expect(page).toHaveURL('http://127.0.0.1:3000/diet');
    await page.reload(); await synced(page);
    await expect(page.getByLabel('메모', { exact: true })).toHaveValue(`CI ${width}px`);
  });
}
