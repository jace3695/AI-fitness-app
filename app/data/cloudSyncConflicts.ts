import { APP_RECORD_KEYS, RECORD_RESET_APPS, resetMarkerKey, respectRecordResets } from './appRecordReset.ts';
import type { CloudState, CloudSyncRequest } from './cloudSync.ts';

/** Private, in-memory evidence only. Never log or send these snapshots to a provider. */
export type CloudSyncConflictValue = { present: false } | { present: true; value: unknown };
export interface CloudSyncConflict {
  path: string[];
  kind: 'value' | 'delete-edit' | 'array' | 'type';
  base: CloudSyncConflictValue;
  local: CloudSyncConflictValue;
  remote: CloudSyncConflictValue;
}
export interface CloudSyncConflictClassification {
  /** Deliberately absent until every conflicting field has an explicit choice. */
  merged: CloudState | null;
  conflicts: CloudSyncConflict[];
  /** Existing reset-generation policy, separate from user-edit conflicts. */
  resetKeys: string[];
}
export interface CloudSyncConflictChoice { path: string[]; side: 'local' | 'remote' }
export interface CloudSyncRemoteEvidence { state: CloudState; updated_at: string }
export interface CloudSyncConflictReview {
  request: CloudSyncRequest;
  remote: CloudSyncRemoteEvidence;
  conflicts: CloudSyncConflict[];
  resetKeys: string[];
}
export class CloudSyncConflictValidationError extends Error {
  constructor() { super('충돌 확인 정보를 안전하게 읽지 못했습니다. 원본을 보존했으니 다시 확인해 주세요.'); this.name = 'CloudSyncConflictValidationError'; }
}
export class CloudSyncLegacyEncodingError extends Error {
  constructor() { super('이전 형식의 기록을 안전하게 해석하지 못했습니다. 기기와 서버 원본을 보존했으니 기록 형식을 확인해 주세요.'); this.name = 'CloudSyncLegacyEncodingError'; }
}
/** Exact object-map keys accepted by assistant_workout_store / assistant_diet_store. */
export const CLOUD_SYNC_LEGACY_OBJECT_KEYS = Object.freeze([
  'ai-fitness-workout-completed-days', 'ai-fitness-diet-completed-days', 'ai-fitness-water-intake',
  'ai-fitness-diet-meal-log', 'ai-fitness-lunch-carb-choice', 'ai-fitness-dinner-carb-choice',
  'ai-fitness-protein-total', 'ai-fitness-diet-dinner-completed-time',
  'ai-fitness-lunch-protein-choice', 'ai-fitness-social-meal-mode',
] as const);
export const CLOUD_SYNC_LEGACY_FASTING_KEY = 'ai-fitness-fasting-start-time';
export class CloudSyncConflictStaleError extends Error {
  constructor() { super('충돌을 확인하는 동안 기록이 바뀌었습니다. 최신 내용을 다시 확인하고 선택해 주세요.'); this.name = 'CloudSyncConflictStaleError'; }
}

// A bounded synchronous pass is also safe inside the existing short storage lock.
export const CLOUD_SYNC_CONFLICT_LIMITS = Object.freeze({ depth: 40, nodes: 100_000, characters: 5 * 1024 * 1024, conflicts: 500 });
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);
const missing: CloudSyncConflictValue = Object.freeze({ present: false });
const own = (value: object, key: string) => Object.hasOwn(value, key);
function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function cloneState(state: CloudState): CloudState {
  let nodes = 0;
  let characters = 0;
  const ancestors = new Set<object>();
  function visit(value: unknown, depth: number): unknown {
    if (++nodes > CLOUD_SYNC_CONFLICT_LIMITS.nodes || depth > CLOUD_SYNC_CONFLICT_LIMITS.depth) throw new CloudSyncConflictValidationError();
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      characters += value.length;
      if (characters > CLOUD_SYNC_CONFLICT_LIMITS.characters) throw new CloudSyncConflictValidationError();
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || value === null || (!Array.isArray(value) && !plain(value)) || ancestors.has(value)) throw new CloudSyncConflictValidationError();
    ancestors.add(value);
    if (Object.getOwnPropertySymbols(value).length) throw new CloudSyncConflictValidationError();
    const keys = Object.keys(value);
    if (Array.isArray(value) && (keys.length !== value.length || keys.some((key, index) => key !== String(index)))) throw new CloudSyncConflictValidationError();
    const result: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
    for (const key of keys) {
      if (forbiddenKeys.has(key)) throw new CloudSyncConflictValidationError();
      characters += key.length;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (characters > CLOUD_SYNC_CONFLICT_LIMITS.characters || !descriptor || !('value' in descriptor)) throw new CloudSyncConflictValidationError();
      // All keys have been screened before assignment; no getters are evaluated.
      (result as Record<string, unknown>)[key] = visit(descriptor.value, depth + 1);
    }
    ancestors.delete(value);
    return result;
  }
  if (!plain(state)) throw new CloudSyncConflictValidationError();
  return visit(state, 0) as CloudState;
}
/**
 * Decode only the ten supported record wrappers and the explicit fasting-time
 * format, exactly once (see the existing server helpers and diet-time reader).
 * Preserve every field/value; no defaults, projection, or generic-string parsing.
 * Callers keep separate raw evidence for review identity and remote CAS.
 */
export function normalizeCloudSyncState(state: CloudState): CloudState {
  const normalized = cloneState(state);
  for (const key of CLOUD_SYNC_LEGACY_OBJECT_KEYS) {
    if (!own(normalized, key)) continue;
    let value = normalized[key];
    if (typeof value === 'string') {
      try { value = JSON.parse(value) as unknown; } catch { throw new CloudSyncLegacyEncodingError(); }
    }
    if (!plain(value)) throw new CloudSyncLegacyEncodingError();
    normalized[key] = value;
  }
  if (own(normalized, CLOUD_SYNC_LEGACY_FASTING_KEY)) {
    // Match parseFastingStart / assistant_diet_fasting_value for this key only.
    const clock = (value: unknown) => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
    let value = normalized[CLOUD_SYNC_LEGACY_FASTING_KEY];
    if (typeof value === 'string' && value !== '' && !clock(value)) {
      try { value = JSON.parse(value) as unknown; } catch { throw new CloudSyncLegacyEncodingError(); }
    }
    if (value !== '' && !clock(value) && !plain(value)) throw new CloudSyncLegacyEncodingError();
    normalized[CLOUD_SYNC_LEGACY_FASTING_KEY] = value;
  }
  // Decoded content has the same safety/aggregate bounds as ordinary JSON trees.
  return cloneState(normalized);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, current: unknown) => plain(current)
    ? Object.fromEntries(Object.entries(current).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : current);
}
const equal = (a: CloudSyncConflictValue, b: CloudSyncConflictValue) => a.present === b.present
  && (!a.present || (b.present && canonical(a.value) === canonical(b.value)));
const slot = (object: CloudState, key: string): CloudSyncConflictValue => own(object, key) ? { present: true, value: object[key] } : missing;
const objectSlot = (value: CloudSyncConflictValue): value is { present: true; value: CloudState } => value.present && plain(value.value);
function type(value: CloudSyncConflictValue) {
  return !value.present ? 'absent' : value.value === null ? 'null' : Array.isArray(value.value) ? 'array' : typeof value.value;
}
function resetPolicy(remote: CloudState, local: CloudState) {
  const keys = new Set<string>();
  for (const app of RECORD_RESET_APPS) {
    const marker = resetMarkerKey(app);
    if (remote[marker] === local[marker]) continue;
    const time = (value: unknown) => typeof value === 'string' ? Date.parse(value.split('|')[0]) : NaN;
    const remoteTime = time(remote[marker]);
    const localTime = time(local[marker]);
    // Match the established policy including equal-time distinct marker IDs.
    if (!(Number.isFinite(remoteTime) && remoteTime !== 0) && !(Number.isFinite(localTime) && localTime !== 0)) continue;
    for (const key of [...APP_RECORD_KEYS[app], marker]) keys.add(key);
  }
  return { keys, state: respectRecordResets(remote, local, {}) };
}
function classify(base: CloudState | null, remote: CloudState, local: CloudState, choices?: Map<string, CloudSyncConflictChoice['side']>) {
  base = base === null ? null : normalizeCloudSyncState(base);
  remote = normalizeCloudSyncState(remote);
  local = normalizeCloudSyncState(local);
  const conflicts: CloudSyncConflict[] = [];
  const reset = resetPolicy(remote, local);
  function merge(b: CloudSyncConflictValue, r: CloudSyncConflictValue, l: CloudSyncConflictValue, path: string[]): CloudSyncConflictValue {
    if (path.length === 1 && reset.keys.has(path[0])) return slot(reset.state, path[0]);
    if (equal(l, r)) return l;
    if (equal(l, b)) return r;
    if (equal(r, b)) return l;
    // A deletion, array edit, or structural replacement is an atomic decision.
    if (objectSlot(r) && objectSlot(l) && (!b.present || objectSlot(b))) {
      const bObject = b.present ? b.value as CloudState : {};
      const result: CloudState = {};
      const keys = [...new Set([...Object.keys(bObject), ...Object.keys(r.value), ...Object.keys(l.value)])].sort();
      for (const key of keys) {
        const value = merge(slot(bObject, key), slot(r.value, key), slot(l.value, key), [...path, key]);
        if (value.present) result[key] = value.value;
      }
      return { present: true, value: result };
    }
    if (conflicts.length >= CLOUD_SYNC_CONFLICT_LIMITS.conflicts) throw new CloudSyncConflictValidationError();
    const kind: CloudSyncConflict['kind'] = !r.present || !l.present ? 'delete-edit'
      : type(r) !== type(l) || (b.present && (type(b) !== type(r) || type(b) !== type(l))) ? 'type'
        : Array.isArray(r.value) || Array.isArray(l.value) ? 'array' : 'value';
    conflicts.push({ path, kind, base: b, remote: r, local: l });
    const choice = choices?.get(JSON.stringify(path));
    // Missing is a placeholder in an internal, never-published partial tree.
    return choice === 'local' ? l : choice === 'remote' ? r : missing;
  }
  const candidate = merge({ present: true, value: base ?? {} }, { present: true, value: remote }, { present: true, value: local }, []);
  // Apply reset authority even when a whole-tree equality short-circuited recursion.
  const merged = respectRecordResets(remote, local, candidate.present ? candidate.value as CloudState : {});
  return { merged: conflicts.length && !choices ? null : merged, conflicts,
    resetKeys: [...reset.keys].filter(key => own(base ?? {}, key) || own(remote, key) || own(local, key)).sort() };
}

/** No baseline proves no deletion; distinct first-sync values require a choice. */
export function classifyCloudSyncConflicts(base: CloudState | null, remote: CloudState, local: CloudState): CloudSyncConflictClassification {
  return freeze(classify(base === null ? null : cloneState(base), cloneState(remote), cloneState(local)));
}
function cloneRequest(request: CloudSyncRequest): CloudSyncRequest {
  if (!request || typeof request.userId !== 'string' || !request.userId || typeof request.epoch !== 'string' || !request.epoch
    || (request.acknowledgementToken !== null && typeof request.acknowledgementToken !== 'string')
    || (request.storageGeneration !== null && typeof request.storageGeneration !== 'string')) throw new CloudSyncConflictValidationError();
  return { userId: request.userId, epoch: request.epoch, acknowledgementToken: request.acknowledgementToken,
    storageGeneration: request.storageGeneration, local: cloneState(request.local), base: request.base === null ? null : cloneState(request.base) };
}
function cloneRemote(remote: CloudSyncRemoteEvidence): CloudSyncRemoteEvidence {
  if (!remote || typeof remote.updated_at !== 'string' || !remote.updated_at || remote.updated_at.length > 256) throw new CloudSyncConflictValidationError();
  return { updated_at: remote.updated_at, state: cloneState(remote.state) };
}
/** Immutable originals are discarded on owner change; a reload reconstructs from the retained local/base/server versions. */
export function createCloudSyncConflictReview(request: CloudSyncRequest, remote: CloudSyncRemoteEvidence): CloudSyncConflictReview {
  const captured = cloneRequest(request);
  const server = cloneRemote(remote);
  const result = classify(captured.base, server.state, captured.local);
  return freeze({ request: captured, remote: server, conflicts: result.conflicts, resetKeys: result.resetKeys });
}
export function isSameCloudSyncConflictRequest(expected: CloudSyncRequest, current: CloudSyncRequest): boolean {
  return canonical(cloneRequest(expected)) === canonical(cloneRequest(current));
}
/** Pure validation only: caller must revalidate locally under lock, then CAS this exact remote evidence outside the lock. */
export function resolveCloudSyncConflictReview(review: CloudSyncConflictReview, choices: CloudSyncConflictChoice[], currentRequest: CloudSyncRequest, currentRemote: CloudSyncRemoteEvidence): CloudState {
  const captured = cloneRequest(review.request);
  const server = cloneRemote(review.remote);
  if (!isSameCloudSyncConflictRequest(captured, currentRequest) || canonical(server) !== canonical(cloneRemote(currentRemote))) throw new CloudSyncConflictStaleError();
  const actual = classify(captured.base, server.state, captured.local);
  // Recompute rather than trust paths/values from a caller-modified review.
  if (canonical(actual.conflicts) !== canonical(review.conflicts) || canonical(actual.resetKeys) !== canonical(review.resetKeys)) throw new CloudSyncConflictValidationError();
  if (!Array.isArray(choices) || choices.length !== actual.conflicts.length || !choices.length) throw new CloudSyncConflictValidationError();
  const valid = new Set(actual.conflicts.map(conflict => JSON.stringify(conflict.path)));
  const selected = new Map<string, CloudSyncConflictChoice['side']>();
  for (const choice of choices) {
    if (!choice || !Array.isArray(choice.path) || !choice.path.length || choice.path.length > CLOUD_SYNC_CONFLICT_LIMITS.depth
      || choice.path.some(key => typeof key !== 'string' || forbiddenKeys.has(key)) || (choice.side !== 'local' && choice.side !== 'remote')) throw new CloudSyncConflictValidationError();
    const path = JSON.stringify(choice.path);
    if (!valid.has(path) || selected.has(path)) throw new CloudSyncConflictValidationError();
    selected.set(path, choice.side);
  }
  return cloneState(classify(captured.base, server.state, captured.local, selected).merged!);
}

/** After an explicit reviewed dispatch, a later local edit is a new action, not an old choice to reapply. */
export function reconcileCloudSyncResolution(localAtDispatch: CloudState, acknowledged: CloudState, latestLocal: CloudState): CloudState {
  const before = normalizeCloudSyncState(localAtDispatch);
  const sent = normalizeCloudSyncState(acknowledged);
  const latest = normalizeCloudSyncState(latestLocal);
  function apply(b: CloudSyncConflictValue, r: CloudSyncConflictValue, l: CloudSyncConflictValue): CloudSyncConflictValue {
    if (equal(b, l)) return r;
    if ((!b.present || objectSlot(b)) && objectSlot(r) && objectSlot(l)) {
      const bObject = b.present ? b.value as CloudState : {};
      const result: CloudState = {};
      for (const key of new Set([...Object.keys(bObject), ...Object.keys(r.value), ...Object.keys(l.value)])) {
        const value = apply(slot(bObject, key), slot(r.value, key), slot(l.value, key));
        if (value.present) result[key] = value.value;
      }
      return { present: true, value: result };
    }
    return l; // Includes a newer deletion, replacement, array order, and explicit null.
  }
  const result = apply({ present: true, value: before }, { present: true, value: sent }, { present: true, value: latest });
  return respectRecordResets(sent, latest, result.present ? result.value as CloudState : {});
}
