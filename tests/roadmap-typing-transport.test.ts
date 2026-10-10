import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createClient } from '@supabase/supabase-js';
import { expect, type Route } from '@playwright/test';
import ts from 'typescript';
import type { GrowthSessionRow } from '../app/data/growthPlatform.ts';
import { confirmSentenceTypingSave, emptySentenceTypingDraft, makeSentenceTypingSession } from '../lib/sentence-typing-draft.ts';
import { RouteDrain } from './e2e/route-drain.ts';

const owner = '00000000-0000-4000-8000-000000000731';
const routine = '00000000-0000-4000-8000-000000000732';
const id = '00000000-0000-4000-8000-000000000733';
const title = 'typing saves measured mistakes once and recovers a lost response without a duplicate session';
type RegisteredRoute = { pattern: string | RegExp; handle: (route: Route) => Promise<void> };

// Execute the actual roadmap fault-injection setup, rather than a copied route.
// This is a source/SDK unit test with a synthetic fetch boundary, not browser QA.
async function roadmapRoute() {
  const file = ts.createSourceFile('roadmap-completion.spec.ts', readFileSync(new URL('./e2e/roadmap-completion.spec.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const statement = file.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && ts.isStringLiteral(node.expression.arguments[0]) && node.expression.arguments[0].text === title);
  assert.ok(statement && ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression));
  const callback = statement.expression.arguments[1];
  assert.ok(ts.isArrowFunction(callback) && ts.isBlock(callback.body));
  const statements = callback.body.statements;
  const start = statements.findIndex(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => declaration.name.getText(file) === 'pattern'));
  const end = statements.findIndex(node => ts.isExpressionStatement(node) && ts.isAwaitExpression(node.expression)
    && ts.isCallExpression(node.expression.expression) && node.expression.expression.expression.getText(file) === 'page.route');
  assert.ok(start >= 0 && end >= start, 'roadmap typing installs its lost-response route');
  const source = ts.transpileModule(`(async (page, qa, expect, RouteDrain) => { ${statements.slice(start, end + 1).map(node => node.getText(file)).join('\n')} })`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let registered: RegisteredRoute | undefined;
  const install = vm.runInNewContext(source, { URL });
  await install({ route: async (pattern: string | RegExp, handle: RegisteredRoute['handle']) => { registered = { pattern, handle }; } }, { account: { id: owner } }, expect, RouteDrain);
  assert.ok(registered);
  return registered;
}

const matches = (pattern: string | RegExp, url: string) => typeof pattern === 'string'
  ? new RegExp(`^${pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(url)
  : pattern.test(url);

async function fixture(commitSucceeds = true) {
  const route = await roadmapRoute();
  const startedAt = Date.parse('2026-10-09T10:00:00Z');
  const session = makeSentenceTypingSession({ ...emptySentenceTypingDraft(owner, null), typed: 'xx', startedAt },
    { id: routine, target_minutes: 15 }, id, '2026-10-09', startedAt + 1000);
  const payload = { id, user_id: owner, routine_id: routine, session_date: session.sessionDate, status: session.status,
    planned_minutes: session.plannedMinutes, actual_minutes: session.actualMinutes, memo: session.memo, source: session.source,
    metrics: session.metrics, started_at: session.startedAt, ended_at: session.endedAt, updated_at: session.endedAt };
  const saved = { ...payload, created_at: session.endedAt } as GrowthSessionRow;
  let row: GrowthSessionRow | null = null, commits = 0;
  const attempts: string[] = [], injections: number[] = [], routeErrors: unknown[] = [];
  const client = createClient('https://roadmap-typing.invalid', 'synthetic-public-fixture-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)), method = init?.method ?? 'GET';
      attempts.push(`${method}:${url.pathname}`);
      const server = async () => {
        if (method === 'POST') {
          assert.equal(url.pathname, '/rest/v1/rpc/save_sentence_typing_session');
          assert.deepEqual(JSON.parse(String(init?.body)), { p_expected_owner: owner, p_expected_reset_marker: null, p_payload: payload });
          if (!commitSucceeds) return new Response('{"message":"rejected save"}', { status: 400 });
          row = saved; commits++;
          return new Response(JSON.stringify(saved), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        assert.equal(method, 'GET'); assert.equal(url.pathname, '/rest/v1/growth_sessions');
        assert.equal(url.searchParams.get('user_id'), `eq.${owner}`);
        assert.equal(url.searchParams.get('id'), `eq.${id}`);
        return new Response(JSON.stringify(row ? [row] : []), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
      if (!matches(route.pattern, url.href)) return server();
      let response: Response | undefined;
      const fakeRoute = {
        request: () => ({ method: () => method, url: () => url.href, postDataJSON: () => JSON.parse(String(init?.body)) }),
        fetch: async () => { const result = await server(); return { ok: () => result.ok, status: () => result.status }; },
        fulfill: async ({ status, body, contentType }: { status: number; body: string; contentType: string }) => {
          injections.push(status); response = new Response(body, { status, headers: { 'Content-Type': contentType } });
        },
        fallback: async () => { response = await server(); },
      };
      try { await route.handle(fakeRoute as unknown as Route); } catch (error) { routeErrors.push(error); throw error; }
      assert.ok(response, 'route must finish with a response');
      return response;
    } },
  });
  const confirm = () => confirmSentenceTypingSave(owner, session, false, {
    assertOwner: async () => {},
    insert: async () => client.rpc('save_sentence_typing_session', { p_expected_owner: owner, p_expected_reset_marker: null, p_payload: payload }),
    read: async () => client.from('growth_sessions').select('*').eq('user_id', owner).eq('id', id).maybeSingle(),
  });
  return { confirm, saved, attempts, injections, routeErrors, commits: () => commits };
}

test('roadmap typing route loses the fenced RPC response and the real SDK recovers with one same-ID GET', async () => {
  const qa = await fixture();
  assert.deepEqual(await qa.confirm(), qa.saved);
  assert.deepEqual(qa.routeErrors, []);
  assert.deepEqual(qa.injections, [503], 'a passing roadmap save must actually receive the injected lost response');
  assert.equal(qa.commits(), 1);
  assert.deepEqual(qa.attempts, ['POST:/rest/v1/rpc/save_sentence_typing_session', 'GET:/rest/v1/growth_sessions']);
});

test('roadmap typing injection cannot disguise a rejected server save as a committed lost response', async () => {
  const qa = await fixture(false);
  await assert.rejects(qa.confirm(), /typing_save_unconfirmed/);
  assert.equal(qa.routeErrors.length, 1, 'the route verifies server acceptance before replacing its response');
  assert.deepEqual(qa.injections, []); assert.equal(qa.commits(), 0);
});
