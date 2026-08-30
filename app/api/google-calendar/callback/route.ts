import { NextRequest, NextResponse } from "next/server";
import {
  GOOGLE_CALENDAR_OAUTH_COOKIE,
  encryptGoogleToken,
  exchangeGoogleAuthorizationCode,
  getGoogleAccountEmail,
  getGoogleCalendarConfig,
  openGoogleOAuthSession,
} from "@/lib/google-calendar-server";
import { createServerSupabaseClientWithAccessToken } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

function calendarRedirect(request: NextRequest, result: "connected" | "error") {
  const url = new URL("/calendar", request.nextUrl.origin);
  url.searchParams.set("google", result);
  return url;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const cookie = request.cookies.get(GOOGLE_CALENDAR_OAUTH_COOKIE)?.value;
  let response: NextResponse;

  try {
    const config = getGoogleCalendarConfig(request.nextUrl.origin);
    if (!code || !state || !cookie) throw new Error("Google 연결 요청이 완전하지 않습니다.");
    const oauthSession = openGoogleOAuthSession(cookie, config.clientSecret);
    if (oauthSession.state !== state) throw new Error("Google 연결 요청을 확인하지 못했습니다.");

    const supabase = createServerSupabaseClientWithAccessToken(oauthSession.supabaseAccessToken);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user || user.id !== oauthSession.userId) throw new Error("로그인이 만료되었습니다. 다시 로그인해주세요.");

    const tokens = await exchangeGoogleAuthorizationCode(config, code, oauthSession.verifier);
    const { data: existing } = await supabase
      .from("google_calendar_connections")
      .select("refresh_token_ciphertext")
      .eq("user_id", user.id)
      .maybeSingle();
    const refreshTokenCiphertext = tokens.refreshToken
      ? encryptGoogleToken(tokens.refreshToken, config.clientSecret)
      : existing?.refresh_token_ciphertext;
    if (!refreshTokenCiphertext) throw new Error("Google의 장기 연결 권한을 받지 못했습니다. 다시 연결해주세요.");

    const now = new Date().toISOString();
    const { error: saveError } = await supabase.from("google_calendar_connections").upsert({
      user_id: user.id,
      google_email: await getGoogleAccountEmail(tokens.accessToken),
      calendar_id: "primary",
      access_token_ciphertext: encryptGoogleToken(tokens.accessToken, config.clientSecret),
      refresh_token_ciphertext: refreshTokenCiphertext,
      token_expires_at: new Date(Date.now() + tokens.expiresIn * 1_000).toISOString(),
      scope: tokens.scope,
      connected_at: now,
      updated_at: now,
    }, { onConflict: "user_id" });
    if (saveError) throw new Error("Google Calendar 연결을 저장하지 못했습니다.");

    response = NextResponse.redirect(calendarRedirect(request, "connected"));
  } catch {
    response = NextResponse.redirect(calendarRedirect(request, "error"));
  }
  response.cookies.set(GOOGLE_CALENDAR_OAUTH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
