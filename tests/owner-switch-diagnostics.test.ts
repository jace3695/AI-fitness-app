import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { failureLabel } from './e2e/navigation-diagnostics.ts';
import { projectStateDiagnostic } from '../scripts/qa-state-diagnostics.mjs';
import * as transactions from '../app/data/storageTransaction.ts';

const source = readFileSync(new URL('./e2e/owner-switch-diagnostics.ts', import.meta.url), 'utf8');
function fixture(owner: 'A' | 'B' | null = 'A') {
  const ownerA = 'PRIVATE_OWNER_A', ownerB = 'PRIVATE_OWNER_B', messages: string[] = [];
  const stateA = { 'ai-fitness-daily-notes': { '2001-01-02': 'PRIVATE_RECORD_A' } };
  const stateB = { 'ai-fitness-daily-notes': { '2001-01-02': 'PRIVATE_RECORD_B' } };
  const id = owner === 'A' ? ownerA : owner === 'B' ? ownerB : null;
  const epoch = JSON.stringify({ userId: id, id: 'PRIVATE_EPOCH' });
  const values: Record<string, string> = {
    'fitness-cloud-sync-epoch': epoch,
    'fitness-cloud-sync-ready': JSON.stringify({ userId: id, epoch }),
    'yeoni-storage-transaction-v2': JSON.stringify({ state: 'committed', transactionId: 'PRIVATE_TRANSACTION' }),
    ...(id ? { 'fitness-cloud-sync-user': id } : {}),
    ...(owner ? { 'ai-fitness-daily-notes': JSON.stringify((owner === 'A' ? stateA : stateB)['ai-fitness-daily-notes']) } : {}),
  };
  Object.defineProperty(values, 'getItem', { value: (key: string) => values[key] ?? null });
  const env = { sync: '서버 반영 완료', hidden: false, authFailed: false, input: owner !== null };
  const exports: Record<string, unknown> = {};
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(`(function(exports, require) { ${compiled}\n})`, {
    Error,
    console: { log(message: string) { messages.push(message); } },
    localStorage: values,
    navigator: { locks: { async query() { return { held: [{ name: 'yeoni-shared-local-storage-v2' }, { name: 'PRIVATE_OTHER_LOCK' }], pending: [{ name: 'yeoni-shared-local-storage-v2' }] }; } } },
    document: {
      visibilityState: 'visible',
      body: { get textContent() { return 'PRIVATE_EMAIL PRIVATE_DOM ' + (env.authFailed ? '로그인 확인을 완료하지 못했어요 다른 창에서 로그인 상태가 변경되었습니다' : ''); } },
      querySelectorAll: () => [{ textContent: env.sync }, { textContent: 'PRIVATE_EMAIL' }],
      querySelector: (selector: string) => selector === '#diet-hunger' ? env.input ? { closest: () => env.hidden ? {} : null } : null : !env.input ? {} : null,
    },
  })(exports, (name: string) => {
    if (name === '../../app/data/storageTransaction') return transactions;
    assert.equal(name, './navigation-diagnostics'); return { failureLabel };
  });
  const run = exports.ownerSwitchDiagnostic as (page: unknown, phase: string, refs: unknown, tab?: string, failed?: boolean) => Promise<void>;
  const entries = [{ table: 'user_app_state', method: 'GET', owner: id, status: 200, delivered: true, receivedState: { private: 'PRIVATE_BODY' } }];
  const page = { evaluate: async (read: (args: unknown) => unknown, args: unknown) => read(args) };
  return { env, values, messages, page,
    run: (phase = 'owner-b-ready', failed = false) => run(page, phase, { ownerA, ownerB, stateA, stateB, traffic: { entries } }, 'first', failed),
    result() { assert.equal(messages.length, 1); assert.doesNotMatch(messages[0], /PRIVATE|2001-01-02/); return JSON.parse(messages[0].slice('QA_OWNER_SWITCH_STATE '.length)); },
  };
}

for (const owner of ['A', 'B', null] as const) test(`owner-switch probe compares ${owner ?? 'cleared'} identity and records without exposing them`, async () => {
  const f = fixture(owner); await f.run(); const value = f.result();
  assert.equal(value.owner, owner ?? 'none'); assert.equal(value.desiredOwner, owner ?? 'none'); assert.equal(value.readyOwner, owner ?? 'none');
  assert.equal(value.readyMatchesEpoch, true); assert.equal(value.localMatchesA, owner === 'A'); assert.equal(value.localMatchesB, owner === 'B'); assert.equal(value.localEmpty, owner === null);
  assert.equal(value.lockHeld, 1); assert.equal(value.lockPending, 1); assert.equal(value.reads, 1); assert.equal(value.writes, 0);
  assert.equal(value.protocolState, 'committed'); assert.equal(value.sync, 'synced');
  const forwarded = projectStateDiagnostic(f.messages[0]); assert.ok(forwarded); assert.doesNotMatch(forwarded.line, /PRIVATE/);
});

test('owner-switch probe distinguishes blocked private UI, current owner bytes and a successful last read', async () => {
  const f = fixture('B'); f.env.sync = '기록 동기화 실패'; f.env.authFailed = true; f.env.hidden = true;
  await f.run('owner-b-ready', true); const value = f.result();
  assert.equal(value.failed, true); assert.equal(value.sync, 'error'); assert.equal(value.authGate, 'failed'); assert.equal(value.editorPrivate, true);
  assert.equal(value.owner, 'B'); assert.equal(value.localMatchesB, true); assert.equal(value.lastReadOwner, 'B'); assert.equal(value.lastReadResult, 'ok');
  assert.equal(value.sessionChangedNotice, true);
});

test('owner-switch probe failures preserve original control flow and disclose only a fixed failure category', async () => {
  const f = fixture(); f.page.evaluate = async () => { throw new Error('PRIVATE_BROWSER_MESSAGE timeout'); };
  await f.run('before-b-login', true); const value = f.result();
  assert.deepEqual(value, { phase: 'before-b-login', tab: 'first', failed: true, probe: 'unavailable', failure: 'timeout' });
});

test('owner-switch diagnostics retain real logout, queued write, fresh B login and complete isolation assertions', () => {
  const content = readFileSync(new URL('./e2e/storage-protocol.spec.ts', import.meta.url), 'utf8');
  const scenario = content.slice(content.indexOf("test('queued owner A edit"), content.indexOf("test('legacy v1 recovery"));
  assert.equal((scenario.match(/await login\(page, other, '\/diet'\)/g) ?? []).length, 1);
  assert.match(scenario, /await expectQueued\(holder\)/);
  assert.match(scenario, /name: '로그아웃', exact: true \}\)\.click\(\)/);
  assert.match(scenario, /toBeNull\(\)/); assert.match(scenario, /not\.toBe\(epoch\)/);
  assert.match(scenario, /expect\(await localState\(page\)\)\.toEqual\(\{\}\)/);
  assert.match(scenario, /getItem\('fitness-cloud-sync-user'\)\)\)\.toBe\(other\.id\)/);
  assert.match(scenario, /expect\(await qa\.read\(qa\.account\)\)\.toEqual\(original\)/);
  assert.equal((scenario.match(/expect\(await localState\(page\)\)\.toEqual\(otherState\)/g) ?? []).length, 2);
  assert.match(scenario, /expect\(await qa\.read\(other\)\)\.toEqual\(otherState\)/);
  assert.match(scenario, /toHaveValue\('CI owner B only'\)/);
  assert.match(scenario, /await page\.reload\(\)/); assert.equal((scenario.match(/await synced\(page\)/g) ?? []).length, 3);
  assert.match(scenario, /catch \(error\) \{[\s\S]*?throw error/);
  assert.doesNotMatch(scenario, /waitForTimeout|다시 시도|다시 확인|지금 동기화|\.reload\([\s\S]*?\.reload\(/);
});
