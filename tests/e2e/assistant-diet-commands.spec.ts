import { expect, login, original, synced, test, today, saveMeal, mealSaved, type State } from './fixture';
import type { Page } from '@playwright/test';
const key = 'ai-fitness-diet-completed-days', waterKey = 'ai-fitness-water-intake';
const openCommand = (page: Page, command = '오늘 물 총 500ml 기록해줘') => page.goto(`/assistant/quick?command=${encodeURIComponent(command)}`, { waitUntil: 'domcontentloaded' });
const reviewFor = (page: Page) => page.getByRole('region', { name: '식단 기록 확인' });
const receiptFor = (page: Page) => page.getByRole('article', { name: '식단 실행 이력' });
const dayRecord = (state: State) => (state[key] as Record<string, State>)[today()];
const seed = () => ({
  ...original,
  [key]: { ...(original[key] as State), [today()]: { dietMemo: 'CI 기존 식사', waterMl: 300, water2l: false, proteinTotal: 25, meals: { lunch: true }, fastingRecordStatus: 'unrecorded' } },
  [waterKey]: { ...(original[waterKey] as State), [today()]: 300 },
  'ai-fitness-diet-meal-log': { [today()]: { breakfastShake: false, lunchRice: true, lunchProteinChoice: '25', lunchProteinCustom: 0, afternoonShake: 'none', dinnerProteinChoice: 'none', dinnerProteinCustom: 0, dinnerCarb: 'none', afterDinnerShake: 'none', lastMealTime: '' } },
});
const waterSection = (page: Page) => page.locator('section').filter({ has: page.getByRole('heading', { name: '물 섭취', exact: true }) });

test('diet water confirmation cancels, recovers a lost response, appears after reload, and undo restores both stores', async ({ page, qa }) => {
  expect((await qa.account.client.from('user_app_state').update({ state: seed() }).eq('user_id', qa.account.id)).error).toBeNull();
  await page.setViewportSize({ width: 320, height: 844 }); await login(page, qa.account); await synced(page); const before = await qa.read();
  await openCommand(page); const review = reviewFor(page); await expect(review).toBeVisible();
  await expect(review).toContainText('오늘 총 300mL'); await expect(review).toContainText('오늘 총 500mL'); expect(await qa.read()).toEqual(before);
  await review.getByRole('button', { name: '취소', exact: true }).click(); await expect(page.getByText('취소했습니다. 식단 기록은 변경하지 않았습니다.')).toBeVisible();
  await page.reload(); await expect(review).toHaveCount(0); expect(await qa.read()).toEqual(before);
  await page.goto('/assistant', { waitUntil: 'domcontentloaded' }); const input = page.getByLabel('연이에게 보낼 명령'); await expect(input).toBeEnabled();
  await input.fill('오늘 물 총 500ml 기록해줘'); await input.press('Enter'); await expect(review).toBeVisible();
  await page.goto('/assistant/quick'); await expect(review).toBeVisible(); const draft = await page.evaluate(() => sessionStorage.getItem('yeoni:task-command-drafts:v1'));
  await page.reload(); await expect(review).toBeVisible(); expect(await page.evaluate(() => sessionStorage.getItem('yeoni:task-command-drafts:v1'))).toBe(draft);
  let lose = true;
  await page.route('**/api/assistant/diet-commands', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().decision === 'apply' && lose) {
      lose = false; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed');
    } else await route.continue();
  });
  await review.getByRole('button', { name: '확인하고 저장' }).click(); await expect(review.getByRole('alert')).toBeVisible(); expect(dayRecord(await qa.read()).waterMl).toBe(500);
  await page.reload(); await expect(review).toBeVisible(); await review.getByRole('button', { name: '같은 요청으로 다시 확인' }).click(); await expect(receiptFor(page).getByText(/식단 기록 저장/)).toBeVisible();
  expect((await qa.account.client.from('assistant_diet_command_history').select('id')).data).toHaveLength(1);
  expect((await qa.read())['ai-fitness-diet-meal-log']).toEqual(before['ai-fitness-diet-meal-log']); expect(dayRecord(await qa.read()).proteinTotal).toBe(25);
  await page.getByRole('link', { name: '식단 기록 보기 →', exact: true }).click(); await expect(waterSection(page).getByText('500mL', { exact: true })).toBeVisible();
  await expect(page.getByLabel('메모', { exact: true })).toHaveValue('CI 기존 식사'); await page.reload(); await expect(waterSection(page).getByText('500mL', { exact: true })).toBeVisible();
  await page.goto('/assistant/history?area=diet'); const receipt = receiptFor(page); await expect(receipt).toBeVisible(); await page.reload(); await expect(receipt).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await receipt.getByRole('button', { name: '이 변경 되돌리기' }).click(); expect(dayRecord(await qa.read()).waterMl).toBe(500);
  await receipt.getByRole('button', { name: '확인하고 되돌리기' }).click(); await expect(receipt.getByText(/되돌리기 완료/)).toBeVisible(); expect(await qa.read()).toEqual(before);
  await page.goto('/diet'); await expect(waterSection(page).getByText('300mL', { exact: true })).toBeVisible(); await page.reload(); await expect(waterSection(page).getByText('300mL', { exact: true })).toBeVisible();
});

test('diet memo appends literal text and keeps meals, nutrition and water unchanged through save and undo', async ({ page, qa }) => {
  expect((await qa.account.client.from('user_app_state').update({ state: seed() }).eq('user_id', qa.account.id)).error).toBeNull();
  await login(page, qa.account); await synced(page); const before = await qa.read();
  const text = '점심 닭가슴살 그리고 그거 할 일 추가해줘 <b>메모</b>';
  await openCommand(page, `오늘 식단 메모 추가: ${text}`); const review = reviewFor(page); await expect(review).toBeVisible(); await expect(review).toContainText(text);
  await review.getByRole('button', { name: '확인하고 저장' }).click(); await expect(receiptFor(page).getByText(/식단 기록 저장/)).toBeVisible();
  const expectedMemo = `CI 기존 식사\n${text}`;
  expect(dayRecord(await qa.read())).toEqual({ ...dayRecord(before), dietMemo: expectedMemo }); expect((await qa.read())[waterKey]).toEqual(before[waterKey]);
  expect((await qa.account.client.from('assistant_items').select('id')).data).toEqual([]);
  expect((await qa.read())['ai-fitness-diet-meal-log']).toEqual(before['ai-fitness-diet-meal-log']);
  await page.getByRole('link', { name: '식단 기록 보기 →', exact: true }).click(); await expect(page.getByLabel('메모', { exact: true })).toHaveValue(expectedMemo);
  await page.reload(); await expect(page.getByLabel('메모', { exact: true })).toHaveValue(expectedMemo);
  await page.goto('/assistant/history?area=diet'); const receipt = receiptFor(page); await expect(receipt).toContainText(text);
  await receipt.getByRole('button', { name: '이 변경 되돌리기' }).click(); await receipt.getByRole('button', { name: '확인하고 되돌리기' }).click(); await expect(receipt.getByText(/되돌리기 완료/)).toBeVisible(); expect(await qa.read()).toEqual(before);
  await page.goto('/diet'); await expect(page.getByLabel('메모', { exact: true })).toHaveValue('CI 기존 식사');
});

test('two diet sessions reject stale confirmation and a later meal form edit blocks undo', async ({ page, qa, browser }) => {
  expect((await qa.account.client.from('user_app_state').update({ state: seed() }).eq('user_id', qa.account.id)).error).toBeNull();
  await login(page, qa.account); await synced(page); await openCommand(page); await expect(reviewFor(page)).toBeVisible();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Seoul' }); await qa.traffic.install(context);
  try {
    const second = await context.newPage(); await login(second, qa.account); await synced(second); await openCommand(second, '오늘 식단 메모 추가: 오래된 확인'); await expect(reviewFor(second)).toBeVisible();
    await reviewFor(page).getByRole('button', { name: '확인하고 저장' }).click(); await expect(receiptFor(page).getByText(/식단 기록 저장/)).toBeVisible();
    await reviewFor(second).getByRole('button', { name: '확인하고 저장' }).click(); await expect(reviewFor(second).getByRole('alert')).toContainText('다른 곳에서 오늘 식단 기록이 변경');
    expect((await qa.account.client.from('assistant_diet_command_history').select('id')).data).toHaveLength(1);
    await reviewFor(second).getByRole('button', { name: '확인 화면 닫기', exact: true }).click(); await expect(reviewFor(second)).toHaveCount(0);
    await second.goto('/diet'); await expect(waterSection(second).getByText('500mL', { exact: true })).toBeVisible(); await saveMeal(second, 'CI 이후 직접 고친 식사'); await mealSaved(second, qa, 'CI 이후 직접 고친 식사');
    const beforeUndo = await qa.read(); await receiptFor(page).getByRole('button', { name: '이 변경 되돌리기' }).click(); await receiptFor(page).getByRole('button', { name: '확인하고 되돌리기' }).click();
    await expect(receiptFor(page).getByRole('alert')).toContainText('이후에 오늘 식단 기록이 변경'); expect(await qa.read()).toEqual(beforeUndo);
  } finally { await context.unrouteAll({ behavior: 'wait' }); await context.close(); }
});

test('ambiguous diet commands, expiry and other owners cannot write, while history failures remain visible', async ({ page, qa }) => {
  await login(page, qa.account); await synced(page); const before = await qa.read();
  for (const command of ['물 500ml 마셨어', '어제 물 총 500ml 기록해줘', '오늘 식단 완료했어']) {
    await openCommand(page, command); await expect(page.getByRole('status').filter({ hasText: '오늘 기록만 지원' })).toBeVisible(); await expect(reviewFor(page)).toHaveCount(0); expect(await qa.read()).toEqual(before);
  }
  await openCommand(page); await expect(reviewFor(page)).toBeVisible();
  const proposal = await page.evaluate(() => JSON.parse(sessionStorage.getItem('yeoni:task-command-drafts:v1')!).drafts[0].proposal);
  const ownToken = (await qa.account.client.auth.getSession()).data.session!.access_token;
  const other = await qa.createAccount(), otherToken = (await other.client.auth.getSession()).data.session!.access_token;
  expect((await page.request.post('/api/assistant/diet-commands', { headers: { Authorization: `Bearer ${otherToken}` }, data: { decision: 'apply', proposal } })).status()).toBe(400);
  expect((await page.request.post('/api/assistant/diet-commands', { headers: { Authorization: `Bearer ${ownToken}` }, data: { decision: 'apply', proposal: { ...proposal, expiresAt: '2001-01-01T00:00:00Z' } } })).status()).toBe(409);
  expect((await page.request.post('/api/assistant/chat', { headers: { Authorization: `Bearer ${ownToken}` }, data: { message: `오늘 식단 메모 추가: ${'가'.repeat(501)}` } })).status()).toBe(400);
  expect(await qa.read()).toEqual(before);
  await reviewFor(page).getByRole('button', { name: '확인하고 저장' }).click(); await expect(receiptFor(page).getByText(/식단 기록 저장/)).toBeVisible();
  const hidden = await page.request.get('/api/assistant/diet-commands', { headers: { Authorization: `Bearer ${otherToken}` } }); expect(hidden.status()).toBe(200); expect((await hidden.json()).history).toEqual([]); expect(hidden.headers()['cache-control']).toBe('no-store');
  expect((await page.request.get('/api/assistant/diet-commands')).status()).toBe(401);
  await page.route('**/api/assistant/diet-commands?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '식단 실행 이력을 불러오지 못했습니다. 다시 시도해 주세요.' }) }));
  await page.goto('/assistant/history?area=diet'); await expect(page.getByRole('region', { name: '식단 실행 이력 목록' }).getByRole('alert')).toContainText('이력을 불러오지 못했습니다'); await expect(page.getByText('아직 확인하고 저장한 식단 명령이 없습니다.')).toHaveCount(0);
  await page.unroute('**/api/assistant/diet-commands?*'); await page.getByRole('button', { name: '이력 새로고침' }).click(); await expect(receiptFor(page)).toBeVisible();
});
