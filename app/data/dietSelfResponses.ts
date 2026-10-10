/** Optional, independent self-reports from roadmap p8. No intake or diagnosis is inferred. */
export const DIET_SELF_RESPONSE_FIELDS = [
  { key: 'hunger', label: '배고픔', question: '오늘 배고픔을 느꼈나요?' },
  { key: 'bingeUrge', label: '폭식 충동', question: '오늘 폭식 충동을 느꼈나요?' },
  { key: 'preSleepOvereating', label: '수면 전 과식', question: '잠들기 전에 과식했다고 느꼈나요?' },
] as const;
export type DietSelfResponseKey = typeof DIET_SELF_RESPONSE_FIELDS[number]['key'];
export type DietSelfAnswer = 'unrecorded' | 'yes' | 'no';
export type DietSelfResponse = DietSelfAnswer | 'unknown';
export type DietSelfResponses = Record<DietSelfResponseKey, DietSelfResponse>;
export type DietSelfResponseEdits = Partial<Record<DietSelfResponseKey, DietSelfAnswer>>;
export const DIET_SELF_RESPONSE_LABELS: Record<DietSelfResponse, string> = {
  unrecorded: '미기록', yes: '예', no: '아니요', unknown: '기존 응답 형식 확인 필요',
};
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;

export function normalizeDietSelfResponse(value: unknown): DietSelfResponse {
  if (value === undefined || value === 'unrecorded') return 'unrecorded';
  return value === 'yes' || value === 'no' ? value : 'unknown';
}
export function readDietSelfResponses(value: unknown): DietSelfResponses {
  const row = record(value);
  return Object.fromEntries(DIET_SELF_RESPONSE_FIELDS.map(({ key }) => [key, normalizeDietSelfResponse(row[key])])) as DietSelfResponses;
}

/** Only explicit edits become a patch. Untouched absent/unknown fields stay byte-for-byte intact. */
export function dietSelfResponsePatch(edits: DietSelfResponseEdits): DietSelfResponseEdits {
  return Object.fromEntries(DIET_SELF_RESPONSE_FIELDS.flatMap(({ key }) => {
    const value = edits[key];
    return value === 'yes' || value === 'no' || value === 'unrecorded' ? [[key, value]] : [];
  }));
}
export type DietSelfResponseMetric = { count: number; answers: number; rate: number | null; unrecognized: number };
export function summarizeDietSelfResponses(store: Record<string, unknown>, end: string, days: number) {
  const anchor = validDate(end) ? Date.parse(`${end}T12:00:00Z`) : NaN;
  const rows = Number.isInteger(days) && days > 0 ? Object.entries(store)
    .filter(([date, value]) => validDate(date) && date <= end && anchor - Date.parse(`${date}T12:00:00Z`) < days * 86_400_000 && value !== null && typeof value === 'object' && !Array.isArray(value))
    .map(([, value]) => readDietSelfResponses(value)) : [];
  return Object.fromEntries(DIET_SELF_RESPONSE_FIELDS.map(({ key }) => {
    const answers = rows.filter(row => row[key] === 'yes' || row[key] === 'no').length;
    const count = rows.filter(row => row[key] === 'yes').length;
    return [key, { count, answers, rate: answers ? Math.round(count / answers * 100) : null, unrecognized: rows.filter(row => row[key] === 'unknown').length }];
  })) as Record<DietSelfResponseKey, DietSelfResponseMetric>;
}
export function dietSelfResponseMetricText(metric: DietSelfResponseMetric): string {
  const base = metric.answers ? `예 ${metric.count}일 / 응답 ${metric.answers}일 · ${metric.rate}%` : '미기록 · 응답 0일';
  return metric.unrecognized ? `${base} · 기존 응답 확인 필요 ${metric.unrecognized}일 (계산 제외)` : base;
}

/** Legacy selectors distinguish unsupported responses without rewriting the stored value. */
export function hasUnrecognizedDietResponse(value: unknown, normalize: (value: unknown) => string) {
  return value !== undefined && value !== 'unrecorded' && normalize(value) === 'unrecorded';
}
/** Keep every latest untouched response, including recognized updates from another tab. */
export function preserveUneditedDietResponse(value: unknown, selected: string, edited: boolean): unknown {
  return edited ? selected : value === undefined ? 'unrecorded' : value;
}
