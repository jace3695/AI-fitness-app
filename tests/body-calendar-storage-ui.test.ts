import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as records from '../app/data/recordStorage.ts';
import * as transactions from '../app/data/storageTransaction.ts';
import * as updates from '../app/data/fitnessStorageUpdates.ts';
import * as plans from '../app/data/dietPlans.ts';
import * as foam from '../app/data/foamRoller.ts';
import * as workouts from '../app/data/workoutCompletion.ts';
import * as management from '../app/data/weightManagement.ts';

type Node = { type: unknown; props: Record<string, unknown> };
const day = '2026-10-09';
const textOf = (node: unknown): string => Array.isArray(node) ? node.map(textOf).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' && 'props' in node ? textOf((node as Node).props.children) : '';
const nodes = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(nodes) : !node || typeof node !== 'object' || !('props' in node) ? [] : [node as Node, ...nodes((node as Node).props.children)];
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function browser(seed: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]));
  const listeners = new Map<string, Set<() => void>>();
  const epoch = JSON.stringify({ version: 2, id: 'synthetic-session-A', userId: 'synthetic-A' });
  values.set(transactions.STORAGE_SESSION_KEY, epoch);
  values.set(transactions.STORAGE_OWNER_KEY, 'synthetic-A');
  values.set(transactions.STORAGE_READY_KEY, JSON.stringify({ epoch, userId: 'synthetic-A' }));
  let failure: string | undefined, tail = Promise.resolve(), nextGate: Promise<void> | undefined;
  const local = { values, get length() { return values.size; }, key(index: number) { return [...values.keys()][index] ?? null; },
    getItem(key: string) { return values.get(key) ?? null; }, setItem(key: string, value: string) { if (failure === key) { failure = undefined; throw Error('Synthetic quota failure'); } values.set(key, value); }, removeItem(key: string) { values.delete(key); }, clear() { values.clear(); } };
  const locks = { request(_name: string, _options: unknown, callback: () => unknown) { const gate = nextGate; nextGate = undefined; const result = tail.then(async () => { await gate; return callback(); }); tail = result.then(() => {}, () => {}); return result; } };
  const win = { localStorage: local, confirm: () => true,
    addEventListener(name: string, callback: () => void) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(callback); },
    removeEventListener(name: string, callback: () => void) { listeners.get(name)?.delete(callback); },
    dispatchEvent(event: { type: string }) { [...(listeners.get(event.type) ?? [])].forEach(callback => callback()); return true; },
  };
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
  return { local, win,
    read(key: string) { return JSON.parse(values.get(key) ?? '{}'); },
    set(key: string, value: unknown) { values.set(key, JSON.stringify(value)); },
    fail(key: string) { failure = key; },
    hold() { let release!: () => void; nextGate = new Promise<void>(resolve => { release = resolve; }); return release; },
    unavailable() { Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} }); },
    refresh() { win.dispatchEvent({ type: transactions.RECORDS_CHANGED_EVENT }); },
    dispose() { if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window'); if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator); else Reflect.deleteProperty(globalThis, 'navigator'); },
  };
}

// Executes the shipped React handlers with synthetic hooks and the real locked
// storage implementation. This does not launch or replace real-browser QA.
function mount(name: string, environment: ReturnType<typeof browser>, initialProps: Record<string, unknown> = {}) {
  const slots: unknown[] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [];
  let cursor = 0, changed = false, props = initialProps;
  const react = {
    useState(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial; return [slots[slot], (update: unknown) => { const next = typeof update === 'function' ? update(slots[slot]) : update; if (!Object.is(slots[slot], next)) { slots[slot] = next; changed = true; } }]; },
    useRef(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useMemo(factory: () => unknown, deps: unknown[]) { const slot = cursor++, old = slots[slot] as { deps: unknown[]; value: unknown } | undefined; if (!old || old.deps.length !== deps.length || old.deps.some((value, index) => value !== deps[index])) slots[slot] = { deps, value: factory() }; return (slots[slot] as { value: unknown }).value; },
    useEffect(effect: () => void, deps: unknown[]) { const slot = cursor++, old = slots[slot] as unknown[] | undefined; if (!old || old.length !== deps.length || old.some((value, index) => value !== deps[index])) { slots[slot] = deps; effects.push(() => { cleanups[slot]?.(); const cleanup = effect(); if (typeof cleanup === 'function') cleanups[slot] = cleanup; }); } },
  };
  const modules: Record<string, unknown> = { react,
    'react/jsx-runtime': { jsx: (type: unknown, props: Node['props']) => ({ type, props }), jsxs: (type: unknown, props: Node['props']) => ({ type, props }) },
    '../data/recordStorage': records, '../data/storageTransaction': transactions, '../data/fitnessStorageUpdates': updates,
    '../lib/oaReportParser': { parseOaReport: async () => ({ values: {}, recognizedCount: 0 }) },
    '../../components/useUnsavedChanges': { useUnsavedChanges() {} },
    '../data/dietPlans': { ...plans, getLocalDateKey: (date?: Date) => date ? plans.getLocalDateKey(date) : day },
    '../data/recoveryMode': { CONDITION_SIGNAL_OPTIONS: [], RECOVERY_REASON_LABELS: {} }, '../data/foamRoller': foam, '../data/workoutCompletion': workouts, '../data/weightManagement': management,
  };
  for (const child of ['WorkoutTimes', 'BodyRecordCard', 'MonthlySummaryCard', 'RecordDashboard', 'WeightChart']) modules[`./${child}`] = { default: function Child() {} };
  const source = ts.transpileModule(readFileSync(new URL(`../app/components/${name}.tsx`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: { default?: (props: Record<string, unknown>) => Node } = {};
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, { window: environment.win, Date, console, Event })(exports, (key: string) => { assert.ok(key in modules, `Unexpected dependency ${key}`); return modules[key]; });
  const render = (): Node => { let node!: Node, rounds = 0; do { assert.ok(rounds++ < 25, `${name} settled`); changed = false; cursor = 0; node = exports.default!(props); effects.splice(0).forEach(effect => effect()); } while (changed); return node; };
  function find(predicate: (node: Node) => boolean) { const found = nodes(render()).filter(predicate); assert.equal(found.length, 1, `Unique ${name} node`); return found[0]; }
  const click = (label: string) => { const node = find(node => node.type === 'button' && textOf(node) === label); const result = (node.props.onClick as () => Promise<void> | void)(); render(); return result; };
  const change = (placeholder: string, value: string) => { const node = find(node => (node.type === 'input' || node.type === 'textarea') && node.props.placeholder === placeholder); (node.props.onChange as (event: unknown) => void)({ target: { value } }); render(); };
  render();
  return { render, find, click, change, text: () => textOf(render()),
    changeLabeled(label: string, value: string) { const parent = find(node => node.type === 'label' && textOf(node).startsWith(label)); const node = nodes(parent).find(node => node.type === 'input')!; (node.props.onChange as (event: unknown) => void)({ target: { value } }); render(); },
    props(next: Record<string, unknown>) { props = { ...props, ...next }; render(); },
    value(placeholder: string) { return find(node => (node.type === 'input' || node.type === 'textarea') && node.props.placeholder === placeholder).props.value; },
    disabled() { return nodes(render()).some(node => node.type === 'fieldset' && node.props.disabled === true); },
    dispose() { cleanups.forEach(cleanup => cleanup?.()); },
  };
}
const bodySeed = {
  [records.WEIGHT_RECORDS_KEY]: { [day]: { weight: 80, recordedAt: 'old' }, '2001-01-02': { weight: 90, recordedAt: 'old' } },
  [records.INBODY_RECORDS_KEY]: { [day]: { bodyFatPercent: 20, memo: 'old memo' }, '2001-01-02': { memo: 'historic' } },
};
function bodyFixture() {
  const b = browser(bodySeed); let changes = 0;
  const qa = mount('BodyRecordCard', b, { dateKey: day, weights: b.read(records.WEIGHT_RECORDS_KEY), inbody: b.read(records.INBODY_RECORDS_KEY), onChange: (next: Record<string, unknown>) => { changes++; qa.props(next); } });
  return { b, qa, changes: () => changes, dispose() { qa.dispose(); b.dispose(); } };
}

test('body save queues one atomic batch, merges fresh dates/untouched fields and blocks edits until completion', async t => {
  const { b, qa, changes, dispose } = bodyFixture(); t.after(dispose);
  qa.change('예: 82.4', '79.4'); qa.change('체중·인바디 메모', 'my edit');
  const release = b.hold(); const saving = qa.click('통합 저장');
  assert.equal(qa.disabled(), true); assert.equal(changes(), 0); assert.doesNotMatch(qa.text(), /기록을 저장했습니다/);
  b.set(records.WEIGHT_RECORDS_KEY, { ...b.read(records.WEIGHT_RECORDS_KEY), '2026-10-08': { weight: 81, recordedAt: 'peer' } });
  b.set(records.INBODY_RECORDS_KEY, { ...b.read(records.INBODY_RECORDS_KEY), [day]: { bodyFatPercent: 19, memo: 'peer memo', muscleMass: 50 } });
  release(); await saving;
  assert.equal(b.read(records.WEIGHT_RECORDS_KEY)[day].weight, 79.4);
  assert.equal(b.read(records.WEIGHT_RECORDS_KEY)['2026-10-08'].weight, 81);
  assert.deepEqual(b.read(records.INBODY_RECORDS_KEY)[day], { bodyFatPercent: 19, memo: 'my edit', muscleMass: 50 });
  assert.equal(changes(), 1); assert.equal(qa.disabled(), false); assert.match(qa.text(), /기록을 저장했습니다/);
});

for (const action of ['통합 저장', '전체 삭제']) test(`body ${action} quota rollback preserves both maps and form with no success`, async t => {
  const { b, qa, changes, dispose } = bodyFixture(); t.after(dispose);
  qa.change('예: 82.4', '79.4'); qa.change('체중·인바디 메모', 'unsaved memo');
  b.fail(records.INBODY_RECORDS_KEY); await qa.click(action);
  assert.deepEqual(b.read(records.WEIGHT_RECORDS_KEY), bodySeed[records.WEIGHT_RECORDS_KEY]);
  assert.deepEqual(b.read(records.INBODY_RECORDS_KEY), bodySeed[records.INBODY_RECORDS_KEY]);
  assert.equal(changes(), 0); assert.equal(qa.value('예: 82.4'), '79.4'); assert.equal(qa.value('체중·인바디 메모'), 'unsaved memo');
  assert.match(qa.text(), /Synthetic quota failure/); assert.equal(qa.disabled(), false);
});

for (const blocked of ['missing-locks', 'legacy-journal', 'corrupt-map']) test(`body preserves data and inputs when ${blocked}`, async t => {
  const { b, qa, changes, dispose } = bodyFixture(); t.after(dispose); qa.change('예: 82.4', '79.4');
  if (blocked === 'missing-locks') b.unavailable();
  if (blocked === 'legacy-journal') b.set(transactions.STORAGE_JOURNAL_KEY, { [records.WEIGHT_RECORDS_KEY]: b.local.getItem(records.WEIGHT_RECORDS_KEY) });
  if (blocked === 'corrupt-map') b.local.values.set(records.INBODY_RECORDS_KEY, 'unknown');
  const before = [...b.local.values]; await qa.click('통합 저장');
  assert.deepEqual([...b.local.values], before); assert.equal(changes(), 0); assert.equal(qa.value('예: 82.4'), '79.4');
  assert.ok(nodes(qa.render()).some(node => node.props.role === 'alert'));
});

test('an old body draft cannot adopt a newly prepared owner, even after A to B to A', async t => {
  const { b, qa, changes, dispose } = bodyFixture(); t.after(dispose); qa.change('예: 82.4', '79.4');
  for (const user of ['synthetic-B', 'synthetic-A']) { const token = transactions.invalidateStorageOwner(b.local, user); await transactions.completeStorageOwnerTransition(b.local, token, () => ({ [transactions.STORAGE_OWNER_KEY]: user })); }
  const before = [...b.local.values]; await qa.click('통합 저장');
  assert.deepEqual([...b.local.values], before); assert.equal(changes(), 0); assert.equal(qa.value('예: 82.4'), '79.4');
  assert.doesNotMatch(qa.text(), /기록을 저장했습니다/);
});

test('queued body operation is fenced when owner changes before lock entry', async t => {
  const { b, qa, changes, dispose } = bodyFixture(); t.after(dispose); qa.change('예: 82.4', '79.4');
  const release = b.hold(), saving = qa.click('통합 저장');
  transactions.invalidateStorageOwner(b.local, 'synthetic-B'); release(); await saving;
  assert.equal(changes(), 0); assert.equal(b.read(records.WEIGHT_RECORDS_KEY)[day].weight, 80); assert.equal(qa.value('예: 82.4'), '79.4');
});

for (const name of ['WeightRecordCard', 'InbodyRecordCard']) test(`${name} failure keeps dirty input, then retry merges latest store`, async t => {
  const b = browser(bodySeed); t.after(b.dispose);
  const isWeight = name === 'WeightRecordCard', key = isWeight ? records.WEIGHT_RECORDS_KEY : records.INBODY_RECORDS_KEY;
  let changes = 0;
  const qa = mount(name, b, { dateKey: day, [isWeight ? 'weights' : 'records']: b.read(key), onChange: (next: unknown) => { changes++; qa.props({ [isWeight ? 'weights' : 'records']: next }); } }); t.after(qa.dispose);
  qa.change(isWeight ? '예: 82.4' : '인바디 메모', isWeight ? '79.4' : 'edited memo');
  b.fail(key); await qa.click('저장'); assert.equal(changes, 0); assert.match(qa.text(), /Synthetic quota failure/);
  b.set(key, { ...b.read(key), '2026-10-08': isWeight ? { weight: 81, recordedAt: 'peer' } : { bodyFatPercent: 18 } });
  await qa.click('저장'); assert.equal(changes, 1); assert.ok(b.read(key)['2026-10-08']);
  if (!isWeight) assert.equal(b.read(key)[day].bodyFatPercent, 20);
});

test('calendar note delete waits, preserves draft on failure, and successful save keeps other dates', async t => {
  const b = browser({ [records.DAILY_NOTES_KEY]: { [day]: 'old', '2001-01-02': 'historic' } }); t.after(b.dispose);
  const qa = mount('RecordCalendarView', b); t.after(qa.dispose);
  const placeholder = '오늘 컨디션, 허기, 운동 느낌 등을 적어주세요.';
  qa.change(placeholder, 'my unsaved note'); b.fail(records.DAILY_NOTES_KEY); await qa.click('삭제');
  assert.equal(qa.value(placeholder), 'my unsaved note'); assert.equal(b.read(records.DAILY_NOTES_KEY)[day], 'old'); assert.match(qa.text(), /Synthetic quota failure/);
  const release = b.hold(), saving = qa.click('저장'); assert.equal(qa.disabled(), true); assert.equal(qa.value(placeholder), 'my unsaved note');
  b.set(records.DAILY_NOTES_KEY, { ...b.read(records.DAILY_NOTES_KEY), '2026-10-08': 'peer' }); release(); await saving;
  assert.deepEqual(b.read(records.DAILY_NOTES_KEY), { [day]: 'my unsaved note', '2001-01-02': 'historic', '2026-10-08': 'peer' });
});

test('calendar workout edit stays open on failure and replays edited fields over fresh workout data', async t => {
  const seed = { workoutDone: true, workoutStatus: 'completed', workoutMemo: 'old', workoutDifficulty: 'moderate', cardioMinutes: 20, cardioDone: true };
  const b = browser({ [workouts.WORKOUT_COMPLETED_DAYS_KEY]: { [day]: seed } }); t.after(b.dispose);
  const qa = mount('RecordCalendarView', b); t.after(qa.dispose);
  qa.click('이 운동 기록 수정하기'); qa.change('운동 메모', 'my memo'); b.fail(workouts.WORKOUT_COMPLETED_DAYS_KEY); await qa.click('바뀐 기록 저장');
  assert.equal(qa.value('운동 메모'), 'my memo'); assert.doesNotMatch(qa.text(), /운동 기록을 수정했습니다/);
  const release = b.hold(), saving = qa.click('바뀐 기록 저장');
  b.set(workouts.WORKOUT_COMPLETED_DAYS_KEY, { [day]: { ...seed, workoutDifficulty: 'hard', cardioMinutes: 35 }, '2026-10-08': { pullupDone: true } });
  release(); await saving;
  const current = b.read(workouts.WORKOUT_COMPLETED_DAYS_KEY);
  assert.equal(current[day].workoutMemo, 'my memo'); assert.equal(current[day].workoutDifficulty, 'hard'); assert.equal(current[day].cardioMinutes, 35); assert.equal(current['2026-10-08'].pullupDone, true);
  assert.match(qa.text(), /운동 기록을 수정했습니다/);
});

test('weight goal waits for async save and shows rejection without losing draft', async t => {
  const b = browser(); t.after(b.dispose); let reject!: (reason: Error) => void;
  const qa = mount('WeightChart', b, { weights: {}, inbody: {}, goal: { minKg: 65, maxKg: 67 }, year: 2026, monthIndex: 9, cutoffDateKey: day,
    onGoalChange: () => new Promise<void>((_resolve, fail) => { reject = fail; }) }); t.after(qa.dispose);
  qa.changeLabeled('목표 최소', '66');
  const form = qa.find(node => node.type === 'form'); const promise = (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
  assert.doesNotMatch(qa.text(), /저장했습니다/); assert.ok(nodes(qa.render()).filter(node => node.type === 'input').every(node => node.props.disabled === true));
  reject(Error('Synthetic goal failure')); await promise; await tick();
  assert.match(qa.text(), /Synthetic goal failure/); assert.ok(nodes(qa.render()).some(node => node.type === 'input' && node.props.value === '66'));
});

test('body save from the prior selected date does not clear or show success on the new date', async t => {
  const { b, qa, dispose } = bodyFixture(); t.after(dispose); qa.change('예: 82.4', '79.4');
  const release = b.hold(), saving = qa.click('통합 저장');
  qa.props({ dateKey: '2001-01-02' }); assert.equal(qa.value('예: 82.4'), '90');
  release(); await saving;
  assert.equal(qa.value('예: 82.4'), '90'); assert.equal(qa.value('체중·인바디 메모'), 'historic');
  assert.doesNotMatch(qa.text(), /기록을 저장했습니다/); assert.equal(b.read(records.WEIGHT_RECORDS_KEY)[day].weight, 79.4);
});

test('dirty body input survives an unrelated incoming snapshot and a duplicate save queues only once', async t => {
  const { b, qa, changes, dispose } = bodyFixture(); t.after(dispose); qa.change('예: 82.4', '79.4');
  qa.props({ weights: { ...b.read(records.WEIGHT_RECORDS_KEY), [day]: { weight: 78, recordedAt: 'peer' } } });
  assert.equal(qa.value('예: 82.4'), '79.4');
  const release = b.hold(), saving = qa.click('통합 저장'); await qa.click('통합 저장');
  release(); await saving; assert.equal(changes(), 1);
});

test('calendar general delete keeps confirmation and all data after failure, then preserves secondary records on success', async t => {
  const seed = { workoutDone: true, workoutStatus: 'completed', workoutMemo: 'old', cardioDone: true, cardioMinutes: 20, pullupDone: true, pullupStage: 2 };
  const b = browser({ [workouts.WORKOUT_COMPLETED_DAYS_KEY]: { [day]: seed } }); t.after(b.dispose);
  const qa = mount('RecordCalendarView', b); t.after(qa.dispose); qa.click('기록 삭제');
  b.fail(workouts.WORKOUT_COMPLETED_DAYS_KEY); await qa.click('운동 기록 삭제 확인');
  assert.deepEqual(b.read(workouts.WORKOUT_COMPLETED_DAYS_KEY)[day], seed);
  assert.ok(qa.find(node => node.type === 'button' && textOf(node) === '운동 기록 삭제 확인'));
  await qa.click('운동 기록 삭제 확인');
  assert.deepEqual(b.read(workouts.WORKOUT_COMPLETED_DAYS_KEY)[day], { cardioDone: true, cardioMinutes: 20, pullupDone: true, pullupStage: 2 });
  assert.match(qa.text(), /일반 운동 기록을 삭제했습니다/);
});

for (const kind of ['유산소', '철봉', '폼롤러']) test(`calendar ${kind} edit/delete wait and retain drafts on failed storage`, async t => {
  const seed = { cardioDone: true, cardioMinutes: 20, cardioMemo: 'old cardio', pullupDone: true, pullupStage: 2, pullupMemo: 'old pullup', foamRollerDone: true, foamRollerMemo: 'old foam' };
  const b = browser({ [workouts.WORKOUT_COMPLETED_DAYS_KEY]: { [day]: seed } }); t.after(b.dispose);
  const qa = mount('RecordCalendarView', b); t.after(qa.dispose); qa.click(`${kind} 기록 수정`);
  const memo = qa.find(node => node.type === 'textarea' && node.props.value === `old ${kind === '유산소' ? 'cardio' : kind === '철봉' ? 'pullup' : 'foam'}`);
  (memo.props.onChange as (event: unknown) => void)({ target: { value: 'edited secondary' } });
  b.fail(workouts.WORKOUT_COMPLETED_DAYS_KEY); await qa.click('수정 저장');
  assert.ok(nodes(qa.render()).some(node => node.type === 'textarea' && node.props.value === 'edited secondary'));
  const release = b.hold(), saving = qa.click('수정 저장'); assert.equal(qa.disabled(), true);
  b.set(workouts.WORKOUT_COMPLETED_DAYS_KEY, { [day]: { ...seed, workoutMemo: 'peer general' } }); release(); await saving;
  assert.equal(b.read(workouts.WORKOUT_COMPLETED_DAYS_KEY)[day].workoutMemo, 'peer general');
  assert.match(qa.text(), /기록을 수정했습니다/);
  b.fail(workouts.WORKOUT_COMPLETED_DAYS_KEY); await qa.click(`${kind} 기록 삭제`);
  assert.equal(b.read(workouts.WORKOUT_COMPLETED_DAYS_KEY)[day][kind === '유산소' ? 'cardioDone' : kind === '철봉' ? 'pullupDone' : 'foamRollerDone'], true);
  assert.doesNotMatch(qa.text(), /기록을 삭제했습니다/);
});

test('calendar dirty note retains its original owner after owner transition', async t => {
  const b = browser({ [records.DAILY_NOTES_KEY]: { [day]: 'old' } }); t.after(b.dispose);
  const qa = mount('RecordCalendarView', b); t.after(qa.dispose); const placeholder = '오늘 컨디션, 허기, 운동 느낌 등을 적어주세요.';
  qa.change(placeholder, 'owner A draft');
  const token = transactions.invalidateStorageOwner(b.local, 'synthetic-B');
  await transactions.completeStorageOwnerTransition(b.local, token, () => ({ [transactions.STORAGE_OWNER_KEY]: 'synthetic-B', [records.DAILY_NOTES_KEY]: JSON.stringify({ [day]: 'owner B note' }) }));
  b.refresh(); qa.render(); await qa.click('저장');
  assert.equal(b.read(records.DAILY_NOTES_KEY)[day], 'owner B note'); assert.equal(qa.value(placeholder), 'owner A draft');
});

test('weight goal retains owner and only publishes success after committed storage', async t => {
  const b = browser(); t.after(b.dispose);
  const qa = mount('WeightChart', b, { weights: {}, inbody: {}, goal: { minKg: 65, maxKg: 67 }, year: 2026, monthIndex: 9, cutoffDateKey: day,
    onGoalChange: (goal: records.WeightGoal, owner: transactions.StorageOwnerToken) => records.saveWeightGoal(goal, owner) }); t.after(qa.dispose);
  qa.changeLabeled('목표 최소', '66');
  const submit = () => (qa.find(node => node.type === 'form').props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} });
  const release = b.hold(), saving = submit(); assert.doesNotMatch(qa.text(), /저장했습니다/); release(); await saving;
  assert.deepEqual(b.read(records.WEIGHT_GOAL_KEY), { minKg: 66, maxKg: 67 }); assert.match(qa.text(), /저장했습니다/);
  qa.changeLabeled('목표 최소', '65.5');
  const token = transactions.invalidateStorageOwner(b.local, 'synthetic-B'); await transactions.completeStorageOwnerTransition(b.local, token, () => ({ [transactions.STORAGE_OWNER_KEY]: 'synthetic-B' }));
  await submit(); assert.deepEqual(b.read(records.WEIGHT_GOAL_KEY), { minKg: 66, maxKg: 67 }); assert.doesNotMatch(qa.text(), /저장했습니다/);
});
