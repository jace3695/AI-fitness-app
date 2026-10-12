import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { expect, type Route } from '@playwright/test';
import ts from 'typescript';
import { RouteDrain } from './e2e/route-drain.ts';
import { RouteContinueDiagnostics } from './e2e/route-continue-diagnostics.ts';

// Execute the shipped helper, without importing its authenticated fixture or
// starting a browser, server, account, network request or database.
const source = readFileSync(new URL('./e2e/owner-recheck-harness.ts', import.meta.url), 'utf8');
function declaration(source: string, name: string) {
  const ast = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
  const value = ast.statements.find(node => (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name?.text === name);
  assert.ok(value); return value.getText(ast);
}
const helperSource = declaration(source, 'holdFreshOwnerVerification');
function compile(source: string, globals: Record<string, unknown>) {
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, ...globals });
  return exports;
}
type Handler = (route: Route) => Promise<void>;
type Hold = { arrived(): Promise<void>; release(): void; close(): Promise<void> };
type Registration = { url: string; handler: Handler };
const owner = 'synthetic-owner', pattern = 'http://127.0.0.1:54321/auth/v1/user';
const install = compile(helperSource, { expect, RouteDrain }).holdFreshOwnerVerification as (page: unknown, owner: string) => Promise<Hold>;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

async function fixture() {
  const shared = { url: '**/*', handler: async () => {} }, neighbor = { url: pattern, handler: async () => {} };
  const registered: Registration[] = [shared, neighbor], removed: Registration[] = [];
  const context = {
    async route(url: string, handler: Handler) { registered.unshift({ url, handler }); },
    async unroute(url: string, handler: Handler) {
      assert.equal(url, pattern); assert.equal(typeof handler, 'function');
      const index = registered.findIndex(value => value.url === url && value.handler === handler);
      assert.notEqual(index, -1); removed.push(...registered.splice(index, 1));
    },
  };
  const page = { context: () => context, route: () => assert.fail('No page-scope interceptor'), unroute: () => assert.fail('No page-scope removal') };
  const hold = await install(page, owner), registration = registered[0];
  assert.notEqual(registration, neighbor); assert.notEqual(registration, shared); assert.equal(registration.url, pattern);
  const handler = registration.handler;
  const request = (method = 'GET') => ({ frame: () => ({ page: () => page }), method: () => method });
  function intercept(overrides: Record<string, unknown> = {}) {
    const state = { fetched: 0, fulfilled: 0, fallback: 0 };
    const response = { ok: () => true, json: async () => ({ id: owner }) };
    const route = {
      request: () => request(),
      fetch: async (options: unknown) => { assert.equal(JSON.stringify(options), '{"maxRetries":0}'); state.fetched++; return response; },
      fulfill: async (options: { response: unknown }) => { assert.equal(options.response, response); state.fulfilled++; },
      fallback: async () => { state.fallback++; },
      continue: () => assert.fail('Preserve the shared context routing chain'), abort: () => assert.fail('Never hide an original error'),
      ...overrides,
    } as unknown as Route;
    return { route, state, response };
  }
  return { context, page, hold, handler, request, intercept, shared, neighbor, registered, removed, registration };
}

test('owner hold delivers the identical verified response only after release and drains through fulfillment before exact removal', async () => {
  const f = await fixture(), fulfillment = deferred();
  const route = f.intercept();
  let fulfills = 0;
  route.route.fulfill = async options => { assert.equal(options?.response, route.response); fulfills++; await fulfillment.promise; };
  const pending = f.handler(route.route);
  await f.hold.arrived(); assert.equal(route.state.fetched, 1); assert.equal(fulfills, 0);
  const closing = f.hold.close(); await tick();
  assert.equal(fulfills, 1); assert.deepEqual(f.removed, []);
  fulfillment.resolve(); await pending; await closing;
  assert.deepEqual(f.removed, [f.registration]); assert.deepEqual(f.registered, [f.shared, f.neighbor]);
});

test('owner hold close releases delivery but still drains pending fetch and JSON before removing its handler', async () => {
  const f = await fixture(), fetched = deferred(), decoded = deferred(); let fulfills = 0;
  const route = f.intercept({ fetch: async (options: unknown) => {
    assert.equal(JSON.stringify(options), '{"maxRetries":0}'); await fetched.promise;
    return { ok: () => true, json: async () => { await decoded.promise; return { id: owner }; } };
  }, fulfill: async () => { fulfills++; } });
  const pending = f.handler(route.route), closing = f.hold.close();
  await tick(); assert.equal(f.removed.length, 0); assert.equal(fulfills, 0);
  fetched.resolve(); await tick(); assert.equal(f.removed.length, 0); assert.equal(fulfills, 0);
  decoded.resolve(); await pending; await closing; assert.equal(fulfills, 1); assert.deepEqual(f.removed, [f.registration]);
});

for (const kind of ['sibling', 'frameless', 'service-worker'] as const) test(`owner hold falls back for ${kind} before method or arming and still holds the next same-page GET`, async () => {
  const f = await fixture();
  const skipped = f.intercept({ request: () => ({
    frame: () => { if (kind !== 'sibling') throw new Error('Synthetic frame unavailable'); return { page: () => ({}) }; },
    method: () => assert.fail('Do not inspect another page method'), url: () => assert.fail('Do not inspect another page URL'),
    postDataJSON: () => assert.fail('Do not inspect another page body'), headers: () => assert.fail('Do not inspect another page headers'),
  }) });
  await f.handler(skipped.route); assert.deepEqual(skipped.state, { fetched: 0, fulfilled: 0, fallback: 1 });
  const next = f.intercept(), pending = f.handler(next.route); await f.hold.arrived();
  assert.equal(next.state.fetched, 1); assert.equal(next.state.fulfilled, 0);
  f.hold.release(); await pending; await f.hold.close(); assert.equal(next.state.fulfilled, 1);
});

for (const method of ['HEAD', 'POST', 'OPTIONS']) test(`owner hold ${method} fallback does not consume its same-page GET`, async () => {
  const f = await fixture(), skipped = f.intercept({ request: () => f.request(method) });
  await f.handler(skipped.route); assert.deepEqual(skipped.state, { fetched: 0, fulfilled: 0, fallback: 1 });
  const next = f.intercept(), pending = f.handler(next.route); await f.hold.arrived();
  assert.equal(next.state.fulfilled, 0); f.hold.release(); await pending; await f.hold.close();
});

test('owner hold arms once before fetch so concurrent same-page GETs fall back during fetch and held delivery', async () => {
  const f = await fixture(), fetched = deferred(), first = f.intercept(); let fetches = 0;
  first.route.fetch = async options => { assert.equal(JSON.stringify(options), '{"maxRetries":0}'); fetches++; await fetched.promise; return first.response as never; };
  const pending = f.handler(first.route);
  const second = f.intercept(); await f.handler(second.route); assert.equal(second.state.fallback, 1); assert.equal(second.state.fetched, 0);
  fetched.resolve(); await f.hold.arrived();
  const third = f.intercept(); await f.handler(third.route); assert.equal(third.state.fallback, 1); assert.equal(third.state.fetched, 0);
  assert.equal(fetches, 1); assert.equal(first.state.fulfilled, 0); f.hold.release(); await pending; await f.hold.close();
});

for (const phase of ['fetch', 'json', 'fulfill', 'fallback'] as const) test(`owner hold preserves the original ${phase} error without retry, replacement delivery or suppression`, async () => {
  const f = await fixture(), failure = new Error(`Synthetic ${phase} failure`); let attempts = 0;
  const fail = async () => { attempts++; throw failure; };
  const route = f.intercept(phase === 'json' ? { fetch: async () => ({ ok: () => true, json: fail }) }
    : phase === 'fallback' ? { request: () => f.request('POST'), fallback: fail } : { [phase]: fail });
  if (phase === 'fulfill') f.hold.release();
  await assert.rejects(f.handler(route.route), error => error === failure);
  await f.hold.close(); assert.equal(attempts, 1); assert.equal(route.state.fulfilled, 0);
  assert.deepEqual(f.removed, [f.registration]);
});

for (const kind of ['failed-response', 'wrong-owner', 'missing-body'] as const) test(`owner hold refuses ${kind} without delivering or rearming`, async () => {
  const f = await fixture();
  const route = f.intercept({ fetch: async () => ({ ok: () => kind !== 'failed-response',
    json: async () => kind === 'missing-body' ? null : { id: kind === 'wrong-owner' ? 'synthetic-other-owner' : owner } }) });
  await assert.rejects(f.handler(route.route), kind === 'failed-response' ? /Real fixture authentication succeeded/ : /Real fixture authentication kept the exact owner/);
  assert.equal(route.state.fulfilled, 0);
  const next = f.intercept(); await f.handler(next.route); assert.equal(next.state.fallback, 1); assert.equal(next.state.fetched, 0);
  await f.hold.close();
});

test('owner hold drains pending fallback errors and preserves exact unroute errors without retries', async () => {
  const f = await fixture(), fallback = deferred(), failure = new Error('Synthetic downstream fallback failure');
  const route = f.intercept({ request: () => f.request('POST'), fallback: async () => { await fallback.promise; throw failure; } });
  const pending = assert.rejects(f.handler(route.route), error => error === failure), closing = f.hold.close();
  await tick(); assert.equal(f.removed.length, 0); fallback.resolve(); await pending; await closing;
  const g = await fixture(), removalError = new Error('Synthetic unroute failure'); let removals = 0;
  g.context.unroute = async (url, handler) => { assert.equal(url, pattern); assert.equal(handler, g.handler); removals++; throw removalError; };
  await assert.rejects(g.hold.close(), error => error === removalError); assert.equal(removals, 1);
});

// Use pinned Playwright server/client source, not a hand-written ownership
// model. The shipped helper is the positive control; only the negative control
// restores its former page-scope registration/removal in memory.
const require = createRequire(import.meta.url);
const playwright = readFileSync(require.resolve('playwright-core/lib/coreBundle'), 'utf8');
function between(startText: string, endText: string, from = 0) {
  const start = playwright.indexOf(startText, from), end = playwright.indexOf(endText, start);
  assert.ok(start >= 0 && end > start); return playwright.slice(start, end);
}
async function installedOwnership(oldPageScope: boolean) {
  const contextStart = playwright.indexOf('    BrowserContextDispatcher = class'), pageStart = playwright.indexOf('    PageDispatcher = class');
  assert.ok(contextStart >= 0 && pageStart >= 0);
  const classes = vm.runInNewContext(`${between('    Route = class extends SdkObject {', '    Response2 = class extends SdkObject {')}
    class Removal { ${between('      async unroute(url3, handler) {', '      async _updateInterceptionPatterns(')} }
    class Patterns { ${between('      async setNetworkInterceptionPatterns(params2, progress2) {', '      async setWebSocketInterceptionPatterns(', oldPageScope ? pageStart : contextStart)} }
    function interceptor() { ${between('        this._requestInterceptor = (route2, request2) => {', '        this._context = context;', contextStart)} return this._requestInterceptor; }
    ({ Route, Removal, Patterns, interceptor });`, {
    SdkObject: class {}, assert, BrowserContext: { Events: { RequestContinued: 'continued' } }, URL,
    deserializeURLMatch: (value: unknown) => value, urlMatches: () => true, urlMatchesEqual: (a: unknown, b: unknown) => a === b,
  });
  const actions: string[] = [], logs: string[] = [], shared: Registration = { url: '**/*', handler: async () => {} };
  const context = { _routes: [shared], route: async (url: string, handler: Handler) => { context._routes.unshift({ url, handler }); } };
  const page = { _routes: [] as Registration[], route: async (url: string, handler: Handler) => { page._routes.unshift({ url, handler }); },
    context: () => context, isClosed: () => false, mainFrame: () => frame };
  const frame = { page: () => page, isDetached: () => false };
  const Traffic = compile(declaration(readFileSync(new URL('./e2e/fixture.ts', import.meta.url), 'utf8'), 'Traffic'), {
    RouteDrain, RouteContinueDiagnostics, sharedSyncRpcPath: '/rest/v1/rpc/save_cloud_state_if_unchanged', URL,
    console: { log: (line: string) => logs.push(line) },
  }).Traffic as new () => { install(context: unknown): Promise<void>; drain(): Promise<void> };
  const traffic = new Traffic();
  await traffic.install({ route: async (_url: string, handler: Handler) => { shared.handler = handler; } });
  const helper = oldPageScope ? helperSource.replace('await context.route(', 'await page.route(').replace('await context.unroute(', 'await page.unroute(') : helperSource;
  const install = compile(helper, { RouteDrain, expect }).holdFreshOwnerVerification as (page: unknown, owner: string) => Promise<Hold>;
  const hold = await install(page, owner), holder = oldPageScope ? page : context;
  const request = { _frame: null, _context: { addRouteInFlight() {}, removeRouteInFlight() {}, emit() {} },
    _applyOverrides: (value: unknown) => value, url: () => pattern, method: () => 'GET', isNavigationRequest: () => false,
    resourceType: () => 'fetch', frame: () => frame, failure: () => null };
  const ownerHandler = () => { actions.push('client-dispatch-pending'); };
  const downstream = classes.interceptor.call({ _interceptionUrlMatchers: [{}], _context: { _options: {} }, connection: { existingDispatcher: () => ({}) } });
  const route = new classes.Route(request, { continue: async () => { actions.push('network-continued'); } });
  route.handle(oldPageScope ? [ownerHandler, downstream] : [ownerHandler]);
  const patterns = Object.assign(new classes.Patterns(), { _interceptionUrlMatchers: [{}], _requestInterceptor: ownerHandler,
    [oldPageScope ? '_page' : '_context']: { removeRequestInterceptor: async (handler: unknown) => { actions.push('server-handler-removed'); await route.removeHandler(handler); } } });
  const removal = Object.assign(new classes.Removal(), { _routes: holder._routes,
    _updateInterceptionPatterns: async function (this: { _routes: Registration[] }) {
      holder._routes = this._routes;
      await patterns.setNetworkInterceptionPatterns({ patterns: this._routes.map(() => ({ glob: '**/*' })) }, { race: (promise: Promise<void>) => promise });
    } });
  Object.assign(holder, { unroute: (url: string, handler: Handler) => removal.unroute(url, handler) });
  await hold.close();
  const pending = shared.handler({ request: () => request, continue: () => route.continue({ isFallback: false }) } as unknown as Route);
  if (oldPageScope) await assert.rejects(pending, /Route is already handled!/); else await pending;
  await traffic.drain();
  return { actions, logs, retainedShared: holder._routes.includes(shared) };
}

test('old page-scope owner close deterministically reproduces the exact already-handled CI diagnostic for a pending dispatch', async () => {
  const probe = await installedOwnership(true);
  assert.deepEqual(probe.actions, ['client-dispatch-pending', 'server-handler-removed', 'network-continued']);
  assert.equal(probe.logs.length, 1);
  assert.deepEqual(JSON.parse(probe.logs[0].slice('QA_ROUTE_CONTINUE_FAILURE '.length)), {
    method: 'GET', resourceClass: 'fetch', failure: 'other', routeError: 'already-handled', requestFailure: 'none',
    pageClosed: false, navigationRequest: false, mainFrame: true, frameDetached: false,
  });
});

test('shipped owner close keeps the shared context interceptor and only one continuation for the same pending dispatch', async () => {
  const probe = await installedOwnership(false);
  assert.deepEqual(probe.actions, ['client-dispatch-pending', 'network-continued']); assert.deepEqual(probe.logs, []); assert.equal(probe.retainedShared, true);
});
