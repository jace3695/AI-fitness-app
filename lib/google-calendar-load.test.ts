import assert from "node:assert/strict";
import test from "node:test";
import { createGoogleCalendarLoader, initialGoogleCalendarLoad, parseGoogleCalendarConnectionStatus, visibleGoogleCalendarLoad, type GoogleCalendarConnectionStatus, type GoogleCalendarLoadState } from "./google-calendar-load.ts";

const event = (month = "2026-10") => ({ id: month, title: "합성 일정", date: `${month}-12`, startLabel: "종일", allDay: true });
function harness() {
  const states: GoogleCalendarLoadState[] = [];
  const requests: { url: string; signal: AbortSignal; resolve: (response: Response) => void; reject: (error: Error) => void }[] = [];
  const loader = createGoogleCalendarLoader((url, init) => new Promise<Response>((resolve, reject) => {
    requests.push({ url, signal: init.signal as AbortSignal, resolve, reject });
  }), state => states.push(state));
  const reply = (index: number, data: unknown, status = 200) => requests[index].resolve(Response.json(data, { status }));
  const current = () => states.at(-1)!;
  return { loader, states, requests, reply, current };
}

test("connection responses require an explicit valid status; failure cannot mean disconnected", () => {
  for (const malformed of [null, {}, [], { connected: false }, { configured: true }, { configured: true, connected: "false" }, { configured: false, connected: true }]) {
    assert.throws(() => parseGoogleCalendarConnectionStatus(malformed), /연결 상태를 확인하지 못했습니다/);
  }
  assert.deepEqual(parseGoogleCalendarConnectionStatus({ configured: true, connected: false }), {
    loading: false, configured: true, connected: false, error: null, email: null,
  });
  assert.equal(parseGoogleCalendarConnectionStatus({ configured: false, connected: false }).configured, false);
});

test("visible connection states distinguish unknown, failure, disconnected, and confirmed empty", () => {
  const initial = initialGoogleCalendarLoad("2026-10");
  const status: GoogleCalendarConnectionStatus = { loading: true, configured: true, connected: null, error: null };
  assert.deepEqual(visibleGoogleCalendarLoad("2026-10", status, initial), initial);
  assert.deepEqual(visibleGoogleCalendarLoad("2026-10", { ...status, loading: false, error: "연결 조회 장애" }, initial), {
    monthKey: "2026-10", phase: "error", events: null, error: "연결 조회 장애",
  });
  assert.deepEqual(visibleGoogleCalendarLoad("2026-10", parseGoogleCalendarConnectionStatus({ configured: true, connected: false }), initial), {
    monthKey: "2026-10", phase: "disconnected", events: null, error: null,
  });
  const empty: GoogleCalendarLoadState = { monthKey: "2026-10", phase: "success", events: [], error: null };
  assert.equal(visibleGoogleCalendarLoad("2026-10", { ...status, loading: false, connected: true }, empty), empty);
});

test("status retry and failure retain only the selected month's last confirmed data", () => {
  const success: GoogleCalendarLoadState = { monthKey: "2026-10", phase: "success", events: [event()], error: null };
  const status: GoogleCalendarConnectionStatus = { loading: true, configured: true, connected: true, error: null };
  assert.equal(visibleGoogleCalendarLoad("2026-10", status, success).phase, "loading");
  assert.deepEqual(visibleGoogleCalendarLoad("2026-10", status, success).events, [event()]);
  const failed = { ...status, loading: false, error: "연결 조회 장애" };
  assert.equal(visibleGoogleCalendarLoad("2026-10", failed, success).phase, "error");
  assert.deepEqual(visibleGoogleCalendarLoad("2026-10", failed, success).events, [event()]);
  assert.equal(visibleGoogleCalendarLoad("2026-11", failed, success).events, null);
  assert.deepEqual(visibleGoogleCalendarLoad("2026-11", { ...status, loading: false }, success), initialGoogleCalendarLoad("2026-11"));
});

test("first failed read remains unknown; only a valid successful empty response confirms zero events", async () => {
  const h = harness();
  const failed = h.loader.load("2026-10");
  assert.deepEqual(h.current(), { monthKey: "2026-10", phase: "loading", events: null, error: null });
  assert.equal(h.requests[0].url, "/api/google-calendar/events?month=2026-10");
  h.reply(0, { error: "합성 조회 장애" }, 503);
  await failed;
  assert.deepEqual(h.current(), { monthKey: "2026-10", phase: "error", events: null, error: "합성 조회 장애" });
  const retry = h.loader.load("2026-10");
  assert.equal(h.current().error, null);
  h.reply(1, { events: [] });
  await retry;
  assert.deepEqual(h.current(), { monthKey: "2026-10", phase: "success", events: [], error: null });
});

test("same-month refresh keeps the confirmed data through loading and failure, then replaces it on recovery", async () => {
  const h = harness();
  const first = h.loader.load("2026-10");
  h.reply(0, { events: [event()] });
  await first;
  const refresh = h.loader.load("2026-10");
  assert.equal(h.current().phase, "loading");
  assert.deepEqual(h.current().events, [event()]);
  h.requests[1].reject(new Error("합성 네트워크 오류"));
  await refresh;
  assert.equal(h.current().phase, "error");
  assert.deepEqual(h.current().events, [event()]);
  const recovery = h.loader.load("2026-10");
  h.reply(2, { events: [] });
  await recovery;
  assert.equal(h.current().phase, "success");
  assert.deepEqual(h.current().events, []);
});

test("a failed refresh of a previously empty month is an error, never another successful empty read", async () => {
  const h = harness();
  const first = h.loader.load("2026-10");
  h.reply(0, { events: [] });
  await first;
  const refresh = h.loader.load("2026-10");
  h.reply(1, { error: "확인 필요" }, 502);
  await refresh;
  assert.equal(h.current().phase, "error");
  assert.deepEqual(h.current().events, []);
});

test("month navigation clears prior-month data and ignores a late success even if abort is ignored", async () => {
  const h = harness();
  const old = h.loader.load("2026-10");
  const next = h.loader.load("2026-11");
  assert.equal(h.requests[0].signal.aborted, true);
  assert.deepEqual(h.current(), { monthKey: "2026-11", phase: "loading", events: null, error: null });
  h.reply(1, { events: [event("2026-11")] });
  await next;
  const confirmed = h.current();
  h.reply(0, { events: [event()] });
  await old;
  assert.equal(h.current(), confirmed);
  const previous = h.loader.load("2026-10");
  assert.equal(h.current().events, null);
  h.reply(2, { error: "확인 필요" }, 503);
  await previous;
  assert.equal(h.current().events, null);
});

test("late failure cannot replace a newer month's loading state or make its request retryable", async () => {
  const h = harness();
  const old = h.loader.load("2026-10");
  const next = h.loader.load("2026-11");
  const loading = h.current();
  h.requests[0].reject(new Error("이전 달 오류"));
  await old;
  assert.equal(h.current(), loading);
  assert.equal(h.loader.load("2026-11"), next);
  assert.equal(h.requests.length, 2);
  h.reply(1, { events: [] });
  await next;
  assert.equal(h.current().phase, "success");
});

test("duplicate loads share one request; cancel and clear reject late results without publishing them", async () => {
  const h = harness();
  const first = h.loader.load("2026-10");
  assert.equal(h.loader.load("2026-10"), first);
  assert.equal(h.requests.length, 1);
  h.loader.cancel();
  assert.equal(h.requests[0].signal.aborted, true);
  const before = h.states.length;
  h.reply(0, { events: [event()] });
  await first;
  assert.equal(h.states.length, before);
  const second = h.loader.load("2026-10");
  h.loader.clear("2026-10");
  h.reply(1, { events: [event()] });
  await second;
  assert.equal(h.current().events, null);
});

test("a cancelled read cannot replace a newer request for the same month", async () => {
  const h = harness();
  const cancelled = h.loader.load("2026-10");
  h.loader.cancel();
  const latest = h.loader.load("2026-10");
  const loading = h.current();
  h.reply(0, { events: [event()] });
  await cancelled;
  assert.equal(h.current(), loading);
  assert.equal(h.loader.load("2026-10"), latest);
  h.reply(1, { events: [] });
  await latest;
  assert.deepEqual(h.current().events, []);
});

test("a stale response body finishing after month navigation cannot publish", async () => {
  const h = harness();
  let finishBody!: (value: unknown) => void;
  const body = new Promise(resolve => { finishBody = resolve; });
  const previous = h.loader.load("2026-10");
  h.requests[0].resolve(Object.assign(new Response(), { json: () => body }));
  await Promise.resolve();
  const latest = h.loader.load("2026-11");
  h.reply(1, { events: [] });
  await latest;
  const confirmed = h.current();
  finishBody({ events: [event()] });
  await previous;
  assert.equal(h.current(), confirmed);
});

test("malformed successful responses do not erase a last successful list", async () => {
  const h = harness();
  const first = h.loader.load("2026-10");
  h.reply(0, { events: [event()] });
  await first;
  for (const malformed of [null, {}, { events: null }, { events: [null] }, { events: [{}] }, { events: [{ ...event(), allDay: "yes" }] }]) {
    const load = h.loader.load("2026-10");
    h.reply(h.requests.length - 1, malformed);
    await load;
    assert.equal(h.current().phase, "error");
    assert.deepEqual(h.current().events, [event()]);
  }
  const invalidJson = h.loader.load("2026-10");
  h.requests.at(-1)!.resolve(new Response("not json"));
  await invalidJson;
  assert.equal(h.current().phase, "error");
  assert.deepEqual(h.current().events, [event()]);
});
