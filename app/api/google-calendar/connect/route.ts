import { NextRequest, NextResponse } from "next/server";
import {
  GOOGLE_CALENDAR_OAUTH_COOKIE,
  GOOGLE_CALENDAR_OAUTH_MAX_AGE,
  createGoogleOAuthTransaction,
  getGoogleCalendarConfig,
} from "@/lib/google-calendar-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const authorization = request.headers.get("authorization");
  let supabaseAccessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!supabaseAccessToken) {
    const { data: { session } } = await supabase.auth.getSession();
    supabaseAccessToken = session?.access_token || "";
  }
  if (!supabaseAccessToken) return NextResponse.json({ error: "로그인 정보를 확인하지 못했습니다. 다시 로그인해주세요." }, { status: 401 });

  try {
    const config = getGoogleCalendarConfig(request.nextUrl.origin);
    const transaction = createGoogleOAuthTransaction(config, user.id, supabaseAccessToken);
    const response = NextResponse.json({ authorizationUrl: transaction.authorizationUrl }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(GOOGLE_CALENDAR_OAUTH_COOKIE, transaction.sealedSession, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: GOOGLE_CALENDAR_OAUTH_MAX_AGE,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Calendar 연결을 시작하지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
