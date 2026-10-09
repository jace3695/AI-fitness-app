import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as drafts from '../app/language/live/learning-draft.ts';
import * as draftState from '../app/language/live/draft-state.ts';
import * as validation from '../lib/language-live/learning-validation.ts';
import * as reducer from '../lib/language-live/state-reducer.ts';
import * as types from '../lib/language-live/types.ts';
import { parseLiveReport } from '../lib/language-live/report-parser.ts';
import type { LiveLearningBatch, LiveLearningSnapshot, SaveLiveLearningInput } from '../lib/language-live/learning-types.ts';

const owner = randomUUID(), other = randomUUID();
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function lesson(id = owner): types.LiveLesson {
  return { user_id: id, lesson_id: randomUUID(), revision: 1, previous_revision: 0, operation: 'create', report: parseLiveReport('[연이 AI 일본어 학습 기록 v1.1]\n학습 날짜: 2026-10-09\n수업 주제: 합성 복습\n읽기 학습 결과: え를 배웠다.'), created_at: '2026-10-09T12:00:00Z', request_id: randomUUID(), payload_hash: 'synthetic', duplicate_reason: null, restored_from_revision: null };
}
function environment(id = owner) {
  return { storage: new Map<string, string>(), snapshot: { ownerId: id, lessons: [lesson(id)], batches: [] } as LiveLearningSnapshot,
    read: null as ReturnType<typeof deferred<LiveLearningSnapshot>> | null, reads: 0,
    save: null as ReturnType<typeof deferred<LiveLearningBatch>> | null, calls: [] as SaveLiveLearningInput[], quota: false };
}
function pending(env: ReturnType<typeof environment>) {
  const draft = drafts.createLearningDraft(env.snapshot.ownerId, env.snapshot.lessons[0], undefined, { draftId: randomUUID(), requestId: randomUUID(), now: '2026-10-09T12:00:00Z' });
  draft.reviewed = true; draft.submitted = true; draft.input.changeReason = '확인한 빈 목록';
  env.storage.set(drafts.learningDraftKey(draft.ownerId, draft.draftId), JSON.stringify(draft)); return draft;
}
type Node = { type: unknown; props: Record<string, unknown> };
const element = (type: unknown, props: Record<string, unknown>): Node => ({ type, props });
function children(node: unknown): Node[] {
  if (Array.isArray(node)) return node.flatMap(children);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  return [node as Node, ...children((node as Node).props.children)];
}
function textOf(node: unknown): string {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node && typeof node === 'object' && 'props' in node) return textOf((node as Node).props.children);
  return '';
}

// Execute the shipping component with deterministic React-hook, storage and
// repository boundaries. No DOM/browser/visual acceptance is implied.
function fixture(env = environment()) {
  const slots: unknown[] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [];
  const events = new Map<string, Set<(...args: unknown[]) => void>>();
  let cursor = 0, active = true;
  const memo = (factory: () => unknown, deps: unknown[]) => {
    const slot = cursor++, old = slots[slot] as { deps: unknown[]; value: unknown } | undefined;
    if (!old || old.deps.length !== deps.length || old.deps.some((value, index) => value !== deps[index])) slots[slot] = { deps, value: factory() };
    return (slots[slot] as { value: unknown }).value;
  };
  const repository = {
    async readLearning() { env.reads++; return env.read ? env.read.promise : structuredClone(env.snapshot); },
    async saveLearning(input: SaveLiveLearningInput) {
      env.calls.push(structuredClone(input));
      if (env.save) return env.save.promise;
      return { user_id: env.snapshot.ownerId, lesson_id: input.lessonId, lesson_revision: input.lessonRevision, version: input.expectedVersion + 1, previous_version: input.expectedVersion, request_id: input.requestId, payload: structuredClone(input), payload_hash: 'synthetic', created_at: '2026-10-09T12:00:00Z' };
    },
  };
  const storage = { get length() { return env.storage.size; }, key: (index: number) => [...env.storage.keys()][index] ?? null,
    getItem: (key: string) => env.storage.get(key) ?? null,
    setItem(key: string, value: string) { if (env.quota) throw Error('quota'); env.storage.set(key, value); }, removeItem: (key: string) => { env.storage.delete(key); } };
  const eventTarget = {
    addEventListener(name: string, callback: (...args: unknown[]) => void) { if (!events.has(name)) events.set(name, new Set()); events.get(name)!.add(callback); },
    removeEventListener(name: string, callback: (...args: unknown[]) => void) { events.get(name)?.delete(callback); },
  };
  const modules = {
    react: {
      useState(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial; return [slots[slot], (value: unknown) => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; },
      useRef(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
      useMemo: memo, useCallback: (fn: () => unknown, deps: unknown[]) => memo(() => fn, deps),
      useEffect(effect: () => void, deps: unknown[]) { const slot = cursor++, old = slots[slot] as unknown[] | undefined; if (!old || old.length !== deps.length || old.some((value, index) => value !== deps[index])) { slots[slot] = deps; effects.push(() => { cleanups[slot]?.(); const cleanup = effect(); if (typeof cleanup === 'function') cleanups[slot] = cleanup; }); } },
    },
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'fragment' },
    '@/app/data/languageLiveLearningRepository': { createLanguageLiveLearningRepository: () => repository },
    '@/app/language/live/draft-state': draftState, '@/app/language/live/learning-draft': drafts,
    '@/lib/language-live/learning-validation': validation, '@/lib/language-live/state-reducer': reducer,
    '@/lib/language-live/types': types,
    './LearningDashboard': { __esModule: true, default: 'LearningDashboard', LearningEventSummary: 'LearningEventSummary' },
    './LearningEventEditor': { __esModule: true, default: 'LearningEventEditor' },
  };
  const exports = {} as { default: (props: unknown) => Node };
  const source = ts.transpileModule(readFileSync(new URL('../components/language/live/LiveLearningWorkspace.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, { Error, Date, Intl, crypto, structuredClone,
    window: { localStorage: storage, confirm: () => false, ...eventTarget }, document: { visibilityState: 'visible', ...eventTarget },
  })(exports, (name: string) => { assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name as keyof typeof modules]; });
  const busy: boolean[] = [], onBusyChange = (value: boolean) => busy.push(value), client = {};
  const render = () => { cursor = 0; const result = exports.default({ owner: env.snapshot.ownerId, client, active, onBusyChange }); effects.splice(0).forEach(effect => effect()); return result; };
  const find = (predicate: (node: Node) => boolean) => { const found = children(render()).filter(predicate); assert.equal(found.length, 1, 'one matching rendered control'); return found[0]; };
  const button = (label: string | RegExp) => find(node => node.type === 'button' && (typeof label === 'string' ? textOf(node) === label : label.test(textOf(node))));
  const click = (label: string | RegExp) => { const control = button(label); assert.ok(!control.props.disabled, `enabled: ${label}`); return (control.props.onClick as () => unknown)(); };
  const change = (id: string, value: string) => { const control = find(node => node.props.id === id); assert.ok(!control.props.disabled); (control.props.onChange as (event: unknown) => void)({ target: { value } }); };
  render(); return { env, render, button, click, change, busy, find, nodes: () => children(render()), setActive(value: boolean) { active = value; render(); }, unmount: () => cleanups.forEach(cleanup => cleanup?.()) };
}

test('shipping learning UI preserves exact pending request and handles repeated clicks only once', async () => {
  const env = environment(), original = pending(env), qa = fixture(env); await flush();
  qa.click(/복습 초안 ·/); env.save = deferred(); qa.click('같은 요청으로 복습 저장 다시 확인');
  assert.equal(qa.env.calls.length, 1); assert.equal(qa.button('같은 요청으로 복습 저장 다시 확인').props.disabled, true);
  assert.deepEqual(qa.env.calls[0], original.input);
  assert.equal(qa.find(node => node.props.id === 'live-learning-change-reason').props.disabled, true);
  env.save.reject(new types.LanguageLiveError('verification', '합성 응답 유실')); await flush();
  assert.equal(qa.button('같은 요청으로 복습 저장 다시 확인').props.disabled, false);
  assert.equal(qa.nodes().some(node => node.props.role === 'status' && textOf(node).includes('복습 서버 저장 확인')), false);
  env.save = null; qa.click('같은 요청으로 복습 저장 다시 확인'); await flush();
  assert.deepEqual(qa.env.calls, [original.input, original.input]);
  assert.equal(qa.nodes().some(node => node.props.role === 'status' && textOf(node).includes('복습 서버 저장 확인')), true);
  assert.ok(env.storage.has(drafts.learningDraftKey(owner, original.draftId)), 'original recovery key remains'); qa.unmount();
});

test('pending retry failure during a snapshot read never strands loading or displays stale state', async () => {
  const env = environment(); pending(env); const obsolete = deferred<LiveLearningSnapshot>(); env.read = obsolete;
  const qa = fixture(env); qa.click(/복습 초안 ·/); env.save = deferred(); qa.click('같은 요청으로 복습 저장 다시 확인');
  env.read = null; env.save.reject(new types.LanguageLiveError('verification', '합성 재조회 실패')); await flush();
  assert.equal(qa.button('복습 기록 새로고침').props.disabled, false);
  assert.ok(env.reads >= 2, 'the interrupted snapshot read is replaced after the save settles');
  obsolete.resolve({ ownerId: owner, lessons: [], batches: [] }); await flush();
  assert.match(textOf(qa.render()), /현재 보관한 수업 1회/); qa.unmount();
});

test('obsolete read after tab dismissal cannot replace the newly reopened snapshot', async () => {
  const env = environment(), qa = fixture(env); await flush();
  const delayed = deferred<LiveLearningSnapshot>(); env.read = delayed; qa.click('복습 기록 새로고침'); qa.setActive(false);
  env.read = null; qa.setActive(true); await flush(); delayed.resolve({ ownerId: owner, lessons: [], batches: [] }); await flush();
  assert.match(textOf(qa.render()), /현재 보관한 수업 1회/); qa.unmount();
});

test('owner A pending receipt cannot clear A recovery or appear after mounting owner B', async () => {
  const env = environment(), original = pending(env), a = fixture(env); await flush(); a.click(/복습 초안 ·/);
  const delayed = deferred<LiveLearningBatch>(); env.save = delayed; a.click('같은 요청으로 복습 저장 다시 확인');
  const copied = [...env.storage.entries()]; a.unmount(); const otherEnv = environment(other); otherEnv.storage = env.storage; const b = fixture(otherEnv); await flush();
  delayed.resolve({ user_id: owner, lesson_id: original.input.lessonId, lesson_revision: 1, version: 1, previous_version: 0, request_id: original.input.requestId, payload: original.input, payload_hash: 'synthetic', created_at: '2026-10-09T12:00:00Z' }); await flush();
  assert.deepEqual([...env.storage.entries()], copied); assert.doesNotMatch(textOf(b.render()), /복습 서버 저장 확인|복습 기기 초안/); b.unmount();
});

test('quota failure preserves visible text, prevents requests and blocks replacing the unsaved draft', async () => {
  const qa = fixture(); await flush(); qa.change('live-learning-lesson', qa.env.snapshot.lessons[0].lesson_id); qa.click('이 수업의 근거 확인 시작');
  qa.env.quota = true; qa.change('live-learning-change-reason', '기기 보관 실패 입력');
  assert.equal(qa.find(node => node.props.id === 'live-learning-change-reason').props.value, '기기 보관 실패 입력');
  assert.equal(qa.button('이 수업의 근거 확인 시작').props.disabled, true); assert.equal(qa.env.calls.length, 0); qa.unmount();
});

test('two tabs recover into different writable keys and preserve the original draft', async () => {
  const env = environment(), original = pending(env); original.submitted = false;
  const originalKey = drafts.learningDraftKey(owner, original.draftId);
  env.storage.set(originalKey, JSON.stringify(original));
  const a = fixture(env), b = fixture(env); await flush();
  a.click(/복습 초안 ·/); b.click(/복습 초안 ·/);
  a.change('live-learning-change-reason', 'A 확인'); b.change('live-learning-change-reason', 'B 확인');
  assert.equal(env.storage.size, 3); assert.equal(env.storage.get(originalKey), JSON.stringify(original));
  assert.equal(a.find(node => node.props.id === 'live-learning-change-reason').props.value, 'A 확인');
  assert.equal(b.find(node => node.props.id === 'live-learning-change-reason').props.value, 'B 확인');
  assert.equal(env.calls.length, 0); a.unmount(); b.unmount();
});

test('entry edits reset confirmation and cancel/clear cancellation cannot alter saved observations', async () => {
  const qa = fixture(); await flush(); qa.change('live-learning-lesson', qa.env.snapshot.lessons[0].lesson_id); qa.click('이 수업의 근거 확인 시작');
  qa.click('관찰 한 건 추가');
  const editor = () => qa.find(node => node.type === 'LearningEventEditor');
  const initial = editor().props.entry as ReturnType<typeof drafts.blankLearningEvent>;
  const confirmed = { ...initial, item: { ...initial.item, text: 'え' }, certainty: 'confirmed' as const, evidenceText: 'え를 배웠다.', reason: '명시적 근거' };
  (editor().props.onChange as (value: unknown) => void)(confirmed);
  (editor().props.onReview as (value: boolean) => void)(true);
  assert.equal(editor().props.reviewed, true);
  (editor().props.onChange as (value: unknown) => void)({ ...confirmed, reason: '근거 재확인' });
  assert.equal(editor().props.reviewed, false);
  (editor().props.onConfirm as () => void)(); assert.equal(qa.nodes().filter(node => node.type === 'LearningEventSummary').length, 0);
  (editor().props.onReview as (value: boolean) => void)(true); (editor().props.onConfirm as () => void)();
  qa.click('이 관찰 수정'); (editor().props.onChange as (value: unknown) => void)({ ...confirmed, occurredDate: '2026-10-08' });
  (editor().props.onCancel as () => void)();
  assert.equal((qa.find(node => node.type === 'LearningEventSummary').props.event as typeof confirmed).occurredDate, '2026-10-09');
  qa.click('모든 관찰 비우기'); qa.click('비우기 취소');
  assert.equal(qa.nodes().filter(node => node.type === 'LearningEventSummary').length, 1);
  qa.click('이 복습 초안 지우기'); qa.click('초안 지우기 취소');
  assert.equal(qa.nodes().filter(node => node.type === 'LearningEventSummary').length, 1); assert.equal(qa.env.calls.length, 0); qa.unmount();
});

test('failed snapshot hides the dashboard rather than treating history as empty', async () => {
  const qa = fixture(); await flush(); assert.equal(qa.nodes().filter(node => node.type === 'LearningDashboard').length, 1);
  qa.env.read = deferred(); qa.click('복습 기록 새로고침');
  assert.equal(qa.nodes().filter(node => node.type === 'LearningDashboard').length, 0);
  qa.env.read.reject(new types.LanguageLiveError('schema_unavailable', '합성 저장소 없음')); await flush();
  assert.equal(qa.nodes().filter(node => node.type === 'LearningDashboard').length, 0);
  assert.match(textOf(qa.render()), /기록이 없는 상태로 처리하지 않았어요/);
  assert.doesNotMatch(textOf(qa.render()), /먼저 보고서 가져오기에서 수업을 저장해 주세요/); qa.unmount();
});
