import type { LiveEventReference, LiveLearningStatus, LiveSkill } from './learning-types.ts';
import type { LiveFieldKey, LiveLessonOperation } from './types.ts';

export const LIVE_PREPARATION_TEMPLATE_VERSION = 'live-preparation-v1' as const;
export const LIVE_PREPARATION_MAX_TEXT = 60_000;
export const LIVE_PREPARATION_MAX_ITEMS = 10;
/** Exact source-version vector, not an authentication token or cryptographic digest. */
export type LivePreparationSource = {
  ownerId: string;
  lessons: { lessonId: string; revision: number; operation: LiveLessonOperation; payloadHash: string }[];
  batches: { lessonId: string; lessonRevision: number; version: number; payloadHash: string }[];
};
export type LivePreparationReference = {
  lessonId: string; lessonRevision: number;
  fields: LiveFieldKey[];
};
export type LivePreparationSelection = {
  itemId: string; text: string; skill: LiveSkill;
  status: LiveLearningStatus | null; nextDue: string | null; reason: string;
  events: LiveEventReference[];
};
export type LivePreparation = {
  templateVersion: typeof LIVE_PREPARATION_TEMPLATE_VERSION;
  policyVersion: 'live-review-v1';
  forDate: string;
  timezone: 'Asia/Seoul';
  maxItems: number;
  source: LivePreparationSource;
  references: LivePreparationReference[];
  selected: LivePreparationSelection[];
  warnings: string[];
  generatedText: string;
};
export type SaveLivePreparationInput = {
  requestId: string;
  preparationId: string;
  expectedRevision: number;
  preparation: LivePreparation;
  editedText: string;
  reviewed: true;
};
export type LivePreparationRecord = {
  user_id: string; preparation_id: string; revision: number; previous_revision: number;
  request_id: string; payload: SaveLivePreparationInput; payload_hash: string; created_at: string;
};
