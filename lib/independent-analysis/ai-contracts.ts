import type { SnapshotInput } from './contracts.ts';
import type { projectAnalysisFacts } from './index.ts';

/** PHASE D preparation only. These contracts do not authorize a live integration. */
export type AnalysisDomain = 'weight' | 'workout' | 'spending';
export type AnalysisTier = 'routine' | 'complex';
export type MinimalFacts = ReturnType<typeof projectAnalysisFacts>;
export interface ModelSelection { provider: string; model: string; tier: AnalysisTier }
export interface MockAnalysisInput {
  mode: 'mock_only'; requestId: string; ownerId: string; snapshot: SnapshotInput;
  selection: ModelSelection; domains: AnalysisDomain[];
  need: 'meaningful_change' | 'complex_review' | 'no_meaningful_change' | 'insufficient_data';
  budget: {
    currency: 'KRW'; overallLimitMicros: number | null;
    analysisLimit: { enabled: false } | { enabled: true; limitMicros: number | null };
    maxRequestMicros: number; policyVersion: string;
  };
  /** Synthetic bound only, never an assertion about current provider prices. */
  price: ModelSelection & {
    kind: 'synthetic_fixture'; version: string; validFrom: string; expiresAt: string;
    currency: 'KRW'; maximumChargeMicros: number; maxOutputTokens: number;
    completePayloadAndAllBillableUnitsBounded: true;
  };
}
export interface AnalysisConsent {
  status: 'granted' | 'revoked'; ownerId: string; requestId: string; revision: string;
  provider: string; model: string; purpose: 'independent_daily_analysis';
  dataScope: 'minimal_recorded_metrics_v1'; domains: AnalysisDomain[];
  frequency: 'single_mock_attempt'; validFrom: string; expiresAt: string;
}
export interface MockProviderRequest extends ModelSelection {
  mode: 'mock_only'; purpose: 'independent_daily_analysis';
  instructions: string; maxOutputTokens: number; evidence: MinimalFacts;
}
export interface ReservationBinding {
  requestId: string; ownerId: string; consentRevision: string; priceVersion: string;
  policyVersion: string; provider: string; model: string; currency: 'KRW';
  maximumChargeMicros: number; overallLimitMicros: number;
  analysisLimit: MockAnalysisInput['budget']['analysisLimit'];
  /** Exact comparison in mocks. NOT a cryptographic identity/idempotency scheme. */
  payloadJson: string;
}
export type ReservationResult =
  | { status: 'reserved'; binding: ReservationBinding; atomicOverallAndCategoryCheck: true }
  | { status: 'denied' | 'duplicate' | 'uncertain' };
export interface MockAdapterDependencies {
  /** All dependencies must be local synthetic fixtures. No production implementations exist. */
  now: () => string;
  readConsent: (ownerId: string, requestId: string) => Promise<AnalysisConsent | null>;
  provider: ModelSelection & { kind: 'mock'; generate: (request: MockProviderRequest) => Promise<unknown> };
  budget: {
    kind: 'mock';
    /** Must atomically count all spent/reserved/uncertain/fixed liabilities and deduplicate requests. */
    reserve: (binding: ReservationBinding) => Promise<ReservationResult>;
    /** One-way claim. Recheck current authorization/budgets and bind a fencing token
     * in a future durable implementation. Duplicate/uncertain claims MUST NOT dispatch. */
    claimDispatch: (binding: ReservationBinding) => Promise<'claimed' | 'denied' | 'uncertain'>;
    /** Preserve full cost, including overruns, and block further reservations on an overrun. */
    settle: (binding: ReservationBinding, usage: ConfirmedMockUsage) => Promise<'recorded' | 'uncertain'>;
    /** Atomically preserve at least this unresolved liability without erasing any
     * confirmed cost, and block all new dispatches when requested. Never a refund. */
    holdUnknown: (binding: ReservationBinding, liability: UnknownMockLiability) => Promise<'recorded' | 'uncertain'>;
  };
}
export interface UnknownMockLiability {
  retainedChargeMicros: number; blockFurtherDispatch: boolean;
}
export interface ConfirmedMockUsage {
  inputTokens: number; outputTokens: number; actualChargeMicros: number;
  currency: 'KRW'; overrun: boolean;
}
export type AnalysisSection = 'summary' | 'important_change' | 'positive_change' | 'caution'
  | 'possible_cause' | 'judgment' | 'today_action' | 'long_term_check' | 'user_question';
export interface CandidateClaim {
  section: AnalysisSection; kind: 'fact' | 'inference' | 'recommendation' | 'question';
  text: string; evidenceIds: string[];
  numbers: { evidenceId: string; value: number; unit: string }[];
}
export interface AnalysisCandidate {
  schemaVersion: 1; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; claims: CandidateClaim[];
}
export interface MockAnalysisOutcome {
  mode: 'mock_only'; state: 'blocked' | 'held' | 'review_required'; reason: string;
  dispatch: 'not_attempted' | 'attempted'; accounting: 'not_reserved' | 'retained' | 'settled' | 'uncertain';
  retainedChargeMicros: number | null; actualChargeMicros: number | null;
  blockFurtherDispatch: boolean; candidate?: AnalysisCandidate;
}
