import { parseGoogleCalendarItems, type GoogleEventResource } from "./google-calendar.ts";

export const MAX_GOOGLE_CALENDAR_PAGES = 20;

export class GoogleCalendarReadError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

// Never publish a partial page as a complete (potentially empty) month. A
// pathological token chain fails explicitly instead of fetching without bound.
export async function readGoogleCalendarPages(
  firstResponse: Response,
  fetchPage: (pageToken: string) => Promise<Response>,
): Promise<GoogleEventResource[]> {
  let response = firstResponse;
  const items: GoogleEventResource[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_GOOGLE_CALENDAR_PAGES; page++) {
    if (!response.ok) throw new GoogleCalendarReadError("Google 일정을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.", response.status === 403 ? 403 : 502);
    const data: unknown = await response.json().catch(() => null);
    const batch = parseGoogleCalendarItems(data);
    if (batch === null) throw new GoogleCalendarReadError("Google 일정 응답을 확인하지 못했습니다. 다시 불러와 주세요.");
    items.push(...batch);
    const token = (data as Record<string, unknown>).nextPageToken;
    if (token === undefined) return items;
    if (typeof token !== "string" || !token.trim() || seen.has(token)) {
      throw new GoogleCalendarReadError("Google 일정의 다음 페이지를 확인하지 못했습니다. 다시 불러와 주세요.");
    }
    if (page === MAX_GOOGLE_CALENDAR_PAGES) {
      throw new GoogleCalendarReadError("Google 일정이 많아 전체 조회를 완료하지 못했습니다. Google Calendar에서 확인해 주세요.");
    }
    seen.add(token);
    response = await fetchPage(token);
  }
  throw new GoogleCalendarReadError("Google 일정 전체 조회를 완료하지 못했습니다.");
}
