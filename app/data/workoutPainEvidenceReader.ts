import { getLocalDateKey } from './dietPlans.ts';
import { WORKOUT_COMPLETED_DAYS_KEY } from './workoutCompletion.ts';
import { RECORD_RESET_EVENT, RECORD_RESET_STORAGE_EVENT, resetMarkerKey } from './appRecordReset.ts';
import { captureStorageOwner, isStorageOwnerCurrent, readStorageSnapshot, StorageSessionChangedError,
  CLOUD_SESSION_CHANGED_EVENT, RECORDS_CHANGED_EVENT, STORAGE_GENERATION_KEY, STORAGE_JOURNAL_KEY,
  STORAGE_OWNER_KEY, STORAGE_PROTOCOL_KEY, STORAGE_READY_KEY, STORAGE_SESSION_KEY,
  type StorageReader, type StorageOwnerToken } from './storageTransaction.ts';
import { workoutPainEvidence, type WorkoutPainEvidenceSummary } from './workoutPainEvidence.ts';

export const PAIN_EVIDENCE_RESET_KEY = resetMarkerKey('fitness');
export type PainEvidenceUnavailableReason = 'preparing' | 'reset' | 'pending' | 'unreadable' | 'changed' | 'hidden';
interface EvidenceToken { owner: StorageOwnerToken; generation: string | null; resetMarker: string | null; raw: string | null; today: string }
export type PainEvidenceRead = { status: 'ready'; summary: WorkoutPainEvidenceSummary; token: EvidenceToken }
  | { status: 'unavailable'; reason: PainEvidenceUnavailableReason };
export const painEvidenceUnavailable = (reason: PainEvidenceUnavailableReason): PainEvidenceRead => ({ status: 'unavailable', reason });

function validResetMarker(marker: string | null) {
  if (marker === null) return true;
  const parts = marker.split('|');
  return parts.length === 2 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/.test(parts[0])
    && Number.isFinite(Date.parse(parts[0])) && new Date(parts[0]).toISOString().slice(0, 10) === parts[0].slice(0, 10)
    && parts[1].trim().length > 0;
}

/** A narrow local read: no migration, recovery, write, network, or empty-on-error fallback. */
export function readWorkoutPainEvidence(storage: StorageReader, today: string, resetRunning: () => boolean): PainEvidenceRead {
  try {
    if (resetRunning()) return painEvidenceUnavailable('reset');
    const owner = captureStorageOwner(storage);
    if (!owner.userId || !owner.epoch) return painEvidenceUnavailable('preparing');
    const snapshot = readStorageSnapshot(storage);
    if (snapshot.pending) return painEvidenceUnavailable('pending');
    const resetMarker = snapshot.getItem(PAIN_EVIDENCE_RESET_KEY);
    if (!validResetMarker(resetMarker)) return painEvidenceUnavailable('unreadable');
    const raw = snapshot.getItem(WORKOUT_COMPLETED_DAYS_KEY);
    const summary = workoutPainEvidence(raw === null ? {} : JSON.parse(raw), today);
    if (!summary) return painEvidenceUnavailable('unreadable');
    if (resetRunning() || !isStorageOwnerCurrent(storage, owner)) return painEvidenceUnavailable('changed');
    const current = readStorageSnapshot(storage);
    if (current.pending) return painEvidenceUnavailable('pending');
    if (current.generation !== snapshot.generation || current.getItem(PAIN_EVIDENCE_RESET_KEY) !== resetMarker
      || current.getItem(WORKOUT_COMPLETED_DAYS_KEY) !== raw || resetRunning() || !isStorageOwnerCurrent(storage, owner)) return painEvidenceUnavailable('changed');
    return { status: 'ready', summary, token: { owner, generation: snapshot.generation, resetMarker, raw, today } };
  } catch (error) {
    return painEvidenceUnavailable(error instanceof StorageSessionChangedError ? 'preparing' : 'unreadable');
  }
}

export function samePainEvidenceSnapshot(left: PainEvidenceRead, right: PainEvidenceRead): boolean {
  if (left.status !== 'ready' || right.status !== 'ready') return false;
  return left.token.owner.userId === right.token.owner.userId && left.token.owner.epoch === right.token.owner.epoch
    && left.token.generation === right.token.generation && left.token.resetMarker === right.token.resetMarker
    && left.token.raw === right.token.raw && left.token.today === right.token.today;
}

export interface PainEvidenceWatchEnvironment {
  window: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  document: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  storage: () => StorageReader;
  resetRunning: () => boolean;
  now: () => Date;
  setTimeout: (callback: () => void, milliseconds: number) => number;
  clearTimeout: (id: number) => void;
}

const watchedKeys = new Set([WORKOUT_COMPLETED_DAYS_KEY, PAIN_EVIDENCE_RESET_KEY, RECORD_RESET_STORAGE_EVENT,
  STORAGE_OWNER_KEY, STORAGE_READY_KEY, STORAGE_SESSION_KEY, STORAGE_PROTOCOL_KEY, STORAGE_GENERATION_KEY, STORAGE_JOURNAL_KEY]);

/** Synchronous lifecycle, so no stale promise can re-publish private records. Each refresh closes panels. */
export function watchWorkoutPainEvidence(environment: PainEvidenceWatchEnvironment, publish: (value: PainEvidenceRead) => void) {
  let disposed = false, pageHidden = false, timer: number | undefined;
  const read = (): PainEvidenceRead => {
    if (disposed || pageHidden || environment.document.visibilityState === 'hidden') return painEvidenceUnavailable('hidden');
    try { return readWorkoutPainEvidence(environment.storage(), getLocalDateKey(environment.now()), environment.resetRunning); }
    catch { return painEvidenceUnavailable('unreadable'); }
  };
  const schedule = () => {
    if (timer !== undefined) environment.clearTimeout(timer);
    if (disposed) return;
    const now = environment.now();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    timer = environment.setTimeout(refresh, Math.max(1, midnight.getTime() - now.getTime()));
  };
  function refresh() { if (!disposed) { publish(read()); schedule(); } }
  const fence = () => { if (!disposed) { publish(painEvidenceUnavailable('changed')); refresh(); } };
  const hide = () => { pageHidden = true; if (!disposed) publish(painEvidenceUnavailable('hidden')); };
  const show = () => { pageHidden = false; refresh(); };
  const visibility = () => { if (environment.document.visibilityState === 'hidden') hide(); else show(); };
  const storage = (event: Event) => { const key = (event as StorageEvent).key; if (key === null || watchedKeys.has(key)) fence(); };
  const windowListeners: [string, EventListener][] = [[RECORDS_CHANGED_EVENT, refresh], [CLOUD_SESSION_CHANGED_EVENT, fence],
    [RECORD_RESET_EVENT, fence], ['storage', storage], ['focus', refresh], ['pageshow', show], ['pagehide', hide]];
  windowListeners.forEach(([name, callback]) => environment.window.addEventListener(name, callback));
  environment.document.addEventListener('visibilitychange', visibility);
  refresh();
  return {
    read,
    refresh,
    dispose() {
      disposed = true;
      if (timer !== undefined) environment.clearTimeout(timer);
      windowListeners.forEach(([name, callback]) => environment.window.removeEventListener(name, callback));
      environment.document.removeEventListener('visibilitychange', visibility);
    },
  };
}
