import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function fixture() {
  const listeners = new Map<string, Set<(event: unknown) => void>>(), cleanups: (() => void)[] = [];
  class Element {
    isConnected = true; concealed = false; rects = true; visibility = 'visible'; children: Element[] = []; focuses = 0;
    getClientRects() { return this.rects ? [{}] : []; }
    closest() { return this.concealed ? this : null; }
    querySelectorAll() { return this.children; }
    contains(node: unknown) { return node === this || this.children.includes(node as Element); }
    focus() { this.focuses++; document.activeElement = this; }
  }
  const outside = new Element(), dialog = new Element(), first = new Element(), last = new Element(); dialog.children = [first, last];
  const document = { activeElement: outside,
    addEventListener(type: string, listener: (event: unknown) => void) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener); },
    removeEventListener(type: string, listener: (event: unknown) => void) { listeners.get(type)?.delete(listener); },
  };
  const exports: Record<string, unknown> = {};
  const source = ts.transpileModule(readFileSync(new URL('../components/useDialogFocus.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(`(function(exports,require){${source}\n})`, { document, HTMLElement: Element, Node: Element, getComputedStyle: (element: Element) => ({ visibility: element.visibility }) })(exports, () => ({ useEffect(effect: () => () => void) { cleanups.push(effect()); } }));
  (exports.useDialogFocus as (open: boolean, ref: unknown) => void)(true, { current: dialog });
  return { document, outside, dialog, first, last,
    tab(shiftKey = false) { let prevented = false; for (const listener of listeners.get('keydown') ?? []) listener({ key: 'Tab', shiftKey, preventDefault() { prevented = true; } }); return prevented; },
    outsideFocus() { outside.focus(); for (const listener of listeners.get('focusin') ?? []) listener({ target: outside }); },
    close() { cleanups.forEach(cleanup => cleanup()); },
  };
}

test('visible dialog keeps forward/backward Tab wrapping and focus containment', () => {
  const f = fixture(); assert.equal(f.document.activeElement, f.first);
  f.last.focus(); assert.equal(f.tab(), true); assert.equal(f.document.activeElement, f.first);
  assert.equal(f.tab(true), true); assert.equal(f.document.activeElement, f.last);
  f.outsideFocus(); assert.equal(f.document.activeElement, f.first);
  f.close(); assert.equal(f.document.activeElement, f.outside);
});
for (const reason of ['hidden-inert-aria-ancestor', 'no-rects', 'visibility-hidden', 'visibility-collapse', 'disconnected'] as const)
  test(`${reason} pauses document-level focus effects and restores them only when visible again`, () => {
    const f = fixture();
    if (reason === 'hidden-inert-aria-ancestor') f.dialog.concealed = true;
    if (reason === 'no-rects') f.dialog.rects = false;
    if (reason === 'visibility-hidden') f.dialog.visibility = 'hidden';
    if (reason === 'visibility-collapse') f.dialog.visibility = 'collapse';
    if (reason === 'disconnected') f.dialog.isConnected = false;
    f.last.focus(); assert.equal(f.tab(), false); assert.equal(f.tab(true), false);
    f.outsideFocus(); assert.equal(f.document.activeElement, f.outside);
    f.dialog.concealed = false; f.dialog.rects = true; f.dialog.visibility = 'visible'; f.dialog.isConnected = true;
    f.outsideFocus(); assert.equal(f.document.activeElement, f.first);
    f.last.focus(); assert.equal(f.tab(), true); assert.equal(f.document.activeElement, f.first);
    f.close();
  });
test('cleanup does not return focus to a previous target that became hidden or inert', () => {
  const f = fixture(); f.outside.concealed = true; const before = f.outside.focuses;
  f.close(); assert.equal(f.outside.focuses, before);
});

test('visible dialog never selects a hidden or inert child as its focus target', () => {
  const f = fixture(); f.first.concealed = true; f.outsideFocus(); assert.equal(f.document.activeElement, f.last);
  f.last.focus(); assert.equal(f.tab(), true); assert.equal(f.document.activeElement, f.last);
  f.last.concealed = true; f.outsideFocus(); assert.equal(f.document.activeElement, f.dialog);
  f.close();
});
