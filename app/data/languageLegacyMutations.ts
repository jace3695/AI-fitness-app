import type { LanguageBytes, LanguageStorageKey } from './languageStorageBoundary.ts';
import { languageDocument, LanguageDocumentError, LanguageSourceConflictError, type LanguageDocument } from './languageRecordDocuments.ts';
import { runLanguageMutation, type LanguageMutation } from './languageRecordMutations.ts';
import { planRoutineChange, type RoutineId } from './languageDailyMutations.ts';

type JsonRow = Record<string, unknown>;
export type WrongQueueKey = 'wrongKana' | 'wrongWords' | 'wrongSentences';
export type SavedQueueKey = 'savedWords' | 'savedSentences';
export type LegacyMutationPayload =
  | { kind: 'answer'; wrong?: { key: WrongQueueKey; row: JsonRow }; routine?: RoutineId }
  | { kind: 'toggle-saved'; key: SavedQueueKey; row: JsonRow }
  | { kind: 'grammar-answer'; lesson: { lessonId: string; title: string; category: string; pattern: string }; correct: boolean };
export type LegacyMutationResult = { saved?: boolean; lessonId?: string; correctCount?: number; wrongCount?: number };
type Changes = Partial<Record<LanguageStorageKey, string | null>>;
const record = (value: unknown): value is JsonRow => !!value && typeof value === 'object' && !Array.isArray(value);
const fields = (key: WrongQueueKey | SavedQueueKey): string[] => key === 'wrongKana' ? ['char', 'mode'] : key === 'wrongSentences' ? ['japanese', 'quizType'] : key === 'savedSentences' ? ['japanese', 'meaning', 'category'] : key === 'wrongWords' ? ['word', 'meaning', 'category', 'quizType'] : ['word', 'meaning', 'category'];
function matching(doc: LanguageDocument, names: string[], row: JsonRow): number[] {
  if (names.some(name => typeof row[name] !== 'string')) throw new LanguageDocumentError();
  const matches: number[] = [];
  for (let index = 0; index < doc.length(); index++) {
    if (!record(doc.get([index]))) continue;
    // Token-aware named reads reject duplicate identity members, including in opaque rows.
    const values = names.map(name => doc.get([index, name]));
    if (names.every((name, field) => values[field] === row[name])) matches.push(index);
  }
  return matches;
}
function assertGroup(source: LanguageDocument, fresh: LanguageDocument, names: string[], row: JsonRow) {
  const before = matching(source, names, row).map(index => source.rawAt([index]));
  const now = matching(fresh, names, row).map(index => fresh.rawAt([index]));
  if (before.length !== now.length || before.some((raw, i) => raw !== now[i])) throw new LanguageSourceConflictError();
}
/** Supported catalogue tuple toggle; opaque rows and nonmatching occurrences stay byte-for-byte. */
export function planSavedToggle(fresh: LanguageBytes, intent: LanguageMutation<Extract<LegacyMutationPayload, { kind: 'toggle-saved' }>>) {
  const { key, row } = intent.payload;
  if (key !== 'savedWords' && key !== 'savedSentences') throw new LanguageDocumentError();
  const doc = languageDocument(fresh[key], 'array'), source = languageDocument(intent.source.records[key], 'array');
  assertGroup(source, doc, fields(key), row);
  const matches = matching(doc, fields(key), row), saved = matches.length === 0;
  // A hidden/unsupported matching catalogue row is not permission to delete it.
  // These are the same minimum display fields as the corresponding read projection.
  for (const index of matches) {
    const displayFields = key === 'savedWords' ? ['word', 'meaning', 'category', 'example'] : ['japanese', 'meaning', 'category'];
    for (const field of displayFields) {
      const value = doc.get([index, field]);
      if (typeof value !== 'string' || key === 'savedWords' && !value) throw new LanguageDocumentError('같은 항목의 일부 저장 기록을 표시하지 못했습니다. 숨겨진 원본을 삭제하지 않았어요.');
    }
  }
  if (saved) doc.append([], row); else for (const index of matches.reverse()) doc.remove([index]);
  return { changes: { [key]: doc.text() } as Changes, result: { saved } };
}
/** Set-like append keeps the established key-specific dedupe identity. */
export function planWrongAppend(fresh: LanguageBytes, key: WrongQueueKey, row: JsonRow): Changes {
  if (!['wrongKana', 'wrongWords', 'wrongSentences'].includes(key)) throw new LanguageDocumentError();
  const doc = languageDocument(fresh[key], 'array');
  if (matching(doc, fields(key), row).length) return {};
  doc.append([], row); return { [key]: doc.text() };
}
const LAST_OPERATION = 'languageLastOperationV1';
function validateReceipt(doc: LanguageDocument, path: readonly (string | number)[]) {
  if (!doc.has(path)) return;
  const value = doc.get(path), result = doc.get([...path, 'result']);
  const shape = ['version', 'operationId', 'payload', 'result'], resultShape = ['lessonId', 'correctCount', 'wrongCount'];
  if (!record(value) || Object.keys(value).length !== shape.length || Object.keys(value).some(key => !shape.includes(key))
    || doc.get([...path, 'version']) !== 1 || typeof doc.get([...path, 'operationId']) !== 'string' || !doc.get([...path, 'operationId'])
    || typeof doc.get([...path, 'payload']) !== 'string' || !record(result)
    || Object.keys(result).length !== resultShape.length || Object.keys(result).some(key => !resultShape.includes(key))
    || typeof doc.get([...path, 'result', 'lessonId']) !== 'string') throw new LanguageDocumentError('문법 기록의 저장 확인 정보가 지원되지 않습니다. 원본과 답을 보존했어요.');
  for (const field of ['correctCount', 'wrongCount']) {
    const count = doc.get([...path, 'result', field]);
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw new LanguageDocumentError();
  }
}
function validateGrammarMetadata(row: LanguageDocument) {
  for (const field of ['title', 'category', 'pattern']) {
    const value = row.get([field]);
    if (value !== undefined && typeof value !== 'string') throw new LanguageDocumentError();
  }
  const date = row.get(['lastAnsweredAt']), result = row.get(['lastResult']);
  if (date !== undefined && (typeof date !== 'string' || !Number.isFinite(Date.parse(date)))) throw new LanguageDocumentError();
  if (result !== undefined && result !== 'correct' && result !== 'wrong') throw new LanguageDocumentError();
}

function count(row: LanguageDocument, field: string) {
  const value = row.get([field]);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) throw new LanguageDocumentError();
  return value;
}
function grammarCandidate(intent: LanguageMutation<Extract<LegacyMutationPayload, { kind: 'grammar-answer' }>>, source: LanguageDocument, sourceIndex: number | undefined) {
  const { lesson, correct } = intent.payload;
  const row = languageDocument(sourceIndex === undefined ? undefined : source.rawAt([sourceIndex]), 'object');
  validateReceipt(row, [LAST_OPERATION]);
  validateGrammarMetadata(row);
  const result = { lessonId: lesson.lessonId, correctCount: (sourceIndex === undefined ? 0 : count(row, 'correctCount')) + (correct ? 1 : 0), wrongCount: (sourceIndex === undefined ? 0 : count(row, 'wrongCount')) + (correct ? 0 : 1) };
  for (const [key, value] of Object.entries(lesson)) { if (typeof value !== 'string') throw new LanguageDocumentError(); row.set([key], value); }
  if (row.get(['correctCount']) !== result.correctCount) row.set(['correctCount'], result.correctCount);
  if (row.get(['wrongCount']) !== result.wrongCount) row.set(['wrongCount'], result.wrongCount);
  row.set(['lastAnsweredAt'], intent.timestamp).set(['lastResult'], correct ? 'correct' : 'wrong');
  const payload = JSON.stringify({ action: intent.payload, timestamp: intent.timestamp, date: intent.date });
  row.set([LAST_OPERATION], { version: 1, operationId: intent.operationId, payload, result });
  return { row, payload, result };
}
export function planGrammarAnswer(fresh: LanguageBytes, intent: LanguageMutation<Extract<LegacyMutationPayload, { kind: 'grammar-answer' }>>) {
  const doc = languageDocument(fresh.grammarProgress, 'array'), source = languageDocument(intent.source.records.grammarProgress, 'array');
  const sourceMatches = matching(source, ['lessonId'], intent.payload.lesson), freshMatches = matching(doc, ['lessonId'], intent.payload.lesson);
  if (sourceMatches.length > 1 || freshMatches.length > 1) throw new LanguageSourceConflictError();
  const before = sourceMatches[0], index = freshMatches[0], candidate = grammarCandidate(intent, source, before);
  if (index !== undefined) {
    validateReceipt(doc, [index, LAST_OPERATION]);
    if (doc.get([index, LAST_OPERATION, 'operationId']) === intent.operationId) {
      if (doc.get([index, LAST_OPERATION, 'payload']) !== candidate.payload || doc.rawAt([index]) !== candidate.row.text()) throw new LanguageSourceConflictError();
      return { changes: {} as Changes, result: candidate.result, alreadyApplied: true };
    }
  }
  assertGroup(source, doc, ['lessonId'], intent.payload.lesson);
  if (index === undefined) doc.appendRaw([], candidate.row.text());
  else {
    // Change known members only; never serialize the source row or unknown tokens.
    const receipt = candidate.row.get([LAST_OPERATION]);
    for (const field of ['lessonId', 'title', 'category', 'pattern', 'correctCount', 'wrongCount', 'lastAnsweredAt', 'lastResult']) {
      if (doc.rawAt([index, field]) !== candidate.row.rawAt([field])) doc.set([index, field], candidate.row.get([field]));
    }
    doc.set([index, LAST_OPERATION], receipt);
  }
  const daily = planRoutineChange(fresh, { ...intent, payload: { id: 'grammar', mode: 'complete' } });
  return { changes: { grammarProgress: doc.text(), ...daily.changes }, result: candidate.result };
}
export function planLegacyMutation(fresh: LanguageBytes, intent: LanguageMutation<LegacyMutationPayload>): { changes: Changes; result: LegacyMutationResult; alreadyApplied?: boolean } {
  if (intent.payload.kind === 'toggle-saved') return planSavedToggle(fresh, intent as LanguageMutation<Extract<LegacyMutationPayload, { kind: 'toggle-saved' }>>);
  if (intent.payload.kind === 'grammar-answer') return planGrammarAnswer(fresh, intent as LanguageMutation<Extract<LegacyMutationPayload, { kind: 'grammar-answer' }>>);
  const changes = intent.payload.wrong ? planWrongAppend(fresh, intent.payload.wrong.key, { ...intent.payload.wrong.row, createdAt: intent.timestamp }) : {};
  if (intent.payload.routine) Object.assign(changes, planRoutineChange(fresh, { ...intent, payload: { id: intent.payload.routine, mode: 'complete' } }).changes);
  return { changes, result: {} };
}
export const runLegacyMutation = (intent: LanguageMutation<LegacyMutationPayload>) => runLanguageMutation(intent, planLegacyMutation, intent.payload.kind === 'toggle-saved' ? { expectedDraft: intent.source.revision } : {});
/** Exact row proof used for read-only reconciliation, without redispatching an answer. */
export function verifyLegacyMutation(fresh: LanguageBytes, intent: LanguageMutation<LegacyMutationPayload>): LegacyMutationResult {
  if (intent.payload.kind !== 'grammar-answer') throw new LanguageSourceConflictError();
  const planned = planGrammarAnswer(fresh, intent as LanguageMutation<Extract<LegacyMutationPayload, { kind: 'grammar-answer' }>>);
  if (!planned.alreadyApplied) throw new LanguageSourceConflictError();
  return planned.result;
}

/** Only for trusted catalogue/input values, never for a stored row projection. */
export const legacyCatalogueRow = (row: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(row)) as Record<string, unknown>;

/** A display projection explicitly reports unsupported roots and hidden opaque rows. */
export function projectLegacyRows<T>(raw: string | null | undefined, supported: (value: unknown) => value is T): { value: T[]; error: string | null } {
  try {
    const rows = languageDocument(raw, 'array').get<unknown[]>()!;
    const value = rows.filter(supported);
    return { value, error: value.length === rows.length ? null : '일부 기록은 지원되지 않는 형식이라 표시하지 못했어요. 원본은 그대로 보존됩니다.' };
  } catch (error) { return { value: [], error: error instanceof Error ? error.message : new LanguageDocumentError().message }; }
}
