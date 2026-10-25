import test from 'node:test';
import assert from 'node:assert/strict';
import { clearConversationInputDraft, openConversationInputDraft, updateConversationInputDraft } from '../components/language/conversationInputDraft.ts';
import { MAX_TEXT } from '../app/language/practice/conversation.ts';

test('same owner reopens the latest input in memory without retaining consent or replies', () => {
  clearConversationInputDraft(); const lease = openConversationInputDraft('A');
  assert.equal(updateConversationInputDraft(lease, { text: 'synthetic first', situation: '일상' }), true);
  assert.equal(updateConversationInputDraft(lease, { text: 'synthetic latest', situation: '여행' }), true);
  assert.deepEqual(openConversationInputDraft('A').draft, { text: 'synthetic latest', situation: '여행' });
});
test('A to B to A cannot reveal the old input or accept a stale writer', () => {
  clearConversationInputDraft(); const a = openConversationInputDraft('A');
  updateConversationInputDraft(a, { text: 'synthetic A', situation: '일상' });
  const b = openConversationInputDraft('B'); assert.equal(b.draft, null);
  assert.equal(updateConversationInputDraft(a, { text: 'late A', situation: '일상' }), false);
  updateConversationInputDraft(b, { text: 'synthetic B', situation: '일상' });
  assert.equal(openConversationInputDraft('A').draft, null);
});
test('session invalidation clears text and invalidates old leases even for the same owner', () => {
  clearConversationInputDraft(); const a = openConversationInputDraft('A');
  updateConversationInputDraft(a, { text: 'synthetic', situation: '일상' }); clearConversationInputDraft();
  assert.equal(updateConversationInputDraft(a, { text: 'late', situation: '일상' }), false);
  assert.equal(openConversationInputDraft('A').draft, null);
});
test('empty input removes the draft, and later edits do not resurrect an old value', () => {
  clearConversationInputDraft(); const a = openConversationInputDraft('A');
  updateConversationInputDraft(a, { text: 'old', situation: '일상' });
  updateConversationInputDraft(a, { text: '', situation: '일상' }); assert.equal(openConversationInputDraft('A').draft, null);
  updateConversationInputDraft(a, { text: 'new', situation: '일상' }); assert.equal(openConversationInputDraft('A').draft?.text, 'new');
});
test('oversized input and unknown situations do not replace the valid draft', () => {
  clearConversationInputDraft(); const a = openConversationInputDraft('A'); updateConversationInputDraft(a, { text: 'keep', situation: '일상' });
  assert.equal(updateConversationInputDraft(a, { text: 'x'.repeat(MAX_TEXT + 1), situation: '일상' }), false);
  assert.equal(updateConversationInputDraft(a, { text: 'bad', situation: 'unknown' as '일상' }), false);
  assert.equal(openConversationInputDraft('A').draft?.text, 'keep');
  clearConversationInputDraft();
});

test('stale topic update and stale clear cannot replace the latest same-owner draft', () => {
  clearConversationInputDraft(); const older = openConversationInputDraft('A'), latest = openConversationInputDraft('A');
  updateConversationInputDraft(older, { text: 'older', situation: '일상' }, { claim: true });
  updateConversationInputDraft(latest, { text: 'latest', situation: '일상' }, { claim: true });
  assert.equal(updateConversationInputDraft(older, { text: 'older', situation: '여행' }), false);
  assert.equal(updateConversationInputDraft(older, { text: '', situation: '일상' }, { claim: true }), false);
  assert.equal(openConversationInputDraft('A').draft?.text, 'latest');
});
test('explicit new non-empty input may become latest, while old completion retains its submitted revision', () => {
  clearConversationInputDraft(); const a = openConversationInputDraft('A');
  updateConversationInputDraft(a, { text: 'submitted', situation: '일상' }, { claim: true }); const submitted = a.revision;
  updateConversationInputDraft(a, { text: 'new edit', situation: '일상' }, { claim: true });
  assert.equal(updateConversationInputDraft(a, { text: '', situation: '일상' }, { expectedRevision: submitted }), false);
  assert.equal(openConversationInputDraft('A').draft?.text, 'new edit');
  const b = openConversationInputDraft('A'); updateConversationInputDraft(b, { text: 'another', situation: '일상' }, { claim: true });
  assert.equal(updateConversationInputDraft(a, { text: 'intentional latest', situation: '여행' }, { claim: true }), true);
  assert.equal(openConversationInputDraft('A').draft?.text, 'intentional latest'); clearConversationInputDraft();
});


test('fixed conversation and free-text practice keep separate draft namespaces', async () => {
  const free = await import('../app/language/practice/inputDraft.ts');
  free.clearPracticeInputDraft(); clearConversationInputDraft();
  const a = openConversationInputDraft('A'), b = free.openPracticeInputDraft('A');
  updateConversationInputDraft(a, { text: 'fixed input', situation: '일상' }, { claim: true });
  free.updatePracticeInputDraft(b, { text: 'free input', situation: '일상' }, { claim: true });
  assert.equal(openConversationInputDraft('A').draft?.text, 'fixed input');
  assert.equal(free.openPracticeInputDraft('A').draft?.text, 'free input');
  clearConversationInputDraft(); assert.equal(free.openPracticeInputDraft('A').draft?.text, 'free input');
  free.clearPracticeInputDraft();
});
