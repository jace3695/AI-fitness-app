import { test, expect, login, synced, original, localState, assertOriginalPreserved, saveMeal, mealMemo, today } from './fixture';

test('first GET delivery delayed while a real form saves: originals and new input survive', async ({ page, qa }) => {
  const hold = qa.traffic.holdNext('GET', 'response');
  await login(page, qa.account, '/diet'); await hold.arrived;
  await saveMeal(page, 'CI initial GET pending');
  hold.release(); await synced(page);
  const state = await qa.read(); assertOriginalPreserved(state);
  expect(mealMemo(state)).toBe('CI initial GET pending');
  qa.traffic.assertConfirmed(state);
  await page.reload(); await synced(page);
  await expect(page.getByLabel('메모', { exact: true })).toHaveValue('CI initial GET pending');
});

for (const direction of ['A-after-B', 'B-after-A']) {
  test(`two independent authenticated sessions force a stale CAS: ${direction}`, async ({ page, browser, qa }) => {
    await login(page, qa.account); await synced(page);
    await page.goto('/diet'); await synced(page);
    await saveMeal(page, 'CI common base'); await synced(page);
    const otherContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3000', timezoneId: 'Asia/Seoul', locale: 'ko-KR', serviceWorkers: 'block' });
    try {
      const { Traffic } = await import('./fixture');
      const otherTraffic = new Traffic(); await otherTraffic.install(otherContext);
      const other = await otherContext.newPage(); await login(other, qa.account); await synced(other);
      await other.goto('/diet'); await synced(other);
      const heldPage = direction === 'A-after-B' ? page : other;
      const winningPage = direction === 'A-after-B' ? other : page;
      const heldTraffic = direction === 'A-after-B' ? qa.traffic : otherTraffic;
      const hold = heldTraffic.holdNext('PATCH', 'request');
      await saveMeal(heldPage, `CI ${direction}`); await hold.arrived;
      await winningPage.getByRole('button', { name: '+500mL', exact: true }).click();
      await winningPage.getByRole('button', { name: '오늘 식단 저장', exact: true }).click();
      await synced(winningPage);
      expect((await qa.read())['ai-fitness-water-intake']).toMatchObject({ [today()]: 500 });
      hold.release();
      await expect(heldPage.getByText('기록 동기화 실패', { exact: true })).toBeVisible();
      expect(heldTraffic.entries.some(e => e.method === 'PATCH' && e.cas && e.status === 200 && e.matched === false), 'The stale conditional update actually matched zero rows').toBe(true);
      await heldPage.getByRole('button', { name: '다시 시도', exact: true }).click(); await synced(heldPage);
      const state = await qa.read(); assertOriginalPreserved(state);
      expect(mealMemo(state)).toBe(`CI ${direction}`);
      expect(state['ai-fitness-water-intake']).toMatchObject({ [today()]: 500 });
      heldTraffic.assertConfirmed(state);
      await winningPage.getByRole('button', { name: '지금 동기화', exact: true }).click(); await synced(winningPage);
      expect(await localState(winningPage)).toEqual(state);
      expect(otherTraffic.blockedOrigins.size).toBe(0);
      qa.traffic.entries.push(...otherTraffic.entries);
    } finally { await otherContext.close(); }
  });
}

test('a PATCH response pending during another save and page exit preserves the latest edit', async ({ page, qa }) => {
  await login(page, qa.account); await synced(page); await page.goto('/diet'); await synced(page);
  const hold = qa.traffic.holdNext('PATCH', 'response');
  await saveMeal(page, 'CI first edit'); await hold.arrived;
  expect(mealMemo(await qa.read())).toBe('CI first edit');
  await saveMeal(page, 'CI second edit');
  // A real Next Link keeps the root synchronizer alive while the editor unmounts.
  await page.getByRole('link', { name: '설정', exact: true }).click();
  await expect(page).toHaveURL(/\/diet\/settings$/);
  hold.release(); await synced(page);
  const state = await qa.read(); assertOriginalPreserved(state);
  expect(mealMemo(state)).toBe('CI second edit'); qa.traffic.assertConfirmed(state);
  await page.goto('/diet'); await synced(page);
  await expect(page.getByLabel('메모', { exact: true })).toHaveValue('CI second edit');
});

test('committed PATCH with response loss keeps local data and recovers by a real GET', async ({ page, qa }) => {
  await login(page, qa.account); await synced(page); await page.goto('/diet'); await synced(page);
  const hold = qa.traffic.holdNext('PATCH', 'loss');
  await saveMeal(page, 'CI lost response'); await hold.arrived;
  expect(mealMemo(await qa.read())).toBe('CI lost response');
  hold.release(); await expect(page.getByText('기록 동기화 실패', { exact: true })).toBeVisible();
  expect(mealMemo(await localState(page))).toBe('CI lost response');
  await page.getByRole('button', { name: '다시 시도', exact: true }).click(); await synced(page);
  const state = await qa.read(); assertOriginalPreserved(state); expect(mealMemo(state)).toBe('CI lost response');
  expect(qa.traffic.entries.some(e => e.method === 'PATCH' && e.status === 200 && e.delivered === false)).toBe(true);
  expect(qa.traffic.entries.at(-1)?.receivedState).toEqual(state);
});

test('failed confirmation GET never shows success; edits survive SDK retries and manual recovery', async ({ page, qa }) => {
  await login(page, qa.account); await synced(page); await page.goto('/diet'); await synced(page);
  const hold = qa.traffic.holdNext('PATCH', 'response');
  await saveMeal(page, 'CI confirmation interrupted'); await hold.arrived;
  qa.traffic.failReads = true; hold.release();
  await expect(page.getByText('기록 동기화 실패', { exact: true })).toBeVisible();
  await expect(page.getByText('서버 반영 완료', { exact: true })).toHaveCount(0);
  expect(mealMemo(await localState(page))).toBe('CI confirmation interrupted');
  expect(qa.traffic.entries.filter(e => e.synthetic).length).toBeGreaterThan(0);
  qa.traffic.failReads = false;
  await page.getByRole('button', { name: '다시 시도', exact: true }).click(); await synced(page);
  const state = await qa.read(); assertOriginalPreserved(state); qa.traffic.assertConfirmed(state);
});

test('deleting the synthetic day then leaving does not resurrect it on reload', async ({ page, qa }) => {
  await login(page, qa.account); await synced(page); await page.goto('/diet'); await synced(page);
  await saveMeal(page, 'CI remove this day'); await synced(page);
  const hold = qa.traffic.holdNext('PATCH', 'response');
  await page.getByRole('button', { name: '오늘 기록 초기화', exact: true }).click(); await hold.arrived;
  await page.getByRole('link', { name: '설정', exact: true }).click(); hold.release(); await synced(page);
  const state = await qa.read(); assertOriginalPreserved(state); expect(mealMemo(state)).toBeUndefined();
  expect((state['ai-fitness-diet-completed-days'] as Record<string, unknown>)[today()]).toBeUndefined();
  qa.traffic.assertConfirmed(state);
  await page.goto('/diet'); await synced(page);
  await expect(page.getByLabel('메모', { exact: true })).toHaveValue('');
});
