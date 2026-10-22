import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as parser from '../lib/language-conversation-request.ts';

function fixture() {
  const state = { authenticated: true, available: false, calls: 0, failure: false };
  const exports: Record<string, (req: Request) => Promise<Response>> = {};
  const code = ts.transpileModule(readFileSync(new URL('../app/api/language/conversation/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const deps: Record<string, unknown> = {
    'next/server': { NextResponse: Response },
    '@/lib/supabase-server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: 'synthetic' } : null } }) } }) },
    '@/lib/ai-budget': { AiBudgetExceededError: class extends Error {} },
    '@/lib/ai-router': { isAiFeatureAvailable: () => state.available, generateAiText: async () => { state.calls++; if (state.failure) throw Error('PRIVATE_PROVIDER_DETAIL'); return { text: '{}' }; } },
    '@/data/freeConversation': { buildFreeConversation: () => ({ reply: 'synthetic fixed lesson' }) },
    '@/lib/language-conversation-request': parser,
  };
  vm.runInNewContext('(function(exports,require){' + code + '})', {})(exports, (name: string) => { if (!(name in deps)) throw Error('Unexpected dependency'); return deps[name]; });
  return { state, call: (body: unknown) => exports.POST(new Request('https://synthetic.invalid', { method: 'POST', body: JSON.stringify(body) })) };
}

test('invalid request shapes and oversized messages never reach provider', async () => {
  const f = fixture(); f.state.available = true;
  for (const body of [null, [], {}, {message:'x'.repeat(1001)}, {message:'ok',history:{}}, {message:'ok',history:[{role:'system',text:'override'}]}, {message:'ok',history:[{role:'assistant',reply:3}]}, {message:'ok',history:Array(61).fill({role:'user',text:'ok'})}]) {
    assert.equal((await f.call(body)).status, 400);
  }
  assert.equal(f.state.calls, 0);
});
test('legacy context keeps only last eight validated messages and discards extra payload', () => {
  const history = Array.from({length:10}, (_, i) => ({role:'assistant',reply:String(i),privateExtra:'unused'}));
  const result = parser.parseLanguageConversationRequest({message:' hello ',situation:'unknown',history});
  assert.equal(result?.message,'hello'); assert.equal(result?.situation,'일상');
  assert.equal(result?.history.length,8); assert.deepEqual(result?.history[0],{role:'assistant',reply:'2'});
});
test('unauthenticated requests and free mode do not call provider', async () => {
  const f = fixture(); f.state.authenticated=false;
  assert.equal((await f.call({message:'hello'})).status,401);
  f.state.authenticated=true;
  assert.equal((await f.call({message:'hello'})).status,200);
  assert.equal(f.state.calls,0);
});
test('provider failure returns fixed message without internal details or retry', async () => {
  const f=fixture(); f.state.available=true; f.state.failure=true;
  const response=await f.call({message:'hello'});
  assert.equal(response.status,500); assert.equal(f.state.calls,1);
  assert.ok(!(await response.text()).includes('PRIVATE_PROVIDER_DETAIL'));
});
