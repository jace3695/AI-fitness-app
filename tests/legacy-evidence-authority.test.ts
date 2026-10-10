import assert from 'node:assert/strict';
import test from 'node:test';
import { languageFixture } from './helpers/languageFixture.ts';
import { createLanguageSyncCoordinator } from '../app/data/languageSyncCoordinator.ts';
import { commitLanguageSyncResponse, languageLegacyEvidenceCapability } from '../app/data/languageCloudSync.ts';
import { revokeAuthenticatedStorageOwner } from '../app/data/authenticatedStorageOwner.ts';
import { invalidateStorageOwner } from '../app/data/storageTransaction.ts';
const owner = '11111111-1111-4111-8111-111111111111';

async function observed() {
  const f = languageFixture(), lease = await f.owner(owner);
  const coordinator = createLanguageSyncCoordinator({ lease, storage: f.storage, onState() {}, transport: {
    async verifyOwner() { return true; }, async read() { return { state: {}, updatedAt: 'synthetic' }; },
    async insert() { assert.fail('No insert'); }, async update() { assert.fail('No update'); },
  } });
  await coordinator.start();
  const context = coordinator.getState().context; assert.ok(context);
  return { ...f, lease, coordinator, context, restore() { coordinator.dispose(); f.restore(); } };
}
test('evidence read guard requires coordinator observation, not ordinary local response commitment', async t => {
  const f = languageFixture(); t.after(f.restore); const request = await f.request(owner);
  const local = await commitLanguageSyncResponse(request.request, {});
  assert.throws(() => languageLegacyEvidenceCapability.acquire(local.context));
  assert.throws(() => languageLegacyEvidenceCapability.acquire({ ...local.context }));
});
test('evidence read guard registers exact handles and cannot be reconstructed or serialized', async t => {
  const f = await observed(); t.after(f.restore);
  assert.throws(() => languageLegacyEvidenceCapability.acquire({ ...f.context }));
  const authority = languageLegacyEvidenceCapability.acquire(f.context);
  assert.equal(authority.ownerId, owner); assert.deepEqual(authority.resetMarker, { present: false, value: null });
  languageLegacyEvidenceCapability.assertCurrent(authority);
  assert.throws(() => languageLegacyEvidenceCapability.assertCurrent({ ...authority }));
  assert.throws(() => languageLegacyEvidenceCapability.assertCurrent(JSON.parse(JSON.stringify(authority))));
  assert.deepEqual(Object.keys(authority).sort(), ['ownerId', 'resetMarker', 'signal']);
  f.coordinator.pause(); assert.throws(() => languageLegacyEvidenceCapability.assertCurrent(authority));
});
test('same-owner coordinator refresh retires previous read authority, while new context can reacquire', async t => {
  const f = await observed(); t.after(f.restore);
  const old = languageLegacyEvidenceCapability.acquire(f.context);
  await f.coordinator.refresh();
  assert.throws(() => languageLegacyEvidenceCapability.assertCurrent(old));
  const context = f.coordinator.getState().context; assert.ok(context);
  const current = languageLegacyEvidenceCapability.acquire(context);
  languageLegacyEvidenceCapability.assertCurrent(current);
  revokeAuthenticatedStorageOwner(f.lease);
  assert.throws(() => languageLegacyEvidenceCapability.assertCurrent(current));
});
test('same-owner new opaque epoch and logout retire evidence authority without a numeric conversion', async t => {
  const f = await observed(); t.after(f.restore);
  const original = languageLegacyEvidenceCapability.acquire(f.context), epoch = f.context.epoch;
  const next = invalidateStorageOwner(f.storage, owner); assert.notEqual(next.epoch, epoch);
  assert.throws(() => languageLegacyEvidenceCapability.assertCurrent(original));
  invalidateStorageOwner(f.storage, null);
  assert.throws(() => languageLegacyEvidenceCapability.acquire(f.context));
});
