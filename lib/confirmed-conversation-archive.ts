import { parseJournal, type Turn } from '../app/language/practice/conversation.ts';
import { historyId } from './body-analysis-history.ts';
export { historyId };
export const ARCHIVE_TABLE = 'confirmed_conversation_archive';
export type ArchiveKind = 'body-dialogue' | 'japanese-practice';
export type ArchiveSnapshot = { version: 1; kind: 'body-dialogue'; date: string; question: string; answer: string }
  | { version: 1; kind: 'japanese-practice'; turn: Turn };
export type ArchiveEntry = { id: string; created_at: string; snapshot: ArchiveSnapshot };
export const archiveKind = (x: unknown): x is ArchiveKind => x === 'body-dialogue' || x === 'japanese-practice';
const keys = (v: object, expected: string) => Object.keys(v).sort().join(',') === expected;
export function parseArchiveSnapshot(value: unknown): ArchiveSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return null;
  if (v.kind === 'body-dialogue') {
    if (!keys(v, 'answer,date,kind,question,version') || typeof v.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.date) || !Number.isFinite(Date.parse(v.date)) || new Date(v.date).toISOString().slice(0,10) !== v.date ||
      typeof v.question !== 'string' || !v.question.trim() || v.question.length > 1000 || typeof v.answer !== 'string' || !v.answer.trim() || v.answer.length > 16000) return null;
    return { version: 1, kind: v.kind, date: v.date, question: v.question, answer: v.answer };
  }
  if (v.kind === 'japanese-practice' && keys(v, 'kind,turn,version') && v.turn && typeof v.turn === 'object' && !Array.isArray(v.turn)) {
    const t = v.turn as Turn;
    if (!keys(t, t.reply ? 'id,practiced,reply,review,situation,text' : 'id,practiced,review,situation,text')) return null;
    if (t.reply && !keys(t.reply, 'correction,explanation,reply,replyReading,source')) return null;
    try { return { version: 1, kind: v.kind, turn: parseJournal(JSON.stringify({ version: 1, owner: 'validation', turns: [t] }), 'validation').turns[0] }; }
    catch { return null; }
  }
  return null;
}
export function parseArchiveEntry(value: unknown): ArchiveEntry | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>, snapshot = parseArchiveSnapshot(v.snapshot);
  if (!historyId(v.id) || !snapshot || typeof v.created_at !== 'string' || !Number.isFinite(Date.parse(v.created_at))) return null;
  return { id: v.id, created_at: new Date(v.created_at).toISOString(), snapshot };
}
export function archiveText(snapshot: ArchiveSnapshot) {
  if (snapshot.kind === 'body-dialogue') return `기준일 ${snapshot.date}\n질문: ${snapshot.question}\n로컬 규칙 답변: ${snapshot.answer}`;
  const t = snapshot.turn;
  return `${t.situation}\n${t.text}\n복습 표시: ${t.review ? '있음' : '없음'} · 자기 보고 연습 ${t.practiced}회` +
    (t.reply ? `\n기록에 포함된 답변: ${t.reply.reply}\n읽기: ${t.reply.replyReading}\n교정 참고: ${t.reply.correction}\n설명: ${t.reply.explanation}` : '\n직접 입력 · 미교정');
}
