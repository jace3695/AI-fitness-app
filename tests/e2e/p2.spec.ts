import { randomUUID } from "node:crypto";
import {
  assertOriginalPreserved,
  expect,
  login,
  original,
  originalLanguage,
  synced,
  test,
  today,
} from "./fixture";

function dateMinus(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

test("diet photo estimate requires explicit review and never stores the image", async ({ page, qa }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const unauthorized = await page.request.post("/api/diet/photo-analysis", {
    data: { mealSlot: "lunch", imageDataUrl: "invalid" },
  });
  expect(unauthorized.status()).toBe(401);
  const { data: sessionData } = await qa.account.client.auth.getSession();
  expect(sessionData.session?.access_token).toBeTruthy();
  const invalidBody = await page.request.post("/api/diet/photo-analysis", {
    headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
    data: { mealSlot: "lunch", imageDataUrl: "invalid" },
  });
  expect(invalidBody.status()).toBe(400);
  let analysisRequests = 0;
  await page.route("**/api/diet/photo-analysis", async (route) => {
    analysisRequests += 1;
    const body = route.request().postDataJSON() as { mealSlot?: string; imageDataUrl?: string; freeDataUseAcknowledged?: boolean };
    expect(body.mealSlot).toBe("lunch");
    expect(body.imageDataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(body.freeDataUseAcknowledged).toBe(true);
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        foods: ["닭가슴살", "잡곡밥", "채소"],
        proteinGrams: 27,
        cookedRiceGrams: 130,
        vegetables: "some",
        confidence: "medium",
        note: "그릇 크기에 따라 오차가 있을 수 있어요.",
      }),
    });
  });

  await login(page, qa.account);
  await synced(page);
  await page.goto("/diet");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), {
    message: "the 320px diet photo flow has no horizontal page overflow",
  }).toBe(true);

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const photoInput = page.getByLabel("음식 사진 선택");
  const samePhoto = { name: "synthetic-meal.png", mimeType: "image/png", buffer: png };
  const analyze = page.getByRole("button", { name: "AI로 분석", exact: true });
  const dataNotice = page.getByLabel("무료 분석의 사진·응답 활용 안내를 확인했습니다.");
  await photoInput.setInputFiles(samePhoto);
  await expect(analyze).toBeDisabled();
  await dataNotice.check();
  await expect(analyze).toBeEnabled();
  await page.getByRole("button", { name: "사진 지우기", exact: true }).click();
  await expect(photoInput).toHaveValue("");
  await expect(page.getByAltText("분석할 식사 사진 미리보기")).toHaveCount(0);
  await expect(analyze).toBeDisabled();
  await photoInput.setInputFiles(samePhoto);
  await expect(page.getByAltText("분석할 식사 사진 미리보기")).toBeVisible();
  await expect(dataNotice).not.toBeChecked();
  await expect(analyze).toBeDisabled();
  await dataNotice.check();
  await expect(analyze).toBeEnabled();
  expect(analysisRequests).toBe(0);
  await analyze.click();
  await expect(page.getByText("AI 추정 결과", { exact: true })).toBeVisible();
  expect(analysisRequests).toBe(1);

  const apply = page.getByRole("button", { name: "점심 입력칸에 반영", exact: true });
  await expect(apply).toBeDisabled();
  await page.getByLabel("사진 분석은 추정치이며, 음식과 양을 직접 확인했습니다.").check();
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.getByLabel("점심 식품 단백질 직접 입력")).toHaveValue("27");
  await expect(page.getByLabel("점심 밥량")).toHaveValue("130");
  await expect(page.getByText("점심 추정치를 입력칸에 반영했습니다. 아직 저장되지 않았습니다.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "오늘 식단 저장", exact: true }).click();
  await synced(page);
  await expect.poll(async () => {
    const state = await qa.read();
    const meals = state["ai-fitness-diet-meal-log"] as Record<string, { lunchProteinChoice?: string; lunchProteinCustom?: number }> | undefined;
    const carbs = state["ai-fitness-lunch-carb-choice"] as Record<string, { amountType?: string; grams?: number }> | undefined;
    return {
      proteinChoice: meals?.[today()]?.lunchProteinChoice,
      proteinGrams: meals?.[today()]?.lunchProteinCustom,
      riceChoice: carbs?.[today()]?.amountType,
      riceGrams: carbs?.[today()]?.grams,
      containsImage: JSON.stringify(state).includes("data:image"),
    };
  }, { message: "only confirmed estimates, never the photo, reached the real isolated DB" }).toEqual({
    proteinChoice: "custom",
    proteinGrams: 27,
    riceChoice: "custom",
    riceGrams: 130,
    containsImage: false,
  });
  assertOriginalPreserved(await qa.read());
});

test("free photo setup and quota failures preserve drafts without paid reservations", async ({ page, qa }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const { data: sessionData } = await qa.account.client.auth.getSession();
  const authorization = `Bearer ${sessionData.session?.access_token}`;
  const imageDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const consentMissing = await page.request.post("/api/diet/photo-analysis", {
    headers: { Authorization: authorization }, data: { mealSlot: "lunch", imageDataUrl },
  });
  expect(consentMissing.status()).toBe(400);
  // CI deliberately has no dedicated free key or confirmation. This exercises
  // the real route/auth path and must stop before any provider or billing call.
  const unconfigured = await page.request.post("/api/diet/photo-analysis", {
    headers: { Authorization: authorization }, data: { mealSlot: "lunch", imageDataUrl, freeDataUseAcknowledged: true },
  });
  expect(unconfigured.status()).toBe(503);
  expect((await unconfigured.json()).error).toContain("무료 사진 분석 연결을 준비 중");

  let requests = 0;
  await page.route("**/api/diet/photo-analysis", async (route) => {
    requests += 1;
    await route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({
      error: "무료 사진 분석의 이용 한도에 도달했어요. 식사 내용을 직접 입력하거나 나중에 다시 이용해 주세요.",
    }) });
  });
  await login(page, qa.account);
  await synced(page);
  await page.goto("/diet");
  await page.getByText("밥량 · 조리 후 무게", { exact: true }).locator("..")
    .getByRole("button", { name: "직접 입력", exact: true }).click();
  const rice = page.getByLabel("점심 밥량");
  await rice.fill("123");
  await page.getByLabel("음식 사진 선택").setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: Buffer.from(imageDataUrl.split(",")[1], "base64") });
  await page.getByLabel("무료 분석의 사진·응답 활용 안내를 확인했습니다.").check();
  await page.getByRole("button", { name: "AI로 분석", exact: true }).click();
  await expect(page.getByText(/무료 사진 분석의 이용 한도에 도달했어요/)).toBeVisible();
  await expect(rice).toHaveValue("123");
  await expect(page.getByRole("button", { name: "오늘 식단 저장", exact: true })).toBeEnabled();
  await expect(page.getByText("AI 추정 결과", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "사진 지우기", exact: true }).click();
  await expect(page.getByAltText("분석할 식사 사진 미리보기")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(requests).toBe(1);
  assertOriginalPreserved(await qa.read());
  const usage = await qa.account.client.from("ai_usage_events").select("id");
  expect(usage.error).toBeNull();
  expect(usage.data).toEqual([]);
});

test("growth schedule updates atomically and remains owner isolated", async ({ page, qa }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const routineId = randomUUID();
  const routineTitle = "P2 합성 주간 루틴";
  const inserted = await qa.account.client.from("growth_routines").insert({
    id: routineId,
    user_id: qa.account.id,
    category: "custom",
    title: routineTitle,
    target_minutes: 15,
    preferred_days: [1, 2, 3, 4, 5, 6, 7],
    target_sessions_per_week: 7,
    enabled: true,
    sort_order: 0,
  });
  expect(inserted.error).toBeNull();

  await login(page, qa.account);
  await synced(page);
  await page.goto("/growth");
  await expect(page.getByText(routineTitle, { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), {
    message: "the 390px growth schedule view has no horizontal page overflow",
  }).toBe(true);
  await page.getByRole("button", { name: "루틴 편집", exact: true }).click();

  const current = new Date(`${today()}T12:00:00Z`).getUTCDay();
  const todayIso = current === 0 ? 7 : current;
  const removedDay = [1, 2, 3, 4, 5, 6, 7].find((day) => day !== todayIso) ?? 1;
  const dayLabel = ["", "월", "화", "수", "목", "금", "토", "일"][removedDay];
  await page.getByRole("button", { name: `${routineTitle} ${dayLabel}요일`, exact: true }).click();
  await expect.poll(async () => {
    const result = await qa.account.client.from("growth_routines").select("preferred_days,target_sessions_per_week").eq("id", routineId).single();
    return result.data;
  }, { message: "weekday and bounded weekly target reached Postgres together" }).toEqual({
    preferred_days: [1, 2, 3, 4, 5, 6, 7].filter((day) => day !== removedDay),
    target_sessions_per_week: 6,
  });

  await page.getByLabel(`${routineTitle} 주간 목표`).selectOption("3");
  await expect.poll(async () => {
    const result = await qa.account.client.from("growth_routines").select("target_sessions_per_week").eq("id", routineId).single();
    return result.data?.target_sessions_per_week;
  }).toBe(3);

  await page.getByRole("button", { name: `${routineTitle} 빠른 완료`, exact: true }).click();
  await page.getByText(/나머지 예정·완료 루틴/).click();
  await expect(page.getByText(/이번 주 1\/3회/).first()).toBeVisible();
  await expect.poll(async () => {
    const result = await qa.account.client.from("growth_sessions").select("session_date,status").eq("routine_id", routineId);
    return result.data;
  }).toEqual([{ session_date: today(), status: "completed" }]);

  const other = await qa.createAccount();
  const otherWrite = await other.client.from("growth_routines").update({
    preferred_days: [2, 4], target_sessions_per_week: 2,
  }).eq("id", routineId).select("id");
  expect(otherWrite.error).toBeNull();
  expect(otherWrite.data).toEqual([]);
  const ownerRow = await qa.account.client.from("growth_routines").select("preferred_days,target_sessions_per_week").eq("id", routineId).single();
  expect(ownerRow.data).toEqual({
    preferred_days: [1, 2, 3, 4, 5, 6, 7].filter((day) => day !== removedDay),
    target_sessions_per_week: 3,
  });
});

test("AI Yeoni shows a seven-day cross-app briefing without a paid AI call", async ({ page, qa }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const date = today();
  const yesterday = dateMinus(date, 1);
  const appUpdate = await qa.account.client.from("user_app_state").update({ state: {
    ...original,
    "ai-fitness-workout-completed-days": {
      ...(original["ai-fitness-workout-completed-days"] as Record<string, unknown>),
      [date]: { workoutStatus: "completed" },
      [yesterday]: { workoutStatus: "partial" },
    },
    "ai-fitness-diet-completed-days": {
      ...(original["ai-fitness-diet-completed-days"] as Record<string, unknown>),
      [date]: { dietStatus: "normal" },
    },
  } }).eq("user_id", qa.account.id);
  expect(appUpdate.error).toBeNull();
  const languageUpdate = await qa.account.client.from("language_user_state").update({ state: {
    ...originalLanguage,
    dailyRoutineProgress: { date, completedIds: ["kana"] },
    dailyLearningHistory: {
      [date]: { completedIds: ["kana", "words"], completedCount: 2, totalCount: 5, updatedAt: new Date().toISOString() },
    },
  } }).eq("user_id", qa.account.id);
  expect(languageUpdate.error).toBeNull();
  const budgetInsert = await qa.account.client.from("budget_transactions").insert({
    user_id: qa.account.id, date, amount: 12345, place: "P2 합성", category: "테스트", transaction_type: "expense",
  });
  expect(budgetInsert.error).toBeNull();
  const routineId = randomUUID();
  const growthInsert = await qa.account.client.from("growth_routines").insert({
    id: routineId, user_id: qa.account.id, category: "custom", title: "P2 브리핑 루틴",
    target_minutes: 10, preferred_days: [1, 2, 3, 4, 5, 6, 7], target_sessions_per_week: 7,
  });
  expect(growthInsert.error).toBeNull();
  const sessionInsert = await qa.account.client.from("growth_sessions").insert({
    user_id: qa.account.id, routine_id: routineId, session_date: date, status: "completed",
    planned_minutes: 10, actual_minutes: 10,
  });
  expect(sessionInsert.error).toBeNull();

  await login(page, qa.account);
  await synced(page);
  await page.goto("/assistant");
  const weekly = page.getByRole("region", { name: "최근 7일 통합 브리핑" });
  await expect(weekly.getByText("이번 주 흐름 한눈에 보기", { exact: true })).toBeVisible();
  await expect(weekly.getByRole("link", { name: /가계부.*12,345원 지출.*최근 7일 1건/ })).toBeVisible();
  await expect(weekly.getByRole("link", { name: /운동.*2일 실행/ })).toBeVisible();
  await expect(weekly.getByRole("link", { name: /식단.*1일 기록/ })).toBeVisible();
  await expect(weekly.getByRole("link", { name: /언어 학습.*1일 학습.*완료 루틴 2개/ })).toBeVisible();
  await expect(weekly.getByRole("link", { name: /자기계발.*1일 실행.*기록 10분/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), {
    message: "the 390px seven-day briefing has no horizontal page overflow",
  }).toBe(true);
  expect(qa.traffic.blockedOrigins.size).toBe(0);
});

test('growth weekday patterns count recorded days, survive reload and preserve routines and sessions at 320px', async ({ page, qa }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, qa.account); await synced(page);
  await page.goto('/growth');
  await expect(page.getByRole('heading', { name: '나의 루틴', exact: true })).toBeVisible();
  const routine = await qa.account.client.from('growth_routines').insert({ user_id: qa.account.id, title: '합성 패턴 루틴', category: 'custom', target_minutes: 10, enabled: true, sort_order: 999, preferred_days: [1,3,5], target_sessions_per_week: 3 }).select().single();
  expect(routine.error).toBeNull();
  const rows = [-1,-2,-3].map((offset, index) => ({ user_id: qa.account.id, routine_id: routine.data!.id, session_date: dateMinus(today(), -offset), status: index ? 'stopped' : 'completed', planned_minutes: 10, actual_minutes: 5, source: 'manual' }));
  expect((await qa.account.client.from('growth_sessions').insert([...rows, {...rows[0],status:'stopped'}])).error).toBeNull();
  const before = (await qa.account.client.from('growth_sessions').select('*').order('id')).data;
  const routinesBefore = (await qa.account.client.from('growth_routines').select('*').order('id')).data;
  await page.goto('/growth/review');
  const panel = page.getByRole('region', { name: '루틴 요일별 실행 패턴' });
  await panel.getByLabel('살펴볼 루틴').selectOption(routine.data!.id);
  await expect(panel).toContainText('기록 3일 · 기록 없음 25일');
  await panel.getByText('요일별 근거 보기', { exact: true }).click();
  await expect(panel.getByRole('table')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await panel.getByLabel('살펴볼 루틴').selectOption(routine.data!.id);
  await expect(panel).toContainText('기록 3일 · 기록 없음 25일');
  await panel.getByRole('link', { name: '루틴 일정 확인하기 →' }).click();
  await expect(page.getByRole('button', { name: '루틴 편집', exact: true })).toBeVisible();
  expect((await qa.account.client.from('growth_sessions').select('*').order('id')).data).toEqual(before);
  expect((await qa.account.client.from('growth_routines').select('*').order('id')).data).toEqual(routinesBefore);
});

test('growth pattern loading failure is distinct from no records and retry recovers', async ({ page, qa }) => {
  await login(page, qa.account); await synced(page);
  await page.goto('/growth', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '나의 루틴', exact: true })).toBeVisible();
  await page.route('**/rest/v1/growth_sessions?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({message:'Synthetic unavailable'}) }));
  await page.goto('/growth/review', { waitUntil: 'domcontentloaded' });
  const panel = page.getByRole('region', { name: '루틴 요일별 실행 패턴' });
  await expect(panel.getByRole('alert')).toContainText('실행 기록을 모두 확인하지 못했어요');
  await expect(panel).not.toContainText('이 기간에는 실행 기록이 없어요');
  await expect(page.getByRole('region', { name: '루틴 시작 시간대별 패턴' })).toHaveCount(0);
  await page.unroute('**/rest/v1/growth_sessions?*');
  await panel.getByRole('button', { name: '기록 다시 불러오기' }).click();
  await expect(panel).toContainText('이 기간에는 실행 기록이 없어요');
  expect((await qa.account.client.from('growth_sessions').select('id')).data).toHaveLength(0);
});

test('growth start times compare Korean slots at 320px without inventing clocks or changing original records', async ({ page, qa }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, qa.account); await synced(page);
  await page.goto('/growth', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '나의 루틴', exact: true })).toBeVisible();
  await expect(page.getByText('개인 루틴을 안전하게 동기화하고 있어요…', { exact: true })).toHaveCount(0);
  const routine = await qa.account.client.from('growth_routines').insert({ user_id: qa.account.id, title: '합성 시작 시간 비교', category: 'custom', target_minutes: 10, enabled: true, sort_order: 999, preferred_days: [1,3,5], target_sessions_per_week: 3 }).select().single();
  expect(routine.error).toBeNull();
  const rows = Array.from({ length: 10 }, (_, i) => {
    const date = dateMinus(today(), i + 1);
    return { user_id: qa.account.id, routine_id: routine.data!.id, session_date: date, status: i < 4 ? 'stopped' : 'completed', planned_minutes: 10, actual_minutes: 5, source: 'manual', started_at: i < 8 ? `${date}T${i < 4 ? '08' : '20'}:00:00+09:00` : i === 9 ? `${date}T08:00:00+09:00` : null };
  });
  expect((await qa.account.client.from('growth_sessions').insert([...rows, { ...rows[4], status: 'stopped', started_at: `${rows[4].session_date}T08:00:00+09:00` }, { ...rows[9], started_at: `${rows[9].session_date}T20:00:00+09:00` }])).error).toBeNull();
  const before = (await qa.account.client.from('growth_sessions').select('*').order('id')).data;
  const routinesBefore = (await qa.account.client.from('growth_routines').select('*').order('id')).data;
  const stateBefore = await qa.read();
  await page.goto('/growth/review', { waitUntil: 'domcontentloaded' });
  const panel = page.getByRole('region', { name: '루틴 요일별 실행 패턴' });
  const times = page.getByRole('region', { name: '루틴 시작 시간대별 패턴' });
  await panel.getByLabel('살펴볼 루틴').selectOption(routine.data!.id);
  await expect(times).toContainText('시간대 확인 8일 · 비교 제외 2일');
  await expect(times.getByRole('group', { name: '오전 시작', exact: true })).toContainText('완료 0일 / 기록 4일');
  await expect(times.getByRole('group', { name: '저녁 시작', exact: true })).toContainText('완료 4일 / 기록 4일');
  await expect(times).toContainText('저녁의 기록일 중 완료 비율이 더 높았어요');
  await times.getByText('시간대별 근거 보기', { exact: true }).click();
  await expect(times.getByRole('table').getByRole('row')).toHaveCount(11);
  await expect(times.getByRole('table')).toContainText('시각 미기록');
  await expect(times.getByRole('table')).toContainText('여러 시간대');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await panel.getByLabel('살펴볼 루틴').selectOption(routine.data!.id);
  await expect(times).toContainText('시간대 확인 8일 · 비교 제외 2일');
  await panel.getByRole('button', { name: '기록 다시 불러오기', exact: true }).click();
  await expect(times).toContainText('시간대 확인 8일 · 비교 제외 2일');
  expect(await qa.read()).toEqual(stateBefore);
  expect((await qa.account.client.from('growth_sessions').select('*').order('id')).data).toEqual(before);
  expect((await qa.account.client.from('growth_routines').select('*').order('id')).data).toEqual(routinesBefore);
});

test('growth start time exclusions and explicit refresh use the saved start instead of the insertion time', async ({ page, qa }) => {
  await login(page, qa.account); await synced(page);
  await page.goto('/growth', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '나의 루틴', exact: true })).toBeVisible();
  await expect(page.getByText('개인 루틴을 안전하게 동기화하고 있어요…', { exact: true })).toHaveCount(0);
  const routine = await qa.account.client.from('growth_routines').select('*').order('sort_order').limit(1).single();
  expect(routine.error).toBeNull();
  const date = dateMinus(today(), 1);
  const session = await qa.account.client.from('growth_sessions').insert({ user_id: qa.account.id, routine_id: routine.data!.id, session_date: date, status: 'completed', planned_minutes: 10, actual_minutes: 5, source: 'manual', started_at: `${dateMinus(date,1)}T23:55:00+09:00`, ended_at: `${date}T00:05:00+09:00` }).select().single();
  expect(session.error).toBeNull();
  await page.goto('/growth/review', { waitUntil: 'domcontentloaded' });
  const panel = page.getByRole('region', { name: '루틴 요일별 실행 패턴' });
  const times = page.getByRole('region', { name: '루틴 시작 시간대별 패턴' });
  await panel.getByLabel('살펴볼 루틴').selectOption(routine.data!.id);
  await expect(times).toContainText('시간대 확인 0일 · 비교 제외 1일');
  await times.getByText('시간대별 근거 보기', { exact: true }).click();
  await expect(times.getByRole('table')).toContainText('시작 날짜 다름');
  expect((await qa.account.client.from('growth_sessions').update({ started_at: `${date}T12:00:00+09:00`, ended_at: `${date}T12:05:00+09:00` }).eq('id',session.data!.id)).error).toBeNull();
  const before = (await qa.account.client.from('growth_sessions').select('*').order('id')).data;
  await panel.getByRole('button', { name: '기록 다시 불러오기', exact: true }).click();
  await expect(times.getByRole('group', { name: '오후 시작', exact: true })).toContainText('완료 1일 / 기록 1일');
  await expect(times).toContainText('시간대 확인 1일 · 비교 제외 0일');
  await expect(times).toContainText('각각 4일 이상');
  expect((await qa.account.client.from('growth_sessions').select('*').order('id')).data).toEqual(before);
  expect(await qa.read()).toEqual(original);
});

test('growth workout comparison uses explicit marks, reloads and preserves both apps at 320px', async ({ page, qa }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, qa.account); await synced(page);
  await page.goto('/growth', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '나의 루틴', exact: true })).toBeVisible();
  await expect(page.getByText('개인 루틴을 안전하게 동기화하고 있어요…', { exact: true })).toHaveCount(0);
  const routine = await qa.account.client.from('growth_routines').insert({ user_id: qa.account.id, title: '합성 운동 비교', category: 'custom', target_minutes: 10, enabled: true, sort_order: 999, preferred_days: [1,3,5], target_sessions_per_week: 3 }).select().single();
  expect(routine.error).toBeNull();
  const rows = Array.from({ length: 8 }, (_, i) => ({ user_id: qa.account.id, routine_id: routine.data!.id, session_date: dateMinus(today(), i + 1), status: i < 4 ? 'stopped' : 'completed', planned_minutes: 10, actual_minutes: 5, source: 'manual' }));
  expect((await qa.account.client.from('growth_sessions').insert([...rows, { ...rows[4], status: 'stopped' }])).error).toBeNull();
  const original = await qa.read();
  const values = [{workoutStatus:'partial'}, {cardioDone:true}, {pullupDone:true}, true, false, {}, {foamRollerDone:true}];
  const state = { ...original, 'ai-fitness-workout-completed-days': { ...(original['ai-fitness-workout-completed-days'] as Record<string, unknown>), ...Object.fromEntries(values.map((value, i) => [rows[i].session_date, value])) } };
  expect((await qa.account.client.from('user_app_state').update({state}).eq('user_id', qa.account.id)).error).toBeNull();
  const before = (await qa.account.client.from('growth_sessions').select('*').order('id')).data;
  const routinesBefore = (await qa.account.client.from('growth_routines').select('*').order('id')).data;
  await page.goto('/growth/review', { waitUntil: 'domcontentloaded' });
  const panel = page.getByRole('region', { name: '루틴 요일별 실행 패턴' });
  const comparison = page.getByRole('region', { name: '운동 기록과 루틴 비교' });
  await panel.getByLabel('살펴볼 루틴').selectOption(routine.data!.id);
  await expect(comparison.getByRole('group', { name: '운동 기록 있음', exact: true })).toContainText('루틴 완료 0일 / 기록 4일');
  await expect(comparison.getByRole('group', { name: '운동 기록 미확인', exact: true })).toContainText('루틴 완료 4일 / 기록 4일');
  await expect(comparison).toContainText('루틴 완료 비율이 더 낮았어요');
  await expect(comparison).toContainText('운동을 쉬었다는 뜻이 아니에요');
  await comparison.getByText('날짜별 비교 근거 보기', { exact: true }).click();
  await expect(comparison.getByRole('table').getByRole('row')).toHaveCount(9);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await panel.getByLabel('살펴볼 루틴').selectOption(routine.data!.id);
  await expect(comparison).toContainText('루틴 완료 비율이 더 낮았어요');
  await panel.getByRole('button', { name: '기록 다시 불러오기', exact: true }).click();
  await expect(comparison).toContainText('루틴 완료 비율이 더 낮았어요');
  expect(await qa.read()).toEqual(state);
  expect((await qa.account.client.from('growth_sessions').select('*').order('id')).data).toEqual(before);
  expect((await qa.account.client.from('growth_routines').select('*').order('id')).data).toEqual(routinesBefore);
});

test('growth workout comparison blocks malformed records and refresh shows a corrected server value', async ({ page, qa }) => {
  await login(page, qa.account); await synced(page);
  await page.goto('/growth', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '나의 루틴', exact: true })).toBeVisible();
  await expect(page.getByText('개인 루틴을 안전하게 동기화하고 있어요…', { exact: true })).toHaveCount(0);
  const routine = await qa.account.client.from('growth_routines').select('*').order('sort_order').limit(1).single();
  expect(routine.error).toBeNull();
  const date = dateMinus(today(), 1);
  expect((await qa.account.client.from('growth_sessions').insert({ user_id: qa.account.id, routine_id: routine.data!.id, session_date: date, status: 'completed', planned_minutes: 10, actual_minutes: 5, source: 'manual' })).error).toBeNull();
  const original = await qa.read();
  const invalid = { ...original, 'ai-fitness-workout-completed-days': '{synthetic-invalid' };
  expect((await qa.account.client.from('user_app_state').update({state:invalid}).eq('user_id', qa.account.id)).error).toBeNull();
  await page.goto('/growth/review', { waitUntil: 'domcontentloaded' });
  const panel = page.getByRole('region', { name: '루틴 요일별 실행 패턴' });
  const comparison = page.getByRole('region', { name: '운동 기록과 루틴 비교' });
  await panel.getByLabel('살펴볼 루틴').selectOption(routine.data!.id);
  await expect(panel).toContainText('기록 1일 · 기록 없음 27일');
  await expect(comparison.getByRole('alert')).toContainText('운동 기록 형식을 확인하지 못해');
  await expect(comparison.getByRole('group')).toHaveCount(0);
  expect(await qa.read()).toEqual(invalid);
  const corrected = { ...original, 'ai-fitness-workout-completed-days': { [date]: { cardioDone: true, cardioMinutes: 20 } } };
  expect((await qa.account.client.from('user_app_state').update({state:corrected}).eq('user_id', qa.account.id)).error).toBeNull();
  await panel.getByRole('button', { name: '기록 다시 불러오기', exact: true }).click();
  await expect(comparison.getByRole('group', { name: '운동 기록 있음', exact: true })).toContainText('루틴 완료 1일 / 기록 1일');
  await expect(comparison.getByRole('alert')).toHaveCount(0);
  expect(await qa.read()).toEqual(corrected);
});

test('resource usage reviews dates at 320px, filters reported dates only, reloads and restores unrecorded', async ({ page, qa }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const id = randomUUID(); const older = dateMinus(today(), 30);
  const seed = await qa.account.client.from('growth_resources').insert({ id, user_id: qa.account.id, title: '합성 활용 자료', storage_path: `${qa.account.id}/${id}.txt`, mime_type: 'text/plain', size_bytes: 100, notes: '그대로 보존', classification: 'deferred', created_at: '2001-01-02T00:00:00Z' }).select().single();
  expect(seed.error).toBeNull();
  await login(page, qa.account); await synced(page);
  await page.goto('/growth/resources');
  const card = page.getByRole('article', { name: '합성 활용 자료', exact: true });
  await expect(card).toContainText('활용일 미기록');
  const state = await qa.read();
  await page.getByLabel('활용일 필터').selectOption('revisit');
  await expect(card).toHaveCount(0); // An old upload date is not evidence of non-use.
  await page.getByLabel('활용일 필터').selectOption('unknown');
  await expect(card).toBeVisible();
  await page.getByLabel('활용일 필터').selectOption('all');
  const read = async () => (await qa.account.client.from('growth_resources').select('*').eq('id', id).single()).data;
  await card.getByRole('button', { name: '활용일 기록·수정' }).click();
  await card.getByLabel('합성 활용 자료 마지막 활용일').fill(dateMinus(today(), -1));
  await card.getByRole('button', { name: '변경 내용 확인' }).click();
  await expect(card.getByRole('alert')).toContainText('오늘까지');
  await card.getByLabel('합성 활용 자료 마지막 활용일').fill(older);
  await card.getByRole('button', { name: '변경 내용 확인' }).click();
  await expect(card).toContainText(`이전: 미기록 → 변경: ${older}`);
  expect(await read()).toEqual(seed.data);
  await card.getByRole('button', { name: '취소', exact: true }).click();
  expect(await read()).toEqual(seed.data);
  await card.getByRole('button', { name: '활용일 기록·수정' }).click();
  await card.getByLabel('합성 활용 자료 마지막 활용일').fill(older);
  await card.getByRole('button', { name: '변경 내용 확인' }).click();
  await card.getByRole('button', { name: '확인 후 저장', exact: true }).click();
  await expect(card).toContainText('기록한 활용일로부터 30일 지났어요');
  const stored = await read();
  expect(stored).toEqual({ ...seed.data, last_used_on: older, updated_at: stored.updated_at });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(card).toContainText(`마지막 활용일 ${older}`);
  await page.getByLabel('활용일 필터').selectOption('revisit');
  await expect(card).toBeVisible();
  await page.getByLabel('활용일 필터').selectOption('all');
  await card.getByRole('button', { name: '활용일 기록·수정' }).click();
  await card.getByLabel('합성 활용 자료 마지막 활용일').fill('');
  await card.getByRole('button', { name: '변경 내용 확인' }).click();
  await expect(card).toContainText(`이전: ${older} → 변경: 미기록`);
  await card.getByRole('button', { name: '확인 후 저장', exact: true }).click();
  await expect(card).toContainText('활용일 미기록');
  await page.reload();
  await expect(card).toContainText('활용일 미기록');
  const restored = await read();
  expect(restored).toEqual({ ...seed.data, updated_at: restored.updated_at });
  await synced(page);
  expect(await qa.read()).toEqual(state);
});

test('resource usage protects newer metadata and other owners', async ({ page, qa }) => {
  const id = randomUUID(); const other = await qa.createAccount();
  expect((await qa.account.client.from('growth_resources').insert({ id, user_id: qa.account.id, title: '합성 충돌 자료', storage_path: `${qa.account.id}/${id}.txt`, mime_type: 'text/plain', size_bytes: 100 })).error).toBeNull();
  await login(page, qa.account); await synced(page);
  await page.goto('/growth/resources');
  const card = page.getByRole('article', { name: '합성 충돌 자료', exact: true });
  await card.getByRole('button', { name: '활용일 기록·수정' }).click();
  await card.getByLabel('합성 충돌 자료 마지막 활용일').fill(today());
  await card.getByRole('button', { name: '변경 내용 확인' }).click();
  const newer = await qa.account.client.from('growth_resources').update({ last_used_on: dateMinus(today(), 1), notes: '새 메모', updated_at: new Date().toISOString() }).eq('id', id).select().single();
  expect(newer.error).toBeNull();
  await card.getByRole('button', { name: '확인 후 저장', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '저장한 값과 달라요' })).toBeVisible();
  await expect(card).toContainText('새 메모');
  await expect(card).toContainText(`마지막 활용일 ${dateMinus(today(), 1)}`);
  expect((await qa.account.client.from('growth_resources').select('*').eq('id', id).single()).data).toEqual(newer.data);
  const hidden = await other.client.from('growth_resources').select('*').eq('id', id);
  expect(hidden.error).toBeNull(); expect(hidden.data).toEqual([]);
  const denied = await other.client.from('growth_resources').update({ last_used_on: today() }).eq('id', id).select();
  expect(denied.error).toBeNull(); expect(denied.data).toEqual([]);
  expect((await qa.account.client.from('growth_resources').select('*').eq('id', id).single()).data).toEqual(newer.data);
  await synced(page);
});

test('resource usage recovers a committed write with read-only confirmation after response loss', async ({ page, qa }) => {
  const { RouteDrain } = await import('./route-drain');
  const drain = new RouteDrain(); const id = randomUUID();
  expect((await qa.account.client.from('growth_resources').insert({ id, user_id: qa.account.id, title: '합성 응답 유실 자료', storage_path: `${qa.account.id}/${id}.txt`, mime_type: 'text/plain', size_bytes: 100 })).error).toBeNull();
  await login(page, qa.account); await synced(page);
  await page.goto('/growth/resources');
  const card = page.getByRole('article', { name: '합성 응답 유실 자료', exact: true });
  await card.getByRole('button', { name: '활용일 기록·수정' }).click();
  await card.getByLabel('합성 응답 유실 자료 마지막 활용일').fill(today());
  await card.getByRole('button', { name: '변경 내용 확인' }).click();
  let patches = 0; let failReads = true;
  const pattern = '**/rest/v1/growth_resources?*';
  await page.route(pattern, route => drain.run(async () => {
    const request = route.request();
    if (request.method() === 'PATCH') {
      patches++;
      expect(Object.keys(request.postDataJSON()).sort()).toEqual(['last_used_on', 'updated_at']);
      const url = new URL(request.url());
      expect(url.searchParams.get('last_used_on')).toBe('is.null');
      expect(url.searchParams.get('updated_at')).toMatch(/^eq\./);
      const result = await route.fetch({ maxRetries: 0 });
      expect(result.ok()).toBe(true);
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Synthetic lost response"}' });
    } else if (request.method() === 'GET' && failReads) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Synthetic unavailable"}' });
    } else await route.continue();
  }));
  try {
    await card.getByRole('button', { name: '확인 후 저장', exact: true }).click();
    await expect(card.getByRole('alert')).toContainText('저장 결과를 확인하지 못했어요');
    expect(patches).toBe(1);
    const before = (await qa.account.client.from('growth_resources').select('*').eq('id', id).single()).data;
    expect(before.last_used_on).toBe(today());
    failReads = false;
    await card.getByRole('button', { name: '저장 결과 다시 확인' }).click();
    await expect(card.getByRole('button', { name: '활용일 기록·수정' })).toBeVisible();
    expect(patches).toBe(1);
    expect((await qa.account.client.from('growth_resources').select('*').eq('id', id).single()).data).toEqual(before);
    await synced(page);
  } finally {
    failReads = false;
    await drain.wait();
    await page.unroute(pattern);
  }
  await page.reload();
  await expect(card).toContainText(`마지막 활용일 ${today()}`);
});

test('resource list failure never claims no matching resources and refresh recovers', async ({ page, qa }) => {
  const id = randomUUID();
  expect((await qa.account.client.from('growth_resources').insert({ id, user_id: qa.account.id, title: '합성 조회 자료', storage_path: `${qa.account.id}/${id}.txt`, mime_type: 'text/plain', size_bytes: 100 })).error).toBeNull();
  await login(page, qa.account); await synced(page);
  await page.route('**/rest/v1/growth_resources?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Synthetic unavailable"}' }));
  await page.goto('/growth/resources');
  const panel = page.getByRole('region', { name: '저장된 자료', exact: true });
  await expect(panel.getByRole('alert')).toContainText('자료 목록을 불러오지 못했어요');
  await expect(panel).not.toContainText('조건에 맞는 자료가 없습니다');
  await page.unroute('**/rest/v1/growth_resources?*');
  await panel.getByRole('button', { name: '자료 새로고침' }).click();
  await expect(page.getByRole('article', { name: '합성 조회 자료' })).toContainText('활용일 미기록');
  expect((await qa.account.client.from('growth_resources').select('last_used_on').eq('id', id).single()).data!.last_used_on).toBeNull();
  await synced(page);
});

test('diet 28 day comparison uses saved answers, evidence, reload and 320px without changing records', async ({ page, qa }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const before = await qa.read();
  const records = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [dateMinus(today(), i + 1), { digestionStatus: 'bloated', lateSnack: i < 3 ? 'yes' : 'no' }]));
  Object.assign(records, Object.fromEntries(Array.from({ length: 7 }, (_, i) => [dateMinus(today(), i + 29), { digestionStatus: 'comfortable', lateSnack: 'no' }])));
  const state = { ...before, 'ai-fitness-diet-completed-days': { ...(before['ai-fitness-diet-completed-days'] as Record<string, unknown>), ...records, [today()]: { digestionStatus: 'comfortable', lateSnack: 'no' }, [dateMinus(today(), 8)]: { dietMemo: '미응답 보존' } } };
  expect((await qa.account.client.from('user_app_state').update({ state }).eq('user_id', qa.account.id)).error).toBeNull();
  await login(page, qa.account); await synced(page);
  await page.goto('/diet', { waitUntil: 'domcontentloaded' });
  const panel = page.getByRole('region', { name: '28일 식단 기록 비교' });
  await expect(panel.getByRole('article', { name: '최근 28일', exact: true })).toContainText('소화 불편 7일 / 응답 7일 · 100%');
  await expect(panel).toContainText('소화 불편: 이전 기간보다 응답일 비율 100%p 높음');
  await expect(panel).toContainText('야식: 이전 기간보다 응답일 비율 43%p 높음');
  await panel.getByText('최근 28일 날짜별 근거', { exact: true }).click();
  await expect(panel.getByText(`${dateMinus(today(), 8)} · 소화 미기록 · 야식 미기록`, { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('소화 상태', { exact: true }).selectOption('nausea');
  await expect(panel).toContainText('소화 불편 7일 / 응답 7일 · 100%');
  await page.getByLabel('소화 상태', { exact: true }).selectOption('comfortable');
  await page.reload({ waitUntil: 'domcontentloaded' }); await synced(page);
  await expect(panel).toContainText('야식: 이전 기간보다 응답일 비율 43%p 높음');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.goto('/diet', { waitUntil: 'domcontentloaded' }); await synced(page);
  await expect(panel).toContainText('소화 불편: 이전 기간보다 응답일 비율 100%p 높음');
  expect(await qa.read()).toEqual(state);
  assertOriginalPreserved(await qa.read());
});

test('diet comparison with no responses keeps unknown rates and does not infer a trend', async ({ page, qa }) => {
  const before = await qa.read();
  await login(page, qa.account); await synced(page);
  await page.goto('/diet', { waitUntil: 'domcontentloaded' });
  const panel = page.getByRole('region', { name: '28일 식단 기록 비교' });
  await expect(panel.getByRole('article', { name: '최근 28일', exact: true })).toContainText('소화 불편 0일 / 응답 0일 · 비율 미기록');
  await expect(panel).toContainText('소화 불편: 각 기간에 응답 7일 이상이면 차이를 표시합니다.');
  await panel.getByText('이전 28일 날짜별 근거', { exact: true }).click();
  await expect(panel.getByRole('article', { name: '이전 28일', exact: true }).getByText('이 기간에 저장된 식단 기록이 없습니다.', { exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' }); await synced(page);
  await expect(panel).toContainText('비율 미기록');
  expect(await qa.read()).toEqual(before);
});

test('diet workout context combines saved evidence at 320px without inferring clocks or changing inputs', async ({ page, qa }) => {
  await page.setViewportSize({width:320,height:844});
  const before=await qa.read();
  const day=dateMinus(today(),1), other=dateMinus(today(),2);
  const state={...before,
    'ai-fitness-workout-completed-days':{...(before['ai-fitness-workout-completed-days'] as Record<string,unknown>),[day]:{workoutStatus:'partial'},[other]:{workoutRecordedAt:`${other}T12:00:00Z`}},
    'ai-fitness-diet-completed-days':{...(before['ai-fitness-diet-completed-days'] as Record<string,unknown>),[day]:{afterWorkoutMeal:'yes',lastMealTime:'18:30'},[other]:{afterWorkoutMeal:'no'}}};
  expect((await qa.account.client.from('user_app_state').update({state}).eq('user_id',qa.account.id)).error).toBeNull();
  await login(page,qa.account); await synced(page); await page.goto('/diet',{waitUntil:'domcontentloaded'});
  const panel=page.getByRole('region',{name:'운동과 식사 기록 함께 보기'});
  await expect(panel).toContainText('운동 표시 1일');
  await expect(panel).toContainText('예 1일 · 아니요 0일 · 미기록 0일');
  await panel.getByText('운동·식사 날짜별 근거',{exact:true}).click();
  await expect(panel.getByRole('listitem').filter({hasText:day})).toContainText('마지막 식사 18:30');
  await expect(panel.getByRole('listitem').filter({hasText:other})).toContainText('운동 미확인');
  await expect(panel.getByRole('listitem').filter({hasText:other})).toContainText('시각 미기록');
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const input=page.getByLabel('운동 후 식사를 했나요?',{exact:true}); const old=await input.inputValue();
  await input.selectOption('yes'); await expect(panel).toContainText('예 1일 · 아니요 0일 · 미기록 0일'); await input.selectOption(old);
  await page.reload({waitUntil:'domcontentloaded'}); await synced(page); await expect(panel).toContainText('운동 표시 1일');
  await page.goto('/',{waitUntil:'domcontentloaded'}); await page.goto('/diet',{waitUntil:'domcontentloaded'}); await synced(page);
  // Compare every key and nested value against the actual seeded start state.
  // The generic helper expects no added workout dates, unlike this fixture.
  await expect(panel).toContainText('운동 표시 1일'); expect(await qa.read()).toEqual(state);
});

test('diet workout context distinguishes malformed workout data from an empty history', async ({page,qa})=>{
  const before=await qa.read();
  const state={...before,'ai-fitness-workout-completed-days':[]};
  expect((await qa.account.client.from('user_app_state').update({state}).eq('user_id',qa.account.id)).error).toBeNull();
  await login(page,qa.account); await synced(page); await page.goto('/diet',{waitUntil:'domcontentloaded'});
  const panel=page.getByRole('region',{name:'운동과 식사 기록 함께 보기'});
  await expect(panel.getByRole('alert')).toContainText('기록 형식을 확인할 수 없어');
  await expect(panel).not.toContainText('운동 표시 0일');
  const repaired={...state,'ai-fitness-workout-completed-days':{}};
  expect((await qa.account.client.from('user_app_state').update({state:repaired}).eq('user_id',qa.account.id)).error).toBeNull();
  await page.reload({waitUntil:'domcontentloaded'}); await synced(page);
  await expect(panel).toContainText('운동 표시 0일'); await expect(panel.getByRole('alert')).toHaveCount(0);
  expect(await qa.read()).toEqual(repaired);
});
