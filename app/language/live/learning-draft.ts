import { LIVE_REPORT_FIELDS, type LiveLesson } from '../../../lib/language-live/types.ts';
import { LIVE_EVENT_KINDS, LIVE_EVENT_RESULTS, LIVE_ITEM_KINDS, LIVE_REVIEW_POLICY_VERSION, LIVE_SKILLS, type LiveItemIdentity, type LiveLearningBatch, type LiveLearningEvent, type SaveLiveLearningInput } from '../../../lib/language-live/learning-types.ts';
import { isLiveUuid, validateLiveLearningEvent, validateLiveLearningInput } from '../../../lib/language-live/learning-validation.ts';

export type LiveLearningDraft = {
  version: 1;
  ownerId: string;
  draftId: string;
  updatedAt: string;
  input: SaveLiveLearningInput;
  reviewed: boolean;
  submitted: boolean;
  entry: LiveLearningEvent | null;
  entryReviewed: boolean;
};
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
export const learningDraftPrefix = (owner: string) => `yeoni-language-live:${owner}:learning-draft:v1:`;
export const learningDraftKey = (owner: string, id: string) => `${learningDraftPrefix(owner)}${id}`;

/** An unfinished event may have blank text or dates; validate its renderable shape only. */
function renderableEvent(value: unknown): value is LiveLearningEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as LiveLearningEvent;
  return isLiveUuid(e.eventId) && Boolean(e.item) && isLiveUuid(e.item.itemId) && LIVE_ITEM_KINDS.includes(e.item.kind) &&
    typeof e.item.text === 'string' && typeof e.item.meaning === 'string' && LIVE_SKILLS.includes(e.skill) &&
    LIVE_EVENT_KINDS.includes(e.kind) && LIVE_EVENT_RESULTS.includes(e.result) &&
    (e.occurredDate === null || typeof e.occurredDate === 'string') && ['confirmed', 'uncertain'].includes(e.certainty) &&
    (e.independent === null || typeof e.independent === 'boolean') && (e.hintUsed === null || typeof e.hintUsed === 'boolean') &&
    typeof e.forgettingConfirmed === 'boolean' && typeof e.evidenceText === 'string' && typeof e.reason === 'string' &&
    typeof e.relearningText === 'string' && LIVE_REPORT_FIELDS.some(field => field.key === e.sourceField) &&
    (e.linkedRelearningEventId === null || isLiveUuid(e.linkedRelearningEventId)) &&
    (e.teacherRecommendedDue === null || typeof e.teacherRecommendedDue === 'string') && typeof e.teacherRecommendationConfirmed === 'boolean';
}

export function readLearningDrafts(storage: StorageLike, owner: string): { drafts: LiveLearningDraft[]; unreadable: boolean } {
  const drafts: LiveLearningDraft[] = [];
  let unreadable = false;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(learningDraftPrefix(owner))) continue;
    try {
      const d = JSON.parse(storage.getItem(key) ?? 'null') as LiveLearningDraft;
      const input = d?.input;
      if (!d || d.version !== 1 || d.ownerId !== owner || !isLiveUuid(d.draftId) || learningDraftKey(owner, d.draftId) !== key ||
        typeof d.updatedAt !== 'string' || !Number.isFinite(Date.parse(d.updatedAt)) || typeof d.reviewed !== 'boolean' || typeof d.submitted !== 'boolean' ||
        typeof d.entryReviewed !== 'boolean' || (d.entry !== null && !renderableEvent(d.entry)) ||
        !input || !isLiveUuid(input.requestId) || !isLiveUuid(input.lessonId) || !Number.isSafeInteger(input.lessonRevision) || input.lessonRevision < 1 ||
        !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || input.confirmed !== true || input.policyVersion !== LIVE_REVIEW_POLICY_VERSION ||
        typeof input.changeReason !== 'string' || !Array.isArray(input.events) || !input.events.every(validateLiveLearningEvent) ||
        (d.submitted && (!d.reviewed || d.entry !== null || validateLiveLearningInput(input).length > 0))) throw new Error('invalid');
      drafts.push(d);
    } catch { unreadable = true; }
  }
  return { drafts: drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), unreadable };
}

/** Every recovery has a fresh writable key; pending request and payload stay exact. */
export function forkLearningDraft(draft: LiveLearningDraft, id: string, now: string): LiveLearningDraft {
  if (id === draft.draftId || !isLiveUuid(id)) throw new Error('fresh_draft_id_required');
  return structuredClone({ ...draft, draftId: id, updatedAt: now });
}

export function persistLearningDraft(storage: StorageLike, draft: LiveLearningDraft, expected: string | null): string {
  const key = learningDraftKey(draft.ownerId, draft.draftId);
  if (storage.getItem(key) !== expected) throw new Error('draft_changed');
  const encoded = JSON.stringify(draft);
  storage.setItem(key, encoded);
  if (storage.getItem(key) !== encoded) throw new Error('draft_changed');
  return encoded;
}
export function removeLearningDraft(storage: StorageLike, draft: LiveLearningDraft, expected: string | null): boolean {
  const key = learningDraftKey(draft.ownerId, draft.draftId);
  if (expected === null || storage.getItem(key) !== expected) return false;
  storage.removeItem(key);
  return true;
}

export function blankLearningEvent(eventId: string, itemId: string, date: string | null): LiveLearningEvent {
  return { eventId, item: { itemId, kind: 'kana', text: '', meaning: '' }, skill: 'reading', kind: 'learn', result: 'not_assessed',
    occurredDate: date, certainty: 'uncertain', independent: null, hintUsed: null, forgettingConfirmed: false,
    evidenceText: '', sourceField: 'reading', reason: '', relearningText: '', linkedRelearningEventId: null,
    teacherRecommendedDue: null, teacherRecommendationConfirmed: false };
}

/** Never extracts assessments from text or re-dates copied observations. */
export function createLearningDraft(ownerId: string, lesson: LiveLesson, current: LiveLearningBatch | undefined,
  ids: { draftId: string; requestId: string; now: string }, source?: LiveLearningBatch): LiveLearningDraft {
  if (lesson.user_id !== ownerId || lesson.operation === 'delete' || (current && (current.user_id !== ownerId || current.lesson_id !== lesson.lesson_id || current.lesson_revision !== lesson.revision)) ||
    (source && (source.user_id !== ownerId || source.lesson_id !== lesson.lesson_id))) throw new Error('source_mismatch');
  return { version: 1, ownerId, draftId: ids.draftId, updatedAt: ids.now, reviewed: false, submitted: false, entry: null, entryReviewed: false,
    input: { requestId: ids.requestId, lessonId: lesson.lesson_id, lessonRevision: lesson.revision, expectedVersion: current?.version ?? 0,
      confirmed: true, policyVersion: LIVE_REVIEW_POLICY_VERSION, events: structuredClone((source ?? current)?.payload.events ?? []), changeReason: '' } };
}

export function learningSourceProblems(event: LiveLearningEvent, lesson: LiveLesson): string[] {
  const problems: string[] = [];
  if (!validateLiveLearningEvent(event)) problems.push('항목·영역·평가 결과·날짜·근거를 확인해 주세요.');
  const field = lesson.report.fields[event.sourceField];
  if (!event.evidenceText.trim() || !field.text.includes(event.evidenceText)) problems.push('근거는 선택한 보고서 항목에서 그대로 옮겨 주세요.');
  if (['unknown', 'none'].includes(field.presence) && event.certainty !== 'uncertain' && event.result !== 'uncertain') problems.push('미확인·해당 없음인 보고서 항목은 확정 평가로 바꿀 수 없어요.');
  if (field.presence === 'not_learned' && event.kind !== 'not_learned' && event.certainty !== 'uncertain' && event.result !== 'uncertain') problems.push('미학습으로 보고된 항목은 학습·성공 평가로 확정할 수 없어요.');
  return problems;
}

export function knownLearningItems(batches: LiveLearningBatch[], draft?: LiveLearningDraft | null): LiveItemIdentity[] {
  return [...new Map([...batches.flatMap(batch => batch.payload.events), ...(draft?.input.events ?? [])].map(event => [event.item.itemId, event.item])).values()];
}
