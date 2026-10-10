import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import type { Request } from '@playwright/test';
import { RouteContinueDiagnostics, routeContinueFailure } from './e2e/route-continue-diagnostics.ts';
import { failureLabel } from './e2e/navigation-diagnostics.ts';

const fixture = readFileSync(new URL('./e2e/fixture.ts', import.meta.url), 'utf8');
// Execute the shipped helper body with synthetic Playwright boundaries. This
// launches no browser, reads no account, and is not browser acceptance.
function fixtureFunction<T>(name: string, globals: Record<string, unknown>, source = fixture): T {
  const ast = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(declaration, `${name} remains a real fixture function`);
  const output = ts.transpileModule(declaration.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(`${output}\nexports.${name} = ${name};`, { exports, ...globals });
  return exports[name] as T;
}

function mealHarness(values: string[]) {
  const operations: string[] = [];
  let reads = 0;
  const expect = Object.assign((target: string) => ({
    async toHaveValue(value: string) { assert.equal(target, 'input'); assert.equal(value, 'new memo'); operations.push('input-checked'); },
    async toBeVisible() { assert.equal(target, 'success-label'); operations.push('success-visible'); },
  }), {
    poll(read: () => Promise<string>) { return { async toBe(expected: string) {
      assert.equal(expected, 'new memo');
      for (let attempt = 0; attempt < 3; attempt++) if (await read() === expected) { operations.push('exact-commit'); return; }
      throw new Error('Intended local commit not observed');
    } }; },
  });
  const page = {
    getByLabel(name: string, options: unknown) {
      assert.equal(name, '메모'); assert.equal(JSON.stringify(options), '{"exact":true}');
      return { async fill(value: string) { assert.equal(value, 'new memo'); operations.push('fill'); } };
    },
    getByRole(role: string, options: { name: string }) {
      assert.equal(role, 'button'); assert.equal(options.name, '오늘 식단 저장');
      return { async click() { operations.push('click'); } };
    },
    getByText(text: string) { assert.equal(text, '오늘 식단 기록을 저장했습니다.'); return 'success-label'; },
  };
  // Use a stable input locator while retaining its fill method.
  const input = page.getByLabel('메모', { exact: true });
  page.getByLabel = () => input;
  const assertions = Object.assign((target: unknown) => expect(target === input ? 'input' : String(target)), { poll: expect.poll });
  const saveMeal = fixtureFunction<(page: unknown, memo: string) => Promise<void>>('saveMeal', {
    expect: assertions,
    async localState() { operations.push('local-read'); return values[Math.min(reads++, values.length - 1)]; },
    mealMemo: (value: string) => value,
  });
  return { page, saveMeal, operations };
}

test('saveMeal awaits the exact new local memo before accepting a stale success label', async () => {
  const harness = mealHarness(['old memo', 'new memo']);
  await harness.saveMeal(harness.page, 'new memo');
  assert.deepEqual(harness.operations, ['fill', 'input-checked', 'click', 'local-read', 'local-read', 'exact-commit', 'success-visible']);
});

test('saveMeal does not accept the success label if the intended local commit never occurs', async () => {
  const harness = mealHarness(['old memo']);
  await assert.rejects(harness.saveMeal(harness.page, 'new memo'), /Intended local commit not observed/);
  assert.equal(harness.operations.includes('success-visible'), false);
});

test('returning to Live foregrounds the page and waits for visibility and real ready UI', async () => {
  const operations: string[] = [];
  const page = {
    async bringToFront() { operations.push('foreground'); },
    async evaluate() { operations.push('visibility'); return 'visible'; },
    getByText(text: string, options: { exact: boolean }) { assert.equal(text, '학습 기록 · 서버 저장 확인'); assert.equal(options.exact, true); return 'ready'; },
    locator(selector: string) { assert.equal(selector, '.live-workspace'); return 'workspace'; },
  };
  const expect = Object.assign((target: string) => ({ async toBeVisible() { operations.push(target); } }), {
    poll(read: () => Promise<string>) { return { async toBe(value: string) { assert.equal(value, 'visible'); assert.equal(await read(), value); } }; },
  });
  const foreground = fixtureFunction<(page: unknown) => Promise<void>>('foregroundLivePage', { expect });
  await foreground(page);
  assert.deepEqual(operations, ['foreground', 'visibility', 'ready', 'workspace']);
});

function request(patch: Record<string, unknown> = {}): Request {
  const frame = { page: () => page, isDetached: () => false };
  const page = { isClosed: () => true, mainFrame: () => frame };
  return {
    method: () => 'GET', resourceType: () => 'script', isNavigationRequest: () => false, frame: () => frame,
    url: () => { assert.fail('Diagnostics must not read URLs'); },
    headers: () => { assert.fail('Diagnostics must not read headers'); },
    postData: () => { assert.fail('Diagnostics must not read bodies'); },
    ...patch,
  } as unknown as Request;
}

test('route continue failures retain only fixed method/resource/failure labels and lifecycle flags', () => {
  const detail = routeContinueFailure(request(), new Error('Target page closed: private account / secret response'));
  assert.deepEqual(detail, { method: 'GET', resourceClass: 'script', failure: 'closed-or-disconnected', pageClosed: true, navigationRequest: false, mainFrame: true, frameDetached: false });
  const unknown = routeContinueFailure(request({ method: () => 'secret-method', resourceType: () => 'private-resource', frame: () => { throw new Error('private-frame'); } }), new Error('private-message'));
  assert.deepEqual(unknown, { method: 'OTHER', resourceClass: 'other', failure: 'other', pageClosed: null, navigationRequest: false, mainFrame: null, frameDetached: null });
  assert.doesNotMatch(JSON.stringify([detail, unknown]), /private|secret/);
});

test('route continue diagnostics emit at most 40 entries and count dropped failures', () => {
  const diagnostics = new RouteContinueDiagnostics();
  let emitted = 0;
  for (let index = 0; index < 55; index++) if (diagnostics.record(request(), new Error('private failure'))) emitted++;
  assert.equal(emitted, 40); assert.equal(diagnostics.events.length, 40); assert.equal(diagnostics.dropped, 15);
  assert.doesNotMatch(JSON.stringify(diagnostics), /private/);
  assert.match(fixture, /if \(!document\) \{[\s\S]*?continueFailures\.record\(request, error\)[\s\S]*?\n\s*throw error;/);
});

test('legacy blocked-save fixture waits for a hydrated editor before injecting recovery bytes', () => {
  const source = readFileSync(new URL('./e2e/storage-protocol.spec.ts', import.meta.url), 'utf8');
  const scenario = source.slice(source.indexOf("test('legacy v1 recovery"), source.indexOf("test('reload recovers"));
  assert.ok(scenario.indexOf('await dietEditorReady(page)') < scenario.indexOf('localStorage.setItem(legacy, journal)'));
  assert.match(scenario, /toEqual\(before\)/);
  assert.match(scenario, /filter\(isSharedSyncWrite\)\)\.toHaveLength\(publications\)/);
  assert.match(source, /toMatchObject\(\{ hunger: 'yes', waterMl: 500 \}\)/);
  assert.match(source, /toMatchObject\(\{ hunger: 'no', waterMl: 500 \}\)/);
});

test('storage lifecycle diagnostics expose fixed states and comparison booleans without record or page contents', async () => {
  const source = readFileSync(new URL('./e2e/storage-protocol.spec.ts', import.meta.url), 'utf8');
  const day = '2001-01-02', logs: string[] = [];
  const element = { getClientRects: () => [1], closest: () => null, disabled: false };
  const hunger = { ...element, value: 'yes' }, save = { ...element, textContent: '오늘 식단 저장' };
  const raw: Record<string, string> = {
    diet: JSON.stringify({ [day]: { hunger: 'yes', waterMl: 500, dietMemo: 'private-memo' } }),
    water: JSON.stringify({ [day]: 500 }),
    legacy: 'private-journal', protocol: JSON.stringify({ state: 'committed', transactionId: 'private-id' }),
  };
  const probe = fixtureFunction<(page: unknown, phase: string) => Promise<void>>('storageDiagnostic', {
    DIET: 'diet', WATER: 'water', LEGACY: 'legacy', PROTOCOL: 'protocol', today: () => day, failureLabel,
    console: { log(message: string) { logs.push(message); } },
    localStorage: { getItem: (key: string) => raw[key] ?? null },
    document: {
      visibilityState: 'visible', body: { textContent: 'private-page-content' },
      querySelector: (selector: string) => selector === '#diet-hunger' ? hunger : null,
      querySelectorAll: () => [save],
    },
  }, source);
  await probe({ evaluate: (read: (args: unknown) => unknown, args: unknown) => read(args) }, 'first-edit');
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /private|2001-01-02/);
  const result = JSON.parse(logs[0].slice('QA_STORAGE_PROTOCOL_STATE '.length));
  assert.equal(result.authGate, 'editor'); assert.equal(result.editor, 'hydrated');
  assert.equal(result.hungerVisible, true); assert.equal(result.savedHungerYes, true);
  assert.equal(result.savedHungerNo, false); assert.equal(result.savedWater500, true); assert.equal(result.waterStore500, true);
  assert.equal(result.protocolState, 'committed'); assert.equal(result.legacyPresent, true);
  const labels = new Set(['first-edit', 'first', 'visible', 'editor', 'hydrated', 'committed']);
  assert.ok(Object.values(result).every(value => typeof value === 'boolean' || value === null || typeof value === 'string' && labels.has(value)));
});
