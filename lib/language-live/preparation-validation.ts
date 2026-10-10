import { isLiveUuid } from './learning-validation.ts';
import { LIVE_SKILLS } from './learning-types.ts';
import { isLiveCalendarDate } from './review-policy.ts';
import { LanguageLiveError, LIVE_REPORT_FIELDS } from './types.ts';
import { LIVE_PREPARATION_MAX_ITEMS, LIVE_PREPARATION_MAX_TEXT, LIVE_PREPARATION_TEMPLATE_VERSION, type SaveLivePreparationInput } from './preparation-types.ts';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => key in value);
const text = (value: unknown, max: number, empty = false): value is string => typeof value === 'string' && value.length <= max && (empty || Boolean(value.trim()));
const integer = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= 2_147_483_647;
const statuses = ['unlearned', 'learning', 'review_due', 'relearn_needed', 'mastery_confirmed'];

export function validateLivePreparationInput(value: unknown): string[] {
  const fail = ['수업 준비의 내용·출처·버전을 확인해 주세요.'];
  if (!object(value) || !exact(value, ['requestId', 'preparationId', 'expectedRevision', 'preparation', 'editedText', 'reviewed'])
    || !isLiveUuid(value.requestId) || !isLiveUuid(value.preparationId) || !integer(value.expectedRevision) || value.expectedRevision > 2_147_483_646 || value.reviewed !== true || !text(value.editedText, LIVE_PREPARATION_MAX_TEXT)) return fail;
  const p = value.preparation;
  if (!object(p) || !exact(p, ['templateVersion', 'policyVersion', 'forDate', 'timezone', 'maxItems', 'source', 'references', 'selected', 'warnings', 'generatedText'])
    || p.templateVersion !== LIVE_PREPARATION_TEMPLATE_VERSION || p.policyVersion !== 'live-review-v1' || !isLiveCalendarDate(p.forDate as string)
    || p.timezone !== 'Asia/Seoul' || !integer(p.maxItems, 1) || p.maxItems > LIVE_PREPARATION_MAX_ITEMS || !text(p.generatedText, LIVE_PREPARATION_MAX_TEXT)
    || !Array.isArray(p.warnings) || p.warnings.length > 20 || !p.warnings.every(warning => text(warning, 2000))
    || !Array.isArray(p.references) || p.references.length > 1000 || !Array.isArray(p.selected) || p.selected.length > p.maxItems) return fail;
  const source = p.source;
  if (!object(source) || !exact(source, ['ownerId', 'lessons', 'batches']) || !isLiveUuid(source.ownerId)
    || !Array.isArray(source.lessons) || source.lessons.length > 1000 || !Array.isArray(source.batches) || source.batches.length > 2000) return fail;
  const lessons = new Map<string, Record<string, unknown>>(), batches = new Set<string>();
  for (const lesson of source.lessons) {
    if (!object(lesson) || !exact(lesson, ['lessonId', 'revision', 'operation', 'payloadHash']) || !isLiveUuid(lesson.lessonId)
      || !integer(lesson.revision, 1) || !(typeof lesson.operation === 'string' && ['create', 'edit', 'delete', 'restore'].includes(lesson.operation)) || !text(lesson.payloadHash, 200) || lessons.has(lesson.lessonId)) return fail;
    lessons.set(lesson.lessonId, lesson);
  }
  for (const batch of source.batches) {
    if (!object(batch) || !exact(batch, ['lessonId', 'lessonRevision', 'version', 'payloadHash']) || !isLiveUuid(batch.lessonId)
      || !integer(batch.lessonRevision, 1) || !integer(batch.version, 1) || !text(batch.payloadHash, 200)) return fail;
    const lesson = lessons.get(batch.lessonId), key = `${batch.lessonId}:${batch.lessonRevision}:${batch.version}`;
    if (!lesson || Number(lesson.revision) < batch.lessonRevision || batches.has(key)) return fail;
    batches.add(key);
  }
  const seenReferences = new Set<string>();
  for (const reference of p.references) {
    if (!object(reference) || !exact(reference, ['lessonId', 'lessonRevision', 'fields']) || !isLiveUuid(reference.lessonId) || !integer(reference.lessonRevision, 1)
      || !Array.isArray(reference.fields) || !reference.fields.length || reference.fields.length > 25 || new Set(reference.fields).size !== reference.fields.length
      || !reference.fields.every(key => LIVE_REPORT_FIELDS.some(field => field.key === key))) return fail;
    const lesson = lessons.get(reference.lessonId);
    if (!lesson || lesson.operation === 'delete' || lesson.revision !== reference.lessonRevision || seenReferences.has(reference.lessonId)) return fail;
    seenReferences.add(reference.lessonId);
  }
  const selected = new Set<string>();
  for (const item of p.selected) {
    if (!object(item) || !exact(item, ['itemId', 'text', 'skill', 'status', 'nextDue', 'reason', 'events']) || !isLiveUuid(item.itemId)
      || !text(item.text, 500) || !LIVE_SKILLS.includes(item.skill as typeof LIVE_SKILLS[number]) || !(item.status === null || (typeof item.status === 'string' && statuses.includes(item.status)))
      || !(item.nextDue === null || isLiveCalendarDate(item.nextDue as string)) || !text(item.reason, 2000)
      || !Array.isArray(item.events) || !item.events.length || item.events.length > 21) return fail;
    const key = `${item.itemId}:${item.skill}`;
    if (selected.has(key)) return fail;
    selected.add(key);
    const seenEvents = new Set<string>();
    for (const event of item.events) {
      if (!object(event) || !exact(event, ['lessonId', 'lessonRevision', 'batchVersion', 'eventId']) || !isLiveUuid(event.lessonId) || !integer(event.lessonRevision, 1)
        || !integer(event.batchVersion, 1) || !isLiveUuid(event.eventId) || !seenReferences.has(event.lessonId)) return fail;
      const lesson = lessons.get(event.lessonId), key = `${event.lessonId}:${event.lessonRevision}:${event.batchVersion}`, eventKey = `${key}:${event.eventId}`;
      if (!lesson || lesson.operation === 'delete' || lesson.revision !== event.lessonRevision || !batches.has(key) || seenEvents.has(eventKey)) return fail;
      seenEvents.add(eventKey);
    }
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > 4_000_000) return fail;
  return [];
}
export function assertLivePreparationInput(value: unknown): asserts value is SaveLivePreparationInput {
  const problems = validateLivePreparationInput(value);
  if (problems.length) throw new LanguageLiveError('validation', problems.join(' '));
}
