import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Deterministic source-coupled effect ordering, not a React renderer or browser.
// No launch scheduling is reproduced here: execute the actual owner effect and reader.
const source = fs.readFileSync(new URL('../app/budget/page.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let bootstrap = '', reader = '', ownerEffect = '', ownerDependencies = '', lifetimeEffect = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'checkUser') bootstrap = `const ${node.getText(ast)};`;
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'fetchRecordKind') reader = `const ${node.getText(ast)};`;
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]) {
    const callback = node.arguments[0].getText(ast);
    if (callback.includes('reviewWasManual.current = false') && callback.includes('budgetEpoch.current += 1')) {
      ownerEffect = `const ownerEffect = ${callback};`;
      ownerDependencies = node.arguments[1].getText(ast);
    }
    if (callback === '() => () => { budgetEpoch.current += 1 }') lifetimeEffect = `const lifetimeEffect = ${callback};`;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(bootstrap && reader && ownerEffect && lifetimeEffect);
const compile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}
type Auth = { data: { user: { id: string } | null }; error: null };
type Row = { id: string; date: string };
type Kind = 'expense' | 'income' | 'saving';
const auth = (owner: string | null): Auth => ({ data: { user: owner ? { id: owner } : null }, error: null });
const ready = { expense: 'ready', income: 'ready', saving: 'ready' };
function fixture(options: { immediateCommit?: boolean; holdSettings?: boolean; pending?: 'none' | 'present' | 'throw' } = {}) {
  const state = {
    owner: null as string | null, pendingOwner: null as string | null, mounted: true,
    appReady: false, loading: true, expense: [] as Row[], income: [] as Row[], saving: [] as Row[],
    loads: {} as Record<string, string>, parsedItems: [] as unknown[], showConfirm: false, feedback: '', recurringReads: 0,
  };
  const authGates: ReturnType<typeof deferred<Auth>>[] = [];
  const rowGates: (ReturnType<typeof deferred<Row[]>> & { rows: Row[] })[] = [];
  const queries: { table: string; owner: string; epoch: number }[] = [];
  const tasks: Promise<boolean>[] = [];
  const queryWaiters: { count: number; gate: ReturnType<typeof deferred<void>> }[] = [];
  const authWaiters: { count: number; gate: ReturnType<typeof deferred<void>> }[] = [];
  const ownerWaiters: { owner: string; gate: ReturnType<typeof deferred<void>> }[] = [];
  const bootstrapAuth = deferred<Auth>(), settings = deferred<null>();
  let bootstrapAuthenticating = false, holdAuth = true, holdRows = false;
  const noop = () => {};
  const pending = { items: [{ name: 'synthetic pending draft' }] };
  const context = {
    user: null as { id: string } | null,
    recordReadVersions: { current: { expense: 0, income: 0, saving: 0 } },
    budgetEpoch: { current: 0 }, liveBudgetOwner: { current: null as string | null },
    reviewOwner: { current: null }, reviewWasManual: { current: false },
    savingRecordsRef: { current: false }, pendingSaveRef: { current: null },
    setRecordLoads: (fn: (current: Record<string, string>) => Record<string, string>) => { state.loads = fn(state.loads); },
    setTransactions: (rows: Row[]) => { state.expense = rows; },
    setIncomeList: (rows: Row[]) => { state.income = rows; },
    setSavings: (rows: Row[]) => { state.saving = rows; },
    setRecurringTransactions: noop, getLocalDateKey: () => '2026-01-01',
    BUDGET_RECORD_TABLE: { expense: 'budget_transactions', income: 'budget_income', saving: 'budget_savings' },
    loadBudgetRows: (_client: unknown, table: string, owner: string) => {
      queries.push({ table, owner, epoch: context.budgetEpoch.current });
      const rows = [{ id: `${owner}-${table}`, date: '2026-10-27' }];
      const gate = deferred<Row[]>();
      if (holdRows) rowGates.push({ ...gate, rows }); else gate.resolve(rows);
      for (const waiter of queryWaiters) if (queries.length >= waiter.count) waiter.gate.resolve();
      return gate.promise;
    },
    supabase: {
      auth: { getUser: () => {
        if (bootstrapAuthenticating) { bootstrapAuthenticating = false; return bootstrapAuth.promise; }
        if (!holdAuth) return Promise.resolve(auth(state.owner));
        const gate = deferred<Auth>(); authGates.push(gate);
        for (const waiter of authWaiters) if (authGates.length >= waiter.count) waiter.gate.resolve();
        return gate.promise;
      } },
      from: (table: string) => {
        assert.equal(table, 'budget_profiles');
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { nickname: 'synthetic' } }) }) }) };
      },
    },
    setUser: (user: { id: string }) => {
      state.pendingOwner = user.id;
      if (state.mounted && options.immediateCommit) commitOwner(user.id);
    },
    loadUserSettings: () => options.holdSettings ? settings.promise : Promise.resolve(null),
    localStorage: { getItem: () => null }, window: { localStorage: { getItem: () => null } },
    readPendingBudgetSave: () => {
      if (options.pending === 'throw') throw Error('synthetic storage failure');
      return options.pending === 'present' ? pending : null;
    },
    router: { replace: () => assert.fail('Unexpected navigation') },
    console: { error: () => assert.fail('Unexpected bootstrap error') },
    setLoading: (value: boolean) => { if (state.mounted) state.loading = value; },
    setAppReady: (value: boolean) => { if (state.mounted) state.appReady = value; },
    setParsedItems: (value: unknown[]) => { state.parsedItems = value; },
    setShowConfirm: (value: boolean) => { state.showConfirm = value; },
    setFeedback: (value: string) => { state.feedback = value; },
    setPageNotice: noop, setIsUnlocked: noop, setIsLockReady: noop, setNickname: noop,
    setNewNickname: noop, setShowNicknameInput: noop, setAutoAnalyzeEnabled: noop,
    setAutoQuestion: noop, setIsSavingRecords: noop, setAiLoading: noop, setHasPendingSave: noop,
    setInput: noop, setTab: noop,
    fetchTransactions: () => launch('expense'), fetchSavings: () => launch('saving'), fetchIncome: () => launch('income'),
    fetchRecurringExpensePreferences: async () => { state.recurringReads++; },
  };
  const sandbox = vm.createContext(context);
  vm.runInContext(compile(reader + ownerEffect + lifetimeEffect + bootstrap), sandbox, { timeout: 1000 });
  const run = (expression: string) => vm.runInContext(expression, sandbox, { timeout: 1000 });
  let cleanup = run('lifetimeEffect()') as () => void;
  run('ownerEffect()');
  function launch(kind: Kind) {
    const task = run(`fetchRecordKind('${kind}')`) as Promise<boolean>;
    tasks.push(task); return task;
  }
  function commitOwner(owner: string | null) {
    if (!state.mounted || state.owner === owner) return;
    state.owner = owner; context.user = owner ? { id: owner } : null;
    context.liveBudgetOwner.current = owner; run('ownerEffect()');
    for (const waiter of ownerWaiters) if (owner === waiter.owner) waiter.gate.resolve();
  }
  function replayEffects() {
    cleanup(); cleanup = run('lifetimeEffect()') as () => void; run('ownerEffect()');
  }
  function unmount() { cleanup(); state.mounted = false; }
  function begin() {
    bootstrapAuthenticating = true;
    const completion = run('checkUser()') as Promise<void>;
    bootstrapAuth.resolve(auth('A')); return completion;
  }
  function releaseAuth(gates: typeof authGates, owner: string | null) {
    holdAuth = false; for (const gate of gates) gate.resolve(auth(owner));
  }
  function waitForQueries(count: number) {
    const gate = deferred<void>();
    if (queries.length >= count) gate.resolve(); else queryWaiters.push({ count, gate });
    return gate.promise;
  }
  function waitForAuth(count: number) {
    const gate = deferred<void>();
    if (authGates.length >= count) gate.resolve(); else authWaiters.push({ count, gate });
    return gate.promise;
  }
  function waitForOwner(owner: string) {
    const gate = deferred<void>();
    if (state.owner === owner) gate.resolve(); else ownerWaiters.push({ owner, gate });
    return gate.promise;
  }
  return {
    state, context, tasks, queries, authGates, rowGates, begin, commitOwner, replayEffects, unmount,
    releaseAuth, waitForQueries, waitForAuth, waitForOwner, finishSettings: () => settings.resolve(null),
    holdAuth: () => { holdAuth = true; }, holdRows: (value: boolean) => { holdRows = value; }, refresh: launch,
  };
}

test('initial read launch is source-owned, after the owner epoch and before pending-save early returns', () => {
  assert.equal(ownerDependencies, '[user?.id]');
  const epoch = ownerEffect.indexOf('budgetEpoch.current += 1');
  const guard = ownerEffect.indexOf('if (!user?.id) return');
  const launch = ownerEffect.indexOf('void Promise.allSettled([fetchTransactions(), fetchSavings(), fetchIncome()])');
  const pending = ownerEffect.indexOf('readPendingBudgetSave');
  assert.ok(epoch >= 0 && guard > epoch && launch > guard && pending > launch);
  assert.doesNotMatch(bootstrap, /fetchTransactions\(|fetchSavings\(|fetchIncome\(/);
});

test('bootstrap completing before owner commit cannot lose initial reads or leave stable-owner loading stuck', async () => {
  const f = fixture(); await f.begin();
  assert.equal(f.state.appReady, true); assert.equal(f.tasks.length, 0);
  f.commitOwner('A'); assert.equal(f.authGates.length, 3); f.releaseAuth(f.authGates, 'A');
  assert.deepEqual(await Promise.all(f.tasks), [true, true, true]); assert.deepEqual({ ...f.state.loads }, ready);
  assert.equal(f.queries.length, 3); assert.equal(new Set(f.queries.map(q => q.table)).size, 3);
  f.commitOwner('A'); assert.equal(f.tasks.length, 3);
});

test('owner commit before bootstrap completion launches exactly once per kind, not again at completion', async () => {
  const f = fixture({ immediateCommit: true }); await f.begin();
  assert.equal(f.tasks.length, 3); f.releaseAuth(f.authGates, 'A');
  assert.deepEqual(await Promise.all(f.tasks), [true, true, true]); assert.equal(f.queries.length, 3);
});

for (const pending of ['none', 'present', 'throw'] as const) test(`pending-save ${pending} does not suppress initial reads or change draft restoration`, async () => {
  const f = fixture({ pending }); f.commitOwner('A'); f.releaseAuth(f.authGates, 'A');
  assert.deepEqual(await Promise.all(f.tasks), [true, true, true]); assert.equal(f.queries.length, 3);
  assert.equal(f.state.showConfirm, pending === 'present'); assert.equal(f.state.parsedItems.length, pending === 'present' ? 1 : 0);
  if (pending === 'throw') assert.match(f.state.feedback, /이전 저장 내용을 읽지 못했어요/);
});

test('A to B to A keeps distinct generations and admits only current A initial reads', async () => {
  const f = fixture(); f.commitOwner('A'); f.commitOwner('B'); f.commitOwner('A');
  f.releaseAuth(f.authGates.slice(0, 3), 'A'); f.releaseAuth(f.authGates.slice(3, 6), 'B'); f.releaseAuth(f.authGates.slice(6), 'A');
  assert.deepEqual(await Promise.all(f.tasks), [false, false, false, false, false, false, true, true, true]);
  assert.equal(f.queries.length, 3); assert.ok(f.queries.every(q => q.owner === 'A')); assert.deepEqual({ ...f.state.loads }, ready);
});

for (const failure of [false, true]) test(`late invalidated owner ${failure ? 'errors' : 'rows'} cannot alter new-owner rows or ready state`, async () => {
  const f = fixture(); f.holdRows(true); f.commitOwner('A'); f.releaseAuth(f.authGates.slice(), 'A');
  await f.waitForQueries(3); f.holdRows(false); f.holdAuth(); f.commitOwner('B'); f.releaseAuth(f.authGates.slice(3), 'B');
  assert.deepEqual(await Promise.all(f.tasks.slice(3)), [true, true, true]);
  for (const gate of f.rowGates) { if (failure) gate.reject(Error('synthetic stale error')); else gate.resolve(gate.rows); }
  assert.deepEqual(await Promise.all(f.tasks.slice(0, 3)), [false, false, false]);
  for (const kind of ['expense', 'income', 'saving'] as const) assert.ok(f.state[kind].every(row => row.id.startsWith('B-')));
  assert.deepEqual({ ...f.state.loads }, ready);
});

test('logout invalidates pending admissions and does not launch anonymous reads', async () => {
  const f = fixture(); f.commitOwner('A'); f.commitOwner(null); f.releaseAuth(f.authGates, 'A');
  assert.deepEqual(await Promise.all(f.tasks), [false, false, false]); assert.equal(f.queries.length, 0); assert.equal(f.tasks.length, 3);
});

test('unmount invalidates pending rows without completing loading or committing rows', async () => {
  const f = fixture(); f.holdRows(true); f.commitOwner('A'); f.releaseAuth(f.authGates, 'A');
  await f.waitForQueries(3); f.unmount(); for (const gate of f.rowGates) gate.resolve(gate.rows);
  assert.deepEqual(await Promise.all(f.tasks), [false, false, false]);
  assert.deepEqual({ ...f.state.loads }, { expense: 'loading', income: 'loading', saving: 'loading' });
  assert.deepEqual(f.state.expense, []); assert.deepEqual(f.state.income, []); assert.deepEqual(f.state.saving, []);
});

test('effect cleanup/replay before owner commit emits no null-owner reads', async () => {
  const f = fixture(); f.replayEffects(); assert.equal(f.tasks.length, 0); f.commitOwner('A'); f.releaseAuth(f.authGates, 'A');
  assert.deepEqual(await Promise.all(f.tasks), [true, true, true]); assert.equal(f.queries.length, 3);
});

test('initial null-owner effect replay and duplicate bootstrap completion do not duplicate stable-generation queries', async () => {
  const f = fixture({ immediateCommit: true }); f.replayEffects();
  await Promise.all([f.begin(), f.begin()]);
  assert.equal(f.tasks.length, 3); f.releaseAuth(f.authGates, 'A');
  assert.deepEqual(await Promise.all(f.tasks), [true, true, true]); assert.equal(f.queries.length, 3);
});

test('effect cleanup/replay after owner commit starts a new generation and rejects old admissions', async () => {
  const f = fixture(); f.commitOwner('A'); const oldEpoch = f.context.budgetEpoch.current;
  f.replayEffects(); assert.ok(f.context.budgetEpoch.current > oldEpoch); f.releaseAuth(f.authGates, 'A');
  assert.deepEqual(await Promise.all(f.tasks), [false, false, false, true, true, true]);
  assert.equal(f.queries.length, 3); assert.equal(new Set(f.queries.map(q => q.epoch)).size, 1);
});

test('effect replay after queries began may requery but never duplicates a kind within a generation', async () => {
  const f = fixture(); f.holdRows(true); f.commitOwner('A'); f.releaseAuth(f.authGates, 'A');
  await f.waitForQueries(3); f.holdRows(false); f.replayEffects();
  assert.deepEqual(await Promise.all(f.tasks.slice(3)), [true, true, true]);
  for (const gate of f.rowGates) gate.resolve(gate.rows);
  assert.deepEqual(await Promise.all(f.tasks.slice(0, 3)), [false, false, false]); assert.equal(f.queries.length, 6);
  assert.equal(new Set(f.queries.map(q => `${q.epoch}:${q.table}`)).size, 6); assert.deepEqual({ ...f.state.loads }, ready);
});

test('late bootstrap completion after owner switch does not create old-owner record queries', async () => {
  const f = fixture({ immediateCommit: true, holdSettings: true }); const completion = f.begin();
  await f.waitForOwner('A'); f.commitOwner('B'); f.finishSettings(); await completion;
  f.releaseAuth(f.authGates.slice(0, 3), 'A'); f.releaseAuth(f.authGates.slice(3), 'B');
  assert.deepEqual(await Promise.all(f.tasks), [false, false, false, true, true, true]);
  assert.equal(f.queries.length, 3); assert.ok(f.queries.every(q => q.owner === 'B'));
});

test('bootstrap completing after unmount cannot independently initiate record reads', async () => {
  const f = fixture({ immediateCommit: true, holdSettings: true }); const completion = f.begin();
  f.unmount(); f.finishSettings(); await completion;
  assert.equal(f.tasks.length, 0); assert.equal(f.queries.length, 0); assert.equal(f.state.appReady, false);
});

test('post-row auth recheck rejects records if authenticated owner changed before commit', async () => {
  const f = fixture(); f.holdRows(true); f.commitOwner('A'); f.releaseAuth(f.authGates, 'A');
  await f.waitForQueries(3); f.holdAuth(); for (const gate of f.rowGates) gate.resolve(gate.rows);
  await f.waitForAuth(6); f.releaseAuth(f.authGates.slice(3), 'B');
  assert.deepEqual(await Promise.all(f.tasks), [false, false, false]);
  assert.deepEqual(f.state.expense, []); assert.deepEqual(f.state.income, []); assert.deepEqual(f.state.saving, []);
});

test('explicit refresh still supersedes an in-flight initial read without resetting other kinds', async () => {
  const f = fixture(); f.holdRows(true); f.commitOwner('A'); f.releaseAuth(f.authGates, 'A');
  await f.waitForQueries(3); f.holdRows(false); const refresh = f.refresh('expense'); assert.equal(await refresh, true);
  for (const gate of f.rowGates) gate.resolve(gate.rows);
  assert.deepEqual(await Promise.all(f.tasks.slice(0, 3)), [false, true, true]);
  assert.deepEqual({ ...f.state.loads }, ready); assert.equal(f.queries.length, 4);
});
