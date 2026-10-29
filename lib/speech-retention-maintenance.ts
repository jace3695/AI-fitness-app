/** Local injected maintenance bridge only. No driver, environment lookup,
 * credentials, scheduler, retry or production connection is created here. */
import type {SpeechCleanupConfirmation} from './speech-retention-cleanup.ts';

export const SPEECH_RETENTION_MAINTENANCE_SQL = 'select yeoni_speech_retention_candidate.maintenance($1::text) as result';
export type SpeechRetentionMaintenanceExecute = (
  statement: string, values: readonly [string], signal: AbortSignal,
) => Promise<unknown>;

function exactDataRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !!descriptor && Object.hasOwn(descriptor, 'value');
  });
}

/** The future reviewed driver must return only after transaction confirmation.
 * A null/mismatched hash is not a healthy heartbeat even if deletion committed.
 * Cancellation is checked before/after the actual dependency settles: returning
 * early must not hide an in-flight SQL operation from the runner's busy guard. */
export function createSpeechRetentionMaintenancePurge(
  policyHash: string|null = null, execute?: SpeechRetentionMaintenanceExecute,
): (signal: AbortSignal) => Promise<SpeechCleanupConfirmation> {
  return async signal => {
    try {
      signal.throwIfAborted();
      if (typeof policyHash !== 'string' || !/^[a-f0-9]{64}$/.test(policyHash) || typeof execute !== 'function') throw Error();
      const rows = await execute(SPEECH_RETENTION_MAINTENANCE_SQL, Object.freeze([policyHash] as const), signal);
      signal.throwIfAborted();
      if (!Array.isArray(rows) || rows.length !== 1 || !exactDataRecord(rows[0], ['result'])) throw Error();
      const result = rows[0].result;
      if (!exactDataRecord(result, ['policyHash', 'deletedRows']) || result.policyHash !== policyHash
        || typeof result.deletedRows !== 'number' || !Number.isInteger(result.deletedRows)
        || result.deletedRows < 0 || result.deletedRows > 1) throw Error();
      return Object.freeze({policyHash, deletedRows: result.deletedRows});
    } catch {
      // Never return raw driver errors, AbortSignal.reason, row data or SQL values.
      throw Error('Cleanup maintenance unconfirmed');
    }
  };
}
