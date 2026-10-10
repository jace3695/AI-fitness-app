import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as overview from '../lib/language-live/overview.ts';
import * as types from '../lib/language-live/types.ts';
import { parseLiveReport } from '../lib/language-live/report-parser.ts';
import type { LiveLearningSnapshot } from '../lib/language-live/learning-types.ts';
import type { LiveOverviewState } from '../components/language/live/useLiveOverview.ts';

const owner = randomUUID(), other = randomUUID();
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function snapshot(id = owner, topic = '합성 현재 수업'): LiveLearningSnapshot {
  return { ownerId: id, batches: [], lessons: [{ user_id: id, lesson_id: randomUUID(), revision: 1, previous_revision: 0, operation: 'create',
    report: parseLiveReport(`학습 날짜: 2026-10-09\n수업 주제: ${topic}\n현재 학습 단계: 기초\n읽기 학습 결과: え를 새로 배웠다.`),
    created_at: '2026-10-09T12:00:00Z', request_id: randomUUID(), payload_hash: 'synthetic', duplicate_reason: null, restored_from_revision: null }] };
}
function environment() {
  return { owner: owner as string | null, snapshot: snapshot(), reads: 0, read: null as ReturnType<typeof deferred<LiveLearningSnapshot>> | null,
    authRead: null as ReturnType<typeof deferred<{ data: { user: { id: string } | null }; error: null }>> | null,
    now: '2026-10-09T12:00:00Z', visibility: 'visible', configured: true };
}
type Node = { type: unknown; props: Record<string, unknown> };
function textOf(node: unknown): string {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node && typeof node === 'object' && 'props' in node) return textOf((node as Node).props.children);
  return '';
}
function nodes(node: unknown): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  return [node as Node, ...nodes((node as Node).props.children)];
}

// Executes the shipped hook and components with deterministic Auth/repository,
// React-hook and clock boundaries. This is not DOM/browser/visual acceptance.
function fixture(env = environment(), calendar = false) {
  const slots: unknown[] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [];
  const events = new Map<string, Set<() => void>>(), timers = new Map<number, { fn: () => void; delay: number }>();
  let cursor = 0, timerId = 0, authCallback: ((event: string, session: { user: { id: string } } | null) => void) | undefined;
  let selectedDateKey = '2026-10-09', monthKey = '2026-10', lastState: LiveOverviewState;
  const memo = (factory: () => unknown, deps: unknown[]) => {
    const slot = cursor++, old = slots[slot] as { deps: unknown[]; value: unknown } | undefined;
    if (!old || old.deps.length !== deps.length || old.deps.some((value, index) => value !== deps[index])) slots[slot] = { deps, value: factory() };
    return (slots[slot] as { value: unknown }).value;
  };
  const react = {
    useState(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial; return [slots[slot], (value: unknown) => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; },
    useRef(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useCallback: (fn: () => unknown, deps: unknown[]) => memo(() => fn, deps),
    useEffect(effect: () => void, deps: unknown[]) { const slot = cursor++, old = slots[slot] as unknown[] | undefined; if (!old || old.length !== deps.length || old.some((value, index) => value !== deps[index])) { slots[slot] = deps; effects.push(() => { cleanups[slot]?.(); const cleanup = effect(); if (typeof cleanup === 'function') cleanups[slot] = cleanup; }); } },
  };
  const element = (type: unknown, props: Record<string, unknown>) => typeof type === 'function' ? type(props) : ({ type, props });
  const eventTarget = {
    addEventListener(name: string, callback: () => void) { if (!events.has(name)) events.set(name, new Set()); events.get(name)!.add(callback); },
    removeEventListener(name: string, callback: () => void) { events.get(name)?.delete(callback); },
  };
  class Clock extends Date { constructor(value?: string | number) { super(value ?? env.now); } static now() { return Date.parse(env.now); } }
  const client = env.configured ? { auth: {
    async getUser() { return env.authRead ? env.authRead.promise : { data: { user: env.owner ? { id: env.owner } : null }, error: null }; },
    onAuthStateChange(callback: typeof authCallback) { authCallback = callback; return { data: { subscription: { unsubscribe() { authCallback = undefined; } } } }; },
  } } : null;
  const modules: Record<string, unknown> = {
    react, 'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'fragment' }, 'next/link': { __esModule: true, default: 'a' },
    './live-overview.module.css': { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) },
    '@/app/lib/supabase': { supabase: client }, '@/lib/language-live/types': types,
    '@/lib/language-live/overview': { ...overview, liveOverviewDate: () => overview.liveOverviewDate(new Date(env.now)) },
    '@/app/data/languageLiveLearningRepository': { createLanguageLiveLearningRepository: () => ({ async readLearning() { env.reads++; return env.read ? env.read.promise : structuredClone(env.snapshot); } }) },
  };
  const load = (path: string) => {
    const exports: Record<string, unknown> = {};
    const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    vm.runInNewContext(`(function(exports, require) { ${source}\n})`, { Error, Date: Clock, Intl, crypto, structuredClone,
      setTimeout(fn: () => void, delay: number) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout(id: number) { timers.delete(id); },
      window: eventTarget, document: { get visibilityState() { return env.visibility; }, ...eventTarget },
    })(exports, (name: string) => { assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name]; });
    return exports;
  };
  const hook = load('../components/language/live/useLiveOverview.ts').useLiveOverview as () => LiveOverviewState;
  modules['./useLiveOverview'] = { useLiveOverview: () => { lastState = hook(); return lastState; } };
  const main = load('../components/language/live/LiveOverview.tsx'); modules['./LiveOverview'] = main;
  const overlay = load('../components/language/live/LiveCalendarOverlay.tsx').default as (props: unknown) => Node;
  const render = (): Node => {
    cursor = 0;
    const result = calendar ? overlay({ state: (modules['./useLiveOverview'] as { useLiveOverview: () => LiveOverviewState }).useLiveOverview(), selectedDateKey, monthKey, onSelectDate: (date: string) => { selectedDateKey = date; } }) : (main.default as () => Node)();
    effects.splice(0).forEach(effect => effect()); return result;
  };
  const button = (label: string) => { const found = nodes(render()).filter(node => node.type === 'button' && textOf(node) === label); assert.equal(found.length, 1); return found[0]; };
  render();
  return { env, render, button, get state() { render(); return lastState; }, refresh() { lastState.refresh(); },
    click(label: string) { const found = button(label); assert.ok(!found.props.disabled); (found.props.onClick as () => void)(); },
    dispatch(name: string) { events.get(name)?.forEach(callback => callback()); },
    auth(id: string | null) { env.owner = id; authCallback?.(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null); },
    runTimers(maxDelay: number) { for (const [id, timer] of [...timers]) if (timer.delay <= maxDelay) { timers.delete(id); timer.fn(); } },
    navigate(date: string, month: string) { selectedDateKey = date; monthKey = month; },
    unmount() { cleanups.forEach(cleanup => cleanup?.()); },
  };
}

test('overview loading, verified empty, and unavailable states never share a false zero or success', async () => {
  const env = environment(); env.read = deferred(); const qa = fixture(env); await flush();
  assert.match(textOf(qa.render()), /기록을 확인하는 중/); assert.doesNotMatch(textOf(qa.render()), /수업 0회|복습 0개|아직 저장한/);
  env.read.reject(new types.LanguageLiveError('schema_unavailable', '합성 미적용 저장소')); await flush();
  assert.match(textOf(qa.render()), /Live 기록을 불러오지 못했어요/); assert.doesNotMatch(textOf(qa.render()), /수업 0회|아직 저장한/);
  env.read = null; env.snapshot = { ownerId: owner, lessons: [], batches: [] }; qa.click('Live 현황 새로고침'); await flush();
  assert.match(textOf(qa.render()), /아직 저장한 AI Live 수업이 없어요/); assert.match(textOf(qa.render()), /수업 0회/);
  assert.doesNotMatch(textOf(qa.render()), /서버 저장 확인/); qa.unmount();
});

test('refresh hides previous success immediately and failed refresh is explicitly stale', async () => {
  const qa = fixture(); await flush(); assert.match(textOf(qa.render()), /합성 현재 수업/);
  qa.env.read = deferred(); qa.click('Live 현황 새로고침'); assert.doesNotMatch(textOf(qa.render()), /합성 현재 수업|기초/);
  qa.env.read.reject(Error('synthetic offline')); await flush();
  assert.equal(qa.state.status, 'stale'); assert.match(textOf(qa.render()), /최신 Live 기록을 다시 확인/);
  assert.doesNotMatch(textOf(qa.render()), /합성 현재 수업|수업 0회/); qa.unmount();
});

test('account A data and in-flight reads cannot appear after B signs in', async () => {
  const qa = fixture(); await flush(); const obsolete = deferred<LiveLearningSnapshot>(); qa.env.read = obsolete; qa.refresh(); await flush();
  qa.auth(other); assert.doesNotMatch(textOf(qa.render()), /합성 현재 수업/);
  qa.env.snapshot = snapshot(other, 'B 계정 수업'); qa.env.read = null; qa.runTimers(0); await flush();
  assert.match(textOf(qa.render()), /B 계정 수업/); obsolete.resolve(snapshot()); await flush();
  assert.match(textOf(qa.render()), /B 계정 수업/); assert.doesNotMatch(textOf(qa.render()), /합성 현재 수업/);
  qa.auth(null); assert.doesNotMatch(textOf(qa.render()), /B 계정 수업/); assert.match(textOf(qa.render()), /로그인 정보를 다시/); qa.unmount();
});

test('late initial identity response cannot reopen an account after signout', async () => {
  const env = environment(); env.authRead = deferred(); const qa = fixture(env); qa.auth(null);
  env.authRead.resolve({ data: { user: { id: owner } }, error: null }); await flush();
  assert.equal(env.reads, 0); assert.match(textOf(qa.render()), /로그인 정보를 다시/); qa.unmount();
});

test('newer refresh, hidden page, and unmount all invalidate earlier snapshots', async () => {
  const qa = fixture(); await flush(); const obsolete = deferred<LiveLearningSnapshot>(); qa.env.read = obsolete; qa.refresh(); await flush();
  qa.env.read = null; qa.env.snapshot = snapshot(owner, '새 탐색의 수업'); qa.dispatch('online'); await flush();
  obsolete.resolve(snapshot()); await flush(); assert.match(textOf(qa.render()), /새 탐색의 수업/);
  qa.env.visibility = 'hidden'; qa.dispatch('visibilitychange'); assert.equal(qa.state.status, 'stale'); assert.doesNotMatch(textOf(qa.render()), /새 탐색의 수업/);
  qa.env.visibility = 'visible'; qa.env.read = deferred(); const delayed = qa.env.read; qa.dispatch('visibilitychange'); await flush(); qa.unmount();
  const oldState = qa.state; delayed.resolve(snapshot()); await flush(); assert.equal(qa.state.status, oldState.status);
});

test('pagehide invalidates an in-flight request and pageshow rereads before showing facts', async () => {
  const qa = fixture(); await flush(); qa.env.read = deferred(); const obsolete = qa.env.read; qa.refresh(); await flush(); qa.dispatch('pagehide');
  obsolete.resolve(snapshot()); await flush(); assert.equal(qa.state.status, 'stale');
  qa.env.read = null; qa.dispatch('pageshow'); await flush(); assert.equal(qa.state.status, 'ready'); qa.unmount();
});

test('Korean midnight refreshes the date even when the page stays open', async () => {
  const env = environment(); env.now = '2026-10-09T14:59:59.900Z'; const qa = fixture(env); await flush(); assert.equal(qa.state.overview?.asOfDate, '2026-10-09');
  env.now = '2026-10-09T15:00:00.100Z'; qa.runTimers(1000); await flush(); assert.equal(qa.state.overview?.asOfDate, '2026-10-10'); qa.unmount();
});

test('main shortcuts carry only allowlisted views and no report data or automatic actions', async () => {
  const qa = fixture(); await flush();
  const links = nodes(qa.render()).filter(node => node.type === 'a').map(node => node.props.href);
  assert.deepEqual(links, ['/language/live?view=import', '/language/live?view=prepare', '/language/live?view=learning', '/language/live?view=history']);
  assert.match(textOf(qa.render()), /쓰기: 미확인/); assert.match(textOf(qa.render()), /현재 학습 단계기초/); qa.unmount();
});

test('calendar selected month/day stay authoritative while reads finish and missing lessons are not no-lesson claims', async () => {
  const env = environment(); env.read = deferred(); const qa = fixture(env, true); await flush();
  qa.navigate('2026-11-01', '2026-11'); env.read.resolve(snapshot()); await flush();
  assert.match(textOf(qa.render()), /2026-11-01 Live 상세/); assert.match(textOf(qa.render()), /2026-11 Live 기록·예정 날짜 0일/);
  qa.navigate('2026-10-08', '2026-10'); assert.match(textOf(qa.render()), /실제로 수업을 하지 않았다는 뜻은 아니에요/);
  qa.navigate('2026-10-09', '2026-10'); assert.match(textOf(qa.render()), /합성 현재 수업/);
  env.read = deferred(); qa.click('Live 달력 새로고침'); env.read.reject(Error('synthetic')); await flush();
  assert.doesNotMatch(textOf(qa.render()), /Live 복습 관찰 0건|합성 현재 수업|Live 상세/); qa.unmount();
});

test('missing connection is a blocking error with accessible navigation, never an empty history', async () => {
  const env = environment(); env.configured = false; const qa = fixture(env); await flush();
  assert.match(textOf(qa.render()), /Live 저장소 연결 설정/); assert.doesNotMatch(textOf(qa.render()), /아직 저장한/);
  assert.equal(nodes(qa.render()).filter(node => node.type === 'a').length, 4); qa.unmount();
});
