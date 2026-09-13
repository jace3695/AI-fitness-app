import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import * as resets from './appRecordReset.ts';
import * as storage from './storageTransaction.ts';

// Run the original query functions with the installed SDK and an in-memory
// fetch boundary. No credentials, real auth, browser or remote server is used.
function cloudWithFetch(send: typeof fetch): typeof import('./cloudSync.ts') {
  const supabase = createClient('http://127.0.0.1:1', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: send },
  });
  const code = ts.transpileModule(readFileSync(new URL('./cloudSync.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const requireFixture = (path: string) => {
    if (path === '../lib/supabase.ts') return { supabase };
    if (path === './appRecordReset.ts') return resets;
    if (path === './storageTransaction.ts') return storage;
    throw new Error(`Unexpected dependency: ${path}`);
  };
  vm.runInNewContext(`(function(exports, require) { ${code}\n})`)(exports, requireFixture);
  return exports as typeof import('./cloudSync.ts');
}

test('GET/PATCH/insert and confirmation GET pass the session abort signal to the actual SDK', async () => {
  const controller = new AbortController();
  const methods: string[] = [];
  const state = { 'ai-fitness-fixture': { memo: 'synthetic' } };
  const cloud = cloudWithFetch(async (_url, init) => {
    assert.equal(init?.signal, controller.signal);
    const method = init?.method ?? 'GET'; methods.push(method);
    return new Response(JSON.stringify(method === 'GET' ? [{ state, updated_at: '1' }] : { updated_at: '1' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  });
  await cloud.getRemoteState('fixture-user', controller.signal);
  assert.equal(await cloud.saveRemoteStateIfUnchanged('fixture-user', state, '1', controller.signal), true);
  await cloud.saveRemoteState('fixture-user', state, controller.signal);
  assert.deepEqual(methods, ['GET', 'PATCH', 'GET', 'POST', 'GET']);
  controller.abort();
  await assert.rejects(cloud.saveRemoteState('fixture-user', {}, controller.signal), { name: 'AbortError' });
  assert.equal(methods.length, 5, 'A cancelled operation reached fetch');
});

test('a PATCH already committed before logout cannot start its confirmation GET after abort', async () => {
  const controller = new AbortController();
  const methods: string[] = [];
  const cloud = cloudWithFetch(async (_url, init) => {
    methods.push(init!.method!); assert.equal(init?.signal, controller.signal);
    // Model a delivered commit whose fetch ignores cancellation. The query
    // function must check the signal again before starting the readback.
    controller.abort();
    return new Response('{"updated_at":"2"}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  await assert.rejects(cloud.saveRemoteStateIfUnchanged('fixture-user', { 'ai-fitness-fixture': 1 }, '1', controller.signal), { name: 'AbortError' });
  assert.deepEqual(methods, ['PATCH']);
});
