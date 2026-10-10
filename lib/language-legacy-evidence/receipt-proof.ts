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
