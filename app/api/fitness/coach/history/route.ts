import { NextRequest, NextResponse } from "next/server";
import {
  normalizeFitnessAiReviewRecord,
  normalizeWorkoutOutcomeBaseline,
  type FitnessAiPlanDecision,
} from "@/app/data/fitnessAiReviewHistory";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const DECISIONS: FitnessAiPlanDecision[] = ["applied", "partial", "kept"];
const DAY_IDS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

function safeSelection(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return {
    dayIds: Array.isArray(record.dayIds)
      ? record.dayIds
          .filter((item): item is string => typeof item === "string" && DAY_IDS.has(item))
          .slice(0, 7)
      : [],
    exerciseNames: Array.isArray(record.exerciseNames)
      ? record.exerciseNames
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim().slice(0, 120))
          .filter(Boolean)
          .slice(0, 20)
      : [],
  };
}

async function authenticatedUser() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET() {
  const { supabase, user } = await authenticatedUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { data, error } = await supabase
    .from("fitness_ai_review_history")
    .select("id,analysis_type,analysis_label,source,result_summary,baseline_7d,baseline_28d,decision,decision_selection,decided_at,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("Fitness AI review history load failed", { code: error.code });
    return NextResponse.json({ error: "AI 점검 기록을 불러오지 못했습니다." }, { status: 503 });
  }
  const reviews = (data ?? []).flatMap((row) => {
    const review = normalizeFitnessAiReviewRecord(row);
    return review ? [review] : [];
  });
  return NextResponse.json({ reviews }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 12_000) return NextResponse.json({ error: "선택 기록이 너무 큽니다." }, { status: 413 });
  const { supabase, user } = await authenticatedUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const decision = typeof body?.decision === "string" ? body.decision : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "저장할 AI 점검 기록이 올바르지 않습니다." }, { status: 400 });
  }
  if (!DECISIONS.includes(decision as FitnessAiPlanDecision)) {
    return NextResponse.json({ error: "계획 선택이 올바르지 않습니다." }, { status: 400 });
  }
  const baseline = normalizeWorkoutOutcomeBaseline(body.outcomeBaseline);
  const { data, error } = await supabase
    .from("fitness_ai_review_history")
    .update({
      baseline_7d: baseline.oneWeek,
      baseline_28d: baseline.fourWeeks,
      decision,
      decision_selection: safeSelection(body.selection),
      decided_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("id", id)
    .select("id,analysis_type,analysis_label,source,result_summary,baseline_7d,baseline_28d,decision,decision_selection,decided_at,created_at")
    .maybeSingle();
  if (error) {
    console.error("Fitness AI review decision save failed", { code: error.code });
    return NextResponse.json({ error: "계획 선택을 클라우드에 저장하지 못했습니다." }, { status: 503 });
  }
  const review = normalizeFitnessAiReviewRecord(data);
  if (!review) return NextResponse.json({ error: "AI 점검 기록을 찾지 못했습니다." }, { status: 404 });
  return NextResponse.json({ review });
}
