import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeterministicIDBAdapter } from './idb-test-adapter.ts';

test('targeted completion loss matches a committed store mutation, not transaction scope or an aborted write', async () => {
  const adapter = createDeterministicIDBAdapter();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = adapter.factory.open('targeted-fault-contract', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('receipts'); request.result.createObjectStore('delivery'); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const run = (mode: IDBTransactionMode, work: (tx: IDBTransaction) => void) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['receipts', 'delivery'], mode);
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    work(tx);
  });
  try {
    const fault = adapter.loseNextCommitResponseForStoreWrite('receipts');
    assert.throws(() => adapter.loseNextCommitResponseForStoreWrite('receipts'), /already pending/);
    await run('readonly', tx => { tx.objectStore('receipts').get('receipt'); });
    await run('readwrite', tx => { tx.objectStore('receipts').get('receipt'); });
    await run('readwrite', tx => { tx.objectStore('delivery').put('unrelated', 'delivery'); });
    await run('readwrite', tx => { tx.objectStore('receipts').add('different-operation', 'existing'); });
    assert.equal(fault.consumed, 0); assert.deepEqual(fault.committedStores, []);
    adapter.abortNextTransaction();
    await assert.rejects(run('readwrite', tx => { tx.objectStore('receipts').put('rolled-back', 'receipt'); }), { name: 'AbortError' });
    assert.equal(adapter.inspect('receipts', 'receipt'), undefined); assert.equal(fault.consumed, 0);
    await assert.rejects(run('readwrite', tx => {
      tx.objectStore('receipts').put('committed-receipt', 'receipt');
      tx.objectStore('delivery').put('acknowledged', 'delivery');
    }), { name: 'UnknownError' });
    assert.equal(fault.consumed, 1); assert.deepEqual(fault.committedStores, ['delivery', 'receipts']);
    assert.equal(adapter.inspect('receipts', 'receipt'), 'committed-receipt');
    assert.equal(adapter.inspect('delivery', 'delivery'), 'acknowledged');
    await run('readwrite', tx => { tx.objectStore('receipts').put('later-success', 'receipt'); });
    assert.equal(fault.consumed, 1);
  } finally { db.close(); }
});
