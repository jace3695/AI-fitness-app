import assert from 'node:assert/strict';
import test from 'node:test';
import { backupJson, deferred, FIXTURE_OWNER, RECORD_KEY, storageBrowser, storageTab, tick } from './helpers/storage-ui-fixture.ts';

const PANEL = 'app/components/DataBackupPanel.tsx';
const backup = { [RECORD_KEY]: { '2026-10-01': { dietMemo: 'synthetic backup' } } };
const original = { '2026-10-02': { dietMemo: 'synthetic original' } };

// Actual select/restore/export handlers and real storage/cloud modules, with no
// browser, account, or network. File bytes and lock scheduling are controlled.
test('shipping backup restore waits for the lock and merges the latest committed peer records', async t => {
  const browser = storageBrowser({ [RECORD_KEY]: JSON.stringify(original) });
  const tab = storageTab(browser, 'backup'), peer = storageTab(browser, 'peer');
  t.after(tab.dispose); t.after(peer.dispose); await tab.cloud.prepareLocalCloudState(FIXTURE_OWNER);
  const panel = tab.mount(PANEL); t.after(panel.dispose); await panel.selectFile(backupJson(backup));
  const release = browser.holdLock(); t.after(release);
  const concurrent = peer.transactions.updateStorageBatch(peer.local, snapshot => ({
    [RECORD_KEY]: JSON.stringify({ ...JSON.parse(snapshot.getItem(RECORD_KEY) ?? '{}'), '2026-10-03': { dietMemo: 'synthetic peer edit' } }),
  }));
  panel.click('확인 후 병합 복원'); await panel.settle();
  assert.equal(panel.button('확인 후 병합 복원').props.disabled, true);
  assert.match(panel.text(), /synthetic-backup.json/);
  assert.doesNotMatch(panel.text(), /현재 기록과 합쳤습니다/);
  assert.equal(tab.pendingTimers, 0); assert.equal(tab.reloads, 0); assert.deepEqual(browser.record(), original);
  release(); await concurrent; await panel.settle();
  assert.deepEqual(browser.record(), { ...original, ...backup[RECORD_KEY], '2026-10-03': { dietMemo: 'synthetic peer edit' } });
  assert.match(panel.text(), /백업 기록 1개 항목을 현재 기록과 합쳤습니다/);
  assert.doesNotMatch(panel.text(), /synthetic-backup.json/);
  assert.equal(tab.reloads, 0, 'Reload is scheduled only after the restore commit');
  assert.equal(tab.pendingTimers, 1); tab.flushTimers(); assert.equal(tab.reloads, 1);
  assert.equal(browser.maxActive, 1);
});

for (const failure of ['rejected-lock', 'rejected-write', 'legacy-journal', 'missing-lock'] as const) test(`shipping backup restore retains its preview and saved records after ${failure}`, async t => {
  const browser = storageBrowser({ [RECORD_KEY]: JSON.stringify(original) });
  const tab = storageTab(browser, 'backup'); t.after(tab.dispose); await tab.cloud.prepareLocalCloudState(FIXTURE_OWNER);
  const panel = tab.mount(PANEL); t.after(panel.dispose); await panel.selectFile(backupJson(backup));
  const before = tab.local.getItem(RECORD_KEY);
  let expected: RegExp;
  switch (failure) {
    case 'rejected-lock': browser.rejectNextLock(); expected = /synthetic lock refusal/; break;
    case 'rejected-write': browser.rejectNextWrite(RECORD_KEY); expected = /synthetic quota refusal/; break;
    case 'legacy-journal':
      tab.local.setItem(tab.transactions.STORAGE_JOURNAL_KEY, JSON.stringify({ [RECORD_KEY]: before }));
      expected = /이전 버전.*복구 정보/; break;
    case 'missing-lock': tab.disableLocks(); expected = /Web Locks/; break;
  }
  const legacyBefore = tab.local.getItem(tab.transactions.STORAGE_JOURNAL_KEY);
  panel.click('확인 후 병합 복원'); await panel.settle();
  assert.match(panel.text(), expected);
  assert.match(panel.text(), /synthetic-backup.json/);
  assert.equal(panel.button('확인 후 병합 복원').props.disabled, false, 'Failure leaves the chosen backup available for retry');
  assert.doesNotMatch(panel.text(), /현재 기록과 합쳤습니다/);
  assert.equal(tab.local.getItem(RECORD_KEY), before);
  assert.equal(tab.local.getItem(tab.transactions.STORAGE_JOURNAL_KEY), legacyBefore, 'A legacy journal is not silently migrated or discarded');
  tab.flushTimers(); assert.equal(tab.reloads, 0); assert.equal(tab.pendingTimers, 0);
});

test('shipping backup restore rejects an owner change after preview rather than applying old-owner bytes', async t => {
  const browser = storageBrowser({ [RECORD_KEY]: JSON.stringify(original) });
  const tab = storageTab(browser, 'backup'), peer = storageTab(browser, 'peer');
  t.after(tab.dispose); t.after(peer.dispose); await tab.cloud.prepareLocalCloudState(FIXTURE_OWNER);
  const panel = tab.mount(PANEL); t.after(panel.dispose); await panel.selectFile(backupJson(backup));
  await peer.cloud.prepareLocalCloudState('synthetic-owner-b');
  await peer.transactions.writeStorageBatch(peer.local, { [RECORD_KEY]: JSON.stringify({ '2026-10-04': { dietMemo: 'synthetic owner B' } }) });
  const before = [...browser.values];
  panel.click('확인 후 병합 복원'); await panel.settle();
  assert.match(panel.text(), /계정이 변경되었거나/);
  assert.match(panel.text(), /synthetic-backup.json/);
  assert.doesNotMatch(panel.text(), /현재 기록과 합쳤습니다/);
  assert.deepEqual([...browser.values], before, 'Owner mismatch is rejected before any write');
  tab.flushTimers(); assert.equal(tab.reloads, 0);
});

test('shipping backup restore rejects its queued work if the owner changes before lock acquisition', async t => {
  const browser = storageBrowser({ [RECORD_KEY]: JSON.stringify(original) });
  const tab = storageTab(browser, 'backup'), peer = storageTab(browser, 'peer');
  t.after(tab.dispose); t.after(peer.dispose); await tab.cloud.prepareLocalCloudState(FIXTURE_OWNER);
  const panel = tab.mount(PANEL); t.after(panel.dispose); await panel.selectFile(backupJson(backup));
  const release = browser.holdLock(); t.after(release);
  panel.click('확인 후 병합 복원');
  const transition = peer.cloud.prepareLocalCloudState('synthetic-owner-b');
  await panel.settle(); assert.doesNotMatch(panel.text(), /현재 기록과 합쳤습니다/);
  release(); await transition; await panel.settle();
  assert.match(panel.text(), /계정이 변경되었거나/); assert.match(panel.text(), /synthetic-backup.json/);
  assert.equal(tab.local.getItem(RECORD_KEY), null, 'New owner preparation clears old records without applying the backup');
  assert.equal(browser.writes.some(write => write.key === RECORD_KEY && write.value?.includes('synthetic backup')), false);
  tab.flushTimers(); assert.equal(tab.reloads, 0);
});

test('shipping backup selection captures owner before asynchronous file reading', async t => {
  const browser = storageBrowser({ [RECORD_KEY]: JSON.stringify(original) });
  const tab = storageTab(browser, 'backup'), peer = storageTab(browser, 'peer');
  t.after(tab.dispose); t.after(peer.dispose); await tab.cloud.prepareLocalCloudState(FIXTURE_OWNER);
  const panel = tab.mount(PANEL); t.after(panel.dispose);
  const file = deferred<string>(); await panel.selectFile(file.promise);
  await peer.cloud.prepareLocalCloudState('synthetic-owner-b');
  const before = [...browser.values]; file.resolve(backupJson(backup)); await panel.settle();
  assert.match(panel.text(), /계정이 변경되었습니다.*다시 선택/);
  assert.doesNotMatch(panel.text(), /synthetic-backup.json|확인 후 병합 복원/);
  assert.deepEqual([...browser.values], before); tab.flushTimers(); assert.equal(tab.reloads, 0);
});

test('shipping backup selection ignores an older delayed file after a newer selection', async t => {
  const browser = storageBrowser(), tab = storageTab(browser, 'backup');
  t.after(tab.dispose); await tab.cloud.prepareLocalCloudState(FIXTURE_OWNER);
  const panel = tab.mount(PANEL); t.after(panel.dispose);
  const stale = deferred<string>(); await panel.selectFile(stale.promise, 'older-synthetic.json');
  const newer = { [RECORD_KEY]: { '2026-10-05': { dietMemo: 'synthetic newer selection' } } };
  await panel.selectFile(backupJson(newer), 'newer-synthetic.json');
  stale.resolve(backupJson(backup)); await panel.settle();
  assert.match(panel.text(), /newer-synthetic.json/); assert.doesNotMatch(panel.text(), /older-synthetic.json/);
  panel.click('확인 후 병합 복원'); await panel.settle();
  assert.deepEqual(browser.record(), newer[RECORD_KEY]);
});

test('shipping backup export reads a coherent before-image without recovering a legacy transaction', async t => {
  const browser = storageBrowser({ [RECORD_KEY]: JSON.stringify(original) });
  const tab = storageTab(browser, 'backup'); t.after(tab.dispose); await tab.cloud.prepareLocalCloudState(FIXTURE_OWNER);
  const journal = JSON.stringify({ [RECORD_KEY]: JSON.stringify(original) });
  tab.local.setItem(tab.transactions.STORAGE_JOURNAL_KEY, journal);
  tab.local.setItem(RECORD_KEY, JSON.stringify({ partial: 'synthetic half-written value' }));
  const before = [...browser.values], writes = browser.writes.length;
  const panel = tab.mount(PANEL); t.after(panel.dispose); panel.click('운동·식단 기록 백업'); await tick();
  assert.equal(tab.downloads.length, 1);
  const exported = JSON.parse(await tab.downloads[0].text());
  assert.deepEqual(exported.state, { [RECORD_KEY]: original });
  assert.deepEqual([...browser.values], before); assert.equal(browser.writes.length, writes);
});

test('shipping backup restore ignores duplicate clicks and new file selections while its commit is queued', async t => {
  const browser = storageBrowser({ [RECORD_KEY]: JSON.stringify(original) });
  const tab = storageTab(browser, 'backup'); t.after(tab.dispose); await tab.cloud.prepareLocalCloudState(FIXTURE_OWNER);
  const panel = tab.mount(PANEL); t.after(panel.dispose); await panel.selectFile(backupJson(backup));
  const release = browser.holdLock(); t.after(release);
  const requests = browser.calls.length;
  const click = panel.button('확인 후 병합 복원').props.onClick as () => void;
  click(); click();
  await panel.selectFile(backupJson({ [RECORD_KEY]: { unexpected: 'synthetic replacement' } }), 'replacement-synthetic.json');
  assert.equal(browser.calls.length, requests + 1, 'The synchronous pending guard queues only one restore');
  assert.match(panel.text(), /synthetic-backup.json/); assert.doesNotMatch(panel.text(), /replacement-synthetic.json/);
  release(); await panel.settle();
  assert.deepEqual(browser.record(), { ...original, ...backup[RECORD_KEY] });
  tab.flushTimers(); assert.equal(tab.reloads, 1);
});

test('shipping backup restore can retry a rejected commit without choosing the file again', async t => {
  const browser = storageBrowser({ [RECORD_KEY]: JSON.stringify(original) });
  const tab = storageTab(browser, 'backup'); t.after(tab.dispose); await tab.cloud.prepareLocalCloudState(FIXTURE_OWNER);
  const panel = tab.mount(PANEL); t.after(panel.dispose); await panel.selectFile(backupJson(backup));
  browser.rejectNextWrite(RECORD_KEY); panel.click('확인 후 병합 복원'); await panel.settle();
  assert.match(panel.text(), /synthetic quota refusal/);
  assert.deepEqual(browser.record(), original);
  panel.click('확인 후 병합 복원'); await panel.settle();
  assert.match(panel.text(), /현재 기록과 합쳤습니다/); assert.doesNotMatch(panel.text(), /synthetic quota refusal|synthetic-backup.json/);
  assert.deepEqual(browser.record(), { ...original, ...backup[RECORD_KEY] });
  tab.flushTimers(); assert.equal(tab.reloads, 1);
});
