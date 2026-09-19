import { expect, login, original, synced, test, today, type State } from './fixture';
import type { Page } from '@playwright/test';
import { buildCurrentWorkoutSettings } from '../../app/data/currentWorkoutDirection';

const key = 'ai-fitness-workout-completed-days';
const command = '오늘 유산소 실내 걷기 총 20분 기록해줘';
const openCommand = (page: Page, text = command) => page.goto(`/assistant/quick?command=${encodeURIComponent(text)}`, { waitUntil: 'domcontentloaded' });
const reviewFor = (page: Page) => page.getByRole('region', { name: '유산소 기록 확인' });
const receiptFor = (page: Page) => page.getByRole('article', { name: '운동 실행 이력' });
const day = (state: State) => (state[key] as State)[today()] as State;
const seed = () => ({
  ...original,
  [key]: { ...(original[key] as State), [today()]: {
    workoutDone: false, workoutStatus: 'stopped', workoutPain: true, workoutBackStatus: 'pain', workoutMemo: 'CI 기존 운동 메모',
    workoutExerciseRecords: [{ exerciseName: '실제 동작', status: 'partial', sets: [{ setNumber: 1, completed: true, reps: 3 }], painScore: 2 }],
    cardioDone: true, cardioType: '고정식 자전거', cardioMinutes: 15, cardioMemo: 'CI 기존 유산소 메모',
    rosaryCardioMinutes: 7, postWorkoutCardioMinutes: 3, foamRollerMemo: 'keep', pullupDone: true,
  } },
  'ai-fitness-user-workout-settings': { ...buildCurrentWorkoutSettings({ weeklyGroups: {}, weeklyMethods: {}, weeklyEdits: {}, exerciseTargets: {}, dateOverrides: {} }), dateOverrides: { [today()]: { groupId: 'rest' } } },
  'ai-fitness-selected-weekly-workout-plan': 'five-day-fullbody-circuit',
  'ai-fitness-workout-direction-version': 'five-day-circuit-v1',
});
async function openRecords(page: Page) {
  await page.goto('/fitness');
  await page.getByRole('navigation', { name: '운동 주요 메뉴' }).getByRole('button', { name: '기록보기', exact: true }).click();
}
async function undo(receipt: ReturnType<typeof receiptFor>) {
  await receipt.getByRole('button', { name: '이 변경 되돌리기' }).click();
  await receipt.getByRole('button', { name: '확인하고 되돌리기' }).click();
  await expect(receipt).toContainText('되돌리기 완료');
}

test('cardio review cancels, restores a lost reply, appears in the calendar and undoes without touching detailed workouts at 320px', async ({ page, qa }) => {
  expect((await qa.account.client.from('user_app_state').update({ state: seed() }).eq('user_id', qa.account.id)).error).toBeNull();
  await page.setViewportSize({ width: 320, height: 844 }); await login(page, qa.account); await synced(page); const before = await qa.read();
  await openCommand(page); const review = reviewFor(page);
  await expect(review).toContainText('고정식 자전거 · 총 15분'); await expect(review).toContainText('실내 걷기 · 총 20분'); expect(await qa.read()).toEqual(before);
  await review.getByRole('button', { name: '취소', exact: true }).click(); await page.reload(); await expect(review).toHaveCount(0); expect(await qa.read()).toEqual(before);
  await page.goto('/assistant'); const input = page.getByLabel('연이에게 보낼 명령'); await expect(input).toBeEnabled(); await input.fill(command); await input.press('Enter'); await expect(review).toBeVisible();
  await page.goto('/assistant/quick'); await expect(review).toBeVisible();
  const draft = await page.evaluate(() => sessionStorage.getItem('yeoni:task-command-drafts:v1')); await page.reload(); await expect(review).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('yeoni:task-command-drafts:v1'))).toBe(draft);
  let lose = true;
  await page.context().route('**/api/assistant/workout-commands', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().decision === 'apply' && lose) {
      lose = false; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed');
    } else await route.fallback();
  });
  await review.getByRole('button', { name: '확인하고 저장' }).click(); await expect(review.getByRole('alert')).toBeVisible(); expect(day(await qa.read()).cardioMinutes).toBe(20);
  await page.reload(); await expect(review).toBeVisible(); await review.getByRole('button', { name: '같은 요청으로 다시 확인' }).click(); await expect(receiptFor(page)).toContainText('유산소 기록 저장');
  expect((await qa.account.client.from('assistant_workout_command_history').select('id')).data).toHaveLength(1);
  expect(await qa.read()).toEqual({ ...before, [key]: { ...(before[key] as State), [today()]: { ...day(before), cardioDone: true, cardioType: '실내 걷기', cardioMinutes: 20 } } });
  await page.getByRole('link', { name: '운동 기록 보기 →', exact: true }).click();
  await page.getByRole('navigation', { name: '운동 주요 메뉴' }).getByRole('button', { name: '기록보기', exact: true }).click();
  await expect(page.getByText('실내 걷기 20분', { exact: true })).toBeVisible(); await expect(page.getByText('메모: CI 기존 유산소 메모', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByText('실내 걷기 20분', { exact: true })).toBeVisible(); await synced(page);
  await page.goto('/assistant/history?area=workout'); await expect(receiptFor(page)).toContainText('실내 걷기 · 총 20분'); await page.reload(); await expect(receiptFor(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await undo(receiptFor(page)); expect(await qa.read()).toEqual(before);
  await openRecords(page); await expect(page.getByText('고정식 자전거 15분', { exact: true })).toBeVisible(); await synced(page); expect(await qa.read()).toEqual(before);
});

test('workout completion and cardio share history, reject out-of-order undo and restore both in reverse order', async ({ page, qa }) => {
  await login(page, qa.account); await synced(page); const before = await qa.read();
  await openCommand(page, '오늘 운동 완료했어'); const completion = page.getByRole('region', { name: '운동 완료 확인' }); await expect(completion).toBeVisible();
  await completion.getByRole('button', { name: '확인하고 저장' }).click(); await expect(receiptFor(page)).toContainText('운동 완료 저장'); const completed = await qa.read();
  await openCommand(page); await expect(reviewFor(page)).toBeVisible(); await reviewFor(page).getByRole('button', { name: '확인하고 저장' }).click(); await expect(receiptFor(page)).toContainText('유산소 기록 저장');
  await openCommand(page); await expect(page.getByRole('status').filter({ hasText: '이미 같은 값' })).toBeVisible(); await expect(reviewFor(page)).toHaveCount(0);
  expect((await qa.account.client.from('assistant_workout_command_history').select('id')).data).toHaveLength(2);
  await page.goto('/assistant/history?area=workout');
  const general = receiptFor(page).filter({ has: page.getByText(`${today()} · 운동`, { exact: true }) });
  const cardio = receiptFor(page).filter({ has: page.getByText(`${today()} · 유산소`, { exact: true }) });
  await general.getByRole('button', { name: '이 변경 되돌리기' }).click(); await general.getByRole('button', { name: '확인하고 되돌리기' }).click(); await expect(general.getByRole('alert')).toContainText('새 기록을 보호');
  await undo(cardio); expect(await qa.read()).toEqual(completed);
  await page.reload(); await expect(general).toBeVisible(); await undo(general); expect(await qa.read()).toEqual(before);
});

test('two sessions reject stale cardio confirmation and a later calendar edit protects the newer record from undo', async ({ page, qa, browser }) => {
  expect((await qa.account.client.from('user_app_state').update({ state: seed() }).eq('user_id', qa.account.id)).error).toBeNull();
  await login(page, qa.account); await synced(page); await openCommand(page); await expect(reviewFor(page)).toBeVisible();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Seoul' }); await qa.traffic.install(context);
  try {
    const second = await context.newPage(); await login(second, qa.account); await synced(second); await openCommand(second); await expect(reviewFor(second)).toBeVisible();
    await reviewFor(page).getByRole('button', { name: '확인하고 저장' }).click(); await expect(receiptFor(page)).toContainText('유산소 기록 저장');
    const savedHistory = await qa.account.client.from('assistant_workout_command_history').select('record_date').single();
    expect(savedHistory.error).toBeNull(); const recordedDate = savedHistory.data!.record_date;
    await reviewFor(second).getByRole('button', { name: '확인하고 저장' }).click(); await expect(reviewFor(second).getByRole('alert')).toContainText('다른 곳에서 오늘 운동 기록이 변경');
    await reviewFor(second).getByRole('button', { name: '확인 화면 닫기', exact: true }).click();
    await openRecords(second);
    // This flow can cross Korean midnight after the command commits. Select
    // the receipt's date explicitly instead of the calendar's new "today".
    const [year, month, date] = recordedDate.split('-').map(Number);
    await expect(second.getByRole('heading', { name: /^\d{4}년 \d{1,2}월$/ })).toBeVisible();
    const monthHeading = second.getByRole('heading', { name: `${year}년 ${month}월`, exact: true });
    if (!await monthHeading.isVisible()) await second.getByRole('button', { name: '이전', exact: true }).click();
    await expect(monthHeading).toBeVisible();
    await monthHeading.locator('..').locator('..').getByRole('button', { name: new RegExp(`^${date}(?:\\s|$)`) }).click();
    await expect(second.getByRole('heading', { name: `${year}년 ${month}월 ${date}일`, exact: true })).toBeVisible();
    await second.getByRole('button', { name: '유산소 기록 수정', exact: true }).click(); await second.getByLabel('시간(분)', { exact: true }).fill('25');
    await second.getByRole('button', { name: '수정 저장', exact: true }).click();
    await expect.poll(async () => ((await qa.read())[key] as State)[recordedDate] as State).toMatchObject({ cardioMinutes: 25 });
    await synced(second); const modified = await qa.read();
    await receiptFor(page).getByRole('button', { name: '이 변경 되돌리기' }).click(); await receiptFor(page).getByRole('button', { name: '확인하고 되돌리기' }).click();
    await expect(receiptFor(page).getByRole('alert')).toContainText('새 기록을 보호'); expect(await qa.read()).toEqual(modified);
    expect((await qa.account.client.from('assistant_workout_command_history').select('id')).data).toHaveLength(1);
  } finally { await qa.traffic.drain(); await context.unrouteAll({ behavior: 'wait' }); await context.close(); }
});

test('invalid or expired cardio and other owners cannot write; first-record undo removes only its own entry', async ({ page, qa }) => {
  // Start with current plan settings so the first calendar visit does not run
  // the separate one-time workout-direction migration during this undo check.
  const initial = { ...seed(), [key]: original[key] };
  expect((await qa.account.client.from('user_app_state').update({ state: initial }).eq('user_id', qa.account.id)).error).toBeNull();
  await login(page, qa.account); await synced(page); const before = await qa.read();
  await openCommand(page, '오늘 유산소 운동 몇 분 할지 계획 보여줘');
  await expect(page.getByRole('status').filter({ hasText: /계획이며|회복일입니다/ })).toBeVisible();
  await expect(reviewFor(page)).toHaveCount(0); expect(await qa.read()).toEqual(before);
  for (const text of ['어제 유산소 실내 걷기 총 20분 기록해줘', '오늘 유산소 걷기 총 20분 기록해줘', '오늘 유산소 실내 걷기 총 0분 기록해줘', `${command} 그리고 오늘 운동 완료했어`]) {
    await openCommand(page, text); await expect(page.getByRole('status').filter({ hasText: /오늘 기록만 지원|종류와 오늘 총시간|한 번에 하나씩/ })).toBeVisible(); await expect(reviewFor(page)).toHaveCount(0); expect(await qa.read()).toEqual(before);
  }
  await openCommand(page); await expect(reviewFor(page)).toBeVisible();
  const proposal = await page.evaluate(() => JSON.parse(sessionStorage.getItem('yeoni:task-command-drafts:v1')!).drafts[0].proposal);
  const ownToken = (await qa.account.client.auth.getSession()).data.session!.access_token;
  const other = await qa.createAccount(), otherToken = (await other.client.auth.getSession()).data.session!.access_token;
  expect((await page.request.post('/api/assistant/chat', { headers: { Authorization: `Bearer ${ownToken}` }, data: { message: command + ' '.repeat(500) + '기록하지 마' } })).status()).toBe(400);
  expect((await page.request.post('/api/assistant/workout-commands', { headers: { Authorization: `Bearer ${otherToken}` }, data: { decision: 'apply', proposal } })).status()).toBe(400);
  expect((await page.request.post('/api/assistant/workout-commands', { headers: { Authorization: `Bearer ${ownToken}` }, data: { decision: 'apply', proposal: { ...proposal, expiresAt: '2001-01-01T00:00:00Z' } } })).status()).toBe(409);
  expect((await page.request.post('/api/assistant/workout-commands', { headers: { Authorization: `Bearer ${ownToken}` }, data: { decision: 'apply', proposal: { ...proposal, change: { ...proposal.change, minutes: 301 } } } })).status()).toBe(400);
  expect(await qa.read()).toEqual(before);
  await reviewFor(page).getByRole('button', { name: '확인하고 저장' }).click(); await expect(receiptFor(page)).toContainText('유산소 기록 저장');
  expect(day(await qa.read())).toEqual({ cardioDone: true, cardioType: '실내 걷기', cardioMinutes: 20 });
  const hidden = await page.request.get('/api/assistant/workout-commands', { headers: { Authorization: `Bearer ${otherToken}` } }); expect((await hidden.json()).history).toEqual([]);
  expect((await page.request.post('/api/assistant/workout-commands', { headers: { Authorization: `Bearer ${otherToken}` }, data: { decision: 'undo', requestId: proposal.requestId } })).status()).toBe(409);
  await openRecords(page); await expect(page.getByText('실내 걷기 20분', { exact: true })).toBeVisible(); await synced(page);
  await page.goto('/assistant/history?area=workout'); await expect(receiptFor(page)).toBeVisible(); await undo(receiptFor(page)); expect(await qa.read()).toEqual(before);
  await openCommand(page, '오늘 식단 메모 추가: 유산소 20분 기록 확인');
  await expect(page.getByRole('region', { name: '식단 기록 확인' })).toContainText('유산소 20분 기록 확인'); await expect(reviewFor(page)).toHaveCount(0); expect(await qa.read()).toEqual(before);
});
