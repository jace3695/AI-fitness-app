import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { projectStateDiagnostic, stateDiagnosticCollector } from '../scripts/qa-state-diagnostics.mjs';

const prefix = 'QA_BASICS_RESET_BOUNDARY';
const source = readFileSync(new URL('./e2e/typing-basics-recovery.spec.ts', import.meta.url), 'utf8');
function fixture() {
  const messages: string[] = [], page = new EventEmitter(), frame = {};
  Object.assign(page, { mainFrame: () => frame });
  const exports = {} as { observeBasicsResetBoundary(page: unknown): { mark(phase: string): void; stop(): void } };
  const compiled = ts.transpileModule(source + '\nexport { observeBasicsResetBoundary };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(`(function(exports, require) { ${compiled}\n})`, {
    URL, console: { log: (message: string) => messages.push(message) },
  })(exports, (name: string) => {
    if (name === 'node:crypto') return {};
    if (name === './fixture') return { test: () => {} };
    if (name === './route-drain') return {};
    if (name === '../../app/data/typingBasics') return { TYPING_LESSONS: [] };
    if (name === '../../lib/typing-basics-draft') return {};
    assert.fail(`Unexpected dependency ${name}`);
  });
  return { messages, page, frame, probe: exports.observeBasicsResetBoundary(page) };
}
function request(path: string, navigation = false) {
  return { url: () => `http://127.0.0.1:${navigation ? 3000 : 54321}${path}?PRIVATE_QUERY=PRIVATE_OWNER`,
    method: () => 'GET', isNavigationRequest: () => navigation, resourceType: () => navigation ? 'document' : 'fetch',
    headers: () => assert.fail('Diagnostics must not read authentication headers'), postData: () => assert.fail('Diagnostics must not read private bodies') };
}
function projected(line: string) {
  const output = projectStateDiagnostic(line); assert.ok(output, 'The real runner projection must accept every boundary row');
  assert.doesNotMatch(output.line, /PRIVATE|headers|body|ownerId|url/);
  return JSON.parse(output.line.slice(prefix.length + 1));
}

test('basics reset observer executes shipped spec source and forwards passive reload milestones without private content', () => {
  const f = fixture(); f.probe.mark('before-reload');
  f.page.emit('request', request('/growth/typing/basics', true));
  f.page.emit('response', { request: () => request('/growth/typing/basics', true) });
  f.page.emit('framenavigated', {}); f.page.emit('framenavigated', f.frame);
  f.page.emit('domcontentloaded'); f.page.emit('load');
  f.page.emit('request', request('/auth/v1/user'));
  f.page.emit('request', request('/rest/v1/user_app_state'));
  f.page.emit('request', request('/rest/v1/growth_sessions'));
  for (const path of ['/auth/v1/user', '/rest/v1/user_app_state', '/rest/v1/growth_sessions']) f.page.emit('response', { request: () => request(path) });
  f.probe.mark('after-reload'); f.probe.mark('ready-after-reload');
  assert.doesNotMatch(f.messages.join('\n'), /PRIVATE/);
  const rows = f.messages.map(projected), final = rows.at(-1);
  assert.equal(final.phase, 'ready-after-reload');
  for (const name of ['documentRequests', 'documentResponses', 'frameNavigations', 'domContentLoads', 'pageLoads', 'authRequests', 'markerRequests', 'progressRequests', 'authResponses', 'markerResponses', 'progressResponses']) assert.equal(final[name], 1, name);
  assert.equal(rows.some(row => row.phase === 'before-reload' && row.event === 'frame-navigated'), true);
  const count = f.messages.length; f.probe.stop();
  for (const name of ['request', 'response', 'framenavigated', 'domcontentloaded', 'load']) assert.equal(f.page.listenerCount(name), 0);
  f.page.emit('request', request('/growth/typing/basics', true)); assert.equal(f.messages.length, count);
});

test('event noise is bounded without dropping final failure or recovery milestones', () => {
  const f = fixture();
  for (let i = 0; i < 1000; i++) f.page.emit('request', request('/rest/v1/user_app_state'));
  f.page.emit('request', { ...request('/ignored'), url: () => 'PRIVATE_MALFORMED_URL' });
  f.page.emit('request', { ...request('/ignored'), url: () => 'https://private.example.test/auth/v1/user' });
  f.probe.mark('failure'); f.probe.stop();
  assert.ok(f.messages.length <= 66); const rows = f.messages.map(projected), last = rows.at(-1);
  assert.equal(last.phase, 'failure'); assert.equal(last.markerRequests, 1000); assert.equal(last.droppedEvents, 936);
  const collector = stateDiagnosticCollector();
  for (const line of [...f.messages, ...f.messages]) assert.ok(collector.ingest(line), 'Both browser projects fit the runner family budget');
  assert.equal(collector.snapshot().dropped[prefix], 0);
});

test('basics reset projection reconstructs a closed schema and refuses private or malformed values', () => {
  const empty = projected(`${prefix} {}`), secret = 'PRIVATE_TEXT_TOKEN_OWNER\u001b[31m\nPRIVATE_NEXT_LINE';
  const tainted = Object.fromEntries(Object.keys(empty).map(key => [key, secret]));
  Object.assign(tainted, { raw: secret, url: secret, marker: secret, ownerId: secret, headers: { authorization: secret } });
  const row = projected(`${prefix} ${JSON.stringify(tainted)}`);
  assert.equal(row.phase, 'unknown'); assert.equal(row.event, 'unknown');
  for (const name of Object.keys(row).filter(key => !['phase', 'event'].includes(key))) assert.equal(row[name], null);
  for (const value of [-1, 10001, 0.5, '1', false, {}, null]) assert.equal(projected(`${prefix} ${JSON.stringify({ documentRequests: value })}`).documentRequests, null);
  for (const raw of ['null', '[]', '"PRIVATE"', '{', JSON.stringify({ raw: 'x'.repeat(8192) })]) assert.equal(projectStateDiagnostic(`${prefix} ${raw}`), null);
  assert.doesNotMatch(projectStateDiagnostic(`${prefix} {"__proto__":{"phase":"PRIVATE"},"constructor":{"prototype":{"raw":"PRIVATE"}}}`)!.line, /PRIVATE|constructor/);
  const runner = readFileSync(new URL('../scripts/qa-playwright.mjs', import.meta.url), 'utf8');
  assert.match(runner, /const stateDiagnostic = stateDiagnostics\.ingest\(line\);\s*if \(stateDiagnostic\) console\.log\(stateDiagnostic\);/);
  assert.equal(runner.split('\n').find(line => line.includes('console.log(line)'))!.includes(prefix), false);
});

test('race remains a genuine authenticated marker GET then reset then fenced RPC, with all reload and owner assertions retained', () => {
  const scenario = source.slice(source.indexOf("test('different-device reset between marker GET and basics RPC"), source.indexOf("test('missing basics RPC"));
  assert.match(scenario, /qa\.traffic\.entries\.slice\(trafficStart\)/);
  assert.match(scenario, /entry\.owner === qa\.account\.id/); assert.match(scenario, /entry\.delivered && !entry\.synthetic/);
  assert.match(scenario, /p_expected_reset_marker\)\.toBe\(markerRead\?\.receivedState\?\.\[markerKey\] \?\? null\)/);
  const get = scenario.indexOf("mark('marker-get-confirmed')"), reset = scenario.indexOf("rpc('reset_my_app_records'"), fetch = scenario.indexOf('route.fetch({ maxRetries: 0 })');
  assert.ok(get > 0 && reset > get && fetch > reset);
  assert.match(scenario, /message: 'typing_reset_changed'/);
  assert.match(scenario, /expect\(\(await recovered\(page, qa\.account\.id\)\)\.pending\)\.not\.toBeNull\(\)/);
  assert.match(scenario, /await expect\(retry\(page\)\)\.toBeDisabled\(\)/);
  assert.match(scenario, /await expect\(pad\(page\)\)\.toBeEnabled\(\)/);
  assert.match(scenario, /toContainText\('1 \/ 12'\)/);
  assert.equal((scenario.match(/toEqual\(\[\]\)/g) ?? []).length, 2);
  assert.match(scenario, /toEqual\(\[otherOriginal\]\)/); assert.match(scenario, /expect\(posts\)\.toBe\(1\)/);
  assert.match(scenario, /expect\(await qa\.read\(\)\)\.toEqual\(\{ \.\.\.before, \[markerKey\]: resetMarker \}\)/);
  assert.equal((scenario.match(/await page\.reload\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(scenario, /waitForTimeout|setTimeout|timeout:|retries:|지금 동기화/);
  assert.match(scenario, /catch \(error\) \{ boundary\.mark\('failure'\); throw error; \}/);
});
