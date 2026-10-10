import { ConversationLocalError, conversationLocalKey, readConversationPartition } from './languageLocalParticipants.ts';
import type { AuthenticatedStorageOwner } from './authenticatedStorageOwner.ts';
import { assertAuthenticatedStorageOwner } from './authenticatedStorageOwner.ts';
import type { TransactionStorage } from './storageTransaction.ts';
import { readStorageSnapshot, STORAGE_GENERATION_KEY, STORAGE_JOURNAL_KEY, STORAGE_OWNER_KEY, STORAGE_PROTOCOL_KEY, STORAGE_READY_KEY, STORAGE_SESSION_KEY } from './storageTransaction.ts';
import { stableState } from './cloudSync.ts';
import { LANGUAGE_BINDING_KEY, LANGUAGE_MARKER_KEY, LANGUAGE_OWNER_KEY, LANGUAGE_RESET_FENCE_KEY, LANGUAGE_STORAGE_KEYS, LanguageBoundaryError, languageSyncAckKey, languageSyncBaseKey, projectLanguageBytes, projectLanguageWire, sameLanguageBytes, type LanguageBytes } from './languageStorageBoundary.ts';
import { captureLanguageRemoteObservation, assertLanguageSyncDispatchCurrent, commitLanguageRemoteReset, commitLanguageSyncResponse, createLanguageSyncLifecycle,
  isLanguageRecordContextCurrent, isLanguageSyncRequestCurrent, LanguageRequestStaleError, planLanguageSync, readLanguageSyncRequest, revokeLanguageRecordContexts } from './languageCloudSync.ts';
import type { LanguageRecordContext, LanguageSyncLifecycle } from './languageCloudSync.ts';
export type LanguageCoordinatorState = { status: 'checking' | 'ready' | 'syncing' | 'pending' | 'paused' | 'blocked' | 'error' | 'uncertain'; message: string; initialized: boolean; context?: LanguageRecordContext; reset?: boolean };
export interface LanguageSyncTransport {
  read(userId: string, signal: AbortSignal): Promise<{ state: Record<string, unknown>; updatedAt: string } | null>;
  insert(userId: string, state: Record<string, unknown>, signal: AbortSignal): Promise<boolean>;
  update(userId: string, state: Record<string, unknown>, expectedUpdatedAt: string, signal: AbortSignal): Promise<boolean>;
  verifyOwner(userId: string, signal: AbortSignal): Promise<boolean>;
}
export function createLanguageSyncCoordinator(options: { lease: AuthenticatedStorageOwner; storage: TransactionStorage; transport: LanguageSyncTransport; onState(state: LanguageCoordinatorState): void }) {
  const { lease, storage, transport, onState } = options;
  let state: LanguageCoordinatorState = { status: 'checking', message: '', initialized: false };
  let lifecycle: LanguageSyncLifecycle | null = null, running: Promise<void> | null = null;
  let disposed = false, dispatched = false, committing = false, changed = false, explicitRefresh = false;
  let dispatchedLocal: LanguageBytes | null = null;
  let lastObserved: string | null = null, followUp: ReturnType<typeof setTimeout> | undefined;
  const publish = (next: Omit<LanguageCoordinatorState, 'initialized'> & { initialized?: boolean }) => {
    if (disposed) return; state = { ...next, initialized: next.initialized ?? state.initialized }; onState(state);
  };
  const fingerprint = () => {
    const snapshot = readStorageSnapshot(storage);
    const participant = readConversationPartition(snapshot.getItem(conversationLocalKey(lease.userId)), lease.userId);
    // Shared generation advances for private conversation writes too. Schedule
    // cloud work only for relevant bytes/control changes, after validating that
    // the private participant is safe. Dispatch/CAS still binds full generation.
    return stableState({ pending: snapshot.pending, local: projectLanguageBytes(snapshot),
      owner: snapshot.getItem(STORAGE_OWNER_KEY), languageOwner: snapshot.getItem(LANGUAGE_OWNER_KEY),
      participantMarker: participant ? participant.marker : snapshot.getItem(LANGUAGE_MARKER_KEY),
      base: snapshot.getItem(languageSyncBaseKey(lease.userId)), ack: snapshot.getItem(languageSyncAckKey(lease.userId)),
      binding: snapshot.getItem(LANGUAGE_BINDING_KEY), fence: snapshot.getItem(LANGUAGE_RESET_FENCE_KEY), ready: snapshot.getItem(STORAGE_READY_KEY), session: snapshot.getItem(STORAGE_SESSION_KEY) });
  };
  const current = (operation: LanguageSyncLifecycle) => !disposed && lifecycle === operation && operation.isCurrent() && lease.isCurrent() && !lease.signal.aborted;
  const check = (operation: LanguageSyncLifecycle) => { assertAuthenticatedStorageOwner(lease); if (!current(operation)) throw new LanguageRequestStaleError(); };
  const schedule = () => {
    clearTimeout(followUp);
    if (!disposed && lifecycle?.isCurrent() && lease.isCurrent()) followUp = setTimeout(() => { followUp = undefined; void refresh(); }, 250);
  };
  function pause(reason = '학습 기록을 다시 확인할 때까지 잠시 멈췄습니다.') {
    if (disposed) return;
    const uncertain = dispatched; dispatchedLocal = null;
    lifecycle?.revoke(); lifecycle = null; clearTimeout(followUp); changed = false; explicitRefresh = false;
    publish({ status: uncertain ? 'uncertain' : 'paused', message: uncertain ? '서버 요청의 결과를 아직 확인하지 못했습니다. 기기 기록을 보존하고 다음 연결에서 먼저 조회합니다.' : reason });
  }
  const onRevoked = () => pause('로그인 상태가 변경되어 학습 기록 확인을 멈췄습니다.');
  lease.signal.addEventListener('abort', onRevoked);
  async function run(operation: LanguageSyncLifecycle) {
    let successful = false;
    try {
      check(operation);
      // Keep only the registered warm capability; auth/read checks still gate
      // the editor, and a resumed lifecycle cannot reuse its revoked context.
      const editingContext = state.context;
      publish({ status: 'checking', message: '' });
      const verified = await transport.verifyOwner(lease.userId, operation.signal);
      check(operation); if (!verified) throw new LanguageBoundaryError('로그인 상태를 확인하지 못했습니다. 학습 기록은 보존했습니다.');
      let request = readLanguageSyncRequest(lease, operation, storage);
      for (let attempt = 0; attempt < 4; attempt++) {
        check(operation);
        const remote = await transport.read(lease.userId, operation.signal);
        check(operation);
        let observation = remote ? captureLanguageRemoteObservation(request, remote.state) : undefined;
        if (!isLanguageSyncRequestCurrent(request, 'dispatch')) {
          request = readLanguageSyncRequest(lease, operation, storage);
          // A new snapshot starts a new read-first calculation, never changes an already named payload.
          continue;
        }
        const plan = planLanguageSync(request, remote?.state ?? null);
        if (plan.kind === 'reset') revokeLanguageRecordContexts(operation);
        let observed = plan.wire as Record<string, unknown>;
        if (plan.kind === 'write' || plan.kind === 'insert') {
          await assertLanguageSyncDispatchCurrent(request);
          check(operation);
          if (!isLanguageSyncRequestCurrent(request, 'dispatch')) throw new LanguageRequestStaleError();
          dispatched = true; dispatchedLocal = request.local;
          // There is deliberately no awaited work between the guard and exact send.
          const publication = plan.kind === 'insert'
            ? transport.insert(lease.userId, observed, operation.signal)
            : transport.update(lease.userId, observed, remote!.updatedAt, operation.signal);
          // Exact guarded dispatch has started. Local edits may continue under
          // the same valid capability, but neither PATCH nor readback is ready.
          if (current(operation) && editingContext && isLanguageRecordContextCurrent(editingContext)) {
            publish({ status: 'syncing', message: '', context: editingContext });
          }
          const accepted = await publication;
          check(operation);
          if (!accepted) { dispatched = false; dispatchedLocal = null; publish({ status: 'checking', message: '' }); continue; }
          const readback = await transport.read(lease.userId, operation.signal);
          check(operation);
          observation = readback ? captureLanguageRemoteObservation(request, readback.state) : undefined;
          if (!readback || stableState(readback.state) !== stableState(observed)) throw new Error('저장 후 서버 학습 기록을 일치하는 내용으로 확인하지 못했습니다. 기기 원본은 보존했습니다.');
          observed = readback.state;
        }
        check(operation);
        if (!isLanguageSyncRequestCurrent(request, 'ack')) throw new LanguageRequestStaleError();
        committing = true;
        const result = plan.kind === 'reset' ? await commitLanguageRemoteReset(request, observed, observation)
          : await commitLanguageSyncResponse(request, observed, { preserveLocal: plan.kind === 'bootstrap-base', observation });
        check(operation);
        committing = false;
        if (!isLanguageRecordContextCurrent(result.context)) throw new LanguageRequestStaleError();
        const pending = !sameLanguageBytes(projectLanguageBytes(readStorageSnapshot(storage)), projectLanguageWire(observed));
        dispatched = false; dispatchedLocal = null; lastObserved = fingerprint(); successful = true;
        publish({ status: pending ? 'pending' : 'ready', message: '', initialized: true, context: result.context, reset: result.reset });
        if (pending) schedule();
        return;
      }
      throw new LanguageRequestStaleError();
    } catch (error) {
      if (!current(operation)) return;
      revokeLanguageRecordContexts(operation);
      const message = error instanceof ConversationLocalError ? '기기의 일본어 대화 기록을 확인할 수 없어 학습 기록 저장을 멈췄습니다. 원본은 보존했습니다. 손상되거나 지원하지 않는 기록은 별도 복구가 필요합니다.' : error instanceof LanguageBoundaryError || error instanceof LanguageRequestStaleError ? error.message : '학습 기록을 확인하지 못했습니다. 원본을 보존했습니다.';
      if (dispatched) publish({ status: 'uncertain', message: `${message} 서버 반영 여부는 다음 연결에서 먼저 조회합니다.` });
      else if (error instanceof LanguageBoundaryError || error instanceof ConversationLocalError) publish({ status: 'blocked', message });
      else if (error instanceof LanguageRequestStaleError) { publish({ status: 'checking', message }); schedule(); }
      else publish({ status: 'error', message });
    } finally {
      if (current(operation)) {
        committing = false;
        dispatched = false; dispatchedLocal = null;
        if (explicitRefresh) { explicitRefresh = false; schedule(); }
        else if (changed && successful) { changed = false; try { if (fingerprint() !== lastObserved) schedule(); } catch { pause(); } }
      }
    }
  }
  function refresh(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (!lifecycle?.isCurrent()) return resume();
    if (running) { explicitRefresh = true; return running; }
    const operation = lifecycle;
    const promise = run(operation); running = promise;
    void promise.finally(() => { if (running === promise) running = null; }).catch(() => {});
    return promise;
  }
  function resume(): Promise<void> {
    if (disposed) return Promise.resolve();
    lifecycle?.revoke(); clearTimeout(followUp); changed = false; explicitRefresh = false; dispatched = false; dispatchedLocal = null;
    const operation = createLanguageSyncLifecycle(); lifecycle = operation;
    // Old unresolved HTTP is retired; it cannot block or overwrite this new operation.
    const promise = run(operation); running = promise;
    void promise.finally(() => { if (running === promise) running = null; }).catch(() => {});
    return promise;
  }
  function notifyStorage(key: string | null) {
    if (disposed) return;
    const controls = [STORAGE_JOURNAL_KEY, STORAGE_OWNER_KEY, STORAGE_READY_KEY, STORAGE_SESSION_KEY,
      LANGUAGE_BINDING_KEY, LANGUAGE_MARKER_KEY, LANGUAGE_RESET_FENCE_KEY, languageSyncBaseKey(lease.userId), languageSyncAckKey(lease.userId)];
    if (key === null || controls.includes(key)) { pause('학습 기록의 계정·초기화 상태가 바뀌어 다시 확인해야 합니다.'); return; }
    if (key !== 'records' && key !== STORAGE_PROTOCOL_KEY && key !== STORAGE_GENERATION_KEY && !(LANGUAGE_STORAGE_KEYS as readonly string[]).includes(key)) return;
    if (committing) { changed = true; return; }
    try {
      const observed = fingerprint();
      if (running) {
        if (observed !== lastObserved) changed = true;
        const context = state.context;
        if (dispatchedLocal && context && isLanguageRecordContextCurrent(context)
          && !sameLanguageBytes(projectLanguageBytes(readStorageSnapshot(storage)), dispatchedLocal)) {
          // A new edit may equal the prior acknowledgement but still differ
          // from the exact payload currently in flight.
          changed = true;
          publish({ status: 'pending', message: '', context });
        }
        return;
      }
      if (observed === lastObserved) return;
      if (lifecycle?.isCurrent()) { const context = state.context; publish({ status: context && isLanguageRecordContextCurrent(context) ? 'pending' : 'checking', message: '', context }); schedule(); }
    } catch { pause('기기 기록을 읽지 못했습니다. 원본은 보존했습니다.'); }
  }
  return { start: resume, resume, refresh, pause, notifyStorage,
    dispose() { if (disposed) return; lifecycle?.revoke(); clearTimeout(followUp); lease.signal.removeEventListener('abort', onRevoked); disposed = true; },
    getState: () => state };
}
