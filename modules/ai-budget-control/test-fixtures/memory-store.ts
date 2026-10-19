/** TEST ONLY. No durable storage, multi-process guarantees, or production wiring.
 * CAS has no await between compare and assignment, simulating one atomic server.
 */
import type { BudgetStore, Snapshot, StoredBudget } from '../persistence.ts';
import type { Ledger } from '../index.ts';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export class MemoryStore implements BudgetStore {
  private rows = new Map<string, Snapshot>();
  private barrier: { remaining: number; promise: Promise<void>; resolve: () => void } | undefined;
  nextWriteFailure: 'before_commit' | 'after_commit' | undefined;
  conflicts = 0;
  constructor(ledgers: readonly Ledger[]) {
    for (const ledger of ledgers) this.rows.set(ledger.accountId, clone({ revision: 0, value: { ledger, claims: [] } }));
  }
  synchronizeNextReads(count: number): void {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    this.barrier = { remaining: count, promise, resolve };
  }
  async read(accountId: string): Promise<Snapshot> {
    const row = this.rows.get(accountId);
    if (!row) throw new Error('unknown_account');
    const snapshot = clone(row);
    const barrier = this.barrier;
    if (barrier) {
      if (--barrier.remaining === 0) { this.barrier = undefined; barrier.resolve(); }
      await barrier.promise;
    }
    return snapshot;
  }
  async compareAndSwap(accountId: string, expectedRevision: number, next: StoredBudget): Promise<boolean> {
    const current = this.rows.get(accountId);
    if (!current || next.ledger.accountId !== accountId) throw new Error('account_mismatch');
    if (current.revision !== expectedRevision) { this.conflicts++; return false; }
    const fault = this.nextWriteFailure;
    this.nextWriteFailure = undefined;
    if (fault === 'before_commit') throw new Error('synthetic_write_failure');
    this.rows.set(accountId, clone({ revision: expectedRevision + 1, value: next }));
    if (fault === 'after_commit') throw new Error('synthetic_ack_lost');
    return true;
  }
}
