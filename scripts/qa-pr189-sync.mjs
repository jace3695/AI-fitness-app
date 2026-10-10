// Isolated diagnostics, not browser QA. No real account, network, or environment files.
// Run explicitly: node scripts/qa-pr189-sync.mjs
// Failing preservation assertions deliberately return exit code 1.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const copy = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(done => setImmediate(done));
function originalFunction(path, name) {
  const source = readFileSync(resolve(root, path), 'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) {
      found.push(node.initializer.getText(ast));
    } else if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found.push(node.getText(ast).replace(/^export\s+/, ''));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(found.length, 1, `Cannot identify original function ${path}:${name}`);
  return ts.transpileModule(`(${found[0]})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const key = 'ai-fitness-workout-completed-days';
const settingsKey = 'ai-fitness-user-workout-settings';
const fixture = {
  [key]: Object.fromEntries([1, 2, 3, 4].map(day => [`2030-01-0${day}`, {
    workoutDone: true, workoutStatus: 'completed', workoutMemo: `fixture-${day}`,
  }])),
  [settingsKey]: { weeklyGroups: { mon: 'fixture-plan' }, exerciseTargets: {} },
};
const sessionDraftFixture = {
  version: 2, feedbackVersion: 1, exerciseSignature: 'fixture-exercise', savedAt: 1,
  currentIndex: 0, mode: 'exercise', completed: [], skipped: [], elapsedSeconds: 0,
  timerSeconds: 143, restSeconds: 0, painScore: 0, painSymptoms: [], painMemo: '',
  neurologicalSymptoms: [], overallStatus: 'partial',
  exerciseRecords: [{ exerciseName: 'fixture-exercise', status: 'pending', sets: [] }],
};

function deferred() {
  let resolvePromise;
  const promise = new Promise(done => { resolvePromise = done; });
  return { promise, resolve: resolvePromise };
}
class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(name) { return this.values.get(name) ?? null; }
  setItem(name, value) { this.values.set(name, String(value)); }
  removeItem(name) { this.values.delete(name); }
}
class FakeServer {
  constructor(state = fixture) {
    this.row = { state: copy(state), updated_at: '2030-01-01T00:00:00.000Z' };
    this.requests = [];
    this.pauses = [];
    this.failRead = false;
    this.loseWriteResponse = false;
    this.revision = 0;
  }
  pauseNext(method, phase = 'after') {
    const arrived = deferred();
    let thisRequestArrived = false;
    const originalResolve = arrived.resolve;
    arrived.resolve = () => { thisRequestArrived = true; originalResolve(); };
    const server = this;
    const released = deferred();
    this.pauses.push({ method, phase, arrived, released });
    return {
      // There is no real I/O in this scheduler: after one event-loop drain, a
      // request not started by the driven events is a test failure, not a wait.
      get arrived() { return (async () => {
        await flush();
        assert.ok(thisRequestArrived, `Expected ${method} ${phase} checkpoint was never reached; requests: ${JSON.stringify(server.requests.map(request => ({ method: request.method, result: request.result })))}`);
        return arrived.promise;
      })(); },
      release: released.resolve,
    };
  }
  async request(method, payload, filters, signal) {
    const request = { method, payload: payload && copy(payload), filters: copy(filters), signal };
    this.requests.push(request);
    const pauseIndex = this.pauses.findIndex(pause => pause.method === method);
    const pause = pauseIndex < 0 ? null : this.pauses.splice(pauseIndex, 1)[0];
    if (pause?.phase === 'before') { pause.arrived.resolve(); await pause.released.promise; }
    let result;
    if (method === 'GET') {
      if (this.failRead) {
        this.failRead = false;
        result = { data: null, error: new Error('fixture read unavailable') };
      } else result = { data: copy(this.row), error: null };
    } else {
      const expected = filters.find(([name]) => name === 'updated_at')?.[1];
      const expectedState = filters.find(([name]) => name === 'state')?.[1];
      const matches = expected === null && expectedState === null ? this.row === null
        : this.row !== null && expected === this.row.updated_at && JSON.stringify(expectedState) === JSON.stringify(this.row.state);
      if (!matches) result = { data: false, error: null };
      else {
        this.row = { state: copy(payload.state), updated_at: new Date(Date.UTC(2030, 2, 1) + ++this.revision).toISOString() };
        result = { data: true, error: null };
        if (this.loseWriteResponse) {
          this.loseWriteResponse = false;
          result = { data: null, error: new Error('fixture response lost after commit') };
        }
      }
    }
    request.result = copy({ data: result.data, error: result.error?.message ?? null });
    if (pause?.phase === 'after') { pause.arrived.resolve(); await pause.released.promise; }
    return result;
  }
  client() {
    const client = {
      deserialize: value => value,
      rpc: (name, args) => {
        assert.equal(name, 'save_cloud_state_if_unchanged');
        assert.equal(args.p_owner, 'fixture-user');
        const query = {
          abortSignal: signal => { query.signal = signal; return query; },
          then: (yes, no) => this.request('POST', { state: args.p_state }, [['updated_at', args.p_expected_updated_at], ['state', args.p_expected_state]], query.signal)
            .then(result => ({ ...result, data: client.deserialize(result.data) })).then(yes, no),
        };
        return query;
      },
      from: table => {
        assert.equal(table, 'user_app_state');
        let method = 'GET';
        let payload;
        const filters = [];
        const query = {
          select: () => query,
          update: () => { throw new Error('Direct table write bypassed content CAS RPC'); },
          eq: (name, value) => { filters.push([name, value]); return query; },
          maybeSingle: () => query,
          abortSignal: value => { query.signal = value; return query; },
          then: (yes, no) => this.request(method, payload, filters, query.signal).then(result => ({ ...result, data: client.deserialize(result.data) })).then(yes, no),
        };
        return query;
      },
    };
    return client;
  }
}
// Compile the original module with a strict dependency allowlist in a fresh VM.
// No browser or React renderer is used. The actual synchronization effect is invoked below.
let dateSequence = 0;
async function createDevice(server, seed = {}) {
  const storage = new MemoryStorage();
  const window = new EventTarget();
  const document = new EventTarget();
  document.visibilityState = 'visible';
  document.documentElement = { dataset: {} };
  window.localStorage = storage;
  window.location = { reload: () => { throw new Error('Unexpected fixture reload'); } };
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  window.setTimeout = (run, delay) => { const id = ++timerId; timers.set(id, { run, at: now + delay }); return id; };
  window.clearTimeout = id => timers.delete(id);
  window.setInterval = (run, delay) => { const id = ++timerId; timers.set(id, { run, at: now + delay, interval: delay }); return id; };
  window.clearInterval = id => timers.delete(id);
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : [Date.UTC(2030, 1, 1) + ++dateSequence])); }
  }
  const client = server.client();
  const authCallbacks = new Set();
  let initialAuth = Promise.resolve({ data: { user: { id: 'fixture-user' } } });
  client.auth = {
    signOut: async () => ({ error: null }),
    getUser: () => initialAuth,
    onAuthStateChange: callback => {
      authCallbacks.add(callback);
      return { data: { subscription: { unsubscribe: () => authCallbacks.delete(callback) } } };
    },
  };
  // This is an explicit, deterministic Web Locks model, never an unlocked
  // fallback. Each fixture device models an independent origin storage area.
  let lockTail = Promise.resolve();
  const locks = { request(_name, options, callback) {
    assert.equal(options.mode, 'exclusive');
    const work = lockTail.then(callback);
    lockTail = work.then(() => {}, () => {});
    return work;
  } };
  const context = vm.createContext({ window, document, Event, CustomEvent, AbortController,
    queueMicrotask, crypto, Error, navigator: { locks }, Date: FixtureDate });
  client.deserialize = value => vm.runInContext('JSON.parse', context)(JSON.stringify(value));
  const cache = new Map();
  const allowed = new Set(['app/data/cloudSync.ts', 'app/data/cloudSyncConflicts.ts', 'app/data/appRecordReset.ts', 'app/data/storageTransaction.ts', 'app/data/workoutCompletion.ts', 'app/data/dietPlans.ts']);
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    assert.ok(allowed.has(path), `Unexpected module ${path}`);
    const exports = {};
    cache.set(path, exports);
    const compiled = ts.transpileModule(readFileSync(resolve(root, path), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const requireFixture = specifier => {
      if (path === 'app/data/cloudSync.ts' && specifier === '../lib/supabase.ts') return { supabase: client };
      // All allowlisted data modules import siblings only.
      assert.ok(specifier.startsWith('./'), `Unexpected dependency ${specifier}`);
      return load(`app/data/${specifier.slice(2)}`);
    };
    vm.runInContext(`(function(exports, require) { ${compiled}\n})`, context)(exports, requireFixture);
    return exports;
  }
  const cloud = load('app/data/cloudSync.ts');
  const conflicts = load('app/data/cloudSyncConflicts.ts');
  const reset = load('app/data/appRecordReset.ts');
  const events = load('app/data/storageTransaction.ts');
  const workouts = load('app/data/workoutCompletion.ts');
  const panelPath = 'app/components/CloudSyncPanel.tsx';
  const source = readFileSync(resolve(root, panelPath), 'utf8');
  const ast = ts.createSourceFile(panelPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const effects = [];
  const authEffects = [];
  let syncDependencies;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') {
      const deps = node.arguments[1]?.getText(ast);
      // Keep the old dependency spelling to run the same preservation cases
      // against the pre-fix source. Neither effect body is replaced by a mock.
      if (['[syncRequest, user]', '[syncRequest, userId, authRevision]'].includes(deps)) {
        effects.push(node.arguments[0].getText(ast)); syncDependencies = deps;
      }
      if (deps === '[]') authEffects.push(node.arguments[0].getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(effects.length, 1, 'The sync effect moved; update this diagnostic adapter.');
  assert.equal(authEffects.length, 1, 'The auth effect moved; update this diagnostic adapter.');
  const effect = ts.transpileModule(`(function(user, userId) { return (${effects[0]})(); })`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let status = 'idle';
  let message = '';
  let conflictReview = null, reviewVersion = 0, pendingKeys = [], syncIssue = null;
  const refs = { lastSynced: { current: '' }, syncing: { current: false },
    authUserId: { current: 'fixture-user' }, authEpoch: { current: null }, cancelSync: { current: null }, heldReview: { current: null }, submitConflicts: { current: null } };
  Object.assign(context, cloud, conflicts, reset, events, refs, {
    migrateLegacyWorkoutWeekdays: workouts.migrateLegacyWorkoutWeekdays,
    user: { id: 'fixture-user' }, userId: 'fixture-user', supabase: client,
    authRevision: 0, retryAuth: { current: null },
    setAuthRevision: update => { context.authRevision = typeof update === 'function' ? update(context.authRevision) : update; },
    setUser: value => { context.user = value; context.userId = value?.id; },
    setStatus: value => { status = value; }, setMessage: value => { message = value; },
    setConflictReview: value => { conflictReview = value; },
    setReviewVersion: update => { reviewVersion = typeof update === 'function' ? update(reviewVersion) : update; },
    setPendingKeys: value => { pendingKeys = value; }, setSyncIssue: value => { syncIssue = value; },
    setLastSyncedAt: () => {}, requestSafeReload: window.location.reload,
  });
  context.pendingCloudKeys = vm.runInContext(originalFunction(panelPath, 'pendingCloudKeys'), context);
  await cloud.prepareLocalCloudState('fixture-user');
  const write = state => cloud.applyCloudState(client.deserialize(state));
  await write(seed);
  let cleanup;
  let authCleanup;
  let committedDeps;
  const currentDeps = () => syncDependencies.includes('userId') ? [context.userId, context.authRevision] : [context.user];
  const mountSync = () => { committedDeps = currentDeps(); cleanup = vm.runInContext(effect, context)(context.user, context.userId); };
  // Route navigation only tears down a page-owned synchronizer. A root-layout
  // synchronizer survives Next.js client navigation; full unmount still cleans up.
  const rootOwnsSync = /<CloudSyncPanel\b/.test(readFileSync(resolve(root, 'app/layout.tsx'), 'utf8'));
  return {
    cloud, window, storage,
    holdLocalLock: () => {
      const arrived = deferred(), release = deferred();
      void locks.request('yeoni-shared-local-storage-v2', { mode: 'exclusive' }, () => { arrived.resolve(); return release.promise; });
      return { arrived: arrived.promise, release: release.resolve };
    },
    disableLocks: () => { context.navigator.locks = undefined; },
    discardDraft: async draftKey => {
      const path = 'app/components/WorkoutSession.tsx';
      const source = readFileSync(resolve(root, path), 'utf8');
      const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      let handler;
      function visit(node) {
        if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'button' &&
            node.children.some(child => ts.isJsxText(child) && child.text.trim() === '저장 없이 종료')) {
          handler = node.openingElement.attributes.properties.find(prop => prop.name?.getText(ast) === 'onClick').initializer.expression.getText(ast);
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
      assert.ok(handler, 'Discard UI handler not found');
      const readDraft = vm.runInContext(originalFunction(path, 'readSessionDraft'), context);
      const initialDraft = readDraft(draftKey, sessionDraftFixture.exerciseSignature, sessionDraftFixture.exerciseRecords.length);
      assert.ok(initialDraft, 'The synthetic resumable draft must pass the shipped validator');
      let closed = false, notice = '', completion;
      Object.assign(context, { draftKey, shouldPersistDraftRef: { current: true },
        owner: events.captureStorageOwner(storage), draftQueue: { current: Promise.resolve() },
        expectedDraft: { current: storage.getItem(draftKey) }, savingRef: { current: false },
        initialDraft, persistedOnce: { current: false }, completionSaved: { current: false },
        setSaving: () => {}, setStorageNotice: value => { notice = value; }, onClose: () => { closed = true; } });
      context.fitnessStorageError = vm.runInContext(originalFunction('app/data/fitnessStorageUpdates.ts', 'fitnessStorageError'), context);
      context.removeDraft = vm.runInContext(originalFunction(path, 'removeDraft'), context);
      const discard = vm.runInContext(originalFunction(path, 'discardSession'), context);
      context.discardSession = () => { completion = discard(); return completion; };
      vm.runInContext(ts.transpileModule(`(${handler})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
      assert.ok(completion, 'The actual button did not start the awaited discard handler');
      await completion;
      assert.equal(notice, '', notice); assert.equal(closed, true, 'Discard did not close after durable deletion');
    },
    read: () => copy(cloud.readLocalCloudState()), write,
    saveFromCalendarSnapshot: async workouts => {
      // The component's one-time record read is supplied explicitly; no React mount is simulated.
      Object.assign(context, {
        stores: { workouts: copy(workouts) }, selected: '2030-02-02', todayKey: '2030-02-09',
        exerciseRecordsDraft: [{ exerciseName: 'fixture-exercise', status: 'completed', sets: [{ setNumber: 1, completed: true, reps: 8 }] }],
        selectedWorkoutRecord: undefined, workoutStatusDraft: 'partial',
        backFeedback: { workoutPain: false, workoutNeurologicalSymptoms: [] },
        workoutMemoDraft: 'fixture-new', workoutDifficultyDraft: undefined, workoutFatigueDraft: undefined,
        WORKOUT_COMPLETED_DAYS_KEY: key,
        setStores: value => { context.stores = typeof value === 'function' ? value(context.stores) : value; }, setEditingWorkout: () => {}, setWorkoutNotice: () => {},
        workoutOwner: { current: events.captureStorageOwner(storage) }, pendingRef: { current: false },
        setPending: () => {}, setStorageError: error => { assert.equal(error, '', error); },
      });
      for (const name of ['readJsonForUpdate', 'updateJson']) context[name] = vm.runInContext(originalFunction('app/data/recordStorage.ts', name), context);
      context.fitnessStorageError = vm.runInContext(originalFunction('app/data/fitnessStorageUpdates.ts', 'fitnessStorageError'), context);
      const formatCalendarError = context.fitnessStorageError;
      context.fitnessStorageError = error => {
        assert.notEqual(error?.name, 'ReferenceError', `Missing production dependency in calendar VM: ${error?.stack ?? error}`);
        return formatCalendarError(error);
      };
      context.runRecordChange = vm.runInContext(originalFunction('app/components/RecordCalendarView.tsx', 'runRecordChange'), context);
      context.writeWorkoutStore = vm.runInContext(originalFunction('app/components/RecordCalendarView.tsx', 'writeWorkoutStore'), context);
      await vm.runInContext(originalFunction('app/components/RecordCalendarView.tsx', 'saveNewWorkoutRecord'), context)();
    },
    get status() { return status; }, get message() { return message; },
    signOut: () => {
      let handler;
      function visit(node) {
        if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'button' && node.children.some(child => ts.isJsxText(child) && child.text.trim() === '로그아웃')) {
          handler = node.openingElement.attributes.properties.find(prop => prop.name?.getText(ast) === 'onClick').initializer.expression.getText(ast);
        }
        ts.forEachChild(node, visit);
      }
      visit(ast); assert.ok(handler, 'Shipping sign-out handler missing');
      vm.runInContext(ts.transpileModule(`(${handler})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    },
    get review() { return conflictReview; }, get reviewVersion() { return reviewVersion; },
    get pendingKeys() { return pendingKeys; }, get syncIssue() { return syncIssue; },
    captureResolution: side => {
      const review = conflictReview;
      assert.ok(review, 'No conflict prompt to choose from');
      const choices = review.conflicts.map(conflict => ({ path: conflict.path, side }));
      return async () => { refs.submitConflicts.current?.({ review, choices: client.deserialize(choices) }); await flush(); };
    },
    resolve: async side => {
      assert.ok(conflictReview, 'No conflict prompt to choose from');
      refs.submitConflicts.current?.({ review: conflictReview, choices: client.deserialize(conflictReview.conflicts.map(conflict => ({ path: conflict.path, side }))) });
      await flush();
    },
    get waitingTimers() { return timers.size; },
    mount: async () => { mountSync(); await flush(); },
    unmount: () => { cleanup?.(); authCleanup?.(); },
    mountAuth: async () => {
      authCleanup = vm.runInContext(ts.transpileModule(`(${authEffects[0]})()`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText, context);
      await flush();
    },
    pauseInitialAuth: () => {
      const pending = deferred(); initialAuth = pending.promise;
      return userId => pending.resolve({ data: { user: userId ? { id: userId } : null } });
    },
    emitAuth: (event, userId) => {
      for (const callback of authCallbacks) callback(event, userId ? { user: { id: userId } } : null);
    },
    commitAuth: async () => {
      // Preparation and cleanup settle before the simulated React effect commit.
      await flush();
      if (!committedDeps || currentDeps().some((value, index) => !Object.is(value, committedDeps[index]))) { cleanup?.(); mountSync(); }
      await flush();
    },
    get userId() { return context.userId; },
    get lastSynced() { return refs.lastSynced.current; },
    leaveRoute: () => { if (!rootOwnsSync) cleanup?.(); },
    focus: async () => { window.dispatchEvent(new Event('focus')); await flush(); },
    remoteRefresh: async ownerId => { events.requestCloudRecordsRefresh(ownerId); await flush(); },
    advance: async milliseconds => {
      const target = now + milliseconds;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next;
        now = timer.at;
        if (timer.interval) timer.at += timer.interval; else timers.delete(id);
        timer.run();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}
async function changeMemo(device, date, memo) {
  const state = device.read();
  state[key][date] = { ...state[key][date], workoutMemo: memo };
  await device.write(state);
  return state;
}
function expectState(actual, expected, label) {
  assert.deepEqual(copy(actual), copy(expected), label);
}
const cases = [];
async function check(name, body) {
  try { await body(); cases.push({ name, result: 'PASS' }); }
  catch (error) { cases.push({ name, result: 'FAIL', detail: error.message }); }
}

await check('로그아웃·재로그인: 합성 원본 17개 키 보존, 로그인 직후 빈 PATCH 없음', async () => {
  const original = { ...copy(fixture), ...Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`ai-fitness-fixture-${i}`, { value: i }])) };
  const server = new FakeServer(original); const device = await createDevice(server);
  await device.mountAuth(); await device.mount();
  device.emitAuth('SIGNED_OUT', null); await device.commitAuth();
  assert.equal(device.cloud.readSyncBase('fixture-user'), null, 'Logout retained a deletion baseline');
  expectState(device.read(), {}, 'Signed-out cache was not cleared');
  device.emitAuth('SIGNED_IN', 'fixture-user'); await device.commitAuth();
  expectState(device.read(), original, 'Login lost original records');
  expectState(server.row.state, original, 'Login changed the original server state');
  assert.equal(server.requests.filter(request => request.method === 'POST').length, 0);
  device.unmount();
});

await check('기존 버전의 빈 로컬·잔여 기준값으로 로그인: 빈 PATCH 없이 원본 복구', async () => {
  const server = new FakeServer(); const device = await createDevice(server);
  device.storage.removeItem('fitness-cloud-sync-user');
  device.storage.setItem('fitness-cloud-sync-base:fixture-user', JSON.stringify(fixture));
  await device.mountAuth(); await device.mount();
  expectState(server.row.state, fixture, 'Legacy logout cache sent an empty replacement');
  expectState(device.read(), fixture, 'Original records were not hydrated');
  assert.equal(server.requests.filter(request => request.method === 'POST').length, 0);
  device.unmount();
});

await check('로그아웃 직후 React 정리 전 늦은 GET: PATCH·기준값 재생성 없음', async () => {
  const server = new FakeServer(); const device = await createDevice(server, fixture);
  await device.cloud.saveSyncBase('fixture-user', fixture);
  await device.mountAuth(); const pause = server.pauseNext('GET');
  await device.mount(); await pause.arrived;
  device.emitAuth('SIGNED_OUT', null); // Deliberately do not commit React cleanup yet.
  pause.release(); await flush();
  assert.equal(server.requests.length, 1, 'Old session sent a follow-up request');
  expectState(device.read(), {}, 'Late response recreated logged-out records');
  assert.equal(device.cloud.readSyncBase('fixture-user'), null);
  assert.equal(device.lastSynced, ''); assert.equal(device.status, 'idle');
  device.unmount();
});

await check('CAS 거절 응답 대기 중 로그아웃: 재조회·재PATCH 중단', async () => {
  const server = new FakeServer(); const device = await createDevice(server, fixture);
  await device.mountAuth(); await device.mount();
  const pause = server.pauseNext('POST', 'before');
  await changeMemo(device, '2030-02-02', 'fixture-before-logout');
  // Both sides changed, so this enters the retrying three-way merge branch.
  server.row.state[settingsKey].exerciseTargets = { remote: 9 };
  server.row.updated_at = '2030-03-01T00:00:00.000Z';
  const remoteBeforeLogout = copy(server.row.state);
  await flush(); await device.advance(500); await pause.arrived;
  server.row.updated_at = '2030-04-01T00:00:00.000Z';
  device.emitAuth('SIGNED_OUT', null); const count = server.requests.length;
  pause.release(); await flush();
  assert.equal(server.requests.length, count, 'Cancelled CAS loop kept writing after logout');
  expectState(server.row.state, remoteBeforeLogout, 'Cancelled CAS loop changed server records');
  assert.equal(device.cloud.readSyncBase('fixture-user'), null); device.unmount();
});

await check('이전 GET 대기 중 다른 계정 로그인: 새 동기화 즉시 시작·기록 혼합 없음', async () => {
  const server = new FakeServer(); const device = await createDevice(server, fixture);
  await device.mountAuth(); const pause = server.pauseNext('GET');
  await device.mount(); await pause.arrived;
  const other = { 'ai-fitness-other-account': { memo: 'fixture-b-only' } };
  server.row = { state: copy(other), updated_at: '2030-05-01T00:00:00.000Z' };
  device.emitAuth('SIGNED_IN', 'fixture-b'); await device.commitAuth();
  expectState(device.read(), other, 'Previous request blocked the new account sync');
  assert.equal(device.status, 'synced');
  pause.release(); await flush();
  expectState(device.read(), other, 'Previous account response leaked into new account');
  expectState(server.row.state, other, 'Previous account cache was imported');
  assert.equal(device.cloud.readSyncBase('fixture-user'), null); device.unmount();
});

await check('늦은 초기 getUser 응답: 이후 로그아웃을 되돌리지 않음', async () => {
  const server = new FakeServer(); const device = await createDevice(server);
  const releaseAuth = device.pauseInitialAuth(); await device.mountAuth();
  device.emitAuth('SIGNED_OUT', null); releaseAuth('fixture-user'); await flush();
  assert.equal(device.userId, undefined, 'Stale initial auth result reactivated the previous user');
  assert.equal(server.requests.length, 0); device.unmount();
});

await check('한 번의 React 반영에 같은 계정 로그아웃·재로그인: 취소된 동기화 재시작', async () => {
  const server = new FakeServer(); const device = await createDevice(server);
  await device.mountAuth(); const pause = server.pauseNext('GET');
  await device.mount(); await pause.arrived;
  device.emitAuth('SIGNED_OUT', null); device.emitAuth('SIGNED_IN', 'fixture-user');
  await device.commitAuth();
  assert.equal(device.status, 'synced', 'Batched same-user login kept a cancelled sync effect');
  expectState(device.read(), fixture, 'Same-user login did not restore the original records');
  pause.release(); await flush();
  expectState(server.row.state, fixture, 'Old request changed the new session'); device.unmount();
});

await check('동일 계정 토큰 갱신·재확인: 저장 기준과 요청 유지', async () => {
  const server = new FakeServer(); const device = await createDevice(server);
  await device.mountAuth(); await device.mount(); const before = device.lastSynced;
  const pause = server.pauseNext('POST');
  const expected = await changeMemo(device, '2030-02-02', 'fixture-token-refresh');
  await flush(); await device.advance(500); await pause.arrived;
  device.emitAuth('TOKEN_REFRESHED', 'fixture-user'); device.emitAuth('SIGNED_IN', 'fixture-user');
  assert.equal(device.lastSynced, before, 'Same-user auth event discarded the confirmed baseline');
  pause.release(); await flush();
  assert.equal(device.status, 'synced'); expectState(server.row.state, expected, 'Refresh lost pending input');
  device.unmount();
});

await check('저장 성공 응답 뒤 제3 세션 덮어쓰기: 완료 표시 금지·로컬 새 기록 보존', async () => {
  const server = new FakeServer(); const device = await createDevice(server); await device.mount();
  const pause = server.pauseNext('POST');
  const expected = await changeMemo(device, '2030-02-02', 'fixture-unconfirmed');
  await flush(); await device.advance(500); await pause.arrived;
  server.row = { state: copy(fixture), updated_at: '2030-03-01T00:00:00.000Z' };
  pause.release(); await flush();
  assert.equal(device.status, 'error', 'Acknowledgement alone must not claim server preservation');
  expectState(device.read(), expected, 'Unconfirmed input was erased');
  await device.focus();
  expectState(server.row.state, expected, 'Retry did not preserve new input');
  assert.equal(device.status, 'synced'); device.unmount();
});

await check('실제 저장 없이 종료 핸들러: 수동 동기화 없이 서버 임시 진행 삭제', async () => {
  const draftKey = 'ai-fitness-workout-session-draft:2030-02-02:fixture';
  const state = { ...copy(fixture), [draftKey]: copy(sessionDraftFixture) };
  const server = new FakeServer(state); const device = await createDevice(server); await device.mount();
  await device.discardDraft(draftKey); await flush(); device.leaveRoute(); await device.advance(500);
  expectState(server.row.state, fixture, 'Discarded draft remained on server');
  const fresh = await createDevice(server); await fresh.mount();
  expectState(fresh.read(), fixture, 'Discarded draft restored on another device');
  device.unmount(); fresh.unmount();
});

await check('저장 후 확인 GET 실패: 오류·기기 보존·재조회 복구', async () => {
  const server = new FakeServer(); const device = await createDevice(server); await device.mount();
  const pause = server.pauseNext('POST');
  const expected = await changeMemo(device, '2030-02-02', 'fixture-readback-error');
  await flush(); await device.advance(500); await pause.arrived;
  server.failRead = true; pause.release(); await flush();
  assert.equal(device.status, 'error');
  expectState(device.read(), expected, 'Confirmation failure lost local input');
  await device.focus();
  assert.equal(device.status, 'synced');
  expectState(server.row.state, expected, 'Retry changed committed input'); device.unmount();
});

await check('저장 확인 GET 대기 중 추가 수정: 마지막 입력 후속 저장', async () => {
  const server = new FakeServer(); const device = await createDevice(server); await device.mount();
  const writePause = server.pauseNext('POST');
  await changeMemo(device, '2030-02-02', 'fixture-before-confirmation');
  await flush(); await device.advance(500); await writePause.arrived;
  const readPause = server.pauseNext('GET'); writePause.release(); await readPause.arrived;
  const expected = await changeMemo(device, '2030-02-02', 'fixture-during-confirmation');
  readPause.release(); await flush();
  assert.equal(device.status, 'pending'); await device.advance(500);
  expectState(server.row.state, expected, 'Readback erased later edit');
  assert.equal(device.status, 'synced'); device.unmount();
});

await check('임시 진행 PATCH 대기 중 실제 종료: 늦은 응답 뒤 재복구 없음', async () => {
  const draftKey = 'ai-fitness-workout-session-draft:2030-02-02:fixture';
  const server = new FakeServer(); const device = await createDevice(server); await device.mount();
  const pause = server.pauseNext('POST');
  await device.write({ ...device.read(), [draftKey]: copy(sessionDraftFixture) });
  await flush(); await device.advance(500); await pause.arrived;
  await device.discardDraft(draftKey); await flush(); device.leaveRoute();
  pause.release(); await flush(); await device.advance(500);
  expectState(server.row.state, fixture, 'Late draft acknowledgement resurrected discarded progress');
  expectState(device.read(), fixture, 'Discarded draft restored locally'); device.unmount();
});

await check('GET 중 첫 로컬 저장: 서버 원본 4일과 새 날짜 병합', async () => {
  const server = new FakeServer();
  const pause = server.pauseNext('GET');
  const device = await createDevice(server);
  await device.mount();
  await pause.arrived;
  const added = { workoutDone: false, workoutStatus: 'partial', workoutMemo: 'fixture-new' };
  await device.write({ [key]: { '2030-02-02': added } });
  pause.release(); await flush();
  const expected = copy(fixture); expected[key]['2030-02-02'] = added;
  expectState(device.read(), expected, 'Initial merge lost records');
  assert.equal(device.status, 'pending', 'The GET snapshot cannot acknowledge an edit created after it');
  await device.advance(500);
  assert.equal(device.status, 'synced');
  expectState(server.row.state, expected, 'Server merge lost records');
  device.unmount();
});

await check('PATCH 응답 대기 중 수정: 늦은 응답 이후 후속 저장', async () => {
  const server = new FakeServer(); const device = await createDevice(server);
  await device.mount();
  const pause = server.pauseNext('POST');
  await changeMemo(device, '2030-01-01', 'fixture-first'); await flush(); await device.advance(500); await pause.arrived;
  const expected = await changeMemo(device, '2030-01-01', 'fixture-later');
  pause.release(); await flush();
  assert.equal(device.status, 'pending');
  expectState(device.read(), expected, 'Late response erased local edit');
  await device.advance(500);
  expectState(server.row.state, expected, 'Follow-up did not persist local edit');
  assert.equal(device.status, 'synced'); device.unmount();
});

await check('PATCH 응답 대기 중 삭제: 후속 저장과 새 세션에서 재등장 없음', async () => {
  const server = new FakeServer(); const device = await createDevice(server);
  await device.mount();
  const pause = server.pauseNext('POST');
  await changeMemo(device, '2030-01-01', 'fixture-before-delete'); await flush(); await device.advance(500); await pause.arrived;
  const expected = device.read(); delete expected[key]['2030-01-01']; await device.write(expected);
  pause.release(); await flush(); await device.advance(500);
  expectState(server.row.state, expected, 'Deleted date resurrected');
  device.unmount();
  const fresh = await createDevice(server); await fresh.mount();
  expectState(fresh.read(), expected, 'New device resurrected date'); fresh.unmount();
});

await check('독립 저장소 2개: 동시 수정 충돌 후 재시도로 양쪽 변경 보존', async () => {
  const server = new FakeServer(); const a = await createDevice(server); const b = await createDevice(server);
  await a.mount(); await b.mount();
  const pause = server.pauseNext('POST', 'before');
  await changeMemo(a, '2030-01-01', 'fixture-a'); await flush(); await a.advance(500); await pause.arrived;
  await changeMemo(b, '2030-01-02', 'fixture-b'); await flush(); await b.advance(500);
  pause.release(); await flush();
  assert.equal(a.status, 'error', 'Lost CAS should be visible');
  await a.focus(); await b.focus();
  const expected = copy(fixture); expected[key]['2030-01-01'].workoutMemo = 'fixture-a'; expected[key]['2030-01-02'].workoutMemo = 'fixture-b';
  expectState(server.row.state, expected, 'Conflict retry discarded a device change');
  expectState(a.read(), expected, 'Device A not converged'); expectState(b.read(), expected, 'Device B not converged');
  a.unmount(); b.unmount();
});

await check('서버 반영 후 응답 유실: 오류 표시·재접속 재조회로 중복 없이 복구', async () => {
  const server = new FakeServer(); const device = await createDevice(server); await device.mount();
  server.loseWriteResponse = true;
  const expected = await changeMemo(device, '2030-01-01', 'fixture-lost-response'); await flush(); await device.advance(500);
  assert.equal(device.status, 'error'); expectState(device.read(), expected, 'Response loss erased local record');
  device.unmount();
  const restarted = await createDevice(server, device.read()); await restarted.mount();
  expectState(server.row.state, expected, 'Retry duplicated or lost record'); expectState(restarted.read(), expected, 'Reconnect failed');
  assert.equal(restarted.status, 'synced');
  assert.equal(server.requests.filter(request => request.method === 'POST').length, 1, 'Reconnect resubmitted already committed state');
  restarted.unmount();
});

await check('조회 실패: 기존 기록 유지·오류 표시·포커스 재시도', async () => {
  const server = new FakeServer(); const device = await createDevice(server); await device.mount();
  server.failRead = true;
  await device.focus();
  assert.equal(device.status, 'error'); assert.ok(device.message.trim(), 'Read error must have a user-facing message');
  expectState(device.read(), fixture, 'Read failure erased records');
  assert.equal(server.requests.filter(request => request.method === 'POST').length, 0, 'Read failure triggered a write');
  await device.focus(); assert.equal(device.status, 'synced');
  expectState(device.read(), fixture, 'Retry changed records'); device.unmount();
});

await check('서버 명령 저장 후 즉시 재조회: 본인 알림만 반영하고 기존 로컬 값을 다시 쓰지 않음', async () => {
  const server = new FakeServer(); const device = await createDevice(server); await device.mount();
  const expected = copy(fixture); expected[key]['2030-01-01'].workoutMemo = 'fixture-server-command';
  server.row = { state: expected, updated_at: '2030-02-01T00:01:00.000Z' };
  const count = server.requests.length;
  await device.remoteRefresh('another-owner'); assert.equal(server.requests.length, count);
  await device.remoteRefresh('fixture-user');
  expectState(device.read(), expected, 'Server command stayed invisible on the device');
  assert.equal(server.requests.filter(request => request.method === 'POST').length, 0);
  device.unmount();
});

await check('이전 GET 응답 대기 중 서버 명령 알림: 완료 뒤 재조회하여 최신 기록을 복구', async () => {
  const server = new FakeServer(); const device = await createDevice(server); await device.mount();
  const pause = server.pauseNext('GET'); await device.focus(); await pause.arrived;
  const expected = copy(fixture); expected[key]['2030-01-01'].workoutMemo = 'fixture-command-during-read';
  server.row = { state: expected, updated_at: '2030-02-01T00:02:00.000Z' };
  await device.remoteRefresh('fixture-user'); pause.release(); await flush(); await device.advance(0);
  expectState(device.read(), expected, 'An older in-flight GET swallowed the refresh notification');
  assert.equal(server.requests.filter(request => request.method === 'GET').length, 3);
  assert.equal(server.requests.filter(request => request.method === 'POST').length, 0);
  device.unmount();
});

await check('달력의 동기화 전 스냅샷으로 첫 저장: 원본 4일 보존', async () => {
  const server = new FakeServer(); const device = await createDevice(server);
  const pause = server.pauseNext('GET'); await device.mount(); await pause.arrived;
  const calendarSnapshot = device.read()[key] ?? {};
  pause.release(); await flush();
  expectState(device.read(), fixture, 'Initial sync did not load fixture originals');
  await device.saveFromCalendarSnapshot(calendarSnapshot); await flush(); await device.advance(500);
  const saved = copy(server.row.state); device.unmount();
  expectState(saved[settingsKey], fixture[settingsKey], 'Settings changed');
  assert.equal(Object.keys(saved[key]).length, 5, 'Expected original 4 dates plus the new date after calendar save');
  for (const [date, record] of Object.entries(fixture[key])) expectState(saved[key][date], record, 'Original date changed');
});

await check('대조군: 최신 스냅샷으로 같은 달력 저장을 실행하면 원본 4일 보존', async () => {
  const server = new FakeServer(); const device = await createDevice(server); await device.mount();
  await device.saveFromCalendarSnapshot(device.read()[key]); await flush(); await device.advance(500);
  const saved = copy(server.row.state); device.unmount();
  expectState(saved[settingsKey], fixture[settingsKey], 'Settings changed');
  assert.equal(Object.keys(saved[key]).length, 5);
  for (const [date, record] of Object.entries(fixture[key])) expectState(saved[key][date], record, 'Original date changed');
});

await check('삭제 직후 화면 이탈: 공통 동기화가 서버 삭제 완료', async () => {
  const server = new FakeServer(); const device = await createDevice(server); await device.mount();
  const expected = device.read(); delete expected[key]['2030-01-01']; await device.write(expected); await flush();
  assert.equal(device.status, 'pending'); device.leaveRoute();
  await device.advance(60000);
  expectState(device.read(), expected, 'Local deletion was lost');
  expectState(server.row.state, expected, 'Deletion remains only on device after unmount');
  device.unmount();
});

await check('PATCH 도중 추가 수정 후 화면 이탈: 추가 수정까지 서버 반영', async () => {
  const server = new FakeServer(); const device = await createDevice(server); await device.mount();
  const pause = server.pauseNext('POST');
  await changeMemo(device, '2030-01-01', 'fixture-first'); await flush(); await device.advance(500); await pause.arrived;
  const expected = await changeMemo(device, '2030-01-01', 'fixture-later'); await flush();
  device.leaveRoute(); pause.release(); await flush(); await device.advance(60000);
  expectState(device.read(), expected, 'Local later edit was lost');
  expectState(server.row.state, expected, 'Later edit remains only on device after unmount');
  device.unmount();
});

await check('달력의 오래된 날짜 편집: 같은 날짜의 원격 유산소 필드도 보존', async () => {
  const state = copy(fixture);
  state[key]['2030-02-02'] = { cardioDone: true, cardioMinutes: 25, cardioMemo: 'fixture-remote-cardio' };
  const server = new FakeServer(state); const device = await createDevice(server); await device.mount();
  await device.saveFromCalendarSnapshot({}); await flush(); await device.advance(500);
  const saved = server.row.state[key]['2030-02-02'];
  assert.equal(saved.cardioMinutes, 25);
  assert.equal(saved.cardioMemo, 'fixture-remote-cardio');
  assert.equal(saved.workoutMemo, 'fixture-new');
  for (const [date, record] of Object.entries(fixture[key])) expectState(server.row.state[key][date], record, 'Original changed');
  device.unmount();
});

await check('달력 저장의 실제 요일 마이그레이션: 기존 날짜 우선·새 날짜 보존·유산소 유지', async () => {
  const state = copy(fixture);
  const dated = { cardioDone: true, cardioMinutes: 25, cardioMemo: 'fixture-canonical-cardio' };
  state[key]['2030-01-28'] = dated;
  state[key].mon = { workoutMemo: 'fixture-obsolete-weekday' };
  state[key].tue = { workoutDone: true, workoutMemo: 'fixture-migrated-weekday' };
  const server = new FakeServer(state); const device = await createDevice(server); await device.mount();
  await device.saveFromCalendarSnapshot({}); await flush(); await device.advance(500);
  const saved = server.row.state;
  expectState(saved[key]['2030-01-28'], dated, 'Legacy marker replaced the canonical dated record');
  expectState(saved[key]['2030-01-29'], state[key].tue, 'Legacy-only weekday was lost instead of migrated');
  assert.equal(saved[key].mon, undefined); assert.equal(saved[key].tue, undefined);
  assert.equal(saved[key]['2030-02-02'].workoutMemo, 'fixture-new');
  assert.equal(Object.keys(saved[key]).length, 7, 'Expected original four dates, two migrated/canonical dates and the new save');
  for (const [date, value] of Object.entries(fixture[key])) expectState(saved[key][date], value, 'Original date changed during migration');
  expectState(saved[settingsKey], fixture[settingsKey], 'Settings changed during migration');
  expectState(device.read(), saved, 'Local and acknowledged migrated records differ');
  device.unmount();
});

await check('Web Locks 미지원: 잠금 없는 쓰기 없이 원본·기준값 보존', async () => {
  const server = new FakeServer(); const device = await createDevice(server); await device.mount();
  const before = [...device.storage.values];
  device.disableLocks();
  await assert.rejects(device.write({ ...device.read(), 'ai-fitness-unsupported-write': true }), /Web Locks/);
  expectState([...device.storage.values], before, 'Unsupported browser modified protected storage');
  expectState(server.row.state, fixture, 'Unsupported local write changed the server');
  device.unmount();
});

async function conflictDevice() {
  const server = new FakeServer(); const device = await createDevice(server); await device.mount();
  await changeMemo(device, '2030-01-01', 'fixture-local-conflict');
  server.row.state[key]['2030-01-01'].workoutMemo = 'fixture-remote-conflict';
  server.row.updated_at = '2030-04-01T00:00:00.000Z';
  await device.focus();
  assert.equal(device.status, 'conflict'); assert.ok(device.review);
  return { server, device };
}

await check('같은 필드 충돌: 원본·기준 보존, 선택 없이 쓰기·완료 없음', async () => {
  const { server, device } = await conflictDevice();
  assert.equal(server.requests.filter(request => request.method === 'POST').length, 0);
  assert.equal(device.read()[key]['2030-01-01'].workoutMemo, 'fixture-local-conflict');
  assert.equal(server.row.state[key]['2030-01-01'].workoutMemo, 'fixture-remote-conflict');
  expectState(device.cloud.readSyncBase('fixture-user'), fixture, 'Unresolved conflict advanced base');
  assert.equal(device.review.conflicts.length, 1); assert.equal(device.syncIssue, null);
  assert.ok(device.pendingKeys.includes(key));
  const generation = device.review.request.storageGeneration;
  const version = device.reviewVersion; await device.focus();
  assert.equal(device.review.request.storageGeneration, generation, 'Read-only review poll rotated storage generation');
  assert.equal(device.reviewVersion, version, 'Unchanged poll needlessly invalidates choices');
  device.unmount();
});

for (const side of ['local', 'remote']) await check(`명시적 ${side} 선택: 해당 필드만 반영하고 독립 원본 보존`, async () => {
  const { server, device } = await conflictDevice();
  await device.resolve(side);
  assert.equal(device.status, 'synced'); assert.equal(device.review, null);
  const expected = copy(fixture); expected[key]['2030-01-01'].workoutMemo = `fixture-${side}-conflict`;
  expectState(server.row.state, expected, 'Resolution lost an independent original');
  expectState(device.read(), expected, 'Resolution not reflected locally');
  expectState(device.cloud.readSyncBase('fixture-user'), expected, 'Resolution base is not exact');
  device.unmount();
});

await check('선택 후 최신 로컬 변경: 오래된 선택 제출 무시·최신 충돌 재표시', async () => {
  const { server, device } = await conflictDevice(); const stale = device.captureResolution('remote');
  await changeMemo(device, '2030-01-01', 'fixture-newer-local');
  assert.equal(device.review, null, 'Local event did not hide obsolete values');
  await stale(); await device.advance(500);
  assert.equal(device.status, 'conflict');
  assert.equal(device.review.conflicts[0].local.value, 'fixture-newer-local');
  assert.equal(server.requests.filter(request => request.method === 'POST').length, 0);
  assert.equal(device.read()[key]['2030-01-01'].workoutMemo, 'fixture-newer-local'); device.unmount();
});

await check('선택 제출 중 최신 원격 변경: 선택 폐기·새 값 재표시·쓰기 없음', async () => {
  const { server, device } = await conflictDevice();
  server.row.state[key]['2030-01-01'].workoutMemo = 'fixture-newer-remote';
  server.row.updated_at = '2030-04-02T00:00:00.000Z';
  await device.resolve('local'); await device.advance(0);
  assert.equal(device.status, 'conflict');
  assert.equal(device.review.conflicts[0].remote.value, 'fixture-newer-remote');
  assert.equal(server.requests.filter(request => request.method === 'POST').length, 0); device.unmount();
});

await check('원격 CAS 직전 같은 시각·새 내용 경합: 선택 재사용 없이 다시 표시', async () => {
  const { server, device } = await conflictDevice(); const hold = server.pauseNext('POST', 'before');
  await device.resolve('local'); await hold.arrived;
  server.row.state[key]['2030-01-01'].workoutMemo = 'fixture-same-timestamp-remote';
  hold.release(); await flush(); await device.advance(0);
  assert.equal(device.status, 'conflict');
  assert.equal(server.row.state[key]['2030-01-01'].workoutMemo, 'fixture-same-timestamp-remote');
  assert.equal(device.review.conflicts[0].remote.value, 'fixture-same-timestamp-remote');
  assert.equal(server.requests.find(request => request.method === 'POST').result.data, false); device.unmount();
});

await check('원격 값 선택도 CAS 경합 보호: 더 최신 원격 값에 완료·덮어쓰기 없음', async () => {
  const { server, device } = await conflictDevice(); const hold = server.pauseNext('POST', 'before');
  await device.resolve('remote'); await hold.arrived;
  server.row.state[key]['2030-01-01'].workoutMemo = 'fixture-newest-before-remote-choice';
  hold.release(); await flush(); await device.advance(0);
  assert.equal(device.status, 'conflict');
  assert.equal(server.row.state[key]['2030-01-01'].workoutMemo, 'fixture-newest-before-remote-choice');
  assert.equal(device.read()[key]['2030-01-01'].workoutMemo, 'fixture-local-conflict'); device.unmount();
});

await check('최종 로컬 잠금 검증 대기 중 저장: 오래된 선택 쓰기 차단', async () => {
  const { server, device } = await conflictDevice(); const held = device.holdLocalLock(); await held.arrived;
  const latest = device.read(); latest[key]['2030-01-01'].workoutMemo = 'fixture-queued-newest';
  const write = device.write(latest); await device.resolve('remote');
  held.release(); await write; await flush(); await device.advance(0);
  assert.equal(device.status, 'conflict');
  assert.equal(device.review.conflicts[0].local.value, 'fixture-queued-newest');
  assert.equal(server.requests.filter(request => request.method === 'POST').length, 0); device.unmount();
});

await check('충돌 검토 중 공통 기준으로 되돌림: 빈 선택 화면에 멈추지 않고 즉시 재확인', async () => {
  const { server, device } = await conflictDevice(); await device.write(fixture);
  assert.equal(device.review, null); await device.advance(500);
  assert.equal(device.status, 'synced');
  assert.equal(device.read()[key]['2030-01-01'].workoutMemo, 'fixture-remote-conflict');
  assert.equal(server.requests.filter(request => request.method === 'POST').length, 0); device.unmount();
});

await check('반복되는 독립 타이머 저장: 선택 초기화 안내·안전한 재선택·중단 후 해결', async () => {
  const { server, device } = await conflictDevice();
  for (let count = 1; count <= 3; count++) {
    const stale = device.captureResolution('remote');
    await device.write({ ...device.read(), 'ai-fitness-workout-session-draft:synthetic': { elapsedSeconds: count } });
    assert.equal(device.review, null); await stale(); await device.advance(500);
    assert.equal(device.status, 'conflict'); assert.match(device.message, /저장이 계속되면.*초기화.*입력을 저장하고.*화면을 닫은 뒤/);
    assert.equal(server.requests.filter(request => request.method === 'POST').length, 0);
  }
  await device.resolve('remote'); assert.equal(device.status, 'synced');
  expectState(server.row.state['ai-fitness-workout-session-draft:synthetic'], { elapsedSeconds: 3 }, 'Resolution lost independent newest timer');
  const generation = device.cloud.readCloudSyncRequest('fixture-user', device.cloud.readCloudSyncEpoch()).storageGeneration;
  await device.focus();
  assert.equal(device.cloud.readCloudSyncRequest('fixture-user', device.cloud.readCloudSyncEpoch()).storageGeneration, generation, 'No-op sync rotated generation');
  device.unmount();
});

await check('명시적 선택 저장 중 더 최신 로컬 입력: 새 입력 대기 유지·후속 반영', async () => {
  const { server, device } = await conflictDevice(); const hold = server.pauseNext('POST');
  await device.resolve('local'); await hold.arrived;
  await changeMemo(device, '2030-01-01', 'fixture-after-choice'); hold.release(); await flush();
  assert.equal(device.status, 'pending'); assert.equal(device.read()[key]['2030-01-01'].workoutMemo, 'fixture-after-choice');
  await device.advance(500); assert.equal(device.status, 'synced');
  assert.equal(server.row.state[key]['2030-01-01'].workoutMemo, 'fixture-after-choice'); device.unmount();
});

await check('명시적 선택 응답 유실: 실패 확인 목록과 보존 후 GET 재확인', async () => {
  const { server, device } = await conflictDevice(); server.loseWriteResponse = true;
  await device.resolve('local'); assert.equal(device.status, 'error'); assert.equal(device.syncIssue.phase, 'write');
  assert.ok(device.pendingKeys.includes(key));
  assert.equal(device.read()[key]['2030-01-01'].workoutMemo, 'fixture-local-conflict');
  await device.focus(); assert.equal(device.status, 'synced'); assert.equal(device.syncIssue, null);
  assert.equal(server.requests.filter(request => request.method === 'POST').length, 1); device.unmount();
});

await check('로그아웃 버튼: auth await 전에 충돌값·선택 핸들러 폐기', async () => {
  const { server, device } = await conflictDevice(); const stale = device.captureResolution('local');
  device.signOut(); assert.equal(device.review, null); await stale(); await flush();
  assert.equal(server.requests.filter(request => request.method === 'POST').length, 0);
  assert.equal(server.row.state[key]['2030-01-01'].workoutMemo, 'fixture-remote-conflict'); device.unmount();
});

await check('공통 기준 없는 첫 동기화: 같은 필드 덮어쓰기 대신 명시적 선택', async () => {
  const server = new FakeServer(); const local = copy(fixture); local[key]['2030-01-01'].workoutMemo = 'fixture-first-device';
  const device = await createDevice(server, local); await device.mount();
  assert.equal(device.status, 'conflict'); assert.equal(device.review.request.base, null);
  assert.equal(server.requests.filter(request => request.method === 'POST').length, 0);
  expectState(device.read(), local, 'Initial conflict lost local original'); expectState(server.row.state, fixture, 'Initial conflict overwrote server'); device.unmount();
});

await check('이전에 확인한 원격 행 삭제: 자동 재생성 없이 로컬 보존·오류 안내', async () => {
  const server = new FakeServer(); const device = await createDevice(server); await device.mount(); server.row = null;
  await device.focus(); assert.equal(device.status, 'error'); assert.match(device.message, /자동으로 다시 만들지/);
  expectState(device.read(), fixture, 'Missing server row cleared local originals');
  assert.equal(server.row, null); assert.equal(server.requests.filter(request => request.method === 'POST').length, 0); device.unmount();
});

await check('미확정 조회 실패 목록: 저장 실패로 단정하지 않고 pending과 분리', async () => {
  const server = new FakeServer(); const device = await createDevice(server); await device.mount();
  server.failRead = true; await device.focus();
  assert.equal(device.syncIssue.phase, 'read'); assert.equal(device.pendingKeys.length, 0);
  assert.match(device.syncIssue.message, /저장 여부를 판단하지/);
  assert.equal(server.requests.filter(request => request.method === 'POST').length, 0); device.unmount();
});

await check('지원되는 레거시 JSON 기록맵: 충돌 없이 원본 보존·원시 CAS 후 정규화', async () => {
  const generic = 'ai-fitness-synthetic-opaque-string';
  const expected = { ...copy(fixture), [generic]: '{"synthetic":"ordinary string"}' };
  const encoded = { ...copy(expected), [key]: JSON.stringify(expected[key]) };
  const server = new FakeServer(encoded), device = await createDevice(server, fixture); await device.mount();
  assert.equal(device.status, 'synced'); assert.equal(device.review, null);
  expectState(device.read(), expected, 'Legacy normalization lost original fields or changed an unknown string');
  expectState(server.row.state, expected, 'Legacy normalization did not publish the canonical map');
  const writes = server.requests.filter(request => request.method === 'POST'); assert.equal(writes.length, 1);
  const rawExpected = writes[0].filters.find(([name]) => name === 'state')[1];
  assert.equal(typeof rawExpected[key], 'string', 'CAS did not retain the exact raw server representation');
  assert.equal(typeof writes[0].payload.state[key], 'object');
  device.unmount();
});

await check('손상된 레거시 기록맵: 자동 덮어쓰기·거짓 완료 없이 기기·기준 보존', async () => {
  const server = new FakeServer(), device = await createDevice(server); await device.mount();
  const base = copy(device.cloud.readSyncBase('fixture-user'));
  server.row.state[key] = '{synthetic malformed record map';
  await device.focus(); assert.equal(device.status, 'error');
  expectState(device.read(), fixture, 'Malformed remote erased device records');
  expectState(device.cloud.readSyncBase('fixture-user'), base, 'Malformed remote advanced base');
  assert.equal(server.requests.filter(request => request.method === 'POST').length, 0); device.unmount();
});

await check('원격 행 없는 첫 저장의 지원 레거시 로컬맵: null/null CAS로 정규화 저장', async () => {
  const server = new FakeServer(); server.row = null;
  const seed = { ...copy(fixture), [key]: JSON.stringify(JSON.stringify(fixture[key])) };
  const device = await createDevice(server, seed);
  assert.equal(typeof device.read()[key], 'string', 'Fixture must begin with a local wrapped map');
  await device.mount(); assert.equal(device.status, 'synced');
  expectState(device.read(), fixture, 'First insert did not leave a readable canonical local map');
  expectState(server.row.state, fixture, 'First insert did not preserve all original records');
  expectState(device.cloud.readSyncBase('fixture-user'), fixture, 'First insert acknowledged another payload');
  const writes = server.requests.filter(request => request.method === 'POST'); assert.equal(writes.length, 1);
  assert.equal(writes[0].filters.find(([name]) => name === 'state')[1], null);
  assert.equal(writes[0].filters.find(([name]) => name === 'updated_at')[1], null); device.unmount();
});

await check('원격 행 없는 첫 저장의 손상 로컬맵: POST 전 실패·원본 보존', async () => {
  const server = new FakeServer(); server.row = null;
  const seed = { ...copy(fixture), [key]: '{synthetic broken local map' };
  const device = await createDevice(server, seed), originalLocal = device.read();
  await device.mount(); assert.equal(device.status, 'error');
  expectState(device.read(), originalLocal, 'Malformed first-save local map was changed');
  assert.equal(server.row, null); assert.equal(server.requests.filter(request => request.method === 'POST').length, 0); device.unmount();
});

await check('화면 동기화 소유자: 루트에 하나, 운동·식단 페이지에는 없음', async () => {
  assert.match(readFileSync(resolve(root, 'app/layout.tsx'), 'utf8'), /<CloudSyncPanel\b/);
  for (const page of ['app/fitness/page.tsx', 'app/diet/page.tsx']) {
    assert.doesNotMatch(readFileSync(resolve(root, page), 'utf8'), /<CloudSyncPanel\b/);
  }
});

console.log(JSON.stringify({
  scope: 'Actual calendar save functions, root auth/sync effects and storage/merge/query modules; mocked auth events, getUser results, server and clock. React effect commits are driven explicitly; no browser, React renderer, real authentication, HTTP, account or DB access.',
  results: cases,
  passed: cases.filter(item => item.result === 'PASS').length,
  failed: cases.filter(item => item.result === 'FAIL').length,
}, null, 2));
process.exitCode = cases.some(item => item.result === 'FAIL') ? 1 : 0;
