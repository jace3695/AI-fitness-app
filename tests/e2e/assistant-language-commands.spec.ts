import { expect, login, synced, test, today } from './fixture';
import type { Page } from '@playwright/test';
// Navigation completion is followed by explicit app readiness assertions below.
// Do not wait for WebKit's resource load event; keep all UI and DB assertions.
const openCommand = (page: Page, command = '오늘 단어 학습 완료했어') => page.goto(`/assistant/quick?command=${encodeURIComponent(command)}`, { waitUntil: 'domcontentloaded' });
const reviewFor = (page: Page) => page.getByRole('region', { name: '학습 완료 확인' });

test('language confirmation cancels without writes, recovers after lost response, appears on learning home, and undo restores records', async ({ page, qa }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, qa.account); await synced(page);
  const before = await qa.readLanguage();
  await openCommand(page); const review = reviewFor(page); await expect(review).toBeVisible();
  await expect(review).toContainText(today()); await expect(review).toContainText('단어');
  expect(await qa.readLanguage()).toEqual(before);
  await review.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.getByText('취소했습니다. 학습 기록은 변경하지 않았습니다.')).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' }); await expect(page.getByLabel('실행할 명령')).toBeEnabled(); await expect(review).toHaveCount(0); expect(await qa.readLanguage()).toEqual(before);
  // Readiness is the enabled command input below; a WebKit load event can
  // remain pending after the page itself is ready for interaction.
  await page.goto('/assistant', { waitUntil: 'domcontentloaded' });
  const input = page.getByLabel('연이에게 보낼 명령'); await expect(input).toBeEnabled();
  await input.fill('오늘 단어 학습 완료했어'); await input.press('Enter'); await expect(review).toBeVisible();
  await page.goto('/assistant/quick', { waitUntil: 'domcontentloaded' }); await expect(review).toBeVisible();
  const stored = await page.evaluate(() => sessionStorage.getItem('yeoni:task-command-drafts:v1'));
  await page.reload({ waitUntil: 'domcontentloaded' }); await expect(review).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('yeoni:task-command-drafts:v1'))).toBe(stored);
  let lose = true;
  await page.route('**/api/assistant/language-commands', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().decision === 'apply' && lose) {
      lose = false; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed');
    } else await route.continue();
  });
  await review.getByRole('button', { name: '확인하고 저장' }).click(); await expect(review.getByRole('alert')).toBeVisible();
  expect(JSON.parse((await qa.readLanguage()).dailyRoutineProgress as string).completedIds).toEqual(['words']);
  await page.reload({ waitUntil: 'domcontentloaded' }); await expect(review).toBeVisible();
  await review.getByRole('button', { name: '같은 요청으로 다시 확인' }).click(); await expect(page.getByText(/학습 완료 저장/)).toBeVisible();
  expect((await qa.account.client.from('assistant_language_command_history').select('id')).data).toHaveLength(1);
  await page.getByRole('link', { name: '오늘 학습 현황 보기 →', exact: true }).click();
  await expect(page).toHaveURL(/\/language$/);
  await page.locator('.routine-details > summary').click();
  const wordRow = page.locator('.routine-row').filter({ has: page.getByRole('heading', { name: '단어 퀴즈 풀기 5문제', exact: true }) });
  await expect(wordRow.getByRole('button', { name: '완료 취소', exact: true })).toBeVisible();
  await expect(page.getByText('학습 기록 · 서버 저장 확인', { exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('.routine-details > summary').click();
  await expect(wordRow.getByRole('button', { name: '완료 취소', exact: true })).toBeVisible();
  await page.goto('/assistant/history?area=language', { waitUntil: 'domcontentloaded' });
  const receipt = page.getByRole('article', { name: '단어 학습 실행 이력' }); await expect(receipt).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' }); await expect(receipt).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await receipt.getByRole('button', { name: '이 변경 되돌리기' }).click();
  expect(JSON.parse((await qa.readLanguage()).dailyRoutineProgress as string).completedIds).toEqual(['words']);
  await receipt.getByRole('button', { name: '확인하고 되돌리기' }).click(); await expect(receipt.getByText(/되돌리기 완료/)).toBeVisible();
  const after = await qa.readLanguage();
  expect(after.dailyRoutineProgress).toBe(before.dailyRoutineProgress); expect(after.dailyLearningHistory).toBe(before.dailyLearningHistory);
  expect(after.learningSettings).toBe(before.learningSettings);
  await page.reload({ waitUntil: 'domcontentloaded' }); await expect(receipt.getByText(/되돌리기 완료/)).toBeVisible();
  await page.goto('/language', { waitUntil: 'domcontentloaded' }); await page.locator('.routine-details > summary').click();
  await expect(wordRow.getByRole('button', { name: '직접 완료', exact: true })).toBeVisible();
});

test('independent sessions cannot confirm stale learning, and a subsequent lesson prevents unsafe undo', async ({ page, qa, browser }) => {
  await login(page, qa.account); await synced(page); await openCommand(page); await expect(reviewFor(page)).toBeVisible();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); await qa.traffic.install(context);
  try {
    const second = await context.newPage(); await login(second, qa.account); await synced(second);
    await openCommand(second, '오늘 문법 학습 완료했어'); await expect(reviewFor(second)).toBeVisible();
    await reviewFor(page).getByRole('button', { name: '확인하고 저장' }).click(); await expect(page.getByText(/학습 완료 저장/)).toBeVisible();
    await reviewFor(second).getByRole('button', { name: '확인하고 저장' }).click();
    await expect(reviewFor(second).getByRole('alert')).toContainText('다른 곳에서 학습 기록이 변경');
    expect((await qa.account.client.from('assistant_language_command_history').select('id')).data).toHaveLength(1);
    await second.goto('/language', { waitUntil: 'domcontentloaded' }); await second.locator('.routine-details > summary').click();
    await second.getByRole('button', { name: '직접 완료', exact: true }).first().click();
    await expect.poll(async () => JSON.parse((await qa.readLanguage()).dailyRoutineProgress as string).completedIds).toEqual(['words', 'kana']);
    await expect(second.getByText('학습 기록 · 서버 저장 확인', { exact: true })).toBeVisible();
    const beforeUndo = await qa.readLanguage();
    await page.getByRole('button', { name: '이 변경 되돌리기' }).click(); await page.getByRole('button', { name: '확인하고 되돌리기' }).click();
    await expect(page.getByRole('article').getByRole('alert')).toContainText('이후에 학습 기록이 변경'); expect(await qa.readLanguage()).toEqual(beforeUndo);
  } finally { await context.unrouteAll({ behavior: 'wait' }); await context.close(); }
});

test('ambiguous language commands stay unchanged, expiry and owner checks hold, and history failures are visible', async ({ page, qa }) => {
  await login(page, qa.account); await synced(page); const before = await qa.readLanguage();
  for (const command of ['어제 단어 학습 완료했어', '단어와 문법 완료했어', '단어 아직 완료 안했어']) {
    await openCommand(page, command); await expect(page.getByRole('status').filter({ hasText: /오늘 학습만|한 가지만/ })).toBeVisible();
    await expect(reviewFor(page)).toHaveCount(0); expect(await qa.readLanguage()).toEqual(before);
  }
  await openCommand(page); await expect(reviewFor(page)).toBeVisible();
  const proposal = await page.evaluate(() => JSON.parse(sessionStorage.getItem('yeoni:task-command-drafts:v1')!).drafts[0].proposal);
  const ownToken = (await qa.account.client.auth.getSession()).data.session!.access_token;
  const other = await qa.createAccount(), otherToken = (await other.client.auth.getSession()).data.session!.access_token;
  const foreign = await page.request.post('/api/assistant/language-commands', { headers: { Authorization: `Bearer ${otherToken}` }, data: { decision: 'apply', proposal } }); expect(foreign.status()).toBe(400);
  const expired = await page.request.post('/api/assistant/language-commands', { headers: { Authorization: `Bearer ${ownToken}` }, data: { decision: 'apply', proposal: { ...proposal, expiresAt: '2001-01-01T00:00:00Z' } } }); expect(expired.status()).toBe(409);
  expect(await qa.readLanguage()).toEqual(before);
  await reviewFor(page).getByRole('button', { name: '확인하고 저장' }).click(); await expect(page.getByText(/학습 완료 저장/)).toBeVisible();
  const hidden = await page.request.get('/api/assistant/language-commands', { headers: { Authorization: `Bearer ${otherToken}` } }); expect(hidden.status()).toBe(200); expect((await hidden.json()).history).toEqual([]); expect(hidden.headers()['cache-control']).toBe('no-store');
  expect((await page.request.get('/api/assistant/language-commands')).status()).toBe(401);
  await page.route('**/api/assistant/language-commands?*', route => route.fulfill({ status: 503, json: { error: '합성 학습 이력 조회 실패' } }));
  await page.goto('/assistant/history?area=language', { waitUntil: 'domcontentloaded' }); await expect(page.getByRole('main').getByRole('alert')).toContainText('합성 학습 이력 조회 실패');
  await expect(page.getByText('아직 확인하고 저장한 학습 명령이 없습니다.')).toHaveCount(0);
  await page.unroute('**/api/assistant/language-commands?*'); await page.getByRole('button', { name: '이력 새로고침' }).click();
  await expect(page.getByRole('article', { name: '단어 학습 실행 이력' })).toBeVisible();
});
