import { NextResponse } from "next/server";
import { isGoogleCalendarConfigured } from "@/lib/google-calendar-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  if (!isGoogleCalendarConfigured()) {
    return NextResponse.json({ configured: false, connected: false }, { headers: { "Cache-Control": "no-store" } });
  }
  const { data, error } = await supabase
    .from("google_calendar_connections")
    .select("google_email,connected_at,updated_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Google Calendar 연결 상태를 확인하지 못했습니다." }, { status: 500 });
  return NextResponse.json({
    configured: true,
    connected: Boolean(data),
    email: data?.google_email || null,
    updatedAt: data?.updated_at || null,
  }, { headers: { "Cache-Control": "no-store" } });
}
