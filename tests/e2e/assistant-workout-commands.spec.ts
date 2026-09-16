import { expect, login, original, synced, test, today, type State } from './fixture';
import type { Page } from '@playwright/test';
import { buildCurrentWorkoutSettings } from '../../app/data/currentWorkoutDirection';
const key = 'ai-fitness-workout-completed-days';
const openCommand = (page: Page, command = '오늘 운동 완료했어') => page.goto(`/assistant/quick?command=${encodeURIComponent(command)}`);
const reviewFor = (page: Page) => page.getByRole('region', { name: '운동 완료 확인' });
const dayRecord = (state: State) => (state[key] as Record<string, State>)[today()];
const seed = () => ({
  ...original,
  [key]: { ...(original[key] as State), [today()]: { cardioDone: true, cardioMinutes: 20, foamRollerMemo: 'CI keep' } },
  'ai-fitness-user-workout-settings': { ...buildCurrentWorkoutSettings({ weeklyGroups: {}, weeklyMethods: {}, weeklyEdits: {}, exerciseTargets: {}, dateOverrides: {} }), dateOverrides: { [today()]: { groupId: 'rest' } } },
  'ai-fitness-selected-weekly-workout-plan': 'five-day-fullbody-circuit',
  'ai-fitness-workout-direction-version': 'five-day-circuit-v1',
});
async function openRecords(page: Page) {
  await page.goto('/fitness');
  await page.getByRole('navigation', { name: '운동 주요 메뉴' }).getByRole('button', { name: '기록보기', exact: true }).click();
}

test('workout confirmation cancels, recovers a lost response, appears in the calendar, and undo preserves cardio and original records', async ({ page, qa }) => {
  const initial = seed(); expect((await qa.account.client.from('user_app_state').update({ state: initial }).eq('user_id', qa.account.id)).error).toBeNull();
  await page.setViewportSize({ width: 320, height: 844 }); await login(page, qa.account); await synced(page);
  const before = await qa.read(); await openCommand(page); const review = reviewFor(page); await expect(review).toBeVisible();
  await expect(review).toContainText(today()); await expect(review).toContainText('운동 종류·세트·횟수·통증'); expect((await qa.read())[key]).toEqual(before[key]);
  await review.getByRole('button', { name: '취소', exact: true }).click(); await expect(page.getByText('취소했습니다. 운동 기록은 변경하지 않았습니다.')).toBeVisible();
  await page.reload(); await expect(review).toHaveCount(0); expect((await qa.read())[key]).toEqual(before[key]);
  await page.goto('/assistant'); const input = page.getByLabel('연이에게 보낼 명령'); await expect(input).toBeEnabled();
  await input.fill('오늘 운동 완료했어'); await input.press('Enter'); await expect(review).toBeVisible();
  await page.goto('/assistant/quick'); await expect(review).toBeVisible();
  const draft = await page.evaluate(() => sessionStorage.getItem('yeoni:task-command-drafts:v1'));
  await page.reload(); await expect(review).toBeVisible(); expect(await page.evaluate(() => sessionStorage.getItem('yeoni:task-command-drafts:v1'))).toBe(draft);
  let lose = true;
  await page.route('**/api/assistant/workout-commands', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().decision === 'apply' && lose) {
      lose = false; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed');
    } else await route.continue();
  });
  await review.getByRole('button', { name: '확인하고 저장' }).click(); await expect(review.getByRole('alert')).toBeVisible();
  expect(dayRecord(await qa.read()).workoutStatus).toBe('completed');
  await page.reload(); await expect(review).toBeVisible(); await review.getByRole('button', { name: '같은 요청으로 다시 확인' }).click(); await expect(page.getByText(/운동 완료 저장/)).toBeVisible();
  expect((await qa.account.client.from('assistant_workout_command_history').select('id')).data).toHaveLength(1);
  const saved = await qa.read(); expect(dayRecord(saved)).toMatchObject(dayRecord(initial));
  expect(dayRecord(saved).workoutExerciseRecords).toBeUndefined(); expect(dayRecord(saved).workoutPain).toBeUndefined();
  expect(saved['ai-fitness-user-workout-settings']).toEqual(before['ai-fitness-user-workout-settings']);
  await page.getByRole('link', { name: '운동 기록 보기 →', exact: true }).click();
  await page.getByRole('navigation', { name: '운동 주요 메뉴' }).getByRole('button', { name: '기록보기', exact: true }).click();
  await expect(page.getByText('직접 완료 기록', { exact: true })).toBeVisible();
  await expect(page.getByText('운동 후 허리: 미기록', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByText('직접 완료 기록', { exact: true })).toBeVisible(); await synced(page);
  await page.goto('/assistant/history?area=workout'); const receipt = page.getByRole('article', { name: '운동 실행 이력' }); await expect(receipt).toBeVisible();
  await page.reload(); await expect(receipt).toBeVisible(); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await receipt.getByRole('button', { name: '이 변경 되돌리기' }).click(); expect(dayRecord(await qa.read()).workoutStatus).toBe('completed');
  await receipt.getByRole('button', { name: '확인하고 되돌리기' }).click(); await expect(receipt.getByText(/되돌리기 완료/)).toBeVisible();
  expect((await qa.read())[key]).toEqual(before[key]); expect((await qa.read())['ai-fitness-user-workout-settings']).toEqual(before['ai-fitness-user-workout-settings']);
  await page.reload(); await expect(receipt.getByText(/되돌리기 완료/)).toBeVisible();
  await openRecords(page); await expect(page.getByText('직접 완료 기록', { exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: '운동 기록 시작하기', exact: true })).toBeVisible();
});

test('two real workout sessions reject stale confirmation and a later calendar edit blocks undo', async ({ page, qa, browser }) => {
  expect((await qa.account.client.from('user_app_state').update({ state: seed() }).eq('user_id', qa.account.id)).error).toBeNull();
  await login(page, qa.account); await synced(page); await openCommand(page); await expect(reviewFor(page)).toBeVisible();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Seoul' }); await qa.traffic.install(context);
  try {
    const second = await context.newPage(); await login(second, qa.account); await synced(second); await openCommand(second); await expect(reviewFor(second)).toBeVisible();
    await reviewFor(page).getByRole('button', { name: '확인하고 저장' }).click(); await expect(page.getByText(/운동 완료 저장/)).toBeVisible();
    await reviewFor(second).getByRole('button', { name: '확인하고 저장' }).click(); await expect(reviewFor(second).getByRole('alert')).toContainText('다른 곳에서 오늘 운동 기록이 변경');
    expect((await qa.account.client.from('assistant_workout_command_history').select('id')).data).toHaveLength(1);
    await reviewFor(second).getByRole('button', { name: '확인 화면 닫기', exact: true }).click(); await expect(reviewFor(second)).toHaveCount(0);
    await openRecords(second); await second.getByRole('button', { name: '이 운동 기록 수정하기', exact: true }).click();
    await second.getByRole('button', { name: '일부 완료', exact: true }).click(); await second.getByRole('button', { name: '바뀐 기록 저장', exact: true }).click();
    await expect.poll(async () => dayRecord(await qa.read()).workoutStatus).toBe('partial'); await synced(second);
    const beforeUndo = (await qa.read())[key];
    await page.getByRole('button', { name: '이 변경 되돌리기' }).click(); await page.getByRole('button', { name: '확인하고 되돌리기' }).click();
    await expect(page.getByRole('article').getByRole('alert')).toContainText('이후에 오늘 운동 기록이 변경'); expect((await qa.read())[key]).toEqual(beforeUndo);
    await openCommand(second); await expect(second.getByRole('status').filter({ hasText: '상세 기록이 있습니다' })).toBeVisible(); await expect(reviewFor(second)).toHaveCount(0);
  } finally { await context.unrouteAll({ behavior: 'wait' }); await context.close(); }
});

test('ambiguous workout commands, expiry and another owner cannot write; history failures stay visible', async ({ page, qa }) => {
  await login(page, qa.account); await synced(page); const before = (await qa.read())[key];
  for (const command of ['어제 운동 완료했어','운동 일부 완료','오늘 운동 완료 안했어']) {
    await openCommand(page, command); await expect(page.getByRole('status').filter({ hasText: /오늘 운동만|명령만 지원/ })).toBeVisible(); await expect(reviewFor(page)).toHaveCount(0); expect((await qa.read())[key]).toEqual(before);
  }
  await openCommand(page); await expect(reviewFor(page)).toBeVisible();
  const proposal = await page.evaluate(() => JSON.parse(sessionStorage.getItem('yeoni:task-command-drafts:v1')!).drafts[0].proposal);
  const ownToken = (await qa.account.client.auth.getSession()).data.session!.access_token;
  const other = await qa.createAccount(), otherToken = (await other.client.auth.getSession()).data.session!.access_token;
  expect((await page.request.post('/api/assistant/workout-commands', { headers: { Authorization: `Bearer ${otherToken}` }, data: { decision: 'apply', proposal } })).status()).toBe(400);
  expect((await page.request.post('/api/assistant/workout-commands', { headers: { Authorization: `Bearer ${ownToken}` }, data: { decision: 'apply', proposal: { ...proposal, expiresAt: '2001-01-01T00:00:00Z' } } })).status()).toBe(409);
  expect((await qa.read())[key]).toEqual(before);
  await reviewFor(page).getByRole('button', { name: '확인하고 저장' }).click(); await expect(page.getByText(/운동 완료 저장/)).toBeVisible();
  const hidden = await page.request.get('/api/assistant/workout-commands', { headers: { Authorization: `Bearer ${otherToken}` } }); expect(hidden.status()).toBe(200); expect((await hidden.json()).history).toEqual([]); expect(hidden.headers()['cache-control']).toBe('no-store');
  expect((await page.request.get('/api/assistant/workout-commands')).status()).toBe(401);
  await page.route('**/api/assistant/workout-commands?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '운동 실행 이력을 불러오지 못했습니다. 다시 시도해 주세요.' }) }));
  await page.goto('/assistant/history?area=workout'); await expect(page.getByRole('region', { name: '운동 실행 이력 목록' }).getByRole('alert')).toContainText('이력을 불러오지 못했습니다'); await expect(page.getByText('아직 확인하고 저장한 운동 명령이 없습니다.')).toHaveCount(0);
  await page.unroute('**/api/assistant/workout-commands?*'); await page.getByRole('button', { name: '이력 새로고침' }).click(); await expect(page.getByRole('article', { name: '운동 실행 이력' })).toBeVisible();
});
