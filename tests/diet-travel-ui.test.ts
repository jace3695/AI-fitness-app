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
import { applyFitnessEdits } from '../app/data/fitnessStorageUpdates.ts';
import { readJsonForUpdate } from '../app/data/recordStorage.ts';
import * as dietTime from '../lib/diet-time.ts';

type Node = { type: unknown; props: Record<string, unknown> };
const socialKey = plans.SOCIAL_MEAL_MODE_KEY;
const source = ts.transpileModule(readFileSync(new URL('../app/components/DietView.tsx', import.meta.url), 'utf8') + '\nexport { getDateKeysInRange };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const textOf = (node: unknown): string => Array.isArray(node) ? node.map(textOf).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' && 'props' in node ? textOf((node as Node).props.children) : '';
const nodes = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== 'object' || !('props' in node) ? [] : [node as Node, ...nodes((node as Node).props.children)];
const baseline = {
  [plans.DIET_START_DATE_KEY]: '2026-08-24', [plans.DIET_MODE_KEY]: 'manual', [plans.DIET_PHASE_KEY]: 'week2',
  [plans.DIET_COMPLETED_DAYS_KEY]: { '2001-01-02': { dietMemo: 'synthetic original', hunger: 'yes' } },
  [socialKey]: { '2001-01-02': 'dinner', '2027-03-12': 'lunch' },
};
function storage(seed: Record<string, unknown> = baseline) {
  const values = new Map(Object.entries(seed).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
  const epoch = JSON.stringify({ version: 2, id: 'synthetic-session', userId: 'synthetic-owner' });
  values.set('fitness-cloud-sync-user', 'synthetic-owner');
  values.set('fitness-cloud-sync-epoch', epoch);
  values.set('fitness-cloud-sync-ready', JSON.stringify({ epoch, userId: 'synthetic-owner' }));
  let failNext = false;
  return { values, get length() { return values.size; }, key(index: number) { return [...values.keys()][index] ?? null; }, getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => { values.delete(key); },
    setItem(key: string, value: string) { if (failNext && key === socialKey) { failNext = false; throw Error('Synthetic storage quota failure'); } values.set(key, value); },
    failNext() { failNext = true; }, read: () => JSON.parse(values.get(socialKey) ?? '{}') as Record<string, plans.SocialMealMode>,
  };
}

// Executes the shipped component/handlers, date helper, hydration and minute
// timer with synthetic hook/storage boundaries. This is not browser, Auth, RLS,
// cross-device synchronization or visual acceptance; those have a separate spec.
function fixture(day = '2026-10-31', local = storage()) {
  const slots: unknown[] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [];
  const timers = new Map<number, () => void>(), listeners = new Map<string, Set<() => void>>();
  let cursor = 0, timerId = 0, changed = false, currentDay = day;
  const Clock = new Proxy(Date, { construct(target, args) { return Reflect.construct(target, args.length ? args : [`${currentDay}T12:00:00`]); } });
  const react = {
    useState(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial; return [slots[slot], (update: unknown) => { const next = typeof update === 'function' ? update(slots[slot]) : update; if (!Object.is(slots[slot], next)) { slots[slot] = next; changed = true; } }]; },
    useRef(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useMemo(factory: () => unknown, deps: unknown[]) { const slot = cursor++, old = slots[slot] as { deps: unknown[]; value: unknown } | undefined; if (!old || old.deps.length !== deps.length || old.deps.some((value, index) => value !== deps[index])) slots[slot] = { deps, value: factory() }; return (slots[slot] as { value: unknown }).value; },
    useEffect(effect: () => void, deps?: unknown[]) { const slot = cursor++, old = slots[slot] as unknown[] | undefined; if (!deps || !old || old.length !== deps.length || old.some((value, index) => value !== deps[index])) { slots[slot] = deps; effects.push(() => { cleanups[slot]?.(); const cleanup = effect(); if (typeof cleanup === 'function') cleanups[slot] = cleanup; }); } },
  };
  const modules: Record<string, unknown> = {
    react, 'react/jsx-runtime': { jsx: (type: unknown, props: Node['props']) => ({ type, props }), jsxs: (type: unknown, props: Node['props']) => ({ type, props }) },
    'next/image': { default: () => null }, '@/lib/diet-time': dietTime,
    '@/components/useUnsavedChanges': { useUnsavedChanges() {} }, '@/app/lib/authenticatedHeaders': {},
    '../data/recordStorage': { readJsonForUpdate },
    '../data/fitnessStorageUpdates': { applyFitnessEdits },
    '../data/dietPlans': { ...plans, getLocalDateKey: (date = new Clock()) => plans.getLocalDateKey(date) },
    '../data/freeDietTools': freeDiet, '../data/dietSelfResponses': responses, '../data/dietPhotoAnalysis': photos, '../data/dietPatterns': patterns,
    '../data/workouts': { SWITCHON_DEFAULT_START_DATE: '2026-08-24', SWITCHON_START_DATE_KEY: 'ai-fitness-switchon-start-date' },
  };
  for (const name of ['DietPatterns', 'DietWorkoutContext', 'WorkoutTimes', 'WorkoutTimeHistory', 'DietFavorites']) modules[`./${name}`] = { default: () => null };
  const win = { localStorage: local, setInterval(fn: () => void) { const id = ++timerId; timers.set(id, fn); return id; }, clearInterval(id: number) { timers.delete(id); },
    dispatchEvent(event: { type: string }) { listeners.get(event.type)?.forEach(fn => fn()); return true; },
    addEventListener(name: string, fn: () => void) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); }, removeEventListener(name: string, fn: () => void) { listeners.get(name)?.delete(fn); } };
  let lockTail = Promise.resolve();
  const locks = { request(_name: string, _options: unknown, callback: () => void) { const work = lockTail.then(callback); lockTail = work.catch(() => {}); return work; } };
  const context = { Date: Clock, URL, console, crypto, Event, Error, queueMicrotask, navigator: { locks }, window: win };
  const transactions: Record<string, unknown> = {};
  const transactionSource = ts.transpileModule(readFileSync(new URL('../app/data/storageTransaction.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(`(function(exports) { ${transactionSource}\n})`, context)(transactions);
  modules['../data/storageTransaction'] = transactions;
  const exports = {} as { default: () => Node; getDateKeysInRange: (start: string, end: string) => string[] };
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, context)(exports, (name: string) => { assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name]; });
  const render = (): Node => {
    let result: Node, rounds = 0;
    do { assert.ok(rounds++ < 20, 'Component settled'); changed = false; cursor = 0; result = exports.default(); effects.splice(0).forEach(effect => effect()); } while (changed);
    return result;
  };
  const button = (label: string, root = render()) => { const found = nodes(root).filter(node => node.type === 'button' && textOf(node) === label); assert.equal(found.length, 1, `Unique button: ${label}`); return found[0]; };
  const changeDate = (label: string, value: string) => { const parent = nodes(render()).find(node => node.type === 'label' && textOf(node) === label)!; assert.ok(parent, `Date label: ${label}`); const input = nodes(parent).find(node => node.type === 'input')!; (input.props.onChange as (event: unknown) => void)({ target: { value } }); render(); };
  const settle = async () => { for (let i = 0; i < 4; i++) { await new Promise<void>(resolve => setImmediate(resolve)); render(); } };
  const click = async (label: string) => { (button(label).props.onClick as () => void)(); render(); await settle(); };
  render();
  return { render, local, click, changeDate, range: (start: string, end: string) => Array.from(exports.getDateKeysInRange(start, end)),
    async apply(start: string, end: string) { await click('여행'); changeDate('시작일', start); changeDate('종료일', end); await click('여행 기간 적용'); },
    async remove(date: string) { const [, month, day] = date.split('-'); const label = `${Number(month)}월 ${Number(day)}일`; const row = nodes(render()).find(node => node.type === 'div' && nodes(node).some(child => child.type === 'p' && textOf(child) === label) && nodes(node).filter(child => child.type === 'button').length === 1)!; assert.ok(row, `Schedule row: ${date}`); (button('삭제', row).props.onClick as () => void)(); render(); await settle(); },
    advance(nextDay: string) { currentDay = nextDay; [...timers.values()].forEach(fn => fn()); return render(); },
    dispose() { cleanups.forEach(cleanup => cleanup?.()); },
  };
}
const shows = (qa: ReturnType<typeof fixture>, mode: plans.SocialMealMode) => { assert.ok(textOf(qa.render()).includes(plans.SOCIAL_MEAL_GUIDES[mode].summary)); };

for (const [label, start, end, expected] of [
  ['same day', '2026-10-31', '2026-10-31', ['2026-10-31']],
  ['month boundary', '2026-10-31', '2026-11-02', ['2026-10-31', '2026-11-01', '2026-11-02']],
  ['year boundary', '2026-12-31', '2027-01-02', ['2026-12-31', '2027-01-01', '2027-01-02']],
  ['leap day', '2028-02-28', '2028-03-01', ['2028-02-28', '2028-02-29', '2028-03-01']],
  ['non-leap February', '2027-02-28', '2027-03-01', ['2027-02-28', '2027-03-01']],
] as const) test(`travel range includes both endpoints across ${label}`, () => {
  const qa = fixture(); assert.deepEqual(qa.range(start, end), expected); qa.dispose();
});

test('travel returns to normal after the end date through both minute refresh and reload without rewriting phase/history', async () => {
  const qa = fixture(); shows(qa, 'none'); await qa.apply('2026-10-31', '2026-11-02'); shows(qa, 'travel');
  const expected = { ...baseline[socialKey], '2026-10-31': 'travel', '2026-11-01': 'travel', '2026-11-02': 'travel' };
  assert.deepEqual(qa.local.read(), expected);
  for (const date of ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']) {
    qa.advance(date); shows(qa, date <= '2026-11-02' ? 'travel' : 'none');
    const reloaded = fixture(date, qa.local); shows(reloaded, date <= '2026-11-02' ? 'travel' : 'none'); reloaded.dispose();
  }
  assert.deepEqual(qa.local.read(), expected, 'No automatic travel write on return');
  for (const [key, value] of Object.entries(baseline)) if (key !== socialKey) assert.equal(qa.local.getItem(key), typeof value === 'string' ? value : JSON.stringify(value));
  qa.dispose();
});

test('an explicit next-day dining plan is restored instead of being overwritten as normal', async () => {
  const qa = fixture('2027-03-10'); await qa.apply('2027-03-10', '2027-03-11'); qa.advance('2027-03-12'); shows(qa, 'lunch');
  assert.equal(qa.local.read()['2027-03-12'], 'lunch'); qa.dispose();
});

test('editing travel uses additive range application and explicit date removal, preserving unrelated schedules', async () => {
  const qa = fixture(); await qa.apply('2026-10-31', '2026-11-02'); await qa.apply('2026-11-02', '2026-11-03');
  assert.deepEqual(qa.local.read(), { ...baseline[socialKey], '2026-10-31': 'travel', '2026-11-01': 'travel', '2026-11-02': 'travel', '2026-11-03': 'travel' });
  await qa.remove('2026-11-03'); await qa.remove('2026-10-31'); shows(qa, 'none');
  assert.deepEqual(qa.local.read(), { ...baseline[socialKey], '2026-11-01': 'travel', '2026-11-02': 'travel' });
  qa.advance('2026-11-01'); shows(qa, 'travel'); qa.dispose();
});

test('travel range rejects reversed or empty dates without touching saved schedules', async () => {
  const qa = fixture(), before = [...qa.local.values];
  for (const [start, end] of [['2026-11-02', '2026-10-31'], ['', '2026-11-02'], ['2026-10-31', ''], ['', '']]) {
    assert.deepEqual(qa.range(start, end), []); await qa.apply(start, end);
    assert.match(textOf(qa.render()), /여행 종료일을 시작일 이후로 선택해주세요\./); assert.deepEqual([...qa.local.values], before);
  }
  qa.dispose();
});

test('travel applies at most 31 inclusive days and resumes normal criteria on day 32', async () => {
  const qa = fixture(); await qa.apply('2026-10-31', '2026-12-15');
  const dates = Object.keys(qa.local.read()).filter(date => date >= '2026-10-31' && date <= '2026-12-15').sort();
  assert.equal(dates.length, 31); assert.equal(dates[0], '2026-10-31'); assert.equal(dates.at(-1), '2026-11-30');
  assert.match(textOf(qa.render()), /여행 일정은 한 번에 최대 31일까지 등록할 수 있습니다\./);
  qa.advance('2026-11-30'); shows(qa, 'travel'); qa.advance('2026-12-01'); shows(qa, 'none'); qa.dispose();
});

test('failed travel apply/delete preserves persisted dates and permits an unchanged retry', async () => {
  const qa = fixture(); const before = qa.local.read(); qa.local.failNext(); await qa.apply('2026-10-31', '2026-11-01');
  assert.deepEqual(qa.local.read(), before); assert.match(textOf(qa.render()), /여행 일정을 저장하지 못했어요/);
  const dateValues = nodes(qa.render()).filter(node => node.type === 'input' && node.props.type === 'date').map(node => node.props.value);
  assert.ok(dateValues.includes('2026-10-31')); assert.ok(dateValues.includes('2026-11-01'));
  await qa.click('여행 기간 적용'); const saved = qa.local.read(); qa.local.failNext(); await qa.remove('2026-10-31');
  assert.deepEqual(qa.local.read(), saved); shows(qa, 'travel'); assert.match(textOf(qa.render()), /일정을 삭제하지 못했어요/);
  await qa.remove('2026-10-31'); shows(qa, 'none'); assert.equal(qa.local.read()['2026-10-31'], undefined); assert.equal(qa.local.read()['2026-11-01'], 'travel'); qa.dispose();
});

test('malformed calendar dates cannot silently normalize into a different saved travel day', async () => {
  const qa = fixture(), before = [...qa.local.values];
  for (const [start, end] of [
    ['2026-02-30', '2026-03-03'], ['2026-02-28', '2026-02-30'],
    ['2026-00-00', '2026-01-02'], ['2026-01-00', '2026-01-02'], ['2026-13-01', '2027-01-02'],
    ['2026-01-32', '2026-02-03'], ['2026-04-31', '2026-05-02'], ['2026-10-31', '2026-11-31'],
    ['2027-02-29', '2027-03-01'], ['2100-02-29', '2100-03-01'], ['2028-02-30', '2028-03-01'],
    ['2026-1-01', '2026-01-02'], ['2026-01-01suffix', '2026-01-02'], ['not-a-date', '2026-01-02'],
  ]) {
    assert.deepEqual(qa.range(start, end), [], `${start} to ${end} must be rejected`);
    await qa.apply(start, end); assert.deepEqual([...qa.local.values], before);
    assert.match(textOf(qa.render()), /여행 종료일을 시작일 이후로 선택해주세요\./);
  }
  assert.deepEqual(qa.range('2000-02-28', '2000-03-01'), ['2000-02-28', '2000-02-29', '2000-03-01']);
  assert.deepEqual(qa.range('2100-02-28', '2100-03-01'), ['2100-02-28', '2100-03-01']);
  qa.dispose();
});
