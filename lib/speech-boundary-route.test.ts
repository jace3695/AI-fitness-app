import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import { createBoundaryCheck, type BoundaryState } from './speech-boundary-check.ts';
import { createBoundaryFetch, invokeBoundaryProbe } from './speech-boundary-transport.ts';
import { isSpeechBoundaryPath, SPEECH_BOUNDARY_PATH } from './speech-boundary-path.ts';
import { verifyBoundaryPage } from './speech-boundary-page-gate.ts';

type Element = { type: string | ((props: Record<string, unknown>) => unknown); props: Record<string, unknown> };
const jsx = (type: Element['type'], props: Element['props']) => ({ type, props });
function load(path: string, modules: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(compiled, { exports, ...globals, require: (name: string) => {
    assert.ok(name in modules, `Unexpected dependency: ${name}`);
    const value = modules[name];
    return value && typeof value === 'object' && 'default' in value ? { __esModule: true, ...value } : value;
  } });
  return exports;
}
const owner = '00000000-0000-4000-8000-000000000001';
const hash = createHash('sha256').update(owner).digest('hex');
const project = 'https://piqqukiiacncfbztktga.supabase.co';
const allowedEnv = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'agent/fitness-record-priority', NEXT_PUBLIC_SUPABASE_URL: project, YEONI_SPEECH_API_SCHEMA: 'yeoni_speech_proof_candidate', AZURE_SPEECH_ASSESSMENT_ENABLED: 'false', AZURE_SPEECH_ASSESSMENT_TEST_OWNER_ID: owner };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function waitFor<T>(promise: Promise<T>, description: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      // Failure guard only: the production flow still owns its 15-second budget.
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${description}`)), 20000);
    })]);
  } finally { clearTimeout(timer); }
}

test('server-only Preview gate rejects every omitted/mismatched condition, including runtime versus baked URL', () => {
  const gate = (builtUrl = project) => load('./speech-boundary-gate.ts', { 'server-only': {}, 'node:crypto': { createHash }, './supabase-config.ts': { SUPABASE_URL: builtUrl } }).speechBoundaryOwnerHash as (env: Record<string, unknown>) => string | null;
  assert.equal(gate()(allowedEnv), hash);
  for (const key of Object.keys(allowedEnv)) assert.equal(gate()({ ...allowedEnv, [key]: undefined }), null, key);
  for (const patch of [{ VERCEL_ENV: 'production' }, { VERCEL_GIT_COMMIT_REF: 'main' }, { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }, { AZURE_SPEECH_ASSESSMENT_ENABLED: 'true' }, { YEONI_SPEECH_API_BOUNDARY_REVIEWED: '1' }, { AZURE_SPEECH_ASSESSMENT_DATA_POLICY_ID: 'x' }, { AZURE_SPEECH_ASSESSMENT_TEST_OWNER_ID: 'not-uuid' }]) assert.equal(gate()({ ...allowedEnv, ...patch }), null);
  assert.equal(gate('https://different.invalid')(allowedEnv), null);
  assert.equal(gate('http://127.0.0.1:54321')(allowedEnv), null);
});

test('dynamic page hides without gate and serializes only owner hash, never configured account ID', () => {
  let allowed = true;
  const page = load('../app/language/practice/access-check/page.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/navigation': { notFound: () => { throw Error('404'); } },
    '@/lib/speech-boundary-gate': { speechBoundaryOwnerHash: () => allowed ? hash : null },
    './AccessCheckClient': { default: 'panel' },
  }, { process: { env: allowedEnv } });
  assert.equal(page.dynamic, 'force-dynamic'); assert.equal(page.runtime, 'nodejs');
  const render = page.default as () => Element;
  assert.deepEqual({ ...render().props }, { ownerHash: hash });
  assert.ok(!JSON.stringify(render()).includes(owner));
  allowed = false; assert.throws(render, /404/);
});

function routeHarness(path: string | null, gateAllowed = true, delays: { beforeDigest?: () => Promise<void>; beforeProbe?: () => Promise<void> } = {}) {
  const mounted: string[] = [], effects: (() => unknown)[] = [], elements: Element[] = [], states: BoundaryState[] = [], calls: { path: string; method?: string }[] = [];
  const terminal = deferred<BoundaryState>();
  const modules: Record<string, unknown> = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    react: { useEffect: (fn: () => unknown) => effects.push(fn), useRef: (value: unknown) => ({ current: value }), useState: (value: BoundaryState) => [value, (next: BoundaryState) => {
      states.push(next);
      if (next.outcome !== 'idle' && next.outcome !== 'running') terminal.resolve(next);
    }] },
    'next/navigation': { usePathname: () => path },
    '@/lib/speech-boundary-path': { isSpeechBoundaryPath },
  };
  const isolation = load('../app/components/DiagnosticIsolation.tsx', modules).default;
  const component = (name: string) => ({ default: (props: Record<string, unknown>) => { mounted.push(name); return props.children ?? null; } });
  const root = load('../app/layout.tsx', {
    ...modules, './globals.css': {}, './components/DiagnosticIsolation': { default: isolation },
    ...Object.fromEntries(['PwaManager', 'AiBudgetNotifier', 'RecordResetListener', 'CloudSyncPanel', 'SyncQaPanel'].map(name => [`./components/${name}`, component(name)])),
    '@/components/yeoni/CommonCharacterShell': component('CommonCharacterShell'), '@/lib/yeoni/common-host-policy': { commonCharacterEnabled: () => true },
  }, { process: { env: { NODE_ENV: 'development' } } }).default as (props: Record<string, unknown>) => Element;
  const language = load('../app/language/layout.tsx', {
    ...modules, './language.css': {}, '../components/DiagnosticIsolation': { default: isolation }, '../components/AuthGate': component('AuthGate'),
    '@/components/TopNav': component('TopNav'), '@/components/LanguageCloudSync': component('LanguageCloudSync'), '../components/AppIdentity': component('AppIdentity'),
  }).default as (props: Record<string, unknown>) => Element;
  const sdk = createClient('http://127.0.0.1:54321', 'sb_publishable_synthetic_boundary_only', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createBoundaryFetch(async (input, init) => {
      const pathname = new URL(String(input)).pathname;
      calls.push({ path: pathname, method: init?.method });
      if (delays.beforeProbe) await delays.beforeProbe();
      return pathname.endsWith('/ready') ? Response.json(false) : new Response(null, { status: 403 });
    }, 'http://127.0.0.1:54321') },
  });
  let authCalls = 0, gateCalls = 0, unsubscribed = false;
  let authCallback: ((event: string, session: { user: { id: string } } | null) => void) | undefined;
  const client = { schema: sdk.schema.bind(sdk), auth: { getUser: async () => { authCalls++; return { data: { user: { id: owner } }, error: null }; }, onAuthStateChange: (callback: typeof authCallback) => { authCallback = callback; return { data: { subscription: { unsubscribe: () => { unsubscribed = true; } } } }; } } };
  const listeners = new Map<string, () => void>();
  const crypto = delays.beforeDigest ? { subtle: { digest: async (...args: Parameters<typeof webcrypto.subtle.digest>) => {
    await delays.beforeDigest!();
    return webcrypto.subtle.digest(...args);
  } } } : webcrypto;
  const panel = load('../app/language/practice/access-check/AccessCheckClient.tsx', {
    ...modules, 'next/link': { default: 'a' }, '@/app/lib/supabase': { supabase: client }, '@/lib/speech-boundary-check': { createBoundaryCheck }, '@/lib/speech-boundary-transport': { invokeBoundaryProbe }, '@/lib/speech-boundary-page-gate': { verifyBoundaryPage: async () => { gateCalls++; return gateAllowed; } },
  }, { AbortController, crypto, TextEncoder, window: { addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) } }).AccessCheckPanel as (props: Record<string, unknown>) => Element;
  function mount(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(mount); return; }
    const element = node as Element;
    if (typeof element.type === 'function') mount(element.type(element.props));
    else { elements.push(element); mount(element.props.children); }
  }
  mount(jsx(root, { children: jsx(language, { children: jsx(panel, { ownerHash: hash, client }) }) }));
  const cleanup = effects.map(effect => effect()).filter((value): value is () => void => typeof value === 'function');
  return { mounted, elements, states, calls, listeners, terminal: terminal.promise, authCalls: () => authCalls, gateCalls: () => gateCalls, authChanged: (id: string) => authCallback?.('SIGNED_IN', { user: { id } }), cleanup: () => cleanup.forEach(fn => fn()), unsubscribed: () => unsubscribed };
}

test('full root + language + real panel synthetic mount excludes all record services before/after explicit SDK probes', async t => {
  const h = routeHarness(SPEECH_BOUNDARY_PATH);
  t.after(() => { h.cleanup(); assert.equal(h.listeners.size, 0); assert.equal(h.unsubscribed(), true); });
  assert.deepEqual(h.mounted, []); assert.equal(h.calls.length, 0); assert.equal(h.authCalls(), 0); assert.equal(h.gateCalls(), 0);
  const button = h.elements.find(element => element.type === 'button')!;
  (button.props.onClick as () => void)();
  const terminal = await waitFor(h.terminal, 'terminal boundary state');
  assert.equal(h.authCalls(), 1); assert.equal(h.gateCalls(), 1);
  assert.equal(terminal.outcome, 'denials-confirmed');
  assert.deepEqual(h.calls.map(call => call.path), ['/rest/v1/keys', '/rest/v1/policy', '/rest/v1/total', '/rest/v1/rpc/authorized', '/rest/v1/rpc/payload', '/rest/v1/rpc/ready']);
  assert.deepEqual(h.calls.map(call => call.method), ['HEAD', 'HEAD', 'HEAD', 'POST', 'POST', 'POST']);
  assert.deepEqual(h.mounted, []);
  h.authChanged('00000000-0000-4000-8000-000000000002'); h.authChanged(owner);
  assert.equal((h.states.at(-1) as { outcome: string }).outcome, 'account-changed');
  assert.ok(!JSON.stringify(h.states).includes(owner));
});

test('terminal wait remains pending across held real crypto and SDK probe work, then observes all six probes', async t => {
  const digestEntered = deferred<void>(), releaseDigest = deferred<void>();
  const probeEntered = deferred<void>(), releaseProbe = deferred<void>();
  const h = routeHarness(SPEECH_BOUNDARY_PATH, true, {
    beforeDigest: () => { digestEntered.resolve(); return releaseDigest.promise; },
    beforeProbe: () => { probeEntered.resolve(); return releaseProbe.promise; },
  });
  t.after(() => { h.cleanup(); releaseDigest.resolve(); releaseProbe.resolve(); });
  let completed = false;
  void h.terminal.then(() => { completed = true; });
  (h.elements.find(element => element.type === 'button')!.props.onClick as () => void)();
  await waitFor(digestEntered.promise, 'owner digest to start');
  assert.equal(completed, false); assert.equal(h.states.at(-1)?.outcome, 'running'); assert.equal(h.calls.length, 0);
  releaseDigest.resolve();
  await waitFor(probeEntered.promise, 'first SDK probe to start');
  assert.equal(completed, false); assert.equal(h.states.at(-1)?.outcome, 'running'); assert.equal(h.calls.length, 1);
  releaseProbe.resolve();
  const terminal = await waitFor(h.terminal, 'delayed terminal boundary state');
  assert.equal(terminal.outcome, 'denials-confirmed'); assert.equal(completed, true);
  assert.equal(h.authCalls(), 1); assert.equal(h.gateCalls(), 1); assert.deepEqual(h.mounted, []);
  assert.deepEqual(h.calls.map(call => call.path), ['/rest/v1/keys', '/rest/v1/policy', '/rest/v1/total', '/rest/v1/rpc/authorized', '/rest/v1/rpc/payload', '/rest/v1/rpc/ready']);
  assert.deepEqual(h.calls.map(call => call.method), ['HEAD', 'HEAD', 'HEAD', 'POST', 'POST', 'POST']);
  assert.deepEqual(terminal.checks.map(check => check.outcome), Array(6).fill('expected-denial'));
});

test('ordinary language route still mounts every original service; diagnostic variants remain isolated', () => {
  const h = routeHarness('/language/practice');
  assert.deepEqual(h.mounted, ['PwaManager', 'AiBudgetNotifier', 'RecordResetListener', 'SyncQaPanel', 'CommonCharacterShell', 'AuthGate', 'AppIdentity', 'TopNav', 'LanguageCloudSync', 'CloudSyncPanel']);
  h.cleanup();
  for (const path of [SPEECH_BOUNDARY_PATH, `${SPEECH_BOUNDARY_PATH}/`, `${SPEECH_BOUNDARY_PATH}/missing`]) assert.equal(isSpeechBoundaryPath(path), true);
  for (const path of ['/language/practice', '/', `${SPEECH_BOUNDARY_PATH}-other`, null]) assert.equal(isSpeechBoundaryPath(path), false);
});


test('fresh HEAD server gate rejects stale owner, disabled settings and absent hash without auth or DB work', async () => {
  let current: string | null = hash;
  const api = load('../app/api/language/access-check/route.ts', {
    '@/lib/speech-boundary-gate': { speechBoundaryOwnerHash: () => current },
  }, { process: { env: allowedEnv }, Response });
  assert.equal(api.dynamic, 'force-dynamic');
  const head = api.HEAD as (request: Request) => Response;
  const request = (value = hash) => new Request('https://synthetic.invalid/api/language/access-check', { method: 'HEAD', headers: { 'X-Yeoni-Boundary-Owner': value } });
  assert.equal(head(request()).status, 204);
  assert.equal(head(request('different')).status, 404);
  assert.equal(head(new Request('https://synthetic.invalid/api/language/access-check', { method: 'HEAD' })).status, 404);
  current = null;
  const response = head(request()); assert.equal(response.status, 404); assert.equal(await response.text(), '');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('cached/offline page cannot issue any owner or database probe when fresh gate refuses', async t => {
  const h = routeHarness(SPEECH_BOUNDARY_PATH, false);
  t.after(h.cleanup);
  (h.elements.find(element => element.type === 'button')!.props.onClick as () => void)();
  const terminal = await waitFor(h.terminal, 'refused gate terminal state');
  assert.equal(h.gateCalls(), 1); assert.equal(h.authCalls(), 0); assert.equal(h.calls.length, 0);
  assert.equal(terminal.outcome, 'account-unavailable');
});

test('fresh page-gate fetch is HEAD/no-store/no-redirect, body unread, cancellation-aware and fail-closed', async () => {
  for (const status of [204, 200, 301, 403, 404, 503]) {
    let cancelled = 0, reads = 0;
    const signal = new AbortController().signal;
    const ok = await verifyBoundaryPage(hash, signal, async (input, init) => {
      assert.equal(input, '/api/language/access-check'); assert.equal(init?.method, 'HEAD'); assert.equal(init?.cache, 'no-store'); assert.equal(init?.redirect, 'error'); assert.equal(init?.signal, signal);
      assert.equal(new Headers(init?.headers).get('X-Yeoni-Boundary-Owner'), hash);
      const body = status === 204 ? null : new ReadableStream({ pull() { reads++; }, cancel() { cancelled++; } }, { highWaterMark: 0 });
      return new Response(body, { status });
    });
    assert.equal(ok, status === 204); assert.equal(reads, 0); assert.equal(cancelled, status === 204 ? 0 : 1);
  }
  await assert.rejects(verifyBoundaryPage(hash, new AbortController().signal, async () => { throw Error('offline'); }));
  const cancelled = new AbortController(); cancelled.abort(); let calls = 0;
  await assert.rejects(verifyBoundaryPage(hash, cancelled.signal, async () => { calls++; return new Response(null, { status: 204 }); })); assert.equal(calls, 0);
});

test('unknown pathname renders neither unguarded page children nor ordinary record services', () => {
  const h = routeHarness(null); assert.equal(h.mounted.length, 0); assert.equal(h.calls.length, 0); assert.equal(h.elements.filter(element => element.type === 'button').length, 0); assert.equal(h.authCalls(), 0); h.cleanup();
});
