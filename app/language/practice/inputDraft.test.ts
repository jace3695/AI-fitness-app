import test from 'node:test';
import assert from 'node:assert/strict';
import { clearPracticeInputDraft, openPracticeInputDraft, updatePracticeInputDraft } from './inputDraft.ts';
import { MAX_TEXT } from './conversation.ts';

test('same owner reopens the latest input in memory without retaining consent or replies', () => {
  clearPracticeInputDraft(); const lease = openPracticeInputDraft('A');
  assert.equal(updatePracticeInputDraft(lease, { text: 'synthetic first', situation: '일상' }), true);
  assert.equal(updatePracticeInputDraft(lease, { text: 'synthetic latest', situation: '여행' }), true);
  assert.deepEqual(openPracticeInputDraft('A').draft, { text: 'synthetic latest', situation: '여행' });
});
test('A to B to A cannot reveal the old input or accept a stale writer', () => {
  clearPracticeInputDraft(); const a = openPracticeInputDraft('A');
  updatePracticeInputDraft(a, { text: 'synthetic A', situation: '일상' });
  const b = openPracticeInputDraft('B'); assert.equal(b.draft, null);
  assert.equal(updatePracticeInputDraft(a, { text: 'late A', situation: '일상' }), false);
  updatePracticeInputDraft(b, { text: 'synthetic B', situation: '일상' });
  assert.equal(openPracticeInputDraft('A').draft, null);
});
test('session invalidation clears text and invalidates old leases even for the same owner', () => {
  clearPracticeInputDraft(); const a = openPracticeInputDraft('A');
  updatePracticeInputDraft(a, { text: 'synthetic', situation: '일상' }); clearPracticeInputDraft();
  assert.equal(updatePracticeInputDraft(a, { text: 'late', situation: '일상' }), false);
  assert.equal(openPracticeInputDraft('A').draft, null);
});
test('empty input removes the draft, and later edits do not resurrect an old value', () => {
  clearPracticeInputDraft(); const a = openPracticeInputDraft('A');
  updatePracticeInputDraft(a, { text: 'old', situation: '일상' });
  updatePracticeInputDraft(a, { text: '', situation: '일상' }); assert.equal(openPracticeInputDraft('A').draft, null);
  updatePracticeInputDraft(a, { text: 'new', situation: '일상' }); assert.equal(openPracticeInputDraft('A').draft?.text, 'new');
});
test('oversized input and unknown situations do not replace the valid draft', () => {
  clearPracticeInputDraft(); const a = openPracticeInputDraft('A'); updatePracticeInputDraft(a, { text: 'keep', situation: '일상' });
  assert.equal(updatePracticeInputDraft(a, { text: 'x'.repeat(MAX_TEXT + 1), situation: '일상' }), false);
  assert.equal(updatePracticeInputDraft(a, { text: 'bad', situation: 'unknown' as '일상' }), false);
  assert.equal(openPracticeInputDraft('A').draft?.text, 'keep');
  clearPracticeInputDraft();
});

test('stale topic update and stale clear cannot replace the latest same-owner draft', () => {
  clearPracticeInputDraft(); const older = openPracticeInputDraft('A'), latest = openPracticeInputDraft('A');
  updatePracticeInputDraft(older, { text: 'older', situation: '일상' }, { claim: true });
  updatePracticeInputDraft(latest, { text: 'latest', situation: '일상' }, { claim: true });
  assert.equal(updatePracticeInputDraft(older, { text: 'older', situation: '여행' }), false);
  assert.equal(updatePracticeInputDraft(older, { text: '', situation: '일상' }, { claim: true }), false);
  assert.equal(openPracticeInputDraft('A').draft?.text, 'latest');
});
test('explicit new non-empty input may become latest, while old completion retains its submitted revision', () => {
  clearPracticeInputDraft(); const a = openPracticeInputDraft('A');
  updatePracticeInputDraft(a, { text: 'submitted', situation: '일상' }, { claim: true }); const submitted = a.revision;
  updatePracticeInputDraft(a, { text: 'new edit', situation: '일상' }, { claim: true });
  assert.equal(updatePracticeInputDraft(a, { text: '', situation: '일상' }, { expectedRevision: submitted }), false);
  assert.equal(openPracticeInputDraft('A').draft?.text, 'new edit');
  const b = openPracticeInputDraft('A'); updatePracticeInputDraft(b, { text: 'another', situation: '일상' }, { claim: true });
  assert.equal(updatePracticeInputDraft(a, { text: 'intentional latest', situation: '여행' }, { claim: true }), true);
  assert.equal(openPracticeInputDraft('A').draft?.text, 'intentional latest'); clearPracticeInputDraft();
});
