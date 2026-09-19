export const LANGUAGE_ROUTINES = ['kana', 'words', 'sentences', 'grammar', 'review'] as const;
export type LanguageRoutine = typeof LANGUAGE_ROUTINES[number];
export const LANGUAGE_LABELS: Record<LanguageRoutine, string> = { kana: '가나', words: '단어', sentences: '문장', grammar: '문법', review: '복습' };
export const LANGUAGE_RECORD_KEYS = ['dailyRoutineProgress', 'dailyLearningHistory'] as const;
export type LanguageCommandProposal = {
  domain: 'language'; ownerId: string; requestId: string; routineId: LanguageRoutine; date: string;
  expected: Record<string, unknown>; resetMarkers: { language: string | null; assistant: string | null }; expiresAt: string;
};
export type LanguageCommandReceipt = {
  user_id: string; id: string; routine_id: LanguageRoutine; record_date: string;
  before_values: Record<string, unknown>; after_values: Record<string, unknown>; created_at: string; undone_at: string | null;
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function languageRecords(state: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(LANGUAGE_RECORD_KEYS.filter(key => Object.hasOwn(state, key)).map(key => [key, state[key]]));
}
function storedObject(value: unknown): Record<string, unknown> {
  const parsed = value === undefined ? {} : typeof value === 'string' ? JSON.parse(value) : value;
  if (!object(parsed)) throw new Error('학습 기록 형식을 확인하지 못했습니다. 언어 화면에서 기록을 확인해 주세요.');
  return parsed;
}
function routineIds(value: unknown): LanguageRoutine[] {
  if (!Array.isArray(value) || value.some(id => !LANGUAGE_ROUTINES.includes(id))) throw new Error('학습 완료 목록을 확인하지 못했습니다. 언어 화면에서 기록을 확인해 주세요.');
  return [...new Set(value)] as LanguageRoutine[];
}
export function languageCompletedIds(records: Record<string, unknown>, date: string): LanguageRoutine[] {
  const progress = storedObject(records.dailyRoutineProgress);
  const history = storedObject(records.dailyLearningHistory);
  if (Object.hasOwn(records, 'dailyRoutineProgress')) {
    if (typeof progress.date !== 'string') throw new Error('학습 날짜를 확인하지 못했습니다.');
    routineIds(progress.completedIds);
  }
  const entry = history[date];
  if (entry !== undefined && !object(entry)) throw new Error('오늘 학습 이력을 확인하지 못했습니다.');
  return [...new Set([...(progress.date === date ? routineIds(progress.completedIds) : []), ...(entry === undefined ? [] : routineIds((entry as Record<string, unknown>).completedIds))])];
}
export function parseLanguageCompletion(message: string): LanguageRoutine {
  if (/(어제|그제|내일|모레|지난|다음|\d\s*(월|일)|\d{4}[-./])/.test(message)) throw new Error('완료 명령은 오늘 학습만 기록합니다. 오늘 완료한 학습을 말씀해 주세요.');
  if (/(미완료|취소|않|못|안\s*(했|끝|마|완료)|완료.{0,8}(말|아니|하지\s*마)|아직)/.test(message)) throw new Error('완료 여부가 분명하지 않아 저장하지 않았습니다. 완료한 학습 한 가지만 말씀해 주세요.');
  const patterns = [/(가나|히라가나|카타카나)/, /단어/, /문장/, /문법/, /복습/];
  const matches = LANGUAGE_ROUTINES.filter((_, index) => patterns[index].test(message));
  if (matches.length !== 1) throw new Error('완료한 학습 한 가지만 말씀해 주세요. 예: ‘오늘 단어 학습 완료했어’');
  return matches[0];
}
export function isLanguageCommandProposal(value: unknown): value is LanguageCommandProposal {
  if (!object(value) || value.domain !== 'language' || typeof value.ownerId !== 'string'
    || typeof value.requestId !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value.requestId)
    || !LANGUAGE_ROUTINES.includes(value.routineId as LanguageRoutine) || typeof value.date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !Number.isFinite(Date.parse(value.date))
    || new Date(value.date).toISOString().slice(0, 10) !== value.date
    || !object(value.expected) || Object.keys(value.expected).some(key => !(LANGUAGE_RECORD_KEYS as readonly string[]).includes(key))
    || !object(value.resetMarkers) || Object.keys(value.resetMarkers).sort().join() !== 'assistant,language'
    || Object.values(value.resetMarkers).some(marker => marker !== null && (typeof marker !== 'string' || marker.length > 120))
    || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) return false;
  try { languageCompletedIds(value.expected, value.date); return JSON.stringify(value.expected).length <= 200000; } catch { return false; }
}
