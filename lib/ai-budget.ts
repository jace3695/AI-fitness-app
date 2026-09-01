import type { SupabaseClient } from "@supabase/supabase-js";

export const AI_MONTHLY_LIMIT_KRW = 10_000;
export const AI_BUDGET_THRESHOLDS = [70, 85, 95] as const;
export const AI_BUDGET_NOTICE_THRESHOLD = 70;
export const AI_BUDGET_HIGH_PERFORMANCE_THRESHOLD = 85;
export const AI_BUDGET_PAID_STOP_THRESHOLD = 95;
const USD_TO_KRW = 1_500;

export type AiProvider = "google" | "openai";
export type AiUsageKind = "tokens" | "characters";
export type AiBudgetRestriction = "high_performance_limited" | "paid_ai_paused" | "monthly_limit";
export type AiBudgetStatus = "normal" | "notice" | "high_performance_limited" | "paid_ai_paused";

export type AiUsageAppId = "assistant" | "fitness" | "budget" | "language" | "other";
export type AiUsageByApp = {
  id: AiUsageAppId;
  label: string;
  spentKrw: number;
  usageCount: number;
};

type AiUsageEventRow = { cost_krw?: unknown; feature?: unknown };

type TokenPricing = { inputUsdPerMillion: number; outputUsdPerMillion: number };

const TOKEN_PRICING: Record<string, TokenPricing> = {
  "gemini-2.5-flash-lite": { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4 },
  "gemini-3.7-flash": { inputUsdPerMillion: 0.75, outputUsdPerMillion: 3.75 },
  "gpt-4o-mini": { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.6 },
};

const AI_USAGE_APP_LABELS: Record<AiUsageAppId, string> = {
  assistant: "AI 비서",
  fitness: "운동",
  budget: "가계부",
  language: "언어 학습",
  other: "기타 기능",
};

const BUDGET_RESTRICTION_MESSAGES: Record<AiBudgetRestriction, string> = {
  high_performance_limited: "이번 달 AI 비용이 85%에 도달해 고성능 AI는 절약 모드로 전환됩니다.",
  paid_ai_paused: "이번 달 AI 비용이 95%에 도달해 유료 AI 호출을 멈췄습니다. 다음 달에 자동으로 다시 사용할 수 있습니다.",
  monthly_limit: "이번 달 AI 사용 한도 10,000원에 도달했어요. 다음 달에 자동으로 다시 사용할 수 있습니다.",
};

export class AiBudgetExceededError extends Error {
  restriction: AiBudgetRestriction;

  constructor(restriction: AiBudgetRestriction = "monthly_limit") {
    super(BUDGET_RESTRICTION_MESSAGES[restriction]);
    this.name = "AiBudgetExceededError";
    this.restriction = restriction;
  }
}

function normalizeAiBudgetRestriction(value: unknown): AiBudgetRestriction | null {
  return value === "high_performance_limited" || value === "paid_ai_paused" || value === "monthly_limit"
    ? value
    : null;
}

export function getAiBudgetStatus(percentage: number): AiBudgetStatus {
  if (percentage >= AI_BUDGET_PAID_STOP_THRESHOLD) return "paid_ai_paused";
  if (percentage >= AI_BUDGET_HIGH_PERFORMANCE_THRESHOLD) return "high_performance_limited";
  if (percentage >= AI_BUDGET_NOTICE_THRESHOLD) return "notice";
  return "normal";
}

export function getAiUsageAppId(feature: unknown): AiUsageAppId {
  const normalized = typeof feature === "string" ? feature.trim().toLowerCase() : "";
  if (normalized.startsWith("fitness-")) return "fitness";
  if (normalized === "budget-analysis" || normalized === "legacy-ai-analysis") return "budget";
  if (normalized.startsWith("language-") || normalized === "handwriting-feedback" || normalized === "japanese-tts") return "language";
  if (normalized.startsWith("assistant-") || normalized === "korean-tts") return "assistant";
  return "other";
}

export function buildAiBudgetSummary(events: AiUsageEventRow[]) {
  const buckets = (Object.keys(AI_USAGE_APP_LABELS) as AiUsageAppId[]).reduce((result, id) => {
    result[id] = { id, label: AI_USAGE_APP_LABELS[id], spentKrw: 0, usageCount: 0 };
    return result;
  }, {} as Record<AiUsageAppId, AiUsageByApp>);

  for (const event of events) {
    const cost = Number(event.cost_krw ?? 0);
    if (!Number.isFinite(cost) || cost < 0) continue;
    const bucket = buckets[getAiUsageAppId(event.feature)];
    bucket.spentKrw += cost;
    bucket.usageCount += 1;
  }

  const spentKrw = Number(Object.values(buckets).reduce((sum, bucket) => sum + bucket.spentKrw, 0).toFixed(2));
  const percentage = Math.min(100, Number(((spentKrw / AI_MONTHLY_LIMIT_KRW) * 100).toFixed(1)));
  const reachedThreshold = [...AI_BUDGET_THRESHOLDS].reverse().find((value) => percentage >= value) ?? 0;
  const apps = Object.values(buckets)
    .filter((bucket) => bucket.usageCount > 0)
    .map((bucket) => ({ ...bucket, spentKrw: Number(bucket.spentKrw.toFixed(2)) }))
    .sort((a, b) => b.spentKrw - a.spentKrw || b.usageCount - a.usageCount);

  return {
    limitKrw: AI_MONTHLY_LIMIT_KRW,
    spentKrw,
    remainingKrw: Math.max(0, Number((AI_MONTHLY_LIMIT_KRW - spentKrw).toFixed(2))),
    percentage,
    reachedThreshold,
    status: getAiBudgetStatus(percentage),
    apps,
  };
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
  if (!row?.reservation_id) throw new AiBudgetExceededError(normalizeAiBudgetRestriction(row?.restriction_reason) ?? "monthly_limit");
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
    .select("cost_krw, feature")
    .eq("user_id", userId)
    .gte("created_at", monthStart.toISOString());
  if (error) throw new Error(`AI 사용량을 확인하지 못했습니다: ${error.message}`);
  return buildAiBudgetSummary(data ?? []);
}
