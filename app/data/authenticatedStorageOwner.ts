import { captureStorageOwner, isStorageOwnerCurrent, readStorageSnapshot, StorageSessionChangedError, type StorageReader } from './storageTransaction.ts';

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
type Registration = { storage: StorageReader; controller: AbortController };
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
  leases.set(lease, { storage, controller });
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
