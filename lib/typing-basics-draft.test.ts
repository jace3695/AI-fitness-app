import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyTypingBasicsDraft, makeTypingBasicsSession, parseTypingBasicsDraft, persistTypingBasicsDraft, removeTypingBasicsDraft, shouldResetTypingBasicsDraft, typingBasicsDraftKey } from './typing-basics-draft.ts';
import { pressTypingKey, TYPING_KEYS } from '../app/data/typingBasics.ts';
const owner = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002';
const routine = '00000000-0000-4000-8000-000000000003', id = '00000000-0000-4000-8000-000000000004';
const startedAt = Date.parse('2026-10-09T08:00:00Z');
function draft() {
  const value = { ...emptyTypingBasicsDraft(owner, null), startedAt, endedAt: startedAt + 62000, checks: [true, true] };
  value.attempt = pressTypingKey(value.attempt, value.lesson.keys, 'KeyA');
  for (const char of value.lesson.keys) value.attempt = pressTypingKey(value.attempt, value.lesson.keys, TYPING_KEYS[char].code);
  return value;
}
const session = () => makeTypingBasicsSession(draft(), routine, id, '2026-10-09');
const storage = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};
test('basics checkpoint preserves exact attempt, lesson, both times, checks and immutable pending payload', () => {
  const store = storage(), d = { ...draft(), pending: session() };
  const raw = persistTypingBasicsDraft(store, d, null);
  assert.deepEqual(parseTypingBasicsDraft(raw, owner), d); assert.equal(store.getItem(typingBasicsDraftKey(other)), null);
  assert.throws(() => parseTypingBasicsDraft(raw, other), /typing_draft_invalid/);
  assert.deepEqual(d.pending.metrics, { courseId: 'typing-position-v1', lessonId: 'anchors', lessonCompleted: true,
    keyPresses: 13, correctKeyPresses: 12, keyAccuracy: 92, mistakeKeys: { f: 1 }, elapsedSeconds: 62,
    selfChecks: [true, true], inputMode: 'physical-key-position' });
  assert.equal(d.pending.actualMinutes, 1); assert.equal(d.pending.plannedMinutes, 5);
});
test('a valid older lesson snapshot survives content changes without replacing its sequence or timer', () => {
  const d = { ...emptyTypingBasicsDraft(owner, null), lesson: { id: 'anchors', title: '이전 수업', goal: '이전 안내', keys: 'jfjf' },
    attempt: { attempts: 1, position: 1, mistakes: {} }, startedAt };
  assert.deepEqual(parseTypingBasicsDraft(JSON.stringify(d), owner), d);
});
test('malformed, oversized, inconsistent attempt and tampered pending fields fail closed', () => {
  const good = { ...draft(), pending: session() };
  const invalid: unknown[] = [null, {}, [], { ...good, version: 2 }, { ...good, pending: undefined },
    { ...good, lesson: { ...good.lesson, keys: '😊' } }, { ...good, lesson: { ...good.lesson, keys: 'f'.repeat(501) } },
    { ...good, attempt: { ...good.attempt, attempts: 12 } }, { ...good, attempt: { ...good.attempt, mistakes: { f: -1 } } },
    { ...good, attempt: { ...good.attempt, mistakes: { q: 1 } } }, { ...good, attempt: { ...good.attempt, position: 13 } },
    { ...good, checks: [true] }, { ...good, checks: [1, true] }, { ...good, checks: [false, true] },
    { ...good, startedAt: null }, { ...good, endedAt: null }, { ...good, endedAt: startedAt - 1 },
    { ...good, pending: { ...session(), sessionDate: '2026-02-30' } },
    ...['id', 'routineId', 'status', 'source', 'memo', 'startedAt', 'endedAt', 'actualMinutes', 'metrics'].map(key => ({ ...good, pending: { ...session(), [key]: 'tampered' } }))];
  for (const value of invalid) assert.throws(() => parseTypingBasicsDraft(JSON.stringify(value), owner));
  assert.throws(() => parseTypingBasicsDraft('{', owner)); assert.throws(() => parseTypingBasicsDraft(' '.repeat(16001), owner));
});
test('checkpoint and removal compare prior bytes and verify successful writes without overwriting another tab', () => {
  const store = storage(), first = persistTypingBasicsDraft(store, draft(), null);
  store.setItem(typingBasicsDraftKey(owner), 'newer');
  assert.throws(() => persistTypingBasicsDraft(store, draft(), first), /typing_draft_changed/);
  assert.throws(() => removeTypingBasicsDraft(store, owner, first), /typing_draft_changed/);
  assert.equal(store.getItem(typingBasicsDraftKey(owner)), 'newer');
  store.values.clear();
  assert.throws(() => persistTypingBasicsDraft({ ...store, setItem() {} }, draft(), null), /typing_draft_changed/);
  assert.throws(() => persistTypingBasicsDraft({ ...store, setItem() { throw Error('quota'); } }, draft(), null), /quota/);
});
test('reset cancellation keeps every field and pending saves stay locked even after reload', () => {
  const d = draft(), before = structuredClone(d); let prompts = 0;
  const cancel = () => { prompts++; return false; };
  assert.equal(shouldResetTypingBasicsDraft(d, false, false, cancel), false); assert.deepEqual(d, before);
  assert.equal(shouldResetTypingBasicsDraft(d, false, false, () => true), true);
  assert.equal(shouldResetTypingBasicsDraft(emptyTypingBasicsDraft(owner, null), false, false, cancel), true);
  assert.equal(shouldResetTypingBasicsDraft(d, true, false, cancel), true);
  assert.equal(shouldResetTypingBasicsDraft(d, false, true, cancel), false);
  assert.equal(shouldResetTypingBasicsDraft({ ...d, pending: session() }, false, false, cancel), false);
  assert.equal(prompts, 1);
});
test('multi-day partial input is recoverable but cannot produce a silently capped session', () => {
  const d = { ...draft(), endedAt: startedAt + 2 * 86400000 };
  assert.deepEqual(parseTypingBasicsDraft(JSON.stringify(d), owner), d);
  assert.throws(() => makeTypingBasicsSession(d, routine, id, '2026-10-09'), /typing_duration_out_of_range/);
});
