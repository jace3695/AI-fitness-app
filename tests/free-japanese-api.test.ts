import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as service from '../lib/free-japanese-conversation.ts';

function fixture(authenticated = true) {
  let calls = 0;
  const deps: Record<string, unknown> = {
    '@/lib/supabase-server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'synthetic' } : null }, error: null }) } }) },
    '@/lib/free-japanese-conversation': { ...service, generateFreeJapanese: async () => { calls++; return { source: 'ai', reply: '合成応答' }; } },
  };
  const source = readFileSync(new URL('../app/api/language/practice/route.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  vm.runInNewContext('(function(exports,require){' + code + '})', { Response, process: { env: {} }, fetch: () => { throw Error('no network'); } })(exports, (name: string) => { assert.ok(name in deps); return deps[name]; });
  const run = (body: unknown) => exports.POST!(new Request('https://synthetic.invalid/api/language/practice', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));
  return { run, calls: () => calls };
}
const input = { message: 'こんにちは', situation: '일상', history: [], freeDataUseAcknowledged: true };
test('practice API requires verified authentication before generation', async () => {
  const f = fixture(false); assert.equal((await f.run(input)).status, 401); assert.equal(f.calls(), 0);
});
test('practice API rejects consent omission, unrelated data and malformed requests', async () => {
  const f = fixture();
  for (const body of ['{bad', { ...input, freeDataUseAcknowledged: false }, { ...input, records: { weight: 70 } }]) assert.equal((await f.run(body)).status, 400);
  assert.equal((await f.run('x'.repeat(30001))).status, 413); assert.equal(f.calls(), 0);
});
test('approved bounded request generates once with no record-reading client methods', async () => {
  const f = fixture(); const response = await f.run(input);
  assert.equal(response.status, 200); assert.equal(f.calls(), 1);
  assert.match(response.headers.get('cache-control')!, /no-store/);
  assert.equal((await response.json()).source, 'ai');
});
