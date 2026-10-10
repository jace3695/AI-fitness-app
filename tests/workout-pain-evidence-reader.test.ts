import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as reader from '../app/data/workoutPainEvidenceReader.ts';
import * as evidence from '../app/data/workoutPainEvidence.ts';
import * as transactions from '../app/data/storageTransaction.ts';
import { WORKOUT_COMPLETED_DAYS_KEY as key } from '../app/data/workoutCompletion.ts';
import { RECORD_RESET_EVENT, RECORD_RESET_STORAGE_EVENT } from '../app/data/appRecordReset.ts';
import { exerciseGuides } from '../app/data/exerciseGuides.ts';
import { preparedStorageSeed } from './helpers/storageProtocol.ts';

const today = '2026-10-09';
const rows = { '2026-10-08': { workoutPainArea: '무릎', workoutPainExercise: '버드독', workoutPain: false },
  '2026-09-20': { workoutPainArea: '무릎', workoutPainExercise: '버드독' } };
const resetMarker = '2026-10-09T12:00:00.000000Z|synthetic-reset';
function fixture() {
  const values = new Map(Object.entries({ ...preparedStorageSeed('owner-a'), [key]: JSON.stringify(rows) }));
  let fail = false, reset = false, now = new Date(2026, 9, 9, 23, 59, 59), nextTimer = 0, reads = 0;
  let readHook: ((name: string, count: number) => void) | undefined;
  const writes: unknown[] = [], timers = new Map<number, { callback: () => void; delay: number }>();
  const listeners = () => {
    const map = new Map<string, Set<EventListener>>();
    return { map,
      addEventListener(name: string, callback: EventListener) { if (!map.has(name)) map.set(name, new Set()); map.get(name)!.add(callback); },
      removeEventListener(name: string, callback: EventListener) { map.get(name)?.delete(callback); },
      emit(name: string, extra: object = {}) { for (const callback of [...(map.get(name) ?? [])]) callback({ type: name, ...extra } as Event); },
      count() { return [...map.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); },
    };
  };
  const win = listeners(), doc = { ...listeners(), visibilityState: 'visible' as DocumentVisibilityState };
  const storage = {
    get length() { if (fail) throw Error('synthetic read failure'); return values.size; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    getItem(name: string) { if (fail) throw Error('synthetic read failure'); readHook?.(name, ++reads); return values.get(name) ?? null; },
    setItem(...args: unknown[]) { writes.push(args); throw Error('read-only fixture'); },
    removeItem(...args: unknown[]) { writes.push(args); throw Error('read-only fixture'); },
  };
  const env: reader.PainEvidenceWatchEnvironment = { window: win as unknown as Window, document: doc, storage: () => storage,
    resetRunning: () => reset, now: () => now,
    setTimeout(callback, delay) { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); } };
  return { values, storage, writes, timers, win, doc, env,
    fail(value: boolean) { fail = value; }, reset(value: boolean) { reset = value; },
    now(value: Date) { now = value; }, hook(value?: typeof readHook) { reads = 0; readHook = value; },
    fireTimer() { const entry = [...timers.entries()][0]; assert.ok(entry); timers.delete(entry[0]); entry[1].callback(); },
    read: () => reader.readWorkoutPainEvidence(storage, today, () => reset),
  };
}
function ready(value: reader.PainEvidenceRead) { assert.equal(value.status, 'ready'); if (value.status !== 'ready') throw Error('not ready'); return value; }

test('coherent reader counts synthetic records and verified absence without any storage mutation', () => {
  const f = fixture(); const before = [...f.values];
  assert.equal(ready(f.read()).summary.repeated[0].dates.length, 2);
  assert.deepEqual([...f.values], before); assert.deepEqual(f.writes, []);
  f.values.delete(key); assert.equal(ready(f.read()).summary.total.recorded, 0);
});

for (const raw of ['{', 'null', 'false', '[]', '"bad"']) test(`corrupt or non-map store ${raw} is unavailable, never empty`, () => {
  const f = fixture(); ready(f.read()); f.values.set(key, raw);
  assert.deepEqual(f.read(), { status: 'unavailable', reason: 'unreadable' }); assert.deepEqual(f.writes, []);
});

test('read exceptions, pending legacy journal, prepared protocol and corrupt protocol fail closed without recovery', () => {
  const f = fixture(); f.fail(true); assert.equal(f.read().status, 'unavailable'); f.fail(false);
  f.values.set(transactions.STORAGE_JOURNAL_KEY, '{}'); assert.deepEqual(f.read(), { status: 'unavailable', reason: 'pending' });
  f.values.delete(transactions.STORAGE_JOURNAL_KEY);
  f.values.set(transactions.STORAGE_PROTOCOL_KEY, JSON.stringify({ version: 2, state: 'prepared', generation: 'g1', transactionId: 't1', before: {} }));
  assert.deepEqual(f.read(), { status: 'unavailable', reason: 'pending' });
  f.values.set(transactions.STORAGE_PROTOCOL_KEY, 'bad'); assert.equal(f.read().status, 'unavailable'); assert.deepEqual(f.writes, []);
});

test('owner switch, sign-out, readiness and same-owner epoch preparation cannot reuse an earlier snapshot', () => {
  const f = fixture(), before = ready(f.read());
  f.values.set(transactions.STORAGE_SESSION_KEY, JSON.stringify({ version: 2, id: 'next', userId: 'owner-a' }));
  assert.equal(f.read().status, 'unavailable');
  const seed = preparedStorageSeed('owner-a'); for (const [name, value] of Object.entries(seed)) f.values.set(name, value);
  assert.equal(reader.samePainEvidenceSnapshot(before, f.read()), false);
  for (const [name, value] of Object.entries(preparedStorageSeed('owner-b'))) f.values.set(name, value);
  f.values.set(key, '{}'); assert.equal(ready(f.read()).summary.sources.length, 0);
  f.values.delete(transactions.STORAGE_READY_KEY); assert.equal(f.read().status, 'unavailable');
  f.values.set(transactions.STORAGE_SESSION_KEY, JSON.stringify({ version: 2, id: 'signed-out', userId: null }));
  assert.equal(f.read().status, 'unavailable');
});

for (const marker of ['', 'nonsense', '2026-10-09T12:00:00.000Z', '2026-02-30T12:00:00.000Z|x', '2026-10-09T12:00:00.000Z|']) {
  test(`invalid or incomplete reset marker is unavailable: ${marker}`, () => {
    const f = fixture(); f.values.set(reader.PAIN_EVIDENCE_RESET_KEY, marker); assert.equal(f.read().status, 'unavailable');
  });
}

test('reset running, finished, failed and cross-tab marker changes fence source snapshots', () => {
  const f = fixture(), previous = ready(f.read()); f.reset(true); assert.deepEqual(f.read(), { status: 'unavailable', reason: 'reset' });
  f.values.set(reader.PAIN_EVIDENCE_RESET_KEY, resetMarker); f.values.delete(key); f.reset(false);
  assert.equal(ready(f.read()).summary.total.recorded, 0); assert.equal(reader.samePainEvidenceSnapshot(previous, f.read()), false);
  f.fail(true); assert.equal(f.read().status, 'unavailable'); f.fail(false); ready(f.read());
});

test('generation, unchanged-generation raw edits, deletion and midnight invalidate exact source activation', () => {
  const f = fixture(), before = ready(f.read());
  f.values.set(transactions.STORAGE_GENERATION_KEY, 'next'); assert.equal(reader.samePainEvidenceSnapshot(before, f.read()), false);
  f.values.delete(transactions.STORAGE_GENERATION_KEY); f.values.set(key, JSON.stringify({ '2026-10-08': rows['2026-10-08'] }));
  assert.equal(reader.samePainEvidenceSnapshot(before, f.read()), false);
  f.values.set(key, JSON.stringify(rows)); assert.equal(reader.samePainEvidenceSnapshot(before, f.read()), true);
  assert.equal(reader.samePainEvidenceSnapshot(before, reader.readWorkoutPainEvidence(f.storage, '2026-10-10', () => false)), false);
  f.values.delete(key); assert.equal(reader.samePainEvidenceSnapshot(before, f.read()), false);
});

test('a mutation during the coherent read is rejected rather than mixed with a new reset generation', () => {
  const f = fixture(); let rawReads = 0;
  f.hook(name => { if (name === key && ++rawReads === 3) f.values.set(reader.PAIN_EVIDENCE_RESET_KEY, resetMarker); });
  assert.equal(f.read().status, 'unavailable'); assert.deepEqual(f.writes, []);
});

test('watcher refreshes all relevant events, ignores unrelated storage and closes evidence on hidden/pagehide', () => {
  const f = fixture(), events: reader.PainEvidenceRead[] = [], watch = reader.watchWorkoutPainEvidence(f.env, value => events.push(value));
  assert.equal(events.at(-1)?.status, 'ready'); const initial = events.length;
  f.win.emit('storage', { key: 'unrelated' }); assert.equal(events.length, initial);
  for (const name of [transactions.RECORDS_CHANGED_EVENT, transactions.CLOUD_SESSION_CHANGED_EVENT, RECORD_RESET_EVENT, 'focus', 'pageshow']) {
    const count = events.length; f.win.emit(name); assert.ok(events.length > count); assert.equal(events.at(-1)?.status, 'ready');
  }
  for (const changedKey of [key, reader.PAIN_EVIDENCE_RESET_KEY, RECORD_RESET_STORAGE_EVENT, transactions.STORAGE_GENERATION_KEY,
    transactions.STORAGE_PROTOCOL_KEY, transactions.STORAGE_READY_KEY, transactions.STORAGE_OWNER_KEY, transactions.STORAGE_SESSION_KEY,
    transactions.STORAGE_JOURNAL_KEY, null]) {
    const count = events.length; f.win.emit('storage', { key: changedKey }); assert.ok(events.length > count);
  }
  f.doc.visibilityState = 'hidden'; f.doc.emit('visibilitychange'); assert.equal(events.at(-1)?.status, 'unavailable');
  f.win.emit('focus'); assert.equal(events.at(-1)?.status, 'unavailable');
  f.doc.visibilityState = 'visible'; f.doc.emit('visibilitychange'); assert.equal(events.at(-1)?.status, 'ready');
  f.win.emit('pagehide'); assert.equal(events.at(-1)?.status, 'unavailable'); f.win.emit('pageshow'); assert.equal(events.at(-1)?.status, 'ready');
  f.fail(true); f.win.emit(transactions.RECORDS_CHANGED_EVENT); assert.equal(events.at(-1)?.status, 'unavailable');
  f.fail(false); f.win.emit('pageshow'); assert.equal(events.at(-1)?.status, 'ready');
  watch.dispose(); assert.equal(f.win.count(), 0); assert.equal(f.doc.count(), 0); assert.equal(f.timers.size, 0); assert.deepEqual(f.writes, []);
});

test('midnight refresh and StrictMode-style cleanup/remount retain one timer, discard disposed callbacks and use the new local date', () => {
  const f = fixture(), events: reader.PainEvidenceRead[] = [];
  let watch = reader.watchWorkoutPainEvidence(f.env, value => events.push(value));
  assert.equal([...f.timers.values()][0].delay, 1000); const oldCallback = [...f.timers.values()][0].callback;
  watch.dispose(); const count = events.length; oldCallback(); assert.equal(events.length, count);
  watch = reader.watchWorkoutPainEvidence(f.env, value => events.push(value)); assert.equal(f.timers.size, 1);
  f.now(new Date(2026, 9, 10)); f.fireTimer(); assert.equal(ready(events.at(-1)!).summary.today, '2026-10-10'); assert.equal(f.timers.size, 1);
  watch.dispose(); assert.equal(f.win.count(), 0); assert.equal(f.doc.count(), 0); assert.equal(f.timers.size, 0);
});

type Node = { type: unknown; props: Record<string, unknown> };
const nodeText = (node: unknown): string => Array.isArray(node) ? node.map(nodeText).join('') : typeof node === 'string' || typeof node === 'number' ? String(node)
  : node && typeof node === 'object' && 'props' in node ? nodeText((node as Node).props.children) : '';
const nodes = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === 'object' && 'props' in node ? [node as Node, ...nodes((node as Node).props.children)] : [];

/** Shipped component/hook handlers; synthetic host APIs. This is deliberately not browser acceptance. */
function componentHarness() {
  const f = fixture(); const focus: string[] = [], scroll: string[] = [], slots: unknown[] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [];
  let cursor = 0, changed = false, disposed = false;
  const react = {
    useState(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (next: unknown) => { if (!disposed && !Object.is(slots[index], next)) { slots[index] = next; changed = true; } }]; },
    useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(effect: () => (() => void) | void, deps: unknown[]) { const index = cursor++, before = slots[index] as unknown[] | undefined;
      if (!before || deps.some((dep, i) => !Object.is(dep, before[i]))) { slots[index] = deps; effects.push(() => { cleanups[index]?.(); const cleanup = effect(); if (cleanup) cleanups[index] = cleanup; }); } },
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => typeof type === 'function' ? type(props) : ({ type, props });
  const exports: { default?: () => Node } = {};
  const compiled = ts.transpileModule(readFileSync(new URL('../app/components/WorkoutPainEvidence.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const dependencies: Record<string, unknown> = { react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    './ExerciseGuidePanel': { default: () => jsx('div', { children: 'SYNTHETIC EXISTING GUIDE' }) },
    '../data/exerciseGuides': { exerciseGuides }, '../data/appRecordReset': { isRecordResetRunning: f.env.resetRunning },
    '../data/workoutPainEvidence': evidence, '../data/workoutPainEvidenceReader': reader };
  const document = Object.assign(f.doc, { getElementById(id: string) { return { focus() { focus.push(id); }, scrollIntoView() { scroll.push(id); } }; } });
  const window = { ...f.win, localStorage: f.storage, setTimeout: f.env.setTimeout, clearTimeout: f.env.clearTimeout };
  class FixtureDate extends Date { constructor() { super(f.env.now().getTime()); } }
  const context = vm.createContext({ exports, document, window, Date: FixtureDate, require(name: string) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  vm.runInContext(compiled, context);
  function render() { let tree!: Node, count = 0; do { assert.ok(count++ < 20); changed = false; cursor = 0; tree = exports.default!(); effects.splice(0).forEach(effect => effect()); } while (changed); return tree; }
  const click = (label: string) => { const found = nodes(render()).find(node => ['button', 'a'].includes(node.type as string) && nodeText(node) === label); assert.ok(found, `${label} missing`);
    (found.props.onClick as (event: unknown) => void)({ preventDefault() {}, currentTarget: { focus() { focus.push('trigger'); } } }); return render(); };
  render(); return { ...f, render, click, focus, scroll, text: () => nodeText(render()), dispose() { disposed = true; cleanups.forEach(cleanup => cleanup?.()); } };
}

test('shipping card opens the exact-date source with focus/scroll and revalidates source and guide interactions without writes', () => {
  const ui = componentHarness();
  assert.match(ui.text(), /부위·운동명 반복 입력/); assert.match(ui.text(), /과거 기록의 실제 발생일은 확인할 수 없어요/);
  ui.click('2026-10-08 기록 보기'); assert.match(ui.text(), /2026-10-08 저장 기록 근거/);
  assert.equal(ui.focus.at(-1), 'workout-pain-source-2026-10-08'); assert.equal(ui.scroll.at(-1), 'workout-pain-source-2026-10-08');
  const priorFocusCount = ui.focus.length, priorScrollCount = ui.scroll.length;
  ui.click('2026-10-08 기록 보기');
  assert.equal(ui.focus.length, priorFocusCount + 1); assert.equal(ui.scroll.length, priorScrollCount + 1);
  assert.equal(ui.focus.at(-1), 'workout-pain-source-2026-10-08');
  ui.click('날짜 기록 닫기'); assert.equal(ui.focus.at(-1), 'trigger');
  ui.click('날짜별 전체 입력 근거 보기'); ui.click('2026-10-08 기록 보기');
  ui.click('날짜별 전체 입력 근거 접기'); assert.doesNotMatch(ui.text(), /2026-10-08 저장 기록 근거/);
  ui.click('기존 자세·중단 기준 보기'); assert.match(ui.text(), /SYNTHETIC EXISTING GUIDE/); assert.match(ui.text(), /안전한 대체 운동으로 판정한 내용은 아니에요/);
  const guideRegion = nodes(ui.render()).find(node => node.props['aria-label'] === '버드독 기존 일반 가이드');
  assert.ok(guideRegion, 'the existing guide has an accessible name');
  assert.equal(guideRegion.type, 'section', 'the named guide is an implicit region, not an unlabelable generic div');
  ui.values.set(key, JSON.stringify({ '2026-09-20': rows['2026-09-20'] }));
  ui.click('2026-10-08 기록 보기'); assert.match(ui.text(), /기록이 바뀌었어요/); assert.doesNotMatch(ui.text(), /2026-10-08 저장 기록 근거|SYNTHETIC EXISTING GUIDE/);
  assert.deepEqual(ui.writes, []); ui.dispose(); assert.equal(ui.timers.size, 0);
});

test('shipping card clears private source/guide content across corruption, reset, same-owner preparation and hidden resume', () => {
  const ui = componentHarness();
  const open = () => { ui.click('2026-10-08 기록 보기'); ui.click('기존 자세·중단 기준 보기'); };
  open(); ui.fail(true); ui.win.emit(transactions.RECORDS_CHANGED_EVENT);
  assert.match(ui.text(), /기록을 읽을 수 없어요/); assert.doesNotMatch(ui.text(), /저장 기록 근거|SYNTHETIC EXISTING GUIDE|기록이 없어요/);
  ui.fail(false); ui.win.emit('focus'); open(); ui.reset(true); ui.win.emit(RECORD_RESET_EVENT);
  assert.doesNotMatch(ui.text(), /저장 기록 근거|SYNTHETIC EXISTING GUIDE/);
  ui.reset(false); ui.win.emit(RECORD_RESET_EVENT); open(); ui.values.delete(transactions.STORAGE_READY_KEY); ui.win.emit(transactions.CLOUD_SESSION_CHANGED_EVENT);
  assert.doesNotMatch(ui.text(), /저장 기록 근거|SYNTHETIC EXISTING GUIDE/);
  for (const [name, value] of Object.entries(preparedStorageSeed('owner-a'))) ui.values.set(name, value);
  ui.win.emit(transactions.CLOUD_SESSION_CHANGED_EVENT); open(); ui.doc.visibilityState = 'hidden'; ui.doc.emit('visibilitychange');
  assert.doesNotMatch(ui.text(), /저장 기록 근거|SYNTHETIC EXISTING GUIDE/);
  ui.doc.visibilityState = 'visible'; ui.doc.emit('visibilitychange'); assert.doesNotMatch(ui.text(), /저장 기록 근거|SYNTHETIC EXISTING GUIDE/);
  assert.deepEqual(ui.writes, []); ui.dispose();
});

for (const mutation of ['changed', 'deleted'] as const) test(`a captured source handler rejects silently ${mutation} bytes before any fresh render`, () => {
  const ui = componentHarness();
  ui.click('기존 자세·중단 기준 보기');
  const anchor = nodes(ui.render()).find(node => node.type === 'a' && nodeText(node) === '2026-10-08 기록 보기');
  assert.ok(anchor);
  const activate = anchor.props.onClick as (event: unknown) => void;
  const next: Record<string, unknown> = { ...rows, [today]: { workoutPainArea: '허리', workoutPainExercise: '오늘 전용' } };
  if (mutation === 'deleted') delete next['2026-10-08'];
  else next['2026-10-08'] = { ...rows['2026-10-08'], workoutPainArea: '어깨' };
  ui.values.set(key, JSON.stringify(next));
  // Invoke exactly the old render's callback. No watcher event, render or
  // synthetic replacement handler gets an opportunity to hide the stale link.
  activate({ preventDefault() {}, currentTarget: { focus() { throw Error('stale trigger focused'); } } });
  assert.match(ui.text(), /기록이 바뀌었어요/);
  assert.doesNotMatch(ui.text(), /2026-10-08 저장 기록 근거|SYNTHETIC EXISTING GUIDE|오늘 전용/);
  assert.equal(ui.focus.length, 0); assert.equal(ui.scroll.length, 0);
  assert.deepEqual(ui.writes, []); ui.dispose();
});

test('shipping source never claims a missing or invalid exercise name was input and retains invalid status provenance', () => {
  const ui = componentHarness();
  for (const value of [true, { workoutPain: false }, { workoutPainExercise: ['invalid'], workoutDone: true, workoutStatus: 'invalid-status' }]) {
    ui.values.set(key, JSON.stringify({ '2026-10-08': value })); ui.win.emit(transactions.RECORDS_CHANGED_EVENT);
    ui.click('날짜별 전체 입력 근거 보기'); ui.click('2026-10-08 기록 보기');
    assert.match(ui.text(), /발생 운동명 입력 미확인 · 세부 수행 연결 미확인/);
    assert.doesNotMatch(ui.text(), /발생 운동명 입력만 있음/);
    if (typeof value === 'object' && 'workoutStatus' in value) assert.match(ui.text(), /수행 상태 원문: "invalid-status" · 완료표시 원문: true/);
  }
  assert.deepEqual(ui.writes, []); ui.dispose();
});
