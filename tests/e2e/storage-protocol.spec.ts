import type { Page } from '@playwright/test';
import { test, expect, login, synced, localState, original, assertOriginalPreserved, today, isSharedSyncWrite } from './fixture';
import { reauthenticateFixtureAccount } from './fixture-account-auth';

// Authored acceptance for the disposable local Supabase fixture only. These
// cases must run in actual Chromium/WebKit; VM unit tests are not substitutes.
const LOCK = 'yeoni-shared-local-storage-v2';
const PROTOCOL = 'yeoni-storage-transaction-v2';
const LEGACY = 'yeoni-storage-transaction-v1';
const DIET = 'ai-fitness-diet-completed-days';
const WATER = 'ai-fitness-water-intake';

type LockWindow = Window & { releaseStorageFixtureLock?: () => void };
async function holdStorageLock(page: Page) {
  await page.evaluate(async lock => {
    if (!navigator.locks) throw new Error('Actual Web Locks support is required for this acceptance case');
    await new Promise<void>((acquired, reject) => {
      void navigator.locks.request(lock, { mode: 'exclusive' }, () => new Promise<void>(release => {
        (window as LockWindow).releaseStorageFixtureLock = release;
        acquired();
      })).catch(reject);
    });
  }, LOCK);
  await expect.poll(() => page.evaluate(async lock => (await navigator.locks.query()).held?.some(item => item.name === lock), LOCK)).toBe(true);
}
async function releaseStorageLock(page: Page) {
  if (page.isClosed()) return;
  await page.evaluate(() => {
    (window as LockWindow).releaseStorageFixtureLock?.();
    delete (window as LockWindow).releaseStorageFixtureLock;
  });
}
async function expectQueued(page: Page, minimum = 1) {
  await expect.poll(() => page.evaluate(async lock => (await navigator.locks.query()).pending?.filter(item => item.name === lock).length ?? 0, LOCK)).toBeGreaterThanOrEqual(minimum);
}
const record = async (page: Page) => (await localState(page))[DIET] as Record<string, Record<string, unknown>>;

test('real shared Web Lock serializes two tabs without losing independent diet edits or newer input', async ({ page, context, qa }) => {
  await login(page, qa.account, '/diet'); await synced(page);
  const peer = await context.newPage(); const holder = await context.newPage();
  try {
    await peer.goto('/diet'); await synced(peer);
    await holder.goto('/diet/settings'); await synced(holder);
    await page.getByLabel('오늘 배고픔을 느꼈나요?', { exact: true }).selectOption('yes');
    await peer.getByRole('button', { name: '+500mL', exact: true }).click();
    await holdStorageLock(holder);
    await page.getByRole('button', { name: '오늘 식단 저장', exact: true }).click();
    await peer.getByRole('button', { name: '오늘 식단 저장', exact: true }).click();
    await expectQueued(holder, 2);
    await expect(page.getByRole('button', { name: '오늘 식단 저장', exact: true })).toBeDisabled();
    await expect(peer.getByRole('button', { name: '오늘 식단 저장', exact: true })).toBeDisabled();
    expect((await record(page))[today()]).toBeUndefined();
    // A real input event while its first revision is queued must remain dirty.
    await page.getByLabel('오늘 배고픔을 느꼈나요?', { exact: true }).selectOption('no');
    await releaseStorageLock(holder);
    await expect(page.getByText('선택한 식단 기록을 저장했습니다. 이후 작성한 내용은 아직 저장되지 않았습니다.', { exact: true })).toBeVisible();
    await expect(page.getByLabel('오늘 배고픔을 느꼈나요?', { exact: true })).toHaveValue('no');
    await expect.poll(async () => (await record(peer))[today()]).toMatchObject({ hunger: 'yes', waterMl: 500 });
    await page.getByRole('button', { name: '오늘 식단 저장', exact: true }).click();
    await expect.poll(async () => ((await qa.read())[DIET] as Record<string, unknown>)[today()]).toMatchObject({ hunger: 'no', waterMl: 500 });
    await synced(page); assertOriginalPreserved(await qa.read());
    await page.reload(); await synced(page);
    await expect(page.getByLabel('오늘 배고픔을 느꼈나요?', { exact: true })).toHaveValue('no');
    expect((await record(page))[today()]).toMatchObject({ hunger: 'no', waterMl: 500 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await releaseStorageLock(holder); await peer.close(); await holder.close(); }
});

test('queued owner A edit cannot enter owner B after a real sign-out and login transition', async ({ page, context, qa }) => {
  const other = await qa.createAccount();
  const otherState = { ...original, [DIET]: { ...(original[DIET] as object), [today()]: { dietMemo: 'CI owner B only', hunger: 'no' } } };
  expect((await other.client.from('user_app_state').update({ state: otherState }).eq('user_id', other.id)).error).toBeNull();
  await login(page, qa.account, '/diet'); await synced(page);
  const holder = await context.newPage();
  try {
    await holder.goto('/diet/settings'); await synced(holder);
    await page.getByLabel('메모', { exact: true }).fill('CI stale owner A queued draft');
    const epoch = await page.evaluate(() => localStorage.getItem('fitness-cloud-sync-epoch'));
    await holdStorageLock(holder);
    await page.getByRole('button', { name: '오늘 식단 저장', exact: true }).click();
    await expectQueued(holder);
    await holder.getByRole('button', { name: '로그아웃', exact: true }).click();
    await expect.poll(() => holder.evaluate(() => {
      const value = JSON.parse(localStorage.getItem('fitness-cloud-sync-epoch') ?? 'null');
      return value?.userId;
    })).toBeNull();
    expect(await holder.evaluate(() => localStorage.getItem('fitness-cloud-sync-epoch'))).not.toBe(epoch);
    await releaseStorageLock(holder);
    await expect(page.getByLabel('이메일', { exact: true })).toBeVisible();
    expect(await localState(page)).toEqual({});
    await login(page, other, '/diet'); await synced(page);
    expect(await localState(page)).toEqual(otherState);
    expect(await qa.read(other)).toEqual(otherState);
    await expect(page.getByLabel('메모', { exact: true })).toHaveValue('CI owner B only');
    await reauthenticateFixtureAccount(qa.account);
    expect(await qa.read(qa.account)).toEqual(original);
    await page.reload(); await synced(page); expect(await localState(page)).toEqual(otherState);
  } finally { await releaseStorageLock(holder); await holder.close(); }
});

test('legacy v1 recovery bytes survive reload and blocked save without cloud publication', async ({ page, qa }) => {
  await login(page, qa.account, '/diet'); await synced(page);
  const before = await page.evaluate(async ({ lock, legacy, diet }) => navigator.locks.request(lock, { mode: 'exclusive' }, () => {
    const previous = localStorage.getItem(diet);
    const journal = JSON.stringify({ [diet]: previous });
    localStorage.setItem(legacy, journal);
    localStorage.setItem(diet, JSON.stringify({ '2099-01-01': { dietMemo: 'CI interrupted legacy bytes' } }));
    return { journal, raw: localStorage.getItem(diet) };
  }), { lock: LOCK, legacy: LEGACY, diet: DIET });
  const publications = qa.traffic.entries.filter(isSharedSyncWrite).length;
  await page.getByLabel('오늘 배고픔을 느꼈나요?', { exact: true }).selectOption('yes');
  await page.getByRole('button', { name: '오늘 식단 저장', exact: true }).click();
  await expect(page.getByText(/기기에 저장하지 못했어요/)).toBeVisible();
  await expect(page.getByLabel('오늘 배고픔을 느꼈나요?', { exact: true })).toHaveValue('yes');
  expect(await page.evaluate(({ legacy, diet }) => ({ journal: localStorage.getItem(legacy), raw: localStorage.getItem(diet) }), { legacy: LEGACY, diet: DIET })).toEqual(before);
  await page.reload();
  await expect(page.getByRole('heading', { name: '로그인 확인을 완료하지 못했어요', exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: '이전 버전의 저장 복구 정보가 남아 있습니다' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '오늘 식단 저장', exact: true })).toHaveCount(0);
  expect(await page.evaluate(({ legacy, diet }) => ({ journal: localStorage.getItem(legacy), raw: localStorage.getItem(diet) }), { legacy: LEGACY, diet: DIET })).toEqual(before);
  expect(await qa.read()).toEqual(original);
  expect(qa.traffic.entries.filter(isSharedSyncWrite)).toHaveLength(publications);
  await expect(page.getByText('서버 반영 완료', { exact: true })).toHaveCount(0);
});

test('reload recovers an interrupted v2 transaction under the real lock before exposing the editor', async ({ page, context, qa }) => {
  await login(page, qa.account, '/diet'); await synced(page);
  const holder = await context.newPage();
  try {
    await holder.goto('/diet/settings'); await synced(holder);
    await holdStorageLock(holder);
    // Seed while the holder owns the same lock continuously through reload.
    // No competing new-code writer can recover this fixture before the gate.
    const interrupted = await holder.evaluate(({ protocol, diet, water }) => {
      const before = { [diet]: localStorage.getItem(diet), [water]: localStorage.getItem(water) };
      const raw = JSON.stringify({ version: 2, state: 'prepared', generation: crypto.randomUUID(), transactionId: crypto.randomUUID(), before });
      localStorage.setItem(protocol, raw);
      localStorage.setItem(diet, JSON.stringify({ '2099-01-01': { dietMemo: 'CI partial v2 bytes' } }));
      localStorage.removeItem(water);
      return raw;
    }, { protocol: PROTOCOL, diet: DIET, water: WATER });
    await page.reload();
    await expectQueued(holder);
    await expect(page.getByRole('button', { name: '오늘 식단 저장', exact: true })).toHaveCount(0);
    expect(await page.evaluate(protocol => localStorage.getItem(protocol), PROTOCOL)).toBe(interrupted);
    await releaseStorageLock(holder);
    await expect(page.getByRole('button', { name: '오늘 식단 저장', exact: true })).toBeVisible();
    assertOriginalPreserved(await localState(page));
    expect((await record(page))['2099-01-01']).toBeUndefined();
    expect(await page.evaluate(protocol => JSON.parse(localStorage.getItem(protocol)!).state, PROTOCOL)).toBe('committed');
    await page.getByLabel('오늘 배고픔을 느꼈나요?', { exact: true }).selectOption('yes');
    await page.getByRole('button', { name: '오늘 식단 저장', exact: true }).click();
    await expect(page.getByText('오늘 식단 기록을 저장했습니다.', { exact: true })).toBeVisible();
    await expect.poll(async () => ((await qa.read())[DIET] as Record<string, unknown>)[today()]).toMatchObject({ hunger: 'yes' });
    await synced(page); assertOriginalPreserved(await qa.read());
    expect((await record(page))['2099-01-01']).toBeUndefined();
    expect(await page.evaluate(protocol => JSON.parse(localStorage.getItem(protocol)!).state, PROTOCOL)).toBe('committed');
    await page.reload(); await synced(page);
    await expect(page.getByLabel('오늘 배고픔을 느꼈나요?', { exact: true })).toHaveValue('yes');
  } finally { await releaseStorageLock(holder); await holder.close(); }
});
