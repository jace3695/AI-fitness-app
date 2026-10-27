import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const origin = 'https://synthetic.invalid';
const path = '/language/practice/access-check';
function setup(online = true) {
  const listeners = new Map<string, (event: unknown) => void>();
  const calls = { fetch: [] as { url: string; init: unknown }[], matched: [] as unknown[], put: [] as unknown[], deleted: [] as string[], removed: [] as string[] };
  const entries = [`${origin}${path}`, `${origin}${path}?_rsc=one`, `${origin}${path}/`, `${origin}/language/practice`, `${origin}/`];
  const cache = { keys: async () => entries.map(url => ({ url })), delete: async (request: { url: string }) => { calls.deleted.push(request.url); return true; }, put: async (request: unknown) => { calls.put.push(request); }, addAll: async () => {} };
  const worker = { location: { origin }, addEventListener: (name: string, fn: (event: unknown) => void) => listeners.set(name, fn), clients: { claim: async () => {} } };
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    self: worker, URL, Response,
    caches: { keys: async () => ['jace-ai-hub-v6-app', 'jace-ai-hub-v6-static'], open: async () => cache, delete: async (name: string) => { calls.removed.push(name); }, match: async (request: unknown) => { calls.matched.push(request); return new Response('cached ordinary'); } },
    fetch: async (request: { url: string }, init: unknown) => { calls.fetch.push({ url: request.url, init }); if (!online) throw Error('offline'); return new Response('synthetic document'); },
  });
  async function fetchPath(suffix: string, mode = 'navigate') {
    let response: Promise<Response> | undefined;
    listeners.get('fetch')!({ request: { url: `${origin}${suffix}`, mode, method: 'GET' }, respondWith: (value: Promise<Response>) => { response = value; } });
    return response;
  }
  async function activate() { let done: Promise<unknown> | undefined; listeners.get('activate')!({ waitUntil: (value: Promise<unknown>) => { done = value; } }); await done; }
  return { calls, fetchPath, activate };
}

test('service worker never caches diagnostic navigations or RSC/query variants online', async () => {
  const h = setup();
  for (const [suffix, mode] of [[path, 'navigate'], [`${path}?_rsc=x`, 'cors'], [`${path}/`, 'navigate']]) assert.equal((await h.fetchPath(suffix, mode))!.status, 200);
  assert.equal(h.calls.fetch.length, 3); assert.deepEqual(h.calls.matched, []); assert.deepEqual(h.calls.put, []);
  assert.ok(h.calls.fetch.every(call => JSON.stringify(call.init) === JSON.stringify({ cache: 'no-store', redirect: 'error' })));
});

test('offline diagnostic explicitly fails 503 without replaying itself, home or offline fallback', async () => {
  const h = setup(false);
  const response = (await h.fetchPath(path))!;
  assert.equal(response.status, 503); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(h.calls.matched, []); assert.deepEqual(h.calls.put, []);
});

test('activation purges only matching diagnostic documents including old query variants', async () => {
  const h = setup(); await h.activate();
  assert.equal(h.calls.deleted.length, 6); // three matching entries in each existing app/static cache
  assert.ok(h.calls.deleted.every(url => new URL(url).pathname.startsWith(path)));
  assert.deepEqual(h.calls.removed, []); // existing current caches remain intact
});

test('ordinary online navigation caching and offline fallback stay unchanged', async () => {
  const online = setup(); assert.equal((await online.fetchPath('/language/practice'))!.status, 200);
  await Promise.resolve(); assert.equal(online.calls.put.length, 1);
  const offline = setup(false); assert.equal(await (await offline.fetchPath('/language/practice'))!.text(), 'cached ordinary');
  assert.equal(offline.calls.matched.length, 1);
});
