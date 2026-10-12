import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { projectResetRecoveryDiagnostic as project, resetRecoveryAnnotation as annotation, RESET_DIAGNOSTIC_TYPE as type } from '../scripts/legacy-evidence-reset-diagnostics.mjs';
import { expectedCases, projectExecution, emitExecutionDiagnostics } from '../scripts/qa-legacy-evidence-browser.mjs';
const sample = () => ({ navigations: 1, panels: 2, visiblePanels: 1, notices: 1, visibleNotices: 0,
  receiptPresent: false, busyVisible: false, uncertainVisible: false, cleanupErrorVisible: false });
const wrap = (value: unknown) => [{ type, description: JSON.stringify(value) }];

test('reset diagnostics admit only exact bounded facts and reconstruct fresh output', () => {
  const value = sample(); assert.deepEqual(project(value), value); assert.notEqual(project(value), value);
  assert.deepEqual(annotation(wrap(value)), value);
  for (const key of Object.keys(value)) {
    const missing = { ...value }; delete missing[key as keyof typeof missing]; assert.equal(project(missing), undefined);
    assert.equal(project({ ...value, [key]: 'SENTINEL_SECRET' }), undefined);
  }
  for (const count of [-1, 9, Infinity, NaN, 1.5, '1', null]) assert.equal(project({ ...value, navigations: count }), undefined);
  assert.equal(project({ ...value, visibleNotices: 2 }), undefined);
  for (const extra of ['owner', 'requestId', 'storage', 'error', 'toJSON']) assert.equal(project({ ...value, [extra]: 'SENTINEL_SECRET' }), undefined);
  assert.equal(project({ ...value, [Symbol('secret')]: true }), undefined);
});

test('hostile facts and annotation envelopes never invoke getters, proxies, coercions or toJSON', () => {
  let invoked = 0;
  const trap = () => { invoked++; throw new Error('SENTINEL_SECRET'); };
  const getter = Object.defineProperty(sample(), 'receiptPresent', { get: trap });
  const proxy = new Proxy(sample(), { ownKeys: trap, get: trap, getOwnPropertyDescriptor: trap });
  const revoked = Proxy.revocable(sample(), {}); revoked.revoke();
  for (const value of [getter, proxy, revoked.proxy, { ...sample(), toJSON: trap }, null, [], 'secret']) assert.equal(project(value), undefined);
  const rows = wrap(sample());
  const hostileArrays = [new Proxy(rows, { get: trap, ownKeys: trap }), Object.defineProperty([...rows], '0', { get: trap }),
    Object.assign([...rows], { toJSON: trap }), Object.defineProperty([...rows], 'extra', { get: trap }), new Array(1), new Array(33)];
  for (const value of hostileArrays) assert.equal(annotation(value), undefined);
  assert.equal(annotation([new Proxy(rows[0], { get: trap, ownKeys: trap })]), undefined);
  assert.equal(annotation([Object.defineProperty({ type }, 'description', { get: trap })]), undefined);
  assert.equal(annotation([{ ...rows[0], secret: 'SENTINEL_SECRET' }]), undefined);
  assert.equal(annotation([...rows, ...rows]), undefined);
  assert.equal(annotation([{ type, description: '{' }]), undefined);
  assert.equal(annotation([{ type, description: ' '.repeat(1025) }]), undefined);
  assert.equal(invoked, 0);
});

test('only a failed canonical enabled E10 can publish validated reset observations', () => {
  const commit = 'a'.repeat(40);
  for (const phase of ['inactive', 'enabled']) {
    const raw = { commit, status: 'failed', results: expectedCases(phase).map(row => ({
      title: `${row.project} / ${row.file} / ${row.title}`, status: 'failed', durationMs: 1,
      resetRecovery: sample(), failure: { errors: [], steps: [] },
    })) };
    const lines: string[] = [];
    emitExecutionDiagnostics(raw, projectExecution(raw, phase, commit), phase, (line: string) => lines.push(line));
    const records = lines.map(line => JSON.parse(line.slice('[legacy-evidence-b2-detail] '.length)));
    const observed = records.filter(row => row.resetRecovery);
    assert.equal(observed.length, phase === 'enabled' ? 2 : 0);
    for (const row of observed) { assert.equal(row.case, 'E10'); assert.deepEqual(row.resetRecovery, sample()); }
    raw.results.forEach(row => { row.status = 'passed'; });
    const passed: string[] = [];
    emitExecutionDiagnostics(raw, projectExecution(raw, phase, commit), phase, (line: string) => passed.push(line));
    assert.ok(passed.every(line => !line.includes('resetRecovery')));
    raw.results.forEach(row => { row.status = 'failed'; row.resetRecovery = { ...sample(), secret: 'SENTINEL_SECRET' } as ReturnType<typeof sample>; });
    const rejected: string[] = [];
    emitExecutionDiagnostics(raw, projectExecution(raw, phase, commit), phase, (line: string) => rejected.push(line));
    assert.ok(rejected.every(line => !line.includes('resetRecovery') && !line.includes('SENTINEL_SECRET')));
  }
});

test('E10 observes only after original failure and preserves assertion, original error and navigation cleanup', () => {
  const source = readFileSync(new URL('./e2e/legacy-evidence-review.spec.ts', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf("test('E10 "), source.indexOf("test('E11 "));
  const assertion = "await expect(settings.getByText('일본어 기록을 초기화했어요. 유지되는 항목은 아래에서 확인해 주세요.', { exact: true })).toBeVisible();";
  assert.equal(body.split(assertion).length, 2);
  assert.ok(body.indexOf(assertion) < body.indexOf('catch (originalError)'));
  assert.ok(body.indexOf('catch (originalError)') < body.indexOf('const snapshot ='));
  assert.match(body, /throw originalError;/);
  assert.match(body, /finally \{ settings.off\('framenavigated', observeRecoveryNavigation\); \}/);
  const diagnostic = body.slice(body.indexOf('let recoveryNavigations'), body.indexOf('expect(traffic.count(rpc.reset))'));
  assert.doesNotMatch(diagnostic, /getUser|\.rpc\(|waitForTimeout|setTimeout|dispatchEvent|JSON\.parse|localStorage|\.reload\(/);
  assert.match(diagnostic, /sessionStorage\.getItem\(`record-reset-receipt:\$\{owner\}:language`\) !== null/);
  const reporter = readFileSync(new URL('./e2e/reporter.ts', import.meta.url), 'utf8');
  assert.match(reporter, /failure && test\.title === 'E10 required reset retires scoped evidence @b2-enabled'/);
  assert.match(reporter, /resetRecoveryAnnotation\(result.annotations\)/);
});
