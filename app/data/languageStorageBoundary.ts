import { captureStorageOwner, isStorageOwnerCurrent, readStorageSnapshot, STORAGE_OWNER_KEY, STORAGE_READY_KEY, STORAGE_SESSION_KEY, StorageCorruptionError } from './storageTransaction.ts';
import type { StorageOwnerToken, StorageReader, StorageSnapshot } from './storageTransaction.ts';

/** Only these opaque strings participate in the legacy language wire namespace. */
export const LANGUAGE_STORAGE_KEYS = [
  'dailyRoutineProgress', 'dailyLearningHistory', 'integratedLearningSettingsV1',
  'japaneseCurriculumProgressV1', 'japaneseCurriculumReviewV1', 'japaneseAppSettings',
  'learningSettings', 'savedWords', 'savedSentences', 'wrongKana', 'wrongKanaChars',
  'wrongWords', 'wrongSentences', 'grammarProgress', 'reviewCompletedItemsByDate', 'languageRecordResetV1',
] as const;
export type LanguageStorageKey = typeof LANGUAGE_STORAGE_KEYS[number];
export type LanguageBytes = Readonly<Partial<Record<LanguageStorageKey, string>>>;
export const LANGUAGE_BINDING_KEY = 'language-storage-binding-v1';
export const LANGUAGE_RESET_FENCE_KEY = 'language-reset-fence-v1';
export const LANGUAGE_OWNER_KEY = 'language-cloud-sync-user';
export const LANGUAGE_MARKER_KEY = 'languageRecordResetV1';
export const languageSyncBaseKey = (owner: string) => `language-cloud-sync-base:${owner}`;
export const languageSyncAckKey = (owner: string) => `language-cloud-sync-ack:${owner}`;
export class LanguageBoundaryError extends Error {
  constructor(message = '일부 학습 기록을 이 기기에 보존했습니다. 안전한 확인을 위한 별도 복구가 필요합니다. 다른 앱은 계속 사용할 수 있습니다.') { super(message); this.name = 'LanguageBoundaryError'; }
}
export type LanguageMarker = { kind: 'missing' } | { kind: 'valid'; raw: string; time: number; requestId: string } | { kind: 'invalid'; raw: unknown };
export function parseLanguageMarker(raw: unknown): LanguageMarker {
  if (raw === undefined) return { kind: 'missing' };
  // Storage absence is null; remote JSON null must be rejected by validateLanguageWire.
  if (raw === null) return { kind: 'missing' };
  if (typeof raw !== 'string') return { kind: 'invalid', raw };
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z)\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(raw);
  const time = match ? Date.parse(match[1]) : NaN;
  if (!match || !Number.isFinite(time)) return { kind: 'invalid', raw };
  const canonical = new Date(time).toISOString().slice(0, 19);
  if (canonical !== match[1].slice(0, 19)) return { kind: 'invalid', raw };
  return { kind: 'valid', raw, time, requestId: match[2] };
}
export type LanguageResetFence = { version: 1; owner: string; requestId: string; expectedMarker: string | null; state: 'pending' | 'uncertain' | 'completed'; marker?: string };
export function parseLanguageResetFence(raw: string | null): LanguageResetFence | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as LanguageResetFence;
    if (!value || value.version !== 1 || typeof value.owner !== 'string' || !value.owner || typeof value.requestId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId)
      || !['pending', 'uncertain', 'completed'].includes(value.state)
      || !(value.expectedMarker === null || typeof value.expectedMarker === 'string')
      || parseLanguageMarker(value.expectedMarker).kind === 'invalid') throw new LanguageBoundaryError();
    if (value.state === 'completed') {
      const marker = parseLanguageMarker(value.marker);
      if (marker.kind !== 'valid' || marker.requestId !== value.requestId) throw new LanguageBoundaryError();
    } else if (value.marker !== undefined) throw new LanguageBoundaryError();
    return value;
  } catch { throw new LanguageBoundaryError(); }
}
export type LanguageBinding = { version: 1; epoch: string; owner: string | null; status: 'ready' | 'empty' | 'held' | 'blocked'; provenance: 'new' | 'legacy' | 'verified'; ambiguityId?: string; reason?: string };
export function parseLanguageBinding(raw: string | null): LanguageBinding | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as LanguageBinding;
    if (!value || value.version !== 1 || typeof value.epoch !== 'string' || !value.epoch
      || !(value.owner === null || typeof value.owner === 'string' && !!value.owner)
      || !['ready', 'empty', 'held', 'blocked'].includes(value.status) || !['new', 'legacy', 'verified'].includes(value.provenance)
      || (['ready', 'held'].includes(value.status) && !value.owner)
      || (value.status === 'empty' && value.owner !== null)
      || (value.status === 'blocked' && (typeof value.ambiguityId !== 'string' || !value.ambiguityId))) throw new LanguageBoundaryError();
    return value;
  } catch { throw new LanguageBoundaryError(); }
}
export function projectLanguageBytes(snapshot: Pick<Storage, 'getItem'>): LanguageBytes {
  const result: Partial<Record<LanguageStorageKey, string>> = {};
  for (const key of LANGUAGE_STORAGE_KEYS) { const raw = snapshot.getItem(key); if (raw !== null) result[key] = raw; }
  return Object.freeze(result);
}
export function validateLanguageWire(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LanguageBoundaryError('학습 기록의 서버/기준 형식을 확인하지 못했습니다. 원본을 보존했습니다.');
  for (const key of LANGUAGE_STORAGE_KEYS) if (Object.hasOwn(value, key) && typeof (value as Record<string, unknown>)[key] !== 'string') throw new LanguageBoundaryError('학습 기록의 지원되지 않는 저장 형식을 보존했습니다. 별도 복구가 필요합니다.');
  const state = value as Record<string, unknown>;
  if (Object.hasOwn(state, LANGUAGE_MARKER_KEY) && parseLanguageMarker(state[LANGUAGE_MARKER_KEY]).kind !== 'valid') throw new LanguageBoundaryError('학습 초기화 표식을 확인하지 못했습니다. 원본을 보존했습니다.');
  return state;
}
export function readLanguageSyncBase(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try { return validateLanguageWire(JSON.parse(raw)); } catch { throw new LanguageBoundaryError('학습 동기화 기준을 읽지 못했습니다. 기존 원본을 보존했습니다. 별도 복구가 필요합니다.'); }
}
export function projectLanguageWire(state: Record<string, unknown>): LanguageBytes {
  validateLanguageWire(state);
  return Object.freeze(Object.fromEntries(LANGUAGE_STORAGE_KEYS.flatMap(key => Object.hasOwn(state, key) ? [[key, state[key]]] : []))) as LanguageBytes;
}
export const sameLanguageBytes = (a: LanguageBytes, b: LanguageBytes) => LANGUAGE_STORAGE_KEYS.every(key => a[key] === b[key]);
export const validLanguageAck = (raw: string | null) => raw !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);
export type LanguageBoundaryResult = { status: 'ready'; binding: LanguageBinding } | { status: 'unavailable'; reason: string };
export function readLanguageBoundary(snapshot: StorageSnapshot, expectedOwner: StorageOwnerToken): LanguageBoundaryResult {
  try {
    if (snapshot.pending || !expectedOwner.userId || !expectedOwner.epoch || snapshot.getItem(STORAGE_SESSION_KEY) !== expectedOwner.epoch
      || snapshot.getItem(STORAGE_OWNER_KEY) !== expectedOwner.userId
      || snapshot.getItem(STORAGE_READY_KEY) !== JSON.stringify({ epoch: expectedOwner.epoch, userId: expectedOwner.userId })) throw new LanguageBoundaryError();
    const binding = parseLanguageBinding(snapshot.getItem(LANGUAGE_BINDING_KEY));
    if (!binding || binding.status !== 'ready' || binding.owner !== expectedOwner.userId || binding.epoch !== expectedOwner.epoch
      || snapshot.getItem(LANGUAGE_OWNER_KEY) !== expectedOwner.userId) throw new LanguageBoundaryError();
    const fence = parseLanguageResetFence(snapshot.getItem(LANGUAGE_RESET_FENCE_KEY));
    const marker = snapshot.getItem(LANGUAGE_MARKER_KEY);
    if (parseLanguageMarker(marker).kind === 'invalid') throw new LanguageBoundaryError();
    readLanguageSyncBase(snapshot.getItem(languageSyncBaseKey(expectedOwner.userId)));
    const ack = snapshot.getItem(languageSyncAckKey(expectedOwner.userId));
    if (ack !== null && !validLanguageAck(ack)) throw new LanguageBoundaryError();
    if (fence && (fence.owner !== expectedOwner.userId || fence.state !== 'completed' || fence.marker !== marker)) {
      return { status: 'unavailable', reason: '학습 기록 초기화가 아직 확인되지 않았습니다. 이 기기의 기록은 보존 중입니다. 초기화 화면에서 같은 요청을 확인해 주세요.' };
    }
    return { status: 'ready', binding };
  } catch (error) { return { status: 'unavailable', reason: error instanceof Error ? error.message : new LanguageBoundaryError().message }; }
}
export function readGuardedLanguageProjection(storage: StorageReader, expectedOwner?: StorageOwnerToken): { status: 'ready'; records: LanguageBytes } | { status: 'unavailable'; reason: string } {
  try {
    const owner = expectedOwner ?? captureStorageOwner(storage);
    if (!isStorageOwnerCurrent(storage, owner)) throw new LanguageBoundaryError();
    const snapshot = readStorageSnapshot(storage), boundary = readLanguageBoundary(snapshot, owner);
    if (boundary.status !== 'ready') return boundary;
    if (!isStorageOwnerCurrent(storage, owner)) throw new LanguageBoundaryError();
    return { status: 'ready', records: projectLanguageBytes(snapshot) };
  } catch (error) { return { status: 'unavailable', reason: error instanceof Error ? error.message : new LanguageBoundaryError().message }; }
}
export function languageMetadataReadyForEpoch(snapshot: StorageSnapshot, owner: StorageOwnerToken): boolean {
  if (snapshot.pending || snapshot.getItem(STORAGE_READY_KEY) !== JSON.stringify({ epoch: owner.epoch, userId: owner.userId })) return false;
  const raw = snapshot.getItem(LANGUAGE_BINDING_KEY);
  if (raw === null) return false;
  try { return parseLanguageBinding(raw)?.epoch === owner.epoch; } catch { return true; } // Existing corrupt bytes themselves remain a durable block.
}
export type LanguageTransitionPlan = { changes: Record<string, string | null>; classification: 'ready' | 'empty' | 'held' | 'blocked' };
/** Only compose within completeStorageOwnerTransition. Never compare old binding to the new desired epoch. */
export function planLanguageOwnerTransition(snapshot: StorageSnapshot, desiredOwner: StorageOwnerToken): LanguageTransitionPlan {
  const changes: Record<string, string | null> = {};
  if (!desiredOwner.epoch) throw new LanguageBoundaryError();
  const bytes = projectLanguageBytes(snapshot), oldStamp = snapshot.getItem(LANGUAGE_OWNER_KEY);
  const previousSharedOwner = snapshot.getItem(STORAGE_OWNER_KEY);
  let previousReady: { epoch: string; userId: string | null } | null = null;
  const previousReadyRaw = snapshot.getItem(STORAGE_READY_KEY);
  if (previousReadyRaw !== null) {
    try {
      const value = JSON.parse(previousReadyRaw);
      if (!value || Array.isArray(value) || typeof value.epoch !== 'string' || !value.epoch
        || !(value.userId === null || typeof value.userId === 'string' && value.userId)) throw new StorageCorruptionError();
      const session = JSON.parse(value.epoch);
      if (!session || session.version !== 2 || typeof session.id !== 'string' || !session.id || session.userId !== value.userId) throw new StorageCorruptionError();
      previousReady = value;
    } catch { throw new StorageCorruptionError(); }
  }
  let binding: LanguageBinding | null, fence: LanguageResetFence | null;
  try { binding = parseLanguageBinding(snapshot.getItem(LANGUAGE_BINDING_KEY)); }
  catch { return { changes, classification: 'blocked' }; }
  const save = (next: LanguageBinding): LanguageTransitionPlan => { changes[LANGUAGE_BINDING_KEY] = JSON.stringify(next); return { changes, classification: next.status }; };
  const blocked = (reason: string): LanguageTransitionPlan => save({ version: 1, epoch: desiredOwner.epoch!, owner: null, status: 'blocked', provenance: 'legacy', ambiguityId: binding?.ambiguityId ?? crypto.randomUUID(), reason });
  try { fence = parseLanguageResetFence(snapshot.getItem(LANGUAGE_RESET_FENCE_KEY)); } catch { return blocked('corrupt-reset-fence'); }
  if (binding?.status === 'blocked') return save({ ...binding, epoch: desiredOwner.epoch });
  if (binding && binding.status !== 'empty') {
    // Held ownership is explicit, even when shared auth has since moved to another account.
    if (binding.owner !== oldStamp || (binding.status === 'ready' && (previousSharedOwner !== binding.owner || !previousReady || previousReady.epoch !== binding.epoch || previousReady.userId !== binding.owner))) return blocked('inconsistent-owner-binding');
  }
  const metadataKeys = Array.from({ length: snapshot.length }, (_, i) => snapshot.key(i)!).filter(key => key.startsWith('language-cloud-sync-base:') || key.startsWith('language-cloud-sync-ack:'));
  const empty = Object.keys(bytes).length === 0 && oldStamp === null && metadataKeys.length === 0 && fence === null;
  if ((binding === null || binding.status === 'empty') && empty) {
    if (desiredOwner.userId) changes[LANGUAGE_OWNER_KEY] = desiredOwner.userId;
    return save({ version: 1, epoch: desiredOwner.epoch, owner: desiredOwner.userId, status: desiredOwner.userId ? 'ready' : 'empty', provenance: 'new' });
  }
  if (binding?.status === 'empty') return blocked('unexpected-records-in-empty-binding');
  const provenOwner = binding?.owner ?? (oldStamp && oldStamp === previousSharedOwner && oldStamp === desiredOwner.userId && previousReady?.userId === oldStamp ? oldStamp : null);
  if (!provenOwner || (binding === null && metadataKeys.some(key => ![languageSyncBaseKey(provenOwner), languageSyncAckKey(provenOwner)].includes(key)))) return blocked('ambiguous-legacy-owner');
  let base: Record<string, unknown> | null;
  const ack = snapshot.getItem(languageSyncAckKey(provenOwner));
  try {
    base = readLanguageSyncBase(snapshot.getItem(languageSyncBaseKey(provenOwner)));
    if ((ack !== null && !validLanguageAck(ack)) || parseLanguageMarker(bytes[LANGUAGE_MARKER_KEY]).kind === 'invalid'
      || (fence && (fence.owner !== provenOwner || fence.state === 'completed' && fence.marker !== (bytes[LANGUAGE_MARKER_KEY] ?? null)))) throw new LanguageBoundaryError();
  } catch { return blocked('corrupt-language-evidence'); }
  if (desiredOwner.userId === provenOwner) return save({ version: 1, epoch: desiredOwner.epoch, owner: provenOwner, status: 'ready', provenance: binding?.provenance ?? 'legacy' });
  // Only verified exact cache may follow the old cleanup behavior. Unknown/different bytes stay in place.
  if (binding?.provenance === 'verified' && base && validLanguageAck(ack) && (!fence || fence.state === 'completed') && sameLanguageBytes(bytes, projectLanguageWire(base))) {
    for (const key of LANGUAGE_STORAGE_KEYS) changes[key] = null;
    changes[languageSyncBaseKey(provenOwner)] = null; changes[languageSyncAckKey(provenOwner)] = null;
    changes[LANGUAGE_RESET_FENCE_KEY] = null; changes[LANGUAGE_OWNER_KEY] = desiredOwner.userId;
    return save({ version: 1, epoch: desiredOwner.epoch, owner: desiredOwner.userId, status: desiredOwner.userId ? 'ready' : 'empty', provenance: 'new' });
  }
  return save({ version: 1, epoch: desiredOwner.epoch, owner: provenOwner, status: 'held', provenance: binding?.provenance ?? 'legacy' });
}
