import assert from 'node:assert/strict';
import test from 'node:test';
import { storageBrowser, storageTab, tick } from './helpers/storage-ui-fixture.ts';

for (const resolution of [false, true]) for (const retired of [false, true]) test(`${resolution ? 'reviewed' : 'normal'} queued acknowledgment ${retired ? 'rejects its retired same-epoch caller' : 'retains the current caller commit'}`, async t => {
  const browser = storageBrowser(), tab = storageTab(browser, 'ack'); t.after(tab.dispose);
  await tab.cloud.prepareLocalCloudState('synthetic-owner');
  const request = tab.cloud.readCloudSyncRequest('synthetic-owner', tab.cloud.readCloudSyncEpoch());
  const key = 'ai-fitness-daily-notes', value = JSON.stringify({ remote: 'synthetic new record' });
  const remote = tab.cloud.readLocalCloudState({ length: 1, key: () => key, getItem: name => name === key ? value : null });
  const before = [...browser.values], epoch = request.epoch, release = browser.holdLock(); t.after(release);
  let active = true, guardCalls = 0;
  const guard = () => { guardCalls++; if (!active) throw new Error('retired caller'); };
  const commit = resolution ? tab.cloud.commitCloudSyncResolutionResponse : tab.cloud.commitCloudSyncResponse;
  const pending = commit(request, remote, guard);
  await tick(); assert.equal(guardCalls, 0, 'Caller guard waits for the actual lock boundary');
  active = !retired;
  const finished = retired ? assert.rejects(pending, /retired caller/) : pending;
  release(); await finished;
  assert.equal(guardCalls, 1); assert.equal(tab.cloud.readCloudSyncEpoch(), epoch);
  if (retired) assert.deepEqual([...browser.values], before, 'No record, baseline, acknowledgement or journal writes from the retired caller');
  else {
    assert.equal(tab.local.getItem(key), value);
    assert.equal(tab.cloud.stableState(tab.cloud.readSyncBase('synthetic-owner')!), tab.cloud.stableState(remote));
  }
});
