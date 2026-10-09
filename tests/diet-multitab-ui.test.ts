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
  let duringWrite: ((writer: string, key: string) => void) | undefined;
  const contexts = new Map<string, { dispatch: (event: { type: string; key?: string }) => void }>();
  const remote = { state: structuredClone(original) as Record<string, unknown>, revision: 1, writes: 0, reads: 0 };
  const local = (id: string) => ({
    get length() { return values.size; }, key(index: number) { return [...values.keys()][index] ?? null; }, getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); duringWrite?.(id, key); },
    removeItem(key: string) { values.delete(key); duringWrite?.(id, key); },
  });
  return { remote, local, values, contexts, interleave(callback?: typeof duringWrite) { duringWrite = callback; },
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
    '../lib/supabase.ts': { supabase: null }, '../data/appRecordReset': { ...resets, isRecordResetRunning: () => false }, './appRecordReset.ts': resets,
    '../lib/supabase': { isSupabaseConfigured: true, supabase: { auth: { async getUser() { return { data: { user: { id: owner, email: 'synthetic@example.test' } } }; }, onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } } } },
    '../lib/passwordPolicy': {}, '../lib/unsavedChanges': { requestSafeReload() {} },
    './storageTransaction.ts': transactions,
    '../data/storageTransaction': { ...transactions, notifyRecordsChanged() { queueMicrotask(() => win.dispatchEvent({ type: transactions.RECORDS_CHANGED_EVENT })); } },
    'next/image': { default: () => null }, '@/lib/diet-time': dietTime,
    '@/components/useUnsavedChanges': { useUnsavedChanges() {} }, '@/app/lib/authenticatedHeaders': {},
    '../data/dietPlans': { ...plans, getLocalDateKey: (date = new Clock()) => plans.getLocalDateKey(date) },
    '../data/freeDietTools': freeDiet, '../data/dietSelfResponses': responses, '../data/dietPhotoAnalysis': photos, '../data/dietPatterns': patterns,
    '../data/workouts': { SWITCHON_DEFAULT_START_DATE: '2026-08-24', SWITCHON_START_DATE_KEY: 'ai-fitness-switchon-start-date' },
  };
  for (const name of ['DietPatterns', 'DietWorkoutContext', 'WorkoutTimes', 'WorkoutTimeHistory', 'DietFavorites']) modules[`./${name}`] = { default: () => null };
  const load = (path: string) => {
    const exports: Record<string, unknown> = {};
    vm.runInNewContext(`(function(exports, require) { ${source(path)}\n})`, { Date: Clock, URL, console, AbortController, Event, queueMicrotask,
      window: win, document: { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' },
    })(exports, (name: string) => { assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name]; });
    return exports;
  };
  const cloud = load('../app/data/cloudSync.ts') as typeof import('../app/data/cloudSync.ts');
  modules['../data/cloudSync'] = { ...cloud,
    async getRemoteState() { browser.remote.reads++; const result = { state: structuredClone(browser.remote.state), updated_at: String(browser.remote.revision) }; const hold = nextRead; nextRead = undefined; if (hold) await hold.promise; return result; },
    async saveRemoteStateIfUnchanged(_owner: string, state: Record<string, unknown>, revision: string) {
      if (revision !== String(browser.remote.revision)) return false;
      browser.remote.state = structuredClone(state); browser.remote.revision++; browser.remote.writes++; return true;
    },
  };
  function mount(path: string) {
    const slots: unknown[] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = []; let cursor = 0, changed = false;
    modules.react = {
      useState(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial; return [slots[slot], (update: unknown) => { const next = typeof update === 'function' ? update(slots[slot]) : update; if (!Object.is(slots[slot], next)) { slots[slot] = next; changed = true; } }]; },
      useRef(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
      useMemo(factory: () => unknown, deps: unknown[]) { const slot = cursor++, old = slots[slot] as { deps: unknown[]; value: unknown } | undefined; if (!old || old.deps.length !== deps.length || old.deps.some((value, index) => value !== deps[index])) slots[slot] = { deps, value: factory() }; return (slots[slot] as { value: unknown }).value; },
      useEffect(effect: () => void, deps: unknown[]) { const slot = cursor++, old = slots[slot] as unknown[] | undefined; if (!old || old.length !== deps.length || old.some((value, index) => value !== deps[index])) { slots[slot] = deps; effects.push(() => { cleanups[slot]?.(); const cleanup = effect(); if (typeof cleanup === 'function') cleanups[slot] = cleanup; }); } },
    };
    const component = load(path).default as (props: object) => Node;
    const render = (): Node => { let result: Node, rounds = 0; do { assert.ok(rounds++ < 20); changed = false; cursor = 0; result = component({}); effects.splice(0).forEach(effect => effect()); } while (changed); return result; };
    render(); return { render, dispose() { cleanups.forEach(cleanup => cleanup?.()); } };
  }
  const diet = mount('../app/components/DietView.tsx'), sync = mount('../app/components/CloudSyncPanel.tsx');
  const select = (id: string) => { const found = nodes(diet.render()).find(node => node.type === 'select' && node.props.id === id); assert.ok(found); return found; };
  return { local, cloud, render: diet.render, status: () => textOf(sync.render()),
    holdNextRead() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); nextRead = { promise, release }; return release; },
    focus() { win.dispatchEvent({ type: 'focus' }); },
    change(id: string, value: string) { (select(id).props.onChange as (event: unknown) => void)({ target: { value } }); diet.render(); },
    value(id: string) { return select(id).props.value; },
    click(label: string) { const button = nodes(diet.render()).find(node => node.type === 'button' && textOf(node) === label); assert.ok(button); (button.props.onClick as () => void)(); diet.render(); },
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
  b.click('오늘 식단 저장'); shared.interleave();
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
