import type { LiveFieldKey, LiveLesson } from './types.ts';

/** Product policy, not a validated proficiency score or a teacher replacement. */
export const LIVE_REVIEW_POLICY_VERSION = 'live-review-v1' as const;
export const LIVE_SKILLS = ['listening', 'speaking', 'reading', 'writing'] as const;
export type LiveSkill = typeof LIVE_SKILLS[number];
export const LIVE_ITEM_KINDS = ['kana', 'word', 'grammar', 'expression', 'sentence', 'other'] as const;
export type LiveItemKind = typeof LIVE_ITEM_KINDS[number];
export type LiveLearningStatus = 'unlearned' | 'learning' | 'review_due' | 'relearn_needed' | 'mastery_confirmed';
export const LIVE_EVENT_KINDS = ['not_learned', 'learn', 'review', 'forgetting', 'relearn', 'reassessment'] as const;
export const LIVE_EVENT_RESULTS = ['independent_correct', 'hinted_correct', 'incorrect', 'cannot_recall', 'uncertain', 'not_assessed'] as const;
export type LiveItemIdentity = {
  itemId: string;
  kind: LiveItemKind;
  /** Exact confirmed spelling, never NFKC-normalized or machine-corrected. */
  text: string;
  /** Distinguishes homographs/uses; an empty string means no separate sense recorded. */
  meaning: string;
};
export type LiveLearningEvent = {
  eventId: string;
  item: LiveItemIdentity;
  skill: LiveSkill;
  kind: typeof LIVE_EVENT_KINDS[number];
  result: typeof LIVE_EVENT_RESULTS[number];
  occurredDate: string | null;
  certainty: 'confirmed' | 'uncertain';
  independent: boolean | null;
  hintUsed: boolean | null;
  forgettingConfirmed: boolean;
  /** Explicitly confirmed structured observations, not automatic free-text inference. */
  evidenceText: string;
  sourceField: LiveFieldKey;
  reason: string;
  relearningText: string;
  linkedRelearningEventId: string | null;
  /** Original recommendation remains separate from the policy's computed due date. */
  teacherRecommendedDue: string | null;
  teacherRecommendationConfirmed: boolean;
};
export type SaveLiveLearningInput = {
  requestId: string;
  lessonId: string;
  lessonRevision: number;
  expectedVersion: number;
  confirmed: true;
  policyVersion: typeof LIVE_REVIEW_POLICY_VERSION;
  /** Full replacement for this lesson revision. Empty clears current evidence only. */
  events: LiveLearningEvent[];
  changeReason: string;
};
export type LiveLearningBatch = {
  user_id: string;
  lesson_id: string;
  lesson_revision: number;
  version: number;
  previous_version: number;
  request_id: string;
  payload: SaveLiveLearningInput;
  payload_hash: string;
  created_at: string;
};
export type LiveLearningSnapshot = {
  ownerId: string;
  /** One transaction-consistent database snapshot, including tombstones. */
  lessons: LiveLesson[];
  batches: LiveLearningBatch[];
};
export type LiveEventReference = { lessonId: string; lessonRevision: number; batchVersion: number; eventId: string };
export type LiveLearningTransition = LiveEventReference & {
  event: LiveLearningEvent;
  previousStatus: LiveLearningStatus | null;
  status: LiveLearningStatus | null;
  policyDue: string | null;
  nextDue: string | null;
  reason: string;
};
export type LiveSkillState = {
  item: LiveItemIdentity;
  skill: LiveSkill;
  /** Null is unknown, never implicitly unlearned or mastered. */
  status: LiveLearningStatus | null;
  firstLearnedDate: string | null;
  lastReviewedDate: string | null;
  lastAssessedDate: string | null;
  lastResult: LiveLearningEvent['result'] | null;
  lastEvidence: string | null;
  nextDue: string | null;
  policyDue: string | null;
  intervalDays: number | null;
  reviewCount: number;
  errorCount: number;
  independentSuccessCount: number;
  uncertainCount: number;
  needsAssessment: boolean;
  masteryHistory: LiveEventReference[];
  history: LiveLearningTransition[];
};
export type LiveLearningProjection = {
  policyVersion: typeof LIVE_REVIEW_POLICY_VERSION;
  states: LiveSkillState[];
  activeBatches: LiveLearningBatch[];
  inactiveBatches: LiveLearningBatch[];
  /** Latest non-deleted source revisions that have no confirmed evidence yet. */
  unconfirmedLessons: LiveLesson[];
};
