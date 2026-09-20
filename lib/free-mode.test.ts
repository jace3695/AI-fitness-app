import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as freeMode from './free-mode.ts';
import * as policies from './ai-router-policy.ts';
import * as voicePolicy from './yeoni-voice-policy.ts';
import * as crypto from 'node:crypto';
import { readZephyrRequest } from './zephyr-free-server.ts';

function loadModule(path: string, modules: Record<string, unknown>, forbidden: () => never) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(`(function(exports, require) { ${code}\n})`, {
    process: { env: { GEMINI_API_KEY: 'synthetic-configured', OPENAI_API_KEY: 'synthetic-configured', GOOGLE_TTS_API_KEY: 'synthetic-configured', PAID_AI_ENABLED: 'true', FREE_MODE: 'false' } },
    fetch: forbidden, console, Response,
  })(exports, (name: string) => { assert.ok(name in modules, `Unexpected import: ${name}`); return modules[name]; });
  return exports;
}

test('legacy keys and environment switches cannot enable paid AI or reserve budget', async () => {
  let calls = 0; const forbidden = () => { calls++; throw new Error('Paid boundary reached'); };
  const router = loadModule('./ai-router.ts', {
    './free-mode': freeMode, '@/lib/ai-router-policy': policies,
    '@/lib/ai-budget': { reserveAiBudget: forbidden }, '@/lib/ai-provider-protocol': {},
  }, forbidden) as typeof import('./ai-router.ts');
  for (const feature of Object.keys(policies.AI_ROUTE_POLICIES) as policies.AiTextFeature[]) {
    assert.equal(router.isAiFeatureAvailable(feature), false);
    await assert.rejects(() => router.generateAiText({ feature, promptText: 'synthetic', maxOutputTokens: 10, userId: 'fixture', supabase: {} as never }), { code: 'PAID_AI_DISABLED' });
  }
  assert.equal(calls, 0);
});

for (const path of ['../app/api/tts/route.ts', '../app/api/language/tts/route.ts', '../app/api/claude/route.ts']) {
  test(`${path} authenticates and rejects paid calls before provider or budget access`, async () => {
    let authenticated = true; let calls = 0;
    const forbidden = () => { calls++; throw new Error('Paid boundary reached'); };
    const route = loadModule(path, {
      'next/server': { NextResponse: { json: Response.json } }, '@/lib/free-mode': freeMode,
      '@/lib/yeoni-voice-policy': voicePolicy,
      '@/lib/zephyr-free-server': { ...loadModule('./zephyr-free-server.ts', { 'node:crypto': crypto }, forbidden), readZephyrRequest },
      '@/lib/supabase-server': { createServerSupabaseClient: async () => ({ auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'fixture' } : null } }) } }) },
      '@/lib/ai-budget': { reserveAiBudget: forbidden }, '@/lib/ai-router': { generateAiText: forbidden },
    }, forbidden) as { POST: (req: Request) => Promise<Response> };
    const request = () => new Request('https://fixture.local/api', { method: 'POST', body: JSON.stringify({ text: 'synthetic', messages: [] }) });
    const result = await route.POST(request()); assert.equal(result.status, 503);
    const body = await result.json();
    assert.equal(body.code, 'PAID_AI_DISABLED');
    if (path === '../app/api/tts/route.ts') {
      assert.equal(body.voice, 'ko-KR-Chirp3-HD-Zephyr');
      assert.equal(body.useDeviceVoice, false);
    }
    authenticated = false; assert.equal((await route.POST(request())).status, 401);
    assert.equal(calls, 0);
  });
}
