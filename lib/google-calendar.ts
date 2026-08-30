export const GOOGLE_CALENDAR_TIME_ZONE = "Asia/Seoul";

export type GoogleCalendarEvent = {
  id: string;
  title: string;
  date: string;
  startLabel: string;
  endLabel?: string;
  startTime?: string;
  endTime?: string;
  allDay: boolean;
  htmlLink?: string;
  description?: string;
};

export type GoogleCalendarEventInput = {
  title: string;
  date: string;
  allDay: boolean;
  startTime?: string;
  endTime?: string;
  description?: string;
};

type GoogleEventDate = { date?: string; dateTime?: string; timeZone?: string };

export type GoogleEventResource = {
  id?: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  status?: string;
  start?: GoogleEventDate;
  end?: GoogleEventDate;
  extendedProperties?: { private?: Record<string, string> };
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRealDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function addCalendarDays(value: string, days: number) {
  if (!isRealDate(value)) throw new Error("올바른 날짜가 아닙니다.");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function getCalendarMonthBounds(monthKey: string) {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) throw new Error("올바른 월을 선택해주세요.");
  const [year, month] = monthKey.split("-").map(Number);
  if (month < 1 || month > 12) throw new Error("올바른 월을 선택해주세요.");
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    timeMin: `${monthKey}-01T00:00:00+09:00`,
    timeMax: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+09:00`,
  };
}

export function parseGoogleCalendarEventInput(raw: unknown):
  | { ok: true; value: GoogleCalendarEventInput }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "일정 내용을 입력해주세요." };
  const body = raw as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const date = typeof body.date === "string" ? body.date : "";
  const allDay = body.allDay === true;
  const startTime = typeof body.startTime === "string" ? body.startTime : "";
  const endTime = typeof body.endTime === "string" ? body.endTime : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";

  if (!title) return { ok: false, error: "일정 제목을 입력해주세요." };
  if (title.length > 120) return { ok: false, error: "일정 제목은 120자 이내로 입력해주세요." };
  if (!isRealDate(date)) return { ok: false, error: "올바른 날짜를 선택해주세요." };
  if (description.length > 1_000) return { ok: false, error: "메모는 1,000자 이내로 입력해주세요." };
  if (!allDay) {
    if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) {
      return { ok: false, error: "시작 시간과 끝 시간을 선택해주세요." };
    }
    if (endTime <= startTime) return { ok: false, error: "끝 시간은 시작 시간보다 늦어야 합니다." };
  }

  return {
    ok: true,
    value: {
      title,
      date,
      allDay,
      startTime: allDay ? undefined : startTime,
      endTime: allDay ? undefined : endTime,
      description: description || undefined,
    },
  };
}

export function buildGoogleEventResource(input: GoogleCalendarEventInput): GoogleEventResource {
  const shared = {
    summary: input.title,
    ...(input.description ? { description: input.description } : {}),
    extendedProperties: { private: { jaceAiFitnessApp: "calendar" } },
  };
  if (input.allDay) {
    return {
      ...shared,
      start: { date: input.date },
      end: { date: addCalendarDays(input.date, 1) },
    };
  }
  return {
    ...shared,
    start: { dateTime: `${input.date}T${input.startTime}:00+09:00`, timeZone: GOOGLE_CALENDAR_TIME_ZONE },
    end: { dateTime: `${input.date}T${input.endTime}:00+09:00`, timeZone: GOOGLE_CALENDAR_TIME_ZONE },
  };
}

function formatDateInSeoul(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: GOOGLE_CALENDAR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function formatTimeInSeoul(value: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: GOOGLE_CALENDAR_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || "00";
  return `${pick("hour")}:${pick("minute")}`;
}

export function mapGoogleCalendarEvent(item: GoogleEventResource): GoogleCalendarEvent | null {
  if (!item.id || item.status === "cancelled" || !item.start) return null;
  const allDay = Boolean(item.start.date);
  const startValue = item.start.date || item.start.dateTime;
  if (!startValue) return null;
  const endValue = item.end?.dateTime;
  const startTime = allDay ? undefined : formatTimeInSeoul(startValue);
  const endTime = endValue ? formatTimeInSeoul(endValue) : undefined;
  return {
    id: item.id,
    title: item.summary?.trim() || "제목 없는 일정",
    date: allDay ? startValue.slice(0, 10) : formatDateInSeoul(startValue),
    startLabel: allDay ? "종일" : startTime || "",
    endLabel: endTime,
    startTime,
    endTime,
    allDay,
    htmlLink: item.htmlLink,
    description: item.description,
  };
}

export function isSameGoogleCalendarEvent(item: GoogleEventResource, input: GoogleCalendarEventInput) {
  if ((item.summary || "").trim().toLocaleLowerCase("ko-KR") !== input.title.trim().toLocaleLowerCase("ko-KR")) return false;
  if (input.allDay) return item.start?.date === input.date && item.end?.date === addCalendarDays(input.date, 1);
  if (!item.start?.dateTime || !item.end?.dateTime) return false;
  return new Date(item.start.dateTime).getTime() === new Date(`${input.date}T${input.startTime}:00+09:00`).getTime()
    && new Date(item.end.dateTime).getTime() === new Date(`${input.date}T${input.endTime}:00+09:00`).getTime();
}
