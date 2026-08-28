import type { SupabaseClient } from "@supabase/supabase-js";

export const AI_MONTHLY_LIMIT_KRW = 10_000;
export const AI_BUDGET_THRESHOLDS = [50, 80, 100] as const;
const USD_TO_KRW = 1_500;

export type AiProvider = "google" | "openai";
export type AiUsageKind = "tokens" | "characters";

type TokenPricing = { inputUsdPerMillion: number; outputUsdPerMillion: number };

const TOKEN_PRICING: Record<string, TokenPricing> = {
  "gemini-2.5-flash-lite": { inputUsdPerMillion: 0.05, outputUsdPerMillion: 0.2 },
  "gpt-4o-mini": { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.6 },
};

export class AiBudgetExceededError extends Error {
  constructor() {
    super("이번 달 AI 사용 한도 10,000원에 도달했어요. 다음 달에 자동으로 다시 사용할 수 있습니다.");
    this.name = "AiBudgetExceededError";
  }
}

export function tokenCostKrw(model: string, inputTokens: number, outputTokens: number) {
  const pricing = TOKEN_PRICING[model];
  if (!pricing) throw new Error(`AI 가격 정보가 없는 모델입니다: ${model}`);
  const usd = (Math.max(0, inputTokens) * pricing.inputUsdPerMillion + Math.max(0, outputTokens) * pricing.outputUsdPerMillion) / 1_000_000;
  return Math.max(0.01, Number((usd * USD_TO_KRW).toFixed(4)));
}

export function ttsCostKrw(characters: number) {
  return Math.max(0.01, Number((Math.max(0, characters) * 0.00003 * USD_TO_KRW).toFixed(4)));
}

export function standardTtsCostKrw(characters: number) {
  return Math.max(0.01, Number((Math.max(0, characters) * 0.000004 * USD_TO_KRW).toFixed(4)));
}

export function conservativeTokenEstimate(text: string, maxOutputTokens: number, model: string) {
  const inputTokens = Math.max(1, text.length);
  return tokenCostKrw(model, inputTokens, maxOutputTokens);
}

export type AiBudgetReservation = { id: string; spentKrw: number; remainingKrw: number };

export async function reserveAiBudget(
  supabase: SupabaseClient,
  userId: string,
  details: { provider: AiProvider; model: string; feature: string; estimatedCostKrw: number; usageKind?: AiUsageKind },
): Promise<AiBudgetReservation> {
  const { data, error } = await supabase.functions.invoke("ai-budget", { body: { action: "reserve", userId, provider: details.provider, model: details.model, feature: details.feature, estimatedCostKrw: Math.max(0.01, details.estimatedCostKrw), usageKind: details.usageKind ?? "tokens" } });
  if (error) throw new Error(`AI 비용 한도를 확인하지 못했습니다: ${error.message}`);
  const row = data;
  if (!row?.reservation_id) throw new AiBudgetExceededError();
  return {
    id: String(row.reservation_id),
    spentKrw: Number(row.spent_krw ?? 0),
    remainingKrw: Number(row.remaining_krw ?? 0),
  };
}

export async function finalizeAiUsage(
  supabase: SupabaseClient,
  reservationId: string,
  usage: { inputUnits: number; outputUnits?: number; actualCostKrw: number },
) {
  const { error } = await supabase.functions.invoke("ai-budget", { body: { action: "finalize", reservationId, inputUnits: Math.max(0, Math.round(usage.inputUnits)), outputUnits: Math.max(0, Math.round(usage.outputUnits ?? 0)), actualCostKrw: Math.max(0.01, usage.actualCostKrw) } });
  if (error) console.error("AI 사용량 기록 실패", { message: error.message });
}

export async function cancelAiBudgetReservation(supabase: SupabaseClient, reservationId: string) {
  const { error } = await supabase.functions.invoke("ai-budget", { body: { action: "cancel", reservationId } });
  if (error) console.error("AI 비용 예약 취소 실패", { message: error.message });
}

export async function getAiBudgetSummary(supabase: SupabaseClient, userId: string) {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { data, error } = await supabase
    .from("ai_usage_events")
    .select("cost_krw")
    .eq("user_id", userId)
    .gte("created_at", monthStart.toISOString());
  if (error) throw new Error(`AI 사용량을 확인하지 못했습니다: ${error.message}`);
  const spentKrw = Number((data ?? []).reduce((sum, row) => sum + Number(row.cost_krw ?? 0), 0).toFixed(2));
  const percentage = Math.min(100, Number(((spentKrw / AI_MONTHLY_LIMIT_KRW) * 100).toFixed(1)));
  const reachedThreshold = [...AI_BUDGET_THRESHOLDS].reverse().find((value) => percentage >= value) ?? 0;
  return { limitKrw: AI_MONTHLY_LIMIT_KRW, spentKrw, remainingKrw: Math.max(0, Number((AI_MONTHLY_LIMIT_KRW - spentKrw).toFixed(2))), percentage, reachedThreshold };
}
