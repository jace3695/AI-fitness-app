import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { mergeBodyFields } from '../app/lib/bodyImport.ts';
import { recoverStorageTransaction, writeStorageBatch } from '../app/data/storageTransaction.ts';

function fixture() {
  const weights = { today: { weight: 80, recordedAt: 'old' }, other: { weight: 79, recordedAt: 'keep' } };
  const inbody = { today: { bmi: 24, memo: 'old', futureMetric: 7 }, other: { memo: 'keep' } };
  const initial = { weights: JSON.stringify(weights), inbody: JSON.stringify(inbody) };
  const data = new Map(Object.entries(initial));
  const state = { failSecond: false, failRollback: false, published: 0, notified: 0, dirty: true, message: '', cleared: false };
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    removeItem: (key: string) => { data.delete(key); },
    setItem: (key: string, value: string) => {
      if (state.failSecond && key === 'inbody' && value !== initial.inbody) throw Error('synthetic second write');
      if (state.failRollback && key === 'weights' && value === initial.weights) throw Error('synthetic rollback');
      data.set(key, value);
    },
  };
  const form = { weight: '78.2', bmi: '23', memo: 'edited' };
  const context = {
    window: { localStorage: storage, confirm: () => true }, form, weights, inbody, dateKey: 'today',
    currentWeight: weights.today, currentInbody: inbody.today, hasRecord: true,
    inbodyFields: [{ key: 'bmi', label: 'BMI' }], mergeBodyFields, writeStorageBatch,
    WEIGHT_RECORDS_KEY: 'weights', INBODY_RECORDS_KEY: 'inbody',
    writeJson: (key: string, value: unknown) => storage.setItem(key, JSON.stringify(value)),
    notifyRecordsChanged: () => { state.notified++; },
    manualEdit: { current: { dirty: true } }, setManualDirty: (value: boolean) => { state.dirty = value; },
    onChange: () => { state.published++; }, setRecordMessage: (value: string) => { state.message = value; },
    setForm: () => { state.cleared = true; },
  };
  const source = readFileSync(new URL('../app/components/BodyRecordCard.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  const save ='); const end = source.indexOf('  const importOaReport', start);
  assert.ok(start >= 0 && end > start);
  const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const handlers = vm.runInNewContext(code + '\n({save, remove})', context) as { save: () => void; remove: () => void };
  return { state, storage, data, initial, form, ...handlers };
}

for (const action of ['save', 'remove'] as const) {
  test(`${action}: second write failure restores both existing stores and preserves draft`, () => {
    const f = fixture(); f.state.failSecond = true;
    let thrown: unknown;
    try { f[action](); } catch (error) { thrown = error; }
    assert.deepEqual(Object.fromEntries(f.data), f.initial);
    assert.equal(thrown, undefined);
    assert.equal(f.state.published, 0); assert.equal(f.state.notified, 0);
    assert.equal(f.state.dirty, true); assert.equal(f.state.cleared, false);
    assert.equal(f.form.memo, 'edited'); assert.match(f.state.message, /못했/);
  });
  test(`${action}: rollback failure retains recovery journal and explicit retry recovers before commit`, () => {
    const f = fixture(); f.state.failSecond = true; f.state.failRollback = true;
    assert.doesNotThrow(() => f[action]());
    assert.deepEqual(JSON.parse(f.data.get('yeoni-storage-transaction-v1')!), f.initial);
    assert.equal(f.state.published, 0); assert.equal(f.state.dirty, true);
    assert.doesNotThrow(() => f[action]()); assert.equal(f.state.published, 0);
    f.state.failSecond = false; f.state.failRollback = false;
    recoverStorageTransaction(f.storage); assert.deepEqual(Object.fromEntries(f.data), f.initial);
    f[action](); assert.equal(f.data.has('yeoni-storage-transaction-v1'), false);
    assert.equal(f.state.published, 1); assert.equal(f.state.notified, 1); assert.equal(f.state.dirty, false);
    const weights = JSON.parse(f.data.get('weights')!); const inbody = JSON.parse(f.data.get('inbody')!);
    assert.equal(weights.other.weight, 79); assert.equal(inbody.other.memo, 'keep');
    if (action === 'save') {
      assert.equal(weights.today.weight, 78.2); assert.equal(inbody.today.memo, 'edited'); assert.equal(inbody.today.futureMetric, 7);
    } else { assert.equal(weights.today, undefined); assert.equal(inbody.today, undefined); }
  });
  test(`${action}: handler retry alone recovers an interrupted rollback before writing`, () => {
    const f = fixture(); f.state.failSecond = true; f.state.failRollback = true;
    f[action](); assert.equal(f.data.has('yeoni-storage-transaction-v1'), true);
    f.state.failSecond = false; f.state.failRollback = false;
    f[action]();
    assert.equal(f.data.has('yeoni-storage-transaction-v1'), false);
    assert.equal(f.state.published, 1); assert.equal(f.state.notified, 1);
    assert.equal(JSON.parse(f.data.get('inbody')!).other.memo, 'keep');
    assert.equal(JSON.parse(f.data.get('weights')!).other.weight, 79);
  });
}
