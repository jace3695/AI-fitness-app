import { test, expect, login, synced, original, localState, assertOriginalPreserved, saveMeal, mealMemo, today } from './fixture';

test('login, logout and same-account relogin preserve all 17 original keys without PATCH', async ({ page, qa }) => {
  await login(page, qa.account); await synced(page);
  expect(await qa.read()).toEqual(original); expect(await localState(page)).toEqual(original);
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByLabel('이메일', { exact: true })).toBeVisible();
  expect(await localState(page)).toEqual({});
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('fitness-cloud-sync-base:')))).toEqual([]);
  await login(page, qa.account); await synced(page); await page.reload(); await synced(page);
  expect(await qa.read()).toEqual(original); expect(await localState(page)).toEqual(original);
  expect(qa.traffic.entries.filter(e => e.method === 'PATCH')).toHaveLength(0);
});

test('legacy logged-out empty cache with a remaining baseline cannot delete the server', async ({ page, context, qa }) => {
  await context.addInitScript(({ id, state }) => {
    if (sessionStorage.getItem('ci-legacy-prepared')) return;
    localStorage.setItem(`fitness-cloud-sync-base:${id}`, JSON.stringify(state));
    sessionStorage.setItem('ci-legacy-prepared', '1');
  }, { id: qa.account.id, state: original });
  await login(page, qa.account); await synced(page);
  expect(await localState(page)).toEqual(original); expect(await qa.read()).toEqual(original);
  expect(qa.traffic.entries.filter(e => e.method === 'PATCH')).toHaveLength(0);
});

test('old in-flight GET cannot repopulate records after logout', async ({ page, qa }) => {
  const hold = qa.traffic.holdNext('GET', 'response');
  await login(page, qa.account); await hold.arrived;
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByLabel('이메일', { exact: true })).toBeVisible();
  hold.release();
  // A completed fresh authentication/read round-trip is the observation fence.
  expect(await qa.read()).toEqual(original); expect(await localState(page)).toEqual({});
  await login(page, qa.account); await synced(page);
  expect(await localState(page)).toEqual(original);
  expect(qa.traffic.entries.filter(e => e.method === 'PATCH')).toHaveLength(0);
});

test('authenticated RLS rejects another account reading or overwriting the owner', async ({ qa }) => {
  const other = await qa.createAccount();
  const read = await other.client.from('user_app_state').select('state').eq('user_id', qa.account.id);
  expect(read.error).toBeNull(); expect(read.data).toEqual([]);
  const write = await other.client.from('user_app_state').update({ state: {} }).eq('user_id', qa.account.id).select();
  expect(write.error).toBeNull(); expect(write.data).toEqual([]);
  expect(await qa.read()).toEqual(original);
});

