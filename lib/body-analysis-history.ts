export const BODY_HISTORY_TABLE = 'body_analysis_history';
export const BODY_HISTORY_VERSION = 1;
export type BodyAnalysisSnapshot = { version: 1; source: 'local-rules'; date: string; text: string };
export type BodyAnalysisEntry = { id: string; created_at: string; snapshot: BodyAnalysisSnapshot };
export const historyId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function parseBodyAnalysisSnapshot(value: unknown): BodyAnalysisSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(',') !== 'date,source,text,version' || v.version !== 1 || v.source !== 'local-rules' ||
    typeof v.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.date) ||
    !Number.isFinite(Date.parse(v.date)) || new Date(v.date).toISOString().slice(0, 10) !== v.date ||
    typeof v.text !== 'string' || !v.text.trim() || v.text.length > 12000) return null;
  return { version: 1, source: 'local-rules', date: v.date, text: v.text };
}
export function parseBodyAnalysisEntry(value: unknown): BodyAnalysisEntry | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>, snapshot = parseBodyAnalysisSnapshot(v.snapshot);
  if (!historyId(v.id) || !snapshot || typeof v.created_at !== 'string' || !Number.isFinite(Date.parse(v.created_at))) return null;
  return { id: v.id, created_at: v.created_at, snapshot };
}
