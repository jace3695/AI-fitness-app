import { mergeCloudStateFromBase, stableState } from './cloudSync.ts';
import { APP_RECORD_KEYS } from './appRecordReset.ts';
import { assertAuthenticatedStorageOwner } from './authenticatedStorageOwner.ts';
import type { AuthenticatedStorageOwner } from './authenticatedStorageOwner.ts';
import { isStorageOwnerCurrent, readStorageSnapshot, STORAGE_READY_KEY, StorageWriteAttemptError, updateStorageBatch, updateStorageBatchWithReceipt } from './storageTransaction.ts';
import type { StorageSnapshot, TransactionStorage } from './storageTransaction.ts';
import { LANGUAGE_BINDING_KEY, LANGUAGE_MARKER_KEY, LANGUAGE_RESET_FENCE_KEY, LANGUAGE_STORAGE_KEYS,
  LanguageBoundaryError, languageSyncAckKey, languageSyncBaseKey, parseLanguageMarker, projectLanguageBytes,
  projectLanguageWire, readLanguageBoundary, readLanguageSyncBase, sameLanguageBytes, validateLanguageWire } from './languageStorageBoundary.ts';
import type { LanguageBinding, LanguageBytes, LanguageStorageKey } from './languageStorageBoundary.ts';
export { LANGUAGE_STORAGE_KEYS, readLanguageSyncBase } from './languageStorageBoundary.ts';
export type LanguageState = LanguageBytes;

export class LanguageRequestStaleError extends Error {
  constructor() { super('학습 기록의 저장 조건이 바뀌었습니다. 최신 상태를 다시 확인해 주세요.'); this.name = 'LanguageRequestStaleError'; }
}
export interface LanguageSyncLifecycle { readonly id: string; readonly signal: AbortSignal; isCurrent(): boolean; revoke(): void }
const lifecycles = new WeakMap<LanguageSyncLifecycle, { writes: number }>();
export function createLanguageSyncLifecycle(): LanguageSyncLifecycle {
  const controller = new AbortController();
  const lifecycle = Object.freeze({ id: crypto.randomUUID(), signal: controller.signal,
    isCurrent: () => !controller.signal.aborted, revoke: () => controller.abort() });
  lifecycles.set(lifecycle, { writes: 0 }); return lifecycle;
}
export function revokeLanguageRecordContexts(lifecycle: LanguageSyncLifecycle) { const entry = lifecycles.get(lifecycle); if (entry) entry.writes++; }
function assertLifecycle(lease: AuthenticatedStorageOwner, lifecycle: LanguageSyncLifecycle, storage: TransactionStorage) {
  assertAuthenticatedStorageOwner(lease);
  if (!lifecycles.has(lifecycle) || !lifecycle.isCurrent() || lifecycle.signal.aborted || !isStorageOwnerCurrent(storage, lease)) throw new LanguageRequestStaleError();
}
export interface LanguageSyncRequest {
  readonly userId: string; readonly epoch: string | null; readonly id: string; readonly signal: AbortSignal;
  readonly local: LanguageBytes; readonly base: Readonly<Record<string, unknown>> | null;
  readonly baseRaw: string | null; readonly acknowledgementRaw: string | null;
  readonly storageGeneration: string | null; readonly bindingRaw: string; readonly readyRaw: string;
  readonly markerRaw: string | null; readonly resetFenceRaw: string | null;
  readonly binding: LanguageBinding;
}
type RequestPrivate = { lease: AuthenticatedStorageOwner; lifecycle: LanguageSyncLifecycle; storage: TransactionStorage };
const requests = new WeakMap<LanguageSyncRequest, RequestPrivate>();
function freezeWire(state: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const copy = JSON.parse(JSON.stringify(validateLanguageWire(state))) as Record<string, unknown>;
  function freeze(value: unknown) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }
  freeze(copy); return copy;
}
function requireRequest(request: LanguageSyncRequest): RequestPrivate {
  const context = requests.get(request); if (!context) throw new LanguageRequestStaleError();
  assertLifecycle(context.lease, context.lifecycle, context.storage); return context;
}
export function readLanguageSyncRequest(lease: AuthenticatedStorageOwner, lifecycle: LanguageSyncLifecycle, storage: TransactionStorage = window.localStorage): LanguageSyncRequest {
  assertLifecycle(lease, lifecycle, storage);
  const snapshot = readStorageSnapshot(storage), boundary = readLanguageBoundary(snapshot, lease);
  if (boundary.status !== 'ready') throw new LanguageBoundaryError(boundary.reason);
  const baseRaw = snapshot.getItem(languageSyncBaseKey(lease.userId));
  const base = readLanguageSyncBase(baseRaw);
  assertLifecycle(lease, lifecycle, storage);
  const request: LanguageSyncRequest = Object.freeze({ userId: lease.userId, epoch: lease.epoch, id: crypto.randomUUID(), signal: lifecycle.signal,
    local: projectLanguageBytes(snapshot), base: base === null ? null : freezeWire(base), baseRaw,
    acknowledgementRaw: snapshot.getItem(languageSyncAckKey(lease.userId)), storageGeneration: snapshot.generation,
    bindingRaw: snapshot.getItem(LANGUAGE_BINDING_KEY)!, readyRaw: snapshot.getItem(STORAGE_READY_KEY)!,
    markerRaw: snapshot.getItem(LANGUAGE_MARKER_KEY), resetFenceRaw: snapshot.getItem(LANGUAGE_RESET_FENCE_KEY), binding: Object.freeze({ ...boundary.binding }) });
  requests.set(request, { lease, lifecycle, storage }); return request;
}
function assertSnapshot(request: LanguageSyncRequest, snapshot: StorageSnapshot, mode: 'dispatch' | 'ack') {
  const context = requireRequest(request);
  const boundary = readLanguageBoundary(snapshot, context.lease);
  if (boundary.status !== 'ready' || snapshot.pending
    || snapshot.getItem(LANGUAGE_BINDING_KEY) !== request.bindingRaw || snapshot.getItem(STORAGE_READY_KEY) !== request.readyRaw
    || snapshot.getItem(LANGUAGE_MARKER_KEY) !== request.markerRaw || snapshot.getItem(LANGUAGE_RESET_FENCE_KEY) !== request.resetFenceRaw
    || snapshot.getItem(languageSyncBaseKey(request.userId)) !== request.baseRaw
    || snapshot.getItem(languageSyncAckKey(request.userId)) !== request.acknowledgementRaw
    || (mode === 'dispatch' && (snapshot.generation !== request.storageGeneration || !sameLanguageBytes(projectLanguageBytes(snapshot), request.local)))) throw new LanguageRequestStaleError();
}
export function isLanguageSyncRequestCurrent(request: LanguageSyncRequest, mode: 'dispatch' | 'ack' | 'runtime' = 'ack'): boolean {
  try { const context = requireRequest(request); if (mode !== 'runtime') assertSnapshot(request, readStorageSnapshot(context.storage), mode); return true; } catch { return false; }
}
export async function assertLanguageSyncDispatchCurrent(request: LanguageSyncRequest): Promise<void> {
  const context = requireRequest(request);
  await updateStorageBatch(context.storage, snapshot => { assertSnapshot(request, snapshot, 'dispatch'); return {}; }, { owner: context.lease });
  // No await between this final synchronous check and the caller's exact HTTP dispatch.
  assertSnapshot(request, readStorageSnapshot(context.storage), 'dispatch');
}
export function compareLanguageReset(request: LanguageSyncRequest, remote: Record<string, unknown>): 'same' | 'newer' {
  validateLanguageWire(remote);
  const local = parseLanguageMarker(request.markerRaw), observed = parseLanguageMarker(Object.hasOwn(remote, LANGUAGE_MARKER_KEY) ? remote[LANGUAGE_MARKER_KEY] : undefined);
  if (local.kind === 'invalid' || observed.kind === 'invalid') throw new LanguageBoundaryError();
  if (local.kind === 'missing' && observed.kind === 'missing') return 'same';
  if (local.kind === 'valid' && observed.kind === 'valid' && local.raw === observed.raw) return 'same';
  if (observed.kind === 'valid' && (local.kind === 'missing' || observed.time > local.time)) return 'newer';
  throw new LanguageBoundaryError('학습 초기화 표식이 서로 달라 자동으로 합칠 수 없습니다. 원본을 보존했습니다. 별도 확인이 필요합니다.');
}
export type LanguageSyncPlan = { kind: 'observe' | 'bootstrap-base' | 'reset' | 'write' | 'insert'; wire: Readonly<Record<string, unknown>> };
/** Pure planning: unknown current remote fields are never inferred to be locally deleted. */
export function planLanguageSync(request: LanguageSyncRequest, remote: Record<string, unknown> | null): LanguageSyncPlan {
  requireRequest(request);
  if (remote === null) {
    if (request.binding.provenance !== 'new' || request.baseRaw !== null || request.acknowledgementRaw !== null || Object.keys(request.local).length !== 0) throw new LanguageBoundaryError('이전 학습 기록의 서버 원본을 찾지 못했습니다. 기기 기록을 보존하고 자동 재생성을 중단했습니다.');
    return { kind: 'insert', wire: freezeWire({}) };
  }
  validateLanguageWire(remote);
  if (compareLanguageReset(request, remote) === 'newer') return { kind: 'reset', wire: freezeWire(remote) };
  const remoteKnown = projectLanguageWire(remote);
  if (request.acknowledgementRaw === null || request.base === null) {
    // Reset receipt invalidates base without claiming remote settings were acknowledged.
    if (Object.keys(request.local).length === 0 || sameLanguageBytes(request.local, remoteKnown)) return { kind: 'observe', wire: freezeWire(remote) };
    if (request.base !== null && stableState(request.base) === stableState(remote)) return { kind: 'bootstrap-base', wire: freezeWire(remote) };
    // A completed reset establishes record authority, but settings still need exact agreement.
    if (request.resetFenceRaw !== null && sameLanguageBytes(request.local, remoteKnown)) return { kind: 'observe', wire: freezeWire(remote) };
    throw new LanguageBoundaryError('기기의 학습 기록과 서버 기록의 공통 기준을 확인하지 못했습니다. 원본을 보존했습니다. 별도 복구가 필요합니다.');
  }
  const known = mergeCloudStateFromBase(projectLanguageWire(request.base as Record<string, unknown>), remoteKnown, request.local);
  const unknown = Object.fromEntries(Object.entries(remote).filter(([key]) => !(LANGUAGE_STORAGE_KEYS as readonly string[]).includes(key)));
  const wire = freezeWire({ ...unknown, ...known });
  return { kind: stableState(wire) === stableState(remote) ? 'observe' : 'write', wire };
}
export interface LanguageRecordContext { readonly userId: string; readonly epoch: string | null; readonly signal: AbortSignal }
type RecordContextPrivate = RequestPrivate & { writes: number; bindingRaw: string; markerRaw: string | null; resetFenceRaw: string | null; ackRaw: string; readyRaw: string };
const recordContexts = new WeakMap<LanguageRecordContext, RecordContextPrivate>();
function mintRecordContext(context: RequestPrivate, snapshot: StorageSnapshot): LanguageRecordContext {
  const value = Object.freeze({ userId: context.lease.userId, epoch: context.lease.epoch, signal: context.lifecycle.signal });
  recordContexts.set(value, { ...context, writes: lifecycles.get(context.lifecycle)!.writes,
    bindingRaw: snapshot.getItem(LANGUAGE_BINDING_KEY)!, markerRaw: snapshot.getItem(LANGUAGE_MARKER_KEY), resetFenceRaw: snapshot.getItem(LANGUAGE_RESET_FENCE_KEY),
    ackRaw: snapshot.getItem(languageSyncAckKey(context.lease.userId))!, readyRaw: snapshot.getItem(STORAGE_READY_KEY)! });
  return value;
}
function assertRecordContext(context: LanguageRecordContext, snapshot?: StorageSnapshot): RecordContextPrivate {
  const entry = recordContexts.get(context); if (!entry) throw new LanguageRequestStaleError();
  assertLifecycle(entry.lease, entry.lifecycle, entry.storage);
  const current = snapshot ?? readStorageSnapshot(entry.storage);
  if (lifecycles.get(entry.lifecycle)!.writes !== entry.writes || readLanguageBoundary(current, entry.lease).status !== 'ready'
    || current.getItem(LANGUAGE_BINDING_KEY) !== entry.bindingRaw || current.getItem(LANGUAGE_MARKER_KEY) !== entry.markerRaw
    || current.getItem(LANGUAGE_RESET_FENCE_KEY) !== entry.resetFenceRaw || current.getItem(STORAGE_READY_KEY) !== entry.readyRaw
    || current.getItem(languageSyncAckKey(context.userId)) !== entry.ackRaw) throw new LanguageRequestStaleError();
  return entry;
}
export function isLanguageRecordContextCurrent(context: LanguageRecordContext): boolean { try { assertRecordContext(context); return true; } catch { return false; } }
export interface LanguageCommitResult { local: LanguageBytes; pending: boolean; context: LanguageRecordContext; reset: boolean; generation: string | null }
async function commitResponse(request: LanguageSyncRequest, observedWire: Record<string, unknown>, mode: 'normal' | 'bootstrap-base' | 'reset'): Promise<LanguageCommitResult> {
  const context = requireRequest(request), wire = freezeWire(observedWire), known = projectLanguageWire(wire as Record<string, unknown>);
  if ((compareLanguageReset(request, wire as Record<string, unknown>) === 'newer') !== (mode === 'reset')) throw new LanguageBoundaryError();
  let local: LanguageBytes = {};
  const nextAck = crypto.randomUUID();
  const binding = JSON.stringify({ ...request.binding, provenance: 'verified' });
  await updateStorageBatch(context.storage, snapshot => {
    assertSnapshot(request, snapshot, 'ack');
    const latest = projectLanguageBytes(snapshot), changes: Record<string, string | null> = {};
    for (const key of LANGUAGE_STORAGE_KEYS) {
      const oldResetRecord = mode === 'reset' && (APP_RECORD_KEYS.language.includes(key) || key === LANGUAGE_MARKER_KEY);
      const keepLatest = mode === 'bootstrap-base' || (!oldResetRecord && latest[key] !== request.local[key]);
      changes[key] = (keepLatest ? latest[key] : known[key]) ?? null;
    }
    local = Object.freeze(Object.fromEntries(LANGUAGE_STORAGE_KEYS.flatMap(key => changes[key] === null ? [] : [[key, changes[key]]]))) as LanguageBytes;
    return { ...changes, [languageSyncBaseKey(request.userId)]: JSON.stringify(wire), [languageSyncAckKey(request.userId)]: nextAck,
      [LANGUAGE_BINDING_KEY]: binding,
      // A newer authenticated remote marker supersedes a completed older local receipt.
      ...(mode === 'reset' ? { [LANGUAGE_RESET_FENCE_KEY]: null } : {}) };
  }, { owner: context.lease });
  assertLifecycle(context.lease, context.lifecycle, context.storage);
  const snapshot = readStorageSnapshot(context.storage);
  if (snapshot.getItem(languageSyncAckKey(request.userId)) !== nextAck || snapshot.getItem(LANGUAGE_BINDING_KEY) !== binding
    || snapshot.getItem(LANGUAGE_MARKER_KEY) !== (known[LANGUAGE_MARKER_KEY] ?? null)) throw new LanguageRequestStaleError();
  const recordContext = mintRecordContext(context, snapshot); assertRecordContext(recordContext);
  local = projectLanguageBytes(snapshot);
  return { local, pending: !sameLanguageBytes(local, known), context: recordContext, reset: mode === 'reset', generation: snapshot.generation };
}
export function commitLanguageSyncResponse(request: LanguageSyncRequest, observedWire: Record<string, unknown>, options: { preserveLocal?: boolean } = {}) {
  return commitResponse(request, observedWire, options.preserveLocal ? 'bootstrap-base' : 'normal');
}
export function commitLanguageRemoteReset(request: LanguageSyncRequest, observedRemote: Record<string, unknown>) {
  const context = requireRequest(request); revokeLanguageRecordContexts(context.lifecycle); return commitResponse(request, observedRemote, 'reset');
}
export interface LanguageDraftRevision { readonly generation: string | null }
export interface LanguageRecordSnapshot { readonly context: LanguageRecordContext; readonly records: LanguageBytes; readonly generation: string | null; readonly revision: LanguageDraftRevision }
const revisions = new WeakMap<LanguageDraftRevision, { context: LanguageRecordContext; values: LanguageBytes; keys: readonly LanguageStorageKey[] }>();
const recordSnapshots = new WeakSet<LanguageRecordSnapshot>();
const BUSINESS_KEYS = LANGUAGE_STORAGE_KEYS.filter(key => key !== LANGUAGE_MARKER_KEY);
function makeRecordSnapshot(context: LanguageRecordContext, snapshot: StorageSnapshot, keys: readonly LanguageStorageKey[]): LanguageRecordSnapshot {
  if (keys.some(key => key === LANGUAGE_MARKER_KEY || !LANGUAGE_STORAGE_KEYS.includes(key))) throw new LanguageBoundaryError();
  const records = Object.freeze(projectLanguageBytes(snapshot));
  const revision = Object.freeze({ generation: snapshot.generation });
  revisions.set(revision, { context, values: records, keys: [...keys] });
  const result = Object.freeze({ context, records, generation: snapshot.generation, revision }); recordSnapshots.add(result); return result;
}
export function readLanguageRecordSnapshot(context: LanguageRecordContext, keys: readonly LanguageStorageKey[] = BUSINESS_KEYS): LanguageRecordSnapshot {
  const entry = assertRecordContext(context), snapshot = readStorageSnapshot(entry.storage); assertRecordContext(context, snapshot);
  if (snapshot.pending) throw new LanguageRequestStaleError();
  return makeRecordSnapshot(context, snapshot, keys);
}
function assertSameRecordOrigin(oldContext: LanguageRecordContext, context: LanguageRecordContext): void {
  const old = recordContexts.get(oldContext), current = assertRecordContext(context);
  if (!old || old.storage !== current.storage || oldContext.userId !== context.userId || oldContext.epoch !== context.epoch
    || old.bindingRaw !== current.bindingRaw || old.markerRaw !== current.markerRaw || old.resetFenceRaw !== current.resetFenceRaw
    || old.readyRaw !== current.readyRaw) throw new LanguageRequestStaleError();
}
/** A source may be retained through acknowledgement rotation, never owner/reset ABA. */
export function assertLanguageRecordSource(source: LanguageRecordSnapshot, context: LanguageRecordContext): void {
  if (!recordSnapshots.has(source) || revisions.get(source.revision)?.context !== source.context) throw new LanguageRequestStaleError();
  assertSameRecordOrigin(source.context, context);
}
export function captureLanguageDraftRevision(context: LanguageRecordContext, keys: readonly LanguageStorageKey[]): LanguageDraftRevision {
  return readLanguageRecordSnapshot(context, keys).revision;
}
export function rebaseLanguageDraftRevision(oldRevision: LanguageDraftRevision, newContext: LanguageRecordContext): LanguageDraftRevision {
  const old = revisions.get(oldRevision); if (!old) throw new LanguageRequestStaleError();
  assertSameRecordOrigin(old.context, newContext);
  const next = readLanguageRecordSnapshot(newContext, old.keys);
  if (old.keys.some(key => old.values[key] !== next.records[key])) throw new LanguageRequestStaleError();
  return next.revision;
}
export interface LanguageRecordWriteResult {
  readonly generation: string | null; readonly records: LanguageBytes; readonly committedRecords: LanguageBytes;
  readonly acknowledged: boolean; readonly source: LanguageRecordSnapshot | null;
}
export async function updateLanguageRecords(context: LanguageRecordContext, transform: (fresh: LanguageBytes) => Partial<Record<LanguageStorageKey, string | null>>, options: { expectedDraft?: LanguageDraftRevision } = {}): Promise<LanguageRecordWriteResult> {
  let entry: RecordContextPrivate;
  try { entry = assertRecordContext(context); } catch (error) { throw new StorageWriteAttemptError(error, 'not-committed'); }
  const receipt = await updateStorageBatchWithReceipt(entry.storage, snapshot => {
    assertRecordContext(context, snapshot);
    if (options.expectedDraft) {
      const revision = revisions.get(options.expectedDraft);
      if (!revision || revision.context !== context || options.expectedDraft.generation !== snapshot.generation
        || revision.keys.some(key => snapshot.getItem(key) !== (revision.values[key] ?? null))) throw new LanguageRequestStaleError();
    }
    const changes = transform(projectLanguageBytes(snapshot));
    if (!changes || typeof changes !== 'object' || Array.isArray(changes) || 'then' in changes
      || Object.entries(changes).some(([key, value]) => key === LANGUAGE_MARKER_KEY || !(LANGUAGE_STORAGE_KEYS as readonly string[]).includes(key) || !(value === null || typeof value === 'string'))) throw new LanguageBoundaryError();
    return changes as Record<string, string | null>;
  }, { owner: entry.lease });
  const committedRecords = Object.freeze(projectLanguageBytes(receipt.snapshot));
  let source: LanguageRecordSnapshot | null = null;
  if (receipt.ownerCurrent && !receipt.notificationError) { try { source = readLanguageRecordSnapshot(context); } catch { /* Durable commit; UI authority retired. */ } }
  return { generation: receipt.snapshot.generation, records: source?.records ?? committedRecords, committedRecords, acknowledged: source !== null, source };
}
