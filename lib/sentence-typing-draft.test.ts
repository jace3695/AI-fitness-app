import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GrowthSessionRow } from '../app/data/growthPlatform.ts';
import {
  confirmSentenceTypingSave, emptySentenceTypingDraft, makeSentenceTypingSession,
  parseSentenceTypingDraft, persistSentenceTypingDraft, removeSentenceTypingDraft,
  sentenceTypingDraftKey, sentenceTypingRowMatches, shouldResetSentenceTypingDraft,
} from './sentence-typing-draft.ts';

const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const routine = { id: '00000000-0000-4000-8000-000000000003', target_minutes: 15 };
const id = '00000000-0000-4000-8000-000000000004';
const startedAt = Date.parse('2026-10-09T08:00:00Z');
const draft = () => ({ ...emptySentenceTypingDraft(owner, null), typed: 'xx', startedAt });
const session = () => makeSentenceTypingSession(draft(), routine, id, '2026-10-09', startedAt + 62000);
const row = (): GrowthSessionRow => {
  const s = session();
  return { id: s.id, user_id: owner, routine_id: s.routineId, session_date: s.sessionDate, status: s.status,
    planned_minutes: s.plannedMinutes, actual_minutes: s.actualMinutes, source: s.source, memo: s.memo,
    metrics: s.metrics, started_at: s.startedAt, ended_at: s.endedAt, created_at: s.endedAt, updated_at: s.endedAt };
};
const storage = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};

test('owner-scoped checkpoint restores exact passage, input, timer and immutable pending ID/payload', () => {
  const store = storage(); const d = { ...draft(), pending: session() };
  const raw = persistSentenceTypingDraft(store, d, null);
  assert.deepEqual(parseSentenceTypingDraft(store.getItem(sentenceTypingDraftKey(owner)), owner), d);
  assert.equal(store.getItem(sentenceTypingDraftKey(other)), null);
  assert.throws(() => parseSentenceTypingDraft(raw, other), /typing_draft_invalid/);
  assert.equal(d.pending.status, 'partial');
  assert.deepEqual(d.pending.metrics.mistakeCharacters, [{ character: '천', count: 2 }]);
  assert.equal(d.pending.metrics.elapsedSeconds, 62);
  assert.equal(d.pending.actualMinutes, 1);
});

test('recovery preserves the saved passage snapshot across app content updates', () => {
  const d = { ...draft(), passage: '이전 버전 문장입니다.' };
  const p = { ...d, pending: makeSentenceTypingSession(d, routine, id, '2026-10-09', startedAt + 2000) };
  assert.deepEqual(parseSentenceTypingDraft(JSON.stringify(p), owner), p);
});

test('malformed and inconsistent recovery data fail closed without removing raw data', () => {
  const good = { ...draft(), pending: session() };
  for (const bad of [null, {}, { ...good, version: 2 }, { ...good, startedAt: null }, { ...good, typed: 'x'.repeat(501) }, { ...good, pending: undefined },
    { ...good, pending: { ...session(), sessionDate: '2026-02-30' } }, { ...good, pending: { ...session(), endedAt: new Date(startedAt - 1000).toISOString() } },
    ...['id', 'routineId', 'status', 'memo', 'source', 'startedAt', 'actualMinutes', 'metrics'].map(key => ({ ...good, pending: { ...session(), [key]: 'tampered' } }))]) {
    const raw = JSON.stringify(bad); const store = storage(); store.setItem(sentenceTypingDraftKey(owner), raw);
    assert.throws(() => parseSentenceTypingDraft(raw, owner));
    assert.equal(store.getItem(sentenceTypingDraftKey(owner)), raw);
  }
  assert.throws(() => parseSentenceTypingDraft('{', owner));
  assert.throws(() => parseSentenceTypingDraft(' '.repeat(16001), owner));
});

test('checkpoint and removal never knowingly replace a different tab draft', () => {
  const store = storage(); const first = persistSentenceTypingDraft(store, draft(), null);
  const newer = JSON.stringify({ ...draft(), typed: 'newer' }); store.setItem(sentenceTypingDraftKey(owner), newer);
  assert.throws(() => persistSentenceTypingDraft(store, { ...draft(), pending: session() }, first), /typing_draft_changed/);
  assert.throws(() => removeSentenceTypingDraft(store, owner, first), /typing_draft_changed/);
  assert.equal(store.getItem(sentenceTypingDraftKey(owner)), newer);
});

test('checkpoint requires successful read-back and propagates storage failure', () => {
  const store = storage();
  assert.throws(() => persistSentenceTypingDraft({ ...store, setItem() { throw Error('quota'); } }, draft(), null), /quota/);
  assert.throws(() => persistSentenceTypingDraft({ ...store, setItem() {} }, draft(), null), /typing_draft_changed/);
  const raw = persistSentenceTypingDraft(store, draft(), null);
  removeSentenceTypingDraft(store, owner, raw); assert.equal(store.getItem(sentenceTypingDraftKey(owner)), null);
});

test('reset cancellation preserves all state; empty/saved attempts do not prompt; pending and in-flight cannot reset', () => {
  const d = draft(), original = structuredClone(d); let prompts = 0;
  const cancel = () => { prompts++; return false; };
  assert.equal(shouldResetSentenceTypingDraft(d, false, false, cancel), false);
  assert.deepEqual(d, original); assert.equal(prompts, 1);
  assert.equal(shouldResetSentenceTypingDraft(d, false, false, () => true), true);
  assert.equal(shouldResetSentenceTypingDraft(emptySentenceTypingDraft(owner, null), false, false, cancel), true);
  assert.equal(shouldResetSentenceTypingDraft(d, true, false, cancel), true);
  assert.equal(shouldResetSentenceTypingDraft(d, false, true, cancel), false);
  assert.equal(shouldResetSentenceTypingDraft({ ...d, pending: session() }, false, false, cancel), false);
  assert.equal(prompts, 1);
});

test('exact row comparison includes owner, dates, times and canonical nested metrics', () => {
  assert.equal(sentenceTypingRowMatches(row(), owner, session()), true);
  const reordered = { ...row(), metrics: Object.fromEntries(Object.entries(row().metrics).reverse()), started_at: '2026-10-09T08:00:00+00:00' };
  assert.equal(sentenceTypingRowMatches(reordered, owner, session()), true);
  for (const patch of [{ user_id: other }, { id: other }, { routine_id: other }, { ended_at: '2026-10-09T08:01:03Z' }, { started_at: null }, { memo: 'edited' }, { metrics: {} }]) {
    assert.equal(sentenceTypingRowMatches({ ...row(), ...patch }, owner, session()), false);
  }
});

test('initial response loss is confirmed by full read-back; returned POST alone is insufficient', async () => {
  const calls: string[] = [];
  const result = await confirmSentenceTypingSave(owner, session(), false, {
    assertOwner: async () => {}, insert: async () => { calls.push('insert'); throw Error('lost response'); },
    read: async () => { calls.push('read'); return { data: row(), error: null }; },
  });
  assert.deepEqual(calls, ['insert', 'read']); assert.deepEqual(result, row());
  await assert.rejects(confirmSentenceTypingSave(owner, session(), false, {
    assertOwner: async () => {}, insert: async () => row(), read: async () => ({ data: null, error: Error('offline') }),
  }), /typing_save_unconfirmed/);
});

test('reloaded unresolved save reads first, confirms existing row and never inserts again', async () => {
  let inserts = 0;
  const recovered = parseSentenceTypingDraft(JSON.stringify({ ...draft(), pending: session() }), owner)!;
  assert.deepEqual(await confirmSentenceTypingSave(owner, recovered.pending!, true, {
    assertOwner: async () => {}, read: async () => ({ data: row(), error: null }), insert: async () => { inserts++; },
  }), row());
  assert.equal(inserts, 0);
});

test('failed retry read and conflicting payload never permit a write', async () => {
  for (const result of [{ data: null, error: Error('offline') }, { data: { ...row(), memo: 'edited elsewhere' }, error: null }]) {
    let inserts = 0;
    await assert.rejects(confirmSentenceTypingSave(owner, session(), true, {
      assertOwner: async () => {}, read: async () => result, insert: async () => { inserts++; },
    }), /typing_save_(unconfirmed|conflict)/);
    assert.equal(inserts, 0);
  }
});

test('only confirmed absence permits exact-ID insert on retry and then read-back', async () => {
  const calls: string[] = []; let inserted = false;
  await confirmSentenceTypingSave(owner, session(), true, {
    assertOwner: async () => {}, read: async () => { calls.push('read'); return { data: inserted ? row() : null, error: null }; },
    insert: async () => { calls.push(`insert:${session().id}`); inserted = true; },
  });
  assert.deepEqual(calls, ['read', `insert:${id}`, 'read']);
});

test('owner change before write or after delayed read cannot confirm or retry into B', async () => {
  for (const changedAt of [1, 2, 3, 4]) {
    let checks = 0, inserts = 0;
    await assert.rejects(confirmSentenceTypingSave(owner, session(), true, {
      assertOwner: async () => { if (++checks >= changedAt) throw Error('owner changed'); },
      read: async () => ({ data: null, error: null }), insert: async () => { inserts++; },
    }), /owner changed/);
    assert.ok(inserts <= (changedAt >= 4 ? 1 : 0));
  }
});


test('authoritative reset or missing-schema rejections cannot turn into success or an unsafe fallback', async () => {
  for (const reason of ['typing_reset_changed', 'typing_save_schema_unavailable']) {
    let reads = 0, inserts = 0;
    await assert.rejects(confirmSentenceTypingSave(owner, session(), false, {
      assertOwner: async () => {}, insert: async () => { inserts++; throw Error(reason); },
      read: async () => { reads++; return { data: row(), error: null }; },
    }), new RegExp(reason));
    assert.equal(inserts, 1); assert.equal(reads, 0);
  }
});
