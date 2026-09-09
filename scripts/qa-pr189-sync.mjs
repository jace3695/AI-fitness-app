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
  }
  pauseNext(method, phase = 'after') {
    const arrived = deferred();
    const released = deferred();
    this.pauses.push({ method, phase, arrived, released });
    return { arrived: arrived.promise, release: released.resolve };
  }
  async request(method, payload, filters) {
    const request = { method, payload: payload && copy(payload), filters: copy(filters) };
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
      if (expected !== this.row.updated_at) result = { data: null, error: null };
      else {
        this.row = copy(payload);
        result = { data: { updated_at: this.row.updated_at }, error: null };
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
    return {
      from: table => {
        assert.equal(table, 'user_app_state');
        let method = 'GET';
        let payload;
        const filters = [];
        const query = {
          select: () => query,
          update: value => { method = 'PATCH'; payload = value; return query; },
          eq: (name, value) => { filters.push([name, value]); return query; },
          maybeSingle: () => this.request(method, payload, filters),
        };
        return query;
      },
    };
  }
}
// Compile the original module with a strict dependency allowlist in a fresh VM.
// No browser or React renderer is used. The actual synchronization effect is invoked below.
let dateSequence = 0;
function createDevice(server, seed = {}) {
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
  const context = vm.createContext({ window, document, Event, queueMicrotask, Date: FixtureDate });
  const cache = new Map();
  const allowed = new Set(['app/data/cloudSync.ts', 'app/data/appRecordReset.ts', 'app/data/storageTransaction.ts']);
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
  const reset = load('app/data/appRecordReset.ts');
  const events = load('app/data/storageTransaction.ts');
  const panelPath = 'app/components/CloudSyncPanel.tsx';
  const source = readFileSync(resolve(root, panelPath), 'utf8');
  const ast = ts.createSourceFile(panelPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const effects = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' &&
        node.arguments[1]?.getText(ast) === '[syncRequest, user]') effects.push(node.arguments[0].getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(effects.length, 1, 'The sync effect moved; update this diagnostic adapter.');
  const effect = ts.transpileModule(`(${effects[0]})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  let status = 'idle';
  let message = '';
  const refs = { lastSynced: { current: '' }, syncing: { current: false } };
  Object.assign(context, cloud, reset, events, refs, {
    user: { id: 'fixture-user' }, supabase: client,
    setStatus: value => { status = value; }, setMessage: value => { message = value; },
    setLastSyncedAt: () => {}, requestSafeReload: window.location.reload,
  });
  function write(state) {
    for (const name of [...storage.values.keys()]) if (name.startsWith('ai-fitness-')) storage.removeItem(name);
    for (const [name, value] of Object.entries(state)) storage.setItem(name, JSON.stringify(value));
    events.notifyRecordsChanged();
  }
  write(seed);
  let cleanup;
  return {
    cloud, window, storage,
    read: () => copy(cloud.readLocalCloudState()), write,
    saveFromCalendarSnapshot: workouts => {
      // The component's one-time record read is supplied explicitly; no React mount is simulated.
      Object.assign(context, {
        stores: { workouts: copy(workouts) }, selected: '2030-02-02', todayKey: '2030-02-09',
        exerciseRecordsDraft: [{ exerciseName: 'fixture-exercise', status: 'completed', sets: [{ setNumber: 1, completed: true, reps: 8 }] }],
        selectedWorkoutRecord: undefined, workoutStatusDraft: 'partial',
        backFeedback: { workoutPain: false, workoutNeurologicalSymptoms: [] },
        workoutMemoDraft: 'fixture-new', workoutDifficultyDraft: undefined, workoutFatigueDraft: undefined,
        WORKOUT_COMPLETED_DAYS_KEY: key,
        setStores: value => { context.stores = value; }, setEditingWorkout: () => {}, setWorkoutNotice: () => {},
      });
      context.writeJson = vm.runInContext(originalFunction('app/data/recordStorage.ts', 'writeJson'), context);
      context.writeWorkoutStore = vm.runInContext(originalFunction('app/components/RecordCalendarView.tsx', 'writeWorkoutStore'), context);
      vm.runInContext(originalFunction('app/components/RecordCalendarView.tsx', 'saveNewWorkoutRecord'), context)();
    },
    get status() { return status; }, get message() { return message; },
    get waitingTimers() { return timers.size; },
    mount: async () => { cleanup = vm.runInContext(effect, context)(); await flush(); },
    unmount: () => { cleanup?.(); },
    focus: async () => { window.dispatchEvent(new Event('focus')); await flush(); },
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
function changeMemo(device, date, memo) {
  const state = device.read();
  state[key][date] = { ...state[key][date], workoutMemo: memo };
  device.write(state);
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

await check('GET 중 첫 로컬 저장: 서버 원본 4일과 새 날짜 병합', async () => {
  const server = new FakeServer();
  const pause = server.pauseNext('GET');
  const device = createDevice(server);
  await device.mount();
  await pause.arrived;
  const added = { workoutDone: false, workoutStatus: 'partial', workoutMemo: 'fixture-new' };
  device.write({ [key]: { '2030-02-02': added } });
  pause.release(); await flush();
  const expected = copy(fixture); expected[key]['2030-02-02'] = added;
  expectState(device.read(), expected, 'Initial merge lost records');
  expectState(server.row.state, expected, 'Server merge lost records');
  device.unmount();
});

await check('PATCH 응답 대기 중 수정: 늦은 응답 이후 후속 저장', async () => {
  const server = new FakeServer(); const device = createDevice(server);
  await device.mount();
  const pause = server.pauseNext('PATCH');
  changeMemo(device, '2030-01-01', 'fixture-first'); await flush(); await device.advance(500); await pause.arrived;
  const expected = changeMemo(device, '2030-01-01', 'fixture-later');
  pause.release(); await flush();
  assert.equal(device.status, 'pending');
  expectState(device.read(), expected, 'Late response erased local edit');
  await device.advance(500);
  expectState(server.row.state, expected, 'Follow-up did not persist local edit');
  assert.equal(device.status, 'synced'); device.unmount();
});

await check('PATCH 응답 대기 중 삭제: 후속 저장과 새 세션에서 재등장 없음', async () => {
  const server = new FakeServer(); const device = createDevice(server);
  await device.mount();
  const pause = server.pauseNext('PATCH');
  changeMemo(device, '2030-01-01', 'fixture-before-delete'); await flush(); await device.advance(500); await pause.arrived;
  const expected = device.read(); delete expected[key]['2030-01-01']; device.write(expected);
  pause.release(); await flush(); await device.advance(500);
  expectState(server.row.state, expected, 'Deleted date resurrected');
  device.unmount();
  const fresh = createDevice(server); await fresh.mount();
  expectState(fresh.read(), expected, 'New device resurrected date'); fresh.unmount();
});

await check('독립 저장소 2개: 동시 수정 충돌 후 재시도로 양쪽 변경 보존', async () => {
  const server = new FakeServer(); const a = createDevice(server); const b = createDevice(server);
  await a.mount(); await b.mount();
  const pause = server.pauseNext('PATCH', 'before');
  changeMemo(a, '2030-01-01', 'fixture-a'); await flush(); await a.advance(500); await pause.arrived;
  changeMemo(b, '2030-01-02', 'fixture-b'); await flush(); await b.advance(500);
  pause.release(); await flush();
  assert.equal(a.status, 'error', 'Lost CAS should be visible');
  await a.focus(); await b.focus();
  const expected = copy(fixture); expected[key]['2030-01-01'].workoutMemo = 'fixture-a'; expected[key]['2030-01-02'].workoutMemo = 'fixture-b';
  expectState(server.row.state, expected, 'Conflict retry discarded a device change');
  expectState(a.read(), expected, 'Device A not converged'); expectState(b.read(), expected, 'Device B not converged');
  a.unmount(); b.unmount();
});

await check('서버 반영 후 응답 유실: 오류 표시·재접속 재조회로 중복 없이 복구', async () => {
  const server = new FakeServer(); const device = createDevice(server); await device.mount();
  server.loseWriteResponse = true;
  const expected = changeMemo(device, '2030-01-01', 'fixture-lost-response'); await flush(); await device.advance(500);
  assert.equal(device.status, 'error'); expectState(device.read(), expected, 'Response loss erased local record');
  device.unmount();
  const restarted = createDevice(server, device.read()); await restarted.mount();
  expectState(server.row.state, expected, 'Retry duplicated or lost record'); expectState(restarted.read(), expected, 'Reconnect failed');
  assert.equal(restarted.status, 'synced');
  assert.equal(server.requests.filter(request => request.method === 'PATCH').length, 1, 'Reconnect resubmitted already committed state');
  restarted.unmount();
});

await check('조회 실패: 기존 기록 유지·오류 표시·포커스 재시도', async () => {
  const server = new FakeServer(); const device = createDevice(server); await device.mount();
  server.failRead = true;
  await device.focus();
  assert.equal(device.status, 'error'); assert.ok(device.message.trim(), 'Read error must have a user-facing message');
  expectState(device.read(), fixture, 'Read failure erased records');
  assert.equal(server.requests.filter(request => request.method === 'PATCH').length, 0, 'Read failure triggered a write');
  await device.focus(); assert.equal(device.status, 'synced');
  expectState(device.read(), fixture, 'Retry changed records'); device.unmount();
});

await check('달력의 동기화 전 스냅샷으로 첫 저장: 원본 4일 보존', async () => {
  const server = new FakeServer(); const device = createDevice(server);
  const pause = server.pauseNext('GET'); await device.mount(); await pause.arrived;
  const calendarSnapshot = device.read()[key] ?? {};
  pause.release(); await flush();
  expectState(device.read(), fixture, 'Initial sync did not load fixture originals');
  device.saveFromCalendarSnapshot(calendarSnapshot); await flush(); await device.advance(500);
  const saved = copy(server.row.state); device.unmount();
  expectState(saved[settingsKey], fixture[settingsKey], 'Settings changed');
  assert.equal(Object.keys(saved[key]).length, 5, 'Expected original 4 dates plus the new date after calendar save');
  for (const [date, record] of Object.entries(fixture[key])) expectState(saved[key][date], record, 'Original date changed');
});

await check('대조군: 최신 스냅샷으로 같은 달력 저장을 실행하면 원본 4일 보존', async () => {
  const server = new FakeServer(); const device = createDevice(server); await device.mount();
  device.saveFromCalendarSnapshot(device.read()[key]); await flush(); await device.advance(500);
  const saved = copy(server.row.state); device.unmount();
  expectState(saved[settingsKey], fixture[settingsKey], 'Settings changed');
  assert.equal(Object.keys(saved[key]).length, 5);
  for (const [date, record] of Object.entries(fixture[key])) expectState(saved[key][date], record, 'Original date changed');
});

await check('삭제 직후 화면 이탈: 동기화 컴포넌트가 없어도 서버 삭제 완료', async () => {
  const server = new FakeServer(); const device = createDevice(server); await device.mount();
  const expected = device.read(); delete expected[key]['2030-01-01']; device.write(expected); await flush();
  assert.equal(device.status, 'pending'); device.unmount();
  await device.advance(60000);
  expectState(device.read(), expected, 'Local deletion was lost');
  expectState(server.row.state, expected, 'Deletion remains only on device after unmount');
});

await check('PATCH 도중 추가 수정 후 화면 이탈: 추가 수정까지 서버 반영', async () => {
  const server = new FakeServer(); const device = createDevice(server); await device.mount();
  const pause = server.pauseNext('PATCH');
  changeMemo(device, '2030-01-01', 'fixture-first'); await flush(); await device.advance(500); await pause.arrived;
  const expected = changeMemo(device, '2030-01-01', 'fixture-later'); await flush();
  device.unmount(); pause.release(); await flush(); await device.advance(60000);
  expectState(device.read(), expected, 'Local later edit was lost');
  expectState(server.row.state, expected, 'Later edit remains only on device after unmount');
});

console.log(JSON.stringify({
  scope: 'Actual calendar save functions, sync effect and storage/merge/query modules; mocked server, events and clock. No browser, React renderer, real authentication, HTTP, account or DB access.',
  results: cases,
  passed: cases.filter(item => item.result === 'PASS').length,
  failed: cases.filter(item => item.result === 'FAIL').length,
}, null, 2));
process.exitCode = cases.some(item => item.result === 'FAIL') ? 1 : 0;
