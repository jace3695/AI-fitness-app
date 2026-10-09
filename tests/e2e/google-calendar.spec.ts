import type { Page } from "@playwright/test";
import { test, expect, login, original, synced } from "./fixture";

type CalendarRequest = { path: string; month: string | null; method: string; aborted: boolean; settled: boolean };
type CalendarMockWindow = Window & {
  calendarReadMock: {
    requests: CalendarRequest[];
    respond: (index: number, body: unknown, status: number) => void;
  };
};

// Synthetic Google responses only. Real disposable Supabase login is still used.
// Deliberately ignore abort when resolving: stale-response safety must not rely
// solely on browser transport cancellation. No Google API or OAuth flow is used.
async function installGoogleMock(page: Page) {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    const requests: CalendarRequest[] = [];
    const pending = new Map<number, (response: Response) => void>();
    (window as unknown as CalendarMockWindow).calendarReadMock = {
      requests,
      respond(index, body, status) {
        const resolve = pending.get(index);
        if (!resolve) throw new Error(`No pending synthetic calendar request ${index}`);
        pending.delete(index);
        requests[index].settled = true;
        resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
      },
    };
    window.fetch = (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.origin !== location.origin || !url.pathname.startsWith("/api/google-calendar/")) return nativeFetch(input, init);
      const request = { path: url.pathname, month: url.searchParams.get("month"), method: init?.method || "GET", aborted: false, settled: false };
      const index = requests.push(request) - 1;
      init?.signal?.addEventListener("abort", () => { request.aborted = true; }, { once: true });
      if (request.method !== "GET" || !["/api/google-calendar/status", "/api/google-calendar/events"].includes(request.path)) {
        throw new Error("Unexpected Google mutation or connection request in read-only regression");
      }
      return new Promise<Response>(resolve => pending.set(index, resolve));
    };
  });
}

const calls = (page: Page) => page.evaluate(() => (window as unknown as CalendarMockWindow).calendarReadMock.requests);
const waitForCalls = async (page: Page, count: number) => {
  await expect.poll(async () => (await calls(page)).length).toBe(count);
  return calls(page);
};
async function reply(page: Page, index: number, body: unknown, status = 200) {
  await page.evaluate(async args => {
    (window as unknown as CalendarMockWindow).calendarReadMock.respond(args.index, args.body, args.status);
    // Wait for the resumed fetch and resulting React paint, including no-op stale responses.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, { index, body, status });
}
const connected = { configured: true, connected: true, email: "synthetic@example.test" };
const event = (month: string, title: string) => ({ id: title, title, date: `${month}-12`, startLabel: "종일", allDay: true });
const noOverflow = (page: Page) => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

test("Google connection and event errors stay unknown until a confirmed empty retry, including day details at 320px", async ({ page, qa }) => {
  await installGoogleMock(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, qa.account); await synced(page); await page.goto("/calendar");
  const panel = page.getByRole("region", { name: "Google Calendar 일정", exact: true });
  await waitForCalls(page, 1);
  await reply(page, 0, { error: "합성 연결 조회 장애" }, 503);
  await expect(panel.getByRole("alert")).toContainText("합성 연결 조회 장애");
  await expect(panel.getByRole("button", { name: "Google 계정 연결", exact: true })).toHaveCount(0);
  await expect(panel.getByText("이 달에는 Google 일정이 없습니다.", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^\d{4}-\d{2}-12 기록 상세 보기$/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Google 일정을 확인하지 못했어요.");
  await expect(page.getByRole("dialog")).not.toContainText("이 날짜에 저장된 기록이 없습니다.");
  await page.getByRole("button", { name: "기록 상세 닫기", exact: true }).click();
  await panel.getByRole("button", { name: "연결 상태 다시 확인", exact: true }).click();
  await waitForCalls(page, 2); await reply(page, 1, connected);
  const requests = await waitForCalls(page, 3);
  const month = requests[2].month!;
  await expect(panel.getByRole("status")).toHaveText("Google 일정을 불러오는 중…");
  await expect(panel).not.toContainText("일정 0개");
  await page.getByRole("button", { name: `${month}-12 기록 상세 보기`, exact: true }).click();
  const detail = page.getByRole("dialog");
  await expect(detail).toContainText("Google 일정을 확인하고 있어요.");
  await expect(detail).not.toContainText("이 날짜에 저장된 기록이 없습니다.");
  await page.getByRole("button", { name: "기록 상세 닫기", exact: true }).click();
  await reply(page, 2, { error: "합성 일정 조회 장애" }, 503);
  await expect(panel.getByRole("alert")).toContainText("합성 일정 조회 장애");
  await expect(panel).not.toContainText("일정 0개");
  await expect(panel.getByText("이 달에는 Google 일정이 없습니다.", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: `${month}-12 기록 상세 보기`, exact: true }).click();
  await expect(detail).toContainText("조회하지 못한 기록이 있어요.");
  await expect(detail).not.toContainText("이 날짜에 저장된 기록이 없습니다.");
  await page.getByRole("button", { name: "기록 상세 닫기", exact: true }).click();
  await panel.getByRole("button", { name: "Google 일정 다시 불러오기", exact: true }).click();
  await waitForCalls(page, 4);
  await expect(panel.getByRole("button", { name: "Google 일정 새로고침", exact: true })).toBeDisabled();
  await expect(panel.getByText("이 달에는 Google 일정이 없습니다.", { exact: true })).toHaveCount(0);
  await reply(page, 3, { events: [] });
  await expect(panel.getByText("이 달에는 Google 일정이 없습니다.", { exact: true })).toBeVisible();
  await expect(panel).toContainText(`${month} 일정 0개`);
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: `${month}-12 기록 상세 보기`, exact: true }).click();
  await expect(detail).toContainText("이 날짜에 저장된 기록이 없습니다.");
  await page.getByRole("button", { name: "기록 상세 닫기", exact: true }).click();
  await panel.getByRole("button", { name: "Google 일정 새로고침", exact: true }).click();
  await waitForCalls(page, 5); await reply(page, 4, { error: "빈 달의 합성 재조회 장애" }, 503);
  await expect(panel.getByRole("alert")).toContainText("빈 달의 합성 재조회 장애");
  await expect(panel.getByText("이 달에는 Google 일정이 없습니다.", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: `${month}-12 기록 상세 보기`, exact: true }).click();
  await expect(detail).toContainText("조회하지 못한 기록이 있어요.");
  await expect(detail).not.toContainText("이 날짜에 저장된 기록이 없습니다.");
  await page.getByRole("button", { name: "기록 상세 닫기", exact: true }).click();
  await noOverflow(page);
  expect((await calls(page)).every(request => request.method === "GET")).toBe(true);
  expect(await qa.read()).toEqual(original);
});

test("malformed connection status stays unknown; explicit disconnected and unconfigured states do not claim Google is empty", async ({ page, qa }) => {
  await installGoogleMock(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, qa.account); await synced(page); await page.goto("/calendar");
  const panel = page.getByRole("region", { name: "Google Calendar 일정", exact: true });
  await waitForCalls(page, 1); await reply(page, 0, {});
  await expect(panel.getByRole("alert")).toContainText("연결 상태를 확인하지 못했습니다.");
  await expect(panel.getByRole("button", { name: "Google 계정 연결", exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "연결 상태 다시 확인", exact: true }).click();
  await waitForCalls(page, 2); await reply(page, 1, { configured: true, connected: false });
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Google 계정 연결", exact: true })).toBeEnabled();
  await expect(panel.getByText("이 달에는 Google 일정이 없습니다.", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^\d{4}-\d{2}-12 기록 상세 보기$/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Google Calendar가 연결되지 않아 Google 일정은 확인할 수 없어요.");
  await expect(page.getByRole("dialog")).toContainText("이 날짜에 저장된 앱 기록이 없습니다.");
  await expect(page.getByRole("dialog")).not.toContainText("이 날짜에 저장된 기록이 없습니다.");
  expect(await calls(page)).toHaveLength(2);
  await page.reload();
  await waitForCalls(page, 1); await reply(page, 0, { configured: false, connected: false });
  await expect(panel.getByRole("button", { name: "Google 계정 연결", exact: true })).toBeDisabled();
  await expect(panel).toContainText("운영 서버의 Google OAuth 설정을 마치면");
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await noOverflow(page);
  expect(await calls(page)).toHaveLength(1);
  expect(await qa.read()).toEqual(original);
});

test("Google refresh failure and malformed data preserve same-month events in both panel and day grid, then recover", async ({ page, qa }) => {
  await installGoogleMock(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, qa.account); await synced(page); await page.goto("/calendar");
  const panel = page.getByRole("region", { name: "Google Calendar 일정", exact: true });
  await waitForCalls(page, 1); await reply(page, 0, connected);
  const month = (await waitForCalls(page, 2))[1].month!;
  await reply(page, 1, { events: [event(month, "유지할 합성 일정")] });
  await expect(panel.getByText("유지할 합성 일정", { exact: true })).toBeVisible();
  const day = page.getByRole("button", { name: `${month}-12 기록 상세 보기, Google 일정 유지할 합성 일정`, exact: true });
  await expect(day).toBeVisible();
  await panel.getByRole("button", { name: "Google 일정 새로고침", exact: true }).click();
  await waitForCalls(page, 3);
  await expect(panel.getByText("유지할 합성 일정", { exact: true })).toBeVisible();
  await expect(panel).toContainText("이전에 확인한 일정 1개 · 최신 조회 확인 필요");
  await reply(page, 2, { error: "합성 새로고침 장애" }, 503);
  await expect(panel.getByRole("alert")).toContainText("이전에 불러온 일정을 유지합니다.");
  await expect(panel.getByText("유지할 합성 일정", { exact: true })).toBeVisible();
  await day.click();
  await expect(page.getByRole("dialog")).toContainText("유지할 합성 일정");
  await expect(page.getByRole("dialog")).toContainText("Google 일정을 확인하지 못했어요.");
  await page.getByRole("button", { name: "기록 상세 닫기", exact: true }).click();
  await panel.getByRole("button", { name: "Google 일정 다시 불러오기", exact: true }).click();
  await waitForCalls(page, 4); await reply(page, 3, { events: [null] });
  await expect(panel.getByRole("alert")).toContainText("Google 일정 응답을 확인하지 못했습니다.");
  await expect(day).toBeVisible();
  await panel.getByRole("button", { name: "Google 일정 다시 불러오기", exact: true }).click();
  await waitForCalls(page, 5); await reply(page, 4, { events: [] });
  await expect(panel.getByText("이 달에는 Google 일정이 없습니다.", { exact: true })).toBeVisible();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(day).toHaveCount(0);
  await page.reload();
  await waitForCalls(page, 1); await reply(page, 0, connected);
  await waitForCalls(page, 2);
  await expect(panel.getByText("이 달에는 Google 일정이 없습니다.", { exact: true })).toHaveCount(0);
  await reply(page, 1, { events: [event(month, "새로 조회한 합성 일정")] });
  await expect(panel.getByText("새로 조회한 합성 일정", { exact: true })).toBeVisible();
  await noOverflow(page);
  expect(await qa.read()).toEqual(original);
});

test("Google rapid month navigation ignores late success and failure even when the synthetic transport ignores abort", async ({ page, qa }) => {
  await installGoogleMock(page);
  await login(page, qa.account); await synced(page); await page.goto("/calendar");
  const panel = page.getByRole("region", { name: "Google Calendar 일정", exact: true });
  await waitForCalls(page, 1); await reply(page, 0, connected);
  const oldMonth = (await waitForCalls(page, 2))[1].month!;
  await page.getByRole("button", { name: "→", exact: true }).click();
  const nextMonth = (await waitForCalls(page, 3))[2].month!;
  await reply(page, 2, { events: [event(nextMonth, "새 달의 합성 일정")] });
  await expect(panel.getByText("새 달의 합성 일정", { exact: true })).toBeVisible();
  await reply(page, 1, { events: [event(oldMonth, "늦게 도착한 이전 달 일정")] });
  await expect(panel.getByText("새 달의 합성 일정", { exact: true })).toBeVisible();
  await expect(page.getByText("늦게 도착한 이전 달 일정", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `${nextMonth}-12 기록 상세 보기, Google 일정 새 달의 합성 일정`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "←", exact: true }).click();
  await waitForCalls(page, 4);
  await expect(panel.getByText("새 달의 합성 일정", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "→", exact: true }).click();
  await waitForCalls(page, 5);
  await reply(page, 3, { error: "늦게 도착한 이전 달 오류" }, 503);
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(panel.getByRole("status")).toHaveText("Google 일정을 불러오는 중…");
  await expect(panel.getByRole("button", { name: "Google 일정 새로고침", exact: true })).toBeDisabled();
  await reply(page, 4, { events: [] });
  await expect(panel.getByText("이 달에는 Google 일정이 없습니다.", { exact: true })).toBeVisible();
  const requests = await calls(page);
  expect(requests[1].aborted).toBe(true);
  expect(requests[3].aborted).toBe(true);
  expect(requests).toHaveLength(5);
  expect(await qa.read()).toEqual(original);
});
