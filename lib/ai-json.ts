export function parseAiJsonObject(raw: string): Record<string, unknown> | null {
  let text = raw.trim();
  if (!text) return null;

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  const firstObject = text.indexOf("{");
  const lastObject = text.lastIndexOf("}");
  if (firstObject !== -1 && lastObject >= firstObject) text = text.slice(firstObject, lastObject + 1);

  for (const candidate of [text, text.replace(/[\x00-\x1F\x7F]/g, "")]) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // 모델이 끊긴 JSON은 추측으로 완성하지 않고 호출한 쪽에서 안전한 대체 결과를 사용합니다.
    }
  }

  return null;
}
