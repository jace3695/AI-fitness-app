import { BEGINNER_KANA_GROUPS } from '../../data/beginnerKana.ts';
import { CURRICULUM, type CurriculumLesson, type CourseTrack } from '../../data/curriculum.ts';
import { CURRICULUM_PROGRESS_KEY, CURRICULUM_REVIEW_KEY, type CurriculumReviewItem } from '../../utils/curriculumProgress.ts';
import { getSessionQuizIndices, getSessionResult, normalizeLearningSession, updateSessionReviews, type LearningSession } from '../../utils/learningSession.ts';
import { assertLanguageRecordSource, readLanguageRecordSnapshot, type LanguageRecordContext, type LanguageRecordSnapshot } from './languageCloudSync.ts';
import type { LanguageBytes } from './languageStorageBoundary.ts';
import { assertLanguageMutationUncommitted, createLanguageMutation, runLanguageMutation, type LanguageMutation, type LanguageMutationResult } from './languageRecordMutations.ts';
import { assertLanguagePathsUnchanged, languageDocument, LanguageDocumentError, LanguageSourceConflictError, type LanguageDocument, type LanguageJsonPath } from './languageRecordDocuments.ts';

export const LANGUAGE_FINISH_RECEIPTS = 'languageFinishReceiptsV1';
export type CoursePayload =
  | { kind: 'track'; track: CourseTrack }
  | { kind: 'kana'; groupId: string }
  | { kind: 'draft'; lesson: CurriculumLesson; session: LearningSession }
  | { kind: 'finish'; lesson: CurriculumLesson; session: LearningSession };
export type CourseOutcome = { kind: 'track' | 'kana' | 'draft' } | { kind: 'finish'; lessonId: string; sessionId: string; score: number; completedAt: string; date: string };
export type CourseMutation = LanguageMutation<CoursePayload>;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
function bad(): never { throw new LanguageDocumentError(); }
function record(doc: LanguageDocument, path: LanguageJsonPath, optional = true) {
  const value = doc.get(path); if (value === undefined && optional) return {};
  if (!object(value)) return bad(); return value;
}
function scalar(doc: LanguageDocument, path: LanguageJsonPath, type: 'string' | 'number' | 'boolean', optional = true) {
  const value = doc.get(path); if (value === undefined && optional) return undefined;
  if (typeof value !== type || (typeof value === 'number' && (!Number.isFinite(value) || value < 0))) return bad();
  return value;
}
function array(doc: LanguageDocument, path: LanguageJsonPath) {
  if (!doc.has(path)) doc.set(path, []);
  return doc.length(path);
}
function unionString(doc: LanguageDocument, path: LanguageJsonPath, value: string) {
  const count = array(doc, path);
  for (let index = 0; index < count; index++) if (doc.get([...path, index]) === value) return;
  doc.append(path, value);
}
function sortActivityDates(doc: LanguageDocument) {
  const path = ['activityDates']; const count = doc.length(path);
  const rows = Array.from({ length: count }, (_, index) => ({ raw: doc.rawAt([...path, index])!, value: doc.get([...path, index]) }));
  // Unknown members remain in their original slots; only the known date tokens move.
  const strings = rows.filter(row => typeof row.value === 'string').sort((a, b) => String(a.value).localeCompare(String(b.value)));
  let cursor = 0; const next = rows.map(row => typeof row.value === 'string' ? strings[cursor++] : row);
  if (next.every((row, index) => row.raw === rows[index].raw)) return;
  for (let index = count - 1; index >= 0; index--) doc.remove([...path, index]);
  for (const row of next) doc.appendRaw(path, row.raw);
}
function validateSession(doc: LanguageDocument, path: LanguageJsonPath, lesson: CurriculumLesson, session: LearningSession) {
  record(doc, path, false);
  const id = scalar(doc, [...path, 'id'], 'string', false);
  if (!id || String(id).length > 100) bad();
  if (doc.get([...path, 'version']) !== 1 || doc.get([...path, 'lessonId']) !== lesson.id || doc.get([...path, 'id']) !== session.id) throw new LanguageSourceConflictError('이 수업의 이어할 내용이 다르거나 지원하지 않는 형식입니다. 입력과 기존 기록을 보존했어요.');
  if (![5, 10, 20].includes(doc.get([...path, 'minutes']) as number) || !['starter', 'reader'].includes(doc.get([...path, 'mode']) as string)) bad();
  for (const name of ['stage', 'wordIndex', 'quizCursor']) scalar(doc, [...path, name], 'number');
  for (const name of ['answers', 'firstAnswers', 'responses']) {
    const values = record(doc, [...path, name]);
    for (const key of Object.keys(values)) if (/^\d+$/.test(key)) scalar(doc, [...path, name, key], name === 'responses' ? 'string' : 'boolean', false);
  }
  if (doc.has([...path, 'speakingChecks'])) {
    const length = doc.length([...path, 'speakingChecks']);
    for (let index = 0; index < Math.min(3, length); index++) scalar(doc, [...path, 'speakingChecks', index], 'boolean', false);
  }
  const observations = record(doc, [...path, 'observations']);
  for (const key of Object.keys(observations)) if (/^\d+$/.test(key)) {
    record(doc, [...path, 'observations', key], false);
    scalar(doc, [...path, 'observations', key, 'responseMs'], 'number');
    scalar(doc, [...path, 'observations', key, 'neededHelp'], 'boolean');
    const modality = scalar(doc, [...path, 'observations', key, 'modality'], 'string');
    if (modality !== undefined && !['meaning', 'listening', 'typing'].includes(String(modality))) bad();
  }
}
function patchSession(doc: LanguageDocument, path: LanguageJsonPath, lesson: CurriculumLesson, session: LearningSession) {
  if (!doc.has(path)) { doc.set(path, session); return; }
  validateSession(doc, path, lesson, session);
  const baseline = normalizeLearningSession(doc.get(path), lesson);
  if (!baseline) bad();
  const changed = (before: unknown, after: unknown) => JSON.stringify(before) !== JSON.stringify(after);
  for (const key of ['version', 'id', 'lessonId', 'minutes', 'mode', 'stage', 'wordIndex', 'quizCursor'] as const) if (changed(baseline[key], session[key])) doc.set([...path, key], session[key]);
  for (const name of ['answers', 'firstAnswers', 'responses'] as const) {
    for (let index = 0; index < lesson.quiz.length; index++) {
      if (!changed(baseline[name][index], session[name][index])) continue;
      const itemPath = [...path, name, String(index)];
      if (Object.hasOwn(session[name], index)) doc.set(itemPath, session[name][index]);
      else if (doc.has(itemPath)) doc.remove(itemPath);
    }
  }
  for (let index = 0; index < 3; index++) {
    if (!changed(baseline.speakingChecks[index], session.speakingChecks[index])) continue;
    if (!doc.has([...path, 'speakingChecks'])) doc.set([...path, 'speakingChecks'], []);
    while (index >= doc.length([...path, 'speakingChecks'])) doc.append([...path, 'speakingChecks'], false);
    doc.set([...path, 'speakingChecks', index], session.speakingChecks[index]);
  }
  for (const [index, observation] of Object.entries(session.observations ?? {})) {
    const target = [...path, 'observations', index]; record(doc, target);
    for (const key of ['responseMs', 'neededHelp', 'modality'] as const) {
      if (!changed(baseline.observations?.[Number(index)]?.[key], observation[key])) continue;
      if (observation[key] !== undefined) doc.set([...target, key], observation[key]);
      else if (doc.has([...target, key])) doc.remove([...target, key]);
    }
  }
}
/** Exact per-lesson proof allows unrelated lesson drafts to merge, never a changed same-ID draft. */
function proveDraft(sourceRaw: string | undefined, freshRaw: string | undefined, lesson: CurriculumLesson, session: LearningSession) {
  const source = languageDocument(sourceRaw, 'object'), fresh = languageDocument(freshRaw, 'object');
  record(source, ['lessonDrafts']); record(fresh, ['lessonDrafts']);
  const path = ['lessonDrafts', lesson.id];
  assertLanguagePathsUnchanged(sourceRaw, freshRaw, 'object', [path]);
  const sourceActive = source.has(['activeSession']) ? record(source, ['activeSession'], false) : null;
  const freshActive = fresh.has(['activeSession']) ? record(fresh, ['activeSession'], false) : null;
  const sourceActiveLesson = sourceActive ? scalar(source, ['activeSession', 'lessonId'], 'string', false) : undefined;
  const freshActiveLesson = freshActive ? scalar(fresh, ['activeSession', 'lessonId'], 'string', false) : undefined;
  if (source.has(path)) validateSession(source, path, lesson, session);
  else if (sourceActiveLesson === lesson.id) {
    validateSession(source, ['activeSession'], lesson, session);
    assertLanguagePathsUnchanged(sourceRaw, freshRaw, 'object', [['activeSession']]);
  } else if (freshActiveLesson === lesson.id) throw new LanguageSourceConflictError();
  // A matching active pointer is also a source of truth, not permission to overwrite newer answers.
  if (sourceActiveLesson === lesson.id && freshActiveLesson === lesson.id) assertLanguagePathsUnchanged(sourceRaw, freshRaw, 'object', [['activeSession']]);
  return { source, fresh, path, sourceActiveLesson, freshActiveLesson };
}
const reviewStrings = ['id', 'lessonId', 'lessonTitle', 'prompt', 'explanation', 'createdAt', 'lastWrongAt', 'nextReviewAt', 'lastSessionId', 'lastModality'] as const;
const reviewNumbers = ['wrongCount', 'intervalDays', 'lastResponseMs', 'reviewCount', 'successStreak'] as const;
/** Pure finish-review planner; opaque/unrelated rows and unknown token spans survive. */
export function planLessonFinishReviews(raw: string | undefined, lesson: CurriculumLesson, session: LearningSession, timestamp: string): string {
  const doc = languageDocument(raw, 'array');
  for (const question of getSessionQuizIndices(lesson, session.minutes)) {
    if (session.answers[question] === undefined) continue;
    const id = `${lesson.id}:${question}`; const matches: number[] = [];
    for (let index = 0; index < doc.length(); index++) {
      if (!object(doc.get([index]))) continue;
      if (doc.get([index, 'id']) === id) matches.push(index);
    }
    if (matches.length > 1) throw new LanguageDocumentError('같은 복습 문제의 기록이 중복되어 결과를 저장하지 못했어요. 원본을 보존했습니다.');
    const index = matches[0]; let previous: CurriculumReviewItem | undefined;
    if (index !== undefined) {
      const fields: Record<string, unknown> = {};
      for (const key of reviewStrings) { const value = scalar(doc, [index, key], 'string'); if (value !== undefined) fields[key] = value; }
      for (const key of reviewNumbers) { const value = scalar(doc, [index, key], 'number'); if (value !== undefined) fields[key] = value; }
      for (const key of ['lastSessionResult', 'lastNeededHelp']) { const value = scalar(doc, [index, key], 'boolean'); if (value !== undefined) fields[key] = value; }
      if (fields.lastModality !== undefined && !['meaning', 'listening', 'typing'].includes(String(fields.lastModality))) bad();
      previous = fields as CurriculumReviewItem;
    }
    // The existing pure scheduler remains the single source of scoring/interval semantics.
    const one = { ...session, answers: { [question]: session.answers[question] } };
    const planned = updateSessionReviews(previous ? [previous] : [], lesson, one, new Date(timestamp)).find(item => item.id === id);
    if (!planned) continue;
    if (index === undefined) {
      doc.append([], Object.fromEntries(Object.entries(planned).filter(([, value]) => value !== undefined)));
    } else for (const [key, value] of Object.entries(planned)) {
      if (value !== undefined) doc.set([index, key], value);
      else if (doc.has([index, key])) doc.remove([index, key]);
    }
  }
  return doc.text();
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function receiptPayload(intent: CourseMutation) { return canonical({ action: intent.payload, timestamp: intent.timestamp, date: intent.date }); }
function receipts(doc: LanguageDocument) {
  if (!doc.has([LANGUAGE_FINISH_RECEIPTS])) return [];
  const root = record(doc, [LANGUAGE_FINISH_RECEIPTS], false);
  if (Object.keys(root).some(key => key !== 'version' && key !== 'operations') || doc.get([LANGUAGE_FINISH_RECEIPTS, 'version']) !== 1) bad();
  const operations = record(doc, [LANGUAGE_FINISH_RECEIPTS, 'operations'], false);
  return Object.keys(operations).map(id => {
    const path = [LANGUAGE_FINISH_RECEIPTS, 'operations', id]; const entry = record(doc, path, false);
    if (Object.keys(entry).some(key => key !== 'payload' && key !== 'result')) bad();
    const payload = scalar(doc, [...path, 'payload'], 'string', false) as string;
    const result = record(doc, [...path, 'result'], false);
    if (Object.keys(result).some(key => !['kind', 'lessonId', 'sessionId', 'score', 'completedAt', 'date'].includes(key)) || doc.get([...path, 'result', 'kind']) !== 'finish') bad();
    for (const key of ['lessonId', 'sessionId', 'completedAt', 'date']) scalar(doc, [...path, 'result', key], 'string', false);
    const score = scalar(doc, [...path, 'result', 'score'], 'number', false);
    let proof: unknown; try { proof = JSON.parse(payload); } catch { bad(); }
    if (!object(proof) || !object(proof.action) || proof.action.kind !== 'finish' || !object(proof.action.lesson) || !object(proof.action.session)
      || proof.timestamp !== result.completedAt || proof.date !== result.date || proof.action.lesson.id !== result.lessonId || proof.action.session.id !== result.sessionId
      || typeof score !== 'number' || score > 100 || !Number.isFinite(Date.parse(String(result.completedAt))) || !/^\d{4}-\d{2}-\d{2}$/.test(String(result.date))) bad();
    // A retained receipt is a deterministic proof, not permission to trust an arbitrary in-range result.
    if (payload !== canonical(proof) || !Array.isArray(proof.action.lesson.quiz) || proof.action.lesson.quiz.length === 0
      || !proof.action.lesson.quiz.every(object) || !object(proof.action.session.answers) || !object(proof.action.session.firstAnswers)) bad();
    const retainedLesson = proof.action.lesson as CurriculumLesson, retainedSession = proof.action.session as LearningSession;
    validateSession(languageDocument(JSON.stringify(retainedSession), 'object'), [], retainedLesson, retainedSession);
    const expected = getSessionResult(retainedLesson, retainedSession);
    if (!expected.complete || !Number.isFinite(expected.score) || expected.score !== score) bad();
    return { id, payload, result: result as Extract<CourseOutcome, { kind: 'finish' }> };
  });
}
export function verifyCourseFinishReceipt(fresh: LanguageBytes, intent: CourseMutation): CourseOutcome {
  if (intent.payload.kind !== 'finish') throw new LanguageSourceConflictError();
  const found = receipts(languageDocument(fresh[CURRICULUM_PROGRESS_KEY], 'object')).find(entry => entry.id === intent.operationId);
  if (!found || found.payload !== receiptPayload(intent)) throw new LanguageSourceConflictError();
  return found.result;
}
export function planCourseMutation(fresh: LanguageBytes, intent: CourseMutation) {
  const payload = intent.payload;
  if (payload.kind === 'draft' || payload.kind === 'finish') {
    const currentLesson = CURRICULUM.find(item => item.id === payload.lesson.id);
    if (!currentLesson || JSON.stringify(currentLesson) !== JSON.stringify(payload.lesson)) throw new LanguageDocumentError('수업 내용이 바뀌어 안전하게 저장할 수 없어요. 입력을 보존했습니다.');
    validateSession(languageDocument(JSON.stringify(payload.session), 'object'), [], currentLesson, payload.session);
  }
  const original = fresh[CURRICULUM_PROGRESS_KEY]; const doc = languageDocument(original, 'object');
  const outcome: CourseOutcome = { kind: payload.kind } as CourseOutcome;
  if (payload.kind === 'track') {
    if (!['foundation', 'work', 'travel'].includes(payload.track)) bad();
    assertLanguagePathsUnchanged(intent.source.records[CURRICULUM_PROGRESS_KEY], original, 'object', [['selectedTrack']]);
    const track = scalar(doc, ['selectedTrack'], 'string');
    if (track !== undefined && !['foundation', 'work', 'travel'].includes(String(track))) bad();
    doc.set(['selectedTrack'], payload.track);
  } else if (payload.kind === 'kana') {
    if (!BEGINNER_KANA_GROUPS.some(group => group.id === payload.groupId)) bad(); unionString(doc, ['kanaCompletedGroups'], payload.groupId);
  } else if (payload.kind === 'draft') {
    const { source, path, sourceActiveLesson, freshActiveLesson } = proveDraft(intent.source.records[CURRICULUM_PROGRESS_KEY], original, payload.lesson, payload.session);
    if (!doc.has(path) && sourceActiveLesson === payload.lesson.id) doc.setRaw(path, source.rawAt(['activeSession'])!);
    patchSession(doc, path, payload.lesson, payload.session);
    const initializes = !source.has(path) && sourceActiveLesson !== payload.lesson.id;
    const ownsPointer = initializes && source.rawAt(['activeSession']) === doc.rawAt(['activeSession']);
    if (ownsPointer && sourceActiveLesson) {
      const oldLesson = CURRICULUM.find(item => item.id === sourceActiveLesson);
      const oldSession = oldLesson && normalizeLearningSession(source.get(['activeSession']), oldLesson);
      if (!oldLesson || !oldSession) bad();
      validateSession(source, ['activeSession'], oldLesson, oldSession);
      const oldPath = ['lessonDrafts', oldLesson.id];
      if (!doc.has(oldPath)) doc.setRaw(oldPath, source.rawAt(['activeSession'])!);
    }
    // Explicit initialization owns an unchanged pointer; a background save never steals one.
    if (ownsPointer || freshActiveLesson === payload.lesson.id || (!source.has(['activeSession']) && !doc.has(['activeSession']))) {
      if (ownsPointer || !doc.has(['activeSession'])) doc.setRaw(['activeSession'], doc.rawAt(path)!);
      else patchSession(doc, ['activeSession'], payload.lesson, payload.session);
    }
  } else {
    const result = getSessionResult(payload.lesson, payload.session);
    if (!result.complete || payload.session.lessonId !== payload.lesson.id) throw new LanguageDocumentError('확인 문제를 모두 답한 뒤 저장해 주세요.');
    const existingReceipts = receipts(doc), exact = existingReceipts.find(entry => entry.id === intent.operationId);
    if (exact) {
      if (exact.payload !== receiptPayload(intent)) throw new LanguageSourceConflictError();
      return { changes: {}, result: exact.result as CourseOutcome, alreadyApplied: true };
    }
    if (existingReceipts.some(entry => entry.result.sessionId === payload.session.id)) throw new LanguageSourceConflictError('이 학습은 다른 저장 요청으로 이미 완료됐어요. 이전 입력을 보존했습니다.');
    const { source, path, sourceActiveLesson, freshActiveLesson } = proveDraft(intent.source.records[CURRICULUM_PROGRESS_KEY], original, payload.lesson, payload.session);
    if (!source.has(path) && sourceActiveLesson !== payload.lesson.id) throw new LanguageSourceConflictError('이어할 학습 원본을 먼저 저장한 뒤 완료해 주세요.');
    const reviewRaw = planLessonFinishReviews(fresh[CURRICULUM_REVIEW_KEY], payload.lesson, payload.session, intent.timestamp);
    record(doc, ['quizScores']); scalar(doc, ['quizScores', payload.lesson.id], 'number');
    record(doc, ['lessonAttempts']); const attemptPath = ['lessonAttempts', payload.lesson.id]; const count = array(doc, attemptPath);
    const known: number[] = [];
    for (let index = 0; index < count; index++) {
      const itemPath = [...attemptPath, index]; if (!object(doc.get(itemPath))) continue;
      if (!doc.has([...itemPath, 'score']) && !doc.has([...itemPath, 'completedAt'])) continue;
      scalar(doc, [...itemPath, 'score'], 'number', false); scalar(doc, [...itemPath, 'completedAt'], 'string', false);
      const sessionId = scalar(doc, [...itemPath, 'sessionId'], 'string');
      if (sessionId === payload.session.id) throw new LanguageSourceConflictError('완료 영수증 없이 같은 학습 시도 기록이 있습니다. 기존 기록을 보존했습니다.');
      known.push(index);
    }
    for (const index of known.slice(0, Math.max(0, known.length - 19)).reverse()) doc.remove([...attemptPath, index]);
    doc.append(attemptPath, { score: result.score, completedAt: intent.timestamp, sessionId: payload.session.id });
    unionString(doc, ['completedLessonIds'], payload.lesson.id); unionString(doc, ['activityDates'], intent.date); sortActivityDates(doc);
    scalar(doc, ['selectedTrack'], 'string'); scalar(doc, ['lastLessonId'], 'string');
    doc.set(['quizScores', payload.lesson.id], result.score).set(['selectedTrack'], payload.lesson.track).set(['lastLessonId'], payload.lesson.id);
    if (doc.has(path)) doc.remove(path);
    if (freshActiveLesson === payload.lesson.id) {
      doc.remove(['activeSession']);
      const drafts = record(doc, ['lessonDrafts']);
      for (const id of Object.keys(drafts).reverse()) {
        const lesson = CURRICULUM.find(item => item.id === id);
        if (!lesson) continue;
        try {
          const draft = normalizeLearningSession(doc.get(['lessonDrafts', id]), lesson);
          if (!draft) continue;
          validateSession(doc, ['lessonDrafts', id], lesson, draft);
          doc.setRaw(['activeSession'], doc.rawAt(['lessonDrafts', id])!); break;
        } catch (error) {
          // Unsupported unrelated drafts remain byte-for-byte intact, but are not safe resume pointers.
          if (!(error instanceof LanguageDocumentError) && !(error instanceof LanguageSourceConflictError)) throw error;
        }
      }
    }
    const completed: CourseOutcome = { kind: 'finish', lessonId: payload.lesson.id, sessionId: payload.session.id, score: result.score, completedAt: intent.timestamp, date: intent.date };
    if (!doc.has([LANGUAGE_FINISH_RECEIPTS])) doc.set([LANGUAGE_FINISH_RECEIPTS], { version: 1, operations: {} });
    doc.set([LANGUAGE_FINISH_RECEIPTS, 'operations', intent.operationId], { payload: receiptPayload(intent), result: completed });
    scalar(doc, ['updatedAt'], 'string'); doc.set(['updatedAt'], intent.timestamp);
    return { changes: { [CURRICULUM_PROGRESS_KEY]: doc.text(), ...(reviewRaw !== fresh[CURRICULUM_REVIEW_KEY] ? { [CURRICULUM_REVIEW_KEY]: reviewRaw } : {}) }, result: completed };
  }
  if (doc.text() !== (original ?? '{}')) { scalar(doc, ['updatedAt'], 'string'); doc.set(['updatedAt'], intent.timestamp); }
  return { changes: doc.text() === (original ?? '{}') ? {} : { [CURRICULUM_PROGRESS_KEY]: doc.text() }, result: outcome };
}
export function createCourseMutation(context: LanguageRecordContext, source: LanguageRecordSnapshot, payload: CoursePayload, options?: { operationId?: string; timestamp?: string; date?: string }): CourseMutation {
  // Optional observations contain undefined responseMs in memory; absent fields remain absent in persisted JSON.
  return createLanguageMutation(context, source, JSON.parse(JSON.stringify(payload)) as CoursePayload, options);
}
export const runCourseMutation = (intent: CourseMutation) => runLanguageMutation(intent, planCourseMutation);
export const chooseLanguageTrack = (context: LanguageRecordContext, track: CourseTrack, source: LanguageRecordSnapshot) => runCourseMutation(createCourseMutation(context, source, { kind: 'track', track }));
export const completeKanaGroup = (context: LanguageRecordContext, groupId: string, source: LanguageRecordSnapshot) => runCourseMutation(createCourseMutation(context, source, { kind: 'kana', groupId }));
export const saveLessonDraft = (intent: CourseMutation) => { if (intent.payload.kind !== 'draft') throw new LanguageDocumentError(); return runCourseMutation(intent); };
export const finishLesson = (intent: CourseMutation) => { if (intent.payload.kind !== 'finish') throw new LanguageDocumentError(); return runCourseMutation(intent); };

/** Called only by an explicit “new save” control. The previous envelope is never modified or redispatched. */
export function createExplicitCourseSave(context: LanguageRecordContext, source: LanguageRecordSnapshot, payload: CoursePayload, previous?: CourseMutation): CourseMutation {
  if (previous) {
    assertLanguageMutationUncommitted(previous);
    if (source !== previous.source || payload.kind !== previous.payload.kind) throw new LanguageSourceConflictError();
  }
  const next = createCourseMutation(context, source, payload);
  // Validate same-origin and relevant original paths now; the runner proves them again under the lock.
  planCourseMutation(readLanguageRecordSnapshot(context).records, next);
  return next;
}

/** Promote only the editor's own acknowledged lesson bytes, never a later unseen same-lesson edit. */
export function advanceCourseDraftSource(result: LanguageMutationResult<CourseOutcome>, intent: CourseMutation): LanguageRecordSnapshot {
  if (intent.payload.kind !== 'draft' || !result.acknowledged || !result.source) throw new LanguageSourceConflictError();
  assertLanguageRecordSource(intent.source, result.source.context);
  const lessonId = intent.payload.lesson.id;
  const committedRaw = result.committedRecords[CURRICULUM_PROGRESS_KEY], currentRaw = result.source.records[CURRICULUM_PROGRESS_KEY];
  assertLanguagePathsUnchanged(committedRaw, currentRaw, 'object', [['lessonDrafts', lessonId]]);
  const committed = languageDocument(committedRaw, 'object'), current = languageDocument(currentRaw, 'object');
  const activeLesson = (doc: LanguageDocument) => {
    if (!doc.has(['activeSession'])) return undefined;
    record(doc, ['activeSession'], false);
    return scalar(doc, ['activeSession', 'lessonId'], 'string', false);
  };
  const beforeActive = activeLesson(committed), afterActive = activeLesson(current);
  if (afterActive === lessonId) {
    if (beforeActive !== lessonId) throw new LanguageSourceConflictError();
    assertLanguagePathsUnchanged(committedRaw, currentRaw, 'object', [['activeSession']]);
  }
  // Another lesson may legitimately own the current legacy pointer; preserve it on the next save.
  return result.source;
}
