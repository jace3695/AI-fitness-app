import { test, expect, login, synced } from './fixture';

// Diagnostic only, not release certification. Same production app, Auth,
// origin allowlist, route.continue implementation and cleanup as release CI.
for (let sample = 1; sample <= 15; sample++) {
  test(`navigation probe ${sample}: fresh login and repeated document requests`, async ({ page, qa }) => {
    let unhandledRejections = 0;
    page.on('pageerror', error => { if (error.name === 'Unhandled Promise Rejection') unhandledRejections++; });
    await login(page, qa.account); await synced(page);
    const before = await qa.read();
    await page.setViewportSize({ width: 390, height: 844 });
    for (let cycle = 0; cycle < 4; cycle++) {
      const drawing = await page.goto('/growth/drawing');
      expect(drawing?.status()).toBe(200);
      await expect(page.getByRole('button', { name: '이어서 연습하기', exact: true })).toBeEnabled();
      const settings = await page.goto('/diet/settings');
      expect(settings?.status()).toBe(200); await synced(page);
    }
    expect(await qa.read()).toEqual(before);
    expect(unhandledRejections, 'Page navigation must not leave rejected PIN status promises unhandled').toBe(0);
  });
}
