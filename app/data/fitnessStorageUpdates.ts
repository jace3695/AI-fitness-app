import { captureStorageOwner, isStorageOwnerCurrent, StorageSessionChangedError, updateStorageBatch, type StorageOwnerToken, type StorageSnapshot } from './storageTransaction.ts';

/** Keep a mounted editor fenced even if initialization is blocked or server-rendered. */
export function captureFitnessEditorOwner(): StorageOwnerToken {
  try { return captureStorageOwner(); }
  catch { return { userId: null, epoch: null }; }
}

/** Writes never interpret corrupt persisted records as an empty replacement. */
export function readFitnessValue<T>(snapshot: Pick<Storage, 'getItem'>, key: string, fallback: T): T {
  const raw = snapshot.getItem(key);
  if (raw === null) return fallback;
  try {
    const value = JSON.parse(raw) as T;
    if (value === null || (typeof fallback === 'object' && (typeof value !== 'object' || Array.isArray(value) !== Array.isArray(fallback)))) throw new Error('invalid record');
    return value;
  } catch {
    throw new Error('저장된 기록을 확인하지 못했어요. 기존 기록을 보존했습니다. 백업과 저장 상태를 확인해 주세요.');
  }
}

/** Replay only the fields the editor changed over the latest committed value. */
export function applyFitnessEdits<T>(current: T, baseline: T, edited: T): T {
  if (JSON.stringify(baseline) === JSON.stringify(edited)) return current;
  if (baseline === undefined && current !== undefined && edited && typeof edited === 'object') {
    return applyFitnessEdits(current, (Array.isArray(edited) ? [] : {}) as T, edited);
  }
  if (Array.isArray(baseline) && Array.isArray(edited)) {
    if (!Array.isArray(current)) throw new Error('다른 창에서 목록 형식이 바뀌었어요. 입력을 보존했습니다. 다시 확인해 주세요.');
    if (JSON.stringify(current) === JSON.stringify(baseline)) return edited;
    const encoded = (value: unknown) => JSON.stringify(value);
    const before = baseline.map(encoded), after = edited.map(encoded);
    const retained = before.filter(value => after.includes(value));
    if (JSON.stringify(after.filter(value => before.includes(value))) !== JSON.stringify(retained)) throw new Error('다른 창에서 같은 목록을 바꿨어요. 입력을 보존했습니다. 최신 순서를 확인한 뒤 다시 저장해 주세요.');
    const removed = new Set(before.filter(value => !after.includes(value)));
    const result = current.filter(value => !removed.has(encoded(value)));
    for (const value of edited) if (!before.includes(encoded(value)) && !result.some(item => encoded(item) === encoded(value))) {
      if (value && typeof value === 'object' && 'id' in value && result.some(item => item && typeof item === 'object' && item.id === value.id)) throw new Error('다른 창에서 같은 목록 항목을 바꿨어요. 입력을 보존했습니다. 최신 기록을 확인해 주세요.');
      result.push(value);
    }
    return result as T;
  }
  if (!baseline || !edited || typeof baseline !== 'object' || typeof edited !== 'object' || Array.isArray(baseline) || Array.isArray(edited)) return edited;
  const before = baseline as Record<string, unknown>;
  const next = edited as Record<string, unknown>;
  const result = { ...(current && typeof current === 'object' ? current : {}) } as Record<string, unknown>;
  for (const key of new Set([...Object.keys(before), ...Object.keys(next)])) {
    if (!(key in next)) { if (key in before) delete result[key]; }
    else if (!(key in before)) result[key] = applyFitnessEdits(result[key], undefined, next[key]);
    else result[key] = applyFitnessEdits(result[key], before[key], next[key]);
  }
  return result as T;
}

export async function updateFitnessValues<T>(transform: (snapshot: StorageSnapshot) => { changes: Record<string, string | null>; value: T }, owner?: StorageOwnerToken): Promise<T> {
  const captured = owner ?? captureStorageOwner();
  let value!: T;
  await updateStorageBatch(window.localStorage, (snapshot) => {
    const result = transform(snapshot);
    value = result.value;
    return result.changes;
  }, { owner: captured });
  if (!isStorageOwnerCurrent(window.localStorage, captured)) throw new StorageSessionChangedError();
  return value;
}

export function fitnessStorageError(error: unknown) {
  return error instanceof Error ? error.message : '기록을 저장하지 못했어요. 입력과 기존 기록을 보존했습니다.';
}
