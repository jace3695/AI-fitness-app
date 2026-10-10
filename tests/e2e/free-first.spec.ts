import { randomUUID } from 'node:crypto';
import { CURRICULUM } from '../../data/curriculum';
import { GUIDED_CONVERSATION_PILOT } from '../../data/guidedConversationPilot';
import { logGuidedBoundary } from './guided-conversation-diagnostics';
import { test, expect, login, synced, original, originalLanguage, assertOriginalPreserved, localState, today } from './fixture';

const daysAgo = (days: number) => { const date = new Date(`${today()}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - days); return date.toISOString().slice(0, 10); };
const noOverflow = async (page: Parameters<typeof synced>[0]) => { await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); };

test('free mode keeps paid routes blocked and handles sample and arbitrary conversation input without a POST', async ({ page, qa }) => {
  let conversationPosts = 0;
  await page.route(/\/api\/language\/conversation(?:\?.*)?$/, async route => {
    if (route.request().method() === 'POST') {
      conversationPosts++;
      await route.abort();
      return;
    }
    await route.continue();
  });
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
  await expect(page.getByRole('region', { name: '이 브라우저의 대화 저장 안내', exact: true })).toBeVisible();
  const start = page.getByRole('button', { name: '새 대화 시작', exact: true });
  await expect(start).toBeDisabled();
  await expect(page.getByLabel('일본어 문장', { exact: true })).toHaveCount(0);
  await page.getByLabel('기존 예문 · 수준 미지정', { exact: true }).selectOption('legacy-cafe');
  await expect(page.getByLabel('기존 예문 · 수준 미지정', { exact: true })).toHaveValue('legacy-cafe');
  await page.getByRole('checkbox', { name: '위 보관 안내를 확인했어요.', exact: true }).check();
  await start.click();
  await expect(page.getByRole('heading', { name: '카페 · 진행 중', exact: true })).toBeVisible();
  const saveStatus = page.locator('[data-save-status]');
  const input = page.getByLabel('일본어 문장', { exact: true });
  await page.getByRole('button', { name: '예문으로 연습하기', exact: true }).click();
  await expect(input).toHaveValue('コーヒーを一つください。');
  await expect(saveStatus).toHaveAttribute('data-save-status', 'saved');
  await page.getByRole('button', { name: '전송', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('heading', { name: '보낸 문장 1개', exact: true })).toBeVisible();
  await expect(page.getByText('ホットとアイス、どちらになさいますか？', { exact: true })).toBeVisible();
  await expect(page.getByText(/연습 문장과 일치해요/)).toBeVisible();
  expect(conversationPosts).toBe(0);
  const alternative = '합성 자유 입력: 예문과 다른 응답';
  await input.fill(alternative);
  await expect(input).toHaveValue(alternative);
  await page.getByRole('button', { name: '입력 저장', exact: true }).click();
  await expect(saveStatus).toHaveAttribute('data-save-status', 'saved');
  await page.getByRole('button', { name: '전송', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('heading', { name: '보낸 문장 2개', exact: true })).toBeVisible();
  await expect(page.getByText(alternative, { exact: true })).toBeVisible();
  await expect(page.getByText(/자유 문장의 자동 교정은 보류 중이에요/)).toBeVisible();
  await expect(page.getByText('고정 연습 예문 · 평가하지 않음', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: '🔊 교정 듣기', exact: true })).toHaveCount(0);
  expect(conversationPosts).toBe(0);
  await noOverflow(page);
  const unsent = '  合成の下書き 🌱  ';
  await input.fill(unsent);
  await expect(input).toHaveValue(unsent);
  await page.getByRole('button', { name: '입력 저장', exact: true }).click();
  await expect(saveStatus).toHaveAttribute('data-save-status', 'saved');
  await page.reload();
  await expect(page.getByRole('heading', { name: '카페 · 진행 중', exact: true })).toBeVisible();
  await expect(input).toHaveValue(unsent);
  await expect(page.getByRole('heading', { name: '보낸 문장 2개', exact: true })).toBeVisible();
  await expect(page.getByText(alternative, { exact: true })).toBeVisible();
  await expect(saveStatus).toHaveAttribute('data-save-status', 'saved');
  await page.getByRole('button', { name: '기록 보기', exact: true }).click();
  const history = page.getByRole('region', { name: '이 브라우저의 대화 기록', exact: true });
  await expect(history).toContainText('보낸 문장 2개 · 보내지 않은 초안 1개');
  await history.getByRole('button', { name: /^카페 .*대화 이어가기$/ }).click();
  await expect(input).toHaveValue(unsent);
  await expect(page.getByText('고정 연습 예문 · 평가하지 않음', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: '🔊 교정 듣기', exact: true })).toHaveCount(0);
  expect(conversationPosts).toBe(0);
  await noOverflow(page);
  expect(await qa.read()).toEqual(original);
  expect(await qa.readLanguage()).toEqual(originalLanguage);
});

// Authored discovery only until the separately authorized real-browser gate.
// No guided provider/audio action is used, and any attempted request is aborted.
for (const script of GUIDED_CONVERSATION_PILOT) test(`guided ${script.levelId} stores every explicit step, closes and reopens factual recap without POST or audio`, async ({ page, qa }) => {
  const prohibited: string[] = [];
  await page.route(/\/api\/(?:language\/(?:conversation|tts)|tts|claude)(?:\?.*)?$/, async route => {
    if (route.request().method() === 'POST') { prohibited.push(route.request().url()); await route.abort(); return; }
    await route.continue();
  });
  await page.addInitScript(() => {
    const forbidden = () => { (window as unknown as { __guidedAudioCalls: number }).__guidedAudioCalls++; throw new Error('Guided pilot must remain text only'); };
    (window as unknown as { __guidedAudioCalls: number }).__guidedAudioCalls = 0;
    HTMLMediaElement.prototype.play = async () => { forbidden(); };
    if ('speechSynthesis' in window) window.speechSynthesis.speak = forbidden;
  });
  await page.setViewportSize({ width: 320, height: 844 }); await login(page, qa.account); await page.goto('/language/conversation');
  await page.getByRole('button', { name: '수준별 연습 선택', exact: true }).click();
  await page.getByLabel('상황', { exact: true }).selectOption('convenience-store');
  await page.getByLabel('수준', { exact: true }).selectOption(script.levelId);
  await expect(page.getByText('수준별 연습 3/24개 이용 가능 · 나머지 21개는 참고 자료만 있음 · 대화 준비 중', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: '위 보관 안내를 확인했어요.', exact: true }).check();
  await page.getByRole('button', { name: '새 대화 시작', exact: true }).click();
  const input = page.getByLabel('일본어 문장', { exact: true }), status = page.locator('[data-save-status]');
  let diagnosticStep = 0;
  try {
    for (let i = 0; i < script.steps.length; i++) {
      diagnosticStep = i;
      const step = script.steps[i];
      await expect(page.getByRole('heading', { name: `${i + 1}. ${step.titleKo}`, exact: true })).toBeVisible();
      await logGuidedBoundary(page, script.levelId, i, 'step-visible');
      const text = i ? `합성 자유 문장 ${script.levelId} ${i}` : step.learnerExample.japanese;
      await input.fill(text);
      await logGuidedBoundary(page, script.levelId, i, 'input-filled');
      await page.getByRole('button', { name: '입력 저장', exact: true }).click();
      await logGuidedBoundary(page, script.levelId, i, 'save-clicked');
      await expect(status).toHaveAttribute('data-save-status', 'saved');
      await logGuidedBoundary(page, script.levelId, i, 'saved');
      if (i === 0) { await page.reload(); await expect(input).toHaveValue(text); await logGuidedBoundary(page, script.levelId, i, 'reloaded'); }
      await page.getByRole('button', { name: i === script.steps.length - 1 ? '마지막 문장 보내기' : '보내고 다음 단계로', exact: true }).click();
      await logGuidedBoundary(page, script.levelId, i, 'send-clicked');
      await expect(page.getByRole('heading', { name: `보낸 문장 ${i + 1}개`, exact: true })).toBeVisible();
      await logGuidedBoundary(page, script.levelId, i, 'sent');
      await expect(page.getByRole('region', { name: '이 대화에서 보낸 문장', exact: true })).toContainText(step.fixedReply.japanese);
      if (i) await expect(page.getByRole('region', { name: '이 대화에서 보낸 문장', exact: true })).toContainText('참고 예문');
    }
    await expect(page.getByText(`연습 단계 ${script.steps.length}/${script.steps.length} 전송됨 · 대화 종료로 기록을 마무리해 주세요.`, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '예문 듣기', exact: true })).toHaveCount(0);
    await logGuidedBoundary(page, script.levelId, diagnosticStep, 'before-close');
    await page.getByRole('button', { name: '대화 종료', exact: true }).click();
    await logGuidedBoundary(page, script.levelId, diagnosticStep, 'close-clicked');
    const recap = page.getByRole('region', { name: '종료한 대화 요약', exact: true });
    await expect(recap).toContainText(`전송한 단계 ${script.steps.length}/${script.steps.length}`);
    await expect(recap).toContainText('평가한 문장 0개');
    await logGuidedBoundary(page, script.levelId, diagnosticStep, 'closed');
    await page.getByRole('button', { name: '기록 보기', exact: true }).click();
    await page.getByRole('region', { name: '이 브라우저의 대화 기록', exact: true }).getByRole('button', { name: new RegExp(`${script.labelKo} .*종료 요약 보기$`) }).click();
    await expect(recap).toContainText(script.levelLabelKo); await noOverflow(page);
    expect(prohibited).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __guidedAudioCalls: number }).__guidedAudioCalls)).toBe(0);
    expect(await qa.read()).toEqual(original); expect(await qa.readLanguage()).toEqual(originalLanguage);
  } finally { await logGuidedBoundary(page, script.levelId, diagnosticStep, 'finished'); }
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
  await expect.poll(async () => (await qa.account.client.from('growth_sessions').select('metrics').eq('routine_id', routines[0].id).eq('session_date', today()).single()).data?.metrics).toEqual({ recordMode: 'active', actualMinutesRecorded: true, stopReason: 'tired' });
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

for (const [reason, label] of [['illness', '몸이 아팠어요'], ['forgot', '깜빡했어요'], ['no_motivation', '의욕이 없었어요']]) {
  test(`growth ${reason} round-trips through active and past records without rewriting legacy reasons or targets`, async ({ page, qa }) => {
    const routine = { id: randomUUID(), user_id: qa.account.id, category: 'custom', title: `자기응답 합성 ${reason}`, target_minutes: 30, preferred_days: [1, 2, 3, 4, 5, 6, 7], target_sessions_per_week: 7, enabled: true, sort_order: 0 };
    expect((await qa.account.client.from('growth_routines').insert(routine)).error).toBeNull();
    const legacy = await qa.account.client.from('growth_sessions').insert([
      { user_id: qa.account.id, routine_id: routine.id, session_date: daysAgo(2), status: 'stopped', planned_minutes: 30, actual_minutes: 4, metrics: { stopReason: 'tired', original: { keep: true } } },
      { user_id: qa.account.id, routine_id: routine.id, session_date: daysAgo(3), status: 'partial', planned_minutes: 30, actual_minutes: 0, metrics: { stopReason: 'future-reason' } },
    ]).select();
    expect(legacy.error).toBeNull(); expect(legacy.data).toHaveLength(2);
    await page.setViewportSize({ width: 320, height: 844 });
    await login(page, qa.account); await page.goto('/growth');
    const card = page.locator('article').filter({ has: page.getByRole('heading', { name: routine.title, exact: true }) });
    await card.getByRole('button', { name: '시작', exact: true }).click();
    await expect(page.getByLabel('중단·미완료 이유 (선택)', { exact: true })).toHaveValue('unrecorded');
    await page.getByLabel('중단·미완료 이유 (선택)', { exact: true }).selectOption({ label });
    await page.getByRole('button', { name: '중단 저장', exact: true }).click();
    const readRecord = (date: string) => qa.account.client.from('growth_sessions').select('status,metrics').eq('routine_id', routine.id).eq('session_date', date).single();
    await expect.poll(async () => (await readRecord(today())).data).toEqual({ status: 'stopped', metrics: { recordMode: 'active', actualMinutesRecorded: true, stopReason: reason } });
    await page.getByRole('button', { name: '지난 기록 추가', exact: true }).click();
    const form = page.locator('section').filter({ has: page.getByRole('heading', { name: '날짜를 골라 기록하기', exact: true }) });
    await form.getByRole('combobox').first().selectOption(routine.id);
    await page.getByLabel('기록 날짜', { exact: true }).fill(daysAgo(1));
    await page.getByLabel('실행 상태', { exact: true }).selectOption('partial');
    await expect(page.getByLabel('지난 기록 중단 이유', { exact: true })).toHaveValue('unrecorded');
    await page.getByLabel('지난 기록 중단 이유', { exact: true }).selectOption({ label });
    await page.getByLabel('실행 시간', { exact: true }).fill('3');
    await form.getByRole('button', { name: '기록 저장', exact: true }).click();
    await expect.poll(async () => (await readRecord(daysAgo(1))).data).toEqual({ status: 'partial', metrics: { recordMode: 'manual', actualMinutesRecorded: true, stopReason: reason } });
    await page.reload();
    await expect(page.getByRole('button', { name: `${routine.title} 빠른 완료`, exact: true })).toBeVisible();
    expect((await readRecord(today())).data).toEqual({ status: 'stopped', metrics: { recordMode: 'active', actualMinutesRecorded: true, stopReason: reason } });
    expect((await readRecord(daysAgo(1))).data).toEqual({ status: 'partial', metrics: { recordMode: 'manual', actualMinutesRecorded: true, stopReason: reason } });
    await noOverflow(page);
    await page.goto('/growth/review');
    await page.getByRole('button', { name: '주간 코칭 만들기', exact: true }).click();
    await expect(page.getByText(`서로 다른 4일에 미완료 기록이 있어요. 선택한 이유 중 ‘${label}’가 가장 많았어요.`, { exact: true })).toBeVisible();
    const review = await qa.account.client.from('growth_ai_reviews').select('source,suggestions').eq('user_id', qa.account.id).single();
    expect(review.error).toBeNull(); expect(review.data?.source).toBe('local');
    expect(review.data?.suggestions[0]).toMatchObject({ routineId: routine.id, recommendedMinutes: 20 });
    expect((await qa.account.client.from('growth_routines').select('target_minutes').eq('id', routine.id).single()).data?.target_minutes).toBe(30);
    for (const row of legacy.data!) {
      expect((await qa.account.client.from('growth_sessions').select('*').eq('id', row.id).single()).data).toEqual(row);
    }
    const other = await qa.createAccount();
    const privateRecords = await other.client.from('growth_sessions').select('id').eq('routine_id', routine.id);
    expect(privateRecords.error).toBeNull(); expect(privateRecords.data).toEqual([]);
    expect(await qa.read()).toEqual(original);
  });
}

for (const [status, label] of [['abdominal_pain', '복통'], ['diarrhea', '설사']]) {
  test(`diet ${status} preserves drafts on save failure, reloads its own response, and stays isolated after account change`, async ({ page, qa }) => {
    const key = 'ai-fitness-diet-completed-days';
    const history = {
      ...(original[key] as Record<string, unknown>),
      ...Object.fromEntries(['comfortable', 'heartburn', 'bloated', 'nausea', 'unrecorded', 'future-status'].map((digestionStatus, index) => [daysAgo(index + 1), { digestionStatus, preserved: { index } }])),
      [daysAgo(7)]: { dietMemo: '응답 없는 이전 기록' },
      [daysAgo(8)]: { digestionStatus: status, dietMemo: '이전 자기응답' },
      [today()]: { originalField: { keep: true } },
    };
    const seeded = { ...original, [key]: history };
    expect((await qa.account.client.from('user_app_state').update({ state: seeded }).eq('user_id', qa.account.id)).error).toBeNull();
    await page.setViewportSize({ width: 320, height: 844 });
    await login(page, qa.account); await synced(page); await page.goto('/diet');
    await expect(page.getByLabel('소화 상태', { exact: true })).toHaveValue('unrecorded');
    const comparison = page.getByRole('region', { name: '28일 식단 기록 비교' });
    await comparison.getByText('최근 28일 날짜별 근거', { exact: true }).click();
    await expect(comparison.getByText(`${daysAgo(8)} · 소화 ${label} · 야식 미기록`, { exact: true })).toBeVisible();
    await expect(comparison.getByText(`${daysAgo(6)} · 소화 미기록 · 야식 미기록`, { exact: true })).toBeVisible();
    await expect(comparison).toContainText('이 비교만으로 원인이나 건강 상태를 판단할 수 없습니다.');
    await page.getByLabel('소화 상태', { exact: true }).selectOption({ label });
    await page.getByLabel('메모', { exact: true }).fill('합성 자기응답 유지');
    const beforeFailure = await localState(page);
    await page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (this === localStorage && key === 'ai-fitness-diet-completed-days') {
          Storage.prototype.setItem = originalSetItem;
          throw new DOMException('Synthetic storage failure', 'QuotaExceededError');
        }
        return originalSetItem.call(this, key, value);
      };
    });
    await page.getByRole('button', { name: '오늘 식단 저장', exact: true }).click();
    await expect(page.getByText('기기에 저장하지 못했어요. 작성 내용은 남아 있습니다. 저장 공간을 확인한 뒤 다시 저장해 주세요.', { exact: true })).toBeVisible();
    await expect(page.getByLabel('소화 상태', { exact: true })).toHaveValue(status);
    await expect(page.getByLabel('메모', { exact: true })).toHaveValue('합성 자기응답 유지');
    expect(await localState(page)).toEqual(beforeFailure);
    expect(await qa.read()).toEqual(seeded);
    await page.getByRole('button', { name: '오늘 식단 저장', exact: true }).click();
    await expect.poll(async () => (await qa.read())[key]).toMatchObject({ [today()]: { digestionStatus: status, dietMemo: '합성 자기응답 유지', originalField: { keep: true } } });
    await synced(page);
    const saved = await qa.read(); assertOriginalPreserved(saved);
    for (const [date, entry] of Object.entries(history)) {
      if (date !== today()) expect((saved[key] as Record<string, unknown>)[date]).toEqual(entry);
    }
    await page.reload(); await synced(page);
    await expect(page.getByLabel('소화 상태', { exact: true })).toHaveValue(status);
    await expect(page.getByRole('region', { name: '최근 7일 식단 요약' })).toContainText('소화 불편 4일 / 상태 응답 5일');
    await noOverflow(page);
    const other = await qa.createAccount();
    await page.goto('/diet/settings'); await synced(page);
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await expect(page.getByLabel('이메일', { exact: true })).toBeVisible();
    await login(page, other); await synced(page); await page.goto('/diet');
    await expect(page.getByLabel('소화 상태', { exact: true })).toHaveValue('unrecorded');
    await expect(page.getByLabel('메모', { exact: true })).toHaveValue('');
    await page.getByRole('button', { name: '오늘 식단 저장', exact: true }).click();
    await expect.poll(async () => (await qa.read(other))[key]).toMatchObject({ [today()]: { digestionStatus: 'unrecorded' } });
    await synced(page); await page.reload(); await synced(page);
    await expect(page.getByLabel('소화 상태', { exact: true })).toHaveValue('unrecorded');
    await expect(page.getByRole('region', { name: '최근 7일 식단 요약' })).toContainText('소화 불편 0일 / 상태 응답 0일');
    expect(await qa.read()).toEqual(saved);
    assertOriginalPreserved(await qa.read(other));
    await noOverflow(page);
  });
}
