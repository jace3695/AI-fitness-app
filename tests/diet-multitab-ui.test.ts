import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as plans from '../app/data/dietPlans.ts';
import * as freeDiet from '../app/data/freeDietTools.ts';
import * as responses from '../app/data/dietSelfResponses.ts';
import * as photos from '../app/data/dietPhotoAnalysis.ts';
import * as patterns from '../app/data/dietPatterns.ts';
import * as transactions from '../app/data/storageTransaction.ts';
import * as resets from '../app/data/appRecordReset.ts';
import { applyFitnessEdits } from '../app/data/fitnessStorageUpdates.ts';
import { readJsonForUpdate } from '../app/data/recordStorage.ts';
import * as dietTime from '../lib/diet-time.ts';

type Node = { type: unknown; props: Record<string, unknown> };
type Listener = (event: { type: string; key?: string; storageArea?: unknown }) => void;
const day = '2026-10-09', owner = 'synthetic-owner', key = plans.DIET_COMPLETED_DAYS_KEY;
const original = { [key]: { '2001-01-02': { dietMemo: 'synthetic original' } } };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const textOf = (node: unknown): string => Array.isArray(node) ? node.map(textOf).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' && 'props' in node ? textOf((node as Node).props.children) : '';
const nodes = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== 'object' || !('props' in node) ? [] : [node as Node, ...nodes((node as Node).props.children)];
const sources = new Map<string, string>();
function source(path: string) {
  if (!sources.has(path)) sources.set(path, ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  return sources.get(path)!;
}
function sharedBrowser() {
  const values = new Map(Object.entries(original).map(([key, value]) => [key, JSON.stringify(value)]));
  values.set('fitness-cloud-sync-user', owner);
  let lockTail = Promise.resolve();
  const locks = { request(_name: string, _options: unknown, callback: () => unknown) {
    const work = lockTail.then(callback); lockTail = work.then(() => {}, () => {}); return work;
  } };
  let duringWrite: ((writer: string, key: string) => void) | undefined;
  const contexts = new Map<string, { dispatch: (event: { type: string; key?: string }) => void }>();
  const remote = { state: structuredClone(original) as Record<string, unknown>, revision: 1, writes: 0, reads: 0 };
  const local = (id: string) => ({
    get length() { return values.size; }, key(index: number) { return [...values.keys()][index] ?? null; }, getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); duringWrite?.(id, key); },
    removeItem(key: string) { values.delete(key); duringWrite?.(id, key); },
  });
  return { remote, local, values, contexts, locks,
    holdLock() { let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; }); lockTail = lockTail.then(() => hold); return release; }, interleave(callback?: typeof duringWrite) { duringWrite = callback; },
    read() { return JSON.parse(values.get(key) ?? '{}') as Record<string, Record<string, unknown>>; } };
}
// Runs the actual DietView and CloudSyncPanel handlers with shared synthetic
// storage and controlled event ordering. No DOM/browser/service is launched.
function tab(browser: ReturnType<typeof sharedBrowser>, id: string) {
  let nextRead: { promise: Promise<void>; release: () => void } | undefined;
  const local = browser.local(id), listeners = new Map<string, Set<Listener>>(), timers = new Map<number, () => void>();
  let timerId = 0;
  const win = {
    localStorage: local,
    addEventListener(name: string, callback: Listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(callback); },
    removeEventListener(name: string, callback: Listener) { listeners.get(name)?.delete(callback); },
    dispatchEvent(event: { type: string; key?: string }) { [...(listeners.get(event.type) ?? [])].forEach(callback => callback({ ...event, storageArea: local })); return true; },
    setInterval() { return ++timerId; }, clearInterval() {},
    setTimeout(callback: () => void) { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout(id: number) { timers.delete(id); },
  };
  browser.contexts.set(id, { dispatch: win.dispatchEvent });
  const Clock = new Proxy(Date, { construct(target, args) { return Reflect.construct(target, args.length ? args : [`${day}T12:00:00`]); } });
  const modules: Record<string, unknown> = {
    'react/jsx-runtime': { jsx: (type: unknown, props: Node['props']) => ({ type, props }), jsxs: (type: unknown, props: Node['props']) => ({ type, props }) },
    '../lib/supabase.ts': { supabase: null },
    '../lib/supabase': { isSupabaseConfigured: true, supabase: { auth: { async getUser() { return { data: { user: { id: owner, email: 'synthetic@example.test' } } }; }, onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } } } },
    '../lib/passwordPolicy': {}, '../lib/unsavedChanges': { requestSafeReload() {} },
    'next/image': { default: () => null }, '@/lib/diet-time': dietTime,
    '@/components/useUnsavedChanges': { useUnsavedChanges() {} }, '@/app/lib/authenticatedHeaders': {},
    '../data/recordStorage': { readJsonForUpdate },
    '../data/fitnessStorageUpdates': { applyFitnessEdits },
    '../data/dietPlans': { ...plans, getLocalDateKey: (date = new Clock()) => plans.getLocalDateKey(date) },
    '../data/freeDietTools': freeDiet, '../data/dietSelfResponses': responses, '../data/dietPhotoAnalysis': photos, '../data/dietPatterns': patterns,
    '../data/workouts': { SWITCHON_DEFAULT_START_DATE: '2026-08-24', SWITCHON_START_DATE_KEY: 'ai-fitness-switchon-start-date' },
  };
  for (const name of ['DietPatterns', 'DietWorkoutContext', 'WorkoutTimes', 'WorkoutTimeHistory', 'DietFavorites']) modules[`./${name}`] = { default: () => null };
  // Shipped modules share one browser realm. JSON transport explicitly bridges
  // host fixture values so the production plain-object validation stays strict.
  const context = vm.createContext({ Date: Clock, URL, console, AbortController, Event, CustomEvent, Error, crypto, queueMicrotask, navigator: { locks: browser.locks },
    window: win, document: { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' },
  });
  const fromJson = <T,>(value: T): T => vm.runInContext('JSON.parse', context)(JSON.stringify(value));
  const load = (path: string) => {
    const exports: Record<string, unknown> = {};
    vm.runInContext(`(function(exports, require) { ${source(path)}\n})`, context)(exports, (name: string) => {
      assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name];
    });
    return exports;
  };
  const localResets = load('../app/data/appRecordReset.ts') as typeof resets;
  modules['./appRecordReset.ts'] = localResets;
  modules['../data/appRecordReset'] = { ...localResets, isRecordResetRunning: () => false };
  const conflicts = load('../app/data/cloudSyncConflicts.ts');
  modules['./cloudSyncConflicts.ts'] = conflicts;
  modules['../data/cloudSyncConflicts'] = conflicts;
  const localTransactions = load('../app/data/storageTransaction.ts') as typeof transactions;
  modules['./storageTransaction.ts'] = localTransactions;
  modules['../data/storageTransaction'] = localTransactions;
  // The shared owner transition now composes the real pure language boundary.
  // Load it in this tab's realm so it uses the same transaction module/locks.
  modules['./languageStorageBoundary.ts'] = load('../app/data/languageStorageBoundary.ts');
  const cloud = load('../app/data/cloudSync.ts') as typeof import('../app/data/cloudSync.ts');
  modules['../data/cloudSync'] = { ...cloud,
    async getRemoteState() { browser.remote.reads++; const result = { state: structuredClone(browser.remote.state), updated_at: String(browser.remote.revision) }; const hold = nextRead; nextRead = undefined; if (hold) await hold.promise; return fromJson(result); },
    async saveRemoteState(_owner: string, state: Record<string, unknown>) { browser.remote.state = structuredClone(state); browser.remote.revision++; browser.remote.writes++; },
    async saveRemoteStateIfUnchanged(_owner: string, state: Record<string, unknown>, revision: string, signal?: AbortSignal, expectedState?: Record<string, unknown>) {
      signal?.throwIfAborted();
      assert.equal(_owner, owner); assert.ok(expectedState, 'The adapter requires exact-content CAS evidence');
      if (revision !== String(browser.remote.revision) || cloud.stableState(expectedState) !== cloud.stableState(browser.remote.state)) return false;
      browser.remote.state = structuredClone(state); browser.remote.revision++; browser.remote.writes++; return true;
    },
  };
  function mount(path: string) {
    const slots: unknown[] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = []; let cursor = 0, changed = false;
    modules.react = {
      useState(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial; return [slots[slot], (update: unknown) => { const next = typeof update === 'function' ? update(slots[slot]) : update; if (!Object.is(slots[slot], next)) { slots[slot] = next; changed = true; } }]; },
      useRef(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
      useMemo(factory: () => unknown, deps: unknown[]) { const slot = cursor++, old = slots[slot] as { deps: unknown[]; value: unknown } | undefined; if (!old || old.deps.length !== deps.length || old.deps.some((value, index) => value !== deps[index])) slots[slot] = { deps, value: factory() }; return (slots[slot] as { value: unknown }).value; },
      useEffect(effect: () => void, deps?: unknown[]) { const slot = cursor++, old = slots[slot] as unknown[] | undefined; if (!deps || !old || old.length !== deps.length || old.some((value, index) => value !== deps[index])) { slots[slot] = deps; effects.push(() => { cleanups[slot]?.(); const cleanup = effect(); if (typeof cleanup === 'function') cleanups[slot] = cleanup; }); } },
    };
    if (path.endsWith('/CloudSyncPanel.tsx')) modules['./CloudSyncConflictReview'] = load('../app/components/CloudSyncConflictReview.tsx');
    const component = load(path).default as (props: object) => Node;
    const render = (): Node => { let result: Node, rounds = 0; do { assert.ok(rounds++ < 20); changed = false; cursor = 0; result = component({}); effects.splice(0).forEach(effect => effect()); } while (changed); return result; };
    render(); return { render, dispose() { cleanups.forEach(cleanup => cleanup?.()); } };
  }
  const diet = mount('../app/components/DietView.tsx'), sync = mount('../app/components/CloudSyncPanel.tsx');
  const select = (id: string) => { const found = nodes(diet.render()).find(node => node.type === 'select' && node.props.id === id); assert.ok(found); return found; };
  return { local, cloud, transactions: localTransactions, render: diet.render, status: () => textOf(sync.render()),
    holdNextRead() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); nextRead = { promise, release }; return release; },
    focus() { win.dispatchEvent({ type: 'focus' }); },
    change(id: string, value: string, flushRender = true) { const tree = diet.render(); const input = select(id); (tree.props.onChangeCapture as () => void)?.(); (input.props.onChange as (event: unknown) => void)({ target: { value } }); if (flushRender) diet.render(); },
    value(id: string) { return select(id).props.value; },
    async click(label: string) { const button = nodes(diet.render()).find(node => node.type === 'button' && textOf(node) === label); assert.ok(button); (button.props.onClick as () => void)(); diet.render(); await tick(); diet.render(); },
    event(key: string) { win.dispatchEvent({ type: 'storage', key }); diet.render(); sync.render(); },
    async ready() { for (let i = 0; i < 5; i++) { await tick(); diet.render(); sync.render(); } assert.match(textOf(sync.render()), /서버 반영 완료/); },
    async sync() { for (let i = 0; i < 5; i++) { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } await tick(); diet.render(); sync.render(); } },
    dispose() { diet.dispose(); sync.dispose(); browser.contexts.delete(id); },
  };
}

test('shipping dirty diet and cloud reader cannot roll back a peer diet save halfway through its storage batch', async t => {
  const shared = sharedBrowser(), a = tab(shared, 'A'); t.after(a.dispose); await a.ready();
  const b = tab(shared, 'B'); t.after(b.dispose); await b.ready();
  a.change('diet-hunger', 'yes');
  b.change('diet-bingeUrge', 'no'); b.change('diet-preSleepOvereating', 'yes');
  b.change('diet-digestion', 'diarrhea'); b.change('late-snack', 'yes'); b.change('after-workout-meal', 'no');
  let interleaved = false;
  shared.interleave((writer, changedKey) => {
    if (writer === 'B' && changedKey === key && !interleaved) { interleaved = true; a.event(changedKey); }
  });
  await b.click('오늘 식단 저장'); shared.interleave();
  assert.equal(interleaved, true);
  assert.equal(a.value('diet-hunger'), 'yes', 'Unsaved first-tab response remains visible');
  assert.deepEqual(responses.readDietSelfResponses(shared.read()[day]), { hunger: 'unrecorded', bingeUrge: 'no', preSleepOvereating: 'yes' });
  assert.equal(shared.read()[day].digestionStatus, 'diarrhea');
  await b.sync(); assert.deepEqual(original[key]['2001-01-02'], shared.read()['2001-01-02']);
  assert.deepEqual(responses.readDietSelfResponses((shared.remote.state[key] as Record<string, unknown>)[day]), { hunger: 'unrecorded', bingeUrge: 'no', preSleepOvereating: 'yes' });
});

for (const releaseWhileWriting of [true, false]) test(`shipping cloud sync defers an in-flight read and wakes on journal removal (${releaseWhileWriting ? 'before' : 'after'} commit)`, async t => {
  const shared = sharedBrowser(), a = tab(shared, 'A'); t.after(a.dispose); await a.ready();
  const base = a.local.getItem(`fitness-cloud-sync-base:${owner}`);
  const release = a.holdNextRead(); a.focus();
  const reads = shared.remote.reads, writes = shared.remote.writes;
  const previous = a.local.getItem(key);
  const newer = { ...original[key], [day]: { hunger: 'yes', bingeUrge: 'no' } };
  shared.values.set(transactions.STORAGE_JOURNAL_KEY, JSON.stringify({ [key]: previous }));
  shared.values.set(key, JSON.stringify(newer)); a.event(key);
  if (releaseWhileWriting) { release(); await a.sync(); }
  assert.equal(a.cloud.readLocalCloudState()[key] && JSON.stringify(a.cloud.readLocalCloudState()[key]), JSON.stringify(original[key]));
  assert.equal(a.local.getItem(`fitness-cloud-sync-base:${owner}`), base, 'No stale read advances the acknowledged base');
  assert.equal(shared.remote.reads, reads); assert.equal(shared.remote.writes, writes);
  assert.match(a.status(), /기기 기록 · 서버 반영 대기/); assert.doesNotMatch(a.status(), /서버 반영 완료/);
  // Model the real writer's commit boundary, then its storage removal event.
  shared.values.set(transactions.STORAGE_GENERATION_KEY, crypto.randomUUID());
  shared.values.delete(transactions.STORAGE_JOURNAL_KEY); a.event(transactions.STORAGE_JOURNAL_KEY);
  if (!releaseWhileWriting) release();
  await a.sync();
  assert.deepEqual(shared.remote.state[key], newer);
  assert.match(a.status(), /서버 반영 완료/);
});

test('queued diet save reads latest stores and preserves a newer unsaved editor revision', async t => {
  const shared = sharedBrowser(), a = tab(shared, 'A'); t.after(a.dispose); await a.ready();
  const release = shared.holdLock();
  const peer = a.transactions.updateStorageBatch(a.local, snapshot => ({
    [key]: JSON.stringify({ ...JSON.parse(snapshot.getItem(key) ?? '{}'), '2002-02-02': { dietMemo: 'peer after hydration', unusualField: 7 } }),
  }));
  a.change('diet-hunger', 'yes');
  await a.click('오늘 식단 저장');
  assert.equal(shared.read()[day], undefined, 'No premature local commit while the lock is held');
  assert.doesNotMatch(textOf(a.render()), /오늘 식단 기록을 저장했습니다/);
  a.change('diet-hunger', 'no');
  release(); await peer; await tick(); a.render();
  assert.equal(shared.read()['2002-02-02'].dietMemo, 'peer after hydration');
  assert.equal(shared.read()[day].hunger, 'yes', 'The clicked revision, not the newer editor, was saved');
  assert.equal(a.value('diet-hunger'), 'no');
  assert.match(textOf(a.render()), /이후 작성한 내용은 아직 저장되지 않았습니다/);
  await a.click('오늘 식단 저장');
  assert.equal(shared.read()[day].hunger, 'no');
  assert.equal(a.value('diet-hunger'), 'no');
});

test('two shipping diet editors merge frozen same-day hunger and water while retaining a newer unsaved response', async t => {
  const shared = sharedBrowser(), a = tab(shared, 'A'); t.after(a.dispose); await a.ready();
  const b = tab(shared, 'B'); t.after(b.dispose); await b.ready();
  a.change('diet-hunger', 'yes'); await b.click('+500mL');
  assert.equal(a.value('diet-hunger'), 'yes'); assert.match(textOf(b.render()), /500mL/);
  const release = shared.holdLock();
  await a.click('오늘 식단 저장'); await b.click('오늘 식단 저장');
  assert.equal(shared.read()[day], undefined, 'Both saves remain queued behind the same lock');
  a.change('diet-hunger', 'no');
  release(); await tick(); a.render(); b.render();
  assert.equal(shared.read()[day].hunger, 'yes', 'The frozen first response is retained after the peer save');
  assert.equal(shared.read()[day].waterMl, 500, 'The independent peer water edit survives');
  assert.equal(a.value('diet-hunger'), 'no', 'The newer input is still visible and unsaved');
  assert.match(textOf(a.render()), /이후 작성한 내용은 아직 저장되지 않았습니다/);
  await a.click('오늘 식단 저장');
  assert.equal(shared.read()[day].hunger, 'no'); assert.equal(shared.read()[day].waterMl, 500);
  await a.sync(); await b.sync();
  const committed = (shared.remote.state[key] as Record<string, Record<string, unknown>>)[day];
  assert.equal(committed.hunger, 'no'); assert.equal(committed.waterMl, 500);
  assert.deepEqual(shared.read()['2001-01-02'], original[key]['2001-01-02']);
});

test('an old mounted diet editor cannot adopt a newly ready different owner at save time', async t => {
  const shared = sharedBrowser(), a = tab(shared, 'A'); t.after(a.dispose); await a.ready();
  a.change('diet-hunger', 'yes');
  await a.cloud.prepareLocalCloudState('other-owner');
  await a.click('오늘 식단 저장');
  assert.equal(Object.keys(a.cloud.readLocalCloudState()).length, 0);
  assert.equal(a.value('diet-hunger'), 'yes', 'The old unsaved editor remains unacknowledged');
  assert.match(textOf(a.render()), /기기에 저장하지 못했어요/);
  assert.doesNotMatch(textOf(a.render()), /오늘 식단 기록을 저장했습니다/);
});

test('A to B to A fencing rejects a diet save queued under the original A epoch', async t => {
  const shared = sharedBrowser(), a = tab(shared, 'A'); t.after(a.dispose); await a.ready();
  const epoch = a.cloud.readCloudSyncEpoch();
  a.change('diet-hunger', 'yes');
  const release = shared.holdLock();
  await a.click('오늘 식단 저장');
  const b = a.cloud.prepareLocalCloudState('other-owner').catch(error => error);
  const back = a.cloud.prepareLocalCloudState(owner);
  assert.notEqual(a.cloud.readCloudSyncEpoch(), epoch);
  release(); await b; await back; await tick(); a.render();
  assert.equal(shared.read()[day], undefined);
  assert.equal(a.value('diet-hunger'), 'yes');
  assert.match(textOf(a.render()), /기기에 저장하지 못했어요/);
});

test('corrupt records block a diet mutation without silently replacing the unreadable map', async t => {
  const shared = sharedBrowser(), a = tab(shared, 'A'); t.after(a.dispose); await a.ready();
  a.change('diet-hunger', 'yes');
  shared.values.set(key, '{synthetic invalid JSON');
  const before = [...shared.values];
  await a.click('오늘 식단 저장');
  assert.deepEqual([...shared.values], before);
  assert.equal(a.value('diet-hunger'), 'yes');
  assert.match(textOf(a.render()), /기기에 저장하지 못했어요/);
});

test('a remote-only response preserves a local edit committed after its coherent request snapshot', async t => {
  const shared = sharedBrowser(), a = tab(shared, 'A'); t.after(a.dispose); await a.ready();
  const remote = { ...original[key], '2003-03-03': { dietMemo: 'remote-only update' } };
  shared.remote.state[key] = remote; shared.remote.revision++;
  const release = a.holdNextRead(); a.focus();
  a.change('diet-hunger', 'yes'); await a.click('오늘 식단 저장');
  release(); await tick(); a.render();
  assert.equal(shared.read()[day].hunger, 'yes');
  assert.equal(shared.read()['2003-03-03'].dietMemo, 'remote-only update');
  assert.match(a.status(), /서버 반영 대기/);
  await a.sync();
  assert.equal((shared.remote.state[key] as Record<string, Record<string, unknown>>)[day].hunger, 'yes');
  assert.match(a.status(), /서버 반영 완료/);
});

test('queued diet reset keeps input typed afterward and removes only today from latest stores', async t => {
  const shared = sharedBrowser(), a = tab(shared, 'A'); t.after(a.dispose); await a.ready();
  a.change('diet-hunger', 'yes'); await a.click('오늘 식단 저장');
  const release = shared.holdLock();
  const peer = a.transactions.updateStorageBatch(a.local, snapshot => ({
    [key]: JSON.stringify({ ...JSON.parse(snapshot.getItem(key) ?? '{}'), '2004-04-04': { dietMemo: 'peer during reset wait' } }),
  }));
  await a.click('오늘 기록 초기화');
  a.change('diet-hunger', 'no');
  assert.equal(shared.read()[day].hunger, 'yes');
  release(); await peer; await tick(); a.render();
  assert.equal(shared.read()[day], undefined);
  assert.equal(shared.read()['2004-04-04'].dietMemo, 'peer during reset wait');
  assert.equal(a.value('diet-hunger'), 'no');
  assert.match(textOf(a.render()), /이후 작성한 내용은 그대로 남아 있습니다/);
  await a.click('오늘 식단 저장');
  assert.equal(shared.read()[day].hunger, 'no');
});

test('saving one diet answer preserves peer edits to untouched fields on the same day', async t => {
  const shared = sharedBrowser(), a = tab(shared, 'A'); t.after(a.dispose); await a.ready();
  a.change('diet-hunger', 'yes');
  const release = shared.holdLock();
  const peer = a.transactions.updateStorageBatch(a.local, snapshot => ({
    [key]: JSON.stringify({ ...JSON.parse(snapshot.getItem(key) ?? '{}'), [day]: { waterMl: 1500, dietMemo: 'peer memo', originalField: true } }),
    [plans.WATER_INTAKE_KEY]: JSON.stringify({ [day]: 1500 }),
    [plans.DIET_MEAL_LOG_KEY]: JSON.stringify({ [day]: { ...plans.DEFAULT_MEAL_LOG, breakfastShake: 'full', lunchProteinChoice: '25' } }),
  }));
  await a.click('오늘 식단 저장'); release(); await peer; await tick(); a.render();
  assert.equal(shared.read()[day].hunger, 'yes');
  assert.equal(shared.read()[day].dietMemo, 'peer memo');
  assert.equal(shared.read()[day].waterMl, 1500);
  assert.equal(shared.read()[day].originalField, true);
  assert.equal(JSON.parse(a.local.getItem(plans.WATER_INTAKE_KEY)!)[day], 1500);
  assert.equal(JSON.parse(a.local.getItem(plans.DIET_MEAL_LOG_KEY)!)[day].lunchProteinChoice, '25');
  assert.equal(shared.read()[day].proteinTotal, 56, 'Derived protein uses the merged committed meal');
});

test('input captured before its React render cannot be cleared by a resolving diet save', async t => {
  const shared = sharedBrowser(), a = tab(shared, 'A'); t.after(a.dispose); await a.ready();
  a.change('diet-hunger', 'yes');
  const release = shared.holdLock(); await a.click('오늘 식단 저장');
  a.change('diet-hunger', 'no', false); // state queued; effects deliberately have not run
  release(); await tick(); a.render();
  assert.equal(shared.read()[day].hunger, 'yes');
  assert.equal(a.value('diet-hunger'), 'no');
  assert.match(textOf(a.render()), /이후 작성한 내용은 아직 저장되지 않았습니다/);
  await a.click('오늘 식단 저장');
  assert.equal(shared.read()[day].hunger, 'no', 'The newer self-response edit flag was not cleared');
});
