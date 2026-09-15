import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCommandDrafts } from '../lib/assistant-command-drafts.ts';
const proposal = { requestId: 'd1', operation: 'create', itemId: null, expected: null, values: { title: '합성 명령', due_at: null, priority: 3, recurrence_rule: 'none', project_id: null }, projectName: null, resetMarker: null, expiresAt: '2026-09-15T00:15:00Z' };
const encode = (drafts: unknown) => JSON.stringify({ ownerId: 'owner-a', drafts });
test('draft reload preserves the exact request and attempted state, including expired ambiguous requests', () => {
  const drafts = [{ proposal, attempted: true }];
  assert.deepEqual(readCommandDrafts(encode(drafts), 'owner-a'), drafts);
});
test('another account cannot restore a previous account draft', () => {
  assert.deepEqual(readCommandDrafts(encode([{ proposal, attempted: false }]), 'owner-b'), []);
});
test('missing draft is empty; malformed JSON and invalid shape report a restore failure', () => {
  assert.deepEqual(readCommandDrafts(null, 'owner-a'), []);
  for (const raw of ['{', 'null', encode({}), encode([{ proposal: {}, attempted: false }]), encode([{ proposal, attempted: 'yes' }])]) {
    assert.throws(() => readCommandDrafts(raw, 'owner-a'));
  }
});
test('unrenderable or oversized drafts fail rather than crashing a review', () => {
  assert.throws(() => readCommandDrafts(encode([{ proposal: { ...proposal, values: { ...proposal.values, priority: {} } }, attempted: false }]), 'owner-a'));
  assert.throws(() => readCommandDrafts(encode(Array.from({ length: 21 }, () => ({ proposal, attempted: false }))), 'owner-a'));
});
