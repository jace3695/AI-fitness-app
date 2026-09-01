type GeminiGenerationConfigInput = {
  model: string;
  responseFormat?: "text" | "json";
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens: number;
};

export type AiProviderFailureDetails = {
  code?: string;
  message?: string;
};

export type AiProviderResponseDiagnostics = {
  finishReason?: string;
  thoughtTokens: number;
  partCount: number;
  answerTextPartCount: number;
  thoughtTextPartCount: number;
};

export type GeminiResponseOutput = {
  text: string;
  inputTokens?: number;
  outputTokens: number;
  billableOutputTokens: number;
  diagnostics: AiProviderResponseDiagnostics;
};

function usesGeminiThreeThinking(model: string) {
  return /^gemini-3(?:\.|-|$)/i.test(model.trim());
}

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
    thinkingConfig: input.responseFormat === "json" && usesGeminiThreeThinking(input.model)
      ? { thinkingLevel: "low", includeThoughts: false }
      : undefined,
    temperature: input.temperature,
    maxOutputTokens: input.maxOutputTokens,
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function tokenCount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined;
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

export function extractGeminiResponse(data: unknown, responseFormat?: "text" | "json"): GeminiResponseOutput {
  const root = objectValue(data);
  const usage = objectValue(root.usageMetadata);
  const candidates = Array.isArray(root.candidates) ? root.candidates : [];
  const candidate = objectValue(candidates[0]);
  const content = objectValue(candidate.content);
  const parts = Array.isArray(content.parts) ? content.parts.map(objectValue) : [];
  const answerTextParts = parts
    .filter((part) => part.thought !== true && typeof part.text === "string")
    .map((part) => String(part.text));
  const thoughtTextPartCount = parts.filter((part) => part.thought === true && typeof part.text === "string").length;
  const outputTokens = tokenCount(usage.candidatesTokenCount) ?? 0;
  const thoughtTokens = tokenCount(usage.thoughtsTokenCount) ?? 0;

  return {
    text: answerTextParts.join(responseFormat === "json" ? "" : "\n"),
    inputTokens: tokenCount(usage.promptTokenCount),
    outputTokens,
    billableOutputTokens: outputTokens + thoughtTokens,
    diagnostics: {
      finishReason: safeProviderCode(candidate.finishReason),
      thoughtTokens,
      partCount: parts.length,
      answerTextPartCount: answerTextParts.length,
      thoughtTextPartCount,
    },
  };
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
