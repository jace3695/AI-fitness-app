/**
 * Deterministic, dependency-free IDB test double for the local evidence store.
 * This exercises application request/transaction handling, not browser-engine
 * conformance, persistence, eviction, crash recovery, or physical durability.
 * All transactions are serialized (including reads); supported queries are
 * exact keys and object-store cursors, not IDBKeyRange. Faults are synthetic.
 */
type Key = IDBValidKey;
type KeyPath = string | string[];
type Hub = Record<string, unknown> & {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void;
};
type Request = Hub & { result: unknown; error: DOMException | null; readyState: IDBRequestReadyState };
type Row = { key: Key; value: unknown };
type IndexSchema = { name: string; keyPath: KeyPath; unique: boolean };
type StoreState = { keyPath: KeyPath | null; indexes: Map<string, IndexSchema>; rows: Map<string, Row> };
type DatabaseState = { name: string; version: number; stores: Map<string, StoreState>; connections: Set<Connection> };
type Connection = { db: Hub; closed: boolean; state: DatabaseState };
type Operation = { request: Request; run(): unknown };

const clone = <T>(value: T): T => structuredClone(value);
const failure = (name: string, message = name): DOMException => new DOMException(message, name);
const later = (): Promise<void> => new Promise(resolve => queueMicrotask(resolve));

function hub(): Hub {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  return {
    addEventListener(type, listener) {
      if (!listener) return;
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type, listener) { if (listener) listeners.get(type)?.delete(listener); },
    _listeners: listeners,
  };
}
/** Property handlers and registered listeners receive usable target/result fields. */
function emit(target: Hub, type: string, details: Record<string, unknown> = {}): boolean {
  let prevented = false;
  const event = {
    type, target, currentTarget: target, bubbles: type === 'error', cancelable: type === 'error',
    get defaultPrevented() { return prevented; },
    preventDefault() { if (type === 'error') prevented = true; },
    stopPropagation() {}, stopImmediatePropagation() {}, ...details,
  } as unknown as Event;
  const handler = target[`on${type}`];
  if (typeof handler === 'function') handler.call(target, event);
  const listeners = target._listeners as Map<string, Set<EventListenerOrEventListenerObject>>;
  for (const listener of [...(listeners.get(type) ?? [])]) {
    if (typeof listener === 'function') listener.call(target as unknown as EventTarget, event);
    else listener.handleEvent(event);
  }
  return prevented;
}
function request(source: unknown, transaction: unknown): Request {
  return { ...hub(), source, transaction, result: undefined, error: null, readyState: 'pending' };
}
function names(read: () => string[]) {
  return {
    get length() { return read().length; }, contains(name: string) { return read().includes(name); },
    item(index: number) { return read()[index] ?? null; }, [Symbol.iterator]() { return read()[Symbol.iterator](); },
  };
}
function keyToken(value: unknown, ancestors = new Set<unknown>()): string {
  if (typeof value === 'string') return `s:${JSON.stringify(value)}`;
  if (typeof value === 'number' && !Number.isNaN(value)) return `n:${Object.is(value, -0) ? 0 : value}`;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `d:${value.getTime()}`;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return `b:${Array.from(bytes).join(',')}`;
  }
  if (Array.isArray(value) && !ancestors.has(value)) {
    ancestors.add(value);
    try { return `a:${JSON.stringify(value.map(item => keyToken(item, ancestors)))}`; }
    finally { ancestors.delete(value); }
  }
  throw failure('DataError', 'The adapter requires a valid, exact IndexedDB key.');
}
function keyRank(value: Key): number {
  return typeof value === 'number' ? 0 : value instanceof Date ? 1 : typeof value === 'string' ? 2 : Array.isArray(value) ? 4 : 3;
}
function compareKeys(left: Key, right: Key): number {
  const rank = keyRank(left) - keyRank(right);
  if (rank) return Math.sign(rank);
  if (typeof left === 'number' && typeof right === 'number') return left === right ? 0 : left < right ? -1 : 1;
  if (typeof left === 'string' && typeof right === 'string') return left === right ? 0 : left < right ? -1 : 1;
  if (left instanceof Date && right instanceof Date) return compareKeys(left.getTime(), right.getTime());
  const sequence = (key: Key): Key[] => {
    if (Array.isArray(key)) return key;
    const bytes = key as ArrayBuffer | ArrayBufferView;
    return Array.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  };
  const a = sequence(left), b = sequence(right);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const compared = compareKeys(a[i], b[i]);
    if (compared) return compared;
  }
  return Math.sign(a.length - b.length);
}
function pathValue(value: unknown, path: KeyPath): unknown {
  if (Array.isArray(path)) return path.map(part => pathValue(value, part));
  if (path === '') return value;
  let current = value;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
function indexToken(value: unknown, index: IndexSchema): string | undefined {
  try { return keyToken(pathValue(value, index.keyPath)); } catch { return undefined; }
}
function checkUnique(store: StoreState, rows: Map<string, Row>, key: string, value: unknown): void {
  for (const index of store.indexes.values()) {
    if (!index.unique) continue;
    const token = indexToken(value, index);
    if (token === undefined) continue;
    for (const [otherKey, row] of rows) {
      if (otherKey !== key && indexToken(row.value, index) === token) throw failure('ConstraintError', `Duplicate index ${index.name}.`);
    }
  }
}

export function createDeterministicIDBAdapter() {
  const databases = new Map<string, DatabaseState>();
  let tail = Promise.resolve();
  let nextAbort: DOMException | null = null, nextQuota: DOMException | null = null;
  let nextReadFailure: DOMException | null = null, nextLostCommit: DOMException | null = null;
  let blockedOpens = 0, pendingOpens = 0;
  const beforeTransactions = new Map<'readonly' | 'readwrite', () => void>();
  let afterWriteCommit: (() => void) | undefined;

  function lookup(databaseName?: string): DatabaseState {
    if (databaseName !== undefined) {
      const state = databases.get(databaseName);
      if (!state) throw Error(`Unknown test database: ${databaseName}`);
      return state;
    }
    if (databases.size !== 1) throw Error('Supply databaseName when zero or multiple test databases exist.');
    return databases.values().next().value!;
  }
  function lookupStore(storeName: string, databaseName?: string): StoreState {
    const store = lookup(databaseName).stores.get(storeName);
    if (!store) throw Error(`Unknown test object store: ${storeName}`);
    return store;
  }
  function transaction(connection: Connection, requested: string | string[], mode: IDBTransactionMode = 'readonly') {
    if (connection.closed) throw failure('InvalidStateError', 'The database connection is closed.');
    if (mode !== 'readonly' && mode !== 'readwrite') throw failure('TypeError', 'Unsupported transaction mode.');
    const scope = typeof requested === 'string' ? [requested] : [...requested];
    if (!scope.length) throw failure('InvalidAccessError');
    for (const name of scope) if (!connection.state.stores.has(name)) throw failure('NotFoundError', name);
    const tx = { ...hub(), db: connection.db, mode, error: null as DOMException | null };
    const operations: Operation[] = [], snapshots = new Map<string, Map<string, Row>>(), stores = new Map<string, Hub>();
    const injectedAbort = nextAbort; nextAbort = null;
    const injectedLostCommit = mode === 'readwrite' ? nextLostCommit : null;
    if (mode === 'readwrite') nextLostCommit = null;
    const beforeTransaction = beforeTransactions.get(mode);
    beforeTransactions.delete(mode);
    let active = true, abortReason: DOMException | null = null;
    function assertActive() { if (!active || abortReason) throw failure('TransactionInactiveError'); }
    function enqueue(source: Hub, run: () => unknown): Request {
      assertActive();
      const req = request(source, tx);
      operations.push({ request: req, run });
      return req;
    }
    function read(run: () => unknown): unknown {
      if (nextReadFailure) { const error = nextReadFailure; nextReadFailure = null; throw error; }
      return run();
    }
    function write(run: () => unknown): unknown {
      if (nextQuota) { const error = nextQuota; nextQuota = null; throw error; }
      return run();
    }
    function objectStore(name: string): Hub {
      assertActive();
      if (!scope.includes(name)) throw failure('NotFoundError', name);
      if (stores.has(name)) return stores.get(name)!;
      const schema = connection.state.stores.get(name)!;
      const rows = () => snapshots.get(name)!;
      const sorted = () => [...rows().values()].sort((a, b) => compareKeys(a.key, b.key));
      const store: Hub = {
        ...hub(), name, keyPath: schema.keyPath, transaction: tx,
        indexNames: names(() => [...schema.indexes.keys()].sort()),
        get(key: Key) {
          const token = keyToken(key);
          return enqueue(store, () => read(() => clone(rows().get(token)?.value)));
        },
        getAll(query?: Key | null, count?: number) {
          const token = query == null ? undefined : keyToken(query);
          return enqueue(store, () => read(() => clone(sorted().filter(row => token === undefined || keyToken(row.key) === token).slice(0, count).map(row => row.value))));
        },
        getAllKeys() { return enqueue(store, () => read(() => clone(sorted().map(row => row.key)))); },
        count() { return enqueue(store, () => read(() => rows().size)); },
        openCursor(query?: Key | null, direction: IDBCursorDirection = 'next') {
          assertActive();
          const token = query == null ? undefined : keyToken(query);
          if (!['next', 'nextunique', 'prev', 'prevunique'].includes(direction)) throw failure('TypeError', 'Invalid cursor direction.');
          const reverse = direction.startsWith('prev');
          const req = request(store, tx);
          let previous: Key | undefined;
          function advance(target?: Key): unknown {
            return read(() => {
              const candidates = sorted();
              if (reverse) candidates.reverse();
              const row = candidates.find(candidate => {
                if (token !== undefined && keyToken(candidate.key) !== token) return false;
                if (previous !== undefined && (reverse ? compareKeys(candidate.key, previous) >= 0 : compareKeys(candidate.key, previous) <= 0)) return false;
                return target === undefined || (reverse ? compareKeys(candidate.key, target) <= 0 : compareKeys(candidate.key, target) >= 0);
              });
              if (!row) return null;
              previous = clone(row.key);
              let positioned = true;
              function assertPositioned() {
                assertActive();
                if (!positioned) throw failure('InvalidStateError', 'The cursor is already advancing.');
              }
              const cursor: Hub = {
                ...hub(), source: store, request: req, direction,
                key: clone(row.key), primaryKey: clone(row.key), value: clone(row.value),
                delete() {
                  assertPositioned(); assertWritable();
                  const primary = keyToken(row!.key);
                  return enqueue(cursor, () => write(() => { rows().delete(primary); return undefined; }));
                },
                continue(key?: Key) {
                  assertPositioned();
                  if (key !== undefined) {
                    keyToken(key);
                    const compared = compareKeys(key, row!.key);
                    if (reverse ? compared >= 0 : compared <= 0) throw failure('DataError', 'A cursor must advance past its current key.');
                  }
                  positioned = false;
                  const frozen = clone(key);
                  req.readyState = 'pending'; req.result = undefined;
                  operations.push({ request: req, run: () => advance(frozen) });
                },
              };
              return cursor;
            });
          }
          operations.push({ request: req, run: () => advance() });
          return req;
        },
        add(value: unknown, key?: Key) { return put(value, key, true); },
        put(value: unknown, key?: Key) { return put(value, key, false); },
        delete(key: Key) {
          assertWritable(); const token = keyToken(key);
          return enqueue(store, () => write(() => { rows().delete(token); return undefined; }));
        },
        clear() { assertWritable(); return enqueue(store, () => write(() => { rows().clear(); return undefined; })); },
        index(indexName: string) {
          const definition = schema.indexes.get(indexName);
          if (!definition) throw failure('NotFoundError', indexName);
          const index: Hub = { ...hub(), ...definition, objectStore: store };
          function matches(query?: Key | null) {
            const token = query == null ? undefined : keyToken(query);
            return sorted().filter(row => {
              const candidate = indexToken(row.value, definition!);
              return candidate !== undefined && (token === undefined || candidate === token);
            }).sort((a, b) => compareKeys(pathValue(a.value, definition!.keyPath) as Key, pathValue(b.value, definition!.keyPath) as Key));
          }
          index.get = (key: Key) => { keyToken(key); const frozen = clone(key); return enqueue(index, () => read(() => clone(matches(frozen)[0]?.value))); };
          index.getKey = (key: Key) => { keyToken(key); const frozen = clone(key); return enqueue(index, () => read(() => clone(matches(frozen)[0]?.key))); };
          index.getAll = (query?: Key | null, count?: number) => { if (query != null) keyToken(query); const frozen = clone(query); return enqueue(index, () => read(() => clone(matches(frozen).slice(0, count).map(row => row.value)))); };
          return index;
        },
      };
      function assertWritable() { assertActive(); if (mode !== 'readwrite') throw failure('ReadOnlyError'); }
      function put(value: unknown, suppliedKey: Key | undefined, add: boolean): Request {
        assertWritable();
        const frozen = clone(value);
        if (schema.keyPath !== null && suppliedKey !== undefined) throw failure('DataError', 'Inline keys cannot have an explicit key.');
        const key = clone(schema.keyPath === null ? suppliedKey : pathValue(frozen, schema.keyPath)) as Key;
        const token = keyToken(key);
        return enqueue(store, () => write(() => {
          if (add && rows().has(token)) throw failure('ConstraintError', 'Duplicate primary key.');
          checkUnique(schema, rows(), token, frozen);
          rows().set(token, { key, value: frozen });
          return clone(key);
        }));
      }
      stores.set(name, store);
      return store;
    }
    Object.assign(tx, {
      objectStore, objectStoreNames: names(() => [...new Set(scope)].sort()),
      abort() { assertActive(); abortReason = failure('AbortError', 'The test transaction was explicitly aborted.'); },
    });
    tail = tail.then(async () => {
      let completed = 0;
      try {
        // Creation has returned, so application code has registered the tx and
        // its handlers. A versionchange here can abort it before any request.
        beforeTransaction?.();
        for (const name of scope) snapshots.set(name, clone(connection.state.stores.get(name)!.rows));
        for (; completed < operations.length && !abortReason; completed++) {
          await later();
          if (abortReason) break;
          const operation = operations[completed];
          try {
            operation.request.result = operation.run(); operation.request.readyState = 'done';
            emit(operation.request, 'success');
          } catch (error) {
            const reason = error instanceof DOMException ? error : failure('UnknownError', String(error));
            operation.request.error = reason; operation.request.readyState = 'done'; tx.error = reason;
            const preventedRequest = emit(operation.request, 'error');
            const preventedTransaction = emit(tx, 'error', { target: operation.request });
            if (!preventedRequest && !preventedTransaction) abortReason = reason;
          }
        }
        // Requests added by request success callbacks participate in this same
        // snapshot and finish before the completion event or atomic commit.
        if (!abortReason && injectedAbort) abortReason = injectedAbort;
        if (!abortReason && mode === 'readwrite') {
          for (const name of scope) connection.state.stores.get(name)!.rows = snapshots.get(name)!;
          const afterCommit = afterWriteCommit;
          afterWriteCommit = undefined;
          afterCommit?.();
        }
        // Deliberately non-browser fault: storage committed, caller saw failure.
        // This tests application readback/retry, not an IDB durability claim.
        if (!abortReason && injectedLostCommit) abortReason = injectedLostCommit;
      } catch (error) {
        abortReason = error instanceof DOMException ? error : failure('UnknownError', String(error));
      }
      active = false;
      if (abortReason) {
        const reason = abortReason;
        for (const operation of operations.slice(completed)) {
          if (operation.request.readyState === 'done') continue;
          operation.request.readyState = 'done'; operation.request.error = failure('AbortError', reason.message);
          try { emit(operation.request, 'error'); } catch { /* A handler cannot undo rollback. */ }
        }
        const alreadyReported = tx.error !== null;
        tx.error = reason;
        try { if (!alreadyReported) emit(tx, 'error'); } catch { /* Still dispatch abort. */ }
        try { emit(tx, 'abort'); } catch { /* Keep later transactions runnable. */ }
      } else {
        try { emit(tx, 'complete'); } catch { /* A completion handler cannot undo commit. */ }
      }
    });
    return tx;
  }
  function connect(state: DatabaseState): Connection {
    const connection: Connection = { db: hub(), closed: false, state };
    let upgrading = false;
    Object.assign(connection.db, {
      name: state.name, get version() { return state.version; },
      objectStoreNames: names(() => [...state.stores.keys()].sort()),
      close() { connection.closed = true; state.connections.delete(connection); },
      transaction: (scope: string | string[], mode?: IDBTransactionMode) => transaction(connection, scope, mode),
      _setUpgrading(value: boolean) { upgrading = value; },
      createObjectStore(name: string, options?: IDBObjectStoreParameters) {
        if (!upgrading) throw failure('InvalidStateError');
        if (state.stores.has(name)) throw failure('ConstraintError');
        if (options?.autoIncrement) throw failure('NotSupportedError', 'The adapter does not implement key generators.');
        const store: StoreState = { keyPath: options?.keyPath ?? null, indexes: new Map(), rows: new Map() };
        state.stores.set(name, store);
        return {
          name, keyPath: store.keyPath, indexNames: names(() => [...store.indexes.keys()].sort()),
          // Minimal versionchange write support. Upgrade operates on a cloned
          // schema/row snapshot; a synchronous failure never publishes it.
          put(value: unknown, key: Key) {
            if (!upgrading) throw failure('InvalidStateError');
            if (nextQuota) { const error = nextQuota; nextQuota = null; throw error; }
            const token = keyToken(key); checkUnique(store, store.rows, token, value);
            store.rows.set(token, { key: clone(key), value: clone(value) });
            const req = request(null, null); req.result = key; req.readyState = 'done'; return req;
          },
          createIndex(indexName: string, keyPath: KeyPath, options?: IDBIndexParameters) {
            if (!upgrading) throw failure('InvalidStateError');
            if (store.indexes.has(indexName)) throw failure('ConstraintError');
            if (options?.multiEntry) throw failure('NotSupportedError', 'The adapter does not implement multiEntry indexes.');
            const index = { name: indexName, keyPath: clone(keyPath), unique: options?.unique ?? false };
            store.indexes.set(indexName, index);
            return index;
          },
        };
      },
    });
    state.connections.add(connection);
    return connection;
  }
  const factory = {
    open(name: string, version?: number) {
      const req = request(null, null);
      const blocked = blockedOpens > 0;
      if (blocked) blockedOpens--;
      pendingOpens++;
      queueMicrotask(() => {
        let connection: Connection | undefined;
        try {
          if (blocked) { emit(req, 'blocked', { oldVersion: databases.get(name)?.version ?? 0, newVersion: version ?? 1 }); return; }
          const previous = databases.get(name), desired = version ?? previous?.version ?? 1;
          if (!Number.isInteger(desired) || desired < 1) throw failure('TypeError', 'Version must be a positive integer.');
          if (previous && desired < previous.version) throw failure('VersionError');
          const upgrade = !previous || desired > previous.version;
          if (previous && upgrade) {
            for (const open of [...previous.connections]) emit(open.db, 'versionchange', { oldVersion: previous.version, newVersion: desired });
            if (previous.connections.size) { emit(req, 'blocked', { oldVersion: previous.version, newVersion: desired }); return; }
          }
          const state = upgrade ? { name, version: desired, stores: clone(previous?.stores ?? new Map<string, StoreState>()), connections: new Set<Connection>() } : previous!;
          connection = connect(state); req.result = connection.db;
          if (upgrade) {
            let aborted = false;
            req.transaction = { abort() { aborted = true; } };
            (connection.db._setUpgrading as (value: boolean) => void)(true);
            emit(req, 'upgradeneeded', { oldVersion: previous?.version ?? 0, newVersion: desired });
            (connection.db._setUpgrading as (value: boolean) => void)(false);
            if (aborted) throw failure('AbortError', 'Versionchange transaction aborted.');
            databases.set(name, state);
            req.transaction = null;
          }
          req.readyState = 'done'; emit(req, 'success');
        } catch (error) {
          if (connection) { connection.closed = true; connection.state.connections.delete(connection); }
          req.error = error instanceof DOMException ? error : failure('AbortError', String(error)); req.readyState = 'done';
          emit(req, 'error');
        } finally { pendingOpens--; }
      });
      return req;
    },
    cmp(left: Key, right: Key) { keyToken(left); keyToken(right); return compareKeys(left, right); },
  } as unknown as IDBFactory;

  return {
    factory,
    abortNextTransaction(error = failure('AbortError', 'Injected transaction abort.')) { nextAbort = error; },
    quotaNextWrite(error = failure('QuotaExceededError', 'Injected write quota failure.')) { nextQuota = error; },
    failNextRead(error = failure('UnknownError', 'Injected read failure.')) { nextReadFailure = error; },
    loseNextCommitResponse(error = failure('UnknownError', 'Injected completion failure after commit.')) { nextLostCommit = error; },
    beforeNextTransaction(mode: 'readonly' | 'readwrite', callback: () => void) { beforeTransactions.set(mode, callback); },
    afterNextWriteCommit(callback: () => void) { afterWriteCommit = callback; },
    blockNextOpen() { blockedOpens++; },
    versionchange(databaseName?: string, newVersion: number | null = null) {
      const state = lookup(databaseName);
      for (const connection of [...state.connections]) emit(connection.db, 'versionchange', { oldVersion: state.version, newVersion });
    },
    connectionCount(databaseName?: string) { return lookup(databaseName).connections.size; },
    inspect(storeName: string, key: Key, databaseName?: string): unknown { return clone(lookupStore(storeName, databaseName).rows.get(keyToken(key))?.value); },
    entries(storeName: string, databaseName?: string): [Key, unknown][] {
      return clone([...lookupStore(storeName, databaseName).rows.values()].sort((a, b) => compareKeys(a.key, b.key)).map(row => [row.key, row.value] as [Key, unknown]));
    },
    /** Seed and tamper deliberately bypass indexes/validation to simulate corrupt persisted data. */
    seed(storeName: string, key: Key, value: unknown, databaseName?: string) {
      lookupStore(storeName, databaseName).rows.set(keyToken(key), { key: clone(key), value: clone(value) });
    },
    tamper(storeName: string, key: Key, update: (value: unknown) => unknown, databaseName?: string) {
      const store = lookupStore(storeName, databaseName), token = keyToken(key);
      store.rows.set(token, { key: clone(key), value: clone(update(clone(store.rows.get(token)?.value))) });
    },
    async idle() {
      // Opens can enqueue transactions, and completion handlers can open again.
      do { await later(); const pending = tail; await pending; if (pending === tail && pendingOpens === 0) return; } while (true);
    },
  };
}

export type DeterministicIDBAdapter = ReturnType<typeof createDeterministicIDBAdapter>;
