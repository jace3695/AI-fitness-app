import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { type TestContext } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { FIXTURE_OWNER, nodes, storageBrowser, storageTab, textOf } from './helpers/storage-ui-fixture.ts';

const workoutKey = 'ai-fitness-workout-completed-days';
const dietKey = 'ai-fitness-diet-completed-days';
const PANEL = 'app/components/CloudSyncPanel.tsx';
const initial = { [workoutKey]: { '2001-01-02': { workoutStatus: 'completed' } }, [dietKey]: {}, 'ai-fitness-daily-notes': { original: 'synthetic preserved note' } };
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// Execute shipped gate, cloud classification/commit and diet renderer with
// synthetic hooks/storage/network. This does not claim browser acceptance.
function fixture(t: TestContext, state: Record<string, unknown>) {
  const browser = storageBrowser();
  let remote = copy(state), tab: ReturnType<typeof storageTab>, panel: ReturnType<ReturnType<typeof storageTab>['mount']>;
  let gate: typeof panel, serial = 0;
  const traffic: { method: string; table: string }[] = [];
  const mount = async () => {
    panel?.dispose(); gate?.dispose(); tab?.dispose();
    tab = storageTab(browser, `diet-${serial++}`);
    const cloud = tab.cloud;
    tab.setModule('app/data/cloudSync.ts', { ...cloud,
      async getRemoteState() {
        traffic.push({ method: 'GET', table: 'user_app_state' });
        const values = Object.fromEntries(Object.entries(remote).map(([key, value]) => [key, JSON.stringify(value)]));
        const keys = Object.keys(values);
        return { state: cloud.readLocalCloudState({ length: keys.length, key: (index: number) => keys[index] ?? null, getItem: (key: string) => values[key] ?? null }), updated_at: 'synthetic-revision' };
      },
      async saveRemoteState() { traffic.push({ method: 'POST', table: 'user_app_state' }); assert.fail('Malformed-data coverage must not insert'); },
      async saveRemoteStateIfUnchanged() { traffic.push({ method: 'PATCH', table: 'user_app_state' }); assert.fail('Malformed-data coverage must not overwrite'); },
    });
    gate = tab.mount('app/components/AuthGate.tsx', { children: { type: 'main', props: { 'data-private-editor': true } } });
    panel = tab.mount(PANEL, { hideSignedOut: true });
    await gate.settle(); await panel.settle();
  };
  t.after(() => { panel?.dispose(); gate?.dispose(); tab?.dispose(); });
  return {
    mount, traffic, browser,
    get tab() { return tab; }, get panel() { return panel; }, get gate() { return gate; },
    get remote() { return remote; }, set remote(state: Record<string, unknown>) { remote = copy(state); },
    ack() { return { base: tab.local.getItem(`fitness-cloud-sync-base:${FIXTURE_OWNER}`), acknowledgement: tab.local.getItem(`fitness-cloud-sync-ack:${FIXTURE_OWNER}`) }; },
    local() { return copy(tab.cloud.readLocalCloudState()); },
    async retry() { panel.click('다시 시도'); await panel.settle(); },
  };
}

test('shipping malformed remote workout blocks acknowledgement and writes through reload, then reads an explicit repair', async t => {
  const malformed = { ...initial, [workoutKey]: [] }, f = fixture(t, malformed);
  for (let load = 0; load < 2; load++) {
    await f.mount();
    assert.ok(nodes(f.gate.render()).some(node => node.props['data-private-editor']), 'Authentication succeeds independently of sync validation');
    assert.match(f.panel.text(), /기록 동기화 실패/);
    assert.match(f.panel.text(), /이전 형식의 기록을 안전하게 해석하지 못했습니다/);
    assert.doesNotMatch(f.panel.text(), /서버 반영 완료/);
    assert.deepEqual(f.local(), {});
    assert.deepEqual(f.ack(), { base: null, acknowledgement: null });
    assert.deepEqual(f.remote, malformed);
    assert.ok(f.traffic.every(entry => entry.method === 'GET'));
  }
  const repaired = { ...malformed, [workoutKey]: {} };
  f.remote = repaired; // Explicit disposable fixture repair, never product sanitization.
  await f.retry(); assert.match(f.panel.text(), /서버 반영 완료/);
  assert.deepEqual(f.local(), repaired); assert.deepEqual(f.remote, repaired);
  assert.notEqual(f.ack().acknowledgement, null);
  await f.mount(); assert.match(f.panel.text(), /서버 반영 완료/);
  assert.deepEqual(f.local(), repaired); assert.deepEqual(f.remote, repaired);
  assert.ok(f.traffic.every(entry => entry.method === 'GET'));
});

test('shipping diet renderer preserves malformed workout inputs and never fabricates an empty history or advice', () => {
  const browser = storageBrowser(), tab = storageTab(browser, 'diet-renderer');
  try {
    for (const workout of [[], '[]', '{synthetic-invalid']) {
      const props = { diet: { '2026-10-09': { afterWorkoutMeal: 'yes' } }, workout, today: '2026-10-10' };
      const before = copy(props), view = tab.mount('app/components/DietWorkoutContext.tsx', props);
      try {
        const rendered = view.render(), alerts = nodes(rendered).filter(node => node.props.role === 'alert');
        assert.equal(alerts.length, 1); assert.match(textOf(alerts[0]), /기록 형식을 확인할 수 없어/);
        assert.doesNotMatch(textOf(rendered), /운동 표시 0일|그날의 운동 후 식사 응답:|운동 후 식사 예/);
        assert.equal(nodes(rendered).filter(node => node.type === 'li' || node.type === 'details').length, 0);
        assert.deepEqual(props, before);
      } finally { view.dispose(); }
    }
    const empty = tab.mount('app/components/DietWorkoutContext.tsx', { diet: {}, workout: {}, today: '2026-10-10' });
    try { assert.match(empty.text(), /운동 표시 0일/); assert.equal(nodes(empty.render()).filter(node => node.props.role === 'alert').length, 0); }
    finally { empty.dispose(); }
  } finally { tab.dispose(); }
});

test('shipping local malformed workout remains raw and unacknowledged until explicit fixture restoration', async t => {
  const repaired = { ...initial, [workoutKey]: {} }, f = fixture(t, repaired);
  await f.mount(); const beforeAck = f.ack();
  f.tab.local.setItem(workoutKey, '[]');
  f.tab.dispatch({ type: 'yeoni-records-changed' });
  f.tab.flushTimers(); await f.panel.settle();
  assert.match(f.panel.text(), /기록 동기화 실패/); assert.doesNotMatch(f.panel.text(), /서버 반영 완료/);
  assert.equal(f.tab.local.getItem(workoutKey), '[]'); assert.deepEqual(f.ack(), beforeAck);
  assert.deepEqual(f.remote, repaired); assert.ok(f.traffic.every(entry => entry.method === 'GET'));
  await f.mount(); assert.match(f.panel.text(), /기록 동기화 실패/);
  assert.equal(f.tab.local.getItem(workoutKey), '[]'); assert.deepEqual(f.ack(), beforeAck);
  f.tab.local.setItem(workoutKey, '{}'); // Explicit disposable fixture restoration.
  await f.retry(); assert.match(f.panel.text(), /서버 반영 완료/);
  assert.deepEqual(f.local(), repaired); assert.deepEqual(f.remote, repaired);
  assert.ok(f.traffic.every(entry => entry.method === 'GET'));
});

test('the authored browser scenario checks malformed rejection before requiring any success acknowledgement', async t => {
  const source = readFileSync(new URL('./e2e/p2.spec.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('p2.spec.ts', source, ts.ScriptTarget.Latest, true);
  const title = 'diet workout context distinguishes malformed workout data from an empty history';
  const statement = ast.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && ts.isStringLiteral(node.expression.arguments[0]) && node.expression.arguments[0].text === title) as ts.ExpressionStatement;
  assert.ok(statement, 'The real browser scenario remains present');
  const callback = (statement.expression as ts.CallExpression).arguments[1];
  const f = fixture(t, initial), repairedBoundary = new Error('explicit fixture repair reached');
  let remoteWrites = 0, rejectedChecks = 0, reloads = 0;
  const expectation = (actual: unknown) => ({
    toBeNull() { assert.equal(actual, null); },
    toEqual(expected: unknown) { assert.deepEqual(copy(actual), copy(expected)); },
    toHaveLength(expected: number) { assert.equal((actual as unknown[]).length, expected); },
    async toBeVisible() { assert.ok(f.panel.text().includes(String(actual)), `Missing ${actual}: ${f.panel.text()}`); if (actual === '기록 동기화 실패') rejectedChecks++; },
    async toHaveCount(expected: number) { assert.equal(Number(f.panel.text().includes(String(actual))), expected); },
  });
  const page = {
    getByText(text: string) { return text; },
    async reload() { reloads++; await f.mount(); },
    async evaluate(fn: (owner: string) => unknown, owner: string) { return vm.runInNewContext(`(${fn.toString()})(owner)`, { owner, localStorage: f.tab.local }); },
  };
  const qa = {
    read: async () => copy(f.remote), traffic: { entries: f.traffic },
    account: { id: FIXTURE_OWNER, client: { from(table: string) { assert.equal(table, 'user_app_state'); return {
      update({ state }: { state: Record<string, unknown> }) { return { async eq(field: string, owner: string) {
        assert.equal(field, 'user_id'); assert.equal(owner, FIXTURE_OWNER);
        if (++remoteWrites === 2) throw repairedBoundary;
        f.remote = state; return { error: null };
      } }; },
    }; } } },
  };
  const exports: { scenario?: (args: unknown) => Promise<void> } = {};
  const compiled = ts.transpileModule(`exports.scenario = ${callback.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, { exports, expect: expectation,
    login: async () => f.mount(), synced: async () => assert.match(f.panel.text(), /서버 반영 완료/, 'Malformed remote data must not be acknowledged'),
    localState: async () => f.local(), isSharedSyncWrite: (entry: { method: string }) => ['POST', 'PATCH'].includes(entry.method),
  });
  await assert.rejects(exports.scenario!({ page, qa }), error => error === repairedBoundary);
  assert.equal(remoteWrites, 2); assert.equal(reloads, 1); assert.equal(rejectedChecks, 2);
  assert.deepEqual(f.remote, { ...initial, [workoutKey]: [] });
  assert.deepEqual(f.local(), {}); assert.deepEqual(f.ack(), { base: null, acknowledgement: null });
});
