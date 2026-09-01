import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AiBudgetExceededError,
  cancelAiBudgetReservation,
  conservativeTokenEstimate,
  finalizeAiUsage,
  reserveAiBudget,
  tokenCostKrw,
} from "@/lib/ai-budget";
import {
  clampAiOutputTokens,
  getEconomyFallbackRoute,
  resolveAiRoute,
  type AiTextFeature,
} from "@/lib/ai-router-policy";
import {
  buildGeminiGenerationConfig,
  extractGeminiResponse,
  readAiProviderFailure,
  type AiProviderFailureDetails,
  type AiProviderResponseDiagnostics,
} from "@/lib/ai-provider-protocol";

type GeminiContent = {
  role?: "user" | "model";
  parts: Array<{ text: string }>;
};

type OpenAiTextContent = { type: "text"; text: string };
type OpenAiImageContent = { type: "image_url"; image_url: { url: string } };
export type OpenAiMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<OpenAiTextContent | OpenAiImageContent>;
};

type GenerateAiTextInput = {
  supabase: SupabaseClient;
  userId: string;
  feature: AiTextFeature;
  promptText: string;
  maxOutputTokens: number;
  temperature?: number;
  responseFormat?: "text" | "json";
  jsonSchema?: Record<string, unknown>;
  systemInstruction?: string;
  geminiContents?: GeminiContent[];
  openAiMessages?: OpenAiMessage[];
};

export type AiTextResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  billableOutputTokens: number;
  diagnostics: AiProviderResponseDiagnostics;
  provider: "google" | "openai";
  model: string;
  budgetMode: "standard" | "economy";
};

export class AiRouterConfigurationError extends Error {
  constructor(environmentVariable: string) {
    super(`${environmentVariable}가 설정되어 있지 않습니다.`);
    this.name = "AiRouterConfigurationError";
  }
}

export class AiProviderRequestError extends Error {
  provider: "google" | "openai";
  model: string;
  status: number;
  providerCode?: string;
  providerMessage?: string;

  constructor(provider: "google" | "openai", model: string, status: number, details: AiProviderFailureDetails = {}) {
    super(`${provider} AI 요청에 실패했습니다. (${status})`);
    this.name = "AiProviderRequestError";
    this.provider = provider;
    this.model = model;
    this.status = status;
    this.providerCode = details.code;
    this.providerMessage = details.message;
  }
}

export function isAiFeatureAvailable(feature: AiTextFeature) {
  const route = resolveAiRoute(feature);
  return Boolean(process.env[route.environmentVariable]);
}

export async function generateAiText(input: GenerateAiTextInput): Promise<AiTextResult> {
  const primaryRoute = resolveAiRoute(input.feature);
  const apiKey = process.env[primaryRoute.environmentVariable];
  if (!apiKey) throw new AiRouterConfigurationError(primaryRoute.environmentVariable);

  let route = primaryRoute;
  let maxOutputTokens = clampAiOutputTokens(input.feature, input.maxOutputTokens);
  let budgetMode: AiTextResult["budgetMode"] = "standard";
  let reservation: Awaited<ReturnType<typeof reserveAiBudget>> | undefined;

  const reserve = async () => {
    reservation = await reserveAiBudget(input.supabase, input.userId, {
      provider: route.provider,
      model: route.model,
      feature: input.feature,
      estimatedCostKrw: conservativeTokenEstimate(input.promptText, maxOutputTokens, route.model),
    });
  };

  try {
    try {
      await reserve();
    } catch (error) {
      const fallbackRoute = error instanceof AiBudgetExceededError && error.restriction === "high_performance_limited"
        ? getEconomyFallbackRoute(primaryRoute)
        : null;
      if (!fallbackRoute) throw error;
      route = fallbackRoute;
      maxOutputTokens = Math.min(maxOutputTokens, fallbackRoute.maxOutputTokens);
      budgetMode = "economy";
      await reserve();
    }
    if (!reservation) throw new Error("AI 비용 예약을 만들지 못했습니다.");

    const response = route.provider === "google"
      ? await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${route.model}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: input.systemInstruction ? { parts: [{ text: input.systemInstruction }] } : undefined,
            contents: input.geminiContents ?? [{ role: "user", parts: [{ text: input.promptText }] }],
            generationConfig: buildGeminiGenerationConfig({
              model: route.model,
              responseFormat: input.responseFormat,
              jsonSchema: input.jsonSchema,
              temperature: input.temperature,
              maxOutputTokens,
            }),
          }),
        })
      : await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: route.model,
            messages: input.openAiMessages ?? [
              ...(input.systemInstruction ? [{ role: "system" as const, content: input.systemInstruction }] : []),
              { role: "user" as const, content: input.promptText },
            ],
            response_format: input.responseFormat === "json" ? { type: "json_object" } : undefined,
            temperature: input.temperature,
            max_tokens: maxOutputTokens,
          }),
        });

    if (!response.ok) {
      const details = await readAiProviderFailure(response);
      throw new AiProviderRequestError(route.provider, route.model, response.status, details);
    }
    const data = await response.json();
    const geminiOutput = route.provider === "google" ? extractGeminiResponse(data, input.responseFormat) : undefined;
    const inputTokens = geminiOutput?.inputTokens ?? Number(data?.usage?.prompt_tokens ?? input.promptText.length);
    const outputTokens = geminiOutput?.outputTokens ?? Number(data?.usage?.completion_tokens ?? 0);
    const billableOutputTokens = geminiOutput?.billableOutputTokens ?? outputTokens;
    const text = geminiOutput?.text ?? String(data?.choices?.[0]?.message?.content ?? "");
    const openAiFinishReason = typeof data?.choices?.[0]?.finish_reason === "string"
      ? String(data.choices[0].finish_reason).trim().toUpperCase().slice(0, 64)
      : undefined;
    const diagnostics = geminiOutput?.diagnostics ?? {
      finishReason: openAiFinishReason,
      thoughtTokens: 0,
      partCount: text ? 1 : 0,
      answerTextPartCount: text ? 1 : 0,
      thoughtTextPartCount: 0,
    };

    await finalizeAiUsage(input.supabase, reservation.id, {
      inputUnits: inputTokens,
      outputUnits: billableOutputTokens,
      actualCostKrw: tokenCostKrw(route.model, inputTokens, billableOutputTokens),
    });
    return { text, inputTokens, outputTokens, billableOutputTokens, diagnostics, provider: route.provider, model: route.model, budgetMode };
  } catch (error) {
    if (reservation) await cancelAiBudgetReservation(input.supabase, reservation.id);
    throw error;
  }
}
