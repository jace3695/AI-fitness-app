import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleEventResource,
  getCalendarMonthBounds,
  getGoogleCalendarDayPreview,
  isSameGoogleCalendarEvent,
  mapGoogleCalendarEvent,
  parseGoogleCalendarItems,
  parseGoogleCalendarEventInput,
} from "../../lib/google-calendar.ts";

test("Google 성공 응답도 일정 배열이 확인되지 않으면 빈 달로 처리하지 않는다", () => {
  for (const malformed of [null, {}, [], "not json", { items: null }, { items: {} }, { items: [], error: { message: "failure" } }, { items: [null] }, { items: [{}] }]) {
    assert.equal(parseGoogleCalendarItems(malformed), null);
  }
  assert.deepEqual(parseGoogleCalendarItems({ items: [] }), []);
});

test("Google 일정 배열은 정상 일정과 취소된 일정을 보존한다", () => {
  const items = [
    { id: "all-day", start: { date: "2026-10-12" }, end: { date: "2026-10-13" } },
    { id: "timed", summary: "합성 일정", start: { dateTime: "2026-10-12T09:00:00+09:00", timeZone: "Asia/Seoul" } },
    { id: "cancelled", status: "cancelled" },
  ];
  assert.equal(parseGoogleCalendarItems({ items, nextPageToken: "unchanged-page-token" }), items);
  assert.deepEqual(parseGoogleCalendarItems({ items: [], nextPageToken: "unchanged-page-token" }), []);
  assert.equal(mapGoogleCalendarEvent(items[2]), null);
});

test("items 생략은 확인된 Google 일정 컬렉션에서만 빈 페이지로 처리한다", () => {
  const envelope = { kind: "calendar#events", etag: '"synthetic-etag"' };
  assert.deepEqual(parseGoogleCalendarItems(envelope), []);
  for (const malformed of [
    { kind: "calendar#events" }, { etag: '"synthetic-etag"' },
    { ...envelope, etag: "" }, { ...envelope, etag: 123 },
    { ...envelope, kind: "calendar#calendarList" },
    { ...envelope, items: null }, { ...envelope, items: undefined },
    { ...envelope, error: {} }, { ...envelope, kind: "calendar#calendarList", items: [] },
  ]) assert.equal(parseGoogleCalendarItems(malformed), null);
});

test("손상된 Google 일정 필드를 성공한 빈 목록으로 바꾸지 않는다", () => {
  const item = { id: "synthetic", start: { date: "2026-10-12" } };
  for (const malformed of [
    { ...item, id: "" }, { ...item, start: undefined }, { ...item, start: {} },
    { ...item, start: { date: "2026-02-30" } }, { ...item, start: { dateTime: "invalid" } },
    { ...item, end: { dateTime: 123 } }, { ...item, summary: 123 }, { ...item, htmlLink: {} },
  ]) {
    assert.equal(parseGoogleCalendarItems({ items: [malformed] }), null);
  }
});

test("달력 칸에는 첫 Google 일정 제목과 나머지 개수를 보여준다", () => {
  const preview = getGoogleCalendarDayPreview([
    { id: "event-1", title: "Google 연동 테스트", date: "2026-08-30", startLabel: "종일", allDay: true },
    { id: "event-2", title: "저녁 운동", date: "2026-08-30", startLabel: "20:00", allDay: false },
  ]);

  assert.deepEqual(preview, { title: "Google 연동 테스트", additionalCount: 1 });
  assert.equal(getGoogleCalendarDayPreview([]), null);
});

test("시간 일정 입력을 검증하고 Google 일정 형식으로 바꾼다", () => {
  const parsed = parseGoogleCalendarEventInput({
    title: "  아침 운동  ",
    date: "2026-08-31",
    allDay: false,
    startTime: "07:30",
    endTime: "08:20",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(buildGoogleEventResource(parsed.value), {
    summary: "아침 운동",
    extendedProperties: { private: { jaceAiFitnessApp: "calendar" } },
    start: { dateTime: "2026-08-31T07:30:00+09:00", timeZone: "Asia/Seoul" },
    end: { dateTime: "2026-08-31T08:20:00+09:00", timeZone: "Asia/Seoul" },
  });
});

test("끝 시간이 시작 시간보다 빠르면 거부한다", () => {
  const parsed = parseGoogleCalendarEventInput({
    title: "운동",
    date: "2026-08-31",
    allDay: false,
    startTime: "09:00",
    endTime: "08:00",
  });
  assert.deepEqual(parsed, { ok: false, error: "끝 시간은 시작 시간보다 늦어야 합니다." });
});

test("종일 일정의 종료일과 월 경계를 정확히 계산한다", () => {
  const parsed = parseGoogleCalendarEventInput({ title: "휴식", date: "2026-12-31", allDay: true });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const resource = buildGoogleEventResource(parsed.value);
  assert.equal(resource.end?.date, "2027-01-01");
  assert.deepEqual(getCalendarMonthBounds("2026-12"), {
    timeMin: "2026-12-01T00:00:00+09:00",
    timeMax: "2027-01-01T00:00:00+09:00",
  });
});

test("UTC Google 일정을 서울 날짜와 시간으로 표시한다", () => {
  const mapped = mapGoogleCalendarEvent({
    id: "event-1",
    summary: "저녁 운동",
    start: { dateTime: "2026-08-30T15:30:00Z" },
    end: { dateTime: "2026-08-30T16:30:00Z" },
  });
  assert.equal(mapped?.date, "2026-08-31");
  assert.equal(mapped?.startLabel, "00:30");
});

test("제목과 시간이 같은 일정은 중복으로 판단한다", () => {
  assert.equal(isSameGoogleCalendarEvent({
    id: "event-1",
    summary: "아침 운동",
    start: { dateTime: "2026-08-30T22:30:00Z" },
    end: { dateTime: "2026-08-30T23:20:00Z" },
  }, {
    title: "아침 운동",
    date: "2026-08-31",
    allDay: false,
    startTime: "07:30",
    endTime: "08:20",
  }), true);
});
