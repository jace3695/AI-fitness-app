import { randomUUID } from 'node:crypto';
import { CURRICULUM } from '../../data/curriculum';
import { test, expect, login, synced, original, originalLanguage, assertOriginalPreserved, today } from './fixture';

const daysAgo = (days: number) => { const date = new Date(`${today()}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - days); return date.toISOString().slice(0, 10); };
const noOverflow = async (page: Parameters<typeof synced>[0]) => { await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); };

test('free mode keeps paid routes blocked and provides a clearly labelled conversation exercise', async ({ page, qa }) => {
  for (const endpoint of ['/api/tts', '/api/language/tts', '/api/claude']) {
    const anonymous = await page.request.post(endpoint, { data: { text: '합성 검증' } });
    expect(anonymous.status()).toBe(401);
    const { data } = await qa.account.client.auth.getSession();
    const response = await page.request.post(endpoint, { headers: { Authorization: `Bearer ${data.session!.access_token}` }, data: { text: '合成テスト', messages: [] } });
    expect(response.status()).toBe(503); expect((await response.json()).code).toBe('PAID_AI_DISABLED');
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, qa.account);
  await page.goto('/language/conversation');
  await expect(page.getByRole('heading', { name: '상황별 회화 연습', exact: true })).toBeVisible();
  await page.getByLabel('상황', { exact: true }).selectOption('카페');
  await page.getByRole('button', { name: '예문으로 연습하기', exact: true }).click();
  await page.getByRole('button', { name: '전송', exact: true }).click();
  await expect(page.getByText('ホットとアイス、どちらになさいますか？', { exact: true })).toBeVisible();
  await expect(page.getByText(/연습 문장과 일치해요/)).toBeVisible();
  await noOverflow(page);
  expect(await qa.read()).toEqual(original);
});

test('meal reuse previews before applying, preserves other inputs, and saves weekly context to the actual DB', async ({ page, qa }) => {
  const previousDate = daysAgo(1);
  const previous = { breakfastShake: false, lunchRice: true, lunchProteinChoice: 'custom', lunchProteinCustom: 32, afternoonShake: 'none', dinnerProteinChoice: 'none', dinnerProteinCustom: 0, dinnerCarb: 'none', afterDinnerShake: 'none', lastMealTime: '23:10' };
  const seeded = { ...original, 'ai-fitness-diet-meal-log': { [previousDate]: previous }, 'ai-fitness-lunch-carb-choice': { [previousDate]: { amountType: 'custom', grams: 130, riceType: '현미밥', customRiceType: '', estimatedCarbs: 39 } } };
  const seed = await qa.account.client.from('user_app_state').update({ state: seeded }).eq('user_id', qa.account.id);
  expect(seed.error).toBeNull();
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, qa.account); await synced(page); await page.goto('/diet');
  await page.getByLabel('메모', { exact: true }).fill('무료 개선 합성 식단 메모');
  await page.getByRole('button', { name: '+300mL', exact: true }).click();
  await page.getByLabel('마지막 음식·프로틴 섭취시간', { exact: true }).fill('20:15');
  await page.getByLabel('소화 상태', { exact: true }).selectOption('bloated');
  await page.getByLabel('야식을 먹었나요?', { exact: true }).selectOption('yes');
  await page.getByLabel('운동 후 식사를 했나요?', { exact: true }).selectOption('no');
  await page.getByRole('button', { name: '지난 점심 불러오기', exact: true }).click();
  const preview = page.getByRole('region', { name: '불러올 식사 확인', exact: true });
  await expect(preview).toContainText('32g · 밥 130g');
  await preview.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.getByLabel('점심 식품 단백질 직접 입력', { exact: true })).toHaveCount(0);
  expect(await qa.read()).toEqual(seeded);
  await page.getByRole('button', { name: '지난 점심 불러오기', exact: true }).click();
  await preview.getByRole('button', { name: '식사 입력칸에 적용', exact: true }).click();
  await expect(page.getByLabel('점심 식품 단백질 직접 입력', { exact: true })).toHaveValue('32');
  await expect(page.getByLabel('점심 밥량', { exact: true })).toHaveValue('130');
  await expect(page.getByLabel('마지막 음식·프로틴 섭취시간', { exact: true })).toHaveValue('20:15');
  await page.getByRole('button', { name: '오늘 식단 저장', exact: true }).click();
  await expect.poll(async () => (await qa.read())['ai-fitness-diet-completed-days']).toMatchObject({ [today()]: { dietMemo: '무료 개선 합성 식단 메모', waterMl: 300, proteinTotal: 32, digestionStatus: 'bloated', lateSnack: 'yes', afterWorkoutMeal: 'no' } });
  await synced(page); const saved = await qa.read(); assertOriginalPreserved(saved);
  expect((saved['ai-fitness-diet-meal-log'] as Record<string, unknown>)[previousDate]).toEqual(previous);
  await page.reload(); await synced(page);
  await expect(page.getByLabel('소화 상태', { exact: true })).toHaveValue('bloated');
  await expect(page.getByLabel('야식을 먹었나요?', { exact: true })).toHaveValue('yes');
  await expect(page.getByLabel('메모', { exact: true })).toHaveValue('무료 개선 합성 식단 메모');
  await expect(page.getByRole('region', { name: '최근 7일 식단 요약' })).toContainText('소화 불편 1일 / 상태 응답 1일');
  await noOverflow(page);
});

test('growth shows three priorities, saves a stop reason, and creates a free review without changing targets', async ({ page, qa }) => {
  const routines = Array.from({ length: 4 }, (_, index) => ({ id: randomUUID(), user_id: qa.account.id, category: 'custom', title: `무료 합성 루틴 ${index + 1}`, target_minutes: 30, preferred_days: [1, 2, 3, 4, 5, 6, 7], target_sessions_per_week: 7, enabled: true, sort_order: index }));
  expect((await qa.account.client.from('growth_routines').insert(routines)).error).toBeNull();
  expect((await qa.account.client.from('growth_sessions').insert([1, 2].map(days => ({ user_id: qa.account.id, routine_id: routines[0].id, session_date: daysAgo(days), status: 'stopped', planned_minutes: 30, actual_minutes: 4, metrics: { stopReason: 'tired' } })))).error).toBeNull();
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, qa.account); await page.goto('/growth');
  await expect(page.getByRole('button', { name: `${routines[0].title} 빠른 완료`, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `${routines[3].title} 빠른 완료`, exact: true })).not.toBeVisible();
  await page.locator('article').filter({ has: page.getByRole('heading', { name: routines[0].title, exact: true }) }).getByRole('button', { name: '시작', exact: true }).click();
  await page.getByLabel('중단·미완료 이유 (선택)', { exact: true }).selectOption('tired');
  await page.getByRole('button', { name: '중단 저장', exact: true }).click();
  await expect.poll(async () => (await qa.account.client.from('growth_sessions').select('metrics').eq('routine_id', routines[0].id).eq('session_date', today()).single()).data?.metrics).toEqual({ stopReason: 'tired' });
  await page.reload(); await expect(page.getByRole('button', { name: `${routines[0].title} 빠른 완료`, exact: true })).toBeVisible(); await noOverflow(page);
  await page.goto('/growth/review');
  await page.getByRole('button', { name: '주간 코칭 만들기', exact: true }).click();
  await expect(page.getByText(/서로 다른 3일에 미완료 기록/)).toBeVisible();
  const review = await qa.account.client.from('growth_ai_reviews').select('source,suggestions').eq('user_id', qa.account.id).single();
  expect(review.error).toBeNull(); expect(review.data?.source).toBe('local');
  expect(review.data?.suggestions[0]).toMatchObject({ routineId: routines[0].id, recommendedMinutes: 20 });
  expect((await qa.account.client.from('growth_routines').select('target_minutes').eq('id', routines[0].id).single()).data?.target_minutes).toBe(30);
  await page.reload(); await expect(page.getByText(/서로 다른 3일에 미완료 기록/)).toBeVisible(); await noOverflow(page);
  const other = await qa.createAccount();
  expect((await other.client.from('growth_ai_reviews').select('id').eq('user_id', qa.account.id)).data).toEqual([]);
});

test('review records response time and hint use in the actual DB without treating help as mastery', async ({ page, qa }) => {
  const lesson = CURRICULUM[0]; const index = 2;
  const item = { id: `${lesson.id}:${index}`, lessonId: lesson.id, lessonTitle: lesson.title, prompt: lesson.quiz[index].prompt, explanation: lesson.quiz[index].explanation, createdAt: '2001-01-01T00:00:00Z', nextReviewAt: '2001-01-02T00:00:00Z', intervalDays: 7, successStreak: 2, reviewCount: 2, lastModality: 'meaning' };
  expect((await qa.account.client.from('language_user_state').update({ state: { ...originalLanguage, japaneseCurriculumReviewV1: JSON.stringify([item]) } }).eq('user_id', qa.account.id)).error).toBeNull();
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, qa.account, '/language/settings');
  await expect(page.getByText('학습 기록 · 서버 저장 확인', { exact: true })).toBeVisible();
  await page.goto('/language/review');
  await page.getByRole('button', { name: '힌트 볼래요', exact: true }).click();
  await page.getByRole('button', { name: lesson.quiz[index].choices[lesson.quiz[index].answer], exact: true }).click();
  await page.getByRole('button', { name: '복습 결과 저장 · 다음 문제', exact: true }).click();
  const readItem = async () => JSON.parse((await qa.readLanguage()).japaneseCurriculumReviewV1 as string)[0];
  await expect.poll(async () => (await readItem()).lastNeededHelp).toBe(true);
  const saved = await readItem();
  expect(saved).toMatchObject({ intervalDays: 1, successStreak: 0, reviewCount: 3, lastModality: 'meaning' });
  expect(saved.lastResponseMs).toBeGreaterThanOrEqual(0);
  await expect(page.getByText('학습 기록 · 서버 저장 확인', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(/오늘 예정된 과정 복습을 모두 마쳤어요/)).toBeVisible();
  await expect(page.getByRole('region', { name: '복습 숙련도' })).toContainText('안정 0 / 측정 1문제');
  await noOverflow(page);
});
