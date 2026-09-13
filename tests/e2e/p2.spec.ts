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
    const body = route.request().postDataJSON() as { mealSlot?: string; imageDataUrl?: string };
    expect(body.mealSlot).toBe("lunch");
    expect(body.imageDataUrl).toMatch(/^data:image\/jpeg;base64,/);
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
  await page.getByLabel("음식 사진 선택").setInputFiles({ name: "synthetic-meal.png", mimeType: "image/png", buffer: png });
  expect(analysisRequests).toBe(0);
  await page.getByRole("button", { name: "AI로 분석", exact: true }).click();
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
