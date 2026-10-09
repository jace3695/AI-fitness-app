import { randomUUID } from 'node:crypto';
import { test, expect, login, synced, original, today } from './fixture';

const daysAgo = (days: number) => { const date = new Date(`${today()}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - days); return date.toISOString().slice(0, 10); };
type Qa = { account: Parameters<typeof login>[1] };
const noOverflow = async (page: Parameters<typeof synced>[0]) => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
async function seed(qa: Qa, easyDays = [1, 2, 3]) {
  const routine = { id: randomUUID(), user_id: qa.account.id, category: 'typing', title: '난이도 합성 타자', target_minutes: 10, preferred_days: [1, 2, 3, 4, 5, 6, 7], target_sessions_per_week: 7, enabled: true, sort_order: 0 };
  expect((await qa.account.client.from('growth_routines').insert(routine)).error).toBeNull();
  const rows = easyDays.map(day => ({ user_id: qa.account.id, routine_id: routine.id, session_date: daysAgo(day), status: 'completed', planned_minutes: 10, actual_minutes: 10, metrics: { routineDifficulty: 'too_easy', original: { keep: true } } }));
  if (rows.length) expect((await qa.account.client.from('growth_sessions').insert(rows)).error).toBeNull();
  return routine;
}
const target = async (qa: Qa, id: string) => (await qa.account.client.from('growth_routines').select('target_minutes').eq('id', id).single()).data?.target_minutes;
const preview = (page: Parameters<typeof synced>[0]) => page.locator('label').filter({ hasText: '난이도 합성 타자 다음 단계 검토' });
async function openReview(page: Parameters<typeof synced>[0], qa: Qa) {
  await login(page, qa.account); await page.goto('/growth/review');
  await page.getByRole('button', { name: '주간 코칭 만들기', exact: true }).click();
  await expect(preview(page)).toContainText('10분 → 15분');
}

test('optional difficulty survives a failed save and reload; unknown history and other owners stay separate', async ({ page, qa }) => {
  const routine = await seed(qa, []);
  const legacy = await qa.account.client.from('growth_sessions').insert([
    { user_id: qa.account.id, routine_id: routine.id, session_date: daysAgo(2), status: 'completed', planned_minutes: 10, actual_minutes: 10, metrics: { original: true } },
    { user_id: qa.account.id, routine_id: routine.id, session_date: daysAgo(3), status: 'completed', planned_minutes: 10, actual_minutes: 10, metrics: { routineDifficulty: 'future-value', original: { keep: true } } },
  ]).select();
  expect(legacy.error).toBeNull();
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, qa.account); await page.goto('/growth');
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: routine.title, exact: true }) });
  await card.getByRole('button', { name: '시작', exact: true }).click();
  const difficulty = page.getByLabel('완료 후 난이도 (선택)', { exact: true });
  await expect(difficulty).toHaveValue('unrecorded');
  await difficulty.selectOption('too_easy');
  let fail = true;
  await page.route('**/rest/v1/growth_sessions*', async route => {
    if (route.request().method() === 'POST' && fail) {
      fail = false;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic save failure' }) });
    } else await route.continue();
  });
  await page.getByRole('button', { name: '완료 저장', exact: true }).click();
  await expect(page.getByText('실행 기록을 저장하지 못했어요. 다시 시도해 주세요.', { exact: true })).toBeVisible();
  await expect(difficulty).toHaveValue('too_easy');
  expect((await qa.account.client.from('growth_sessions').select('id').eq('routine_id', routine.id).eq('session_date', today())).data).toEqual([]);
  await page.getByRole('button', { name: '완료 저장', exact: true }).click();
  const todayRecord = () => qa.account.client.from('growth_sessions').select('metrics').eq('routine_id', routine.id).eq('session_date', today()).single();
  await expect.poll(async () => (await todayRecord()).data?.metrics).toEqual({ routineDifficulty: 'too_easy' });
  await page.getByRole('button', { name: '지난 기록 추가', exact: true }).click();
  const form = page.locator('section').filter({ has: page.getByRole('heading', { name: '날짜를 골라 기록하기', exact: true }) });
  await form.getByRole('combobox').first().selectOption(routine.id);
  await page.getByLabel('기록 날짜', { exact: true }).fill(daysAgo(1));
  await expect(page.getByLabel('지난 기록 완료 후 난이도', { exact: true })).toHaveValue('unrecorded');
  await page.getByLabel('지난 기록 완료 후 난이도', { exact: true }).selectOption('appropriate');
  await form.getByRole('button', { name: '기록 저장', exact: true }).click();
  await expect.poll(async () => (await qa.account.client.from('growth_sessions').select('metrics').eq('routine_id', routine.id).eq('session_date', daysAgo(1)).single()).data?.metrics).toEqual({ routineDifficulty: 'appropriate' });
  await page.reload();
  await expect(page.getByText('난이도: 너무 쉬웠어요', { exact: true })).toBeVisible();
  await expect(page.getByText('난이도: 적당했어요', { exact: true })).toBeVisible();
  await expect(page.getByText('난이도: 미기록', { exact: true })).toHaveCount(2);
  for (const row of legacy.data!) expect((await qa.account.client.from('growth_sessions').select('*').eq('id', row.id).single()).data).toEqual(row);
  expect(await target(qa, routine.id)).toBe(10); await noOverflow(page);
  const other = await qa.createAccount();
  expect((await other.client.from('growth_sessions').select('id').eq('routine_id', routine.id)).data).toEqual([]);
  await page.goto('/diet/settings'); await synced(page);
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByLabel('이메일', { exact: true })).toBeVisible();
  await login(page, other); await page.goto('/growth');
  await expect(page.getByText('난이도: 너무 쉬웠어요', { exact: true })).toHaveCount(0);
  expect(await qa.read()).toEqual(original);
});

test('explicit easy evidence previews dates, supports keeping, and applies once with decision and target readback', async ({ page, qa }) => {
  const routine = await seed(qa, [1, 2]);
  const originalRows = (await qa.account.client.from('growth_sessions').select('*').eq('routine_id', routine.id)).data!;
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, qa.account); await page.goto('/growth');
  await page.getByRole('button', { name: '지난 기록 추가', exact: true }).click();
  const form = page.locator('section').filter({ has: page.getByRole('heading', { name: '날짜를 골라 기록하기', exact: true }) });
  await form.getByRole('combobox').first().selectOption(routine.id);
  await page.getByLabel('지난 기록 완료 후 난이도', { exact: true }).selectOption('too_easy');
  await form.getByRole('button', { name: '기록 저장', exact: true }).click();
  await expect(page.getByText(`${today()} 기록을 저장했어요.`, { exact: true })).toBeVisible();
  await page.goto('/growth/review');
  await page.getByRole('button', { name: '주간 코칭 만들기', exact: true }).click();
  await expect(preview(page)).toContainText('10분 → 15분');
  for (const date of [today(), daysAgo(1), daysAgo(2)]) await expect(preview(page)).toContainText(date);
  expect(await target(qa, routine.id)).toBe(10);
  const apply = page.getByRole('button', { name: '선택한 제안 적용', exact: true });
  await expect(apply).toBeDisabled();
  await preview(page).getByRole('checkbox').check();
  expect(await target(qa, routine.id)).toBe(10);
  await preview(page).getByRole('checkbox').uncheck();
  await expect(apply).toBeDisabled();
  await page.getByRole('button', { name: '현재 루틴 유지', exact: true }).click();
  await expect(page.getByText('현재 루틴 유지 결정을 다시 조회해 확인했어요.', { exact: true })).toBeVisible();
  expect(await target(qa, routine.id)).toBe(10);
  await page.reload();
  await expect(page.getByText('결정 저장됨: 현재 유지', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '새로 분석', exact: true }).click();
  await preview(page).getByRole('checkbox').check();
  await apply.click();
  await expect(page.getByText('선택한 목표와 적용 이력을 다시 조회해 확인했어요.', { exact: true })).toBeVisible();
  expect(await target(qa, routine.id)).toBe(15);
  const reviews = await qa.account.client.from('growth_ai_reviews').select('*').eq('user_id', qa.account.id).order('created_at', { ascending: false });
  expect(reviews.error).toBeNull(); expect(reviews.data).toHaveLength(2);
  expect(reviews.data![0]).toMatchObject({ source: 'local', decision: 'applied', decision_selection: [`local-next-step-${routine.id}`] });
  expect(reviews.data![0].suggestions[0].progression).toMatchObject({ targetMinutes: 10, dates: [daysAgo(2), daysAgo(1), today()] });
  expect(reviews.data![1].decision).toBe('kept');
  for (const row of originalRows) expect((await qa.account.client.from('growth_sessions').select('*').eq('id', row.id).single()).data).toEqual(row);
  await page.reload();
  await expect(preview(page)).toContainText('10분 → 15분');
  await expect(preview(page).getByRole('checkbox')).toBeDisabled();
  await page.getByRole('button', { name: '새로 분석', exact: true }).click();
  await expect(preview(page)).toHaveCount(0);
  expect(await target(qa, routine.id)).toBe(15); await noOverflow(page);
  const other = await qa.createAccount();
  expect((await other.client.from('growth_ai_reviews').select('id').eq('user_id', qa.account.id)).data).toEqual([]);
  expect((await other.client.rpc('decide_growth_review', { p_review_id: reviews.data![0].id, p_selection: [], p_expected_routines: {} })).error).not.toBeNull();
  expect(await target(qa, routine.id)).toBe(15); expect(await qa.read()).toEqual(original);
});

test('changed targets invalidate a saved preview; deleted evidence rejects a still-open selection', async ({ page, qa }) => {
  const routine = await seed(qa);
  await page.setViewportSize({ width: 390, height: 844 });
  await openReview(page, qa);
  await preview(page).getByRole('checkbox').check();
  expect((await qa.account.client.from('growth_sessions').delete().eq('routine_id', routine.id).eq('session_date', daysAgo(3))).error).toBeNull();
  await page.getByRole('button', { name: '선택한 제안 적용', exact: true }).click();
  await expect(page.getByText('제안의 근거나 현재 목표가 달라졌어요. 새로 분석한 뒤 확인해 주세요.', { exact: true })).toBeVisible();
  expect(await target(qa, routine.id)).toBe(10);
  expect((await qa.account.client.from('growth_ai_reviews').select('decision').eq('user_id', qa.account.id).single()).data?.decision).toBeNull();
  expect((await qa.account.client.from('growth_routines').update({ target_minutes: 20, updated_at: new Date().toISOString() }).eq('id', routine.id)).error).toBeNull();
  await page.reload();
  await expect(preview(page)).toContainText('10분 → 15분');
  await expect(preview(page).getByRole('checkbox')).toBeDisabled();
  await expect(page.getByRole('button', { name: '선택한 제안 적용', exact: true })).toBeDisabled();
  expect(await target(qa, routine.id)).toBe(20); await noOverflow(page);
});

test('committed decision with failed readback stays uncertain until reload and cannot increase twice', async ({ page, qa }) => {
  const routine = await seed(qa);
  await openReview(page, qa);
  await preview(page).getByRole('checkbox').check();
  let committed = false;
  await page.route('**/rest/v1/rpc/decide_growth_review', async route => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true); committed = true;
    await route.fulfill({ response });
  });
  await page.route('**/rest/v1/growth_ai_reviews*', async route => {
    if (committed && route.request().method() === 'GET') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic readback failure' }) });
    else await route.continue();
  });
  await page.getByRole('button', { name: '선택한 제안 적용', exact: true }).click();
  await expect(page.getByText('결정 요청 후 저장 결과를 재확인하지 못했어요. 다시 불러와 확인해 주세요.', { exact: true })).toBeVisible();
  await expect(page.getByText('선택한 목표와 적용 이력을 다시 조회해 확인했어요.', { exact: true })).toHaveCount(0);
  expect(await target(qa, routine.id)).toBe(15);
  await page.unroute('**/rest/v1/growth_ai_reviews*');
  await page.unroute('**/rest/v1/rpc/decide_growth_review');
  await page.reload();
  await expect(page.getByText('결정 저장됨: 선택 제안 적용', { exact: true })).toBeVisible();
  await expect(preview(page).getByRole('checkbox')).toBeDisabled();
  expect(await target(qa, routine.id)).toBe(15);
  expect((await qa.account.client.from('growth_ai_reviews').select('id').eq('user_id', qa.account.id)).data).toHaveLength(1);
});
