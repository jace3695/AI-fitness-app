import { createAssessmentAdapter, type SourceDefinition } from './assessment-core.ts';

// Deliberately empty. Enabling a producer requires a separately authorized code
// change and a reviewed adapter/receipt contract, never JSON, env or local flags.
export const PRODUCTION_ASSESSMENT_SOURCES: readonly SourceDefinition[] = Object.freeze([]);
export const assessConversationTurn = createAssessmentAdapter(PRODUCTION_ASSESSMENT_SOURCES);
export type { AssessmentOutcome, AssessmentRequest, VerifiedAssessment } from './contract.ts';
