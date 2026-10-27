import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
type Element = React.ReactElement<Record<string, unknown>>;
type Slot = { initialized?: boolean; value?: unknown; setter?: (value: unknown) => void; deps?: readonly unknown[]; cleanup?: () => void };
type Instance = { slots: Slot[]; cursor: number };

/**
 * Executes real wrapper/player functions and effect cleanups with an in-memory hook scheduler.
 * No DOM, hydration, native disclosure events, layout or browser lifecycle claim.
 * Host refs intentionally stay null; native ancestor-details behavior is not simulated.
 */
function fixture() {
  const instances = new Map<string, Instance>();
  let current: Instance | undefined;
  let visited = new Set<string>();
  const effects: (() => void)[] = [];
  const listeners = new Map<string, Set<() => void>>();
  const frames = new Map<number, (time: number) => void>();
  let frameId = 0;
  let reduced = false;
  const subscribe = (name: string, listener: () => void) => {
    const bucket = listeners.get(name) || new Set<() => void>();
    bucket.add(listener); listeners.set(name, bucket);
  };
  const unsubscribe = (name: string, listener: () => void) => listeners.get(name)?.delete(listener);
  const slot = () => {
    assert.ok(current, 'hooks run only while evaluating a component');
    const index = current.cursor++;
    return current.slots[index] ||= {};
  };
  const hooks = {
    useState(initial: unknown) {
      const state = slot();
      if (!state.initialized) {
        state.initialized = true;
        state.value = typeof initial === 'function' ? (initial as () => unknown)() : initial;
        state.setter = next => { state.value = typeof next === 'function' ? (next as (previous: unknown) => unknown)(state.value) : next; };
      }
      return [state.value, state.setter];
    },
    useRef(initial: unknown) {
      const state = slot();
      if (!state.initialized) { state.initialized = true; state.value = { current: initial }; }
      return state.value;
    },
    useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
      const state = slot();
      if (!state.initialized || !state.deps || deps.some((value, index) => !Object.is(value, state.deps?.[index]))) {
        state.initialized = true;
        state.deps = deps;
        effects.push(() => { state.cleanup?.(); state.cleanup = effect() || undefined; });
      }
    },
  };
  const forbidden = () => { throw new Error('network/storage is outside the information-panel contract'); };
  const media = {
    get matches() { return reduced; },
    addEventListener: (_name: string, listener: () => void) => subscribe('media', listener),
    removeEventListener: (_name: string, listener: () => void) => unsubscribe('media', listener),
  };
  const windowStub = { matchMedia: () => media };
  Object.defineProperty(windowStub, 'localStorage', { get: forbidden });
  Object.defineProperty(windowStub, 'sessionStorage', { get: forbidden });
  const documentStub = {
    hidden: false,
    addEventListener: (name: string, listener: () => void) => subscribe(name, listener),
    removeEventListener: (name: string, listener: () => void) => unsubscribe(name, listener),
  };
  const modules = new Map<string, { exports: Record<string, unknown> }>();
  function load(filename: string): Record<string, unknown> {
    const cached = modules.get(filename);
    if (cached) return cached.exports;
    const loaded = { exports: {} };
    modules.set(filename, loaded);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInNewContext(code, {
      module: loaded, exports: loaded.exports, window: windowStub, document: documentStub,
      fetch: forbidden, localStorage: new Proxy({}, { get: forbidden }),
      requestAnimationFrame: (callback: (time: number) => void) => { frames.set(++frameId, callback); return frameId; },
      cancelAnimationFrame: (id: number) => frames.delete(id),
      require: (name: string) => {
        if (name === 'react') return hooks;
        if (!name.startsWith('.')) return require(name);
        const candidate = path.resolve(path.dirname(filename), name);
        const resolved = [candidate, candidate + '.ts', candidate + '.tsx'].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
        assert.ok(resolved, name);
        return load(resolved);
      },
    }, { filename });
    return loaded.exports;
  }
  const Wrapper = load(path.join(root, 'app/components/DeadBugInformationalReview.tsx')).default as React.ComponentType;
  function evaluate(node: React.ReactNode, identity: string): React.ReactNode {
    if (Array.isArray(node)) return node.map((child, index) => {
      const rendered = evaluate(child, `${identity}/${index}`);
      // This synthetic expansion turns compiler-created static siblings into an array.
      return React.isValidElement(rendered) && rendered.key === null ? React.cloneElement(rendered, { key: `${identity}/${index}` }) : rendered;
    });
    if (!React.isValidElement(node)) return node;
    const element = node as Element;
    const id = `${identity}/${typeof element.type === 'function' ? element.type.name : String(element.type)}:${element.key || ''}`;
    if (element.type === React.Fragment) return evaluate(element.props.children as React.ReactNode, id);
    if (typeof element.type === 'function') {
      visited.add(id);
      const instance = instances.get(id) || { slots: [], cursor: 0 };
      instances.set(id, instance); instance.cursor = 0;
      const previous = current; current = instance;
      const child = (element.type as (props: Record<string, unknown>) => React.ReactNode)(element.props);
      current = previous;
      return evaluate(child, id);
    }
    return React.cloneElement(element, undefined, evaluate(element.props.children as React.ReactNode, id));
  }
  const cleanup = (instance: Instance) => instance.slots.forEach(state => state.cleanup?.());
  return {
    render() {
      visited = new Set();
      const tree = evaluate(React.createElement(Wrapper), 'root');
      for (const [id, instance] of instances) if (!visited.has(id)) { cleanup(instance); instances.delete(id); }
      while (effects.length) effects.shift()!();
      return tree;
    },
    tick(time: number) { const jobs = [...frames.values()]; frames.clear(); jobs.forEach(callback => callback(time)); },
    reduce(value: boolean) { reduced = value; listeners.get('media')?.forEach(listener => listener()); },
    hide() { documentStub.hidden = true; listeners.get('visibilitychange')?.forEach(listener => listener()); },
    unmount() { instances.forEach(cleanup); instances.clear(); },
    frames: () => frames.size,
    listeners: () => [...listeners.values()].reduce((total, bucket) => total + bucket.size, 0),
  };
}

function nodes(tree: React.ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!React.isValidElement(tree)) return [];
  const element = tree as Element;
  return [element, ...nodes(element.props.children as React.ReactNode)];
}
function node(tree: React.ReactNode, type: string, condition: (element: Element) => boolean = () => true) {
  const found = nodes(tree).find(element => element.type === type && condition(element));
  assert.ok(found, type); return found;
}
const text = (tree: React.ReactNode) => renderToStaticMarkup(tree);
function toggle(tree: React.ReactNode, open: boolean) {
  const details = node(tree, 'details');
  const target = { open };
  (details.props.onToggle as (event: unknown) => void)({ target, currentTarget: target });
}
function play(tree: React.ReactNode) {
  const button = node(tree, 'button', element => 'aria-pressed' in element.props);
  (button.props.onClick as () => void)();
}
const progress = (tree: React.ReactNode) => node(tree, 'input', element => element.props.type === 'range').props.value;

test('explicit opening mounts the real information demo stopped at zero; closing cleans effects and reopening resets the choice', () => {
  const f = fixture();
  let tree = f.render();
  assert.match(text(tree), /데드버그 동작 설명 보기 · 개인 추천 아님/);
  assert.doesNotMatch(text(tree), /<svg\b|type="range"|<select\b/);
  assert.equal(f.frames(), 0); assert.equal(f.listeners(), 0);
  toggle(tree, true); tree = f.render();
  assert.match(text(tree), /데드버그 · 일반 동작 설명/);
  assert.doesNotMatch(text(tree), /카탈로그에 연결하지 않은 시범/);
  assert.equal(progress(tree), 0);
  assert.equal(node(tree, 'button', element => 'aria-pressed' in element.props).props['aria-pressed'], false);
  assert.equal(node(tree, 'select').props.value, 0);
  assert.equal(f.frames(), 0); assert.equal(f.listeners(), 2);

  (node(tree, 'select').props.onChange as (event: unknown) => void)({ target: { value: '1' } });
  tree = f.render(); assert.equal(node(tree, 'select').props.value, 1); assert.equal(progress(tree), 0);
  play(tree); tree = f.render(); assert.equal(f.frames(), 1);
  f.tick(0); f.tick(100); tree = f.render(); assert.ok(Number(progress(tree)) > 0);
  toggle(tree, false); tree = f.render();
  assert.doesNotMatch(text(tree), /<svg\b|type="range"|<select\b/);
  assert.equal(f.frames(), 0); assert.equal(f.listeners(), 0);
  toggle(tree, true); tree = f.render();
  assert.equal(node(tree, 'select').props.value, 0); assert.equal(progress(tree), 0);
  assert.equal(node(tree, 'button', element => 'aria-pressed' in element.props).props['aria-pressed'], false);
  assert.equal(f.frames(), 0);
  f.unmount(); assert.equal(f.listeners(), 0);
});

test('real player stage change, reduced motion, backgrounding and removal never restart or leak the simulated RAF', () => {
  const f = fixture();
  let tree = f.render(); toggle(tree, true); tree = f.render();
  play(tree); tree = f.render(); assert.equal(f.frames(), 1);
  (node(tree, 'select').props.onChange as (event: unknown) => void)({ target: { value: '1' } });
  tree = f.render(); assert.equal(f.frames(), 0); assert.equal(progress(tree), 0);
  play(tree); tree = f.render(); assert.equal(f.frames(), 1);
  f.reduce(true); tree = f.render(); assert.equal(f.frames(), 0);
  assert.equal(node(tree, 'button', element => 'aria-pressed' in element.props).props.disabled, true);
  f.reduce(false); tree = f.render(); assert.equal(f.frames(), 0);
  play(tree); tree = f.render(); assert.equal(f.frames(), 1);
  f.hide(); tree = f.render(); assert.equal(f.frames(), 0);
  f.unmount(); assert.equal(f.frames(), 0); assert.equal(f.listeners(), 0);
});

test('an unrelated nested toggle cannot open the reference panel', () => {
  const f = fixture(); const tree = f.render();
  (node(tree, 'details').props.onToggle as (event: unknown) => void)({ target: {}, currentTarget: { open: true } });
  assert.doesNotMatch(text(f.render()), /<svg\b|type="range"|<select\b/);
  assert.equal(f.listeners(), 0); f.unmount();
});
