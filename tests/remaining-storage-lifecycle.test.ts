import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { type TestContext } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as transactions from '../app/data/storageTransaction.ts';
import * as updates from '../app/data/fitnessStorageUpdates.ts';
import * as resets from '../app/data/appRecordReset.ts';
import * as growth from '../app/data/growthRoutines.ts';
import * as budget from '../app/budget/lib/pending-save.ts';
import * as workouts from '../app/data/workoutCompletion.ts';
import * as timers from '../app/data/timerClock.ts';
import { installStorageLocks, preparedStorageSeed } from './helpers/storageProtocol.ts';

const userId = 'lifecycle-owner-A';
const marker = '2026-10-09T12:00:00.000Z|synthetic-reset';
const requestId = 'synthetic-request-1';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function browser(seed: Record<string, string> = {}) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const installed = installStorageLocks();
  const active = new Set<string>();
  const requested: string[] = [];
  let failure: { operation: 'set' | 'remove'; key: string } | undefined;
  let observer: (() => void) | undefined;
  const values = new Map(Object.entries({ ...preparedStorageSeed(userId), ...seed }));
  const local = {
    values,
    get length() { return values.size; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) {
      if (failure?.operation === 'set' && failure.key === key) { failure = undefined; throw new Error('Synthetic local write failure'); }
      values.set(key, value); observer?.();
    },
    removeItem(key: string) {
      if (failure?.operation === 'remove' && failure.key === key) { failure = undefined; throw new Error('Synthetic local delete failure'); }
      values.delete(key); observer?.();
    },
  };
  const sessionValues = new Map<string, string>();
  const windowListeners = new Map<string, Set<() => void>>();
  const documentListeners = new Map<string, Set<() => void>>();
  const intervals = new Map<number, () => void>();
  let nextInterval = 0;
  const events = (listeners: Map<string, Set<() => void>>) => ({
    addEventListener(name: string, callback: () => void) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(callback); },
    removeEventListener(name: string, callback: () => void) { listeners.get(name)?.delete(callback); },
    dispatchEvent(event: { type: string }) { [...(listeners.get(event.type) ?? [])].forEach(callback => callback()); return true; },
  });
  const document = { body: { style: { overflow: '' } }, visibilityState: 'visible', ...events(documentListeners) };
  const win = {
    localStorage: local,
    sessionStorage: { getItem: (key: string) => sessionValues.get(key) ?? null, setItem: (key: string, value: string) => { sessionValues.set(key, value); } },
    setInterval(callback: () => void) { intervals.set(++nextInterval, callback); return nextInterval; },
    clearInterval(id: number) { intervals.delete(id); },
    ...events(windowListeners),
  };
  const locks = {
    request<T>(name: string, options: unknown, callback: () => T | Promise<T>) {
      requested.push(name);
      return installed.locks.request(name, options, async () => {
        active.add(name);
        try { return await callback(); } finally { active.delete(name); }
      });
    },
  };
  const navigator = { locks, onLine: true };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigator });
  return {
    local, win, document, navigator, active, requested,
    fail(operation: 'set' | 'remove', key: string) { failure = { operation, key }; },
    observe(callback: () => void) { observer = callback; },
    unavailable() { Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } }); Reflect.deleteProperty(navigator, 'locks'); },
    async hold(name = transactions.STORAGE_LOCK_NAME) {
      const entered = deferred<void>(), gate = deferred<void>();
      const operation = locks.request(name, { mode: 'exclusive' }, async () => { entered.resolve(); await gate.promise; });
      await entered.promise;
      return async () => { gate.resolve(); await operation; };
    },
    async switchOwner(next: string) {
      const owner = transactions.invalidateStorageOwner(local, next);
      await transactions.completeStorageOwnerTransition(local, owner, () => ({ [transactions.STORAGE_OWNER_KEY]: next }));
    },
    checkpoint() { [...intervals.values()].forEach(callback => callback()); },
    dispose() {
      observer = undefined;
      installed.restore();
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
      if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
    },
  };
}

// Compile the shipped module, replacing only its environment and dependency
// boundaries. No browser is launched, and no authenticated API is contacted.
function loadSource<T>(path: string, modules: Record<string, unknown>, globals: Record<string, unknown> = {}, expose = ''): T {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(`(function(exports, require) { ${source}\n${expose}\n})`, { Error, Date, console, Event, ...globals })(exports, (key: string) => {
    assert.ok(key in modules, `Unexpected dependency ${key}`);
    return modules[key];
  });
  return exports as T;
}

type ResetResult = { app: resets.RecordResetApp; user_id: string; marker: string };
function resetFixture(b: ReturnType<typeof browser>) {
  const authCalls: number[] = [], rpcCalls: { name: string; args: { p_app: resets.RecordResetApp; p_request_id: string; p_confirmation: string } }[] = [];
  const serverReceipts = new Map<string, ResetResult>();
  let authHook: ((call: number) => Promise<void>) | undefined;
  let rpcHook: (() => Promise<void>) | undefined;
  function checkNetworkLock() {
    assert.equal(b.active.has(transactions.STORAGE_LOCK_NAME), false, 'Never perform network work inside the shared storage lock');
    assert.ok(b.active.has('ai-yeoni-record-reset') || b.active.has('ai-yeoni-growth-sync'), 'Reset keeps its outer operation lock');
  }
  const supabase = {
    auth: { async getUser() { checkNetworkLock(); authCalls.push(authCalls.length + 1); await authHook?.(authCalls.length); checkNetworkLock(); return { data: { user: { id: userId } }, error: null }; } },
    async rpc(name: string, args: { p_app: resets.RecordResetApp; p_request_id: string; p_confirmation: string }) {
      checkNetworkLock(); rpcCalls.push({ name, args }); await rpcHook?.(); checkNetworkLock();
      if (!serverReceipts.has(args.p_request_id)) serverReceipts.set(args.p_request_id, { app: args.p_app, user_id: userId, marker });
      return { data: serverReceipts.get(args.p_request_id), error: null };
    },
  };
  const api = loadSource<{ resetAppRecords: (app: resets.RecordResetApp, id: string, expected: string) => Promise<ResetResult> }>('../app/lib/resetAppRecords.ts', {
    '../data/storageTransaction': transactions, './supabase': { supabase }, '../data/appRecordReset': resets, '../data/growthRoutines': growth, '../budget/lib/pending-save': budget,
  }, { window: b.win, navigator: b.navigator });
  return { ...api, authCalls, rpcCalls, serverReceipts,
    onAuth(hook: (call: number) => Promise<void>) { authHook = hook; },
    onRpc(hook: () => Promise<void>) { rpcHook = hook; },
  };
}

function resetSeed() {
  return Object.fromEntries(resets.RECORD_RESET_APPS.flatMap(app => [
    ...resets.APP_RECORD_KEYS[app].map(key => [key, JSON.stringify({ synthetic: key })]),
    [resets.resetMarkerKey(app), `older-${app}-marker`],
  ]));
}
function project(b: ReturnType<typeof browser>, keys: string[]) {
  const snapshot = transactions.readStorageSnapshot(b.local);
  return Object.fromEntries(keys.map(key => [key, snapshot.getItem(key)]));
}

test('reset without Web Locks rejects before authentication or reset RPC and preserves local data', async t => {
  const b = browser(resetSeed()); t.after(b.dispose); const reset = resetFixture(b); b.unavailable();
  const before = [...b.local.values];
  await assert.rejects(reset.resetAppRecords('fitness', requestId, userId), transactions.StorageLocksUnavailableError);
  assert.equal(reset.authCalls.length, 0); assert.equal(reset.rpcCalls.length, 0); assert.deepEqual([...b.local.values], before);
});

for (const boundary of ['outer-lock', 'first-auth', 'reset-rpc', 'second-auth'] as const) test(`reset owner ABA during ${boundary} fences old operation without touching new-owner records`, async t => {
  const b = browser(resetSeed()); t.after(b.dispose); const reset = resetFixture(b);
  const entered = deferred<void>(), resume = deferred<void>();
  let releaseOuter: (() => Promise<void>) | undefined;
  if (boundary === 'outer-lock') releaseOuter = await b.hold('ai-yeoni-record-reset');
  if (boundary === 'first-auth' || boundary === 'second-auth') reset.onAuth(async call => { if (call === (boundary === 'first-auth' ? 1 : 2)) { entered.resolve(); await resume.promise; } });
  if (boundary === 'reset-rpc') reset.onRpc(async () => { entered.resolve(); await resume.promise; });
  const running = reset.resetAppRecords('fitness', requestId, userId);
  const rejected = assert.rejects(running, transactions.StorageSessionChangedError);
  if (boundary !== 'outer-lock') await entered.promise;
  await b.switchOwner('lifecycle-owner-B'); await b.switchOwner(userId);
  b.local.values.set(resets.APP_RECORD_KEYS.fitness[0], 'new-owner-record');
  const before = project(b, [...resets.APP_RECORD_KEYS.fitness, resets.resetMarkerKey('fitness')]);
  resume.resolve(); await releaseOuter?.(); await rejected;
  assert.deepEqual(project(b, Object.keys(before)), before);
  assert.equal(reset.rpcCalls.length, boundary === 'reset-rpc' || boundary === 'second-auth' ? 1 : 0);
  assert.equal(b.win.sessionStorage.getItem(`record-reset-receipt:${userId}:fitness`), null);
});

for (const app of resets.RECORD_RESET_APPS.filter(app => app !== 'language')) test(`${app} reset atomically publishes its nonlanguage marker and preserves other app records`, async t => {
  const seed = resetSeed(), growthKey = growth.getGrowthRoutinesStorageKey(userId);
  const routine = { ...growth.DEFAULT_GROWTH_ROUTINES[0], title: 'Keep my custom title', targetMinutes: 37, completedDates: ['2026-10-08'] };
  seed[growthKey] = JSON.stringify([routine]); seed[`${growthKey}:legacy-import`] = 'legacy';
  seed[budget.pendingBudgetSaveKey(userId)] = 'pending'; seed[budget.pendingBudgetSaveKey('other-user')] = 'keep-other-user';
  seed['ai-fitness-weight-goal'] = 'keep-fitness-setting'; seed.unrelated = 'keep-unrelated';
  const b = browser(seed); t.after(b.dispose); const reset = resetFixture(b);
  const keys = [...resets.APP_RECORD_KEYS[app], resets.resetMarkerKey(app)];
  const before = project(b, keys), after = Object.fromEntries(keys.map(key => [key, key === resets.resetMarkerKey(app) ? marker : null]));
  const observed: Record<string, string | null>[] = [];
  b.observe(() => { observed.push(project(b, keys)); });
  const result = await reset.resetAppRecords(app, requestId, userId);
  assert.equal(result.marker, marker); assert.deepEqual(project(b, keys), after);
  assert.ok(observed.length > 0);
  for (const snapshot of observed) assert.ok(JSON.stringify(snapshot) === JSON.stringify(before) || JSON.stringify(snapshot) === JSON.stringify(after), 'Readers see either the complete pre-reset or post-reset state');
  for (const other of resets.RECORD_RESET_APPS.filter(other => other !== app)) for (const key of [...resets.APP_RECORD_KEYS[other], resets.resetMarkerKey(other)]) assert.equal(b.local.getItem(key), seed[key]);
  assert.equal(b.local.getItem('ai-fitness-weight-goal'), seed['ai-fitness-weight-goal']); assert.equal(b.local.getItem('unrelated'), 'keep-unrelated');
  assert.equal(b.local.getItem(budget.pendingBudgetSaveKey('other-user')), 'keep-other-user');
  assert.equal(b.local.getItem(budget.pendingBudgetSaveKey(userId)), app === 'budget' ? null : 'pending');
  assert.deepEqual(JSON.parse(b.local.getItem(growthKey)!), [{ ...routine, completedDates: app === 'growth' ? [] : routine.completedDates }]);
  if (app === 'growth') { assert.equal(b.local.getItem(`${growthKey}:cloud-migrated`), '1'); assert.equal(b.local.getItem(`${growthKey}:sync-token`), marker); assert.equal(b.local.getItem(`${growthKey}:legacy-import`), null); assert.equal(b.local.getItem(`${growthKey}:record-reset`), marker); }
  assert.equal(b.win.sessionStorage.getItem(`record-reset-receipt:${userId}:${app}`), '1');
  assert.deepEqual(JSON.parse(b.local.getItem(resets.RECORD_RESET_STORAGE_EVENT)!), { userId, app, marker });
  assert.equal(reset.rpcCalls[0].name, 'reset_my_app_records'); assert.deepEqual({ ...reset.rpcCalls[0].args }, { p_app: app, p_request_id: requestId, p_confirmation: '초기화' });
  assert.ok(b.requested.includes(transactions.STORAGE_LOCK_NAME));
});

for (const app of ['fitness', 'diet', 'growth', 'assistant', 'budget'] as const) test(`${app} failed marker write rolls back reset keys and same request safely retries server receipt`, async t => {
  const b = browser(resetSeed()); t.after(b.dispose); const reset = resetFixture(b);
  const keys = [...resets.APP_RECORD_KEYS[app], resets.resetMarkerKey(app)], before = project(b, keys);
  b.fail('set', resets.resetMarkerKey(app));
  await assert.rejects(reset.resetAppRecords(app, requestId, userId), /클라우드 초기화는 완료됐지만.*같은 버튼으로 다시 확인.*Synthetic local write failure/);
  assert.deepEqual(project(b, keys), before); assert.equal(b.local.getItem(resets.RECORD_RESET_STORAGE_EVENT), null);
  assert.equal(b.win.sessionStorage.getItem(`record-reset-receipt:${userId}:${app}`), null); assert.equal(reset.serverReceipts.size, 1);
  await reset.resetAppRecords(app, requestId, userId);
  assert.equal(reset.rpcCalls.length, 2); assert.ok(reset.rpcCalls.every(call => call.args.p_request_id === requestId)); assert.equal(reset.serverReceipts.size, 1);
  assert.equal(b.local.getItem(resets.resetMarkerKey(app)), marker);
  for (const key of resets.APP_RECORD_KEYS[app]) assert.equal(b.local.getItem(key), null);
});

test('mid-reset key deletion failure restores every key and the old marker before reporting uncertainty', async t => {
  const b = browser(resetSeed()); t.after(b.dispose); const reset = resetFixture(b);
  const keys = [...resets.APP_RECORD_KEYS.fitness, resets.resetMarkerKey('fitness')], before = project(b, keys);
  b.fail('remove', resets.APP_RECORD_KEYS.fitness[3]);
  await assert.rejects(reset.resetAppRecords('fitness', requestId, userId), /클라우드 초기화는 완료됐지만/);
  assert.deepEqual(project(b, keys), before);
});

test('same reset receipt does not delete fresh records created after local reset committed', async t => {
  const b = browser(resetSeed()); t.after(b.dispose); const reset = resetFixture(b);
  await reset.resetAppRecords('fitness', requestId, userId);
  const key = resets.APP_RECORD_KEYS.fitness[0]; b.local.values.set(key, 'fresh-after-reset');
  await reset.resetAppRecords('fitness', requestId, userId);
  assert.equal(b.local.getItem(key), 'fresh-after-reset'); assert.equal(reset.serverReceipts.size, 1);
});

for (const app of ['growth', 'budget'] as const) test(`${app} post-marker cleanup failure keeps its server receipt retryable without clearing unrelated data`, async t => {
  const key = app === 'growth' ? growth.getGrowthRoutinesStorageKey(userId) : budget.pendingBudgetSaveKey(userId);
  const routine = { ...growth.DEFAULT_GROWTH_ROUTINES[0], completedDates: ['2026-10-08'] };
  const original = app === 'growth' ? JSON.stringify([routine]) : 'synthetic-pending-budget-save';
  const b = browser({ ...resetSeed(), [key]: original, unrelated: 'keep' }); t.after(b.dispose); const reset = resetFixture(b);
  b.fail(app === 'growth' ? 'set' : 'remove', key);
  await assert.rejects(reset.resetAppRecords(app, requestId, userId), /클라우드 초기화는 완료됐지만.*같은 버튼으로 다시 확인/);
  assert.equal(b.local.getItem(resets.resetMarkerKey(app)), marker); assert.equal(b.local.getItem(key), original);
  assert.equal(b.win.sessionStorage.getItem(`record-reset-receipt:${userId}:${app}`), null);
  await reset.resetAppRecords(app, requestId, userId);
  assert.equal(reset.rpcCalls.length, 2); assert.equal(reset.serverReceipts.size, 1); assert.equal(b.local.getItem('unrelated'), 'keep');
  if (app === 'growth') assert.deepEqual(JSON.parse(b.local.getItem(key)!), [{ ...routine, completedDates: [] }]);
  else assert.equal(b.local.getItem(key), null);
  assert.equal(b.win.sessionStorage.getItem(`record-reset-receipt:${userId}:${app}`), '1');
});

test('reset receipt publication failure reports uncertainty and same-request retry preserves post-reset edits', async t => {
  const b = browser(resetSeed()); t.after(b.dispose); const reset = resetFixture(b);
  b.fail('set', resets.RECORD_RESET_STORAGE_EVENT);
  await assert.rejects(reset.resetAppRecords('fitness', requestId, userId), /클라우드 초기화는 완료됐지만/);
  assert.equal(b.local.getItem(resets.resetMarkerKey('fitness')), marker);
  const key = resets.APP_RECORD_KEYS.fitness[0]; b.local.values.set(key, 'fresh-after-durable-reset');
  await reset.resetAppRecords('fitness', requestId, userId);
  assert.equal(b.local.getItem(key), 'fresh-after-durable-reset'); assert.equal(reset.serverReceipts.size, 1);
  assert.equal(b.win.sessionStorage.getItem(`record-reset-receipt:${userId}:fitness`), '1');
});

type Node = { type: unknown; props: Record<string, unknown> };
const nodes = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' && 'props' in node ? [node as Node, ...nodes((node as Node).props.children)] : [];
const textOf = (node: unknown): string => Array.isArray(node) ? node.map(textOf).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' && 'props' in node ? textOf((node as Node).props.children) : '';
const exercise = { name: 'Synthetic exercise', meta: '10회' };
const fixedTime = Date.parse('2026-10-09T12:00:00.000Z');
class FixedDate extends Date { constructor() { super(fixedTime); } static now() { return fixedTime; } }

function mountSession(b: ReturnType<typeof browser>, callbacks: { onFinish?: (value: unknown) => void | Promise<void>; onClose?: () => void } = {}, initialRaw?: string) {
  const slots: unknown[] = [], effects: { slot: number; run: () => void }[] = [], cleanups: (() => void)[] = [];
  let cursor = 0, changed = false, disposed = false;
  const react = {
    useState(initial: unknown) {
      const slot = cursor++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], (update: unknown) => { const next = typeof update === 'function' ? update(slots[slot]) : update; if (!Object.is(next, slots[slot])) { slots[slot] = next; changed = true; } }];
    },
    useRef(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useMemo(factory: () => unknown, deps: unknown[]) { const slot = cursor++, old = slots[slot] as { deps: unknown[]; value: unknown } | undefined; if (!old || old.deps.length !== deps.length || old.deps.some((value, index) => value !== deps[index])) slots[slot] = { deps, value: factory() }; return (slots[slot] as { value: unknown }).value; },
    useCallback(callback: () => unknown, deps: unknown[]) { return react.useMemo(() => callback, deps); },
    useEffect(effect: () => void, deps: unknown[]) { const slot = cursor++, old = slots[slot] as unknown[] | undefined; if (!old || old.length !== deps.length || old.some((value, index) => value !== deps[index])) { slots[slot] = deps; effects.push({ slot, run: () => { const cleanup = effect(); if (typeof cleanup === 'function') cleanups[slot] = cleanup; } }); } },
  };
  const voice = { speak() {}, stop() {}, unlock() {}, prepare() {}, replay() {}, audio: { current: null }, announcement: '', notice: '', replayAvailable: false };
  const modules: Record<string, unknown> = {
    react, 'react/jsx-runtime': { jsx: (type: unknown, props: Node['props']) => ({ type, props }), jsxs: (type: unknown, props: Node['props']) => ({ type, props }) },
    '@/components/useDialogFocus': { useDialogFocus() {} }, '@/components/useUnsavedChanges': { useUnsavedChanges() {} },
    '../data/storageTransaction': transactions, '../data/fitnessStorageUpdates': updates, '../data/workoutCompletion': workouts, '../data/timerClock': timers,
    '../data/workoutRecommendations': loadSource('../app/data/workoutRecommendations.ts', {}),
    './useWorkoutVoice': { useWorkoutVoice: () => voice }, './WorkoutControls': { IntervalTimer() {} },
    './ExerciseGuidePanel': { default() {}, getExerciseVideoHref: () => undefined, getExerciseVideoLabel: () => '' }, './ExerciseRecordEditor': { default() {} },
  };
  const session = loadSource<{ default: (props: Record<string, unknown>) => Node; draftKey: (signature: string) => string }>('../app/components/WorkoutSession.tsx', modules,
    { window: b.win, document: b.document, navigator: b.navigator, Date: FixedDate }, 'exports.draftKey = getSessionDraftKey;');
  const draftKey = session.draftKey(`${exercise.name}:normal`);
  if (initialRaw !== undefined) b.local.values.set(draftKey, initialRaw);
  const props = { exercises: [exercise], title: 'Synthetic session', onClose() {}, ...callbacks };
  function render(): Node {
    let node!: Node, rounds = 0;
    do {
      assert.ok(rounds++ < 25, 'WorkoutSession hooks settle'); changed = false; cursor = 0; node = session.default(props);
      if (!disposed) {
        const pending = effects.splice(0);
        // React's passive unmount phase runs every changed-effect cleanup
        // before its passive mount phase sets up any of the new effects.
        pending.forEach(({ slot }) => { cleanups[slot]?.(); delete cleanups[slot]; });
        pending.forEach(({ run }) => run());
      }
    } while (changed);
    return node;
  }
  const find = (predicate: (node: Node) => boolean) => { const found = nodes(render()).filter(predicate); assert.equal(found.length, 1, 'Unique session node'); return found[0]; };
  render();
  return {
    draftKey, render, find,
    async settle() { await tick(); if (!disposed) render(); await tick(); if (!disposed) render(); },
    click(label: string) { const node = find(node => node.type === 'button' && textOf(node) === label); const result = (node.props.onClick as () => void | Promise<void>)(); render(); return result; },
    text: () => textOf(render()),
    disabled: () => nodes(render()).some(node => node.type === 'fieldset' && node.props.disabled === true),
    draft: () => JSON.parse(b.local.getItem(draftKey) ?? 'null'),
    dispose() { if (disposed) return; disposed = true; cleanups.forEach(cleanup => cleanup?.()); },
  };
}
function cleanup(t: TestContext, b: ReturnType<typeof browser>, qa: ReturnType<typeof mountSession>) {
  t.after(async () => { qa.dispose(); await qa.settle(); b.dispose(); });
}

test('session autosave queues its latest revision, compare-and-swaps fresh raw data, and retains peer draft', async t => {
  const b = browser(), qa = mountSession(b); cleanup(t, b, qa); await qa.settle();
  assert.equal(qa.draft().mode, 'exercise');
  const release = await b.hold(); qa.click('이 동작 완료'); await tick();
  const peerRaw = JSON.stringify({ ...qa.draft(), painMemo: 'peer draft must survive' }); b.local.values.set(qa.draftKey, peerRaw);
  await release(); await qa.settle();
  assert.equal(b.local.getItem(qa.draftKey), peerRaw); assert.match(qa.text(), /다른 창의 임시 기록/); assert.match(qa.text(), /오늘 운동을 마쳤습니다/);
});

test('session autosave collapses queued revisions without losing newer summary feedback', async t => {
  const b = browser(), qa = mountSession(b); cleanup(t, b, qa); await qa.settle();
  const release = await b.hold(); qa.click('이 동작 완료'); qa.click('힘듦'); qa.click('4'); await tick();
  await release(); await qa.settle();
  assert.equal(qa.draft().mode, 'summary'); assert.equal(qa.draft().difficulty, 'hard'); assert.equal(qa.draft().fatigue, 4); assert.equal(qa.draft().exerciseRecords[0].status, 'completed');
  assert.equal(nodes(qa.render()).some(node => node.props.role === 'alert'), false);
});

test('queued session autosave retains its captured owner across owner A to B to A', async t => {
  const b = browser(), qa = mountSession(b); cleanup(t, b, qa); await qa.settle();
  const before = b.local.getItem(qa.draftKey), release = await b.hold(); qa.click('이 동작 완료'); await tick();
  transactions.invalidateStorageOwner(b.local, 'lifecycle-owner-B');
  await release(); await b.switchOwner(userId); await qa.settle();
  assert.equal(b.local.getItem(qa.draftKey), before); assert.match(qa.text(), /로그인 계정이 변경/);
  b.checkpoint(); await qa.settle(); assert.equal(b.local.getItem(qa.draftKey), before);
});

for (const raw of ['{broken-json', JSON.stringify({ version: 9, exerciseSignature: exercise.name })]) test(`session autosave preserves unreadable raw draft ${raw}`, async t => {
  const b = browser(), qa = mountSession(b, {}, raw); cleanup(t, b, qa); await qa.settle();
  assert.equal(b.local.getItem(qa.draftKey), raw); assert.match(qa.text(), /읽을 수 없는 기록을 보존/);
  qa.click('이 동작 완료'); b.checkpoint(); await qa.settle(); assert.equal(b.local.getItem(qa.draftKey), raw);
});

test('session failed completion retains draft and feedback and never closes or claims success', async t => {
  const b = browser(); let closes = 0, finishes = 0;
  const qa = mountSession(b, { onClose: () => { closes++; }, onFinish: async () => { finishes++; throw new Error('Synthetic completion failure'); } }); cleanup(t, b, qa);
  qa.click('이 동작 완료'); qa.click('힘듦'); await qa.settle(); const before = b.local.getItem(qa.draftKey);
  await qa.click('기록 저장하고 종료'); await qa.settle();
  assert.equal(finishes, 1); assert.equal(closes, 0); assert.equal(b.local.getItem(qa.draftKey), before); assert.equal(qa.disabled(), false); assert.match(qa.text(), /Synthetic completion failure/);
  assert.equal(qa.find(node => node.type === 'button' && textOf(node) === '힘듦').props['aria-pressed'], true);
  b.checkpoint(); await qa.settle(); assert.equal(qa.draft().difficulty, 'hard');
});

test('session completion receipt retries only draft cleanup after durable onFinish success', async t => {
  const b = browser(); let closes = 0, finishes = 0;
  const qa = mountSession(b, { onClose: () => { closes++; }, onFinish: async () => { assert.equal(b.active.has(transactions.STORAGE_LOCK_NAME), false); finishes++; } }); cleanup(t, b, qa);
  qa.click('이 동작 완료'); await qa.settle(); const before = b.local.getItem(qa.draftKey);
  b.fail('remove', qa.draftKey); await qa.click('기록 저장하고 종료'); await qa.settle();
  assert.equal(finishes, 1); assert.equal(closes, 0); assert.equal(b.local.getItem(qa.draftKey), before); assert.equal(qa.disabled(), true); assert.match(qa.text(), /운동 결과는 저장했지만 임시 기록 정리를 확인하지 못했어요/);
  b.checkpoint(); b.win.dispatchEvent({ type: 'pagehide' }); await qa.settle(); assert.equal(b.local.getItem(qa.draftKey), before);
  const release = await b.hold(); qa.click('임시 기록 정리 다시 시도'); await tick(); assert.equal(closes, 0); assert.equal(finishes, 1);
  await release(); await qa.settle(); assert.equal(closes, 1); assert.equal(finishes, 1); assert.equal(b.local.getItem(qa.draftKey), null);
  b.checkpoint(); b.win.dispatchEvent({ type: 'pagehide' }); qa.dispose(); await qa.settle(); assert.equal(b.local.getItem(qa.draftKey), null);
});

test('session discard waits for draft deletion, stays open on failure, and successful retry cannot recreate draft', async t => {
  const b = browser(); let closes = 0, finishes = 0;
  const qa = mountSession(b, { onClose: () => { closes++; }, onFinish: () => { finishes++; } }); cleanup(t, b, qa); await qa.settle();
  const before = b.local.getItem(qa.draftKey); qa.click('나가기');
  const release = await b.hold(); b.fail('remove', qa.draftKey); qa.click('저장 없이 종료'); await tick();
  assert.equal(closes, 0); assert.equal(qa.disabled(), true); assert.equal(b.local.getItem(qa.draftKey), before);
  await release(); await qa.settle();
  assert.equal(closes, 0); assert.equal(finishes, 0); assert.equal(b.local.getItem(qa.draftKey), before); assert.equal(qa.disabled(), false); assert.match(qa.text(), /Synthetic local delete failure/); assert.match(qa.text(), /운동을 종료할까요/);
  qa.click('저장 없이 종료'); await qa.settle(); assert.equal(closes, 1); assert.equal(b.local.getItem(qa.draftKey), null);
  b.checkpoint(); b.win.dispatchEvent({ type: 'pagehide' }); qa.dispose(); await qa.settle(); assert.equal(b.local.getItem(qa.draftKey), null);
});

test('autosave already queued before discard cannot recreate the cleared draft', async t => {
  const b = browser(); let closes = 0;
  const qa = mountSession(b, { onClose: () => { closes++; } }); cleanup(t, b, qa); await qa.settle();
  const release = await b.hold(); qa.click('이 동작 완료'); qa.click('나가기'); await tick(); qa.click('저장 없이 종료'); await tick();
  assert.equal(closes, 0); await release(); await qa.settle();
  assert.equal(closes, 1); assert.equal(b.local.getItem(qa.draftKey), null); b.checkpoint(); await qa.settle(); assert.equal(b.local.getItem(qa.draftKey), null);
});

test('session duplicate completion clicks call onFinish only once while awaiting it', async t => {
  const b = browser(), saving = deferred<void>(); let finishes = 0, closes = 0;
  const qa = mountSession(b, { onClose: () => { closes++; }, onFinish: () => { finishes++; return saving.promise; } }); cleanup(t, b, qa);
  qa.click('이 동작 완료'); await qa.settle(); const first = qa.click('기록 저장하고 종료'); await tick(); await qa.click('기록 저장하고 종료');
  assert.equal(finishes, 1); assert.equal(closes, 0); assert.equal(qa.disabled(), true); assert.notEqual(b.local.getItem(qa.draftKey), null);
  saving.resolve(); await first; await qa.settle(); assert.equal(finishes, 1); assert.equal(closes, 1); assert.equal(b.local.getItem(qa.draftKey), null);
});

const validRestoredDraft = {
  version: 2, feedbackVersion: 1, exerciseSignature: exercise.name, savedAt: fixedTime,
  currentIndex: 0, mode: 'exercise', completed: [], skipped: [], elapsedSeconds: 0, timerSeconds: 0, restSeconds: 0,
  painScore: 0, painSymptoms: [], neurologicalSymptoms: [], painMemo: '', overallStatus: 'completed',
  exerciseRecords: [{ exerciseName: exercise.name, status: 'pending' }],
};
for (const [kind, raw] of [
  ['malformed JSON', '{broken-json'],
  ['unknown version', JSON.stringify({ version: 9, exerciseSignature: exercise.name })],
  ['unknown feedback version', JSON.stringify({ ...validRestoredDraft, feedbackVersion: 2 })],
  ['malformed v2 completed field', JSON.stringify({ ...validRestoredDraft, completed: {} })],
  ['malformed v2 null exercise record', JSON.stringify({ ...validRestoredDraft, exerciseRecords: [null] })],
  ['malformed v2 null set entry', JSON.stringify({ ...validRestoredDraft, exerciseRecords: [{ exerciseName: exercise.name, status: 'pending', sets: [null] }] })],
  ['malformed v2 falsy sets field', JSON.stringify({ ...validRestoredDraft, exerciseRecords: [{ exerciseName: exercise.name, status: 'pending', sets: 0 }] })],
  ['malformed v2 painExercise child', JSON.stringify({ ...validRestoredDraft, painExercise: {} })],
] as const) for (const action of ['complete', 'discard'] as const) test(`session ${action} preserves ${kind} draft bytes through blocked cleanup and repeated attempts`, async t => {
  const b = browser(); let closes = 0, finishes = 0;
  const qa = mountSession(b, { onClose: () => { closes++; }, onFinish: async () => { finishes++; } }, raw); cleanup(t, b, qa); await qa.settle();
  assert.equal(b.local.getItem(qa.draftKey), raw);
  if (action === 'complete') {
    qa.click('이 동작 완료'); await qa.settle(); await qa.click('기록 저장하고 종료'); await qa.settle();
    assert.equal(finishes, 1); assert.equal(qa.disabled(), true);
    assert.match(qa.text(), /운동 결과는 저장했지만 임시 기록 정리를 확인하지 못했어요/);
  } else {
    qa.click('나가기'); qa.click('저장 없이 종료'); await qa.settle();
    assert.equal(finishes, 0); assert.equal(qa.disabled(), false); assert.match(qa.text(), /운동을 종료할까요/);
  }
  assert.equal(closes, 0); assert.equal(b.local.getItem(qa.draftKey), raw); assert.match(qa.text(), /읽을 수 없는.*보존/);
  for (let attempt = 0; attempt < 2; attempt++) {
    qa.click(action === 'complete' ? '임시 기록 정리 다시 시도' : '저장 없이 종료'); await qa.settle();
    assert.equal(finishes, action === 'complete' ? 1 : 0); assert.equal(closes, 0); assert.equal(b.local.getItem(qa.draftKey), raw);
  }
  b.checkpoint(); b.win.dispatchEvent({ type: 'pagehide' }); qa.dispose(); await qa.settle();
  assert.equal(b.local.getItem(qa.draftKey), raw); assert.equal(closes, 0);
});

for (const cause of ['unreadable-draft', 'delete-failure'] as const) test(`session without onFinish never claims workout result saved when ${cause} blocks cleanup`, async t => {
  const b = browser(); let closes = 0;
  // ExerciseCard intentionally supplies only onClose, without an onFinish saver.
  const qa = mountSession(b, { onClose: () => { closes++; } }, cause === 'unreadable-draft' ? '{unreadable-draft' : undefined); cleanup(t, b, qa);
  qa.click('이 동작 완료'); await qa.settle(); const before = b.local.getItem(qa.draftKey);
  if (cause === 'delete-failure') b.fail('remove', qa.draftKey);
  await qa.click('기록 저장하고 종료'); await qa.settle();
  assert.equal(closes, 0); assert.equal(b.local.getItem(qa.draftKey), before); assert.equal(qa.disabled(), true);
  const alert = textOf(qa.find(node => node.props.role === 'alert'));
  assert.match(alert, /임시 기록 정리/); assert.doesNotMatch(alert, /운동 결과는 저장|운동 결과.*저장했|운동 결과.*저장됐/);
  if (cause === 'delete-failure') b.fail('remove', qa.draftKey);
  qa.click('임시 기록 정리 다시 시도'); await qa.settle();
  assert.equal(closes, 0); assert.equal(b.local.getItem(qa.draftKey), before);
  assert.doesNotMatch(textOf(qa.find(node => node.props.role === 'alert')), /운동 결과는 저장|운동 결과.*저장했|운동 결과.*저장됐/);
});


test('session validated restored v2 draft remains eligible for autosave and successful completion cleanup', async t => {
  const b = browser(); let closes = 0, finishes = 0;
  const qa = mountSession(b, { onClose: () => { closes++; }, onFinish: () => { finishes++; } }, JSON.stringify(validRestoredDraft)); cleanup(t, b, qa);
  await qa.settle(); assert.match(qa.text(), /이전 진행상태에서 이어서 시작/);
  qa.click('이 동작 완료'); await qa.settle(); assert.equal(qa.draft().mode, 'summary');
  await qa.click('기록 저장하고 종료'); await qa.settle();
  assert.equal(finishes, 1); assert.equal(closes, 1); assert.equal(b.local.getItem(qa.draftKey), null);
});

test('session understood v2 draft preserves unknown root, exercise and set extensions through autosave and edits', async t => {
  const rootExtension = { schema: 'synthetic-extension-v1', flags: ['keep', 'original'], detail: { value: 17 } };
  const exerciseExtension = { customMetric: { measured: 12, unit: 'synthetic' } };
  const setExtension = { importedMetadata: { id: 'original-set', labels: ['preserve'] } };
  const executionContext = {
    method: 'circuit', sourceExerciseIndex: 0, sequenceIndex: 2, roundNumber: 3, groupNumber: 1,
    plannedSets: 1, plannedRestSeconds: 45, plannedWorkSeconds: 40,
    futureExecutionExtension: { source: 'synthetic-import', detail: { retain: true } },
  };
  const restored = {
    ...validRestoredDraft,
    savedAt: fixedTime - 60_000, elapsedSeconds: 61, timerSeconds: 12, restSeconds: 9,
    painScore: 3, painSymptoms: ['기타'], backStatus: 'stiff', neurologicalSymptoms: ['tingling'],
    painExercise: exercise.name, painSet: 1, painMemo: 'Preserve original feedback memo', overallStatus: 'partial',
    difficulty: 'moderate', fatigue: 2, lastSetRpe: 7, painArea: '허리',
    futureRootExtension: rootExtension,
    exerciseRecords: [{
      exerciseName: exercise.name, status: 'pending', futureExerciseExtension: exerciseExtension,
      durationMinutes: 8, distanceKm: 0.6, stepCount: 1234, intervalWorkSeconds: 30,
      intervalRestSeconds: 15, intervalRounds: 4, painScore: 2, summary: 'Preserve original exercise summary', executionContext,
      sets: [{
        setNumber: 1, completed: false, reps: 6, weightKg: 7.5, durationSeconds: 22, bandLevel: 'light',
        leftReps: 5, rightReps: 6, restAfterSeconds: 21, plannedReps: 10, plannedDurationSeconds: 40,
        plannedRestSeconds: 45, futureSetExtension: setExtension,
      }],
    }],
  };
  const b = browser(); let closes = 0, finishes = 0, received: unknown;
  const qa = mountSession(b, { onClose: () => { closes++; }, onFinish: result => { finishes++; received = result; } }, JSON.stringify(restored)); cleanup(t, b, qa);
  function assertExtensions() {
    const draft = qa.draft();
    assert.deepEqual(draft.futureRootExtension, rootExtension);
    assert.deepEqual(draft.exerciseRecords[0].futureExerciseExtension, exerciseExtension);
    assert.deepEqual(draft.exerciseRecords[0].sets[0].futureSetExtension, setExtension);
    assert.deepEqual(draft.exerciseRecords[0].executionContext, executionContext);
  }
  await qa.settle(); assert.match(qa.text(), /이전 진행상태에서 이어서 시작/);
  assert.deepEqual(qa.draft(), { ...restored, savedAt: fixedTime }, 'Initial autosave preserves every known field and extension, updating only savedAt');
  assertExtensions();
  qa.click('1세트 완료'); qa.click('힘듦'); await qa.settle();
  assertExtensions(); assert.equal(qa.draft().mode, 'summary'); assert.equal(qa.draft().difficulty, 'hard');
  assert.equal(qa.draft().exerciseRecords[0].status, 'completed'); assert.equal(qa.draft().exerciseRecords[0].sets[0].completed, true);
  b.checkpoint(); b.win.dispatchEvent({ type: 'pagehide' }); await qa.settle(); assertExtensions();
  await qa.click('기록 저장하고 종료'); await qa.settle();
  const result = JSON.parse(JSON.stringify(received));
  assert.deepEqual(result.exerciseRecords[0].futureExerciseExtension, exerciseExtension);
  assert.deepEqual(result.exerciseRecords[0].sets[0].futureSetExtension, setExtension);
  assert.deepEqual(result.exerciseRecords[0].executionContext, executionContext);
  assert.equal(finishes, 1); assert.equal(closes, 1); assert.equal(b.local.getItem(qa.draftKey), null);
});
