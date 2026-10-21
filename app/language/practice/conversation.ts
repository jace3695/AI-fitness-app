export const SITUATIONS = ['카페', '여행', '일상', '업무', '친구'] as const;
export type Situation = typeof SITUATIONS[number];
export type Reply = { source: 'ai'; reply: string; replyReading: string; correction: string; explanation: string };
export type Turn = { id: string; text: string; situation: Situation; reply?: Reply; review: boolean; practiced: number };
export type Journal = { version: 1; owner: string; turns: Turn[] };
export type ConversationRequest = { situation: Situation; message: string; history: { role: 'user' | 'assistant'; text: string }[] };
export type Transport = (request: ConversationRequest, signal: AbortSignal) => Promise<unknown>;
export const MAX_TEXT = 1000;
export const MAX_TURNS = 30;

function bounded(value: unknown, max = 4000): value is string {
  return typeof value === 'string' && value.length <= max;
}
export function parseReply(value: unknown): Reply {
  const p = value as Partial<Reply> | null;
  if (!p || p.source !== 'ai' || !bounded(p.reply) || !p.reply.trim() ||
    !bounded(p.replyReading) || !bounded(p.correction) || !bounded(p.explanation)) {
    throw Error('AI 응답 형식을 확인하지 못했어요. 입력은 유지했어요.');
  }
  return { source: 'ai', reply: p.reply, replyReading: p.replyReading, correction: p.correction, explanation: p.explanation };
}
export function requestFor(turns: Turn[], situation: Situation, message: string): ConversationRequest {
  const text = message.trim();
  if (!text || text.length > MAX_TEXT) throw Error('1~1000자로 입력해 주세요.');
  return { situation, message: text, history: turns.filter(t => t.situation === situation && t.reply).slice(-4)
    .flatMap(t => [{ role: 'user' as const, text: t.text }, { role: 'assistant' as const, text: t.reply!.reply }]) };
}
export function parseJournal(raw: string | null, owner: string): Journal {
  if (raw === null) return { version: 1, owner, turns: [] };
  const p = JSON.parse(raw) as Journal;
  if (!p || p.version !== 1 || p.owner !== owner || !Array.isArray(p.turns) || p.turns.length > MAX_TURNS) throw Error('이 탭의 기록을 읽지 못했어요. 기존 기록은 덮어쓰지 않아요.');
  const ids = new Set<string>();
  const turns = p.turns.map(t => {
    if (!t || !bounded(t.id, 100) || !t.id || ids.has(t.id) || !bounded(t.text, MAX_TEXT) || !t.text.trim() ||
      !SITUATIONS.includes(t.situation) || typeof t.review !== 'boolean' || !Number.isSafeInteger(t.practiced) || t.practiced < 0) throw Error('기록 형식이 올바르지 않아요. 기존 기록은 덮어쓰지 않아요.');
    ids.add(t.id);
    return { id: t.id, text: t.text, situation: t.situation, review: t.review, practiced: t.practiced, ...(t.reply ? { reply: parseReply(t.reply) } : {}) };
  });
  return { version: 1, owner, turns };
}
export async function getConversation(transport: Transport, request: ConversationRequest, signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('취소됨', 'AbortError');
  let abort: () => void = () => {};
  try {
    const result = await Promise.race([transport(request, signal), new Promise<never>((_, reject) => {
      abort = () => reject(new DOMException('취소됨', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    })]);
    if (signal.aborted) throw new DOMException('취소됨', 'AbortError');
    return parseReply(result);
  } finally { signal.removeEventListener('abort', abort); }
}
