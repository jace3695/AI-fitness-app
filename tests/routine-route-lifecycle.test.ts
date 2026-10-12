import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { expect, type Route } from '@playwright/test';
import ts from 'typescript';
import { RouteDrain } from './e2e/route-drain.ts';

type Handler = (route: Route) => Promise<void>;
type Registration = { pattern: unknown; handler: Handler; scope: 'page' | 'context' };
const pattern = /\/rest\/v1\/(?:growth_sessions(?:\?|$)|rpc\/save_routine_session(?:\?|$))/;
const rpcPath = '/rest/v1/rpc/save_routine_session';

// Run the shipped scenario setup and finally block, with synthetic request
// boundaries only. No browser, server, credentials or external requests.
async function routineInterceptor(committed = true) {
  const source = readFileSync(new URL('./e2e/routine-record-recovery.spec.ts', import.meta.url), 'utf8');
  const file = ts.createSourceFile('routine-record-recovery.spec.ts', source, ts.ScriptTarget.Latest, true);
  let body: ts.Block | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'test'
      && node.arguments[0]?.getText(file).includes('${mode} response loss and reload')) {
      const callback = node.arguments[1];
      assert.ok(ts.isArrowFunction(callback) && ts.isBlock(callback.body)); body = callback.body;
    }
    ts.forEachChild(node, visit);
  };
  visit(file); assert.ok(body);
  const statements = body.statements;
  const start = statements.findIndex(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(value => value.name.getText(file) === 'drain'));
  const stop = statements.findIndex(ts.isTryStatement); assert.ok(start >= 0 && stop > start);
  const scenario = statements[stop]; assert.ok(ts.isTryStatement(scenario) && scenario.finallyBlock);
  const setup = statements.slice(start, stop).map(node => node.getText(file)).join('\n');
  const cleanup = scenario.finallyBlock.statements.map(node => node.getText(file)).join('\n');
  const script = ts.transpileModule(`(async (page, qa, expect, RouteDrain, pattern, rpcPath, committed) => {
    const mode = 'quick'; ${setup}
    return { requests, calls, drain, cleanup: async () => { ${cleanup} } };
  })`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const registrations: Registration[] = [], removed: Registration[] = [], logs: string[] = [];
  const shared: Registration = { pattern: '**/*', handler: async () => {}, scope: 'context' };
  registrations.push(shared);
  const routing = (scope: Registration['scope']) => ({
    route: async (value: unknown, handler: Handler) => { registrations.unshift({ pattern: value, handler, scope }); },
    unroute: async (value: unknown, handler: Handler) => {
      assert.equal(typeof handler, 'function', 'Remove only the scenario handler, never every handler matching its pattern');
      const index = registrations.findIndex(row => row.pattern === value && row.handler === handler && row.scope === scope);
      assert.notEqual(index, -1); removed.push(...registrations.splice(index, 1));
    },
  });
  const context = routing('context'), page = { ...routing('page'), context: () => context };
  const install = vm.runInNewContext(script, { URL, console: { log: (...parts: unknown[]) => logs.push(parts.join(' ')) } });
  const state = await install(page, { account: { id: 'synthetic-owner' } }, expect, RouteDrain, pattern, rpcPath, committed) as {
    requests: unknown[]; calls: string[]; drain: RouteDrain; cleanup: () => Promise<void>;
  };
  const registered = registrations.find(row => row !== shared); assert.ok(registered);
  return { ...state, page, context, registrations, registered, removed, shared, logs };
}

test('routine interceptor retains shared context ownership and removes only its exact handler after draining', async () => {
  const fixture = await routineInterceptor(); assert.equal(fixture.registered.scope, 'context');
  const other = async () => {}; await fixture.context.route(pattern, other);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const payload = { p_payload: { id: 'synthetic-row', memo: 'PRIVATE_SYNTHETIC_RECORD' } };
  const request = { frame: () => ({ page: () => fixture.page }), method: () => 'POST', url: () => `http://127.0.0.1:54321${rpcPath}`, postDataJSON: () => payload };
  let fetches = 0, fulfills = 0;
  const handling = fixture.registered.handler({ request: () => request,
    fetch: async (options: unknown) => { assert.equal(JSON.stringify(options), '{"maxRetries":0}'); fetches++; await gate; return { ok: () => true }; },
    fulfill: async (options: { status: number }) => { assert.equal(options.status, 503); fulfills++; },
  } as unknown as Route);
  const cleanup = fixture.cleanup();
  await Promise.resolve(); assert.equal(fixture.removed.length, 0, 'An unsettled callback must delay removal');
  release(); await handling; await cleanup;
  assert.equal(fetches, 1); assert.equal(fulfills, 1); assert.equal(fixture.requests[0], payload);
  assert.deepEqual([...fixture.calls], ['POST']); assert.deepEqual(fixture.removed, [fixture.registered]);
  assert.ok(fixture.registrations.includes(fixture.shared)); assert.ok(fixture.registrations.some(row => row.handler === other));
  assert.doesNotMatch(fixture.logs.join('\n'), /PRIVATE|synthetic-owner|synthetic-row|127\.0\.0\.1/);
});

for (const scope of ['sibling', 'frameless']) test(`routine injection falls back for ${scope} requests before inspecting data and preserves fallback errors`, async () => {
  const fixture = await routineInterceptor(); let fallbacks = 0;
  const request = { frame: () => { if (scope === 'frameless') throw new Error('synthetic missing frame'); return { page: () => ({}) }; },
    url: () => assert.fail('Do not inspect another page URL'), method: () => assert.fail('Do not inspect another page method'),
    postDataJSON: () => assert.fail('Do not inspect another page payload'), headers: () => assert.fail('Do not inspect another page headers') };
  const route = { request: () => request, fallback: async () => { fallbacks++; },
    fetch: () => assert.fail('Do not fetch for another page'), fulfill: () => assert.fail('Do not inject on another page') };
  await fixture.registered.handler(route as unknown as Route);
  const failure = new Error('synthetic downstream failure');
  await assert.rejects(fixture.registered.handler({ ...route, fallback: async () => { fallbacks++; throw failure; } } as unknown as Route), error => error === failure);
  assert.equal(fallbacks, 2); assert.equal(fixture.requests.length, 0); assert.equal(fixture.calls.length, 0);
  await fixture.cleanup();
});

test('routine interception preserves original fetch and downstream fallback failures without retrying', async () => {
  for (const method of ['POST', 'GET']) {
    const fixture = await routineInterceptor(); const failure = new Error('synthetic transport failure'); let attempts = 0;
    const fail = async () => { attempts++; throw failure; };
    const request = { frame: () => ({ page: () => fixture.page }), method: () => method,
      url: () => `http://127.0.0.1:54321${method === 'POST' ? rpcPath : '/rest/v1/growth_sessions'}`,
      postDataJSON: () => ({ p_payload: { id: 'synthetic-row' } }) };
    await assert.rejects(fixture.registered.handler({ request: () => request, fetch: fail, fallback: fail,
      fulfill: () => assert.fail('A failed request must not become synthetic success'),
    } as unknown as Route), error => error === failure);
    assert.equal(attempts, 1); await fixture.cleanup();
  }
});

// Execute installed Playwright routing code rather than a hand-written model
// of its ownership transfer. This remains a pure VM probe, not browser QA.
const require = createRequire(import.meta.url);
const playwright = readFileSync(require.resolve('playwright-core/lib/coreBundle'), 'utf8');
function between(startText: string, endText: string, from = 0) {
  const start = playwright.indexOf(startText, from), end = playwright.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, 'The pinned Playwright routing implementation must be inspectable');
  return playwright.slice(start, end);
}

async function installedRouting(scope: 'page' | 'context') {
  const routeCode = between('    Route = class extends SdkObject {', '    Response2 = class extends SdkObject {');
  const contextStart = playwright.indexOf('    BrowserContextDispatcher = class'); assert.ok(contextStart >= 0);
  const patternCode = between('      async setNetworkInterceptionPatterns(params2, progress2) {', '      async setWebSocketInterceptionPatterns(', contextStart);
  const clientCode = between('      async _unrouteInternal(removed, remaining, behavior) {', '      async _updateInterceptionPatterns(');
  const interceptorCode = between('        this._requestInterceptor = (route2, request2) => {', '        this._context = context;', contextStart);
  const classes = vm.runInNewContext(`${routeCode}
    class Removal { ${clientCode} } class Patterns { ${patternCode} }
    function interceptor() { ${interceptorCode} return this._requestInterceptor; }
    ({ Route, Removal, Patterns, interceptor });`, {
    SdkObject: class {}, assert, BrowserContext: { Events: { RequestContinued: 'continued' } }, URL,
    deserializeURLMatch: (value: unknown) => value, urlMatches: () => true,
  });
  const actions: string[] = [];
  const request = { _frame: null, _context: { addRouteInFlight() {}, removeRouteInFlight() {}, emit() {} },
    _applyOverrides: (value: unknown) => value, url: () => 'http://127.0.0.1:54321/rest/v1/growth_sessions' };
  let dispatch!: () => Promise<void>;
  const pageHandler = (route: { continue(options: unknown): Promise<void> }) => {
    actions.push('page-client-fallback'); dispatch = () => route.continue({ isFallback: false });
  };
  const existingDispatcher = classes.interceptor.call({ _interceptionUrlMatchers: [{}], _context: { _options: {} },
    connection: { existingDispatcher: () => ({}) } });
  const contextHandler = scope === 'page' ? existingDispatcher : (route: { continue(options: unknown): Promise<void> }) => {
    actions.push('context-client-fallback'); dispatch = () => route.continue({ isFallback: false });
  };
  const route = new classes.Route(request, { continue: async () => { actions.push('network-continued'); } });
  route.handle(scope === 'page' ? [pageHandler, contextHandler] : [contextHandler]);
  const owner = scope === 'page' ? pageHandler : contextHandler;
  const patterns = Object.assign(new classes.Patterns(), { _interceptionUrlMatchers: [{}], _requestInterceptor: owner,
    _context: { removeRequestInterceptor: async (handler: unknown) => { actions.push('server-handler-removed'); await route.removeHandler(handler); } } });
  const handlers = scope === 'page' ? [{}] : [{}, { shared: true }];
  const removal = Object.assign(new classes.Removal(), { _routes: handlers,
    _updateInterceptionPatterns: async function (this: { _routes: unknown[] }) {
      await patterns.setNetworkInterceptionPatterns({ patterns: this._routes.map(() => ({ glob: '**/*' })) }, { race: (promise: Promise<void>) => promise });
    } });
  await removal._unrouteInternal([handlers[0]], scope === 'page' ? [] : [handlers[1]], 'default');
  return { actions, dispatch };
}

test('installed Playwright reproduces a page-unroute double continuation after a context fallback', async () => {
  const probe = await installedRouting('page');
  await assert.rejects(probe.dispatch(), /Route is already handled!/);
  assert.deepEqual(probe.actions, ['page-client-fallback', 'server-handler-removed', 'network-continued']);
});

test('installed Playwright keeps one terminal continuation when scenario removal retains the shared context interceptor', async () => {
  const probe = await installedRouting('context'); await probe.dispatch();
  assert.deepEqual(probe.actions, ['context-client-fallback', 'network-continued']);
});
