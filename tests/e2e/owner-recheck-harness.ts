import type { Page, Route } from '@playwright/test';
import { expect } from './fixture';
import { RouteDrain } from './route-drain';

const SESSION_EVENT = 'yeoni-cloud-session-changed';
const PROTOCOL_KEY = 'yeoni-storage-transaction-v2';
const PANEL_NOTICE = '다른 창에서 로그인 상태가 변경되었습니다. 다시 시도하여 계정을 확인해 주세요.';
type BrowserProbe = { trigger: () => { reads: number; getterRestored: boolean; bytesUnchanged: boolean }; unchanged: () => boolean };

/** Test-only read interference, not runtime authority or an authentication seam.
 * This function is also executed in a pure host fixture to verify restoration. */
export function installOwnerRecheckReadFault({ eventName, protocolKey, panelNotice }: { eventName: string; protocolKey: string; panelNotice: string }) {
  const add = window.addEventListener, remove = window.removeEventListener;
  type Registration = { listener: EventListener; wrapped: EventListener; capture: boolean; once: boolean; signal?: AbortSignal };
  const registrations = new Set<Registration>();
  let armed = false, reads = 0, getterRestored = false, before: string | null = null;
  const snapshot = () => JSON.stringify(Object.keys(window.localStorage).sort().map(key => [key, window.localStorage.getItem(key)]));
  const decoded = (value: string) => value.replace(/\\u\{([\da-f]+)\}|\\u([\da-f]{4})/gi, (_match, codepoint: string | undefined, unit: string | undefined) => String.fromCodePoint(parseInt(codepoint ?? unit!, 16)));
  const active = () => [...registrations].filter(record => !record.signal?.aborted);
  window.addEventListener = function (this: Window, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
    if (this !== window || type !== eventName || typeof listener !== 'function' || !decoded(Function.prototype.toString.call(listener)).includes(panelNotice)) {
      return add.call(this, type, listener, options);
    }
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    const existing = active().find(record => record.listener === listener && record.capture === capture);
    if (existing) return add.call(this, type, existing.wrapped, options);
    const record: Registration = { listener, capture, once: typeof options === 'object' && Boolean(options?.once), signal: typeof options === 'object' ? options.signal : undefined,
      wrapped: function (event) {
        if (record.once) { registrations.delete(record); remove.call(window, eventName, record.wrapped, record.capture); }
        if (!armed) return listener.call(this, event);
        armed = false;
        const descriptor = Object.getOwnPropertyDescriptor(Storage.prototype, 'getItem');
        if (!descriptor || typeof descriptor.value !== 'function') throw new Error('Owner recheck fixture getter unavailable');
        const get = descriptor.value as Storage['getItem'];
        Object.defineProperty(Storage.prototype, 'getItem', { ...descriptor, value: function (this: Storage, key: string) {
          if (this === window.localStorage && key === protocolKey) {
            reads++;
            if (reads <= 6) return JSON.stringify({ version: 2, state: 'committed', generation: `synthetic-recheck-overlap-${reads}` });
          }
          return get.call(this, key);
        } });
        try { return listener.call(this, event); }
        finally {
          Object.defineProperty(Storage.prototype, 'getItem', descriptor);
          getterRestored = Storage.prototype.getItem === get;
        }
      },
    };
    registrations.add(record);
    return add.call(this, type, record.wrapped, options);
  } as typeof window.addEventListener;
  window.removeEventListener = function (this: Window, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    const record = this === window && type === eventName ? active().find(item => item.listener === listener && item.capture === capture) : undefined;
    if (record) { registrations.delete(record); return remove.call(this, type, record.wrapped, options); }
    return remove.call(this, type, listener, options);
  } as typeof window.removeEventListener;
  const probe: BrowserProbe = {
    trigger() {
      if (armed || before !== null || active().length !== 1) throw new Error('Owner recheck fixture requires exactly one active panel callback and one attempt');
      before = snapshot(); reads = 0; getterRestored = false; armed = true;
      // Invoke the uniquely captured real callback only. A global event would
      // also invalidate unrelated readers and unmount their dialogs, concealing
      // rather than exercising preservation of the authenticated subtree.
      active()[0].wrapped.call(window, new Event(eventName));
      if (armed || reads !== 6 || !getterRestored) throw new Error('Owner recheck fixture callback/read contract changed');
      const bytesUnchanged = snapshot() === before;
      if (!bytesUnchanged) throw new Error('Owner recheck fixture changed stored bytes');
      return { reads, getterRestored, bytesUnchanged };
    },
    unchanged: () => before !== null && snapshot() === before,
  };
  Object.assign(window, { ownerRecheckFixture: probe });
}

export async function installOwnerRecheckHarness(page: Page) {
  await page.addInitScript(installOwnerRecheckReadFault, { eventName: SESSION_EVENT, protocolKey: PROTOCOL_KEY, panelNotice: PANEL_NOTICE });
}
export async function triggerOwnerRecheck(page: Page) {
  const result = await page.evaluate(() => (window as unknown as Window & { ownerRecheckFixture: BrowserProbe }).ownerRecheckFixture.trigger());
  expect(result).toEqual({ reads: 6, getterRestored: true, bytesUnchanged: true });
}
export async function assertRecheckBytesUnchanged(page: Page) {
  expect(await page.evaluate(() => (window as unknown as Window & { ownerRecheckFixture: BrowserProbe }).ownerRecheckFixture.unchanged())).toBe(true);
}

/** Hold delivery of one genuine successful owner verification, never its body.
 * Requires the qa fixture's shared context interceptor to remain installed.
 * Keeping both handlers at context scope lets close remove only this helper
 * without retiring a page interceptor that still owns a pending dispatch. */
export async function holdFreshOwnerVerification(page: Page, ownerId: string) {
  let received = false, armed = true, release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; }), drain = new RouteDrain();
  const context = page.context();
  const pattern = 'http://127.0.0.1:54321/auth/v1/user';
  const route = (intercept: Route) => drain.run(async () => {
    const request = intercept.request();
    let samePage = false;
    try { samePage = request.frame().page() === page; } catch { /* Service-worker requests may have no frame. */ }
    if (!samePage || !armed || request.method() !== 'GET') { await intercept.fallback(); return; }
    armed = false;
    const response = await intercept.fetch({ maxRetries: 0 });
    const body = await response.json();
    expect(response.ok(), 'Real fixture authentication succeeded').toBe(true);
    expect(body?.id === ownerId, 'Real fixture authentication kept the exact owner').toBe(true);
    received = true; await wait; await intercept.fulfill({ response });
  });
  await context.route(pattern, route);
  return { arrived: () => expect.poll(() => received).toBe(true), release: () => release(),
    async close() { release(); await drain.wait(); await context.unroute(pattern, route); } };
}
