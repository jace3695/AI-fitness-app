import type { AudioProvenance, EvidenceEvent, EvidenceReceipt, ProjectionContext, TextVisibility } from './types.ts';

/** Inactive local protocol. None of these data types authenticate an owner. */
export const LOCAL_EVIDENCE_PROTOCOL = 'legacy-evidence-local-v1' as const;
export const MAX_EVENT_BYTES = 16 * 1024;
export const MAX_BATCH_BYTES = 256 * 1024;
export const MAX_BATCH_EVENTS = 50;
export const MAX_COMPATIBILITY_ANSWER_CHARS = 4096;
export type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
/** Future integration must obtain this from authenticated, reset-fenced context. */
export type LocalEvidenceContext = ProjectionContext & { ownerEpoch: number; freshness: 'fresh' | 'cached_offline' };
export type LocalFence = Pick<LocalEvidenceContext, 'ownerId' | 'generationId' | 'ownerEpoch'>;
export type LocalFailureCode = 'invalid_input' | 'unsupported_history' | 'unsupported_source' | 'stale_context' |
  'idb_unavailable' | 'idb_blocked' | 'idb_version_changed' | 'crypto_unavailable' | 'storage_quota' | 'storage_abort' |
  'storage_read_failed' | 'commit_unconfirmed' | 'checkpoint_conflict' | 'event_conflict' |
  'corrupt_record' | 'quarantined' | 'batch_limit' | 'compatibility_pending';
export class LocalEvidenceError extends Error {
  readonly code: LocalFailureCode;
  constructor(code: LocalFailureCode) { super(code); this.name = 'LocalEvidenceError'; this.code = code; }
}
export type FrozenEvidence = Immutable<{
  protocol: typeof LOCAL_EVIDENCE_PROTOCOL;
  ownerId: string; generationId: string; eventId: string; episodeId: string;
  sourceSlotKey: string; sequence: number; canonical: string; payloadHash: string;
}>;
export type Predecessor = { eventId: string; payloadHash: string; sequence: number } | null;
/** Exact already-entered input, local only; never part of an event or delivery request. */
export type CompatibilityHandoff = {
  eventId: string; draftToken: string; legacyQuestionId: string; lessonSessionId: string | null;
  answer: string; correct: boolean;
  observation: { responseMs?: number; neededHelp: boolean; modality: 'meaning' | 'listening' | 'typing' };
  status: 'pending' | 'applied';
};
export type CaptureCheckpoint = {
  version: 1; ownerId: string; generationId: string; sourceSlotKey: string; episodeId: string;
  checkpointRevision: number; nextSequence: number; predecessor: Exclude<Predecessor, null>;
  presentation: EvidenceEvent; lastOccurredAt: string; attemptStartedAt: string;
  hintUsed: boolean | null; answerPreviouslyRevealed: boolean | null;
  textVisibility: TextVisibility; audio: AudioProvenance;
  timingContinuity: 'continuous' | 'unknown'; answerReady: boolean;
  handoff: CompatibilityHandoff | null;
};
/** Exact checkpoint bytes prevent revision-only ABA/corruption from passing CAS. */
export type CheckpointExpectation = {
  checkpointRevision: number; predecessor: Exclude<Predecessor, null>; canonical: string;
} | null;
export type CheckpointAction =
  | { kind: 'hint' | 'reveal' | 'interruption' }
  | { kind: 'visibility'; visibility: TextVisibility }
  | { kind: 'retry'; occurredAt: string }
  | { kind: 'audio_requested'; requestId: string; sourceSlotKey: string; episodeId: string; promptMatchesTask: boolean | null }
  | { kind: 'audio_callback'; requestId: string; sourceSlotKey: string; episodeId: string; status: 'started' | 'completed' | 'aborted' | 'failed' }
  | { kind: 'compatibility_applied'; eventId: string; survivingDraftToken: string };
export type CaptureMutation = { kind: 'presentation'; timingObserved: boolean } | { kind: 'answer' } | { kind: 'checkpoint'; action: CheckpointAction };
export type PreparedCapture = Immutable<{
  version: 1; transitionId: string; fence: LocalFence;
  expected: CheckpointExpectation; checkpoint: CaptureCheckpoint; event: FrozenEvidence | null; mutation: CaptureMutation;
}>;
/** Mutable metadata never changes the event's canonical bytes. Local only. */
export type DeliveryMetadata = {
  ownerId: string; generationId: string; eventId: string; payloadHash: string; revision: number;
  status: 'pending' | 'readback_required' | 'quarantined';
};
export type FrozenBatch = Immutable<{
  version: 1; batchId: string; ownerId: string; generationId: string; sourceSlotKey: string; episodeId: string;
  expectedPredecessor: Predecessor; events: readonly FrozenEvidence[];
}>;
export type BatchDelivery = { revision: number; status: 'pending' | 'readback_required' | 'quarantined' };
/** Contract only. There is deliberately no constructor/acknowledgement API in this slice. */
declare const authenticatedReadback: unique symbol;
export type AuthenticatedReceiptReadback = {
  readonly [authenticatedReadback]: true;
  readonly context: LocalEvidenceContext;
  readonly batchId: string;
  readonly exactReceipts: readonly EvidenceReceipt[];
};
export type ReceiptTrust = 'unverified' | 'previously_verified_offline' | 'fresh_authenticated_readback';
export type PrefixStatus = 'unavailable' | 'partial' | 'complete_authenticated_prefix';
export type LocalCommitResult = { status: 'local_committed'; delivery: 'pending'; replay: boolean; checkpoint: Immutable<CaptureCheckpoint> };
