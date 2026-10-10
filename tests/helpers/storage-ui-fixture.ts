import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import type * as Cloud from '../../app/data/cloudSync.ts';
import type * as Transactions from '../../app/data/storageTransaction.ts';

export type UiNode = { type: unknown; key?: string; props: Record<string, unknown> };
type UiEvent = { type: string; key?: string; storageArea?: unknown };
type AuthUser = { id: string; email: string };
type AuthListener = (event: string, session: { user: AuthUser } | null) => void;
export const FIXTURE_OWNER = 'synthetic-owner-a';
export const RECORD_KEY = 'ai-fitness-diet-completed-days';
const LOCK_NAME = 'yeoni-shared-local-storage-v2';
const root = fileURLToPath(new URL('../../', import.meta.url));
const sourceCache = new Map<string, string>();
export const tick = () => new Promise<void>(resolve => setImmediate(resolve));
export const textOf = (node: unknown): string => Array.isArray(node) ? node.map(textOf).join('')
  : typeof node === 'string' || typeof node === 'number' ? String(node)
    : node && typeof node === 'object' && 'props' in node ? textOf((node as UiNode).props.children) : '';
export const nodes = (node: unknown): UiNode[] => Array.isArray(node) ? node.flatMap(nodes)
  : !node || typeof node !== 'object' || !('props' in node) ? [] : [node as UiNode, ...nodes((node as UiNode).props.children)];
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Separate document runtimes share only bytes and one serialized Web Locks queue. */
export function storageBrowser(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const documents = new Map<string, (event: UiEvent) => void>();
  const tails = new Map<string, Promise<unknown>>();
  const active = new Map<string, number>();
  let lockFailure: Error | undefined;
  let writeFailure: { key: string; error: Error } | undefined;
  let maxActive = 0;
  const calls: { name: string; mode: string }[] = [];
  const writes: { document: string; key: string; value: string | null }[] = [];
  const locks = { request<T>(name: string, options: { mode: string }, callback: () => T | Promise<T>): Promise<T> {
    calls.push({ name, mode: options.mode });
    const failure = lockFailure; lockFailure = undefined;
    const operation = (tails.get(name) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (failure) throw failure;
      const count = (active.get(name) ?? 0) + 1;
      active.set(name, count); maxActive = Math.max(maxActive, count);
      assert.equal(count, 1, 'The synthetic LockManager never runs two writers together');
      try { return await callback(); } finally { active.set(name, count - 1); }
    });
    tails.set(name, operation);
    return operation;
  } };
  function notify(writer: string, key: string) {
    for (const [id, dispatch] of documents) if (id !== writer) queueMicrotask(() => dispatch({ type: 'storage', key }));
  }
  function local(id: string) {
    return {
      get length() { return values.size; },
      key(index: number) { return [...values.keys()][index] ?? null; },
      getItem(key: string) { return values.get(key) ?? null; },
      setItem(key: string, value: string) {
        if (writeFailure?.key === key) { const failure = writeFailure.error; writeFailure = undefined; throw failure; }
        if (values.get(key) === value) return;
        values.set(key, value); writes.push({ document: id, key, value }); notify(id, key);
      },
      removeItem(key: string) {
        if (!values.has(key)) return;
        values.delete(key); writes.push({ document: id, key, value: null }); notify(id, key);
      },
    };
  }
  return {
    values, local, documents, locks, calls, writes,
    get maxActive() { return maxActive; },
    holdLock() {
      const held = deferred<void>();
      void locks.request(LOCK_NAME, { mode: 'exclusive' }, () => held.promise);
      return () => held.resolve();
    },
    rejectNextLock(error = new Error('synthetic lock refusal')) { lockFailure = error; },
    rejectNextWrite(key: string, error = new Error('synthetic quota refusal')) { writeFailure = { key, error }; },
    record() { return JSON.parse(values.get(RECORD_KEY) ?? '{}') as Record<string, unknown>; },
  };
}

/** Hooks and host APIs are synthetic; every storage and cloud operation is shipped code. */
export function storageTab(browser: ReturnType<typeof storageBrowser>, id: string, initialUser: string | null = FIXTURE_OWNER) {
  const local = browser.local(id);
  const listeners = new Map<string, Set<(event: UiEvent) => void>>();
  const authListeners = new Set<AuthListener>();
  const timers = new Map<number, () => void>();
  const pinWaits: ReturnType<typeof deferred<boolean>>[] = [];
  const pinReads: { userId: string; signal?: AbortSignal }[] = [];
  const downloads: Blob[] = [];
  let nextTimer = 0, reloads = 0, currentUser = initialUser;
  let authError: Error | null = null;
  const navigator: { locks?: typeof browser.locks } = { locks: browser.locks };
  const win = {
    localStorage: local,
    location: { search: '', reload() { reloads++; }, assign() {} },
    history: { replaceState() {} },
    addEventListener(name: string, listener: (event: UiEvent) => void) {
      if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(listener);
    },
    removeEventListener(name: string, listener: (event: UiEvent) => void) { listeners.get(name)?.delete(listener); },
    dispatchEvent(event: UiEvent) {
      for (const listener of [...(listeners.get(event.type) ?? [])]) listener({ type: event.type, key: event.key, storageArea: local });
      return true;
    },
    setTimeout(callback: () => void) { const token = ++nextTimer; timers.set(token, callback); return token; },
    clearTimeout(token: number) { timers.delete(token); },
  };
  browser.documents.set(id, win.dispatchEvent);
  const jsx = (type: unknown, props: UiNode['props'], key?: string) => ({ type, props, key });
  const modules: Record<string, unknown> = {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: Symbol.for('fixture-fragment') },
    [resolve(root, 'app/lib/supabase.ts')]: {
      isSupabaseConfigured: true, isPasswordRecoveryRedirect: false,
      supabase: { auth: {
        async getUser() { return { data: { user: !authError && currentUser ? { id: currentUser, email: `${currentUser}@example.test` } : null }, error: authError }; },
        onAuthStateChange(callback: AuthListener) { authListeners.add(callback); return { data: { subscription: { unsubscribe() { authListeners.delete(callback); } } } }; },
      } },
    },
    [resolve(root, 'app/lib/devicePin.ts')]: {
      MAX_PIN_FAILURES: 5, PIN_LENGTH: 6,
      async hasDevicePin(userId: string, signal?: AbortSignal) { pinReads.push({ userId, signal }); return pinWaits.shift()?.promise ?? false; },
      isPinSessionUnlocked: () => false,
    },
    [resolve(root, 'app/lib/deviceBiometric.ts')]: { hasDeviceBiometric: () => false },
    [resolve(root, 'app/lib/passwordPolicy.ts')]: { PASSWORD_POLICY_HINT: 'synthetic password policy' },
    [resolve(root, 'app/components/AppIdentity.tsx')]: { AppIcon: () => null },
    [resolve(root, 'app/components/HubBottomNav.tsx')]: { default: () => null },
  };
  const moduleCache = new Map<string, Record<string, unknown>>();
  const context = vm.createContext({
    Date, URL: Object.assign(class extends URL {}, { createObjectURL(blob: Blob) { downloads.push(blob); return 'blob:synthetic-backup'; }, revokeObjectURL() {} }),
    URLSearchParams, Blob, console, AbortController, Event, CustomEvent, Error, AggregateError,
    crypto, queueMicrotask, navigator, window: win,
    setTimeout: win.setTimeout, clearTimeout: win.clearTimeout,
    document: { body: { appendChild() {} }, createElement: () => ({ click() {}, remove() {} }) },
  });
  function load(path: string): Record<string, unknown> {
    const absolute = resolve(root, path);
    if (absolute in modules) return modules[absolute] as Record<string, unknown>;
    if (moduleCache.has(absolute)) return moduleCache.get(absolute)!;
    if (!sourceCache.has(absolute)) sourceCache.set(absolute, ts.transpileModule(readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText);
    const exports: Record<string, unknown> = {};
    moduleCache.set(absolute, exports);
    vm.runInContext(`(function(exports, require) { ${sourceCache.get(absolute)}\n})`, context)(exports, (name: string) => {
      if (name in modules) return modules[name];
      assert.ok(name.startsWith('.'), `Unexpected dependency ${name} from ${path}`);
      const dependency = resolve(dirname(absolute), name);
      const candidates = /\.tsx?$/.test(dependency) ? [dependency] : [`${dependency}.ts`, `${dependency}.tsx`];
      const found = candidates.find(candidate => candidate in modules) ?? candidates[0];
      return load(found);
    });
    return exports;
  }
  const transactions = load('app/data/storageTransaction.ts') as typeof Transactions;
  const cloud = load('app/data/cloudSync.ts') as typeof Cloud;
  function mount(path: string, props: Record<string, unknown> = {}) {
    const slots: unknown[] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [];
    let cursor = 0, changed = false, disposed = false;
    modules.react = {
      Fragment: Symbol.for('fixture-fragment'),
      useState(initial: unknown) {
        const slot = cursor++;
        if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
        return [slots[slot], (update: unknown) => {
          if (disposed) return;
          const next = typeof update === 'function' ? update(slots[slot]) : update;
          if (!Object.is(slots[slot], next)) { slots[slot] = next; changed = true; }
        }];
      },
      useRef(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
      useEffect(effect: () => (() => void) | void, deps: unknown[]) {
        const slot = cursor++, old = slots[slot] as unknown[] | undefined;
        if (!old || old.length !== deps.length || old.some((value, index) => !Object.is(value, deps[index]))) {
          slots[slot] = deps;
          effects.push(() => { cleanups[slot]?.(); const cleanup = effect(); if (cleanup) cleanups[slot] = cleanup; });
        }
      },
    };
    const component = load(path).default as (props: Record<string, unknown>) => UiNode;
    const history: UiNode[] = [];
    function render() {
      let result!: UiNode, rounds = 0;
      do {
        assert.ok(rounds++ < 25, 'Synthetic hooks did not settle');
        changed = false; cursor = 0; result = component(props); history.push(result);
        effects.splice(0).forEach(effect => effect());
      } while (changed);
      return result;
    }
    const find = (predicate: (node: UiNode) => boolean) => { const found = nodes(render()).find(predicate); assert.ok(found, `Missing node in ${textOf(render())}`); return found; };
    const view = {
      render, history,
      text: () => textOf(render()),
      button(label: string) { return find(node => node.type === 'button' && textOf(node) === label); },
      click(label: string) { const button = view.button(label); assert.ok(!button.props.disabled, `${label} is disabled`); (button.props.onClick as () => void)(); return render(); },
      async selectFile(raw: string | Promise<string>, name = 'synthetic-backup.json') {
        const input = find(node => node.type === 'input' && node.props.type === 'file');
        (input.props.onChange as (event: unknown) => void)({ target: { files: [{ name, size: 512, text: () => Promise.resolve(raw) }], value: name } });
        render(); await tick(); return render();
      },
      async settle(rounds = 4) { for (let i = 0; i < rounds; i++) { await tick(); render(); } return render(); },
      dispose() { disposed = true; cleanups.forEach(cleanup => cleanup?.()); },
    };
    render(); return view;
  }
  return {
    local, cloud, transactions, mount, pinReads, downloads,
    get reloads() { return reloads; }, get pendingTimers() { return timers.size; },
    emitAuth(event: string, userId: string | null) {
      currentUser = userId;
      const session = userId ? { user: { id: userId, email: `${userId}@example.test` } } : null;
      for (const listener of authListeners) listener(event, session);
    },
    holdNextPin() { const hold = deferred<boolean>(); pinWaits.push(hold); return hold; },
    setAuthError(error: Error | null) { authError = error; },
    disableLocks() { delete navigator.locks; },
    flushTimers() { for (const [token, callback] of [...timers]) { timers.delete(token); callback(); } },
    dispose() { browser.documents.delete(id); authListeners.clear(); listeners.clear(); timers.clear(); },
  };
}

export function backupJson(state: Record<string, unknown>) {
  return JSON.stringify({ app: 'AI-fitness-app', version: 1, exportedAt: '2026-10-09T12:00:00.000Z', state });
}
