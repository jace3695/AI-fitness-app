import { BudgetError, reserve, release, settle } from './index.ts';
import type { Ledger, Request } from './index.ts';

export type DispatchClaim = Readonly<{ requestId: string; ownerId: string }>;
export type StoredBudget = Readonly<{ ledger: Ledger; claims: readonly DispatchClaim[] }>;
export type Snapshot = Readonly<{ revision: number; value: StoredBudget }>;

/** Trusted server adapter contract, NOT an implementation:
 * - Reads return isolated, validated snapshots for the authenticated account.
 * - CAS atomically compares account revision and persists the WHOLE value,
 *   incrementing revision once. true means durable commit acknowledged;
 *   false means no write occurred (revision conflict ONLY).
 * - Unknown commit outcome MUST throw, never return false. Reads after recovery
 *   must observe committed state. No TTL deletion of entries or claims.
 * - Authenticate/authorize before use; never expose raw CAS to a client.
 */
export interface BudgetStore {
  read(accountId: string): Promise<Snapshot>;
  compareAndSwap(accountId: string, expectedRevision: number, next: StoredBudget): Promise<boolean>;
}

/** A claimed request cannot be reclaimed, even by the same owner or after TTL.
 * ownerId identifies an invocation, not a reusable worker name. A grant is
 * consumed by exactly one dispatch attempt; never retry a grant after failure.
 */
export interface BudgetCoordinator {
  reserve(accountId: string, request: Request): Promise<void>;
  claimDispatch(accountId: string, requestId: string, ownerId: string): Promise<boolean>;
  settle(accountId: string, requestId: string, ownerId: string, actualCost: number): Promise<void>;
  /** Trusted reconciliation only for provider_confirmed_unbilled: sender must
   * be quiescent and unable to use any outstanding grant. A billing snapshot
   * alone does not establish that a paused sender cannot send later.
   */
  release(accountId: string, requestId: string,
    evidence: 'not_dispatched' | 'provider_confirmed_unbilled'): Promise<void>;
}

export function createCoordinator(store: BudgetStore): BudgetCoordinator {
  async function change<T>(accountId: string, transition: (value: StoredBudget) => { next: StoredBudget; result: T }): Promise<T> {
    for (let attempt = 0; attempt < 16; attempt++) {
      const snapshot = await store.read(accountId);
      if (snapshot.value.ledger.accountId !== accountId) throw new BudgetError('account_mismatch');
      const { next, result } = transition(snapshot.value);
      if (next === snapshot.value) return result;
      // Exceptions (including unknown write outcome) propagate: no dispatch grant.
      if (await store.compareAndSwap(accountId, snapshot.revision, next)) return result;
    }
    throw new BudgetError('revision_contention');
  }
  return {
    async reserve(accountId, request) {
      await change(accountId, value => {
        const result = reserve(value.ledger, request);
        return { next: result.state === value.ledger ? value : { ...value, ledger: result.state }, result: undefined };
      });
    },
    async claimDispatch(accountId, requestId, ownerId) {
      if (typeof ownerId !== 'string' || !ownerId.trim() || ownerId.length > 256) throw new BudgetError('invalid_owner');
      return change(accountId, value => {
        const entry = value.ledger.entries.find(e => e.id === requestId);
        if (!entry) throw new BudgetError('unknown_request');
        if (entry.status !== 'reserved' || value.claims.some(c => c.requestId === requestId)) return { next: value, result: false };
        return { next: { ...value, claims: [...value.claims, { requestId, ownerId }] }, result: true };
      });
    },
    async settle(accountId, requestId, ownerId, actualCost) {
      await change(accountId, value => {
        if (!value.claims.some(c => c.requestId === requestId && c.ownerId === ownerId)) throw new BudgetError('not_dispatch_owner');
        const ledger = settle(value.ledger, requestId, actualCost);
        return { next: ledger === value.ledger ? value : { ...value, ledger }, result: undefined };
      });
    },
    async release(accountId, requestId, evidence) {
      await change(accountId, value => {
        // Atomic against claim acquisition: no caller may assert not_dispatched
        // after a claim, even if a crashed worker probably did not send anything.
        if (evidence === 'not_dispatched' && value.claims.some(c => c.requestId === requestId)) throw new BudgetError('dispatch_outcome_unknown');
        const ledger = release(value.ledger, requestId, evidence);
        return { next: ledger === value.ledger ? value : { ...value, ledger }, result: undefined };
      });
    },
  };
}
