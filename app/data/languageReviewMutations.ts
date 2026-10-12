import { languageDocument, LanguageDocumentError, LanguageSourceConflictError, type LanguageDocument } from './languageRecordDocuments.ts';
import { captureLanguageRows, languageRowOriginal, languageRowKey, languageRowSource, resolveLanguageRow, type LanguageRowHandle } from './languageRecordIdentity.ts';
import { createLanguageMutation, getLanguageMutationOutcome, reconcileLanguageMutation, runLanguageMutation, type LanguageMutation } from './languageRecordMutations.ts';
import type { LanguageRecordContext, LanguageRecordSnapshot } from './languageCloudSync.ts';
import type { LanguageBytes, LanguageStorageKey } from './languageStorageBoundary.ts';
import { planRoutineChange } from './languageDailyMutations.ts';
import { reviewInterval, reviewObservationFields, type ReviewObservation } from '../../utils/learningReview.ts';
import type { CurriculumReviewItem } from '../../utils/curriculumProgress.ts';

export const REVIEW_COMPLETED_ITEMS_KEY = 'reviewCompletedItemsByDate';
export const COURSE_REVIEW_KEY = 'japaneseCurriculumReviewV1';
export type ProgressQueueKey = 'wrongKana' | 'wrongWords' | 'wrongSentences';
export type ReviewArrayKey = ProgressQueueKey | 'wrongKanaChars' | 'savedWords' | 'savedSentences' | 'grammarProgress' | typeof COURSE_REVIEW_KEY;
export type ReviewScheduleInput = { correct: boolean; neededHelp: boolean; hadWrong: boolean; observation?: ReviewObservation; response?: string };
export type ReviewMutationPayload =
  | { kind: 'reviewed'; itemId: string }
  | { kind: 'reconcile-completion' }
  | ({ kind: 'schedule'; handle: LanguageRowHandle } & ReviewScheduleInput)
  | { kind: 'delete-row'; key: ReviewArrayKey; handle: LanguageRowHandle; cleanupKana?: boolean }
  | { kind: 'delete-group'; key: 'savedWords' | 'savedSentences' | 'grammarProgress' | typeof COURSE_REVIEW_KEY; handle: LanguageRowHandle }
  | { kind: 'clear-progress'; key: ProgressQueueKey };
export type ReviewMutationResult = { reviewedIds?: string[]; id?: string; intervalDays?: number; nextReviewAt?: string; reviewed?: boolean; deleted?: boolean };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const message = '일부 복습 기록을 읽지 못했어요. 원본과 입력은 보존했어요.';
const displayStringFields = ['word', 'japanese', 'meaning', 'example', 'category', 'note', 'char', 'romaji', 'type', 'mode', 'createdAt', 'lastWrongAt', 'reading', 'koreanPronunciation', 'exampleKoreanPronunciation', 'title', 'pattern', 'partOfSpeech', 'sentenceKeyword', 'lessonId', 'id', 'lessonTitle', 'prompt', 'explanation', 'nextReviewAt', 'lastModality', 'lastResult'];
export function supportedReviewRow(key: ReviewArrayKey, value: unknown): boolean {
  if (key === 'wrongKanaChars') return typeof value === 'string';
  if (typeof value === 'string') return key === 'wrongKana' || key === 'wrongWords' || key === 'wrongSentences';
  if (!object(value) || displayStringFields.some(field => value[field] !== undefined && typeof value[field] !== 'string')) return false;
  for (const field of ['wrongCount', 'correctCount', 'reviewCount', 'successStreak', 'intervalDays', 'lastResponseMs']) if (value[field] !== undefined && (typeof value[field] !== 'number' || !Number.isFinite(value[field]) || value[field] < 0)) return false;
  if (key === 'savedWords') return ['word', 'meaning', 'category', 'example'].every(field => typeof value[field] === 'string' && !!value[field]);
  if (key === 'savedSentences') return typeof value.japanese === 'string' && typeof value.meaning === 'string';
  if (key === 'grammarProgress') return typeof value.lessonId === 'string' && typeof value.title === 'string' && typeof value.correctCount === 'number' && typeof value.wrongCount === 'number';
  if (key === COURSE_REVIEW_KEY) return ['id', 'lessonId', 'lessonTitle', 'prompt', 'explanation', 'createdAt'].every(field => typeof value[field] === 'string') && Number.isFinite(Date.parse(value.createdAt as string));
  return key === 'wrongKana' ? ['char', 'kana', 'text', 'question', 'answer'].some(field => typeof value[field] === 'string')
    : key === 'wrongWords' ? typeof value.word === 'string' : typeof value.japanese === 'string' || typeof value.sentence === 'string';
}
function supportedReviewRaw(key: ReviewArrayKey, raw: string | undefined): boolean {
  if (raw === undefined) return false;
  try {
    const value: unknown = JSON.parse(raw);
    if (!supportedReviewRow(key, value)) return false;
    if (object(value)) {
      const row = languageDocument(raw, 'object');
      for (const field of [...displayStringFields, 'correctCount', 'wrongCount', 'reviewCount', 'successStreak', 'intervalDays', 'lastResponseMs', 'lastNeededHelp']) row.get([field]);
    }
    return true;
  } catch { return false; }
}
export function projectReviewRows<T>(source: LanguageRecordSnapshot | null, key: ReviewArrayKey): { rows: { value: T; handle: LanguageRowHandle }[]; error: string | null; complete: boolean } {
  if (!source) return { rows: [], error: null, complete: false };
  try {
    const captured = captureLanguageRows(source, key), supported = captured.filter(row => supportedReviewRaw(key, row.raw));
    return { rows: supported.map(row => ({ value: row.value as T, handle: row.handle })), complete: captured.length === supported.length, error: captured.length === supported.length ? null : message };
  } catch { return { rows: [], error: message, complete: false }; }
}
function reviewedDate(doc: LanguageDocument, date: string) {
  const matches: number[] = [], items: string[] = [];
  for (let index = 0; index < doc.length(); index++) {
    if (!object(doc.get([index]))) continue;
    if (doc.get([index, 'date']) !== date) continue;
    matches.push(index);
    if (!doc.has([index, 'items'])) continue;
    for (let offset = 0; offset < doc.length([index, 'items']); offset++) {
      const value = doc.get([index, 'items', offset]); if (typeof value === 'string' && !items.includes(value)) items.push(value);
    }
  }
  return { matches, items };
}
export function projectReviewedItems(raw: string | null | undefined, date: string): { items: string[]; error: string | null } {
  try {
    const doc = languageDocument(raw, 'array'); let partial = false;
    for (let index = 0; index < doc.length(); index++) {
      if (!object(doc.get([index])) || typeof doc.get([index, 'date']) !== 'string' || !doc.has([index, 'items'])) { partial = true; continue; }
      for (let offset = 0; offset < doc.length([index, 'items']); offset++) if (typeof doc.get([index, 'items', offset]) !== 'string') partial = true;
    }
    return { items: reviewedDate(doc, date).items, error: partial ? message : null };
  }
  catch { return { items: [], error: message }; }
}
function planReviewed(fresh: LanguageBytes, intent: LanguageMutation<ReviewMutationPayload>, itemId?: string) {
  const doc = languageDocument(fresh[REVIEW_COMPLETED_ITEMS_KEY], 'array');
  const day = reviewedDate(doc, intent.date), changes: Partial<Record<LanguageStorageKey, string | null>> = {};
  if (itemId !== undefined) {
    if (typeof itemId !== 'string' || !itemId) throw new LanguageDocumentError();
    if (!day.items.includes(itemId)) {
      if (day.matches.length) doc.append([day.matches[0], 'items'], itemId);
      else doc.append([], { date: intent.date, items: [itemId] });
      day.items.push(itemId); changes[REVIEW_COMPLETED_ITEMS_KEY] = doc.text();
    }
  }
  if (day.items.length >= 3) Object.assign(changes, planRoutineChange(fresh, { ...intent, payload: { id: 'review', mode: 'complete' } }).changes);
  return { changes, result: { reviewedIds: day.items } };
}
function assertHandle(handle: LanguageRowHandle, key: ReviewArrayKey) { if (languageRowKey(handle) !== key) throw new LanguageSourceConflictError(); }
function identityMatches(doc: LanguageDocument, field: string, value: string): number[] {
  const result: number[] = [];
  for (let index = 0; index < doc.length(); index++) if (object(doc.get([index])) && doc.get([index, field]) === value) result.push(index);
  return result;
}
function nonnegative(row: LanguageDocument, field: string): number | undefined {
  const value = row.get([field]);
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) throw new LanguageDocumentError();
  return value;
}
const LAST = 'languageLastOperationV1';
function validateReceipt(row: LanguageDocument) {
  if (!row.has([LAST])) return;
  const value = row.get([LAST]), result = row.get([LAST, 'result']);
  if (!object(value) || Object.keys(value).length !== 4 || Object.keys(value).some(field => !['version', 'operationId', 'payload', 'result'].includes(field))
    || row.get([LAST, 'version']) !== 1 || typeof row.get([LAST, 'operationId']) !== 'string' || !row.get([LAST, 'operationId']) || typeof row.get([LAST, 'payload']) !== 'string'
    || !object(result) || Object.keys(result).length !== 4 || Object.keys(result).some(field => !['id', 'intervalDays', 'nextReviewAt', 'reviewed'].includes(field))
    || typeof row.get([LAST, 'result', 'id']) !== 'string' || typeof row.get([LAST, 'result', 'reviewed']) !== 'boolean'
    || typeof row.get([LAST, 'result', 'intervalDays']) !== 'number' || !Number.isFinite(row.get([LAST, 'result', 'intervalDays']))
    || typeof row.get([LAST, 'result', 'nextReviewAt']) !== 'string' || !Number.isFinite(Date.parse(row.get([LAST, 'result', 'nextReviewAt']) as string))) throw new LanguageDocumentError();
}
function scheduleCandidate(intent: LanguageMutation<Extract<ReviewMutationPayload, { kind: 'schedule' }>>) {
  const input = intent.payload; assertHandle(input.handle, COURSE_REVIEW_KEY);
  const source = languageRowSource(input.handle);
  if (source.records[COURSE_REVIEW_KEY] !== intent.source.records[COURSE_REVIEW_KEY]) throw new LanguageSourceConflictError();
  const original = languageDocument(source.records[COURSE_REVIEW_KEY], 'array');
  const index = languageRowOriginal(input.handle).index, row = languageDocument(original.rawAt([index]), 'object');
  if (!supportedReviewRaw(COURSE_REVIEW_KEY, row.text())) throw new LanguageDocumentError();
  const id = row.get(['id']); if (typeof id !== 'string' || !id || identityMatches(original, 'id', id).length !== 1) throw new LanguageSourceConflictError();
  validateReceipt(row);
  if ([input.correct, input.neededHelp, input.hadWrong].some(value => typeof value !== 'boolean') || (input.response !== undefined && typeof input.response !== 'string')) throw new LanguageDocumentError();
  const wrongCount = nonnegative(row, 'wrongCount'); nonnegative(row, 'reviewCount'); nonnegative(row, 'successStreak');
  for (const field of ['lastWrongAt', 'nextReviewAt']) { const value = row.get([field]); if (value !== undefined && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) throw new LanguageDocumentError(); }
  const priorModality = row.get(['lastModality']), priorHelp = row.get(['lastNeededHelp']), priorResponse = row.get(['lastResponseMs']);
  if (priorModality !== undefined && !['meaning', 'listening', 'typing'].includes(priorModality as string)) throw new LanguageDocumentError();
  if (priorHelp !== undefined && typeof priorHelp !== 'boolean') throw new LanguageDocumentError();
  if (priorResponse !== undefined && (typeof priorResponse !== 'number' || !Number.isFinite(priorResponse) || priorResponse < 0)) throw new LanguageDocumentError();
  const oldInterval = row.get(['intervalDays']); if (oldInterval !== undefined && (typeof oldInterval !== 'number' || !Number.isFinite(oldInterval) || oldInterval < 0)) throw new LanguageDocumentError();
  const observation = input.observation;
  if (observation && (!['meaning', 'listening', 'typing'].includes(observation.modality) || typeof observation.neededHelp !== 'boolean' || (observation.responseMs !== undefined && (typeof observation.responseMs !== 'number' || !Number.isFinite(observation.responseMs) || observation.responseMs < 0)))) throw new LanguageDocumentError();
  const effective = observation ? { ...observation, neededHelp: input.neededHelp || input.hadWrong || observation.neededHelp } : undefined;
  const intervalDays = reviewInterval(oldInterval as number | undefined, input.correct && !input.neededHelp && !input.hadWrong, effective);
  const nextReviewAt = new Date(Date.parse(intent.timestamp) + intervalDays * 86_400_000).toISOString();
  if (input.hadWrong) row.set(['wrongCount'], (wrongCount ?? 0) + 1).set(['lastWrongAt'], intent.timestamp);
  row.set(['intervalDays'], intervalDays).set(['nextReviewAt'], nextReviewAt);
  if (effective) {
    const previous = { reviewCount: row.get(['reviewCount']), successStreak: row.get(['successStreak']) } as CurriculumReviewItem;
    for (const [field, value] of Object.entries(reviewObservationFields(previous, input.correct, effective))) {
      if (value === undefined) row.remove([field]); else row.set([field], value);
    }
  }
  const result = { id, intervalDays, nextReviewAt, reviewed: input.correct };
  const payload = JSON.stringify({ id, correct: input.correct, neededHelp: input.neededHelp, hadWrong: input.hadWrong, response: input.response, observation, timestamp: intent.timestamp, date: intent.date });
  row.set([LAST], { version: 1, operationId: intent.operationId, payload, result });
  return { row, result, payload, index };
}
export function planCourseReview(fresh: LanguageBytes, intent: LanguageMutation<Extract<ReviewMutationPayload, { kind: 'schedule' }>>) {
  const candidate = scheduleCandidate(intent), doc = languageDocument(fresh[COURSE_REVIEW_KEY], 'array');
  const matches = identityMatches(doc, 'id', candidate.result.id); if (matches.length > 1) throw new LanguageSourceConflictError();
  if (matches.length) {
    const current = languageDocument(doc.rawAt([matches[0]]), 'object'); validateReceipt(current);
    if (current.get([LAST, 'operationId']) === intent.operationId) {
      if (current.get([LAST, 'payload']) !== candidate.payload || current.text() !== candidate.row.text()) throw new LanguageSourceConflictError();
      return { changes: {}, result: candidate.result, alreadyApplied: true };
    }
  }
  const index = resolveLanguageRow(intent.payload.handle, intent.context, fresh);
  if (index !== candidate.index || matches[0] !== index) throw new LanguageSourceConflictError();
  for (const field of ['wrongCount', 'lastWrongAt', 'intervalDays', 'nextReviewAt', 'lastResponseMs', 'lastModality', 'lastNeededHelp', 'reviewCount', 'successStreak', LAST]) {
    if (doc.rawAt([index, field]) === candidate.row.rawAt([field])) continue;
    if (!candidate.row.has([field])) doc.remove([index, field]); else doc.set([index, field], candidate.row.get([field]));
  }
  const tracked = intent.payload.correct ? planReviewed(fresh, intent, `course:${candidate.result.id}`) : { changes: {} };
  return { changes: { [COURSE_REVIEW_KEY]: doc.text(), ...tracked.changes }, result: candidate.result };
}
export function planReviewMutation(fresh: LanguageBytes, intent: LanguageMutation<ReviewMutationPayload>): { changes: Partial<Record<LanguageStorageKey, string | null>>; result: ReviewMutationResult; alreadyApplied?: boolean } {
  const payload = intent.payload;
  if (payload.kind === 'reviewed' || payload.kind === 'reconcile-completion') return planReviewed(fresh, intent, payload.kind === 'reviewed' ? payload.itemId : undefined);
  if (payload.kind === 'schedule') return planCourseReview(fresh, intent as LanguageMutation<Extract<ReviewMutationPayload, { kind: 'schedule' }>>);
  const key = payload.key;
  if (payload.kind === 'clear-progress') {
    if (!['wrongKana', 'wrongWords', 'wrongSentences'].includes(key) || intent.source.records[key] !== fresh[key]) throw new LanguageSourceConflictError();
    const doc = languageDocument(fresh[key], 'array');
    for (let index = 0; index < doc.length(); index++) if ( !supportedReviewRaw(key, doc.rawAt([index]))) throw new LanguageDocumentError('표시하지 못한 기록이 있어 전체 삭제를 중단했어요. 원본을 보존했어요.');
    return { changes: fresh[key] === undefined ? {} : { [key]: null }, result: { deleted: true } };
  }
  assertHandle(payload.handle, key);
  const index = resolveLanguageRow(payload.handle, intent.context, fresh), doc = languageDocument(fresh[key], 'array');
  const changes: Partial<Record<LanguageStorageKey, string | null>> = {};
  if (payload.kind === 'delete-group') {
    const field = key === 'savedWords' ? 'word' : key === 'savedSentences' ? 'japanese' : key === 'grammarProgress' ? 'lessonId' : 'id';
    const value = doc.get([index, field]); if (typeof value !== 'string') throw new LanguageDocumentError();
    const matches = identityMatches(doc, field, value);
    if (key === COURSE_REVIEW_KEY && matches.length !== 1) throw new LanguageSourceConflictError();
    if (matches.some(offset => !supportedReviewRaw(key, doc.rawAt([offset])))) throw new LanguageDocumentError('같은 항목에 표시하지 못한 기록이 있어 삭제를 중단했어요. 원본을 보존했어요.');
    for (const offset of matches.reverse()) doc.remove([offset]);
  } else {
    const before = doc.get([index]);
    if (!supportedReviewRaw(key, doc.rawAt([index]))) throw new LanguageDocumentError();
    const char = key === 'wrongKana' ? typeof before === 'string' ? before : doc.get([index, 'char']) : undefined;
    doc.remove([index]);
    if (key === 'wrongKana' && payload.cleanupKana && typeof char === 'string' && char) {
      let survives = false;
      for (let offset = 0; offset < doc.length(); offset++) {
        const row = doc.get([offset]); if (row === char || (object(row) && doc.get([offset, 'char']) === char)) survives = true;
      }
      if (!survives) {
        const chars = languageDocument(fresh.wrongKanaChars, 'array');
        for (let offset = chars.length() - 1; offset >= 0; offset--) if (chars.get([offset]) === char) chars.remove([offset]);
        if (chars.text() !== (fresh.wrongKanaChars ?? '[]')) changes.wrongKanaChars = chars.text();
      }
    }
  }
  changes[key] = doc.text(); return { changes, result: { deleted: true } };
}
export function createReviewMutation(context: LanguageRecordContext, source: LanguageRecordSnapshot, payload: ReviewMutationPayload) { return createLanguageMutation(context, source, payload); }
export function verifyCourseReview(fresh: LanguageBytes, intent: LanguageMutation<ReviewMutationPayload>): ReviewMutationResult {
  if (intent.payload.kind !== 'schedule') throw new LanguageSourceConflictError();
  const planned = planCourseReview(fresh, intent as LanguageMutation<Extract<ReviewMutationPayload, { kind: 'schedule' }>>);
  if (!planned.alreadyApplied) throw new LanguageSourceConflictError(); return planned.result;
}
export function runReviewMutation(intent: LanguageMutation<ReviewMutationPayload>, context: LanguageRecordContext = intent.context) {
  const state = getLanguageMutationOutcome(intent);
  if (context !== intent.context || state === 'committed' || state === 'unknown') return Promise.resolve(reconcileLanguageMutation(intent, context, intent.payload.kind === 'schedule' ? verifyCourseReview : undefined));
  return runLanguageMutation(intent, planReviewMutation, intent.payload.kind === 'clear-progress' ? { expectedDraft: intent.source.revision } : {});
}
