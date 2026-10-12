import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import ts from 'typescript';
import * as learningSession from '../../utils/learningSession.ts';
import * as cloud from '../../app/data/languageCloudSync.ts';
import * as mutations from '../../app/data/languageRecordMutations.ts';
import * as documents from '../../app/data/languageRecordDocuments.ts';
import * as identity from '../../app/data/languageRecordIdentity.ts';
import * as dates from '../../utils/dateKey.ts';
import { planReviewMutation, verifyCourseReview } from '../../app/data/languageReviewMutations.ts';
import type { useLanguageMutationAction } from '../../components/language/useLanguageMutationAction.ts';
import type * as Capture from '../../app/data/languageLegacyReviewCapture.ts';
import { nodes, textOf, type UiNode } from './storage-ui-fixture.ts';

/** Source TSX plus a deterministic hook/host-commit fixture. This is not React DOM,
 * a browser engine, pixel/eye-attention evidence, or real requestAnimationFrame.
 * Unlike the older storage UI helper, refs are attached before passive effects,
 * and render, passive effects, and the two frame callbacks can be held separately.
 * The question, visibility predicate, and adapter methods are actual source code. */
export function mountCapturedReviewComponent(
  adapterModule: typeof Capture,
  props: Record<string, unknown>,
  options: { mutationHook?: boolean; afterMutation?: (result: mutations.LanguageMutationResult<unknown>) => void | Promise<void> } = {},
) {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const window = globalThis.window as unknown as EventTarget & Record<string, unknown>;
  assert.ok(window, 'Create the registered language fixture before mounting');
  const windowKeys = ['requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'innerHeight', 'innerWidth', 'confirm'] as const;
  const previousWindow = new Map(windowKeys.map(key => [key, Object.getOwnPropertyDescriptor(window, key)]));
  let nextFrame = 0, focused = true, disposed = false, dirty = true, cursor = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => focused, defaultView: window });
  Object.assign(window, {
    requestAnimationFrame(callback: FrameRequestCallback) { const token = ++nextFrame; frames.set(token, callback); return token; },
    cancelAnimationFrame(token: number) { frames.delete(token); },
    getComputedStyle(element: HostElement) { return element.style; },
    innerHeight: 800, innerWidth: 1280, confirm: () => true,
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  type HostElement = {
    ownerDocument: typeof document; isConnected: boolean; parentElement: HostElement | null;
    props: Record<string, unknown>; dataset: Record<string, string>;
    style: { display: string; visibility: string; opacity: string };
    closest(selector: string): HostElement | null;
    getBoundingClientRect(): { width: number; height: number; bottom: number; right: number; top: number; left: number };
  };
  const hosts = new Map<string, HostElement>();
  const slots: unknown[] = [], effects = new Map<number, () => void | (() => void)>(), committedEffects = new Map<number, () => void | (() => void)>(), cleanups = new Map<number, () => void>();
  let committed: UiNode, commits = 0;
  const history: UiNode[] = [];
  // Observe every actual setView publication without rendering or flushing effects.
  const publications: Capture.CapturedReviewView[] = [];
  const rendered: { view: Capture.CapturedReviewView; tree: UiNode }[] = [];
  const react = {
    useId() { return `captured-question-${cursor++}`; },
    useState(initial: unknown) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], (update: unknown) => {
        if (disposed) return;
        const next = typeof update === 'function' ? update(slots[slot]) : update;
        if (!Object.is(slots[slot], next)) {
          if (next && typeof next === 'object' && 'runId' in next && 'status' in next && 'busy' in next) publications.push(next as Capture.CapturedReviewView);
          slots[slot] = next; dirty = true;
        }
      }];
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const slot = cursor++, previous = slots[slot] as { callback: unknown; deps: unknown[] } | undefined;
      if (!previous || previous.deps.length !== deps.length || previous.deps.some((value, index) => !Object.is(value, deps[index]))) slots[slot] = { callback, deps };
      return (slots[slot] as { callback: unknown }).callback;
    },
    useRef(initial: unknown) { const slot = cursor++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const slot = cursor++, previous = slots[slot] as unknown[] | undefined;
      if (!previous || previous.length !== deps.length || previous.some((value, index) => !Object.is(value, deps[index]))) {
        slots[slot] = deps; effects.set(slot, effect);
      }
    },
  };
  const jsx = (type: unknown, nodeProps: UiNode['props'], key?: string) => ({ type, props: nodeProps, key });
  const dependencies = new Map<string, unknown>([
    ['react', react], ['react/jsx-runtime', { jsx, jsxs: jsx }], ['next/link', { default: 'a' }],
    ['@/app/data/languageLegacyReviewCapture', adapterModule], ['@/app/data/languageCloudSync', cloud], ['@/utils/learningSession', learningSession],
    ['./learning-focus.module.css', { default: {} }],
  ]);
  const source = ts.transpileModule(readFileSync(new URL('../../components/language/CapturedCourseReviewQuestion.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exported: { default?: (input: Record<string, unknown>) => UiNode } = {};
  runInThisContext(`(function(exports, require, window, document) { ${source}\n})`)(exported, (name: string) => {
    assert.ok(dependencies.has(name), `Unexpected component dependency: ${name}`); return dependencies.get(name);
  }, window, document);
  assert.ok(exported.default);
  const questionComponent = exported.default;
  let hookAction: ReturnType<typeof useLanguageMutationAction> | null = null, mutationCalls = 0;
  if (options.mutationHook) {
    const hookDependencies = new Map<string, unknown>([
      ['react', react], ['@/app/data/languageCloudSync', cloud],
      ['@/app/data/languageRecordMutations', { ...mutations, async runLanguageMutation(...args: Parameters<typeof mutations.runLanguageMutation>) {
        mutationCalls++; const result = await mutations.runLanguageMutation(...args); await options.afterMutation?.(result); return result;
      } }],
      ['@/app/data/languageRecordDocuments', documents], ['@/app/data/languageRecordIdentity', identity], ['@/utils/dateKey', dates],
    ]);
    const hookSource = ts.transpileModule(readFileSync(new URL('../../components/language/useLanguageMutationAction.ts', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const hookExport: { useLanguageMutationAction?: typeof useLanguageMutationAction } = {};
    runInThisContext(`(function(exports, require) { ${hookSource}\n})`)(hookExport, (name: string) => {
      assert.ok(hookDependencies.has(name), `Unexpected hook dependency: ${name}`); return hookDependencies.get(name);
    });
    assert.ok(hookExport.useLanguageMutationAction);
    exported.default = input => {
      const action = hookExport.useLanguageMutationAction!(input.source as Parameters<typeof useLanguageMutationAction>[0], planReviewMutation, { verify: verifyCourseReview });
      hookAction = action as ReturnType<typeof useLanguageMutationAction>;
      return questionComponent({ ...input, actions: action });
    };
  }
  function attach(value: unknown, path: string, parent: HostElement | null, seen: Set<string>) {
    if (Array.isArray(value)) { value.forEach((child, index) => attach(child, `${path}.${index}`, parent, seen)); return; }
    if (!value || typeof value !== 'object' || !('props' in value)) return;
    const node = value as UiNode;
    if (typeof node.type !== 'string') { attach(node.props.children, `${path}.children`, parent, seen); return; }
    const host = hosts.get(path) ?? {
      ownerDocument: document, isConnected: true, parentElement: parent, props: {}, dataset: {},
      style: { display: 'block', visibility: 'visible', opacity: '1' },
      closest(_selector: string) { for (let element: HostElement | null = this; element; element = element.parentElement) { if (element.props.hidden || element.props.inert || element.props['aria-hidden'] === 'true') return element; } return null; },
      getBoundingClientRect: () => ({ width: 400, height: 200, bottom: 200, right: 400, top: 0, left: 0 }),
    } satisfies HostElement;
    host.props = node.props; host.parentElement = parent; host.isConnected = true;
    host.dataset = Object.fromEntries(Object.entries(node.props).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, char: string) => char.toUpperCase()), String(value)]));
    hosts.set(path, host); seen.add(path);
    const ref = node.props.ref as { current: unknown } | undefined; if (ref) ref.current = host;
    attach(node.props.children, `${path}.children`, host, seen);
  }
  function render() {
    assert.ok(!disposed, 'Cannot render an unmounted source component');
    assert.equal(effects.size, 0, 'Run the prior committed passive effects before another render');
    dirty = false; cursor = 0; committed = exported.default!(props); commits++; history.push(committed);
    rendered.push({ view: slots.find(slot => slot && typeof slot === 'object' && 'runId' in slot && 'status' in slot && 'busy' in slot) as Capture.CapturedReviewView, tree: committed });
    const seen = new Set<string>(); attach(committed, 'root', null, seen);
    for (const [key, host] of hosts) if (!seen.has(key)) host.isConnected = false;
    return committed;
  }
  function flushEffects() {
    const pending = [...effects]; effects.clear();
    for (const [slot, effect] of pending) { committedEffects.set(slot, effect); cleanups.get(slot)?.(); cleanups.delete(slot); const cleanup = effect(); if (cleanup) cleanups.set(slot, cleanup); }
  }
  function flush() {
    let count = 0;
    while (dirty || effects.size) {
      assert.ok(count++ < 30, 'Source hooks did not settle');
      if (effects.size) flushEffects();
      if (dirty) render();
    }
    return committed;
  }
  const view = {
    render, flushEffects, flush, history, publications, rendered, props,
    tree: () => committed,
    hookAction: () => hookAction,
    get mutationCalls() { return mutationCalls; },
    queuedView: () => slots.find(slot => slot && typeof slot === 'object' && 'runId' in slot && 'status' in slot && 'busy' in slot) as Capture.CapturedReviewView,
    text: () => textOf(committed),
    get dirty() { return dirty; }, get commits() { return commits; }, get pendingFrames() { return frames.size; },
    find(predicate: (node: UiNode) => boolean) { const found = nodes(committed).find(predicate); assert.ok(found, 'Missing expected source component node'); return found; },
    button(label: string) { return view.find(node => node.type === 'button' && textOf(node) === label); },
    click(label: string) { const button = view.button(label); assert.ok(!button.props.disabled, `${label} is disabled`); (button.props.onClick as () => void)(); },
    input() { return view.find(node => node.type === 'input'); },
    type(value: string) { const input = view.input(); assert.ok(!input.props.disabled); (input.props.onChange as (event: unknown) => void)({ target: { value } }); },
    submit() { const form = view.find(node => node.type === 'form'); (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {} }); },
    frame() { const batch = [...frames]; frames.clear(); for (const [, callback] of batch) callback(performance.now()); return batch.length; },
    visibility(value: 'visible' | 'hidden') { document.visibilityState = value; document.dispatchEvent(new Event('visibilitychange')); },
    focus(value: boolean) { focused = value; if (!value) window.dispatchEvent(new Event('blur')); },
    pagehide() { window.dispatchEvent(new Event('pagehide')); },
    replayMountEffects() {
      assert.equal(commits, 1, 'Strict Mode mount replay belongs before user interactions');
      for (const cleanup of cleanups.values()) cleanup(); cleanups.clear();
      for (const [slot, effect] of committedEffects) { const cleanup = effect(); if (cleanup) cleanups.set(slot, cleanup); }
      flush();
    },
    clip(surface: string, side: 'top' | 'right' = 'top') {
      const host = [...hosts.values()].find(element => element.dataset.reviewSurface === surface && element.isConnected); assert.ok(host);
      host.getBoundingClientRect = () => side === 'top'
        ? { width: 400, height: 200, bottom: 180, right: 400, top: -20, left: 0 }
        : { width: 400, height: 200, bottom: 200, right: 1300, top: 0, left: 900 };
    },
    alterMarker(surface: string, kind: 'run' | 'draft' | 'event' = 'run') {
      const host = [...hosts.values()].find(element => element.dataset.reviewSurface === surface && element.isConnected); assert.ok(host);
      host.dataset[kind === 'run' ? 'reviewRun' : kind === 'draft' ? 'reviewDraft' : 'reviewEvent'] = 'synthetic-stale-marker';
    },
    conceal(surface: string, kind: 'hidden' | 'inert' | 'display' | 'opacity' = 'hidden') {
      const host = [...hosts.values()].find(element => element.dataset.reviewSurface === surface && element.isConnected); assert.ok(host);
      if (kind === 'hidden' || kind === 'inert') host.props = { ...host.props, [kind]: true };
      else if (kind === 'display') host.style.display = 'none'; else host.style.opacity = '0';
    },
    async settle(rounds = 4) { for (let i = 0; i < rounds; i++) { await new Promise<void>(resolve => setImmediate(resolve)); flush(); } return committed; },
    async asynchronous(rounds = 4) { for (let i = 0; i < rounds; i++) await new Promise<void>(resolve => setImmediate(resolve)); },
    dispose() {
      if (disposed) return; disposed = true; for (const cleanup of cleanups.values()) cleanup(); cleanups.clear();
      for (const host of hosts.values()) host.isConnected = false;
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else Reflect.deleteProperty(globalThis, 'document');
      for (const key of windowKeys) { const previous = previousWindow.get(key); if (previous) Object.defineProperty(window, key, previous); else Reflect.deleteProperty(window, key); }
    },
  };
  render(); flush(); return view;
}
