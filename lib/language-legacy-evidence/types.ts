/** Prospective course evidence only. No legacy aggregate, Live or speaking adapter. */
export type EvidenceReference = { itemId: string; contentRevision: number; taskId: string };
export type TaskFormat = 'meaning_choice' | 'listening_choice' | 'typed_answer';
export type EvidenceModality = 'meaning' | 'listening' | 'typing';
export type EvidenceSource = 'course_lesson' | 'course_review' | 'item_practice';
export type RecordTimezone = string; // Validated IANA zone or ±HH:MM (maximum ±14:00).
export type AudioProvenance = {
  status: 'not_requested' | 'started' | 'completed' | 'aborted' | 'failed' | 'unknown';
  requestId?: string;
  promptMatchesTask: boolean | null;
};
export type TextVisibility = { targetText: boolean | null; reading: boolean | null; meaning: boolean | null; choices: boolean | null };
type EventBase = EvidenceReference & {
  schemaVersion: 1; eventId: string; generationId: string; episodeId: string;
  sourceSlotKey: string; sequence: number; source: EvidenceSource;
  lessonId: string; legacyQuestionId?: string; lessonSessionId?: string;
  gradingVersion: string; taskFormat: TaskFormat; occurredAt: string; recordTimezone: RecordTimezone;
  hintUsed: boolean | null; answerPreviouslyRevealed: boolean | null; isRetry: boolean;
  responseMs: number | null; timingComplete: boolean; audio: AudioProvenance; textVisibility: TextVisibility;
};
export type EvidenceEvent = EventBase & (
  { kind: 'exercise_presented'; correct: null } | { kind: 'answer_submitted'; correct: boolean }
);
/** Server fields never replace or mutate the exact event. Hash verification belongs to the repository. */
export type EvidenceReceipt = { ownerId: string; event: EvidenceEvent; payloadHash: string; receivedAt: string; serverSequence: number };
export type EvidenceSnapshot = {
  schemaVersion: 1; ownerId: string; generationId: string; prospectiveStartedAt: string;
  studyDayTimezone: RecordTimezone;
  completeness: { status: 'complete' | 'partial' | 'unavailable'; throughServerSequence: number };
  records: EvidenceReceipt[];
};
/** Caller must obtain these from its authenticated, reset-fenced context, not from the payload. */
export type ProjectionContext = {
  ownerId: string; generationId: string; prospectiveStartedAt: string; studyDayTimezone: RecordTimezone; now: string;
};
export type TaskDescriptor = EvidenceReference & {
  lessonId: string; legacyQuestionId?: string;
  bindings: readonly { source: EvidenceSource; taskFormat: TaskFormat; gradingVersion: string }[];
};
export type StudyStage = 'not_started' | 'learning' | 'completed_once' | 'needs_review' | 'almost_learned' | 'long_term_record';
export type Coverage = 'unobserved' | 'partial' | 'observed' | 'unavailable';
export type EvidenceWarning = { code: string; eventIds: string[] };
export type ModalityProjection = {
  itemId: string; contentRevision: number; modality: EvidenceModality; coverage: Coverage;
  stage: StudyStage | null; historicalHighestStage: StudyStage | null;
  presentations: number; responses: number; correctResponses: number; wrongResponses: number;
  helpedResponses: number; retryResponses: number; unknownProvenanceResponses: number;
  lastOutcome: { correct: boolean; helped: boolean | null; isRetry: boolean; occurredAt: string; eventId: string; audio: AudioProvenance; textVisibility: TextVisibility } | null;
  qualifiedDates: string[]; qualifiedEventIds: string[]; historicalEvidenceIds: string[];
  suggestedDueAt: string | null; suggestedIntervalDays: number | null;
  warnings: EvidenceWarning[];
};
export type EvidenceProjection = {
  policyVersion: 'legacy-study-v1'; checkedAt: string; studyDayTimezone: string;
  status: 'complete' | 'partial' | 'unavailable'; coverageScope: 'prospective_course_exercises';
  pairs: ModalityProjection[]; warnings: EvidenceWarning[]; historicalModalities: 'unknown'; speaking: 'unobserved';
};
