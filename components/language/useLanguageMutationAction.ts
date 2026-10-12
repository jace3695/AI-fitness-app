'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { assertLanguageRecordSource, isLanguageRecordContextCurrent, readLanguageRecordSnapshot, rebaseLanguageDraftRevision, type LanguageRecordContext, type LanguageRecordSnapshot } from '@/app/data/languageCloudSync';
import { assertLanguageMutationUncommitted, createLanguageMutation, getLanguageMutationOutcome, languageMutationError, reconcileLanguageMutation, requireLanguageMutationAcknowledged, runLanguageMutation, type LanguageMutation, type LanguageMutationPlan, type LanguageMutationResult } from '@/app/data/languageRecordMutations';
import { LanguageDocumentError, LanguageSourceConflictError } from '@/app/data/languageRecordDocuments';
import { isLanguageRowHandle } from '@/app/data/languageRecordIdentity';
import type { LanguageBytes } from '@/app/data/languageStorageBoundary';
import { getLocalDateKey } from '@/utils/dateKey';

type Source = { context: LanguageRecordContext | null; snapshot: LanguageRecordSnapshot | null };
type Options<T, R> = { strictSource?: boolean; date?: string; verify?: (fresh: LanguageBytes, intent: LanguageMutation<T>) => R };
function freezeInput<T>(input: T): T {
  const copy = (value: unknown): unknown => {
    if (isLanguageRowHandle(value) || value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return Object.freeze(value.map(copy));
    if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])));
    throw new LanguageDocumentError();
  };
  return copy(input) as T;
}
/** One user action at a time. Reconciliation and a new, explicitly requested save are distinct. */
export function useLanguageMutationAction<T, R>(source: Source, planner: (fresh: LanguageBytes, intent: LanguageMutation<T>) => LanguageMutationPlan<R>, options: Options<T, R> = {}) {
  const live = useRef(source); live.current = source;
  const mounted = useRef(true), sequence = useRef(0), running = useRef(false);
  type Action = { intent: LanguageMutation<T> | null; origin: Source; payload: T; timestamp: string; date: string; operationId: string; publish?: (result: LanguageMutationResult<R>) => void; strictSource: boolean; verify?: Options<T, R>['verify']; sequence: number; received?: boolean };
  const retained = useRef<Action | null>(null);
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const attempt = async (): Promise<boolean> => {
    const action = retained.current;
    if (!action || running.current) return false;
    running.current = true; setBusy(true); setError(null);
    try {
      const context = live.current.context;
      if (!context) throw new LanguageSourceConflictError('학습 기록 연결을 확인한 뒤 같은 저장을 다시 확인해 주세요. 입력은 보존됩니다.');
      if (!action.intent) {
        if (!action.origin.context || !action.origin.snapshot || context !== action.origin.context) throw new LanguageSourceConflictError('원래 저장은 시작되지 않았습니다. 최신 상태에서 새로 저장하거나 보류한 입력을 버려 주세요.');
        action.intent = createLanguageMutation(action.origin.context, action.origin.snapshot, action.payload, { operationId: action.operationId, timestamp: action.timestamp, date: action.date });
      }
      const outcome = getLanguageMutationOutcome(action.intent);
      let result: LanguageMutationResult<R>;
      if (!action.received && outcome !== 'committed' && outcome !== 'unknown' && context === action.intent.context && isLanguageRecordContextCurrent(context)) {
        result = await runLanguageMutation(action.intent, planner, action.strictSource ? { expectedDraft: action.intent.source.revision } : {});
      } else result = reconcileLanguageMutation(action.intent, context, action.verify);
      action.received = true;
      requireLanguageMutationAcknowledged(result);
      if (!mounted.current || action.sequence !== sequence.current || retained.current !== action || live.current.context !== context || !isLanguageRecordContextCurrent(context)) throw new LanguageSourceConflictError('저장 확인 중 화면의 연결 상태가 바뀌었습니다. 답을 보존했어요. 저장을 다시 확인해 주세요.');
      action.publish?.(result);
      retained.current = null; setPending(false); setError(null); return true;
    } catch (failure) { if (mounted.current) setError(languageMutationError(failure)); return false; }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  };
  const submit = (payload: T, publish?: (result: LanguageMutationResult<R>) => void, sourceOverride?: LanguageRecordSnapshot): Promise<boolean> => {
    if (retained.current || running.current) return Promise.resolve(false);
    try {
      const now = new Date();
      retained.current = { intent: null, origin: { context: live.current.context, snapshot: sourceOverride ?? live.current.snapshot }, payload: freezeInput(payload), timestamp: now.toISOString(), date: options.date ?? getLocalDateKey(now), operationId: crypto.randomUUID(), publish, strictSource: options.strictSource ?? false, verify: options.verify, sequence: ++sequence.current };
      setPending(true); return attempt();
    } catch (failure) { setError(languageMutationError(failure)); return Promise.resolve(false); }
  };
  /** Called only by the explicit "new save" button, never from retry or an effect. */
  const resubmit = async (): Promise<boolean> => {
    const action = retained.current, context = live.current.context;
    if (!action || running.current) return false;
    try {
      if (!context || !action.origin.context || !action.origin.snapshot) throw new LanguageSourceConflictError();
      if (action.intent) assertLanguageMutationUncommitted(action.intent);
      if (action.received) throw new LanguageSourceConflictError('저장된 요청은 새로 실행할 수 없습니다. 저장 다시 확인을 선택해 주세요.');
      assertLanguageRecordSource(action.origin.snapshot, context);
      if (action.strictSource) rebaseLanguageDraftRevision(action.origin.snapshot.revision, context);
      const fresh = readLanguageRecordSnapshot(context);
      // Only a registered original source is used for this pure dependency proof.
      // An unregistered envelope here represents a local draft that never dispatched.
      const original = action.intent ?? { context: action.origin.context, source: action.origin.snapshot, payload: action.payload, operationId: action.operationId, timestamp: action.timestamp, date: action.date };
      // This unregistered, read-only proof view supplies current authority to row
      // resolvers while preserving the ORIGINAL source, ID, payload and event time.
      // It never rebinds the original registered envelope or enters the runner.
      const proofIntent = Object.freeze({ ...original, context });
      const proof = planner(fresh.records, proofIntent);
      if (proof.alreadyApplied) throw new LanguageSourceConflictError('이미 저장된 답일 수 있습니다. 저장 다시 확인을 선택해 주세요.');
      const intent = createLanguageMutation(context, fresh, action.payload, { timestamp: action.timestamp, date: action.date });
      retained.current = { ...action, intent, origin: { context, snapshot: fresh }, operationId: intent.operationId, sequence: ++sequence.current, received: false };
      return attempt();
    } catch (failure) { setError(languageMutationError(failure)); return false; }
  };
  const discard = () => { if (running.current) return false; retained.current = null; sequence.current++; setPending(false); setError(null); return true; };
  const isPending = useCallback(() => retained.current !== null, []);
  const action = retained.current;
  const outcome = action?.intent ? getLanguageMutationOutcome(action.intent) : 'created';
  const canResubmit = !!action && !busy && !action.received && (outcome === 'created' || outcome === 'not-committed');
  return { submit, retry: attempt, resubmit, canResubmit, discard, busy, pending, error, isPending };
}
