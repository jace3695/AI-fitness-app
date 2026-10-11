import { StorageCorruptionError, StorageLegacyMigrationRequiredError, StorageLocksUnavailableError, StorageSessionChangedError, StorageSnapshotBusyError } from './storageTransaction.ts';

/** Observations only. This event is deliberately unrelated to owner proof and
 * recheck events: neither its fields nor its delivery convey any authority. */
export const OWNER_SYNC_DIAGNOSTIC_EVENT = 'yeoni-owner-sync-diagnostic';
export const OWNER_SYNC_DIAGNOSTIC_SCHEMA = Object.freeze({
  component: ['panel', 'gate'] as const,
  stage: ['retired', 'observation-queued', 'observation-acquired', 'observation-refused', 'observation-cancelled',
    'request-dispatched', 'proof-received', 'panel-auth-started', 'panel-auth-refused', 'binding-published', 'binding-activated',
    'recovery-cancelled', 'ordinary-proof-published', 'request-claimed', 'request-refused', 'gate-auth-started',
    'gate-auth-refused', 'pin-refused', 'requested-proof-published', 'request-cancelled'] as const,
  ownerRelation: ['same-owner', 'different-owner', 'no-owner', 'unavailable'] as const,
  epochRelation: ['same-as-loop', 'different-from-loop', 'unavailable'] as const,
  failure: ['snapshot-busy', 'session-changed', 'corrupt', 'locks-unavailable', 'aborted', 'other'] as const,
  proof: ['ordinary', 'correlated'] as const,
  outcome: ['accepted', 'seen', 'no-retirement', 'wrong-current-binding', 'invalid'] as const,
  reason: ['auth-callback', 'manual-retry', 'signout', 'reset', 'epoch-or-owner', 'unmount', 'superseded', 'other'] as const,
});
type Schema = typeof OWNER_SYNC_DIAGNOSTIC_SCHEMA;
export type OwnerSyncDiagnosticStage = Schema['stage'][number];
export type OwnerSyncDiagnosticFailure = Schema['failure'][number];
export type OwnerSyncDiagnosticFields = { [K in Exclude<keyof Schema, 'component' | 'stage'>]?: Schema[K][number] }
  & { retirementIndex?: number };
export type OwnerSyncDiagnostic = Readonly<OwnerSyncDiagnosticFields & { component: Schema['component'][number]; stage: OwnerSyncDiagnosticStage }>;

/** Known constructors only. In particular, never inspect name/message/stack on
 * an unknown exception, including objects with throwing property getters. */
export function classifyOwnerSyncDiagnosticFailure(error: unknown): OwnerSyncDiagnosticFailure {
  try {
    if (error instanceof StorageSnapshotBusyError) return 'snapshot-busy';
    if (error instanceof StorageSessionChangedError) return 'session-changed';
    if (error instanceof StorageCorruptionError || error instanceof StorageLegacyMigrationRequiredError) return 'corrupt';
    if (error instanceof StorageLocksUnavailableError) return 'locks-unavailable';
  } catch { /* A hostile Proxy can reject instanceof; it is still just other. */ }
  return 'other';
}

/** Closed, primitive-only projection. Do not spread fields or invoke accessors. */
export function projectOwnerSyncDiagnostic(component: unknown, stage: unknown, fields?: unknown): OwnerSyncDiagnostic | null {
  try {
    if (typeof component !== 'string' || !(OWNER_SYNC_DIAGNOSTIC_SCHEMA.component as readonly string[]).includes(component)
      || typeof stage !== 'string' || !(OWNER_SYNC_DIAGNOSTIC_SCHEMA.stage as readonly string[]).includes(stage)) return null;
    const detail: Record<string, string | number> = { component, stage };
    if (fields && typeof fields === 'object') {
      for (const key of ['ownerRelation', 'epochRelation', 'failure', 'proof', 'outcome', 'reason'] as const) {
        const value: unknown = Object.getOwnPropertyDescriptor(fields, key)?.value;
        if (typeof value === 'string' && (OWNER_SYNC_DIAGNOSTIC_SCHEMA[key] as readonly string[]).includes(value)) detail[key] = value;
      }
      const retirementIndex: unknown = Object.getOwnPropertyDescriptor(fields, 'retirementIndex')?.value;
      if (typeof retirementIndex === 'number' && Number.isInteger(retirementIndex) && retirementIndex >= 1 && retirementIndex <= 10000) detail.retirementIndex = retirementIndex;
    }
    return Object.freeze(detail) as OwnerSyncDiagnostic;
  } catch { return null; }
}

/** Best effort and synchronous: no storage/auth reads, scheduling, callbacks,
 * console output, request objects or lease objects. Failure changes no result. */
export function emitOwnerSyncDiagnostic(component: Schema['component'][number], stage: OwnerSyncDiagnosticStage, fields?: OwnerSyncDiagnosticFields): void {
  try {
    if (typeof window === 'undefined' || typeof CustomEvent !== 'function') return;
    const detail = projectOwnerSyncDiagnostic(component, stage, fields);
    if (detail) window.dispatchEvent(new CustomEvent(OWNER_SYNC_DIAGNOSTIC_EVENT, { detail }));
  } catch { /* Diagnostics must never replace the caller's control flow. */ }
}
