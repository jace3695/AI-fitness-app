import {
  isSupportedDietPhotoDataUrl,
  parseDietPhotoAnalysisText,
  type DietPhotoMealSlot,
} from "../app/data/dietPhotoAnalysis.ts";
import { buildGeminiGenerationConfig, extractGeminiResponse, readAiProviderFailure } from "./ai-provider-protocol.ts";

export const FREE_DIET_PHOTO_MODEL = "gemini-2.5-flash-lite";
export const FREE_DIET_PHOTO_UNAVAILABLE = "무료 사진 분석 연결을 준비 중이에요. 지금은 식사 내용을 직접 입력해 주세요.";
export const FREE_DIET_PHOTO_QUOTA_MESSAGE = "무료 사진 분석의 이용 한도에 도달했어요. 식사 내용을 직접 입력하거나 나중에 다시 이용해 주세요.";

type FreePhotoEnvironment = Readonly<Record<string, string | undefined>>;
type FreePhotoInput = {
  mealSlot?: unknown;
  imageDataUrl?: unknown;
  freeDataUseAcknowledged?: unknown;
};

export class FreeDietPhotoError extends Error {
  status: number;
  category: "invalid_input" | "not_configured" | "quota" | "provider" | "unreadable";
  providerStatus?: number;
  providerCode?: string;

  constructor(message: string, status: number, category: FreeDietPhotoError["category"], providerStatus?: number, providerCode?: string) {
    super(message);
    this.name = "FreeDietPhotoError";
    this.status = status;
    this.category = category;
    this.providerStatus = providerStatus;
    this.providerCode = providerCode;
  }
}

export function isFreeDietPhotoConfigured(environment: FreePhotoEnvironment = process.env) {
  // This is an operator attestation, NOT a Google billing-status API check.
  // Only set it after checking that this dedicated key's project has no billing
  // account. Revoke it before any billing change. Never reuse a paid/default key.
  return environment.GEMINI_FREE_TIER_CONFIRMED === "true" && Boolean(environment.GEMINI_FREE_API_KEY?.trim());
}

function buildPrompt(mealSlot: DietPhotoMealSlot) {
  return `너는 식사 사진에서 보이는 항목을 보수적으로 추정하는 기록 보조 도구야.
이 사진은 ${mealSlot === "lunch" ? "점심" : "저녁"} 식사야.

반드시 지킬 규칙:
- 한국어 음식명만 최대 6개 반환
- 사진에서 직접 보이지 않는 재료는 추측하지 말 것
- proteinGrams는 음식 전체의 단백질 추정 g, cookedRiceGrams는 조리된 밥의 추정 g
- 양을 판단할 수 없으면 해당 수치를 null로 반환
- 정밀한 영양 계산이나 의료 조언을 하지 말 것
- confidence는 high, medium, low 중 하나
- vegetables는 enough, some, none, unknown 중 하나
- note에는 가림, 용기 크기, 소스 등 오차 원인만 짧게 작성

JSON만 반환:
{"foods":[],"proteinGrams":null,"cookedRiceGrams":null,"vegetables":"unknown","confidence":"low","note":""}`;
}

export async function analyzeFreeDietPhoto(
  input: FreePhotoInput,
  environment: FreePhotoEnvironment = process.env,
  request: typeof fetch = fetch,
) {
  const mealSlot = input.mealSlot;
  const imageDataUrl = typeof input.imageDataUrl === "string" ? input.imageDataUrl.trim() : "";
  if ((mealSlot !== "lunch" && mealSlot !== "dinner") || !isSupportedDietPhotoDataUrl(imageDataUrl)) {
    throw new FreeDietPhotoError("식사 종류와 지원되는 사진을 확인해 주세요.", 400, "invalid_input");
  }
  if (input.freeDataUseAcknowledged !== true) {
    throw new FreeDietPhotoError("무료 분석의 사진·응답 활용 안내를 먼저 확인해 주세요.", 400, "invalid_input");
  }
  if (!isFreeDietPhotoConfigured(environment)) {
    throw new FreeDietPhotoError(FREE_DIET_PHOTO_UNAVAILABLE, 503, "not_configured");
  }

  const separator = imageDataUrl.indexOf(",");
  const mimeType = imageDataUrl.slice(5, imageDataUrl.indexOf(";")).toLowerCase();
  const imageData = imageDataUrl.slice(separator + 1).replace(/\s+/g, "");
  let response: Response;
  try {
    // One request, one free-project key. No paid router, paid reservation, provider
    // fallback, retry, uploaded file, search tool, or persistent context cache.
    response = await request(`https://generativelanguage.googleapis.com/v1beta/models/${FREE_DIET_PHOTO_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": environment.GEMINI_FREE_API_KEY!.trim() },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify({
        contents: [{ role: "user", parts: [
          { text: buildPrompt(mealSlot) },
          { inline_data: { mime_type: mimeType, data: imageData } },
        ] }],
        generationConfig: {
          ...buildGeminiGenerationConfig({ model: FREE_DIET_PHOTO_MODEL, responseFormat: "json", maxOutputTokens: 350, temperature: 0.2 }),
          thinkingConfig: { thinkingBudget: 0, includeThoughts: false },
        },
        store: false,
      }),
    });
  } catch {
    throw new FreeDietPhotoError("무료 사진 분석에 연결하지 못했어요. 식사 내용을 직접 입력하거나 나중에 다시 이용해 주세요.", 503, "provider");
  }
  if (!response.ok) {
    const details = await readAiProviderFailure(response);
    if (response.status === 429 || details.code === "RESOURCE_EXHAUSTED") {
      throw new FreeDietPhotoError(FREE_DIET_PHOTO_QUOTA_MESSAGE, 429, "quota", response.status, details.code);
    }
    // Provider messages can contain credentials or the image. Keep only the
    // sanitized classification; do not expose/log their raw messages or bodies.
    throw new FreeDietPhotoError("무료 사진 분석을 사용할 수 없어요. 식사 내용을 직접 입력해 주세요.", 503, "provider", response.status, details.code);
  }
  const data: unknown = await response.json().catch(() => null);
  const generated = extractGeminiResponse(data, "json");
  const analysis = generated.diagnostics.finishReason === "STOP"
    ? parseDietPhotoAnalysisText(generated.text)
    : null;
  if (!analysis) {
    throw new FreeDietPhotoError("사진에서 식사량을 판단하지 못했어요. 직접 입력해 주세요.", 422, "unreadable");
  }
  return analysis;
}
