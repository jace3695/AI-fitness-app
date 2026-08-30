import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleEventResource,
  getCalendarMonthBounds,
  isSameGoogleCalendarEvent,
  mapGoogleCalendarEvent,
  parseGoogleCalendarEventInput,
} from "../../lib/google-calendar.ts";

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
