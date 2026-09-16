import { createHash } from "node:crypto";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { buildExampleAdviceContext, isFreeAdviceScope } from "@/lib/free-advice-context";
import { loadFreeAdviceContext } from "@/lib/free-advice-records";
import { FreeAdviceError, generateFreeAdvice } from "@/lib/free-advice";
import { FREE_GEMINI_MODEL, isFreeGeminiConfigured } from "@/lib/free-gemini-policy";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(request: Request) {
  try {
    const client = await createServerSupabaseClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return reply({ error: "로그인이 필요합니다." }, 401);
    if (Number(request.headers.get("content-length")) > 8000) return reply({ error: "질문이 너무 길어요." }, 413);
    const text = await request.text();
    if (text.length > 8000) return reply({ error: "질문이 너무 길어요." }, 413);
    const body = JSON.parse(text) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body) || !isFreeAdviceScope(body.scope) || (body.action !== "preview" && body.action !== "analyze")) return reply({ error: "분석할 분야를 확인해 주세요." }, 400);
    if (Object.keys(body).some(key => !["scope", "action", "question", "freeDataUseAcknowledged", "fingerprint", "recordSource"].includes(key))) return reply({ error: "지원하지 않는 요청 항목이 있어요." }, 400);
    if (body.recordSource !== undefined && body.recordSource !== "user-records" && body.recordSource !== "example") return reply({ error: "기록의 종류를 확인해 주세요." }, 400);
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (question.length > 500) return reply({ error: "질문은 500자 이내로 적어 주세요." }, 400);
    if (body.action === "analyze") {
      if (body.freeDataUseAcknowledged !== true) return reply({ error: "무료 AI의 자료 활용 안내를 먼저 확인해 주세요.", code: "FREE_ADVICE_ACK_REQUIRED" }, 400);
      if (!isFreeGeminiConfigured()) return reply({ error: "무료 AI 조언 연결을 준비 중이에요. 기본 기록과 통계를 이용해 주세요.", code: "FREE_ADVICE_NOT_CONFIGURED" }, 503);
    }
    let context;
    try { context = body.recordSource === "example" ? buildExampleAdviceContext(body.scope) : await loadFreeAdviceContext(client, user.id, body.scope); }
    catch { return reply({ error: "저장된 기록 전체를 확인하지 못했어요. 서버 저장 상태를 확인한 뒤 다시 불러와 주세요.", code: "FREE_ADVICE_RECORDS_UNAVAILABLE" }, 503); }
    const fingerprint = createHash("sha256").update(JSON.stringify(context)).digest("hex");
    if (body.action === "preview") return reply({ context, fingerprint, configured: isFreeGeminiConfigured() });
    if (body.fingerprint !== fingerprint) return reply({ error: "기록이 바뀌었어요. 최신 기록을 다시 확인한 뒤 조언을 요청해 주세요.", code: "FREE_ADVICE_RECORDS_CHANGED" }, 409);
    if (context.recordCount === 0) return reply({ error: "아직 분석할 기록이 없어요. 이 분야의 기록을 서버에 저장한 뒤 다시 이용해 주세요.", code: "FREE_ADVICE_NO_RECORDS" }, 422);
    const advice = await generateFreeAdvice({ context, question: question || "이 기록을 바탕으로 오늘 할 수 있는 행동을 조언해 줘.", acknowledged: true });
    return reply({ advice, context, source: "free-gemini", model: FREE_GEMINI_MODEL, generatedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof SyntaxError) return reply({ error: "요청 형식을 확인해 주세요." }, 400);
    if (error instanceof FreeAdviceError) return reply({ error: error.message, code: error.code }, error.status);
    return reply({ error: "조언을 준비하지 못했어요. 잠시 후 다시 이용해 주세요." }, 503);
  }
}
