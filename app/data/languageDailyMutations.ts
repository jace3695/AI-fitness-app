import type { LanguageBytes, LanguageStorageKey } from './languageStorageBoundary.ts';
import { languageDocument, assertLanguagePathsUnchanged, LanguageDocumentError, LanguageSourceConflictError, type LanguageDocument, type LanguageJsonPath } from './languageRecordDocuments.ts';
import { runLanguageMutation, type LanguageMutation } from './languageRecordMutations.ts';

export const ROUTINE_IDS = ['kana', 'words', 'sentences', 'grammar', 'review'] as const;
export type RoutineId = typeof ROUTINE_IDS[number];
export type RoutineChangePayload = { id: RoutineId; mode: 'complete' | 'toggle' };
export type RoutineChangeResult = { completedIds: string[]; completed: boolean };
type Changes = Partial<Record<LanguageStorageKey, string | null>>;
const known = (value: unknown): value is RoutineId => typeof value === 'string' && (ROUTINE_IDS as readonly string[]).includes(value);
const dateValid = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
function ids(doc: LanguageDocument, path: LanguageJsonPath): RoutineId[] {
  if (!doc.has(path)) return [];
  const length = doc.length(path), result: RoutineId[] = [];
  for (let i = 0; i < length; i++) { const item = doc.get([...path, i]); if (known(item) && !result.includes(item)) result.push(item); }
  return result;
}
function pair(raw: LanguageBytes, date: string) {
  const routine = languageDocument(raw.dailyRoutineProgress, 'object');
  const history = languageDocument(raw.dailyLearningHistory, 'object');
  const head = routine.get(['date']);
  if (head !== undefined && !dateValid(head)) throw new LanguageDocumentError();
  if (head !== undefined && head > date) throw new LanguageSourceConflictError('오늘보다 새로운 학습 기록이 있습니다. 이전 날짜의 답을 보존했어요. 날짜를 확인해 주세요.');
  const allRoutine = ids(routine, ['completedIds']);
  if (head === undefined && allRoutine.length) throw new LanguageDocumentError();
  if (history.has([date])) {
    const entry = history.get([date]);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new LanguageDocumentError();
    for (const field of ['completedCount', 'totalCount']) {
      const value = history.get([date, field]);
      if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) throw new LanguageDocumentError();
    }
    const updated = history.get([date, 'updatedAt']);
    if (updated !== undefined && (typeof updated !== 'string' || !Number.isFinite(Date.parse(updated)))) throw new LanguageDocumentError();
  }
  const routineIds = head === date ? allRoutine : [];
  const historyIds = ids(history, [date, 'completedIds']);
  return { routine, history, head, routineIds, historyIds };
}
function patchIds(doc: LanguageDocument, path: LanguageJsonPath, desired: readonly RoutineId[]) {
  if (!doc.has(path)) doc.set(path, []);
  // Remove only supported memberships. Unknown strings, objects and numeric tokens survive.
  for (let index = doc.length(path) - 1; index >= 0; index--) { const value = doc.get([...path, index]); if (known(value) && !desired.includes(value)) doc.remove([...path, index]); }
  const existing = ids(doc, path);
  for (const id of desired) if (!existing.includes(id)) doc.append(path, id);
}
/** Pure composition point. No storage reads, clock reads or nested transaction. */
export function planRoutineChange(fresh: LanguageBytes, intent: LanguageMutation<RoutineChangePayload>): { changes: Changes; result: RoutineChangeResult } {
  const { id, mode } = intent.payload, date = intent.date;
  if (!known(id) || !['complete', 'toggle'].includes(mode) || !dateValid(date) || !Number.isFinite(Date.parse(intent.timestamp))) throw new LanguageDocumentError();
  const current = pair(fresh, date);
  const merged = ROUTINE_IDS.filter(item => current.routineIds.includes(item) || current.historyIds.includes(item));
  if (mode === 'toggle') {
    assertLanguagePathsUnchanged(intent.source.records.dailyRoutineProgress, fresh.dailyRoutineProgress, 'object', [[]]);
    assertLanguagePathsUnchanged(intent.source.records.dailyLearningHistory, fresh.dailyLearningHistory, 'object', [[]]);
  }
  const completed = mode === 'complete' || !merged.includes(id);
  const desired = completed ? ROUTINE_IDS.filter(item => item === id || merged.includes(item)) : merged.filter(item => item !== id);
  current.routine.set(['date'], date);
  patchIds(current.routine, ['completedIds'], desired);
  patchIds(current.history, [date, 'completedIds'], desired);
  if (current.history.get([date, 'completedCount']) !== desired.length) current.history.set([date, 'completedCount'], desired.length);
  if (current.history.get([date, 'totalCount']) !== ROUTINE_IDS.length) current.history.set([date, 'totalCount'], ROUTINE_IDS.length);
  const changes: Changes = {};
  if (current.routine.text() !== fresh.dailyRoutineProgress || current.history.text() !== fresh.dailyLearningHistory) {
    current.history.set([date, 'updatedAt'], intent.timestamp);
    if (current.routine.text() !== fresh.dailyRoutineProgress) changes.dailyRoutineProgress = current.routine.text();
    if (current.history.text() !== fresh.dailyLearningHistory) changes.dailyLearningHistory = current.history.text();
  }
  return { changes, result: { completedIds: desired, completed } };
}
export const runRoutineChange = (intent: LanguageMutation<RoutineChangePayload>) => runLanguageMutation(intent, planRoutineChange, intent.payload.mode === 'toggle' ? { expectedDraft: intent.source.revision } : {});

/** Read-only daily display; unavailable or unsupported data is never presented as an empty valid day. */
export function projectRoutineDay(fresh: LanguageBytes, date: string): { completedIds: string[]; error: string | null } {
  try {
    const current = pair(fresh, date);
    const values = current.routine.get<unknown[]>(['completedIds']) ?? [];
    return { completedIds: current.routineIds, error: values.some(item => !known(item)) ? '일부 완료 항목은 지원되지 않는 형식이라 표시하지 못했어요. 원본은 보존됩니다.' : null };
  } catch (error) { return { completedIds: [], error: error instanceof Error ? error.message : new LanguageDocumentError().message }; }
}
