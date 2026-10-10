import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as transactions from '../app/data/storageTransaction.ts';
import * as updates from '../app/data/fitnessStorageUpdates.ts';
import * as recovery from '../app/data/recoveryMode.ts';
import * as foam from '../app/data/foamRoller.ts';
import * as workouts from '../app/data/workoutCompletion.ts';
import * as dietPlans from '../app/data/dietPlans.ts';
import * as methods from '../app/data/workoutMethods.ts';
import { installStorageLocks, preparedStorageSeed } from './helpers/storageProtocol.ts';

type ElementNode = { type: unknown; props: Record<string, unknown> };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const textOf = (node: unknown): string => Array.isArray(node) ? node.map(textOf).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' && 'props' in node ? textOf((node as ElementNode).props.children) : '';
const nodes = (node: unknown): ElementNode[] => Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== 'object' || !('props' in node) ? [] : [node as ElementNode, ...nodes((node as ElementNode).props.children)];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function environment() {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const locks = installStorageLocks();
  const values = new Map(Object.entries(preparedStorageSeed('owner-A')));
  const localStorage = { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const win = Object.assign(new EventTarget(), { localStorage, PushManager: class {}, atob: globalThis.atob });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  return { win, localStorage, locks, switchOwner(user = 'owner-B') { for (const [key, value] of Object.entries(preparedStorageSeed(user))) values.set(key, value); }, dispose() { locks.restore(); if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window'); } };
}
function load(path: string, modules: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const result: Record<string, unknown> = {};
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, { Date, console, Event, Error, Intl, Uint8Array, crypto, window: globalThis.window, navigator: globalThis.navigator, ...globals })(result, (name: string) => { assert.ok(name in modules, `Unexpected import ${name}`); return modules[name]; });
  return result;
}
function notificationFixture() {
  const browser = environment();
  let writes = 0, unsubscribes = 0;
  const filters: [string, unknown][] = [];
  const subscription = { endpoint: 'synthetic-endpoint', toJSON: () => ({ endpoint: 'synthetic-endpoint', keys: { p256dh: 'public-fixture', auth: 'synthetic-fixture' } }), unsubscribe: async () => { unsubscribes++; } };
  const registration = { pushManager: { getSubscription: async () => subscription, subscribe: async () => subscription } };
  const serviceWorker = { ready: Promise.resolve(registration) };
  Object.assign(navigator, { serviceWorker });
  const query = { eq(key: string, value: unknown) { filters.push([key, value]); return query; }, then(resolve: (value: unknown) => unknown) { return Promise.resolve({ error: null }).then(resolve); } };
  const supabase = { auth: { getUser: async () => ({ data: { user: { id: 'owner-A' } } }) }, from() { return { upsert() { writes++; return Promise.resolve({ error: null }); }, update() { writes++; return query; }, delete() { writes++; return query; } }; } };
  const notification = load('../app/lib/workoutNotifications.ts', { '../data/storageTransaction': transactions, '../data/fitnessStorageUpdates': updates, './supabase': { supabase } }) as typeof import('../app/lib/workoutNotifications.ts');
  return { ...browser, notification, supabase, serviceWorker, registration, subscription, filters, writes: () => writes, unsubscribes: () => unsubscribes };
}

for (const boundary of ['auth', 'worker', 'subscription']) test(`notification enable rejects owner switch during ${boundary} await before server write`, async t => {
  const fixture = notificationFixture(); t.after(fixture.dispose);
  const owner = transactions.captureStorageOwner();
  const gate = deferred<void>();
  if (boundary === 'auth') fixture.supabase.auth.getUser = async () => { await gate.promise; return { data: { user: { id: 'owner-A' } } }; };
  if (boundary === 'worker') fixture.serviceWorker.ready = gate.promise.then(() => fixture.registration);
  if (boundary === 'subscription') fixture.registration.pushManager.getSubscription = async () => { await gate.promise; return fixture.subscription; };
  const promise = fixture.notification.enableServerPush(fixture.notification.DEFAULT_WORKOUT_NOTIFICATION_SETTINGS, owner);
  await tick(); fixture.switchOwner(); gate.resolve();
  await assert.rejects(promise, /계정/); assert.equal(fixture.writes(), 0); assert.equal(fixture.unsubscribes(), 0);
});
for (const action of ['update', 'disable']) test(`notification ${action} fences resumed subscription lookup and scopes writes to original owner`, async t => {
  const fixture = notificationFixture(); t.after(fixture.dispose);
  const owner = transactions.captureStorageOwner();
  if (action === 'update') await fixture.notification.updateServerPushSettings({ ...fixture.notification.DEFAULT_WORKOUT_NOTIFICATION_SETTINGS, serverPushActive: true }, owner);
  else await fixture.notification.disableServerPush(owner);
  assert.ok(fixture.filters.some(([key, value]) => key === 'user_id' && value === 'owner-A'));
  const priorWrites = fixture.writes(), gate = deferred<void>();
  fixture.registration.pushManager.getSubscription = async () => { await gate.promise; return fixture.subscription; };
  const pending = action === 'update' ? fixture.notification.updateServerPushSettings({ ...fixture.notification.DEFAULT_WORKOUT_NOTIFICATION_SETTINGS, serverPushActive: true }, owner) : fixture.notification.disableServerPush(owner);
  await tick(); fixture.switchOwner(); gate.resolve(); await assert.rejects(pending, /계정/);
  assert.equal(fixture.writes(), priorWrites);
});

test('notification setting queued under A never publishes A input under newly ready B', async t => {
  const fixture = notificationFixture(); t.after(fixture.dispose);
  const owner = transactions.captureStorageOwner();
  const gate = deferred<void>();
  const blocker = fixture.locks.locks.request(transactions.STORAGE_LOCK_NAME, {}, () => gate.promise);
  const pending = fixture.notification.saveWorkoutNotificationSettings({ time: '08:30' }, owner);
  fixture.switchOwner(); gate.resolve(); await blocker; await assert.rejects(pending, /계정/);
  assert.equal(fixture.localStorage.getItem(fixture.notification.WORKOUT_NOTIFICATION_SETTINGS_KEY), null);
});

function mount(path: string, modules: Record<string, unknown>, initialProps: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const slots: unknown[] = [], effects: (() => void)[] = [];
  let cursor = 0, changed = false, props = initialProps;
  const react = {
    useState(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (next: unknown) => { const value = typeof next === 'function' ? next(slots[index]) : next; if (!Object.is(value, slots[index])) { slots[index] = value; changed = true; } }]; },
    useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useMemo(factory: () => unknown, deps: unknown[]) { const index = cursor++, old = slots[index] as { deps: unknown[]; value: unknown } | undefined; if (!old || deps.some((v, i) => v !== old.deps[i]) || old.deps.length !== deps.length) slots[index] = { deps, value: factory() }; return (slots[index] as { value: unknown }).value; },
    useEffect(effect: () => void, deps: unknown[]) { const index = cursor++, old = slots[index] as unknown[] | undefined; if (!old || old.length !== deps.length || deps.some((v, i) => v !== old[i])) { slots[index] = deps; effects.push(effect); } },
  };
  const loaded = load(path, { react, 'react/jsx-runtime': { jsx: (type: unknown, props: ElementNode['props']) => ({ type, props }), jsxs: (type: unknown, props: ElementNode['props']) => ({ type, props }) }, ...modules }, globals);
  const render = () => { let tree!: ElementNode, rounds = 0; do { assert.ok(++rounds < 20); changed = false; cursor = 0; tree = (loaded.default as (props: Record<string, unknown>) => ElementNode)(props); effects.splice(0).forEach(effect => effect()); } while (changed); return tree; };
  function find(predicate: (node: ElementNode) => boolean) { const found = nodes(render()).filter(predicate); assert.equal(found.length, 1); return found[0]; }
  const click = (label: string) => (find(node => node.type === 'button' && textOf(node) === label).props.onClick as () => unknown)();
  const change = (placeholder: string, value: string) => {
    const root = render();
    const visit = (tree: unknown, ancestors: ElementNode[] = []): boolean => {
      if (Array.isArray(tree)) return tree.some(child => visit(child, ancestors));
      if (!tree || typeof tree !== 'object' || !('props' in tree)) return false;
      const node = tree as ElementNode;
      if (node.props.placeholder === placeholder) { for (const parent of ancestors) if (parent.props.onChangeCapture) (parent.props.onChangeCapture as () => void)(); (node.props.onChange as (event: unknown) => void)({ target: { value } }); return true; }
      return visit(node.props.children, [...ancestors, node]);
    };
    assert.ok(visit(root)); render();
  };
  render();
  return { click, change, render, text: () => textOf(render()), value: (placeholder: string) => find(node => node.props.placeholder === placeholder).props.value, props(next: Record<string, unknown>) { props = { ...props, ...next }; render(); } };
}

test('permission response cannot enable push for a replacement account', async t => {
  const fixture = notificationFixture(); t.after(fixture.dispose);
  const gate = deferred<NotificationPermission>();
  class SyntheticNotification { static permission = 'default'; static requestPermission = () => gate.promise; }
  Object.assign(fixture.win, { Notification: SyntheticNotification });
  const ui = mount('../app/components/WorkoutNotificationPanel.tsx', { '../data/fitnessStorageUpdates': updates, '../lib/workoutNotifications': { ...fixture.notification, notificationSupportState: () => 'default' } }, {}, { Notification: SyntheticNotification });
  ui.click('알림 켜기'); fixture.switchOwner(); gate.resolve('granted'); await tick();
  assert.equal(fixture.writes(), 0); assert.equal(fixture.localStorage.getItem(fixture.notification.WORKOUT_NOTIFICATION_SETTINGS_KEY), null); assert.match(ui.text(), /계정/);
});

function dayView(props: Record<string, unknown>) {
  const children = Object.fromEntries(['FlowDiagram', 'PhaseSection', 'ExerciseCard', 'WorkoutSession', 'DailyExerciseChecklist'].map(name => [`./${name}`, { default: function Child() {} }]));
  return mount('../app/components/DayView.tsx', {
    '@/components/useUnsavedChanges': { useUnsavedChanges() {} }, '../data/workouts': { COMMON_INTENSITY: [], SAFETY_STOP_MESSAGE: 'stop' },
    '../data/foamRoller': foam, '../data/recoveryMode': recovery, '../data/workoutCompletion': workouts, '../data/workoutMethods': methods, ...children,
  }, { day: { id: 'sat', title: 'Synthetic workout', tabLabel: 'Saturday', totalTime: '10 min', phases: [] }, isCompleted: false, onSaveWorkout: async () => {}, onCancelWorkout: async () => {},
    recovery: { recoveryMode: false, reasons: [], intensity: 'normal' }, onSaveCardio: async () => {}, onCancelCardio: async () => {}, onSaveFoamRoller: async () => {}, onCancelFoamRoller: async () => {}, onRecordRecovery: async () => {}, ...props });
}
for (const kind of ['cardio', 'foam', 'recovery']) test(`DayView queued ${kind} save preserves post-click input when saved props refresh`, async t => {
  const fixture = environment(); t.after(fixture.dispose);
  const gate = deferred<void>();
  const action = kind === 'cardio' ? 'onSaveCardio' : kind === 'foam' ? 'onSaveFoamRoller' : 'onRecordRecovery';
  const placeholder = kind === 'cardio' ? '운동 느낌 입력' : kind === 'foam' ? '폼롤러 느낌 입력' : '상태 입력';
  const button = kind === 'cardio' ? '유산소 완료로 기록' : kind === 'foam' ? '폼롤러 완료로 기록' : '회복 우선으로 기록';
  const ui = dayView({ [action]: () => gate.promise });
  ui.change(placeholder, 'saved revision'); ui.click(button); ui.change(placeholder, 'newer unsaved revision');
  const prop = kind === 'cardio' ? { cardioMemo: 'saved revision' } : kind === 'foam' ? { foamRollerMemo: 'saved revision' } : { recovery: { recoveryMode: true, reasons: [], intensity: '70%', recoveryMemo: 'saved revision' } };
  ui.props(prop); gate.resolve(); await tick(); ui.props({ ...prop });
  assert.equal(ui.value(placeholder), 'newer unsaved revision');
  // Saving the independent main workout must not clear a secondary editor's dirty guard.
  await ui.click('운동 기록 저장하기'); ui.props(kind === 'cardio' ? { cardioMemo: 'peer' } : kind === 'foam' ? { foamRollerMemo: 'peer' } : { recovery: { recoveryMode: true, reasons: [], intensity: '70%', recoveryMemo: 'peer' } });
  assert.equal(ui.value(placeholder), 'newer unsaved revision');
});

for (const fails of [false, true]) test(`notification sent claim ${fails ? 'releases after display failure' : 'excludes a second participating manager'}`, async t => {
  const fixture = notificationFixture(); t.after(fixture.dispose);
  let displays = 0;
  class SyntheticNotification { static permission = 'granted'; constructor() { displays++; if (fails) throw Error('synthetic display failure'); } }
  Object.assign(fixture.win, { Notification: SyntheticNotification, setInterval: () => 1, clearInterval() {} });
  const now = new Date(), time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  fixture.localStorage.setItem(fixture.notification.WORKOUT_NOTIFICATION_SETTINGS_KEY, JSON.stringify({ ...fixture.notification.DEFAULT_WORKOUT_NOTIFICATION_SETTINGS, enabled: true, days: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], time, incompleteReminder: false }));
  const modules = { '../data/storageTransaction': transactions, '../data/fitnessStorageUpdates': updates, '../data/dietPlans': dietPlans, '../data/workoutCompletion': workouts, '../lib/workoutNotifications': fixture.notification };
  const ui = mount('../app/components/WorkoutNotificationManager.tsx', modules, {}, { Notification: SyntheticNotification });
  if (!fails) mount('../app/components/WorkoutNotificationManager.tsx', modules, {}, { Notification: SyntheticNotification });
  await tick();
  const sent = JSON.parse(fixture.localStorage.getItem('ai-fitness-workout-notifications-sent-v1') ?? '{}');
  assert.equal(displays, 1);
  if (fails) { assert.deepEqual(sent, {}); assert.match(ui.text(), /synthetic display failure/); }
  else assert.deepEqual(Object.values(sent), [true]);
});

test('notification manager checks owner again between claim completion and display continuation', async t => {
  const fixture = notificationFixture(); t.after(fixture.dispose);
  let displays = 0;
  class SyntheticNotification { static permission = 'granted'; constructor() { displays++; } }
  Object.assign(fixture.win, { Notification: SyntheticNotification, setInterval: () => 1, clearInterval() {} });
  const now = new Date(), time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  fixture.localStorage.setItem(fixture.notification.WORKOUT_NOTIFICATION_SETTINGS_KEY, JSON.stringify({ ...fixture.notification.DEFAULT_WORKOUT_NOTIFICATION_SETTINGS, enabled: true, days: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], time, incompleteReminder: false }));
  let first = true;
  const wrapped = async (...args: Parameters<typeof updates.updateFitnessValues>) => {
    const result = await updates.updateFitnessValues(...args);
    if (first) { first = false; queueMicrotask(() => fixture.switchOwner()); }
    return result;
  };
  const ui = mount('../app/components/WorkoutNotificationManager.tsx', { '../data/storageTransaction': transactions, '../data/fitnessStorageUpdates': { ...updates, updateFitnessValues: wrapped }, '../data/dietPlans': dietPlans, '../data/workoutCompletion': workouts, '../lib/workoutNotifications': fixture.notification }, {}, { Notification: SyntheticNotification });
  await tick(); assert.equal(displays, 0); assert.match(ui.text(), /계정/);
});
