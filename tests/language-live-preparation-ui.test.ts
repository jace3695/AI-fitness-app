import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as drafts from '../app/language/live/preparation-draft.ts';
import * as draftState from '../app/language/live/draft-state.ts';
import * as validation from '../lib/language-live/preparation-validation.ts';
import * as preparation from '../lib/language-live/preparation.ts';
import * as prepTypes from '../lib/language-live/preparation-types.ts';
import * as review from '../lib/language-live/review-policy.ts';
import * as types from '../lib/language-live/types.ts';
import { parseLiveReport } from '../lib/language-live/report-parser.ts';
import type { LiveLearningSnapshot } from '../lib/language-live/learning-types.ts';

const owner = randomUUID(), other = randomUUID();
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function record(input: prepTypes.SaveLivePreparationInput): prepTypes.LivePreparationRecord { return { user_id: input.preparation.source.ownerId, preparation_id: input.preparationId, revision: input.expectedRevision + 1, previous_revision: input.expectedRevision, request_id: input.requestId, payload: structuredClone(input), payload_hash: 'synthetic', created_at: '2026-10-09T12:00:00Z' }; }
function environment(id = owner) {
  return { storage: new Map<string, string>(), snapshot: { ownerId: id, lessons: [], batches: [] } as LiveLearningSnapshot,
    read: null as ReturnType<typeof deferred<LiveLearningSnapshot>> | null, records: [] as prepTypes.LivePreparationRecord[], historyError: false,
    historyRead: null as ReturnType<typeof deferred<prepTypes.LivePreparationRecord[]>> | null, cleanupFailure: false,
    save: null as ReturnType<typeof deferred<prepTypes.LivePreparationRecord>> | null, calls: [] as prepTypes.SaveLivePreparationInput[], quota: false,
    clipboard: null as ReturnType<typeof deferred<void>> | null, copies: [] as string[] };
}
function pending(env: ReturnType<typeof environment>) {
  const draft = drafts.createPreparationDraft(env.snapshot.ownerId, preparation.buildLivePreparation(env.snapshot, '2026-10-10'), { draftId: randomUUID(), requestId: randomUUID(), preparationId: randomUUID(), now: '2026-10-09T12:00:00Z' });
  draft.reviewed = true; draft.submitted = true; env.storage.set(drafts.preparationDraftKey(draft.ownerId, draft.draftId), JSON.stringify(draft)); return draft;
}
type Node = { type: unknown; props: Record<string, unknown> };
const element = (type: unknown, props: Record<string, unknown>): Node => ({ type, props });
function children(node: unknown): Node[] { if (Array.isArray(node)) return node.flatMap(children); if (!node || typeof node !== 'object' || !('props' in node)) return []; return [node as Node, ...children((node as Node).props.children)]; }
function textOf(node: unknown): string { if (Array.isArray(node)) return node.map(textOf).join(''); if (typeof node === 'string' || typeof node === 'number') return String(node); if (node && typeof node === 'object' && 'props' in node) return textOf((node as Node).props.children); return ''; }
// Execute shipping component with hook/storage/repository/clipboard boundaries.
// These tests do not substitute for actual authenticated browser/visual acceptance.
function fixture(env = environment()) {
  const slots: unknown[] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [];
  const events = new Map<string, Set<(...args: unknown[]) => void>>(); let cursor = 0, active = true;
  const memo = (factory: () => unknown, deps: unknown[]) => { const slot = cursor++, old = slots[slot] as { deps: unknown[]; value: unknown } | undefined; if (!old || old.deps.length !== deps.length || old.deps.some((value, index) => value !== deps[index])) slots[slot] = { deps, value: factory() }; return (slots[slot] as { value: unknown }).value; };
  const repository = {
    async listPreparations() { if (env.historyError) throw new types.LanguageLiveError('schema_unavailable', '합성 준비 저장소 없음'); if (env.historyRead) return env.historyRead.promise; return structuredClone(env.records); },
    async savePreparation(input: prepTypes.SaveLivePreparationInput) { env.calls.push(structuredClone(input)); if (env.save) return env.save.promise; const result = record(input); env.records.push(result); return result; },
  };
  const storage = { get length() { return env.storage.size; }, key: (index: number) => [...env.storage.keys()][index] ?? null,
    getItem: (key: string) => env.storage.get(key) ?? null, setItem(key: string, value: string) { if (env.quota) throw Error('quota'); env.storage.set(key, value); }, removeItem: (key: string) => { if (env.cleanupFailure) throw Error('cleanup'); env.storage.delete(key); } };
  const target = { addEventListener(name: string, callback: (...args: unknown[]) => void) { if (!events.has(name)) events.set(name, new Set()); events.get(name)!.add(callback); }, removeEventListener(name: string, callback: (...args: unknown[]) => void) { events.get(name)?.delete(callback); } };
  const modules = {
    react: {
      useState(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial; return [slots[slot], (value: unknown) => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }]; },
      useRef(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
      useMemo: memo, useCallback: (fn: () => unknown, deps: unknown[]) => memo(() => fn, deps),
      useEffect(effect: () => void, deps: unknown[]) { const slot = cursor++, old = slots[slot] as unknown[] | undefined; if (!old || old.length !== deps.length || old.some((value, index) => value !== deps[index])) { slots[slot] = deps; effects.push(() => { cleanups[slot]?.(); const cleanup = effect(); if (typeof cleanup === 'function') cleanups[slot] = cleanup; }); } },
    },
    'react/jsx-runtime': { jsx: element, jsxs: element, Fragment: 'fragment' },
    '@/app/data/languageLiveLearningRepository': { createLanguageLiveLearningRepository: () => ({ readLearning: async () => env.read ? env.read.promise : structuredClone(env.snapshot) }) },
    '@/app/data/languageLivePreparationRepository': { createLanguageLivePreparationRepository: () => repository },
    '@/app/language/live/draft-state': draftState, '@/app/language/live/preparation-draft': drafts,
    '@/lib/language-live/preparation': preparation, '@/lib/language-live/preparation-validation': validation,
    '@/lib/language-live/preparation-types': prepTypes, '@/lib/language-live/review-policy': review, '@/lib/language-live/types': types,
  };
  const exports = {} as { default: (props: unknown) => Node };
  const source = ts.transpileModule(readFileSync(new URL('../components/language/live/LivePreparationWorkspace.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(`(function(exports, require) { ${source}\n})`, { Error, Date, Intl, crypto, structuredClone,
    window: { localStorage: storage, confirm: () => false, ...target }, document: { visibilityState: 'visible', ...target },
    navigator: { clipboard: { writeText: async (value: string) => { if (env.clipboard) await env.clipboard.promise; env.copies.push(value); } } },
  })(exports, (name: string) => { assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name as keyof typeof modules]; });
  const busy: boolean[] = [], onBusyChange = (value: boolean) => busy.push(value), client = {};
  const render = () => { cursor = 0; const result = exports.default({ owner: env.snapshot.ownerId, client, active, onBusyChange }); effects.splice(0).forEach(effect => effect()); return result; };
  const find = (predicate: (node: Node) => boolean) => { const found = children(render()).filter(predicate); assert.equal(found.length, 1, 'one matching rendered control'); return found[0]; };
  const button = (label: string | RegExp) => find(node => node.type === 'button' && (typeof label === 'string' ? textOf(node) === label : label.test(textOf(node))));
  const click = (label: string | RegExp) => { const control = button(label); assert.ok(!control.props.disabled, `enabled: ${label}`); return (control.props.onClick as () => unknown)(); };
  const change = (id: string, value: string) => { const control = find(node => node.props.id === id); assert.ok(!control.props.disabled); (control.props.onChange as (event: unknown) => void)({ target: { value } }); };
  const check = () => { const control = find(node => node.type === 'input' && node.props.type === 'checkbox'); (control.props.onChange as (event: unknown) => void)({ target: { checked: true } }); };
  render(); return { env, render, button, click, change, check, busy, find, nodes: () => children(render()), dispatch(name: string, event: unknown) { events.get(name)?.forEach(callback => callback(event)); }, setActive(value: boolean) { active = value; render(); }, unmount: () => cleanups.forEach(cleanup => cleanup?.()) };
}

test('preparation preview is deterministic, requires review and stores exact original plus edits before copying', async () => {
  const qa = fixture(); await flush(); qa.click('최신 자료로 새 지시문 생성');
  assert.equal(qa.button('확인본 서버에 저장').props.disabled, true);
  qa.change('live-preparation-text', '개인 검토 수정본'); qa.check(); await qa.click('확인본 서버에 저장'); await flush();
  assert.equal(qa.env.calls[0].editedText, '개인 검토 수정본'); assert.match(qa.env.calls[0].preparation.generatedText, /첫 수업용/);
  assert.match(textOf(qa.render()), /수업 준비 서버 저장 확인/); await qa.click('수업 지시문 복사'); await flush();
  assert.deepEqual(qa.env.copies, ['개인 검토 수정본']); assert.match(textOf(qa.render()), /클립보드에 복사했어요/); qa.unmount();
});
test('edits invalidate review, cancel and close preserve local draft without a server mutation', async () => {
  const qa = fixture(); await flush(); qa.click('최신 자료로 새 지시문 생성'); qa.check(); qa.change('live-preparation-text', '확인 후 수정');
  assert.equal(qa.button('확인본 서버에 저장').props.disabled, true);
  qa.click('이 준비 초안 지우기'); qa.click('초안 지우기 취소'); assert.equal(qa.env.storage.size, 1);
  qa.click('지시문 닫기'); assert.equal(qa.env.storage.size, 1); assert.equal(qa.env.calls.length, 0);
  qa.click(/^준비 초안 ·/); assert.equal(qa.find(node => node.props.id === 'live-preparation-text').props.value, '확인 후 수정'); assert.equal(qa.env.storage.size, 2); qa.unmount();
});
test('lost readback freezes exact request and repeated clicks cannot duplicate saves', async () => {
  const env = environment(), original = pending(env), qa = fixture(env); await flush(); qa.click(/^준비 초안 ·/);
  env.save = deferred(); qa.click('같은 요청으로 준비 저장 다시 확인'); assert.equal(qa.button('같은 요청으로 준비 저장 다시 확인').props.disabled, true);
  assert.deepEqual(env.calls, [original.input]); env.save.reject(new types.LanguageLiveError('verification', '합성 응답 유실')); await flush();
  assert.equal(qa.find(node => node.props.id === 'live-preparation-text').props.disabled, true); assert.doesNotMatch(textOf(qa.render()), /수업 준비 서버 저장 확인/);
  env.save = null; await qa.click('같은 요청으로 준비 저장 다시 확인'); await flush(); assert.deepEqual(env.calls, [original.input, original.input]); qa.unmount();
});
test('copy rechecks exact current source and rejects a newer report before clipboard transmission', async () => {
  const qa = fixture(); await flush(); qa.click('최신 자료로 새 지시문 생성'); qa.check(); await qa.click('확인본 서버에 저장'); await flush();
  qa.env.snapshot.lessons.push({ user_id: owner, lesson_id: randomUUID(), revision: 1, previous_revision: 0, operation: 'create', request_id: randomUUID(), payload_hash: 'new', created_at: '2026-10-09T18:00:00Z', restored_from_revision: null, duplicate_reason: null, report: parseLiveReport('학습 날짜: 2026-10-09\n수업 주제: 변경된 새 수업') });
  await qa.click('수업 지시문 복사'); await flush(); assert.deepEqual(qa.env.copies, []); assert.match(textOf(qa.render()), /생성 뒤 학습 기록이 바뀌었어요/); assert.equal(qa.button('수업 지시문 복사').props.disabled, true); qa.unmount();
});
test('cancelled copy freshness read cannot write clipboard or replace a newly opened preview', async () => {
  const qa = fixture(); await flush(); qa.click('최신 자료로 새 지시문 생성'); qa.check(); await qa.click('확인본 서버에 저장'); await flush();
  qa.env.read = deferred(); const read = qa.env.read; qa.click('수업 지시문 복사'); qa.click('복사 확인 취소'); qa.click('지시문 닫기');
  qa.env.read = null; qa.click('최신 자료로 새 지시문 생성'); read.resolve(qa.env.snapshot); await flush();
  assert.deepEqual(qa.env.copies, []); assert.equal(qa.find(node => node.props.id === 'live-preparation-text').props.disabled, false); qa.unmount();
});
test('clipboard denial never claims success and offers manual selection', async () => {
  const qa = fixture(); await flush(); qa.click('최신 자료로 새 지시문 생성'); qa.check(); await qa.click('확인본 서버에 저장'); await flush();
  qa.env.clipboard = deferred(); qa.click('수업 지시문 복사'); await flush(); qa.env.clipboard.reject(Error('denied')); await flush();
  assert.match(textOf(qa.render()), /자동 복사를 허용하지 않았거나/); assert.doesNotMatch(textOf(qa.render()), /클립보드에 복사했어요/); assert.equal(qa.button('지시문 전체 선택').props.disabled, false); qa.unmount();
});
test('source errors block first-lesson generation while history errors retain usable local preview without empty-history claims', async () => {
  const env = environment(); env.read = deferred(); const qa = fixture(env); env.read.reject(new types.LanguageLiveError('storage', '합성 조회 오류')); await flush();
  assert.equal(qa.button('최신 자료로 새 지시문 생성').props.disabled, true); assert.match(textOf(qa.render()), /기록이 없는 상태로 처리하지 않았어요/);
  env.read = null; env.historyError = true; await qa.click('준비 자료 새로고침'); await flush(); qa.click('최신 자료로 새 지시문 생성'); qa.check();
  assert.equal(qa.button('확인본 서버에 저장').props.disabled, true); assert.doesNotMatch(textOf(qa.render()), /아직 서버에 저장한 수업 준비가 없어요/); qa.unmount();
});
test('account switch ignores late save and retains owner A recovery without displaying it to B', async () => {
  const env = environment(), original = pending(env), a = fixture(env); await flush(); a.click(/^준비 초안 ·/); env.save = deferred(); const delayed = env.save;
  a.click('같은 요청으로 준비 저장 다시 확인'); const before = [...env.storage.entries()]; a.unmount();
  const bEnv = environment(other); bEnv.storage = env.storage; const b = fixture(bEnv); await flush(); delayed.resolve(record(original.input)); await flush();
  assert.deepEqual([...env.storage.entries()], before); assert.doesNotMatch(textOf(b.render()), /준비 초안 ·|수업 준비 서버 저장 확인/); b.unmount();
});
test('separate recovered tab drafts and quota failure preserve both inputs without overwriting the source', async () => {
  const env = environment(), original = pending(env); original.submitted = false;
  const key = drafts.preparationDraftKey(owner, original.draftId); env.storage.set(key, JSON.stringify(original));
  const a = fixture(env), b = fixture(env); await flush(); a.click(/^준비 초안 ·/); b.click(/^준비 초안 ·/);
  a.change('live-preparation-text', 'A 편집'); b.change('live-preparation-text', 'B 편집'); assert.equal(env.storage.size, 3); assert.equal(env.storage.get(key), JSON.stringify(original));
  env.quota = true; a.change('live-preparation-text', '기기 보관 실패 편집'); assert.equal(a.find(node => node.props.id === 'live-preparation-text').props.value, '기기 보관 실패 편집');
  assert.equal(a.button('최신 자료로 새 지시문 생성').props.disabled, true); assert.equal(a.button('지시문 닫기').props.disabled, true); assert.equal(b.find(node => node.props.id === 'live-preparation-text').props.value, 'B 편집'); a.unmount(); b.unmount();
});
test('newer preparation revision blocks an old draft and stale inactive reads cannot replace reopened history', async () => {
  const qa = fixture(); await flush(); qa.click('최신 자료로 새 지시문 생성'); qa.check(); await qa.click('확인본 서버에 저장'); await flush(); qa.click('이 버전으로 수정 시작');
  const latest = qa.env.records[0]; qa.env.records.push(record({ ...latest.payload, requestId: randomUUID(), expectedRevision: 1, editedText: '다른 탭 수정' }));
  await qa.click('준비 자료 새로고침'); await flush(); qa.check(); assert.equal(qa.button('확인본 서버에 저장').props.disabled, true); assert.match(textOf(qa.render()), /다른 곳에서 더 최신 준비 버전/);
  const obsolete = deferred<LiveLearningSnapshot>(); qa.env.read = obsolete; qa.click('준비 자료 새로고침'); qa.setActive(false); qa.env.read = null; qa.setActive(true); await flush();
  obsolete.reject(Error('obsolete')); await flush(); assert.doesNotMatch(textOf(qa.render()), /생성·복사를 보류/); qa.unmount();
});


test('unreadable unrelated recovery is preserved without blocking a valid new preparation', async () => {
  const env = environment(); env.storage.set(drafts.preparationDraftKey(owner, randomUUID()), '{invalid');
  const qa = fixture(env); await flush(); assert.match(textOf(qa.render()), /읽을 수 없는 수업 준비 초안/);
  qa.click('최신 자료로 새 지시문 생성'); qa.check(); assert.equal(qa.button('확인본 서버에 저장').props.disabled, false);
  await qa.click('확인본 서버에 저장'); await flush(); assert.equal(env.calls.length, 1); assert.equal(env.storage.size, 1); qa.unmount();
});

test('a verified saved preview can close when local cleanup fails without hiding the recovery warning', async () => {
  const qa = fixture(); await flush(); qa.click('최신 자료로 새 지시문 생성'); qa.check(); qa.env.cleanupFailure = true;
  await qa.click('확인본 서버에 저장'); await flush(); assert.equal(qa.env.storage.size, 1);
  assert.match(textOf(qa.render()), /서버 저장은 확인했지만 기기 초안 보관본은 남아/);
  qa.click('지시문 닫기'); assert.equal(qa.nodes().some(node => node.props.id === 'live-preparation-copy-text'), false);
  assert.match(textOf(qa.render()), /서버 저장은 확인했지만 기기 초안 보관본은 남아/); qa.unmount();
});

test('editing is blocked until latest history settles and latest revision stays in its original lineage', async () => {
  const qa = fixture(); await flush(); qa.click('최신 자료로 새 지시문 생성'); qa.check(); qa.env.historyRead = deferred();
  await qa.click('확인본 서버에 저장'); await flush(); assert.equal(qa.button('이 버전으로 수정 시작').props.disabled, true);
  const first = qa.env.records[0]; qa.env.historyRead.resolve(qa.env.records); await flush(); qa.env.historyRead = null;
  qa.click('이 버전으로 수정 시작'); qa.change('live-preparation-text', '두 번째 수정'); qa.check(); await qa.click('확인본 서버에 저장'); await flush();
  assert.equal(qa.env.calls[1].preparationId, first.preparation_id); assert.equal(qa.env.calls[1].expectedRevision, 1); qa.unmount();
});

test('older history edit explicitly forks a separate preparation and preserves the existing versions', async () => {
  const qa = fixture(); await flush(); qa.click('최신 자료로 새 지시문 생성'); qa.check(); await qa.click('확인본 서버에 저장'); await flush();
  qa.click('이 버전으로 수정 시작'); qa.change('live-preparation-text', '두 번째 수정'); qa.check(); await qa.click('확인본 서버에 저장'); await flush();
  const before = structuredClone(qa.env.records); qa.click('준비 버전 1 보기'); assert.match(textOf(qa.render()), /과거 버전의 수정은 별도 준비문/);
  qa.click('이 버전으로 수정 시작'); qa.check(); await qa.click('확인본 서버에 저장'); await flush();
  assert.notEqual(qa.env.calls[2].preparationId, before[0].preparation_id); assert.equal(qa.env.calls[2].expectedRevision, 0);
  assert.equal(qa.env.calls[2].editedText, before[0].payload.editedText); assert.deepEqual(qa.env.records.slice(0, 2), before); qa.unmount();
});

test('source refresh failure disables manual copy fallback as well as automatic copying', async () => {
  const qa = fixture(); await flush(); qa.click('최신 자료로 새 지시문 생성'); qa.check(); await qa.click('확인본 서버에 저장'); await flush();
  qa.env.clipboard = deferred(); qa.click('수업 지시문 복사'); await flush(); qa.env.clipboard.reject(Error('denied')); await flush();
  qa.env.read = deferred(); const reading = qa.click('준비 자료 새로고침'); qa.env.read.reject(Error('offline')); await reading; await flush();
  assert.deepEqual(qa.env.copies, []); assert.equal(qa.button('지시문 전체 선택').props.disabled, true); qa.unmount();
});

test('clearing local storage from another tab marks the current input unprotected and does not discard it', async () => {
  const qa = fixture(); await flush(); qa.click('최신 자료로 새 지시문 생성'); qa.change('live-preparation-text', '보관 상태를 잃은 입력');
  qa.env.storage.clear(); qa.dispatch('storage', { key: null, newValue: null });
  assert.equal(qa.find(node => node.props.id === 'live-preparation-text').props.value, '보관 상태를 잃은 입력');
  assert.equal(qa.button('지시문 닫기').props.disabled, true); assert.match(textOf(qa.render()), /별도 초안/); qa.unmount();
});

test('a clipboard write already handed to the browser can finish after owner switch without a false B success', async () => {
  const a = fixture(); await flush(); a.click('최신 자료로 새 지시문 생성'); a.change('live-preparation-text', 'A 계정의 확인본'); a.check(); await a.click('확인본 서버에 저장'); await flush();
  a.env.clipboard = deferred(); a.click('수업 지시문 복사'); await flush(); assert.deepEqual(a.env.copies, []);
  assert.match(textOf(a.render()), /쓰기 요청 후에는.*취소할 수 없/); assert.equal(a.nodes().some(node => node.type === 'button' && textOf(node) === '복사 확인 취소'), false);
  a.unmount(); const b = fixture(environment(other)); await flush(); a.env.clipboard.resolve(); await flush();
  assert.deepEqual(a.env.copies, ['A 계정의 확인본']); assert.deepEqual(b.env.copies, []); assert.doesNotMatch(textOf(b.render()), /클립보드에 복사했어요|A 계정의 확인본/); b.unmount();
});
