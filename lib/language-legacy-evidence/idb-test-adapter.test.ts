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

function open(factory: IDBFactory, name: string, version: number,
  upgrade?: (request: IDBOpenDBRequest, event: IDBVersionChangeEvent) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version);
    request.onupgradeneeded = event => upgrade?.(request, event);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new DOMException('Blocked test open.', 'BlockedError'));
  });
}
async function legacyFixture() {
  const adapter = createDeterministicIDBAdapter(), name = 'upgrade-contract';
  const db = await open(adapter.factory, name, 1, request => {
    const store = request.result.createObjectStore('legacy');
    store.createIndex('semanticKey', 'semanticKey', { unique: true });
    store.put({ semanticKey: 'first', canonical: '{"exact":"旧\\u0000"}' }, 'a');
    store.put({ semanticKey: 'second', canonical: '{"exact":"old-two"}' }, 'b');
  });
  db.close();
  return { adapter, name, before: adapter.entries('legacy') };
}

test('upgrade queues existing-store get/cursor reads, including callback-enqueued requests, before publication', async () => {
  const { adapter, name, before } = await legacyFixture();
  const order: string[] = [];
  const db = await open(adapter.factory, name, 2, (request, event) => {
    assert.equal(event.oldVersion, 1); assert.equal(event.newVersion, 2);
    const tx = request.transaction!, store = tx.objectStore('legacy');
    assert.equal(tx.mode, 'versionchange'); assert.equal(tx.db, request.result);
    assert.equal(store.transaction, tx); assert.equal(store.name, 'legacy');
    assert.equal(store.keyPath, null); assert.equal(store.autoIncrement, false);
    assert.deepEqual([...store.indexNames], ['semanticKey']);
    const index = store.index('semanticKey');
    assert.equal(index.name, 'semanticKey'); assert.equal(index.keyPath, 'semanticKey');
    assert.equal(index.unique, true); assert.equal(index.multiEntry, false);
    assert.equal(index.objectStore, store);
    const runs = request.result.createObjectStore('reviewRuns');
    runs.createIndex('managedSlot', 'managedSlot', { unique: true });
    const write = runs.put({ managedSlot: 'slot' }, 'run');
    assert.equal(write.readyState, 'pending'); assert.equal(write.transaction, tx);
    assert.throws(() => adapter.entries('reviewRuns'), /Unknown test object store/);
    const get = store.get('a'); assert.equal(get.readyState, 'pending');
    get.onsuccess = () => {
      order.push('get-a'); assert.deepEqual(get.result, before[0][1]);
      assert.deepEqual(adapter.entries('legacy'), before);
      const nested = store.get('b');
      nested.onsuccess = () => { order.push('get-b'); assert.deepEqual(nested.result, before[1][1]); };
    };
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      if (cursor.result) {
        order.push(`cursor-${cursor.result.key}`);
        assert.deepEqual(cursor.result.value, before.find(([key]) => key === cursor.result!.key)![1]);
        cursor.result.continue();
      } else {
        order.push('cursor-end');
        // Schema changes made by a queued upgrade callback remain in this tx.
        request.result.createObjectStore('lateStore').put('late-value', 'late-key');
      }
    };
    tx.oncomplete = () => {
      order.push('complete');
      assert.deepEqual(adapter.inspect('reviewRuns', 'run'), { managedSlot: 'slot' });
      assert.equal(adapter.inspect('lateStore', 'late-key'), 'late-value');
      assert.throws(() => request.result.createObjectStore('tooLate'), { name: 'TransactionInactiveError' });
    };
    order.push('upgrade-return');
  });
  try {
    order.push('open-success');
    assert.deepEqual(order, ['upgrade-return', 'get-a', 'cursor-a', 'get-b', 'cursor-b', 'cursor-end', 'complete', 'open-success']);
    assert.equal(db.version, 2); assert.deepEqual([...db.objectStoreNames], ['lateStore', 'legacy', 'reviewRuns']);
    assert.deepEqual(adapter.entries('legacy'), before);
    const tx = db.transaction(['legacy', 'reviewRuns']);
    const store = tx.objectStore('reviewRuns'), index = store.index('managedSlot');
    assert.equal(store.autoIncrement, false); assert.equal(store.keyPath, null);
    assert.deepEqual([...store.indexNames], ['managedSlot']);
    assert.equal(index.keyPath, 'managedSlot'); assert.equal(index.unique, true); assert.equal(index.multiEntry, false);
    await adapter.idle();
    await assert.rejects(open(adapter.factory, name, 1), { name: 'VersionError' });
  } finally { db.close(); }
});

test('queued upgrade abort rolls back existing writes, new stores and indexes, and version together', async () => {
  const { adapter, name, before } = await legacyFixture();
  let abortSeen = false, completeSeen = false, endSeen = false;
  await assert.rejects(open(adapter.factory, name, 2, request => {
    const tx = request.transaction!, store = tx.objectStore('legacy');
    store.createIndex('newIndex', 'canonical');
    store.put({ semanticKey: 'replacement', canonical: 'must roll back' }, 'a');
    const extra = request.result.createObjectStore('reviewRuns');
    extra.createIndex('managedSlot', 'managedSlot', { unique: true });
    extra.put({ managedSlot: 'must-roll-back' }, 'run');
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      assert.deepEqual(adapter.entries('legacy'), before);
      if (cursor.result) cursor.result.continue();
      else { endSeen = true; tx.abort(); }
    };
    tx.onabort = () => { abortSeen = true; };
    tx.oncomplete = () => { completeSeen = true; };
  }), { name: 'AbortError' });
  assert.equal(endSeen, true); assert.equal(abortSeen, true); assert.equal(completeSeen, false);
  assert.deepEqual(adapter.entries('legacy'), before);
  assert.throws(() => adapter.entries('reviewRuns'), /Unknown test object store/);
  const original = await open(adapter.factory, name, 1);
  assert.equal(original.version, 1); assert.deepEqual([...original.objectStoreNames], ['legacy']);
  assert.deepEqual([...original.transaction('legacy').objectStore('legacy').indexNames], ['semanticKey']);
  original.close();
  const upgraded = await open(adapter.factory, name, 2, request => { request.result.createObjectStore('reviewRuns'); });
  assert.equal(upgraded.version, 2); upgraded.close();
});

test('queued read, quota, callback and unique-index upgrade failures cannot publish a partial version', async t => {
  for (const fault of ['read', 'quota', 'callback', 'index'] as const) await t.test(fault, async () => {
    const { adapter, name, before } = await legacyFixture();
    if (fault === 'read') adapter.failNextRead();
    if (fault === 'quota') adapter.quotaNextWrite();
    if (fault === 'index') adapter.seed('legacy', 'c', { semanticKey: 'first', canonical: 'corrupt duplicate' });
    const preserved = adapter.entries('legacy');
    let txAborted = false;
    await assert.rejects(open(adapter.factory, name, 2, request => {
      const tx = request.transaction!, legacy = tx.objectStore('legacy');
      const store = request.result.createObjectStore('reviewRuns');
      store.createIndex('managedSlot', 'managedSlot', { unique: true });
      const read = legacy.get('a');
      read.onsuccess = () => {
        assert.deepEqual(read.result, before[0][1]);
        if (fault === 'callback') throw Error('Invalid persisted row');
      };
      if (fault === 'index') legacy.createIndex('secondUnique', 'semanticKey', { unique: true });
      store.put({ managedSlot: 'slot' }, 'run');
      tx.onabort = () => { txAborted = true; };
    }), { name: fault === 'quota' ? 'QuotaExceededError' : fault === 'index' ? 'ConstraintError' : 'UnknownError' });
    assert.equal(txAborted, true); assert.deepEqual(adapter.entries('legacy'), preserved);
    assert.throws(() => adapter.entries('reviewRuns'), /Unknown test object store/);
    const db = await open(adapter.factory, name, 1);
    assert.equal(db.version, 1); assert.deepEqual([...db.objectStoreNames], ['legacy']);
    db.close();
  });
});

test('aborted first creation leaves no database, and the synthetic blocked-open fault never resumes', async () => {
  const adapter = createDeterministicIDBAdapter(), name = 'creation-contract';
  await assert.rejects(open(adapter.factory, name, 4, request => {
    const write = request.result.createObjectStore('partial').put('value', 'key');
    write.onsuccess = () => request.transaction!.abort();
  }), { name: 'AbortError' });
  assert.throws(() => adapter.entries('partial', name), /Unknown test database/);
  const db = await open(adapter.factory, name, 1, (request, event) => {
    assert.equal(event.oldVersion, 0); request.result.createObjectStore('original');
  });
  let versionchange = 0, upgraded = false;
  db.onversionchange = () => { versionchange++; };
  adapter.blockNextOpen();
  await assert.rejects(open(adapter.factory, name, 4, () => { upgraded = true; }), { name: 'BlockedError' });
  assert.equal(versionchange, 0); assert.equal(upgraded, false);
  assert.equal(db.version, 1); assert.deepEqual([...db.objectStoreNames], ['original']);
  db.close();
  await adapter.idle(); assert.equal(upgraded, false);
  const upgradedDb = await open(adapter.factory, name, 4, request => { request.result.createObjectStore('reviewRuns'); });
  assert.equal(upgradedDb.version, 4); upgradedDb.close();
});

test('a real blocked upgrade resumes the original request after the last blocker and its queued writes finish', async () => {
  const { adapter, name } = await legacyFixture();
  const first = await open(adapter.factory, name, 1), last = await open(adapter.factory, name, 1);
  const events: string[] = [];
  first.onversionchange = () => { events.push('first-versionchange'); };
  last.onversionchange = () => { events.push('last-versionchange'); };
  const request = adapter.factory.open(name, 2);
  request.onblocked = event => {
    events.push('blocked');
    assert.equal(event.target, request); assert.equal(event.oldVersion, 1); assert.equal(event.newVersion, 2);
    assert.equal(request.readyState, 'pending'); assert.equal(request.transaction, null);
  };
  request.onupgradeneeded = event => {
    events.push('upgrade');
    assert.equal(event.oldVersion, 1); assert.equal(event.newVersion, 2);
    const tx = request.transaction!, legacy = tx.objectStore('legacy');
    assert.equal(tx.mode, 'versionchange'); assert.equal(tx.db, request.result);
    assert.deepEqual([...legacy.indexNames], ['semanticKey']);
    const read = legacy.get('a');
    read.onsuccess = () => {
      events.push('upgrade-read');
      assert.deepEqual(read.result, { semanticKey: 'first', canonical: 'committed before close' });
    };
    request.result.createObjectStore('reviewRuns').put('new row', 'run');
    tx.oncomplete = () => { events.push('upgrade-complete'); };
  };
  request.onsuccess = () => { events.push('success'); request.result.close(); };
  request.onerror = () => { assert.fail(`Unexpected upgrade error: ${request.error?.name}`); };
  const queued = adapter.factory.open(name, 2);
  queued.onupgradeneeded = () => { assert.fail('A later same-version open must not overtake the blocked request.'); };
  queued.onsuccess = () => { events.push('queued-success'); queued.result.close(); };
  const blockedEvents = ['first-versionchange', 'last-versionchange', 'blocked'];
  await adapter.idle(); assert.deepEqual(events, blockedEvents);
  assert.equal(queued.readyState, 'pending');
  assert.throws(() => adapter.entries('reviewRuns', name), /Unknown test object store/);
  // A parked database does not stall other databases or make idle spin.
  const unrelated = await open(adapter.factory, 'unrelated', 1, req => { req.result.createObjectStore('other'); });
  unrelated.close();
  first.close(); first.close();
  await adapter.idle(); assert.deepEqual(events, blockedEvents);
  const tx = last.transaction('legacy', 'readwrite');
  tx.objectStore('legacy').put({ semanticKey: 'first', canonical: 'committed before close' }, 'a');
  tx.oncomplete = () => { events.push('old-write-complete'); };
  last.close(); last.close();
  await adapter.idle();
  assert.deepEqual(events, [...blockedEvents, 'old-write-complete', 'upgrade', 'upgrade-read', 'upgrade-complete', 'success', 'queued-success']);
  assert.equal(request.readyState, 'done'); assert.equal(request.transaction, null);
  assert.equal(adapter.inspect('reviewRuns', 'run', name), 'new row');
  assert.equal(adapter.connectionCount(name), 0);
});

test('closing a blocker in its versionchange or blocked callback resumes exactly once', async t => {
  for (const closeAt of ['versionchange', 'blocked'] as const) await t.test(closeAt, async () => {
    const { adapter, name } = await legacyFixture();
    const old = await open(adapter.factory, name, 1), events: string[] = [];
    old.onversionchange = () => { events.push('versionchange'); if (closeAt === 'versionchange') old.close(); };
    const request = adapter.factory.open(name, 2);
    request.onblocked = () => { events.push('blocked'); old.close(); };
    request.onupgradeneeded = () => { events.push('upgrade'); request.result.createObjectStore('reviewRuns'); };
    request.onsuccess = () => { events.push('success'); request.result.close(); };
    await adapter.idle();
    assert.deepEqual(events, closeAt === 'versionchange' ? ['versionchange', 'upgrade', 'success'] : ['versionchange', 'blocked', 'upgrade', 'success']);
    assert.equal(adapter.connectionCount(name), 0);
  });
});

test('an earlier queued upgrade waits for every close-pending transaction to complete or abort', async t => {
  for (const closeAt of ['before-upgrade-dispatch', 'inside-versionchange'] as const) {
    for (const lastOutcome of ['commit', 'abort', 'readonly'] as const) await t.test(`${closeAt}: ${lastOutcome}`, async () => {
      const { adapter, name, before } = await legacyFixture();
      const old = await open(adapter.factory, name, 1), events: string[] = [];
      await adapter.idle(); // Finish the opening request before testing queue order.
      const expectedFirst = { semanticKey: 'first', canonical: 'final first write' };
      const expectedSecond = lastOutcome === 'commit' ? { semanticKey: 'second', canonical: 'final second write' } : before[1][1];
      const expected = [['a', expectedFirst], ['b', expectedSecond]];
      function queueTransactionsAndClose() {
        const first = old.transaction('legacy', 'readwrite');
        first.objectStore('legacy').put(expectedFirst, 'a');
        first.oncomplete = () => {
          events.push('first-complete');
          assert.equal(adapter.connectionCount(name), 1, 'The later pending transaction must retain its closing connection.');
        };
        const last = old.transaction('legacy', lastOutcome === 'readonly' ? 'readonly' : 'readwrite');
        if (lastOutcome === 'readonly') {
          const read = last.objectStore('legacy').get('a');
          read.onsuccess = () => { assert.deepEqual(read.result, expectedFirst); events.push('last-read'); };
        } else {
          const write = last.objectStore('legacy').put({ semanticKey: 'second', canonical: 'final second write' }, 'b');
          write.onsuccess = () => { if (lastOutcome === 'abort') last.abort(); };
        }
        last.oncomplete = () => { events.push('last-complete'); };
        last.onabort = () => { events.push('last-abort'); assert.equal(last.error?.name, 'AbortError'); };
        old.close(); old.close();
        assert.equal(adapter.connectionCount(name), 1, 'close() must retain a connection with queued transactions.');
        assert.throws(() => old.transaction('legacy'), { name: 'InvalidStateError' });
      }
      old.onversionchange = () => {
        events.push('versionchange');
        if (closeAt === 'inside-versionchange') queueTransactionsAndClose();
      };
      const request = adapter.factory.open(name, 2);
      request.onblocked = () => {
        events.push('blocked');
        assert.equal(old.version, 1); assert.equal(request.readyState, 'pending');
        assert.deepEqual(adapter.entries('legacy'), before);
      };
      request.onupgradeneeded = () => {
        events.push('upgrade');
        assert.deepEqual(adapter.entries('legacy'), expected, 'Upgrade snapshot must include all committed old writes.');
        const read = request.transaction!.objectStore('legacy').getAll();
        read.onsuccess = () => { events.push('upgrade-read'); assert.deepEqual(read.result, [expectedFirst, expectedSecond]); };
        request.result.createObjectStore('reviewRuns');
      };
      request.onsuccess = () => { events.push('success'); request.result.close(); };
      request.onerror = () => { assert.fail(`Unexpected upgrade failure: ${request.error?.name}`); };
      // Crucially, the upgrade is queued BEFORE the old transactions. This also
      // covers transactions created synchronously by its versionchange handler.
      if (closeAt === 'before-upgrade-dispatch') queueTransactionsAndClose();
      await adapter.idle();
      assert.deepEqual(events, [
        ...(closeAt === 'inside-versionchange' ? ['versionchange'] : []), 'blocked', 'first-complete',
        ...(lastOutcome === 'readonly' ? ['last-read'] : []), lastOutcome === 'abort' ? 'last-abort' : 'last-complete',
        'upgrade', 'upgrade-read', 'success',
      ]);
      assert.deepEqual(adapter.entries('legacy'), expected);
      assert.equal(request.result.version, 2); assert.equal(adapter.connectionCount(name), 0);
    });
  }
});

test('a resumed blocked upgrade preserves atomic rollback and its exact abort or quota error', async t => {
  for (const fault of ['abort', 'quota'] as const) await t.test(fault, async () => {
    const { adapter, name, before } = await legacyFixture();
    const old = await open(adapter.factory, name, 1), events: string[] = [];
    const request = adapter.factory.open(name, 2);
    request.onblocked = () => { events.push('blocked'); };
    request.onupgradeneeded = () => {
      events.push('upgrade');
      const tx = request.transaction!, legacy = tx.objectStore('legacy');
      legacy.createIndex('newIndex', 'canonical');
      legacy.put({ semanticKey: 'changed', canonical: 'must roll back' }, 'a');
      request.result.createObjectStore('reviewRuns').put('must roll back', 'run');
      const read = legacy.get('b');
      read.onsuccess = () => { if (fault === 'abort') tx.abort(); };
      tx.onabort = () => { events.push('abort'); };
      tx.oncomplete = () => { assert.fail('A failed upgrade must not complete.'); };
    };
    request.onsuccess = () => { assert.fail('A failed upgrade must not succeed.'); };
    request.onerror = () => { events.push(`error:${request.error?.name}`); };
    const queuedOriginal = open(adapter.factory, name, 1);
    await adapter.idle(); assert.deepEqual(events, ['blocked']);
    if (fault === 'quota') adapter.quotaNextWrite();
    old.close();
    await adapter.idle();
    assert.deepEqual(events, ['blocked', 'upgrade', 'abort', `error:${fault === 'abort' ? 'AbortError' : 'QuotaExceededError'}`]);
    assert.equal(request.readyState, 'done'); assert.equal(request.transaction, null);
    assert.deepEqual(adapter.entries('legacy'), before);
    assert.throws(() => adapter.entries('reviewRuns'), /Unknown test object store/);
    const original = await queuedOriginal;
    assert.equal(original.version, 1); assert.deepEqual([...original.objectStoreNames], ['legacy']);
    assert.deepEqual([...original.transaction('legacy').objectStore('legacy').indexNames], ['semanticKey']);
    original.close(); await adapter.idle();
  });
});
