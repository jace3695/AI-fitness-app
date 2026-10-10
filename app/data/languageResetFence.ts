import { allocateConversationResetReplacement, ConversationLocalError, planLanguageLocalParticipants } from './languageLocalParticipants.ts';
import { APP_RECORD_KEYS } from './appRecordReset.ts';
import {
  LANGUAGE_BINDING_KEY, LANGUAGE_MARKER_KEY, LANGUAGE_OWNER_KEY, LANGUAGE_RESET_FENCE_KEY,
  LanguageBoundaryError, languageSyncAckKey, languageSyncBaseKey, parseLanguageBinding,
  parseLanguageMarker, parseLanguageResetFence, readLanguageSyncBase, validLanguageAck,
  type LanguageResetFence,
} from './languageStorageBoundary.ts';
import {
  captureStorageOwner, isStorageOwnerCurrent, readStorageSnapshot, STORAGE_OWNER_KEY,
  STORAGE_READY_KEY, STORAGE_SESSION_KEY, StorageSessionChangedError, updateStorageBatch, updateStorageBatchWithReceipt, StorageWriteAttemptError,
  type StorageOwnerToken, type StorageSnapshot,
} from './storageTransaction.ts';

export type LanguageResetContext = Readonly<{
  owner: StorageOwnerToken & { userId: string };
  requestId: string;
  bindingRaw: string;
  marker: string | null;
  fenceRaw: string | null;
  fence: LanguageResetFence | null;
}>;

const resetContexts = new WeakSet<LanguageResetContext>();
const cleanupVerified = new WeakSet<LanguageResetContext>();
function registeredContext(value: LanguageResetContext): LanguageResetContext {
  const context = Object.freeze({ ...value, owner: Object.freeze({ ...value.owner }), fence: value.fence ? Object.freeze({ ...value.fence, ...(value.fence.evidenceCleanup ? { evidenceCleanup: Object.freeze({ ...value.fence.evidenceCleanup }) } : {}) }) : null });
  resetContexts.add(context); return context;
}

function inspectResetSnapshot(snapshot: StorageSnapshot, owner: StorageOwnerToken) {
  if (snapshot.pending || !owner.userId || !owner.epoch
    || snapshot.getItem(STORAGE_OWNER_KEY) !== owner.userId
    || snapshot.getItem(STORAGE_SESSION_KEY) !== owner.epoch
    || snapshot.getItem(STORAGE_READY_KEY) !== JSON.stringify({ epoch: owner.epoch, userId: owner.userId })) throw new StorageSessionChangedError();
  const bindingRaw = snapshot.getItem(LANGUAGE_BINDING_KEY);
  const binding = parseLanguageBinding(bindingRaw);
  // A pending reset intentionally makes readLanguageBoundary unavailable. Reset
  // confirmation still requires the independently valid, ready owner binding.
  if (!bindingRaw || !binding || binding.status !== 'ready' || binding.owner !== owner.userId
    || binding.epoch !== owner.epoch || snapshot.getItem(LANGUAGE_OWNER_KEY) !== owner.userId) throw new LanguageBoundaryError();
  const marker = snapshot.getItem(LANGUAGE_MARKER_KEY);
  if (parseLanguageMarker(marker).kind === 'invalid') throw new LanguageBoundaryError();
  readLanguageSyncBase(snapshot.getItem(languageSyncBaseKey(owner.userId)));
  const ack = snapshot.getItem(languageSyncAckKey(owner.userId));
  if (ack !== null && !validLanguageAck(ack)) throw new LanguageBoundaryError();
  const fenceRaw = snapshot.getItem(LANGUAGE_RESET_FENCE_KEY);
  const fence = parseLanguageResetFence(fenceRaw);
  if (fence && (fence.owner !== owner.userId || marker !== (fence.state === 'completed' ? fence.marker : fence.expectedMarker))) throw new LanguageBoundaryError();
  return { bindingRaw, marker, fenceRaw, fence };
}

function assertSnapshot(context: LanguageResetContext, snapshot: StorageSnapshot) {
  if (!resetContexts.has(context)) throw new LanguageBoundaryError();
  const current = inspectResetSnapshot(snapshot, context.owner);
  if (current.bindingRaw !== context.bindingRaw || current.marker !== context.marker || current.fenceRaw !== context.fenceRaw) {
    throw new LanguageBoundaryError('학습 초기화 상태가 바뀌었습니다. 기존 요청을 다시 실행하지 않고 기록을 보존했습니다.');
  }
}

/** Capture before the outer operation lock, so queued old requests stay old. */
export function captureLanguageReset(requestId: string, expectedUserId: string): LanguageResetContext {
  const owner = captureStorageOwner();
  if (!expectedUserId || owner.userId !== expectedUserId) throw new StorageSessionChangedError();
  if (!validLanguageAck(requestId)) throw new LanguageBoundaryError('초기화 요청 번호를 확인하지 못했습니다.');
  const current = inspectResetSnapshot(readStorageSnapshot(window.localStorage), owner);
  if (current.fence && (current.fence.state !== 'completed' || current.fence.evidenceCleanup?.status === 'pending') && current.fence.requestId !== requestId) {
    throw new LanguageBoundaryError('완료되지 않은 학습 초기화가 있습니다. 같은 요청으로 결과를 확인해 주세요.');
  }
  if (!isStorageOwnerCurrent(window.localStorage, owner)) throw new StorageSessionChangedError();
  return registeredContext({ owner: { ...owner, userId: expectedUserId }, requestId, ...current });
}

export function assertLanguageResetCurrent(context: LanguageResetContext) {
  if (!resetContexts.has(context)) throw new LanguageBoundaryError();
  if (!isStorageOwnerCurrent(window.localStorage, context.owner)) throw new StorageSessionChangedError();
  assertSnapshot(context, readStorageSnapshot(window.localStorage));
  if (!isStorageOwnerCurrent(window.localStorage, context.owner)) throw new StorageSessionChangedError();
}

export async function establishLanguageReset(context: LanguageResetContext): Promise<LanguageResetContext> {
  assertLanguageResetCurrent(context);
  const continuing = context.fence?.requestId === context.requestId;
  const fence: LanguageResetFence = continuing ? context.fence! : {
    version: 1, owner: context.owner.userId, requestId: context.requestId,
    expectedMarker: context.marker, state: 'pending',
  };
  const fenceRaw = continuing ? context.fenceRaw! : JSON.stringify(fence);
  const acknowledgement = crypto.randomUUID();
  await updateStorageBatch(window.localStorage, (snapshot): Record<string, string | null> => {
    assertSnapshot(context, snapshot);
    return continuing ? {} : {
      [LANGUAGE_RESET_FENCE_KEY]: fenceRaw,
      [languageSyncAckKey(context.owner.userId)]: acknowledgement,
    };
  }, { owner: context.owner });
  const next = registeredContext({ ...context, fence, fenceRaw });
  assertLanguageResetCurrent(next);
  return next;
}

/** Best effort only: a failed uncertainty write leaves the durable pending fence. */
export async function markLanguageResetUncertain(context: LanguageResetContext) {
  if (!context.fence || context.fence.state === 'completed' || context.fence.state === 'uncertain') return;
  await updateStorageBatch(window.localStorage, snapshot => {
    assertSnapshot(context, snapshot);
    return { [LANGUAGE_RESET_FENCE_KEY]: JSON.stringify({ ...context.fence, state: 'uncertain' }) };
  }, { owner: context.owner });
}

export class LanguageResetAcknowledgementError extends Error {
  readonly committed = true;
  constructor() { super('학습 초기화의 기기 정리는 저장됐지만 알림을 마치지 못했습니다. 같은 요청으로 다시 확인해 주세요.'); this.name = 'LanguageResetAcknowledgementError'; }
}

export async function completeLanguageReset(context: LanguageResetContext, marker: string): Promise<LanguageResetContext> {
  assertLanguageResetCurrent(context);
  if (context.fence?.evidenceCleanup && (context.fence.evidenceCleanup.status !== 'verified' || !cleanupVerified.has(context))) throw new LanguageBoundaryError();
  const parsed = parseLanguageMarker(marker);
  if (parsed.kind !== 'valid' || parsed.requestId !== context.requestId || !context.fence) throw new LanguageBoundaryError();
  const replacement = allocateConversationResetReplacement(), acknowledgement = crypto.randomUUID();
  const target = Object.freeze({ ownerId: context.owner.userId, marker, reason: 'explicit-reset' as const, replacement });
  const fence: LanguageResetFence = { ...context.fence, state: 'completed', marker };
  const fenceRaw = JSON.stringify(fence);
  const completed = registeredContext({ ...context, marker, fence, fenceRaw });
  if (cleanupVerified.has(context)) cleanupVerified.add(completed);
  const verifyCompleted = () => {
    assertLanguageResetCurrent(completed);
    // Matching completion permits only a verified same-marker receipt/enrollment.
    // Missing or stale participant proof cannot become another destructive sweep.
    if (Object.keys(planLanguageLocalParticipants(readStorageSnapshot(window.localStorage), target)).length) throw new ConversationLocalError('marker-conflict');
    assertLanguageResetCurrent(completed);
  };
  if (context.fence.state === 'completed') {
    if (context.fence.marker !== marker) throw new LanguageBoundaryError();
    verifyCompleted(); return completed;
  }
  if (context.fence.expectedMarker === marker) {
    throw new LanguageBoundaryError('이전 초기화의 기기 정리 완료 여부를 확인할 수 없습니다. 남은 기록을 보존했으며 별도 복구가 필요합니다.');
  }
  let notificationFailed = false;
  try {
    const receipt = await updateStorageBatchWithReceipt(window.localStorage, snapshot => {
      assertSnapshot(context, snapshot);
      const participantChanges = planLanguageLocalParticipants(snapshot, target);
      return {
        ...Object.fromEntries(APP_RECORD_KEYS.language.map(key => [key, null])), ...participantChanges,
        [LANGUAGE_MARKER_KEY]: marker,
        [languageSyncBaseKey(context.owner.userId)]: null,
        [languageSyncAckKey(context.owner.userId)]: acknowledgement,
        [LANGUAGE_RESET_FENCE_KEY]: fenceRaw,
      };
    }, { owner: context.owner });
    notificationFailed = Boolean(receipt.notificationError);
  } catch (error) {
    // Some hosts mutate then throw. Recognize exact durable completion first;
    // never replace a proven completed fence with pending/uncertain state.
    try { verifyCompleted(); return completed; } catch { /* Keep original outcome. */ }
    if (error instanceof StorageSessionChangedError || error instanceof ConversationLocalError) throw error;
    if (error instanceof StorageWriteAttemptError && (error.originalError instanceof ConversationLocalError || error.originalError instanceof StorageSessionChangedError)) throw error.originalError;
    throw new ConversationLocalError(error instanceof StorageWriteAttemptError && error.outcome === 'unknown' ? 'storage-unknown' : 'storage-unavailable', error instanceof StorageWriteAttemptError ? error.outcome : 'not-committed');
  }
  verifyCompleted();
  if (notificationFailed) throw new LanguageResetAcknowledgementError();
  return completed;
}

/** Inspection is never permission to dispatch; the panel requires a new click. */
export function readPendingLanguageReset(expectedUserId: string): Pick<LanguageResetFence, 'requestId' | 'state'> | null {
  const owner = captureStorageOwner();
  if (!expectedUserId || owner.userId !== expectedUserId) throw new StorageSessionChangedError();
  const { fence } = inspectResetSnapshot(readStorageSnapshot(window.localStorage), owner);
  if (!isStorageOwnerCurrent(window.localStorage, owner)) throw new StorageSessionChangedError();
  return fence && (fence.state !== 'completed' || fence.evidenceCleanup?.status === 'pending') ? { requestId: fence.requestId, state: fence.state } : null;
}


declare const resetEvidenceBrand: unique symbol;
export type LanguageEvidenceResetAuthority = Readonly<{
  readonly [resetEvidenceBrand]: true; ownerId: string; ownerEpoch: number; requestId: string; marker: string;
}>;
const evidenceResetAuthorities = new WeakMap<LanguageEvidenceResetAuthority, LanguageResetContext>();
let evidenceResetSerial = 0;

/** Sole caller: the shipping reset orchestrator, after its original cloud receipt. */
export async function requireLanguageEvidenceCleanup(context: LanguageResetContext, marker: string): Promise<LanguageResetContext> {
  assertLanguageResetCurrent(context);
  const parsed = parseLanguageMarker(marker);
  if (!context.fence || parsed.kind !== 'valid' || parsed.requestId !== context.requestId
    || context.fence.state === 'completed' && context.fence.marker !== marker) throw new LanguageBoundaryError();
  const fence: LanguageResetFence = { ...context.fence, evidenceCleanup: { version: 1, status: 'pending' } };
  const fenceRaw = JSON.stringify(fence), acknowledgement = crypto.randomUUID();
  await updateStorageBatch(window.localStorage, snapshot => {
    assertSnapshot(context, snapshot);
    return { [LANGUAGE_RESET_FENCE_KEY]: fenceRaw, [languageSyncAckKey(context.owner.userId)]: acknowledgement };
  }, { owner: context.owner });
  const next = registeredContext({ ...context, fence, fenceRaw });
  assertLanguageResetCurrent(next); return next;
}

/** Narrow bridge. A copied context, serialized verified flag or owner string is not authority. */
export const languageEvidenceResetCapability = Object.freeze({
  acquire(context: LanguageResetContext, marker: string): LanguageEvidenceResetAuthority {
    assertLanguageResetCurrent(context);
    const parsed = parseLanguageMarker(marker);
    if (context.fence?.evidenceCleanup?.status !== 'pending' || parsed.kind !== 'valid' || parsed.requestId !== context.requestId
      || context.fence.state === 'completed' && context.fence.marker !== marker || evidenceResetSerial === Number.MAX_SAFE_INTEGER) throw new LanguageBoundaryError();
    const authority = Object.freeze({ ownerId: context.owner.userId, ownerEpoch: ++evidenceResetSerial, requestId: context.requestId, marker }) as LanguageEvidenceResetAuthority;
    evidenceResetAuthorities.set(authority, context); return authority;
  },
  assertCurrent(authority: LanguageEvidenceResetAuthority): void {
    const context = evidenceResetAuthorities.get(authority);
    if (!context || context.fence?.evidenceCleanup?.status !== 'pending') throw new LanguageBoundaryError();
    assertLanguageResetCurrent(context);
  },
  /** Sole caller: the repository reset adapter after fresh exact status revalidation. */
  async verify(authority: LanguageEvidenceResetAuthority): Promise<LanguageResetContext> {
    this.assertCurrent(authority);
    const context = evidenceResetAuthorities.get(authority)!;
    const fence: LanguageResetFence = { ...context.fence!, evidenceCleanup: { version: 1, status: 'verified' } };
    const fenceRaw = JSON.stringify(fence);
    await updateStorageBatch(window.localStorage, snapshot => {
      this.assertCurrent(authority); assertSnapshot(context, snapshot);
      return { [LANGUAGE_RESET_FENCE_KEY]: fenceRaw };
    }, { owner: context.owner });
    const next = registeredContext({ ...context, fence, fenceRaw });
    assertLanguageResetCurrent(next); cleanupVerified.add(next); evidenceResetAuthorities.delete(authority);
    return next;
  },
});
