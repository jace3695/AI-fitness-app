import { NextRequest, NextResponse } from "next/server";
import {
  buildGoogleEventResource,
  getCalendarMonthBounds,
  isSameGoogleCalendarEvent,
  mapGoogleCalendarEvent,
  parseGoogleCalendarEventInput,
  type GoogleEventResource,
} from "@/lib/google-calendar";
import {
  GoogleCalendarConnectionError,
  getGoogleCalendarConfig,
  googleCalendarApiRequest,
} from "@/lib/google-calendar-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

async function authenticate() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return { supabase, user: error ? null : user };
}

function errorResponse(error: unknown) {
  if (error instanceof GoogleCalendarConnectionError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Error && (error.message.includes("날짜") || error.message.includes("월을 선택"))) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: "Google Calendar 요청을 처리하지 못했습니다." }, { status: 500 });
}

async function googleRequest(
  request: NextRequest,
  method: string,
  path: string,
  body?: GoogleEventResource,
) {
  const { supabase, user } = await authenticate();
  if (!user) return { response: NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 }) };
  const config = getGoogleCalendarConfig(request.nextUrl.origin);
  const response = await googleCalendarApiRequest(supabase, user.id, config.clientSecret, path, {
    method,
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  return { response, supabase, user, config };
}

async function readGoogleItems(response: Response) {
  const data = await response.json().catch(() => ({})) as { items?: GoogleEventResource[]; error?: unknown };
  if (!response.ok) throw new GoogleCalendarConnectionError("Google 일정을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.", response.status === 403 ? 403 : 502);
  return Array.isArray(data.items) ? data.items : [];
}

export async function GET(request: NextRequest) {
  try {
    const month = request.nextUrl.searchParams.get("month") || "";
    const { timeMin, timeMax } = getCalendarMonthBounds(month);
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
      timeZone: "Asia/Seoul",
    });
    const result = await googleRequest(request, "GET", `/calendars/primary/events?${params}`);
    if (result.response instanceof NextResponse) return result.response;
    const items = await readGoogleItems(result.response);
    return NextResponse.json({ events: items.map(mapGoogleCalendarEvent).filter(Boolean) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  if (Number(request.headers.get("content-length") || 0) > 20_000) return NextResponse.json({ error: "요청 내용이 너무 깁니다." }, { status: 413 });
  try {
    const parsed = parseGoogleCalendarEventInput(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const input = parsed.value;
    const dayEnd = new Date(`${input.date}T00:00:00+09:00`);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    const duplicateParams = new URLSearchParams({
      timeMin: `${input.date}T00:00:00+09:00`,
      timeMax: dayEnd.toISOString(),
      singleEvents: "true",
      maxResults: "250",
    });
    const existing = await googleRequest(request, "GET", `/calendars/primary/events?${duplicateParams}`);
    if (existing.response instanceof NextResponse) return existing.response;
    const duplicate = (await readGoogleItems(existing.response)).find((item) => isSameGoogleCalendarEvent(item, input));
    if (duplicate) {
      return NextResponse.json({ event: mapGoogleCalendarEvent(duplicate), duplicate: true });
    }

    const inserted = await googleRequest(request, "POST", "/calendars/primary/events?sendUpdates=none", buildGoogleEventResource(input));
    if (inserted.response instanceof NextResponse) return inserted.response;
    const data = await inserted.response.json().catch(() => ({})) as GoogleEventResource;
    if (!inserted.response.ok) throw new GoogleCalendarConnectionError("Google 일정을 추가하지 못했습니다.", 502);
    return NextResponse.json({ event: mapGoogleCalendarEvent(data), duplicate: false }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  if (Number(request.headers.get("content-length") || 0) > 20_000) return NextResponse.json({ error: "요청 내용이 너무 깁니다." }, { status: 413 });
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const id = typeof body?.id === "string" ? body.id : "";
    if (!id || id.length > 1_024) return NextResponse.json({ error: "수정할 일정을 선택해주세요." }, { status: 400 });
    const parsed = parseGoogleCalendarEventInput(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const updated = await googleRequest(request, "PATCH", `/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=none`, buildGoogleEventResource(parsed.value));
    if (updated.response instanceof NextResponse) return updated.response;
    const data = await updated.response.json().catch(() => ({})) as GoogleEventResource;
    if (!updated.response.ok) throw new GoogleCalendarConnectionError("Google 일정을 수정하지 못했습니다.", 502);
    return NextResponse.json({ event: mapGoogleCalendarEvent(data) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id") || "";
    if (!id || id.length > 1_024) return NextResponse.json({ error: "삭제할 일정을 선택해주세요." }, { status: 400 });
    const deleted = await googleRequest(request, "DELETE", `/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=none`);
    if (deleted.response instanceof NextResponse) return deleted.response;
    if (!deleted.response.ok && deleted.response.status !== 410) throw new GoogleCalendarConnectionError("Google 일정을 삭제하지 못했습니다.", 502);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
