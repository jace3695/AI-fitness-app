import type { Page } from '@playwright/test';
import { test, expect, login, synced, localState, assertOriginalPreserved, saveMeal, mealSaved, mealMemo, today,
  isSharedSyncWrite, sharedSyncRpc, type State } from './fixture';

type SyncFixture = Parameters<typeof mealSaved>[1];
const dayKey = 'ai-fitness-diet-completed-days';
const review = (page: Page) => page.getByRole('region', { name: '기록 충돌 선택' });

// Authored disposable-account browser cases. No execution or visual acceptance
// is implied by discovery. The external writer is this fixture's synthetic owner.
async function remoteMemo(qa: SyncFixture, memo: string, sameRevision = false) {
  const row = await qa.account.client.from('user_app_state').select('state,updated_at').eq('user_id', qa.account.id).single();
  expect(row.error).toBeNull();
  const state = structuredClone(row.data!.state) as State;
  (state[dayKey] as Record<string, Record<string, unknown>>)[today()].dietMemo = memo;
  state['ai-fitness-water-intake'] = { ...(state['ai-fitness-water-intake'] as object), [today()]: 500 };
  const result = await qa.account.client.from('user_app_state').update({ state, updated_at: sameRevision ? row.data!.updated_at : new Date(Date.now() + 60_000).toISOString() }).eq('user_id', qa.account.id);
  expect(result.error).toBeNull(); return state;
}
async function makeConflict(page: Page, qa: SyncFixture) {
  await login(page, qa.account, '/diet'); await synced(page);
  await saveMeal(page, 'CI conflict common base'); await mealSaved(page, qa, 'CI conflict common base');
  const mark = qa.traffic.entries.length;
  const hold = qa.traffic.holdNext('GET', 'request');
  await saveMeal(page, 'CI conflict local'); await hold.arrived;
  const remote = await remoteMemo(qa, 'CI conflict remote'); hold.release();
  await expect(review(page)).toBeVisible();
  await expect(page.getByText('서버 반영 완료', { exact: true })).toHaveCount(0);
  await expect(review(page)).toContainText('CI conflict local'); await expect(review(page)).toContainText('CI conflict remote');
  expect(qa.traffic.entries.slice(mark).filter(isSharedSyncWrite)).toHaveLength(0);
  expect(mealMemo(await localState(page))).toBe('CI conflict local');
  expect(await qa.read()).toEqual(remote); return mark;
}

for (const side of ['local', 'remote'] as const) test(`same-field ${side} choice preserves independent records and survives reload at small width`, async ({ page, qa }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await makeConflict(page, qa);
  const apply = review(page).getByRole('button', { name: '선택한 값으로 동기화', exact: true });
  await expect(apply).toBeDisabled();
  const inputs = review(page).getByRole('radio');
  for (const input of await inputs.all()) await expect(input).not.toBeChecked();
  await review(page).getByRole('radio', { name: side === 'local' ? /이 기기 값 유지/ : /서버 값 유지/ }).check();
  await expect(apply).toBeEnabled(); await apply.click(); await synced(page);
  const state = await qa.read(); assertOriginalPreserved(state);
  expect(mealMemo(state)).toBe(`CI conflict ${side}`);
  expect(state['ai-fitness-water-intake']).toMatchObject({ [today()]: 500 });
  await expect(review(page)).toHaveCount(0);
  qa.traffic.assertConfirmed(state);
  await expect.poll(() => localState(page)).toEqual(state);
  await page.reload(); await synced(page);
  await expect(page.getByLabel('메모', { exact: true })).toHaveValue(`CI conflict ${side}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('new remote value invalidates an old selection and redisplays unchecked choices without a write', async ({ page, qa }) => {
  const mark = await makeConflict(page, qa);
  await review(page).getByRole('radio', { name: /이 기기 값 유지/ }).check();
  await remoteMemo(qa, 'CI newest remote');
  await review(page).getByRole('button', { name: '선택한 값으로 동기화', exact: true }).click();
  await expect(review(page)).toContainText('CI newest remote');
  for (const input of await review(page).getByRole('radio').all()) await expect(input).not.toBeChecked();
  await expect(review(page).getByRole('button', { name: '선택한 값으로 동기화', exact: true })).toBeDisabled();
  expect(qa.traffic.entries.slice(mark).filter(isSharedSyncWrite)).toHaveLength(0);
  expect(mealMemo(await localState(page))).toBe('CI conflict local');
  await review(page).getByRole('radio', { name: /서버 값 유지/ }).check();
  await review(page).getByRole('button', { name: '선택한 값으로 동기화', exact: true }).click(); await synced(page);
  expect(mealMemo(await qa.read())).toBe('CI newest remote'); assertOriginalPreserved(await qa.read());
});

test('local edit after choosing clears obsolete choices and keeps the latest input visible', async ({ page, qa }) => {
  const mark = await makeConflict(page, qa);
  await review(page).getByRole('radio', { name: /서버 값 유지/ }).check();
  await saveMeal(page, 'CI newer local while choosing');
  await expect(review(page)).toContainText('CI newer local while choosing');
  for (const input of await review(page).getByRole('radio').all()) await expect(input).not.toBeChecked();
  expect(qa.traffic.entries.slice(mark).filter(isSharedSyncWrite)).toHaveLength(0);
  expect(mealMemo(await localState(page))).toBe('CI newer local while choosing');
  expect(mealMemo(await qa.read())).toBe('CI conflict remote');
});

test('same remote revision with different content loses exact CAS and requires a new choice', async ({ page, qa }) => {
  await makeConflict(page, qa);
  await review(page).getByRole('radio', { name: /이 기기 값 유지/ }).check();
  const hold = qa.traffic.holdNext('POST', 'request');
  await review(page).getByRole('button', { name: '선택한 값으로 동기화', exact: true }).click(); await hold.arrived;
  const expected = await remoteMemo(qa, 'CI same revision newer content', true); hold.release();
  await expect(review(page)).toContainText('CI same revision newer content');
  for (const input of await review(page).getByRole('radio').all()) await expect(input).not.toBeChecked();
  expect(qa.traffic.entries.some(entry => entry.rpc === sharedSyncRpc && entry.cas && entry.status === 200 && entry.matched === false)).toBe(true);
  expect(await qa.read()).toEqual(expected); expect(mealMemo(await localState(page))).toBe('CI conflict local');
});

test('unresolved conflict reload reconstructs original alternatives and sign-out removes the private prompt', async ({ page, qa }) => {
  const mark = await makeConflict(page, qa);
  await review(page).getByRole('radio', { name: /이 기기 값 유지/ }).check();
  await page.reload(); await expect(review(page)).toBeVisible();
  await expect(review(page)).toContainText('CI conflict local'); await expect(review(page)).toContainText('CI conflict remote');
  for (const input of await review(page).getByRole('radio').all()) await expect(input).not.toBeChecked();
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(review(page)).toHaveCount(0); await expect(page.getByLabel('이메일', { exact: true })).toBeVisible();
  expect(qa.traffic.entries.slice(mark).filter(isSharedSyncWrite)).toHaveLength(0);
  expect(mealMemo(await qa.read())).toBe('CI conflict remote'); assertOriginalPreserved(await qa.read());
});

test('lost conflict-resolution response reports unconfirmed saving separately from pending records and recovers read-first', async ({ page, qa }) => {
  const mark = await makeConflict(page, qa);
  await review(page).getByRole('radio', { name: /이 기기 값 유지/ }).check();
  const hold = qa.traffic.holdNext('POST', 'loss');
  await review(page).getByRole('button', { name: '선택한 값으로 동기화', exact: true }).click(); await hold.arrived;
  expect(mealMemo(await qa.read())).toBe('CI conflict local'); hold.release();
  await expect(page.getByRole('list', { name: '동기화 확인 실패 목록' })).toContainText('이미 반영되었을 수 있어');
  await expect(page.getByText(/서버 반영 대기 목록/)).toBeVisible();
  await expect(page.getByText('서버 반영 완료', { exact: true })).toHaveCount(0);
  expect(mealMemo(await localState(page))).toBe('CI conflict local');
  await page.getByRole('button', { name: '다시 시도', exact: true }).click(); await synced(page);
  const writes = qa.traffic.entries.slice(mark).filter(isSharedSyncWrite);
  expect(writes).toHaveLength(1); expect(writes[0]).toMatchObject({ rpc: sharedSyncRpc, matched: true, delivered: false });
  assertOriginalPreserved(await qa.read());
});
