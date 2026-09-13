import type { DinnerCarbChoice, ProteinGramChoice } from "./dietPlans.ts";

export type DietPhotoMealSlot = "lunch" | "dinner";
export type DietPhotoConfidence = "high" | "medium" | "low";
export type DietPhotoVegetableAmount = "enough" | "some" | "none" | "unknown";

export type DietPhotoAnalysis = {
  foods: string[];
  proteinGrams: number | null;
  cookedRiceGrams: number | null;
  vegetables: DietPhotoVegetableAmount;
  confidence: DietPhotoConfidence;
  note: string;
};

export const DIET_PHOTO_MAX_SOURCE_BYTES = 12 * 1024 * 1024;
export const DIET_PHOTO_MAX_DATA_URL_LENGTH = 4_000_000;

const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function compactText(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function nullableBoundedNumber(value: unknown, maximum: number) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(maximum, Math.max(0, Math.round(number)));
}

export function normalizeDietPhotoAnalysis(value: unknown): DietPhotoAnalysis {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const foods = Array.isArray(record.foods)
    ? Array.from(new Set(record.foods.map((food) => compactText(food, 40)).filter(Boolean))).slice(0, 6)
    : [];
  const vegetables = record.vegetables === "enough" || record.vegetables === "some" ||
      record.vegetables === "none"
    ? record.vegetables
    : "unknown";
  const confidence = record.confidence === "high" || record.confidence === "medium"
    ? record.confidence
    : "low";

  return {
    foods,
    proteinGrams: nullableBoundedNumber(record.proteinGrams, 100),
    cookedRiceGrams: nullableBoundedNumber(record.cookedRiceGrams, 500),
    vegetables,
    confidence,
    note: compactText(record.note, 180),
  };
}

export function parseDietPhotoAnalysisText(raw: string): DietPhotoAnalysis | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) text = text.slice(first, last + 1);

  try {
    const result = normalizeDietPhotoAnalysis(JSON.parse(text));
    return result.foods.length || result.proteinGrams !== null || result.cookedRiceGrams !== null
      ? result
      : null;
  } catch {
    return null;
  }
}

export function validateDietPhotoFile(file: Pick<File, "type" | "size">) {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    return "JPG, PNG, WebP 사진만 사용할 수 있어요.";
  }
  if (file.size <= 0) return "빈 사진 파일은 사용할 수 없어요.";
  if (file.size > DIET_PHOTO_MAX_SOURCE_BYTES) {
    return "사진은 12MB 이하만 사용할 수 있어요.";
  }
  return null;
}

export function isSupportedDietPhotoDataUrl(value: string) {
  return value.length <= DIET_PHOTO_MAX_DATA_URL_LENGTH &&
    /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(value);
}

export function proteinInputFromEstimate(grams: number | null): {
  choice: ProteinGramChoice;
  custom: number;
} | null {
  if (grams === null) return null;
  if (grams <= 0) return { choice: "none", custom: 0 };
  if (grams === 20 || grams === 25 || grams === 30) {
    return { choice: String(grams) as ProteinGramChoice, custom: 0 };
  }
  return { choice: "custom", custom: Math.min(100, Math.round(grams)) };
}

export function riceInputFromEstimate(grams: number | null): {
  amountType: DinnerCarbChoice;
  grams: number;
} | null {
  if (grams === null) return null;
  if (grams <= 0) return { amountType: "none", grams: 0 };
  if (grams === 50 || grams === 80 || grams === 100) {
    return { amountType: String(grams) as DinnerCarbChoice, grams };
  }
  return { amountType: "custom", grams: Math.min(500, Math.round(grams)) };
}
