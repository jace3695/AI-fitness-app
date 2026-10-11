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
    isConnected = true; concealed = false; rects = true; visibility = 'visible'; focuses = 0;
    getClientRects() { return this.rects ? [{}] : []; }
    closest() { return this.concealed ? this : null; }
    focus() { this.focuses++; document.activeElement = this; }
  }
  class Dialog extends Element {
    open = false; shows = 0; closes = 0; parentElement = new Element();
    showModal() { this.open = true; this.shows++; document.activeElement = this; }
    close() { if (this.open) { this.open = false; this.closes++; } }
  }
  const trigger = new Element(), outside = new Element(), dialog = new Dialog(), document = { activeElement: trigger };
  type Slot = { current?: unknown; deps?: unknown[]; value?: unknown; cleanup?: () => void };
  const slots: Slot[] = []; let cursor = 0, effects: (() => void)[] = [], lease: AuthenticatedStorageOwner | null = initial, closed = 0, tree: Node;
  const same = (left: unknown[] | undefined, right: unknown[]) => Boolean(left && left.length === right.length && left.every((value, index) => Object.is(value, right[index])));
  const useRef = (value: unknown) => { const index = cursor++; return slots[index] ??= { current: value }; };
  const useCallback = (callback: unknown, deps: unknown[]) => { const index = cursor++, slot = slots[index] ??= {}; if (!same(slot.deps, deps)) { slot.deps = deps; slot.value = callback; } return slot.value; };
  const useLayoutEffect = (effect: () => (() => void) | undefined, deps: unknown[]) => { const index = cursor++, slot = slots[index] ??= {}; if (!same(slot.deps, deps)) { slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = effect(); }); } };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
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
    (tree.props.ref as { current: unknown }).current = dialog; effects.forEach(effect => effect()); return tree;
  };
  return { dialog, trigger, outside, document, render, get closed() { return closed; },
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
