type GeminiGenerationConfigInput = {
  responseFormat?: "text" | "json";
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens: number;
};

export type AiProviderFailureDetails = {
  code?: string;
  message?: string;
};

export function buildGeminiGenerationConfig(input: GeminiGenerationConfigInput) {
  return {
    responseFormat: input.responseFormat === "json"
      ? {
          text: {
            mimeType: "APPLICATION_JSON",
            ...(input.jsonSchema ? { schema: input.jsonSchema } : {}),
          },
        }
      : undefined,
    temperature: input.temperature,
    maxOutputTokens: input.maxOutputTokens,
  };
}

function safeProviderCode(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9_.:-]{1,64}$/.test(normalized) ? normalized : undefined;
}

function safeProviderMessage(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .replace(/([?&](?:key|api_key|token)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\bAIza[A-Za-z0-9_-]{15,}\b/g, "[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi, "Bearer [redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, 240) : undefined;
}

export async function readAiProviderFailure(response: Response): Promise<AiProviderFailureDetails> {
  const body = await response.text().catch(() => "");
  if (!body) return {};

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const error = parsed.error && typeof parsed.error === "object" && !Array.isArray(parsed.error)
      ? parsed.error as Record<string, unknown>
      : parsed;
    return {
      code: safeProviderCode(error.status),
      message: safeProviderMessage(error.message),
    };
  } catch {
    // Provider HTML/plain-text bodies can contain request details. Do not log them.
    return {};
  }
}
