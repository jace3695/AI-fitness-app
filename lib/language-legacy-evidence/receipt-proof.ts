import { immutableCopy } from './canonical-hash.ts';
import { LocalEvidenceError, type AuthenticatedReceiptReadback, type Immutable, type LocalEvidenceContext, type LocalFence } from './persistence-types.ts';
import type { ServerEvidenceContext, ServerEvidenceReceipt } from './server-types.ts';

// This module is not a public trust factory. Source closure permits registration
// only from the authenticated repository, and consumption only from local-store.
// A serialized/copy-shaped object is never registered. The callback retains the
// repository's exact live registration, not a reconstructed public-field fence.
type Guard = { assertCurrent: () => void; fence: LocalFence };
const readbacks = new WeakMap<object, Guard>();
const contexts = new WeakMap<object, Guard>();
const prefixes = new WeakMap<object, Guard>();
declare const contextBrand: unique symbol;
declare const prefixBrand: unique symbol;
export type AuthenticatedContextProof = Immutable<{
  readonly [contextBrand]: true; context: LocalEvidenceContext; serverContext: ServerEvidenceContext;
}>;
export type AuthenticatedPrefixProof = Immutable<{
  readonly [prefixBrand]: true; context: LocalEvidenceContext; serverContext: ServerEvidenceContext;
  throughSequence: number; records: readonly ServerEvidenceReceipt[];
}>;
function register<T extends { context: LocalEvidenceContext }>(registry: WeakMap<object, Guard>, input: T, assertCurrent: () => void): Immutable<T> {
  assertCurrent();
  if (input.context.freshness !== 'fresh') throw new LocalEvidenceError('stale_context');
  const proof = immutableCopy(input);
  registry.set(proof, { assertCurrent, fence: { ownerId: input.context.ownerId, generationId: input.context.generationId, ownerEpoch: input.context.ownerEpoch } });
  assertCurrent();
  return proof;
}
function assertRegistered(registry: WeakMap<object, Guard>, proof: object, fence: LocalFence): void {
  const registration = registry.get(proof);
  if (!registration || registration.fence.ownerId !== fence.ownerId || registration.fence.generationId !== fence.generationId ||
    registration.fence.ownerEpoch !== fence.ownerEpoch) throw new LocalEvidenceError('stale_context');
  registration.assertCurrent();
}
/** Sole producer: app/data/languageLegacyEvidenceRepository.ts, after independent exact readback. */
export function registerAuthenticatedReceiptReadback(input: { context: LocalEvidenceContext; batchId: string; exactReceipts: readonly ServerEvidenceReceipt[] }, assertCurrent: () => void): AuthenticatedReceiptReadback {
  return register(readbacks, input, assertCurrent) as AuthenticatedReceiptReadback;
}
export function assertAuthenticatedReceiptReadback(proof: AuthenticatedReceiptReadback, fence: LocalFence): void {
  assertRegistered(readbacks, proof, fence);
}
export function registerAuthenticatedContext(input: { context: LocalEvidenceContext; serverContext: ServerEvidenceContext }, assertCurrent: () => void): AuthenticatedContextProof {
  return register(contexts, input, assertCurrent) as AuthenticatedContextProof;
}
export function assertAuthenticatedContext(proof: AuthenticatedContextProof, fence: LocalFence): void { assertRegistered(contexts, proof, fence); }
export function registerAuthenticatedPrefix(input: { context: LocalEvidenceContext; serverContext: ServerEvidenceContext; throughSequence: number; records: readonly ServerEvidenceReceipt[] }, assertCurrent: () => void): AuthenticatedPrefixProof {
  return register(prefixes, input, assertCurrent) as AuthenticatedPrefixProof;
}
export function assertAuthenticatedPrefix(proof: AuthenticatedPrefixProof, fence: LocalFence): void { assertRegistered(prefixes, proof, fence); }

// Enrollment and reset are separate from ordinary writer authority: neither may
// be reconstructed from cached context or a serialized verified flag.
import type { FrozenEnrollmentIntent } from './store-admission-types.ts';
type AdmissionStatusInput = {
  ownerId: string; ownerEpoch: number; resetMarker: { present: boolean; value: string | null };
  status: 'unenrolled' | 'enrolled' | 'enrolled_generation_missing';
  creationRequestId: string | null; initialGenerationId: string | null; currentContext: ServerEvidenceContext | null;
};
type FirstAdmissionInput = {
  ownerId: string; ownerEpoch: number; incarnationId: string; intent: FrozenEnrollmentIntent;
  currentContext: ServerEvidenceContext; creationRequestId: string; initialGenerationId: string;
};
type ResetEvidenceInput = {
  ownerId: string; ownerEpoch: number; requestId: string; resetMarker: { present: boolean; value: string | null };
  status: 'enrolled' | 'enrolled_generation_missing'; creationRequestId: string; initialGenerationId: string;
  context: ServerEvidenceContext | null;
};
declare const admissionStatusBrand: unique symbol;
declare const firstAdmissionBrand: unique symbol;
declare const resetEvidenceBrand: unique symbol;
export type AuthenticatedAdmissionStatusProof = Immutable<AdmissionStatusInput & { readonly [admissionStatusBrand]: true }>;
export type AuthenticatedFirstAdmissionProof = Immutable<FirstAdmissionInput & { readonly [firstAdmissionBrand]: true }>;
export type AuthenticatedResetEvidenceStateProof = Immutable<ResetEvidenceInput & { readonly [resetEvidenceBrand]: true }>;
const admissionStatuses = new WeakMap<object, () => void>();
const firstAdmissions = new WeakMap<object, () => void>();
const resetEvidenceStates = new WeakMap<object, () => void>();
function registerLive<T extends object>(registry: WeakMap<object, () => void>, input: T, assertCurrent: () => void): Immutable<T> {
  assertCurrent(); const proof = immutableCopy(input); registry.set(proof, assertCurrent); assertCurrent(); return proof;
}
function assertLive(registry: WeakMap<object, () => void>, proof: object): void {
  const guard = registry.get(proof); if (!guard) throw new LocalEvidenceError('stale_context'); guard();
}
/** Sole producers are the fixed authenticated repository operations. */
export function registerAuthenticatedAdmissionStatus(input: AdmissionStatusInput, assertCurrent: () => void): AuthenticatedAdmissionStatusProof {
  return registerLive(admissionStatuses, input, assertCurrent) as AuthenticatedAdmissionStatusProof;
}
export function assertAuthenticatedAdmissionStatus(proof: AuthenticatedAdmissionStatusProof): void { assertLive(admissionStatuses, proof); }
export function registerAuthenticatedFirstAdmission(input: FirstAdmissionInput, assertCurrent: () => void): AuthenticatedFirstAdmissionProof {
  return registerLive(firstAdmissions, input, assertCurrent) as AuthenticatedFirstAdmissionProof;
}
export function assertAuthenticatedFirstAdmission(proof: AuthenticatedFirstAdmissionProof): void { assertLive(firstAdmissions, proof); }
export function registerAuthenticatedResetEvidenceState(input: ResetEvidenceInput, assertCurrent: () => void): AuthenticatedResetEvidenceStateProof {
  return registerLive(resetEvidenceStates, input, assertCurrent) as AuthenticatedResetEvidenceStateProof;
}
export function assertAuthenticatedResetEvidenceState(proof: AuthenticatedResetEvidenceStateProof): void { assertLive(resetEvidenceStates, proof); }
