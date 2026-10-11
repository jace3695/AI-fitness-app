import { captureStorageOwner, hasStorageTransaction, isStorageOwnerCurrent, readDesiredStorageOwner, readStorageSnapshot, StorageSessionChangedError, type StorageOwnerToken, type StorageReader } from './storageTransaction.ts';
import { languageMetadataReadyForEpoch } from './languageStorageBoundary.ts';
import { isRecordResetRunning } from './appRecordReset.ts';

/** Same-document wake only. Consumers must validate the registered lease and
 * independently authenticate before creating their own runtime authority. */
export const AUTHENTICATED_STORAGE_OWNER_READY_EVENT = 'yeoni-authenticated-storage-owner-ready';
export const AUTHENTICATED_STORAGE_OWNER_RECHECK_EVENT = 'yeoni-authenticated-storage-owner-recheck';
export const AUTHENTICATED_STORAGE_OWNER_RECHECK_READY_EVENT = 'yeoni-authenticated-storage-owner-recheck-ready';

/** A bounded request for fresh verification, never serialized authority. */
export interface AuthenticatedStorageOwnerRecheck {
  readonly userId: string;
  readonly epoch: string;
  readonly signal: AbortSignal;
}
type RecheckRegistration = { storage: StorageReader; retirement: object; controller: AbortController;
  issuedAt: number; state: 'pending' | 'consumed' | 'cancelled'; claimed: boolean; proof?: AuthenticatedStorageOwner; onConsumed?: () => void };
const rechecks = new WeakMap<object, RecheckRegistration>();
const requestedProofs = new WeakSet<object>();
let verificationSerial = 0;

function assertRecheckReady(storage: StorageReader, owner: StorageOwnerToken) {
  const desired = readDesiredStorageOwner(storage), snapshot = readStorageSnapshot(storage);
  if (!owner.userId || !owner.epoch || isRecordResetRunning() || desired?.userId !== owner.userId || desired.epoch !== owner.epoch
    || snapshot.pending || hasStorageTransaction(storage) || !languageMetadataReadyForEpoch(snapshot, owner)
    || !isStorageOwnerCurrent(storage, owner)) throw new StorageSessionChangedError();
}

export function createAuthenticatedStorageOwnerRecheck(storage: StorageReader, owner: StorageOwnerToken, retirement: object): AuthenticatedStorageOwnerRecheck {
  assertRecheckReady(storage, owner);
  const controller = new AbortController();
  const request = Object.freeze({ userId: owner.userId!, epoch: owner.epoch!, signal: controller.signal });
  rechecks.set(request, { storage, retirement, controller, issuedAt: verificationSerial, state: 'pending', claimed: false });
  return request;
}
function recheckRegistration(request: AuthenticatedStorageOwnerRecheck, storage: StorageReader, retirement?: object) {
  const entry = request && typeof request === 'object' ? rechecks.get(request) : undefined;
  if (!entry || entry.storage !== storage || entry.state !== 'pending' || entry.controller.signal.aborted
    || (retirement && entry.retirement !== retirement)) throw new StorageSessionChangedError();
  assertRecheckReady(storage, request);
  return entry;
}
export function assertAuthenticatedStorageOwnerRecheck(request: AuthenticatedStorageOwnerRecheck, storage: StorageReader, retirement?: object): void {
  recheckRegistration(request, storage, retirement);
}
export function claimAuthenticatedStorageOwnerRecheck(request: AuthenticatedStorageOwnerRecheck, storage: StorageReader) {
  const entry = recheckRegistration(request, storage);
  if (entry.claimed) throw new StorageSessionChangedError();
  entry.claimed = true;
}
export function registerAuthenticatedStorageOwnerRecheckProof(request: AuthenticatedStorageOwnerRecheck, proof: AuthenticatedStorageOwner, storage: StorageReader, onConsumed: () => void) {
  const entry = recheckRegistration(request, storage);
  assertAuthenticatedStorageOwner(proof);
  if (!entry.claimed || entry.proof || proof.userId !== request.userId || proof.epoch !== request.epoch
    || leases.get(proof)!.storage !== storage || leases.get(proof)!.startedAt <= entry.issuedAt) throw new StorageSessionChangedError();
  entry.proof = proof; entry.onConsumed = onConsumed; requestedProofs.add(proof);
}
export const isRequestedAuthenticatedStorageOwnerProof = (proof: AuthenticatedStorageOwner): boolean => Boolean(proof && typeof proof === 'object' && requestedProofs.has(proof));
export function assertAuthenticatedStorageOwnerRecheckProof(request: AuthenticatedStorageOwnerRecheck, proof: AuthenticatedStorageOwner, storage: StorageReader, retirement: object) {
  const entry = recheckRegistration(request, storage, retirement);
  if (entry.proof !== proof) throw new StorageSessionChangedError();
  assertAuthenticatedStorageOwner(proof);
}
export function consumeAuthenticatedStorageOwnerRecheck(request: AuthenticatedStorageOwnerRecheck, proof: AuthenticatedStorageOwner, storage: StorageReader, retirement: object) {
  assertAuthenticatedStorageOwnerRecheckProof(request, proof, storage, retirement);
  const entry = rechecks.get(request)!;
  // Success detaches the Gate's pending cancellation before completing. Unlike
  // cancellation, this must not revoke its newly verified editor authority.
  entry.onConsumed?.(); entry.onConsumed = undefined; entry.state = 'consumed';
}
export function cancelAuthenticatedStorageOwnerRecheck(request: AuthenticatedStorageOwnerRecheck | null): void {
  const entry = request ? rechecks.get(request) : undefined;
  if (!entry || entry.state !== 'pending') return;
  entry.state = 'cancelled'; entry.controller.abort(); entry.onConsumed = undefined;
}

/** Runtime authority. A serialized owner/epoch (including a copied lease) is not a lease. */
export interface AuthenticatedStorageOwner {
  readonly userId: string;
  readonly epoch: string | null;
  readonly signal: AbortSignal;
  isCurrent(): boolean;
}
export class AuthenticatedStorageOwnerUnavailableError extends Error {
  constructor() { super('로그인 상태를 확인하지 못했습니다. 기록은 그대로 보존했습니다.'); this.name = 'AuthenticatedStorageOwnerUnavailableError'; }
}
type Verification = { data: { user: { id: string } | null }; error: unknown };
type Registration = { storage: StorageReader; controller: AbortController; startedAt: number };
const leases = new WeakMap<object, Registration>();
const verifications = new WeakMap<object, object>();

export function assertAuthenticatedStorageOwner(lease: AuthenticatedStorageOwner): void {
  const registration = lease && typeof lease === 'object' ? leases.get(lease) : undefined;
  if (!registration || registration.controller.signal.aborted || !lease.isCurrent()) throw new StorageSessionChangedError();
}

/** Called by the auth path only, with a fresh getUser result, never callback session data. */
export async function verifyAuthenticatedStorageOwner(
  storage: StorageReader,
  getUser: () => Promise<Verification>,
  prepare: (userId: string) => Promise<void>,
): Promise<AuthenticatedStorageOwner> {
  const attempt = {};
  const startedAt = ++verificationSerial;
  verifications.set(storage, attempt);
  const verified = await getUser();
  if (verifications.get(storage) !== attempt) throw new StorageSessionChangedError();
  if (verified.error) throw verified.error;
  if (!verified.data.user?.id) throw new AuthenticatedStorageOwnerUnavailableError();
  const userId = verified.data.user.id;
  await prepare(userId);
  if (verifications.get(storage) !== attempt) throw new StorageSessionChangedError();
  const owner = captureStorageOwner(storage);
  if (owner.userId !== userId || readStorageSnapshot(storage).pending) throw new StorageSessionChangedError();
  const controller = new AbortController();
  const lease: AuthenticatedStorageOwner = Object.freeze({
    userId, epoch: owner.epoch, signal: controller.signal,
    isCurrent() {
      if (!leases.has(lease) || controller.signal.aborted) return false;
      if (!isStorageOwnerCurrent(storage, owner)) { controller.abort(); return false; }
      return true;
    },
  });
  leases.set(lease, { storage, controller, startedAt });
  assertAuthenticatedStorageOwner(lease);
  return lease;
}

export function revokeAuthenticatedStorageOwner(lease: AuthenticatedStorageOwner | null): void {
  if (!lease) return;
  const registration = leases.get(lease);
  if (!registration) return;
  registration.controller.abort();
  verifications.delete(registration.storage);
  leases.delete(lease);
}
