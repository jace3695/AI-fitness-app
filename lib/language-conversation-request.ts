export type Situation = '카페' | '여행' | '일상' | '업무' | '친구';
export type HistoryMessage = { role: 'user'; text: string } | { role: 'assistant'; reply: string };
const situations: Situation[] = ['카페', '여행', '일상', '업무', '친구'];

// Keep the legacy eight-message context window, but validate before any provider call.
export function parseLanguageConversationRequest(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 1000) return null;
  const raw = body.history ?? [];
  if (!Array.isArray(raw) || raw.length > 60) return null;
  const history: HistoryMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    if (item.role === 'user' && typeof item.text === 'string' && item.text.trim() && item.text.length <= 1000) {
      history.push({ role: 'user', text: item.text });
    } else if (item.role === 'assistant' && typeof item.reply === 'string' && item.reply.trim() && item.reply.length <= 4000) {
      history.push({ role: 'assistant', reply: item.reply });
    } else return null;
  }
  return { message: body.message.trim(), history: history.slice(-8),
    situation: situations.includes(body.situation as Situation) ? body.situation as Situation : '일상' as Situation };
}
