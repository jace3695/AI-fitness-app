export type AssistantConversationMessage = {
  role: "user" | "assistant";
  text: string;
};

type StoredConversationMessage = {
  role?: unknown;
  text?: unknown;
  content?: unknown;
};

type PersonalMemory = {
  topic?: unknown;
  content?: unknown;
};

export function normalizeConversationHistory(value: unknown, limit = 8): AssistantConversationMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-Math.max(1, limit)).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as StoredConversationMessage;
    const role = candidate.role === "user" || candidate.role === "assistant" ? candidate.role : null;
    const rawText = typeof candidate.text === "string" ? candidate.text : typeof candidate.content === "string" ? candidate.content : "";
    const text = rawText.trim().slice(0, 500);
    return role && text ? [{ role, text }] : [];
  });
}

export function selectConversationHistory(stored: unknown, client: unknown, limit = 8) {
  const storedHistory = normalizeConversationHistory(stored, limit);
  return storedHistory.length ? storedHistory : normalizeConversationHistory(client, limit);
}

export function buildPersonalMemoryContext(value: unknown, limit = 10) {
  if (!Array.isArray(value)) return "";
  return value.slice(0, Math.max(1, limit)).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const memory = item as PersonalMemory;
    const content = typeof memory.content === "string" ? memory.content.replace(/\s+/g, " ").trim().slice(0, 240) : "";
    if (!content) return [];
    const topic = typeof memory.topic === "string" ? memory.topic.replace(/\s+/g, " ").trim().slice(0, 40) : "일반";
    return [`- ${topic || "일반"}: ${content}`];
  }).join("\n");
}
