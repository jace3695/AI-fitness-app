import { NextResponse } from "next/server";
import { getAiBudgetSummary } from "@/lib/ai-budget";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  return NextResponse.json(await getAiBudgetSummary(supabase, user.id), { headers: { "Cache-Control": "no-store" } });
}
