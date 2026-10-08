import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { characterReplyEnabled } from '../lib/yeoni/reply-plan.ts';
import { savedAlignmentConfiguration } from '../lib/yeoni/speech-alignment.ts';
const plan = JSON.parse(readFileSync('services/yeoni-alignment/general-validation-plan.json', 'utf8'));
const code = ts.transpileModule(readFileSync('app/api/yeoni/alignment-review/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
function setup(options: { production?: boolean; authenticated?: boolean } = {}) {
  let calls = 0, authCalls = 0;
  const imports: Record<string, unknown> = {
    '@/lib/supabase-server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => { authCalls++; return { data: { user: options.authenticated === false ? null : { id: 'fixture' } }, error: null }; } } }) },
    '@/lib/yeoni/reply-plan': { characterReplyEnabled },
    '@/lib/yeoni/speech-alignment': { savedAlignmentConfiguration, alignGeneratedReply: async (_audio: string, text: string) => { calls++; assert.equal(text, plan.cases[0].text); return { fixture: true }; } },
    '@/services/yeoni-alignment/general-validation-plan.json': plan,
  };
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  vm.runInNewContext(`(function(exports,require){${code}\n})`, { Response, Buffer, console, process: { env: {
    VERCEL_ENV: options.production ? 'production' : 'preview', VERCEL_GIT_COMMIT_REF: 'agent/yeoni-cat-animation-poc',
    YEONI_ALIGNMENT_INTERNAL_URL: 'https://private.invalid/worker', YEONI_ALIGNMENT_TOKEN: 'x'.repeat(32),
  } } })(exports, (name: string) => { assert.ok(name in imports); return imports[name]; });
  return { post: exports.POST!, calls: () => calls, authCalls: () => authCalls };
}
const request = (body: unknown = { id: 'short', audioContent: 'YWJj' }, origin = 'https://review.invalid') => new Request('https://review.invalid/api/yeoni/alignment-review', {
  method: 'POST', headers: { origin, host: 'review.invalid' }, body: JSON.stringify(body),
});
test('production and foreign origins never reach authentication or alignment', async () => {
  const prod = setup({ production: true }); assert.equal((await prod.post(request())).status, 404); assert.equal(prod.authCalls(), 0);
  const preview = setup(); assert.equal((await preview.post(request({}, 'https://other.invalid'))).status, 403); assert.equal(preview.authCalls(), 0); assert.equal(preview.calls(), 0);
});
test('unauthenticated requests cannot submit audio', async () => {
  const app = setup({ authenticated: false }); assert.equal((await app.post(request())).status, 401); assert.equal(app.calls(), 0);
});
test('only fixed case text reaches worker; caller text cannot override it', async () => {
  const app = setup(); assert.equal((await app.post(request({ id: 'short', audioContent: 'YWJj', text: 'unapproved' }))).status, 200); assert.equal(app.calls(), 1);
  assert.equal((await app.post(request({ id: 'unapproved', audioContent: 'YWJj' }))).status, 400); assert.equal(app.calls(), 1);
});
test('stream size bound works without content-length and invalid audio is rejected', async () => {
  const app = setup(); assert.equal((await app.post(request({ id: 'short', audioContent: '!invalid!' }))).status, 400);
  assert.equal((await app.post(request({ id: 'short', audioContent: 'a'.repeat(2_010_001) }))).status, 413); assert.equal(app.calls(), 0);
});
