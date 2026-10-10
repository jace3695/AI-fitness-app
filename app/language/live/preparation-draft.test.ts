import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { buildLivePreparation } from '../../../lib/language-live/preparation.ts';
import { createPreparationDraft, forkPreparationDraft, persistPreparationDraft, preparationDraftKey, readPreparationDrafts, removePreparationDraft } from './preparation-draft.ts';

const owner = randomUUID(), other = randomUUID();
function storage() {
  const map = new Map<string, string>();
  return { map, get length() { return map.size; }, key: (index: number) => [...map.keys()][index] ?? null, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
}
const create = () => createPreparationDraft(owner, buildLivePreparation({ ownerId: owner, lessons: [], batches: [] }, '2026-10-10'), { draftId: randomUUID(), preparationId: randomUUID(), requestId: randomUUID(), now: '2026-10-09T12:00:00Z' });

test('preparation drafts use owner namespace and never write legacy sync keys', () => {
  const store = storage(), draft = create(); store.setItem('learningSettings', 'keep'); persistPreparationDraft(store, draft, null);
  assert.deepEqual(readPreparationDrafts(store, owner).drafts, [draft]); assert.deepEqual(readPreparationDrafts(store, other), { drafts: [], unreadable: false }); assert.equal(store.getItem('learningSettings'), 'keep');
});
test('unfinished blank edits remain recoverable but invalid pending payloads remain unreadable and preserved', () => {
  const store = storage(), draft = create(); draft.input.editedText = ''; const key = preparationDraftKey(owner, draft.draftId);
  store.setItem(key, JSON.stringify(draft)); assert.equal(readPreparationDrafts(store, owner).drafts[0].input.editedText, '');
  draft.submitted = true; draft.reviewed = true; store.setItem(key, JSON.stringify(draft)); assert.deepEqual(readPreparationDrafts(store, owner), { drafts: [], unreadable: true }); assert.ok(store.getItem(key));
});
test('malformed, wrong-owner and mismatched-key drafts cannot render and are not deleted', () => {
  for (const mutate of [(d: ReturnType<typeof create>) => { d.ownerId = other; }, (d: ReturnType<typeof create>) => { d.input.preparation.source.ownerId = other; }, (d: ReturnType<typeof create>) => { d.draftId = randomUUID(); }, (d: ReturnType<typeof create>) => { d.input.preparation.references = null as never; }, (d: ReturnType<typeof create>) => { d.updatedAt = 'invalid'; }, (d: ReturnType<typeof create>) => { d.submitted = true; d.reviewed = false; }]) {
    const store = storage(), draft = create(), key = preparationDraftKey(owner, draft.draftId); mutate(draft); store.setItem(key, JSON.stringify(draft));
    assert.deepEqual(readPreparationDrafts(store, owner), { drafts: [], unreadable: true }); assert.equal(store.length, 1);
  }
});
test('recovery forks independent deep copies and preserves exact immutable pending save request', () => {
  const draft = create(); draft.submitted = true; draft.reviewed = true;
  const fork = forkPreparationDraft(draft, randomUUID(), '2026-10-10T00:00:00Z'); assert.notEqual(fork.draftId, draft.draftId); assert.deepEqual(fork.input, draft.input); assert.equal(fork.submitted, true);
  fork.input.preparation.warnings.push('변경'); assert.deepEqual(draft.input.preparation.warnings, []);
  assert.throws(() => forkPreparationDraft(draft, draft.draftId, draft.updatedAt), /fresh_draft_id/);
});
test('stale writes and stale removals preserve the newer draft', () => {
  const store = storage(), draft = create(), encoded = persistPreparationDraft(store, draft, null);
  const next = { ...draft, input: { ...draft.input, editedText: '새 내용' } }, latest = persistPreparationDraft(store, next, encoded);
  assert.throws(() => persistPreparationDraft(store, draft, encoded), /draft_changed/); assert.equal(removePreparationDraft(store, draft, encoded), false); assert.equal(store.getItem(preparationDraftKey(owner, draft.draftId)), latest);
  assert.equal(removePreparationDraft(store, next, latest), true); assert.equal(store.length, 0);
});
test('quota and readback failures never return a successful local save', () => {
  const store = storage(), draft = create(); assert.throws(() => persistPreparationDraft({ ...store, setItem: () => { throw Error('quota'); } }, draft, null), /quota/);
  let reads = 0; assert.throws(() => persistPreparationDraft({ ...store, getItem: () => ++reads === 1 ? null : 'other-tab' }, draft, null), /draft_changed/);
});
test('source owner and saved record owner must match when starting an edit', () => {
  const draft = create(); const ids = { draftId: randomUUID(), requestId: randomUUID(), preparationId: randomUUID(), now: '2026-10-10T00:00:00Z' };
  assert.throws(() => createPreparationDraft(other, draft.input.preparation, ids), /source_mismatch/);
  assert.throws(() => createPreparationDraft(owner, draft.input.preparation, ids, { user_id: other } as never), /source_mismatch/);
});
