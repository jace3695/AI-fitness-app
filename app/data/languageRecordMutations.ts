import { assertLanguageRecordSource, isLanguageRecordContextCurrent, readLanguageRecordSnapshot, updateLanguageRecords, type LanguageDraftRevision, type LanguageRecordContext, type LanguageRecordSnapshot } from './languageCloudSync.ts';
import { LanguageDocumentError, LanguageSourceConflictError } from './languageRecordDocuments.ts';
import { isLanguageRowHandle } from './languageRecordIdentity.ts';
import { LANGUAGE_STORAGE_KEYS, type LanguageBytes, type LanguageStorageKey } from './languageStorageBoundary.ts';
import { StorageWriteAttemptError } from './storageTransaction.ts';
import { getLocalDateKey } from '../../utils/dateKey.ts';

export type LanguageChanges = Partial<Record<LanguageStorageKey, string | null>>;
export interface LanguageMutation<T> { readonly context: LanguageRecordContext; readonly source: LanguageRecordSnapshot; readonly payload: T; readonly operationId: string; readonly timestamp: string; readonly date: string }
export interface LanguageMutationPlan<R> { changes: LanguageChanges; result: R; alreadyApplied?: boolean }
export interface LanguageMutationResult<R> { status: 'committed' | 'already-applied'; acknowledged: boolean; result: R; records: LanguageBytes; committedRecords: LanguageBytes; generation: string | null; source: LanguageRecordSnapshot | null; operationId: string }
export type LanguageMutationOutcome = 'created' | 'pending' | 'not-committed' | 'committed' | 'unknown';
type SavedMutation = { state: LanguageMutationOutcome; promise?: Promise<LanguageMutationResult<unknown>>; outcome?: LanguageMutationResult<unknown>; keys?: LanguageStorageKey[] };
const intents = new WeakMap<object, SavedMutation>();
function freezePayload<T>(payload: T): T {
  const clone = (value: unknown): unknown => {
    if (isLanguageRowHandle(value)) return value;
    if (value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return Object.freeze(value.map(clone));
    if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])));
    throw new LanguageDocumentError('저장할 입력의 형식을 확인해 주세요. 입력은 보존됩니다.');
  };
  return clone(payload) as T;
}
export function createLanguageMutation<T>(context: LanguageRecordContext, source: LanguageRecordSnapshot, payload: T, options: { operationId?: string; timestamp?: string; date?: string } = {}): LanguageMutation<T> {
  assertLanguageRecordSource(source, context);
  const now = new Date();
  const intent = Object.freeze({ context, source, payload: freezePayload(payload), operationId: options.operationId ?? crypto.randomUUID(), timestamp: options.timestamp ?? now.toISOString(), date: options.date ?? getLocalDateKey(now) });
  if (!intent.operationId || !Number.isFinite(Date.parse(intent.timestamp)) || !/^\d{4}-\d{2}-\d{2}$/.test(intent.date)) throw new LanguageDocumentError();
  intents.set(intent, { state: 'created' }); return intent;
}
export async function runLanguageMutation<T, R>(intent: LanguageMutation<T>, planner: (fresh: LanguageBytes, intent: LanguageMutation<T>) => LanguageMutationPlan<R>, options: { expectedDraft?: LanguageDraftRevision } = {}): Promise<LanguageMutationResult<R>> {
  const saved = intents.get(intent); if (!saved) throw new LanguageSourceConflictError();
  if (saved.state === 'unknown') throw new LanguageSourceConflictError('이 저장 요청의 완료 여부가 불확실합니다. 새로 적용하지 않고 같은 요청의 결과를 먼저 확인해 주세요.');
  try { assertLanguageRecordSource(intent.source, intent.context); } catch (error) {
    if (saved.state === 'created' || saved.state === 'not-committed') saved.state = 'not-committed';
    throw error;
  }
  if (saved.promise) {
    // Reused results are evidence of the original operation, not timeless UI
    // freshness. Shipping handlers explicitly reconcile before republishing.
    const result = await saved.promise as LanguageMutationResult<R>;
    if (!isLanguageRecordContextCurrent(intent.context)) return { ...result, acknowledged: false, source: null };
    return result;
  }
  saved.state = 'pending';
  const promise = (async () => {
    let plan: LanguageMutationPlan<R> | undefined;
    const committed = await updateLanguageRecords(intent.context, fresh => {
      assertLanguageRecordSource(intent.source, intent.context);
      plan = planner(fresh, intent);
      if (!plan || typeof plan !== 'object' || 'then' in plan) throw new LanguageDocumentError();
      return plan.changes;
    }, options);
    if (!plan) throw new LanguageDocumentError();
    const outcome: LanguageMutationResult<R> = { ...committed, status: plan.alreadyApplied ? 'already-applied' : 'committed', result: plan.result, operationId: intent.operationId };
    saved.keys = Object.keys(plan.changes) as LanguageStorageKey[]; saved.outcome = outcome; saved.state = 'committed'; return outcome;
  })();
  saved.promise = promise;
  try { return await promise; } catch (error) { saved.promise = undefined; saved.state = error instanceof StorageWriteAttemptError ? error.outcome : 'unknown'; throw error; }
}
export function getLanguageMutationOutcome(intent: LanguageMutation<unknown>): LanguageMutationOutcome { return intents.get(intent)?.state ?? 'unknown'; }
/** Only a new explicit user action may use this proof; it does not mint authority. */
export function assertLanguageMutationUncommitted(intent: LanguageMutation<unknown>): void {
  const state = getLanguageMutationOutcome(intent);
  if (state !== 'created' && state !== 'not-committed') throw new LanguageSourceConflictError('이 저장 요청의 완료 여부가 불확실합니다. 같은 요청의 저장 결과를 먼저 확인해 주세요.');
}
/** Read-only reconciliation. Never rebinds or redispatches the retired intent. */
export function reconcileLanguageMutation<T, R>(intent: LanguageMutation<T>, context: LanguageRecordContext, verify?: (fresh: LanguageBytes, intent: LanguageMutation<T>) => R): LanguageMutationResult<R> {
  const saved = intents.get(intent); if (!saved) throw new LanguageSourceConflictError();
  assertLanguageRecordSource(intent.source, context);
  const source = readLanguageRecordSnapshot(context);
  let result: R;
  if (verify) result = verify(source.records, intent);
  else {
    if (!saved.outcome) throw new LanguageSourceConflictError('저장 완료 여부를 확인할 근거가 없습니다. 입력을 보존했어요. 최신 기록을 확인해 주세요.');
    const keys = saved.keys?.length ? saved.keys : LANGUAGE_STORAGE_KEYS; // Absence is also part of a no-op's bounded proof.
    if (keys.some(key => source.records[key] !== saved.outcome!.committedRecords[key])) throw new LanguageSourceConflictError();
    result = saved.outcome.result as R;
  }
  if (!isLanguageRecordContextCurrent(context)) throw new LanguageSourceConflictError();
  return { status: 'already-applied', acknowledged: true, result, records: source.records, committedRecords: saved.outcome?.committedRecords ?? source.records, generation: source.generation, source, operationId: intent.operationId };
}
export class LanguageMutationAcknowledgementError extends Error {
  readonly receipt: LanguageMutationResult<unknown>;
  constructor(receipt: LanguageMutationResult<unknown>) { super('기기에 저장되었지만 연결 상태가 바뀌어 완료 표시를 보류했습니다. 입력을 보존했어요. 다시 확인해 주세요.'); this.name = 'LanguageMutationAcknowledgementError'; this.receipt = receipt; }
}
export function requireLanguageMutationAcknowledged<R>(result: LanguageMutationResult<R>): LanguageMutationResult<R> { if (!result.acknowledged) throw new LanguageMutationAcknowledgementError(result); return result; }
export function languageMutationError(error: unknown): string { return error instanceof Error ? error.message : '학습 기록을 저장하지 못했습니다. 입력을 보존했어요. 다시 시도해 주세요.'; }
