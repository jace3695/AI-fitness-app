export type AiTextProvider = "google" | "openai";

export type AiTextFeature =
  | "assistant-fallback"
  | "budget-analysis"
  | "legacy-ai-analysis"
  | "fitness-post-workout-feedback"
  | "fitness-weekly-report"
  | "fitness-monthly-report"
  | "fitness-long-term-report"
  | "fitness-weekly-plan-proposal"
  | "fitness-program-review"
  | "language-conversation"
  | "handwriting-feedback";

export type AiRoutePolicy = {
  provider: AiTextProvider;
  model: string;
  maxOutputTokens: number;
  environmentVariable: "GEMINI_API_KEY" | "OPENAI_API_KEY";
};

const GEMINI_ECONOMY: AiRoutePolicy = {
  provider: "google",
  model: "gemini-2.5-flash-lite",
  maxOutputTokens: 2_000,
  environmentVariable: "GEMINI_API_KEY",
};

const GEMINI_COACH: AiRoutePolicy = {
  provider: "google",
  model: "gemini-3.7-flash",
  maxOutputTokens: 2_600,
  environmentVariable: "GEMINI_API_KEY",
};

const OPENAI_LANGUAGE: AiRoutePolicy = {
  provider: "openai",
  model: "gpt-4o-mini",
  maxOutputTokens: 600,
  environmentVariable: "OPENAI_API_KEY",
};

export const AI_ROUTE_POLICIES: Record<AiTextFeature, AiRoutePolicy> = {
  "assistant-fallback": GEMINI_ECONOMY,
  "budget-analysis": GEMINI_ECONOMY,
  "legacy-ai-analysis": GEMINI_ECONOMY,
  "fitness-post-workout-feedback": GEMINI_COACH,
  "fitness-weekly-report": GEMINI_COACH,
  "fitness-monthly-report": GEMINI_COACH,
  "fitness-long-term-report": GEMINI_COACH,
  "fitness-weekly-plan-proposal": GEMINI_COACH,
  "fitness-program-review": GEMINI_COACH,
  "language-conversation": OPENAI_LANGUAGE,
  "handwriting-feedback": OPENAI_LANGUAGE,
};

export function resolveAiRoute(feature: AiTextFeature): AiRoutePolicy {
  return AI_ROUTE_POLICIES[feature];
}

export function getEconomyFallbackRoute(route: AiRoutePolicy): AiRoutePolicy | null {
  return route.provider === "google" && route.model === GEMINI_COACH.model ? GEMINI_ECONOMY : null;
}

export function clampAiOutputTokens(feature: AiTextFeature, requested: number) {
  const policy = resolveAiRoute(feature);
  const normalized = Number.isFinite(requested) ? Math.round(requested) : policy.maxOutputTokens;
  return Math.min(Math.max(normalized, 1), policy.maxOutputTokens);
}
