import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { FIXTURE_OWNER, storageBrowser, storageTab } from './helpers/storage-ui-fixture.ts';
import type { AuthenticatedStorageOwner } from '../app/data/authenticatedStorageOwner.ts';

type Node = { type: unknown; props: Record<string, unknown> };
function dialogFixture(runtime: typeof import('../app/data/authenticatedStorageOwner.ts'), initial: AuthenticatedStorageOwner, paneOwner = initial.userId) {
  class Element {
    isConnected = true; concealed = false; rects = true; visibility = 'visible'; focuses = 0; disabled = false; tabIndex = 0;
    getClientRects() { return this.rects ? [{}] : []; }
    closest() { return this.concealed ? this : null; }
    focus() { this.focuses++; document.activeElement = this; }
  }
  class Dialog extends Element {
    open = false; modal = false; shows = 0; closes = 0; containsClose = true; parentElement = new Element();
    matches(selector: string) { assert.equal(selector, ':modal'); return this.modal; }
    contains(element: Element) { return element === this || (element === closeButton && this.containsClose); }
    showModal() { this.open = true; this.modal = true; this.shows++; document.activeElement = closeButton; }
    close() { if (this.open) { this.open = false; this.modal = false; this.closes++; } }
  }
  const trigger = new Element(), outside = new Element(), closeButton = new Element(), dialog = new Dialog(), document = { activeElement: trigger };
  type Slot = { current?: unknown; deps?: unknown[]; value?: unknown; cleanup?: () => void };
  const slots: Slot[] = []; let cursor = 0, effects: (() => void)[] = [], lease: AuthenticatedStorageOwner | null = initial, closed = 0, tree: Node;
  const same = (left: unknown[] | undefined, right: unknown[]) => Boolean(left && left.length === right.length && left.every((value, index) => Object.is(value, right[index])));
  const useRef = (value: unknown) => { const index = cursor++; return slots[index] ??= { current: value }; };
  const useCallback = (callback: unknown, deps: unknown[]) => { const index = cursor++, slot = slots[index] ??= {}; if (!same(slot.deps, deps)) { slot.deps = deps; slot.value = callback; } return slot.value; };
  const useLayoutEffect = (effect: () => (() => void) | undefined, deps: unknown[]) => { const index = cursor++, slot = slots[index] ??= {}; if (!same(slot.deps, deps)) { slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = effect(); }); } };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const nodes = (node: unknown): Node[] => Array.isArray(node) ? node.flatMap(nodes)
    : node && typeof node === 'object' && 'props' in node ? [node as Node, ...nodes((node as Node).props.children)] : [];
  const file = ts.createSourceFile('page.tsx', readFileSync(new URL('../app/growth/handwriting/compare/page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ImageDialog'); assert.ok(fn);
  const source = ts.transpileModule(`export ${fn.getText(file)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: 'dialog.tsx' }).outputText;
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(`(function(exports,require){${source}\n})`, { useRef, useCallback, useLayoutEffect, useAuthenticatedStorageOwner: () => lease,
    assertAuthenticatedStorageOwner: runtime.assertAuthenticatedStorageOwner, document, HTMLElement: Element,
    getComputedStyle: (element: Element) => ({ visibility: element.visibility }), buttonClass: 'fixture', Image: 'img',
  })(exports, () => ({ jsx, jsxs: jsx }));
  const render = (next: AuthenticatedStorageOwner | null) => {
    lease = next; cursor = 0; effects = [];
    tree = (exports.ImageDialog as (props: unknown) => Node)({ pane: { attempt: { owner: paneOwner }, url: 'blob:synthetic', width: 32, height: 64 }, title: 'fixture', onClose: () => { closed++; }, onError() {} });
    (tree.props.ref as { current: unknown }).current = dialog;
    const controls = nodes(tree).filter(node => ['button', 'input', 'select', 'textarea', 'a'].includes(String(node.type)) || node.props.tabIndex !== undefined);
    assert.equal(controls.length, 1, 'The narrow keyboard handler requires Close to remain the sole tabbable control');
    const close = controls[0]; assert.equal(close.type, 'button');
    if (close.props.ref) (close.props.ref as { current: unknown }).current = closeButton;
    effects.forEach(effect => effect()); return tree;
  };
  return { dialog, trigger, outside, closeButton, document, render, get closed() { return closed; },
    keyDown(options: { key?: string; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; defaultPrevented?: boolean } = {}) {
      let preventCalls = 0; const focuses = closeButton.focuses;
      const event = { key: 'Tab', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, defaultPrevented: false,
        ...options, currentTarget: dialog, target: closeButton, preventDefault() { preventCalls++; this.defaultPrevented = true; } };
      (tree.props.onKeyDown as ((event: unknown) => void) | undefined)?.(event);
      return { preventCalls, focusCalls: closeButton.focuses - focuses };
    },
    removeCloseRef() { const close = nodes(tree).find(node => node.type === 'button')!; if (close.props.ref) (close.props.ref as { current: unknown }).current = null; },
    unmount() { slots.forEach(slot => slot.cleanup?.()); dialog.isConnected = false; },
    delayedClose() { (tree.props.onClose as (() => void) | undefined)?.(); },
    cancel() { (tree.props.onCancel as (event: unknown) => void)({ preventDefault() {} }); },
  };
}
async function authority() {
  const tab = storageTab(storageBrowser(), 'native-dialog'); await tab.cloud.prepareLocalCloudState(FIXTURE_OWNER);
  const runtime = tab.loadModule('app/data/authenticatedStorageOwner.ts') as typeof import('../app/data/authenticatedStorageOwner.ts');
  const fresh = () => runtime.verifyAuthenticatedStorageOwner(tab.local, async () => ({ data: { user: { id: FIXTURE_OWNER } }, error: null }), async () => {});
  return { tab, runtime, fresh, lease: await fresh() };
}

test('native image dialog closes on revoke, preserves the same node through null, and reopens only a fresh exact-owner/epoch lease', async t => {
  const a = await authority(); t.after(a.tab.dispose); const f = dialogFixture(a.runtime, a.lease); f.render(a.lease);
  assert.equal(f.dialog.open, true); assert.equal(f.dialog.shows, 1); const node = f.dialog;
  a.runtime.revokeAuthenticatedStorageOwner(a.lease); assert.equal(f.dialog.open, false, 'Abort closes immediately, before a context rerender');
  f.render(null); f.outside.focus(); assert.equal(f.trigger.focuses, 0); assert.equal(f.dialog, node);
  const fresh = await a.fresh(); assert.notEqual(fresh, a.lease); assert.equal(fresh.epoch, a.lease.epoch);
  f.render(fresh); assert.equal(f.dialog, node); assert.equal(f.dialog.open, true); assert.equal(f.dialog.shows, 2);
  f.delayedClose(); assert.equal(f.closed, 0); assert.equal(f.dialog.open, true, 'A queued close event has no React close-state handler');
  f.cancel(); assert.equal(f.closed, 1); f.unmount(); assert.equal(f.document.activeElement, f.trigger, 'The original trigger is captured once, not replaced by outside recovery controls');
});
for (const kind of ['null', 'revoked', 'copied', 'wrong-owner', 'new-epoch'] as const)
  test(`native image dialog rejects ${kind} authority and never restores old focus on failclosed unmount`, async t => {
    const a = await authority(); t.after(a.tab.dispose); const f = dialogFixture(a.runtime, a.lease); f.render(a.lease);
    a.runtime.revokeAuthenticatedStorageOwner(a.lease); let next: AuthenticatedStorageOwner | null = null;
    if (kind === 'revoked') next = a.lease;
    if (kind === 'copied') next = { ...await a.fresh() };
    if (kind === 'wrong-owner' || kind === 'new-epoch') {
      await a.tab.cloud.prepareLocalCloudState('synthetic-owner-b');
      if (kind === 'new-epoch') await a.tab.cloud.prepareLocalCloudState(FIXTURE_OWNER);
      next = await a.runtime.verifyAuthenticatedStorageOwner(a.tab.local, async () => ({ data: { user: { id: kind === 'wrong-owner' ? 'synthetic-owner-b' : FIXTURE_OWNER } }, error: null }), async () => {});
      if (kind === 'new-epoch') assert.notEqual(next.epoch, a.lease.epoch);
    }
    f.render(next); assert.equal(f.dialog.open, false); assert.equal(f.dialog.shows, 1); f.outside.focus();
    f.unmount(); assert.equal(f.document.activeElement, f.outside); assert.equal(f.trigger.focuses, 0);
  });

for (const resumed of [false, true]) test(`native sole-Close Tab cycle is explicit ${resumed ? 'after exact-owner recheck' : 'on first open'}`, async t => {
  const a = await authority(); t.after(a.tab.dispose); const f = dialogFixture(a.runtime, a.lease); f.render(a.lease);
  const node = f.dialog;
  if (resumed) {
    a.runtime.revokeAuthenticatedStorageOwner(a.lease); f.render(null); f.outside.focus();
    for (const shiftKey of [false, true]) assert.deepEqual(f.keyDown({ shiftKey }), { preventCalls: 0, focusCalls: 0 });
    const fresh = await a.fresh(); assert.notEqual(fresh, a.lease); assert.equal(fresh.epoch, a.lease.epoch); f.render(fresh);
  }
  assert.equal(f.dialog, node); assert.equal(f.dialog.open, true); assert.equal(f.dialog.modal, true); assert.equal(f.document.activeElement, f.closeButton);
  for (const shiftKey of [false, true, false, true]) {
    assert.deepEqual(f.keyDown({ shiftKey }), { preventCalls: 1, focusCalls: 1 });
    assert.equal(f.document.activeElement, f.closeButton);
  }
  f.delayedClose(); assert.equal(f.closed, 0); assert.equal(f.dialog.open, true);
  f.cancel(); f.unmount(); assert.equal(f.closed, 1); assert.equal(f.document.activeElement, f.trigger);
});

for (const options of [{ key: 'Escape' }, { key: 'Enter' }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { defaultPrevented: true }])
  test(`native Tab handler does not intercept ${JSON.stringify(options)}`, async t => {
    const a = await authority(); t.after(a.tab.dispose); const f = dialogFixture(a.runtime, a.lease); f.render(a.lease);
    assert.deepEqual(f.keyDown(options), { preventCalls: 0, focusCalls: 0 }); f.unmount();
  });

for (const kind of ['null', 'revoked', 'copied', 'wrong-owner', 'new-epoch'] as const)
  test(`native Tab rejects ${kind} authority even if the host still reports an open modal`, async t => {
    const a = await authority(); t.after(a.tab.dispose); const f = dialogFixture(a.runtime, a.lease); f.render(a.lease);
    a.runtime.revokeAuthenticatedStorageOwner(a.lease); let next: AuthenticatedStorageOwner | null = null;
    if (kind === 'revoked') next = a.lease;
    if (kind === 'copied') next = { ...await a.fresh() };
    if (kind === 'wrong-owner' || kind === 'new-epoch') {
      await a.tab.cloud.prepareLocalCloudState('synthetic-owner-b');
      if (kind === 'new-epoch') await a.tab.cloud.prepareLocalCloudState(FIXTURE_OWNER);
      next = await a.runtime.verifyAuthenticatedStorageOwner(a.tab.local, async () => ({ data: { user: { id: kind === 'wrong-owner' ? 'synthetic-owner-b' : FIXTURE_OWNER } }, error: null }), async () => {});
    }
    f.render(next); f.dialog.open = true; f.dialog.modal = true; f.outside.focus();
    for (const shiftKey of [false, true]) assert.deepEqual(f.keyDown({ shiftKey }), { preventCalls: 0, focusCalls: 0 });
    assert.equal(f.document.activeElement, f.outside); f.unmount();
  });

test('native Tab checks freshness before reading modal state and synchronously closes a stale lease', async t => {
  const a = await authority(); t.after(a.tab.dispose); const f = dialogFixture(a.runtime, a.lease); f.render(a.lease);
  a.tab.local.setItem('fitness-cloud-sync-epoch', 'synthetic-new-epoch');
  assert.equal(a.lease.signal.aborted, false); assert.equal(f.dialog.open, true);
  let modalReads = 0; f.dialog.matches = () => { modalReads++; return true; };
  assert.deepEqual(f.keyDown(), { preventCalls: 0, focusCalls: 0 });
  assert.equal(a.lease.signal.aborted, true); assert.equal(f.dialog.open, false); assert.equal(modalReads, 0); f.unmount();
});

for (const kind of ['closed', 'nonmodal', 'dialog-hidden', 'dialog-disconnected', 'dialog-no-rects', 'dialog-visibility-hidden', 'dialog-visibility-collapse',
  'close-missing', 'close-outside', 'close-disabled', 'close-negative-tabindex', 'close-hidden', 'close-disconnected', 'close-no-rects', 'close-visibility-hidden', 'close-visibility-collapse'] as const)
  test(`native Tab ignores unavailable ${kind} state with valid authority`, async t => {
    const a = await authority(); t.after(a.tab.dispose); const f = dialogFixture(a.runtime, a.lease); f.render(a.lease);
    if (kind === 'closed') f.dialog.open = false;
    if (kind === 'nonmodal') f.dialog.modal = false;
    if (kind === 'dialog-hidden') f.dialog.concealed = true;
    if (kind === 'dialog-disconnected') f.dialog.isConnected = false;
    if (kind === 'dialog-no-rects') f.dialog.rects = false;
    if (kind === 'dialog-visibility-hidden') f.dialog.visibility = 'hidden';
    if (kind === 'dialog-visibility-collapse') f.dialog.visibility = 'collapse';
    if (kind === 'close-missing') f.removeCloseRef();
    if (kind === 'close-outside') f.dialog.containsClose = false;
    if (kind === 'close-disabled') f.closeButton.disabled = true;
    if (kind === 'close-negative-tabindex') f.closeButton.tabIndex = -1;
    if (kind === 'close-hidden') f.closeButton.concealed = true;
    if (kind === 'close-disconnected') f.closeButton.isConnected = false;
    if (kind === 'close-no-rects') f.closeButton.rects = false;
    if (kind === 'close-visibility-hidden') f.closeButton.visibility = 'hidden';
    if (kind === 'close-visibility-collapse') f.closeButton.visibility = 'collapse';
    f.outside.focus();
    for (const shiftKey of [false, true]) assert.deepEqual(f.keyDown({ shiftKey }), { preventCalls: 0, focusCalls: 0 });
    assert.equal(f.document.activeElement, f.outside); f.unmount();
  });
for (const kind of ['hidden-ancestor', 'disconnected', 'parent-not-rendered', 'visibility-hidden', 'visibility-collapse'] as const)
  test(`${kind} prevents native modal opening even with valid registered authority`, async t => {
    const a = await authority(); t.after(a.tab.dispose); const f = dialogFixture(a.runtime, a.lease);
    if (kind === 'hidden-ancestor') f.dialog.concealed = true;
    if (kind === 'disconnected') f.dialog.isConnected = false;
    if (kind === 'parent-not-rendered') f.dialog.parentElement.rects = false;
    if (kind === 'visibility-hidden') f.dialog.visibility = 'hidden';
    if (kind === 'visibility-collapse') f.dialog.visibility = 'collapse';
    f.render(a.lease); assert.equal(f.dialog.shows, 0); f.unmount();
  });
for (const kind of ['hidden-ancestor', 'disconnected', 'not-rendered', 'visibility-hidden', 'visibility-collapse'] as const)
  test(`${kind} original trigger receives no focus restoration on final valid-owner user close`, async t => {
    const a = await authority(); t.after(a.tab.dispose); const f = dialogFixture(a.runtime, a.lease); f.render(a.lease);
    if (kind === 'hidden-ancestor') f.trigger.concealed = true;
    if (kind === 'disconnected') f.trigger.isConnected = false;
    if (kind === 'not-rendered') f.trigger.rects = false;
    if (kind === 'visibility-hidden') f.trigger.visibility = 'hidden';
    if (kind === 'visibility-collapse') f.trigger.visibility = 'collapse';
    f.outside.focus(); f.cancel(); f.unmount(); assert.equal(f.closed, 1); assert.equal(f.trigger.focuses, 0);
  });
