import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cancelAiBudgetReservation,
  conservativeTokenEstimate,
  finalizeAiUsage,
  reserveAiBudget,
  tokenCostKrw,
} from "@/lib/ai-budget";
import {
  clampAiOutputTokens,
  resolveAiRoute,
  type AiTextFeature,
} from "@/lib/ai-router-policy";

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
  systemInstruction?: string;
  geminiContents?: GeminiContent[];
  openAiMessages?: OpenAiMessage[];
};

export type AiTextResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  provider: "google" | "openai";
  model: string;
};

export class AiRouterConfigurationError extends Error {
  constructor(environmentVariable: string) {
    super(`${environmentVariable}가 설정되어 있지 않습니다.`);
    this.name = "AiRouterConfigurationError";
  }
}

export class AiProviderRequestError extends Error {
  provider: "google" | "openai";
  status: number;

  constructor(provider: "google" | "openai", status: number) {
    super(`${provider} AI 요청에 실패했습니다. (${status})`);
    this.name = "AiProviderRequestError";
    this.provider = provider;
    this.status = status;
  }
}

export function isAiFeatureAvailable(feature: AiTextFeature) {
  const route = resolveAiRoute(feature);
  return Boolean(process.env[route.environmentVariable]);
}

export async function generateAiText(input: GenerateAiTextInput): Promise<AiTextResult> {
  const route = resolveAiRoute(input.feature);
  const apiKey = process.env[route.environmentVariable];
  if (!apiKey) throw new AiRouterConfigurationError(route.environmentVariable);

  const maxOutputTokens = clampAiOutputTokens(input.feature, input.maxOutputTokens);
  const reservation = await reserveAiBudget(input.supabase, input.userId, {
    provider: route.provider,
    model: route.model,
    feature: input.feature,
    estimatedCostKrw: conservativeTokenEstimate(input.promptText, maxOutputTokens, route.model),
  });

  try {
    const response = route.provider === "google"
      ? await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${route.model}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: input.systemInstruction ? { parts: [{ text: input.systemInstruction }] } : undefined,
            contents: input.geminiContents ?? [{ role: "user", parts: [{ text: input.promptText }] }],
            generationConfig: {
              responseMimeType: input.responseFormat === "json" ? "application/json" : undefined,
              temperature: input.temperature,
              maxOutputTokens,
            },
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

    if (!response.ok) throw new AiProviderRequestError(route.provider, response.status);
    const data = await response.json();
    const inputTokens = Number(
      route.provider === "google"
        ? data?.usageMetadata?.promptTokenCount ?? input.promptText.length
        : data?.usage?.prompt_tokens ?? input.promptText.length,
    );
    const outputTokens = Number(
      route.provider === "google"
        ? data?.usageMetadata?.candidatesTokenCount ?? 0
        : data?.usage?.completion_tokens ?? 0,
    );
    const text = route.provider === "google"
      ? String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "")
      : String(data?.choices?.[0]?.message?.content ?? "");

    await finalizeAiUsage(input.supabase, reservation.id, {
      inputUnits: inputTokens,
      outputUnits: outputTokens,
      actualCostKrw: tokenCostKrw(route.model, inputTokens, outputTokens),
    });
    return { text, inputTokens, outputTokens, provider: route.provider, model: route.model };
  } catch (error) {
    await cancelAiBudgetReservation(input.supabase, reservation.id);
    throw error;
  }
}
