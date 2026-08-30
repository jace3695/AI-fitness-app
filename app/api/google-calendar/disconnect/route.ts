import { NextRequest, NextResponse } from "next/server";
import { decryptGoogleToken, getGoogleCalendarConfig } from "@/lib/google-calendar-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { data } = await supabase
    .from("google_calendar_connections")
    .select("access_token_ciphertext,refresh_token_ciphertext")
    .eq("user_id", user.id)
    .maybeSingle();
  try {
    const config = getGoogleCalendarConfig(request.nextUrl.origin);
    const encryptedToken = data?.refresh_token_ciphertext || data?.access_token_ciphertext;
    if (encryptedToken) {
      const token = decryptGoogleToken(encryptedToken, config.clientSecret);
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
        cache: "no-store",
      }).catch(() => null);
    }
  } catch {
    // Local removal must still succeed if Google has already revoked the token.
  }
  const { error } = await supabase.from("google_calendar_connections").delete().eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Google Calendar 연결을 해제하지 못했습니다." }, { status: 500 });
  return NextResponse.json({ disconnected: true });
}
