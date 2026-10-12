import { LIVE_REPORT_FIELDS, LanguageLiveError } from './types.ts';
import { parseLiveLessonDate } from './validation.ts';
import { LIVE_EVENT_KINDS, LIVE_EVENT_RESULTS, LIVE_ITEM_KINDS, LIVE_REVIEW_POLICY_VERSION, LIVE_SKILLS, type LiveItemIdentity, type LiveLearningEvent, type SaveLiveLearningInput } from './learning-types.ts';

export const LIVE_LEARNING_MAX_EVENTS = 100;
export const LIVE_LEARNING_MAX_BYTES = 250_000;
export const isLiveUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export const isLiveDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && parseLiveLessonDate(value) === value;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every(key => key in value);
const text = (value: unknown, maximum: number, required = false) => typeof value === 'string' && value.length <= maximum && (!required || value.trim().length > 0);
const nullableBoolean = (value: unknown) => value === null || typeof value === 'boolean';
const nullableDate = (value: unknown) => value === null || isLiveDate(value);
const itemKeys = ['itemId', 'kind', 'text', 'meaning'];
const eventKeys = ['eventId', 'item', 'skill', 'kind', 'result', 'occurredDate', 'certainty', 'independent', 'hintUsed', 'forgettingConfirmed', 'evidenceText', 'sourceField', 'reason', 'relearningText', 'linkedRelearningEventId', 'teacherRecommendedDue', 'teacherRecommendationConfirmed'];
const inputKeys = ['requestId', 'lessonId', 'lessonRevision', 'expectedVersion', 'confirmed', 'policyVersion', 'events', 'changeReason'];

/** Item identity preserves orthography and meaning. Matching proposes; it never merges. */
export function liveItemIdentityKey(item: Pick<LiveItemIdentity, 'kind' | 'text' | 'meaning'>): string {
  return JSON.stringify([item.kind, item.text, item.meaning]);
}

export function validateLiveItem(value: unknown): value is LiveItemIdentity {
  return record(value) && keys(value, itemKeys) && isLiveUuid(value.itemId) && LIVE_ITEM_KINDS.includes(value.kind as LiveItemIdentity['kind']) &&
    text(value.text, 500, true) && text(value.meaning, 1000);
}

export function validateLiveLearningEvent(value: unknown): value is LiveLearningEvent {
  if (!record(value) || !keys(value, eventKeys)) return false;
  const event = value as LiveLearningEvent;
  if (!isLiveUuid(event.eventId) || !validateLiveItem(event.item) || !LIVE_SKILLS.includes(event.skill) ||
    !LIVE_EVENT_KINDS.includes(event.kind) || !LIVE_EVENT_RESULTS.includes(event.result) || !nullableDate(event.occurredDate) ||
    !['confirmed', 'uncertain'].includes(event.certainty) || !nullableBoolean(event.independent) || !nullableBoolean(event.hintUsed) ||
    typeof event.forgettingConfirmed !== 'boolean' || !text(event.evidenceText, 5000, true) || !text(event.reason, 1000, true) ||
    !text(event.relearningText, 5000) || !LIVE_REPORT_FIELDS.some(field => field.key === event.sourceField) ||
    !(event.linkedRelearningEventId === null || isLiveUuid(event.linkedRelearningEventId)) ||
    !nullableDate(event.teacherRecommendedDue) || typeof event.teacherRecommendationConfirmed !== 'boolean') return false;
  if (event.result === 'independent_correct' && (event.independent !== true || event.hintUsed !== false)) return false;
  if (event.result === 'hinted_correct' && (event.hintUsed !== true || event.independent !== false)) return false;
  if (event.result !== 'independent_correct' && event.independent === true) return false;
  if (['learn', 'not_learned', 'relearn'].includes(event.kind) && event.result !== 'not_assessed') return false;
  if (event.kind === 'not_learned' && event.certainty !== 'confirmed') return false;
  if (event.kind === 'relearn' && !event.relearningText.trim()) return false;
  if (event.forgettingConfirmed && (event.certainty !== 'confirmed' || !['incorrect', 'cannot_recall'].includes(event.result))) return false;
  if ((event.kind === 'reassessment') !== (event.linkedRelearningEventId !== null)) return false;
  if (event.linkedRelearningEventId === event.eventId) return false;
  if (event.teacherRecommendationConfirmed && (!event.teacherRecommendedDue || !event.occurredDate || event.teacherRecommendedDue < event.occurredDate)) return false;
  return true;
}

export function validateLiveLearningInput(value: unknown): string[] {
  if (!record(value) || !keys(value, inputKeys)) return ['복습 기록 형식을 확인해 주세요.'];
  const input = value as SaveLiveLearningInput;
  if (!isLiveUuid(input.requestId) || !isLiveUuid(input.lessonId) || !Number.isSafeInteger(input.lessonRevision) || input.lessonRevision < 1 || input.lessonRevision > 2_147_483_647 ||
    !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion > 2_147_483_646 ||
    input.confirmed !== true || input.policyVersion !== LIVE_REVIEW_POLICY_VERSION || !text(input.changeReason, 1000, true)) return ['확인한 수업·버전·복습 기록의 변경 이유를 확인해 주세요.'];
  if (!Array.isArray(input.events) || input.events.length > LIVE_LEARNING_MAX_EVENTS || !input.events.every(validateLiveLearningEvent)) return ['항목·학습 영역·평가 근거를 확인해 주세요. 확인하지 않은 평가는 자동으로 저장하지 않아요.'];
  const eventIds = new Set<string>();
  const identities = new Map<string, string>(), itemIds = new Map<string, string>();
  for (const event of input.events) {
    if (eventIds.has(event.eventId)) return ['같은 평가를 한 번만 포함해 주세요.'];
    eventIds.add(event.eventId);
    const identity = liveItemIdentityKey(event.item);
    if ((identities.has(identity) && identities.get(identity) !== event.item.itemId) ||
      (itemIds.has(event.item.itemId) && itemIds.get(event.item.itemId) !== identity)) return ['같은 학습 항목은 기존 항목과 연결하고, 다른 뜻은 구분해 주세요.'];
    identities.set(identity, event.item.itemId); itemIds.set(event.item.itemId, identity);
    if (event.linkedRelearningEventId) {
      const linked = input.events.find(candidate => candidate.eventId === event.linkedRelearningEventId);
      if (linked && (linked.kind !== 'relearn' || linked.item.itemId !== event.item.itemId || linked.skill !== event.skill ||
        (event.occurredDate && linked.occurredDate && linked.occurredDate > event.occurredDate))) return ['재평가와 같은 항목·영역의 재학습 기록을 연결해 주세요.'];
    }
  }
  try { if (new TextEncoder().encode(JSON.stringify(input)).length > LIVE_LEARNING_MAX_BYTES) return ['한 번에 저장할 복습 기록은 250KB까지 가능해요. 내용을 잘라내지 않았어요.']; }
  catch { return ['복습 기록의 저장 형식을 확인해 주세요.']; }
  return [];
}

export function assertLiveLearningInput(value: unknown): asserts value is SaveLiveLearningInput {
  const problems = validateLiveLearningInput(value);
  if (problems.length) throw new LanguageLiveError('validation', problems.join('\n'));
}

export function matchLiveItem(candidate: Pick<LiveItemIdentity, 'kind' | 'text' | 'meaning'>, known: LiveItemIdentity[]): LiveItemIdentity[] {
  const identity = liveItemIdentityKey(candidate);
  return Array.from(new Map(known.filter(item => liveItemIdentityKey(item) === identity).map(item => [item.itemId, item])).values());
}
