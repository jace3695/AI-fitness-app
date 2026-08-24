import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

type AssistantReply = { reply: string; action?: { label: string; href: string }; changed?: boolean };

function seoulDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function won(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function taskTitle(message: string) {
  return message
    .replace(/^(오늘|내일)?\s*(할\s*일|일정)(에|로)?\s*/, "")
    .replace(/\s*(추가|등록|기록)(해\s*줘|해줘|해|해주세요|해요)?[.!?]?$/, "")
    .trim();
}

function parseState(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
}

async function generativeFallback(message: string): Promise<string> {
  if (!process.env.GEMINI_API_KEY) return "지금은 월 지출 조회, 오늘 할 일 조회·추가, 운동 계획 확인, 일본어 복습 시작을 도와드릴 수 있어요.";
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: "당신은 Jace AI Hub의 한국어 개인 비서입니다. 2~3문장으로 간결히 답하세요. 개인정보를 추측하지 말고, 현재 실행 가능한 기능은 월 지출 조회, 오늘 할 일 조회·추가, 운동 계획 확인, 일본어 복습 시작이라고 안내하세요." }] },
        contents: [{ role: "user", parts: [{ text: message }] }],
        generationConfig: { maxOutputTokens: 220 },
      }),
    });
    if (!response.ok) throw new Error("Gemini request failed");
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "요청을 이해하지 못했어요. 조금 다르게 말씀해 주세요.";
  } catch {
    return "요청을 이해하지 못했어요. 월 지출, 오늘 할 일, 운동 계획, 일본어 복습 중 하나로 말씀해 주세요.";
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => null) as { message?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 500) : "";
  if (!message) return NextResponse.json({ error: "명령을 입력해 주세요." }, { status: 400 });

  const today = seoulDate();
  const monthStart = `${today.slice(0, 7)}-01`;
  let result: AssistantReply;

  if (/(이번\s*달|월).*(지출|소비)|(지출|소비).*(이번\s*달|월)/.test(message)) {
    const { data, error } = await supabase.from("budget_transactions").select("amount,type,category").eq("user_id", user.id).eq("type", "expense").gte("date", monthStart).lte("date", today);
    if (error) return NextResponse.json({ error: "가계부 데이터를 불러오지 못했습니다." }, { status: 500 });
    const rows = data ?? [];
    const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const categories = rows.reduce<Record<string, number>>((acc, row) => { const key = row.category || "기타"; acc[key] = (acc[key] || 0) + Number(row.amount || 0); return acc; }, {});
    const top = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];
    result = { reply: `이번 달 지출은 ${won(total)}, 총 ${rows.length}건입니다.${top ? ` 가장 큰 항목은 ${top[0]} ${won(top[1])}이에요.` : ""}`, action: { label: "가계부 자세히 보기", href: "/budget" } };
  } else if (/(할\s*일|일정).*(추가|등록|기록)|(추가|등록|기록).*(할\s*일|일정)/.test(message)) {
    const title = taskTitle(message);
    if (!title || /^(추가|등록|기록)$/.test(title)) {
      result = { reply: "추가할 내용을 함께 말해 주세요. 예: ‘오늘 할 일에 우유 사기 추가해줘’" };
    } else {
      const dueDate = /내일/.test(message) ? seoulDate(1) : /오늘/.test(message) ? today : null;
      const dueAt = dueDate ? `${dueDate}T23:59:00+09:00` : null;
      const { error } = await supabase.from("assistant_items").insert({ user_id: user.id, title, kind: "task", status: "open", priority: 3, due_at: dueAt, source: "assistant_chat" });
      if (error) return NextResponse.json({ error: "할 일을 저장하지 못했습니다." }, { status: 500 });
      result = { reply: `‘${title}’을${dueDate ? ` ${/내일/.test(message) ? "내일" : "오늘"} 할 일로` : " 할 일에"} 추가했습니다.`, action: { label: "할 일 목록 보기", href: "#assistant-list" }, changed: true };
    }
  } else if (/(오늘).*(할\s*일|일정)|(할\s*일|일정).*(오늘)/.test(message)) {
    const start = `${today}T00:00:00+09:00`;
    const end = `${today}T23:59:59+09:00`;
    const { data, error } = await supabase.from("assistant_items").select("title").eq("user_id", user.id).neq("status", "completed").gte("due_at", start).lte("due_at", end).order("priority", { ascending: false }).limit(5);
    if (error) return NextResponse.json({ error: "할 일을 불러오지 못했습니다." }, { status: 500 });
    result = { reply: data?.length ? `오늘 할 일은 ${data.length}건입니다. ${data.map((item, index) => `${index + 1}. ${item.title}`).join(" · ")}` : "오늘 마감인 미완료 할 일이 없습니다.", action: { label: "할 일 목록 보기", href: "#assistant-list" } };
  } else if (/(운동).*(계획|일정|뭐|보여|알려)|(오늘).*(운동)/.test(message)) {
    const { data, error } = await supabase.from("user_app_state").select("state").eq("user_id", user.id).maybeSingle();
    if (error) return NextResponse.json({ error: "운동 데이터를 불러오지 못했습니다." }, { status: 500 });
    const state = parseState(data?.state);
    const selectedPlan = typeof state["ai-fitness-selected-weekly-workout-plan"] === "string" ? state["ai-fitness-selected-weekly-workout-plan"] : null;
    result = { reply: selectedPlan ? `오늘 운동 계획을 확인할 준비가 됐어요. 현재 선택된 주간 플랜은 ‘${selectedPlan}’입니다. 운동 앱에서 오늘의 세부 종목을 바로 확인하세요.` : "아직 선택된 주간 운동 플랜이 없습니다. 운동 앱에서 먼저 플랜을 선택해 주세요.", action: { label: "오늘 운동 보기", href: "/fitness" } };
  } else if (/(일본어|언어).*(복습|학습).*(시작|해|보여)|(복습).*(시작)/.test(message)) {
    result = { reply: "일본어 복습 화면을 준비했습니다. 아래 버튼을 눌러 바로 시작하세요.", action: { label: "일본어 복습 시작", href: "/language/review" } };
  } else {
    result = { reply: await generativeFallback(message) };
  }

  return NextResponse.json(result);
}
