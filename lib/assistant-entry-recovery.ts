export type ManualEntryTable = 'assistant_items' | 'assistant_projects' | 'assistant_memories';
export type ManualEntryAttempt = {
  id: string; owner: string; table: ManualEntryTable; signature: string; label: string;
  payload: Readonly<Record<string, unknown>>; uncertain: boolean;
};
export type ManualEntryResult = {
  state: 'saved' | 'unknown' | 'missing' | 'conflict' | 'rejected' | 'stale';
  reason?: 'pending' | 'accepted' | 'connection' | 'lookup';
};
export type ManualEntryTransport = {
  insert(attempt: ManualEntryAttempt): Promise<{ error: unknown; status?: number }>;
  find(attempt: ManualEntryAttempt): Promise<{ data: unknown; error: unknown }>;
  timeoutMs?: number;
};

export class ManualEntryTimeoutError extends Error {
  readonly stage: 'response' | 'auth';
  constructor(stage: 'response' | 'auth') { super(`entry-${stage}-pending`); this.stage = stage; }
}

export function createManualEntryAttempt(owner: string, table: ManualEntryTable, values: Record<string, unknown>, signature: string, label: string): ManualEntryAttempt {
  const id = crypto.randomUUID();
  return { id, owner, table, signature, label, payload: Object.freeze({ ...values, id, user_id: owner }), uncertain: false };
}

function timed<T>(operation: Promise<T>, timeoutMs = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([operation, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ManualEntryTimeoutError('response')), timeoutMs);
  })]).finally(() => clearTimeout(timer));
}

/** Auth gets its own bounded wait; a timeout never starts an insert or lookup. */
export async function waitForManualEntryAuth<T>(auth: Promise<T>, timeoutMs = 15000): Promise<T> {
  try { return await timed(auth, timeoutMs); }
  catch (error) {
    if (error instanceof ManualEntryTimeoutError) throw new ManualEntryTimeoutError('auth');
    throw error;
  }
}

function matches(attempt: ManualEntryAttempt, value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.entries(attempt.payload).every(([key, expected]) => {
    if (key === 'due_at' && typeof expected === 'string' && typeof row[key] === 'string') {
      return Number.isFinite(Date.parse(expected)) && Date.parse(expected) === Date.parse(row[key]);
    }
    return JSON.stringify(expected) === JSON.stringify(row[key]);
  });
}

/** Read-only confirmation; an absent row is not proof that an insert stopped. */
export async function checkManualEntry(attempt: ManualEntryAttempt, transport: ManualEntryTransport, current: () => boolean): Promise<ManualEntryResult> {
  if (!current()) return { state: 'stale' };
  try {
    const result = await timed(transport.find(attempt), transport.timeoutMs);
    if (!current()) return { state: 'stale' };
    if (result.error || result.data === undefined) return { state: 'unknown', reason: 'lookup' };
    if (result.data === null) return { state: 'missing' };
    return { state: matches(attempt, result.data) ? 'saved' : 'conflict' };
  } catch { return current() ? { state: 'unknown', reason: 'lookup' } : { state: 'stale' }; }
}

/** Exactly one insert per explicit call. Never upserts, overwrites or auto-retries. */
export async function sendManualEntry(attempt: ManualEntryAttempt, transport: ManualEntryTransport, current: () => boolean): Promise<ManualEntryResult> {
  if (!current()) return { state: 'stale' };
  try {
    const result = await timed(transport.insert(attempt), transport.timeoutMs);
    if (!current()) return { state: 'stale' };
    if (result.error === null && (result.status === undefined || [200, 201, 204].includes(result.status))) return { state: 'saved' };
    const code = result.error && typeof result.error === 'object' ? (result.error as { code?: unknown }).code : null;
    if (code === '23505') return checkManualEntry(attempt, transport, current);
    // Only a first, explicit validation/auth rejection is known not to have
    // saved. After uncertainty, a rejection cannot disprove the earlier write.
    if (!attempt.uncertain && result.error && [400, 401, 403, 404, 405, 413, 415, 422].includes(result.status ?? 0)) return { state: 'rejected' };
    attempt.uncertain = true;
    return { state: 'unknown', reason: result.status === 202 ? 'accepted' : 'connection' };
  } catch (error) {
    if (!current()) return { state: 'stale' };
    attempt.uncertain = true;
    return { state: 'unknown', reason: error instanceof ManualEntryTimeoutError ? 'pending' : 'connection' };
  }
}
