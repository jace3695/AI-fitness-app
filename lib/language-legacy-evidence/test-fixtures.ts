import { createHash } from 'node:crypto';
import { LEGACY_EVIDENCE_CATALOGUE } from './catalogue.ts';
import { canonicalEvidence, makeSourceSlotKey } from './validation.ts';
import type { EvidenceEvent, EvidenceSnapshot, ProjectionContext, TaskDescriptor, TaskFormat } from './types.ts';
export const uuid = (id: number) => `${id.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
let next = 100;
export const id = () => uuid(next++);
export const base = Date.parse('2026-01-01T00:00:00.000Z');
export const at = (days: number, ms = 0) => new Date(base + days * 86_400_000 + ms).toISOString();
export const context = (days = 0): ProjectionContext => ({ ownerId: uuid(1), generationId: uuid(2), prospectiveStartedAt: at(0), studyDayTimezone: 'Asia/Seoul', now: at(days, 10_000) });
export const meaningTask = LEGACY_EVIDENCE_CATALOGUE.find(task => task.legacyQuestionId === 'f01:2')!;
export const typedTask = LEGACY_EVIDENCE_CATALOGUE.find(task => task.legacyQuestionId === 'f01:3')!;
export const listeningTask = LEGACY_EVIDENCE_CATALOGUE.find(task => task.legacyQuestionId === 'f13:0')!;
export const catalogue = [meaningTask, typedTask, listeningTask];
export function episode(day: number, options: { task?: TaskDescriptor; format?: TaskFormat; answers?: Partial<EvidenceEvent>[]; presentationOnly?: boolean; millisecond?: number } = {}): EvidenceEvent[] {
  const task = options.task ?? meaningTask, format = options.format ?? 'meaning_choice', episodeId = id();
  const binding = task.bindings.find(binding => binding.source === 'course_review' && binding.taskFormat === format)!;
  const start = options.millisecond ?? 0;
  const common = { schemaVersion: 1 as const, generationId: uuid(2), episodeId, sourceSlotKey: '', source: 'course_review' as const,
    lessonId: task.lessonId, legacyQuestionId: task.legacyQuestionId, itemId: task.itemId, contentRevision: task.contentRevision, taskId: task.taskId,
    gradingVersion: binding.gradingVersion, taskFormat: format, recordTimezone: 'Asia/Seoul', hintUsed: false, answerPreviouslyRevealed: false,
    audio: format === 'listening_choice' ? { status: 'completed' as const, requestId: id(), promptMatchesTask: true } : { status: 'not_requested' as const, promptMatchesTask: null },
    textVisibility: { targetText: false, reading: false, meaning: format !== 'listening_choice', choices: format !== 'typed_answer' },
  };
  common.sourceSlotKey = makeSourceSlotKey(uuid(1), common);
  const presented: EvidenceEvent = { ...structuredClone(common), eventId: id(), sequence: 0, kind: 'exercise_presented', correct: null,
    occurredAt: at(day, start), isRetry: false, responseMs: null, timingComplete: false };
  if (options.presentationOnly) return [presented];
  return [presented, ...(options.answers ?? [{}]).map((overrides, index) => ({ ...structuredClone(common), eventId: id(), sequence: index + 1,
    kind: 'answer_submitted', correct: true, occurredAt: at(day, start + 1_000 + index), isRetry: index > 0, responseMs: 1_000, timingComplete: true,
    ...overrides,
  }) as EvidenceEvent)];
}
export function snapshot(events: EvidenceEvent[]): EvidenceSnapshot {
  const ctx = context();
  return { schemaVersion: 1, ownerId: ctx.ownerId, generationId: ctx.generationId, prospectiveStartedAt: ctx.prospectiveStartedAt, studyDayTimezone: ctx.studyDayTimezone,
    completeness: { status: 'complete', throughServerSequence: events.length },
    records: events.map((event, index) => ({ ownerId: ctx.ownerId, event, receivedAt: event.occurredAt, serverSequence: index + 1,
      payloadHash: createHash('sha256').update(canonicalEvidence(event)).digest('hex'),
    })),
  };
}
