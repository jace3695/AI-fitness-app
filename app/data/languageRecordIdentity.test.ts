import assert from 'node:assert/strict';
import test from 'node:test';
import { languageFixture } from '../../tests/helpers/languageFixture.ts';
import { commitLanguageSyncResponse, readLanguageRecordSnapshot } from './languageCloudSync.ts';
import { captureLanguageRows, languageRowKey, languageRowSource, resolveLanguageRow } from './languageRecordIdentity.ts';
import { createLanguageMutation } from './languageRecordMutations.ts';

test('opaque row handle follows filtered/sorted view to exact duplicate source occurrence', async t => {
  const f = languageFixture(); t.after(f.restore); const { request } = await f.request();
  const context = (await commitLanguageSyncResponse(request, { wrongKanaChars: '["a", {"unknown":1e999}, "a", "b"]' })).context;
  const source = readLanguageRecordSnapshot(context), rows = captureLanguageRows(source, 'wrongKanaChars');
  const filtered = rows.filter(row => typeof row.value === 'string').reverse();
  assert.equal(resolveLanguageRow(filtered[1].handle, context, source.records), 2);
  assert.equal(languageRowSource(filtered[1].handle), source);
  assert.equal(languageRowKey(filtered[1].handle), 'wrongKanaChars');
  assert.throws(() => languageRowKey({ ...filtered[1].handle }));
  assert.throws(() => resolveLanguageRow({ ...filtered[1].handle }, context, source.records));
  assert.throws(() => resolveLanguageRow(filtered[1].handle, context, { wrongKanaChars: '["b","a", {"unknown":1e999}, "a", "b"]' }));
  assert.notEqual(rows[0].handle.viewId, rows[2].handle.viewId);
  const payload = createLanguageMutation(context, source, { handle: rows[2].handle }); assert.equal(payload.payload.handle, rows[2].handle);
});
test('view identity survives refreshed source and unrelated append; mutation proof does not', async t => {
  const f = languageFixture(); t.after(f.restore); const { request } = await f.request();
  const context = (await commitLanguageSyncResponse(request, { japaneseCurriculumReviewV1: '[{"id":"a","wrongCount":1}]' })).context;
  const old = captureLanguageRows(readLanguageRecordSnapshot(context), 'japaneseCurriculumReviewV1')[0];
  f.storage.setItem('japaneseCurriculumReviewV1', '[{"id":"a","wrongCount":2},{"id":"b"}]');
  const current = readLanguageRecordSnapshot(context), next = captureLanguageRows(current, 'japaneseCurriculumReviewV1')[0];
  assert.equal(old.handle.viewId, next.handle.viewId); assert.throws(() => resolveLanguageRow(old.handle, context, current.records));
});
