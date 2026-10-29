import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSpeechRetentionMaintenancePurge, SPEECH_RETENTION_MAINTENANCE_SQL} from './speech-retention-maintenance.ts';
import {createSpeechRetentionCleanupRunner} from './speech-retention-cleanup.ts';
const policyHash = 'a'.repeat(64);
const signal = () => new AbortController().signal;
const rows = (deletedRows = 1) => [{result: {policyHash, deletedRows}}];
const sanitized = (error: unknown) => error instanceof Error && error.message === 'Cleanup maintenance unconfirmed' && !('cause' in error);

test('unconfigured factory creates no client and cannot execute with missing or malformed hash', async () => {
  let calls = 0;
  await assert.rejects(createSpeechRetentionMaintenancePurge()(signal()), sanitized);
  for (const bad of [null, '', 'not-a-hash', 'A'.repeat(64), 'a'.repeat(63)]) {
    const purge = createSpeechRetentionMaintenancePurge(bad, async () => { calls++; return rows(); });
    assert.equal(calls, 0); await assert.rejects(purge(signal()), sanitized);
  }
  assert.equal(calls, 0);
});
test('one explicit invocation uses only fixed SQL, one immutable hash bind and the original abort signal', async () => {
  for (const count of [0, 1]) {
    let calls = 0; const original = signal();
    const purge = createSpeechRetentionMaintenancePurge(policyHash, async (sql, values, received) => {
      calls++; assert.equal(sql, 'select yeoni_speech_retention_candidate.maintenance($1::text) as result');
      assert.equal(sql, SPEECH_RETENTION_MAINTENANCE_SQL); assert.deepEqual(values, [policyHash]);
      assert.equal(Object.isFrozen(values), true); assert.equal(received, original); return rows(count);
    });
    const result = await purge(original); assert.deepEqual(result, {policyHash, deletedRows: count}); assert.equal(Object.isFrozen(result), true); assert.equal(calls, 1);
  }
});
test('wrong row count, extra fields, null/foreign heartbeat or invalid count cannot imply success', async () => {
  const bad = [null, {}, [], [...rows(), ...rows()], [null], [{result: null}], [{result: {policyHash, deletedRows: 1}, owner: 'private'}],
    [{result: {policyHash: null, deletedRows: 1}}], [{result: {policyHash: 'b'.repeat(64), deletedRows: 1}}],
    [{result: {policyHash, deletedRows: 1, owner: 'private'}}], [{result: {policyHash, deletedRows: '1'}}],
    ...[-1, 2, 0.5, NaN, Infinity].map(deletedRows => [{result: {policyHash, deletedRows}}])];
  for (const value of bad) { let calls = 0; await assert.rejects(createSpeechRetentionMaintenancePurge(policyHash, async () => { calls++; return value; })(signal()), sanitized); assert.equal(calls, 1); }
});
test('pre-abort makes no call; post-abort late completion cannot return a healthy receipt or retry', async () => {
  let calls = 0, release!: (value: unknown) => void;
  const before = new AbortController(); before.abort('private-abort-reason');
  const purge = createSpeechRetentionMaintenancePurge(policyHash, async () => { calls++; return new Promise(r => { release = r; }); });
  await assert.rejects(purge(before.signal), sanitized); assert.equal(calls, 0);
  const during = new AbortController(), pending = purge(during.signal); during.abort('private-abort-reason');
  release(rows()); await assert.rejects(pending, sanitized); assert.equal(calls, 1);
});
test('driver exceptions and non-data result properties are contained without diagnostic leakage', async () => {
  await assert.rejects(createSpeechRetentionMaintenancePurge(policyHash, async () => { throw Error('private-key-owner-audio'); })(signal()), sanitized);
  let accessed = false;
  const value = {get result() { accessed = true; throw Error('private-result'); }};
  await assert.rejects(createSpeechRetentionMaintenancePurge(policyHash, async () => [value])(signal()), sanitized); assert.equal(accessed, false);
  const withSymbol = {policyHash, deletedRows: 1, [Symbol('private')]: 'private'};
  await assert.rejects(createSpeechRetentionMaintenancePurge(policyHash, async () => [{result: withSymbol}])(signal()), sanitized);
});
test('bridge can be injected into the unscheduled runner; null heartbeat closes health even when purge may have committed', async () => {
  for (const confirmed of [true, false]) {
    let calls = 0;
    const purge = createSpeechRetentionMaintenancePurge(policyHash, async () => { calls++; return [{result: {policyHash: confirmed ? policyHash : null, deletedRows: 1}}]; });
    const runner = createSpeechRetentionCleanupRunner({policyHash, intervalSeconds: 10, startDelaySeconds: 2, runTimeoutSeconds: 3}, {
      clock: () => ({wallTimeMs: 100000, monotonicTimeMs: 50000}), purge,
      timers: {setTimeout: () => 1, clearTimeout() {}},
    });
    const result = await runner.tick(100000); assert.equal(result.healthy, confirmed); assert.equal(calls, 1);
    if (!confirmed) assert.equal(result.reason, 'purge-failed'); runner.dispose();
  }
});
